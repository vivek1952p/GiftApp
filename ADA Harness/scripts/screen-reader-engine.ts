/**
 * ============================================================================
 * Screen Reader Announcement Engine (guidepup + NVDA)
 * ============================================================================
 *
 * Windows UI Automation (uia-scan.ts) proves a control is EXPOSED to the OS
 * accessibility layer. It does not prove a real screen reader announces
 * something a user could act on. This engine closes that gap by driving real
 * NVDA (via guidepup) and checking what it actually says.
 *
 * Scope (targeted v1): re-verifies elements OTHER engines already flagged as
 * missing an accessible name — the same rule ids merge-report.ts's NAME_RULES
 * table already cross-checks against the AX tree / UIA / DOM — rather than
 * walking every element on every page. A finding is only raised when NVDA's
 * announcement STILL lacks a usable name, confirming the gap for real AT
 * users on top of the existing structural checks.
 *
 * Note: guidepup's NVDA does not audibly speak — it reads NVDA's internal
 * Speech Viewer text log, so this is CI-safe/silent by design (see
 * https://assistivlabs.com/articles/automating-screen-readers-for-accessibility-testing).
 *
 * Requires NVDA + guidepup's one-time host setup:
 *   npx @guidepup/setup setup && npx @guidepup/setup install
 *
 * NVDA is Windows-only, like UIA — on other platforms (or when NVDA/guidepup
 * setup is missing) this stage writes `available: false` and exits cleanly so
 * the rest of the pipeline is never blocked.
 * ============================================================================
 */

import { chromium } from '@playwright/test';
import { nvda } from '@guidepup/guidepup';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import { NAME_RULES, readJson } from './merge-report';
import { gotoPage } from './navigate';
import type {
  ScreenReaderFinding,
  ScreenReaderReport,
  Summary,
  SummaryViolation,
  UiaSeverity,
} from './types';

const log = createLogger('screen-reader');

/** Saved session file produced by npm run save-auth. */
const SESSION_FILE = path.join(adaConfig.paths.root, 'auth', 'session.json');

/** Cap per page so a page with many missing-name violations doesn't blow up runtime. */
const MAX_PER_PAGE = 5;

/** Time to let NVDA's speech settle after a focus change before reading it back. */
const FOCUS_SETTLE_MS = 400;

function writeReport(report: ScreenReaderReport): void {
  fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
  fs.writeFileSync(adaConfig.paths.screenReaderReport, JSON.stringify(report, null, 2), 'utf-8');
  log.info(`Screen reader report -> ${path.relative(process.cwd(), adaConfig.paths.screenReaderReport)}`);
}

/**
 * True when an NVDA announcement still reflects a missing/empty accessible
 * name: strip the expected ARIA role words (and NVDA's own generic role
 * vocabulary) out of the announcement and check whether anything meaningful
 * is left. This is a heuristic over free-text speech, not exact matching —
 * good enough to confirm the "no name at all" case this engine targets.
 */
export function announcementLacksName(announced: string, roles: string[]): boolean {
  let text = announced.trim().toLowerCase();
  if (!text) return true;
  const ROLE_WORDS = [
    'button',
    'graphic',
    'image',
    'link',
    'clickable',
    'edit',
    'checkbox',
    'group',
    'unlabelled',
    'unlabeled',
    'blank',
    ...roles.map((r) => r.toLowerCase()),
  ];
  for (const word of ROLE_WORDS) {
    text = text.split(word).join(' ');
  }
  return text.replace(/[^a-z0-9]/g, '').length === 0;
}

