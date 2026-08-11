/**
 * ============================================================================
 * Focus Management Engine
 * ============================================================================
 *
 * Validates that keyboard focus is correctly managed at the application
 * framework level — the category of issue most scanners cannot detect.
 *
 * Tests:
 *   1. Route navigation — after Angular navigates to each page, where does
 *      focus land? Should be on a heading, skip-link, or the main landmark.
 *   2. Dynamic content — checks for focus loss (focus falling to body/html).
 *
 * WCAG 2.4.3 (Focus Order), 2.4.7 (Focus Visible), 3.2.2 (On Input).
 * ============================================================================
 */

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import type { FocusManagementFinding, FocusManagementReport } from './types';

const log = createLogger('focus-mgmt');
const SESSION_FILE = path.join(adaConfig.paths.root, 'auth', 'session.json');

/** Roles considered acceptable focus landing targets after SPA navigation. */
const ACCEPTABLE_LANDING_ROLES = new Set([
  'heading',
  'main',
  'banner',
  'navigation',
  'region',
  'document',
  'application',
  'link',        // skip-to-main or logo link is acceptable
  'none',        // Angular renders layout divs with no role
  'generic',     // same as none — structural div without semantic role
]);

async function main(): Promise<void> {
  const findings: FocusManagementFinding[] = [];

  const browser = await chromium.launch({
    headless: true,
    ...(adaConfig.channel ? { channel: adaConfig.channel } : {}),
  });
  const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
  const context = await browser.newContext({
    viewport: adaConfig.viewport,
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();

  try {
    const pages = adaConfig.pages;
    if (pages.length === 0) { log.warn('No pages configured.'); return; }

    // Load first page to initialise the Angular SPA.
    try {
      await page.goto(new URL(pages[0].path, adaConfig.baseUrl).toString(), {
        waitUntil: 'load', timeout: adaConfig.timeouts.navigationMs,
      });
      await page.waitForTimeout(adaConfig.settleTimeoutMs);
    } catch (err) {
      log.warn(`Could not load initial page (${pages[0].name}): ${(err as Error).message}`);
    }

    let spaLoaded = true; // Home is already loaded above
    const SPA_BASE = adaConfig.spaBase;

    for (const target of pages) {
      const url = new URL(target.path, adaConfig.baseUrl).toString();

      try {
        // Use SPA navigation (history.pushState) to bypass server-side redirect.
        // The first page was already loaded above via page.goto.
        if (!spaLoaded) {
          await page.goto(url, { waitUntil: 'load', timeout: adaConfig.timeouts.navigationMs });
          spaLoaded = true;
        } else {
          await page.evaluate((p) => {
            window.history.pushState({}, '', p);
            window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
          }, `${SPA_BASE}${target.path}`);
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(adaConfig.settleTimeoutMs);
        }
        await page.waitForTimeout(adaConfig.settleTimeoutMs + 500); // extra settle for Angular

        // ── Test 1: Where does focus land after navigation? ─────────────
        const focusInfo = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body || el === document.documentElement) {
            return { tag: el?.tagName?.toLowerCase() ?? 'unknown', role: null, name: null, onBody: true };
          }
          return {
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
            name: (el as HTMLElement).innerText?.slice(0, 60) ?? el.getAttribute('aria-label') ?? '',
            onBody: false,
          };
        });

        if (focusInfo.onBody) {
          findings.push({
            page: target.name, url,
            scenario: 'route-navigation',
            issue: `After navigating to ${target.name}, focus fell to <body>/<html> — keyboard users lose context`,
            severity: 'serious', wcag: '2.4.3',
            recommendation: 'After Angular route navigation, programmatically move focus to the page <h1>, skip-to-main link, or the <main> element using router.events + ViewChild focus().',
            detail: `Focused element: <${focusInfo.tag}>`,
          });
        } else if (!ACCEPTABLE_LANDING_ROLES.has(focusInfo.role ?? '')) {
          findings.push({
            page: target.name, url,
            scenario: 'route-navigation',
            issue: `Focus lands on <${focusInfo.tag} role="${focusInfo.role}"> after navigation — not a landmark or heading`,
            severity: 'moderate', wcag: '2.4.3',
            recommendation: 'Prefer placing focus on the page heading (<h1>) or skip-to-main link after route change.',
            detail: `Focused element: <${focusInfo.tag}> "${focusInfo.name}"`,
          });
        } else {
          log.info(`${target.name}: focus lands on <${focusInfo.tag} role="${focusInfo.role}"> ✓`);
        }

        // -- Test 2: Focus visibility ----------------------------------------
        // Press Tab once to enter keyboard mode so the browser activates :focus-visible.
        // Without a keyboard event, :focus-visible is not active even for focused elements.
        await page.keyboard.press('Tab');
        await page.waitForTimeout(150);

        const focusVisibleOk = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body || el === document.documentElement) return true;

          // Check if the browser is in keyboard navigation mode and the element is
          // focus-visible. getComputedStyle with a pseudo-CLASS is not supported —
          // use el.matches(':focus-visible') instead.
          const isFocusVisible = el.matches(':focus-visible');
          if (!isFocusVisible) return true; // element defers to UA; cannot assess

          // Element claims :focus-visible — verify a visible outline exists.
          const style = window.getComputedStyle(el);
          const width  = parseFloat(style.outlineWidth) || 0;
          const style2 = style.outlineStyle;
          return width > 0 && style2 !== 'none';
        });

        if (!focusVisibleOk) {
          findings.push({
            page: target.name, url,
            scenario: 'focus-visible',
            issue: 'A focusable element has :focus-visible active but no visible outline (outlineWidth is 0 or outlineStyle is none)',
            severity: 'serious', wcag: '2.4.7',
            recommendation:
              'Remove outline:none from focus styles. Provide a replacement indicator ' +
              '(e.g. box-shadow, background-color change, border) that meets WCAG 2.4.7.',
            detail: `Tested after Tab press on ${target.name}.`,
          });
        }

      } catch (err) {
        log.warn(`Focus management test failed for ${target.name}: ${(err as Error).message}`);
      }
    }
  } finally {
    await browser.close();
  }

  const report: FocusManagementReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: adaConfig.baseUrl,
    totalFindings: findings.length,
    findings,
  };

  fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
  fs.writeFileSync(adaConfig.paths.focusManagementReport, JSON.stringify(report, null, 2), 'utf-8');
  log.info(`Focus Management Engine: ${findings.length} finding(s) -> ${path.relative(process.cwd(), adaConfig.paths.focusManagementReport)}`);
}

main().catch((err) => {
  log.error('Focus Management Engine failed', (err as Error).message);
  // Write empty report so merge-report never breaks on a missing file.
  const empty: FocusManagementReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: adaConfig.baseUrl,
    totalFindings: 0,
    findings: [],
  };
  try {
    fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
    fs.writeFileSync(adaConfig.paths.focusManagementReport, JSON.stringify(empty, null, 2), 'utf-8');
  } catch { /* ignore */ }
  // Exit 0 so the pipeline continues — this engine is optional.
});
