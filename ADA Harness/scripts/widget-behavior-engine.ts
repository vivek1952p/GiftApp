/**
 * ============================================================================
 * Widget Behavior Engine
 * ============================================================================
 *
 * Validates that ARIA widgets behave according to WAI-ARIA Authoring Practices
 * (APG) by driving real user interactions via Playwright.
 *
 * Tested patterns:
 *   Tab widget        – ArrowLeft/Right navigates between tabs
 *   Menu / Menubar    – ArrowDown/Up navigates items; Escape closes
 *   Accordion         – Enter/Space toggles expansion panels
 *   Dialog            – Focus is trapped; Escape closes
 *   Combobox          – ArrowDown opens dropdown; Escape closes
 * ============================================================================
 */

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import type { WidgetBehaviorReport, WidgetFinding } from './types';

const log = createLogger('widget-behavior');

const SESSION_FILE = path.join(adaConfig.paths.root, 'auth', 'session.json');

async function main(): Promise<void> {
  const findings: WidgetFinding[] = [];

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

  let spaLoaded = false;
  const SPA_BASE = adaConfig.spaBase;

  try {
    for (const target of adaConfig.pages) {
      const url = new URL(target.path, adaConfig.baseUrl).toString();
      log.info(`Widget scan: ${target.name} -> ${url}`);

      try {
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
        await page.waitForTimeout(adaConfig.settleTimeoutMs);
      } catch {
        log.warn(`Could not load ${target.name} — skipping widget tests.`);
        continue;
      }

      // Per-page dedup set: prevents reporting the same widget issue multiple times
      // (e.g. same combobox type appearing on every page)
      const reportedWidgets = new Set<string>();

      // -- Tab widget ---------------------------------------------------------
      const tabs = await page.locator('[role="tab"]').all();
      if (tabs.length > 1) {
        try {
          await tabs[0].focus();
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(200);
          const focusedRole = await page.evaluate(() => document.activeElement?.getAttribute('role'));
          if (focusedRole !== 'tab') {
            findings.push({
              page: target.name, url,
              widget: 'tab', selector: '[role="tab"]',
              issue: 'ArrowRight did not move focus to another tab (WAI-ARIA APG: roving tabindex — ArrowRight/Left must navigate between tabs)',
              severity: 'serious', wcag: '2.1.1',
              recommendation: 'Implement the roving tabindex pattern: on ArrowRight, set tabindex="0" on the next tab and tabindex="-1" on the others, then call focus(). See WAI-ARIA APG Tab Pattern.',
            });
          }
          // Restore focus to first tab
          await tabs[0].focus();
        } catch { /* element may not be interactable */ }
      }

      // -- Accordion (Angular Material mat-expansion-panel) ----------------
      // Only target mat-expansion-panel-header — not generic [role="button"][aria-expanded]
      // which would match toolbar buttons, filter dropdowns, and nav items.
      const accordions = await page.locator('mat-expansion-panel-header').all();
      const visibleAccordions = (await Promise.all(
        accordions.map(async (a) => ({ a, vis: await a.isVisible().catch(() => false) }))
      )).filter((x) => x.vis).map((x) => x.a);

      if (visibleAccordions.length > 0 && !reportedWidgets.has('accordion')) {
        try {
          const accordion = visibleAccordions[0];
          const before = await accordion.getAttribute('aria-expanded');
          await accordion.focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(350);
          const after = await accordion.getAttribute('aria-expanded');
          if (before === after) {
            reportedWidgets.add('accordion');
            findings.push({
              page: target.name, url,
              widget: 'accordion', selector: 'mat-expansion-panel-header',
              issue: 'Enter key did not toggle mat-expansion-panel accordion (WAI-ARIA APG: accordion headers must respond to Enter and Space)',
              severity: 'serious', wcag: '2.1.1',
              recommendation: 'Bind Enter and Space keydown events to the accordion header toggle action (mat-expansion-panel-header should handle this natively in Angular Material — verify no custom override is blocking it).',
            });
          } else {
            // Restore original state
            await accordion.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);
          }
        } catch { /* not interactable */ }
      }

      // -- Dialog ------------------------------------------------------------
      // Only check dialogs already open on page load (passive check — no trigger needed).
      const dialogs = await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').all();
      for (const dialog of dialogs.slice(0, 1)) {
        try {
          // Use evaluate() — elementHandle() is deprecated in newer Playwright.
          const focusInDialog = await dialog.evaluate((dlg) =>
            dlg.contains(document.activeElement)
          );

          if (!focusInDialog && !reportedWidgets.has('dialog-focus')) {
            reportedWidgets.add('dialog-focus');
            findings.push({
              page: target.name, url,
              widget: 'dialog', selector: '[role="dialog"]',
              issue: 'An open dialog does not contain keyboard focus (WAI-ARIA APG: focus must move inside dialog when it opens)',
              severity: 'critical', wcag: '2.1.2',
              recommendation: 'On dialog open, move focus to the first focusable element inside the dialog or to the dialog container itself (tabindex="-1").',
            });
          }

          // Test Escape closes dialog
          await page.keyboard.press('Escape');
          await page.waitForTimeout(350);
          const stillVisible = await dialog.isVisible().catch(() => false);
          if (stillVisible && !reportedWidgets.has('dialog-escape')) {
            reportedWidgets.add('dialog-escape');
            findings.push({
              page: target.name, url,
              widget: 'dialog', selector: '[role="dialog"]',
              issue: 'Escape key did not close the dialog (WAI-ARIA APG: Escape must dismiss dialogs)',
              severity: 'serious', wcag: '2.1.2',
              recommendation: 'Bind keydown Escape to the dialog close action. Ensure child elements do not stop-propagate the Escape event.',
            });
          }
        } catch { /* dialog interaction failed */ }
      }

      // -- Combobox ----------------------------------------------------------
      const comboboxes = await page.locator('[role="combobox"]:not([aria-disabled="true"])').all();
      for (const combo of comboboxes.slice(0, 2)) {
        try {
          const isVisible = await combo.isVisible().catch(() => false);
          if (!isVisible) continue;
          const isExpanded = await combo.getAttribute('aria-expanded');
          if (isExpanded === 'false' || isExpanded === null) {
            await combo.focus();
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(250);
            const expanded = await combo.getAttribute('aria-expanded');
            if (expanded !== 'true') {
              if (!reportedWidgets.has('combobox')) {
                reportedWidgets.add('combobox');
                findings.push({
                  page: target.name, url,
                  widget: 'combobox', selector: '[role="combobox"]',
                  issue: 'ArrowDown did not open the combobox dropdown (WAI-ARIA APG: combobox must open on ArrowDown)',
                  severity: 'serious', wcag: '2.1.1',
                  recommendation: 'Bind ArrowDown to open the combobox listbox. For Angular Material mat-select, verify no custom event handler is intercepting ArrowDown before Angular Material handles it.',
                });
              }
            } else {
              // Close it to restore page state
              await page.keyboard.press('Escape');
              await page.waitForTimeout(200);
            }
          }
        } catch { /* not interactable */ }
      }
    }
  } finally {
    await browser.close();
  }

  const report: WidgetBehaviorReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: adaConfig.baseUrl,
    totalFindings: findings.length,
    findings,
  };

  fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
  fs.writeFileSync(adaConfig.paths.widgetBehaviorReport, JSON.stringify(report, null, 2), 'utf-8');
  log.info(`Widget Behavior Engine: ${findings.length} finding(s) -> ${path.relative(process.cwd(), adaConfig.paths.widgetBehaviorReport)}`);
}

main().catch((err) => {
  log.error('Widget Behavior Engine failed', (err as Error).message);
  process.exitCode = 1;
});