async function main(): Promise<void> {
  const findings: ScreenReaderFinding[] = [];
  const baseReport = { generatedAt: new Date().toISOString(), baseUrl: adaConfig.baseUrl };

  if (os.platform() !== 'win32') {
    log.warn(
      `Screen Reader Engine is Windows-only (NVDA); host is "${os.platform()}". Writing unavailable report.`
    );
    writeReport({
      ...baseReport,
      available: false,
      error: 'Not running on Windows.',
      totalFindings: 0,
      findings,
    });
    return;
  }

  const summary = readJson<Summary>(adaConfig.paths.summary);
  if (!summary) {
    log.warn('summary.json not found — run the scan first. Writing unavailable report.');
    writeReport({
      ...baseReport,
      available: false,
      error: 'summary.json not found.',
      totalFindings: 0,
      findings,
    });
    return;
  }

  // Only re-verify missing-name rule ids (merge-report.ts's NAME_RULES) —
  // targeted v1 scope.
  const byPage = new Map<string, SummaryViolation[]>();
  for (const v of summary.violations) {
    if (!(v.ruleId in NAME_RULES)) continue;
    const list = byPage.get(v.page) ?? [];
    if (list.length >= MAX_PER_PAGE) continue;
    list.push(v);
    byPage.set(v.page, list);
  }

  if (byPage.size === 0) {
    log.info('No missing-name violations to re-verify — writing empty (available) report.');
    writeReport({ ...baseReport, available: true, totalFindings: 0, findings });
    return;
  }

  try {
    await nvda.start();
  } catch (err) {
    log.warn(
      `NVDA could not be started (install it and run "npx @guidepup/setup setup && npx @guidepup/setup install"): ${(err as Error).message}`
    );
    writeReport({
      ...baseReport,
      available: false,
      error: (err as Error).message,
      totalFindings: 0,
      findings,
    });
    return;
  }

  log.info('NVDA started. Launching headed browser for screen reader verification...');

  const browser = await chromium.launch({
    headless: false,
    ...(adaConfig.channel ? { channel: adaConfig.channel } : {}),
  });
  const storageState = adaConfig.auth.enabled && fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
  const context = await browser.newContext({
    viewport: adaConfig.viewport,
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();

  let firstPage = true;

  try {
    for (const target of adaConfig.pages) {
      const violations = byPage.get(target.name);
      if (!violations || violations.length === 0) continue;

      const url = new URL(target.path, adaConfig.baseUrl).toString();
      log.info(`Screen reader scan: ${target.name} -> ${url} (${violations.length} element(s) to re-verify)`);

      try {
        await gotoPage(page, target, adaConfig, firstPage);
        firstPage = false;
        await page.bringToFront();
      } catch {
        log.warn(`Could not load ${target.name} — skipping screen reader tests.`);
        continue;
      }

      for (const v of violations) {
        const spec = NAME_RULES[v.ruleId];
        const role = spec.ariaRoles[0] ?? '';
        try {
          await page.locator(v.target).first().focus({ timeout: 3000 });
          await page.waitForTimeout(FOCUS_SETTLE_MS);
          const announced = await nvda.lastSpokenPhrase();

          if (announcementLacksName(announced, spec.ariaRoles)) {
            findings.push({
              page: v.page,
              url,
              ruleId: v.ruleId,
              target: v.target,
              role,
              expectedName: '',
              announcedText: announced,
              issue:
                `NVDA announced "${announced || '(nothing)'}" for this ${role || 'element'} — no accessible ` +
                `name is spoken, confirming the ${v.ruleId} finding for real screen reader users.`,
              severity: (v.impact ?? 'moderate') as UiaSeverity,
              wcag: v.ruleId === 'image-alt' ? '1.1.1' : '4.1.2',
              recommendation:
                'Provide an accessible name (aria-label, associated label, or visible text) so NVDA announces it.',
            });
          }
        } catch (err) {
          log.warn(`Could not focus ${v.target} on ${v.page}: ${(err as Error).message}`);
        }
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {
      /* already closed */
    }
    try {
      await nvda.stop();
    } catch {
      /* already stopped */
    }
  }

  writeReport({ ...baseReport, available: true, totalFindings: findings.length, findings });
  log.info(`Screen reader verification complete: ${findings.length} finding(s) confirmed by NVDA.`);
}

main().catch((err) => {
  log.error('Screen reader engine failed', (err as Error).message);
  process.exitCode = 1;
});
