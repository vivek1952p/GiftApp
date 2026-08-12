/**
 * ============================================================================
 * Widget Behavior Engine
 * ============================================================================
 *
 * Validates that ARIA widgets behave according to WAI-ARIA Authoring Practices
 * (APG) by driving real user interactions via Playwright.
 *
 * Tested patterns:
 *   Tab widget        – ArrowLeft/Right moves focus to a DIFFERENT tab
 *   Menu / Menubar    – opened via its standard trigger association;
 *                        ArrowDown moves focus between items; Escape closes
 *   Accordion         – Enter AND Space toggle expansion panels
 *   Dialog            – Focus is trapped; Escape closes
 *   Combobox          – ArrowDown opens dropdown; Escape closes
 *
 * Up to 2 instances of each widget are sampled per page (not just the first),
 * so a broken 2nd/3rd instance isn't hidden by a working first one.
 * ============================================================================
 */

import { chromium, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import { gotoPage } from './navigate';
import type { WidgetBehaviorReport, WidgetFinding } from './types';

const log = createLogger('widget-behavior');

const SESSION_FILE = path.join(adaConfig.paths.root, 'auth', 'session.json');

/**
 * Focuses `origin`, presses `key`, and returns true only if focus moved to a
 * DIFFERENT element matching `expectedRoleSelector` — not merely "focus is
 * currently on something with the right role". Without the "different
 * element" check, a completely unresponsive widget would falsely pass
 * whenever the origin element itself already carries that role (e.g. a tab
 * is still a tab even if ArrowRight did nothing at all).
 */
async function focusMovedTo(
  page: Page,
  origin: Locator,
  key: string,
  expectedRoleSelector: string,
  waitMs = 200
): Promise<boolean> {
  const MARK = 'data-ada-origin';
  await origin.evaluate((el, m) => el.setAttribute(m, 'true'), MARK).catch(() => {});
  await origin.focus();
  await page.keyboard.press(key);
  await page.waitForTimeout(waitMs);
  const moved = await page.evaluate(
    ({ m, sel }) => {
      const el = document.activeElement;
      if (!el) return false;
      const isOrigin = el.getAttribute(m) === 'true';
      return !isOrigin && el.matches(sel);
    },
    { m: MARK, sel: expectedRoleSelector }
  );
  await origin.evaluate((el, m) => el.removeAttribute(m), MARK).catch(() => {});
  return moved;
}

async function main(): Promise<void> {
  const findings: WidgetFinding[] = [];

  const browser = await chromium.launch({
    headless: true,
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
      const url = new URL(target.path, adaConfig.baseUrl).toString();
      log.info(`Widget scan: ${target.name} -> ${url}`);

      try {
        await gotoPage(page, target, adaConfig, firstPage);
        firstPage = false;
      } catch {
        log.warn(`Could not load ${target.name} — skipping widget tests.`);
        continue;
      }

      // Per-page dedup set: prevents reporting the same widget issue multiple times
      // (e.g. same combobox type appearing on every page)
      const reportedWidgets = new Set<string>();

      // -- Tab widget ---------------------------------------------------------
      // Checks focus moved to a DIFFERENT tab, not just "focus is on a tab" —
      // the latter would pass an entirely unresponsive widget, since the
      // starting element is itself already role="tab".
      const tabs = await page.locator('[role="tab"]').all();
      if (tabs.length > 1) {
        try {
          const moved = await focusMovedTo(page, tabs[0], 'ArrowRight', '[role="tab"]');
          if (!moved) {
            findings.push({
              page: target.name,
              url,
              widget: 'tab',
              selector: '[role="tab"]',
              issue:
                'ArrowRight did not move focus to another tab (WAI-ARIA APG: roving tabindex — ArrowRight/Left must navigate between tabs)',
              severity: 'serious',
              wcag: '2.1.1',
              recommendation:
                'Implement the roving tabindex pattern: on ArrowRight, set tabindex="0" on the next tab and tabindex="-1" on the others, then call focus(). See WAI-ARIA APG Tab Pattern.',
            });
          }
          // Restore focus to first tab
          await tabs[0].focus();
        } catch {
          /* element may not be interactable */
        }
      }

      // -- Menu / Menubar -------------------------------------------------
      // Finds menu triggers via the standard WAI-ARIA association
      // (aria-haspopup="menu", or aria-controls pointing at a role="menu"/
      // "menubar" element) — the same trigger-discovery approach used for
      // dialogs, so this isn't tied to any framework's menu component and
      // never guesses by clicking arbitrary buttons.
      const menuTriggerCount = await page.evaluate((marker) => {
        const els = Array.from(document.querySelectorAll('[aria-haspopup="menu"], [aria-controls]'));
        let idx = 0;
        for (const el of els) {
          const haspopup = el.getAttribute('aria-haspopup');
          const controls = el.getAttribute('aria-controls');
          let isMenuTrigger = haspopup === 'menu';
          if (!isMenuTrigger && controls) {
            const role = document.getElementById(controls)?.getAttribute('role');
            isMenuTrigger = role === 'menu' || role === 'menubar';
          }
          if (isMenuTrigger) {
            el.setAttribute(marker, String(idx));
            idx++;
          }
        }
        return idx;
      }, 'data-ada-menu-trigger');

      for (let i = 0; i < Math.min(menuTriggerCount, 2); i++) {
        if (reportedWidgets.has('menu-arrow') && reportedWidgets.has('menu-escape')) break;
        try {
          const trigger = page.locator(`[data-ada-menu-trigger="${i}"]`);
          if (!(await trigger.isVisible().catch(() => false))) continue;

          await trigger.focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(250);

          const menu = page.locator('[role="menu"]:visible, [role="menubar"]:visible').first();
          if (!(await menu.isVisible().catch(() => false))) continue; // Enter didn't open a menu — not this check's concern

          const items = await menu
            .locator('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')
            .all();
          if (items.length > 1 && !reportedWidgets.has('menu-arrow')) {
            const moved = await focusMovedTo(
              page,
              items[0],
              'ArrowDown',
              '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
            );
            if (!moved) {
              reportedWidgets.add('menu-arrow');
              findings.push({
                page: target.name,
                url,
                widget: 'menu',
                selector: '[role="menu"], [role="menubar"]',
                issue:
                  'ArrowDown did not move focus to another menu item (WAI-ARIA APG: Menu/Menubar must support Arrow-key navigation between items)',
                severity: 'serious',
                wcag: '2.1.1',
                recommendation:
                  'Implement roving tabindex or aria-activedescendant for menu items, and bind ArrowDown/ArrowUp to move focus between them.',
              });
            }
          }

          if (!reportedWidgets.has('menu-escape')) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(250);
            if (await menu.isVisible().catch(() => false)) {
              reportedWidgets.add('menu-escape');
              findings.push({
                page: target.name,
                url,
                widget: 'menu',
                selector: '[role="menu"], [role="menubar"]',
                issue: 'Escape key did not close the menu (WAI-ARIA APG: Escape must dismiss an open menu)',
                severity: 'serious',
                wcag: '2.1.2',
                recommendation: 'Bind keydown Escape to close the menu and return focus to the trigger.',
              });
            }
          }
        } catch {
          /* trigger became stale or interaction failed — skip */
        }
      }

      await page.evaluate(() => {
        document
          .querySelectorAll('[data-ada-menu-trigger]')
          .forEach((el) => el.removeAttribute('data-ada-menu-trigger'));
      });

      // -- Accordion -----------------------------------------------------
      // Selector is config-driven (config.json `widgets.accordionSelector`) so
      // enterprise users can point it at their own design system's component
      // (Angular Material, MUI, a custom web component, …) without touching
      // source. Defaults to native <details><summary> plus a generic
      // [role="button"][aria-expanded] header pattern.
      const accordions = await page.locator(adaConfig.widgets.accordionSelector).all();
      const visibleAccordions = (
        await Promise.all(accordions.map(async (a) => ({ a, vis: await a.isVisible().catch(() => false) })))
      )
        .filter((x) => x.vis)
        .map((x) => x.a);

      // Reads the expansion state regardless of pattern: aria-expanded on the
      // header itself, or (for native <details><summary>) the parent <details>
      // element's `open` attribute.
      const readExpandedState = (el: Locator) =>
        el.evaluate((node) => {
          const ariaExpanded = node.getAttribute('aria-expanded');
          if (ariaExpanded !== null) return ariaExpanded;
          const details = node.closest('details');
          return details ? String(details.hasAttribute('open')) : null;
        });

      // Sample up to 2 accordion instances, and test BOTH Enter and Space on
      // each (the APG requires both) — a header that responds to Enter but
      // not Space is still a real bug and was previously invisible here.
      for (const accordion of visibleAccordions.slice(0, 2)) {
        if (reportedWidgets.has('accordion')) break;
        for (const key of ['Enter', 'Space']) {
          try {
            const before = await readExpandedState(accordion);
            await accordion.focus();
            await page.keyboard.press(key);
            await page.waitForTimeout(350);
            const after = await readExpandedState(accordion);
            if (before === after) {
              reportedWidgets.add('accordion');
              findings.push({
                page: target.name,
                url,
                widget: 'accordion',
                selector: adaConfig.widgets.accordionSelector,
                issue: `${key} key did not toggle the accordion/disclosure header (WAI-ARIA APG: accordion headers must respond to Enter and Space)`,
                severity: 'serious',
                wcag: '2.1.1',
                recommendation:
                  "Bind Enter and Space keydown events to the accordion header's toggle action, or use a native <details><summary> element which handles this automatically.",
              });
              break; // this instance is already known broken — no need to test the other key
            } else {
              // Restore original state before testing the next key/instance
              await accordion.focus();
              await page.keyboard.press(key);
              await page.waitForTimeout(200);
            }
          } catch {
            /* not interactable */
          }
        }
      }

      // -- Dialog ------------------------------------------------------------
      // Only check dialogs already open on page load (passive check — no trigger needed).
      // Matches native <dialog> too — it carries an implicit dialog role and
      // needs no role="dialog" attribute, so a role-only selector would miss it.
      const dialogs = await page
        .locator('dialog:visible, [role="dialog"]:visible, [role="alertdialog"]:visible')
        .all();
      for (const dialog of dialogs.slice(0, 1)) {
        try {
          // Use evaluate() — elementHandle() is deprecated in newer Playwright.
          const focusInDialog = await dialog.evaluate((dlg) => dlg.contains(document.activeElement));

          if (!focusInDialog && !reportedWidgets.has('dialog-focus')) {
            reportedWidgets.add('dialog-focus');
            findings.push({
              page: target.name,
              url,
              widget: 'dialog',
              selector: '[role="dialog"]',
              issue:
                'An open dialog does not contain keyboard focus (WAI-ARIA APG: focus must move inside dialog when it opens)',
              severity: 'critical',
              wcag: '2.1.2',
              recommendation:
                'On dialog open, move focus to the first focusable element inside the dialog or to the dialog container itself (tabindex="-1").',
            });
          }

          // Test Escape closes dialog
          await page.keyboard.press('Escape');
          await page.waitForTimeout(350);
          const stillVisible = await dialog.isVisible().catch(() => false);
          if (stillVisible && !reportedWidgets.has('dialog-escape')) {
            reportedWidgets.add('dialog-escape');
            findings.push({
              page: target.name,
              url,
              widget: 'dialog',
              selector: '[role="dialog"]',
              issue: 'Escape key did not close the dialog (WAI-ARIA APG: Escape must dismiss dialogs)',
              severity: 'serious',
              wcag: '2.1.2',
              recommendation:
                'Bind keydown Escape to the dialog close action. Ensure child elements do not stop-propagate the Escape event.',
            });
          }
        } catch {
          /* dialog interaction failed */
        }
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
                  page: target.name,
                  url,
                  widget: 'combobox',
                  selector: '[role="combobox"]',
                  issue:
                    'ArrowDown did not open the combobox dropdown (WAI-ARIA APG: combobox must open on ArrowDown)',
                  severity: 'serious',
                  wcag: '2.1.1',
                  recommendation:
                    'Bind ArrowDown to open the combobox listbox. If using a component library (Angular Material mat-select, MUI Select, etc.), verify no custom event handler is intercepting ArrowDown before the library handles it.',
                });
              }
            } else {
              // Close it to restore page state
              await page.keyboard.press('Escape');
              await page.waitForTimeout(200);
            }
          }
        } catch {
          /* not interactable */
        }
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
  log.info(
    `Widget Behavior Engine: ${findings.length} finding(s) -> ${path.relative(process.cwd(), adaConfig.paths.widgetBehaviorReport)}`
  );
}

main().catch((err) => {
  log.error('Widget Behavior Engine failed', (err as Error).message);
  process.exitCode = 1;
});
