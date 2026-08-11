/**
 * ============================================================================
 * ADA Harness — Windows UI Automation Scan (Step: Technology 4)
 * ============================================================================
 *
 * This stage owns the browser lifecycle for the UIA capture. Because Windows
 * UI Automation must inspect a REAL, visible browser window, we:
 *
 *   1. Launch a headed Chromium window with Playwright (reusing the config).
 *   2. Navigate to every configured route.
 *   3. For each route, invoke uia/uia_capture.py which attaches to the window
 *      via the UI Automation API and walks the Windows accessibility tree.
 *   4. Aggregate every capture into reports/uia-tree.json.
 *
 * UIA is Windows-only. On other platforms (or when the `uiautomation` Python
 * package is missing) the Python script reports `available: false`; this stage
 * still runs and still writes uia-tree.json so the merge step always has an
 * artifact to correlate against. This keeps the stage NON-optional while
 * remaining robust and reusable.
 * ============================================================================
 */

import { chromium } from '@playwright/test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import type { UiaNode, UiaPageResult, UiaReport } from './types';

const log = createLogger('uia');

/** Saved session file produced by  npm run save-auth. */
const SESSION_FILE = path.join(adaConfig.paths.root, 'auth', 'session.json');

/** Absolute path to the Python capture script. */
const CAPTURE_SCRIPT = path.join(adaConfig.paths.root, 'uia', 'uia_capture.py');

/** Shape returned on STDOUT by uia_capture.py. */
interface CaptureOutput {
  available: boolean;
  found: boolean;
  window?: string;
  nodeCount: number;
  tree: UiaNode | null;
  error?: string;
}

/**
 * Run the Python capture script for the currently-focused browser window.
 * Errors are captured (never thrown) so a single failing page cannot abort the
 * whole stage.
 */
function capture(title: string): CaptureOutput {
  const args = [
    CAPTURE_SCRIPT,
    '--window-class',
    adaConfig.uia.windowClass,
    '--title',
    title,
    '--max-depth',
    String(adaConfig.uia.maxDepth),
  ];

  const useShell = process.platform === 'win32';
  // Under a shell, args are concatenated (not escaped): quote anything with a
  // space (e.g. the script path or the page title) so it is not split.
  const finalArgs = useShell
    ? args.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `"${a}"` : a))
    : args;

  const proc = spawnSync(adaConfig.uia.python, finalArgs, {
    encoding: 'utf-8',
    shell: useShell,
  });

  if (proc.error) {
    return { available: false, found: false, nodeCount: 0, tree: null, error: proc.error.message };
  }

  const stdout = (proc.stdout ?? '').trim();
  if (!stdout) {
    return {
      available: false,
      found: false,
      nodeCount: 0,
      tree: null,
      error: proc.stderr?.trim() || `uia_capture.py exited with code ${proc.status}`,
    };
  }

  try {
    return JSON.parse(stdout) as CaptureOutput;
  } catch {
    return { available: false, found: false, nodeCount: 0, tree: null, error: `Unparseable UIA output: ${stdout.slice(0, 200)}` };
  }
}

/** Write an empty-but-valid report so downstream merge always has an artifact. */
function writeReport(report: UiaReport): void {
  fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
  fs.writeFileSync(adaConfig.paths.uiaTree, JSON.stringify(report, null, 2), 'utf-8');
  log.info(`UIA report -> ${path.relative(process.cwd(), adaConfig.paths.uiaTree)}`);
}

/**
 * Entry point: drive a headed browser and capture the Windows a11y tree.
 */
async function main(): Promise<void> {
  const results: UiaPageResult[] = [];

  // Respect the config toggle, but still emit a report so merge never breaks.
  if (!adaConfig.uia.enabled) {
    log.warn('UIA capture disabled in config.json — writing empty report.');
    writeReport({
      generatedAt: new Date().toISOString(),
      baseUrl: adaConfig.baseUrl,
      platform: os.platform(),
      available: false,
      results,
    });
    return;
  }

  if (os.platform() !== 'win32') {
    log.warn(`UIA is Windows-only; host is "${os.platform()}". Writing unavailable report.`);
  }

  const channelLabel = adaConfig.channel ? ` (channel: ${adaConfig.channel})` : '';
  log.info(`Launching headed Chromium${channelLabel} for UIA capture...`);

  /** Launch a fresh headed browser + authenticated context + page. */
  async function launchPage() {
    const br = await chromium.launch({
      headless: false,
      ...(adaConfig.channel ? { channel: adaConfig.channel } : {}),
    });
    const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
    if (storageState) log.info('UIA: loading saved auth session from auth/session.json');
    const ctx = await br.newContext({
      viewport: adaConfig.viewport,
      ...(storageState ? { storageState } : {}),
    });
    const pg = await ctx.newPage();
    return { br, ctx, pg };
  }

  let { br: browser, pg: page } = await launchPage();

  let anyAvailable = false;
  let spaLoaded = false; // track whether Home was loaded for SPA navigation
  const SPA_BASE = adaConfig.spaBase;

  try {
    for (const target of adaConfig.pages) {
      const url = new URL(target.path, adaConfig.baseUrl).toString();
      log.info(`Capturing UIA for ${target.name} -> ${url}`);

      try {
        // First page: full page.goto() to initialise the Angular SPA.
        // Subsequent pages: SPA navigation so the server-side redirect to
        // ErrorPage is bypassed (Angular's router handles routing client-side).
        if (!spaLoaded) {
          await page.goto(url, { waitUntil: 'load', timeout: adaConfig.timeouts.navigationMs });
          spaLoaded = true;
        } else {
          const spaPath = `${SPA_BASE}${target.path}`;
          await page.evaluate((p) => {
            window.history.pushState({}, '', p);
            window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
          }, spaPath);
          await page.waitForTimeout(adaConfig.settleTimeoutMs + 500);
          await page.waitForLoadState('networkidle').catch(() => {});
        }
        await page.waitForTimeout(adaConfig.settleTimeoutMs);
        await page.bringToFront();

        const title = await page.title();
        const out = capture(title);
        if (out.available) anyAvailable = true;

        results.push({
          page: target.name,
          url,
          timestamp: new Date().toISOString(),
          available: out.available && out.found,
          error: out.error,
          window: out.window,
          nodeCount: out.nodeCount ?? 0,
          tree: out.tree,
        });

        log.info(
          `${target.name}: ${
            out.available
              ? out.found
                ? `${out.nodeCount} UIA node(s)`
                : 'window not found'
              : 'UIA unavailable'
          }`
        );
      } catch (err) {
        results.push({
          page: target.name,
          url,
          timestamp: new Date().toISOString(),
          available: false,
          error: (err as Error).message,
          nodeCount: 0,
          tree: null,
        });
        log.error(`UIA capture failed for ${target.name}`, (err as Error).message);

        // If the browser/page was closed by a redirect or crash, relaunch so
        // the remaining pages can still be captured.
        if (page.isClosed()) {
          log.warn('Page was closed — relaunching browser for remaining pages...');
          try { await browser.close(); } catch { /* already closed */ }
          const recovered = await launchPage();
          browser = recovered.br;
          page = recovered.pg;
        }
      }
    }
  } finally {
    try { await browser.close(); } catch { /* already closed */ }
  }

  writeReport({
    generatedAt: new Date().toISOString(),
    baseUrl: adaConfig.baseUrl,
    platform: os.platform(),
    available: anyAvailable,
    results,
  });
}

main().catch((err) => {
  log.error('UIA scan failed', (err as Error).message);
  process.exitCode = 1;
});
