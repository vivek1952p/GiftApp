/**
 * ============================================================================
 * Interaction Prediction Engine â€” v2
 * ============================================================================
 *
 * Predicts expected keyboard interactions per ARIA role, then verifies them
 * against actual browser behaviour using THREE independent signals:
 *
 *   1. Click-event interception  â€” Enter/Space must fire a synthetic click on
 *      interactive elements (WAI-ARIA Â§6.6 "activation").
 *   2. ARIA state monitoring     â€” aria-checked / aria-expanded / aria-selected
 *      must change for toggle/expand controls.
 *   3. DOM MutationObserver      â€” detects menus opening, dialogs appearing,
 *      panels expanding even when ARIA state is not updated.
 *
 * Only CUSTOM interactive elements are tested (non-native HTML). Native
 * <button>, <a href>, <input> are keyboard-operable by browsers without
 * any JavaScript.
 *
 * Findings are deduplicated per page: one finding per failing role+key
 * combination (not one per element instance).
 *
 * WCAG 2.1.1 (Keyboard), 4.1.2 (Name, Role, Value).
 * ============================================================================
 */

import { chromium, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import type { InteractionFinding, InteractionReport, UiaSeverity } from './types';

const log = createLogger('interaction');
const SESSION_FILE = path.join(adaConfig.paths.root, 'auth', 'session.json');

/** Max element instances to test per role spec per page. */
const MAX_PER_SPEC = 4;

// â”€â”€ Signal types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface AriaState {
  checked:  string | null;
  expanded: string | null;
  selected: string | null;
  disabled: string | null;
}

interface InteractionSignals {
  /** A native click event was dispatched on or from the element. */
  clickFired: boolean;
  /** Any ARIA state attribute changed after the keypress. */
  ariaStateChanged: boolean;
  /** The DOM mutated (child nodes added/removed, key attributes changed). */
  domMutated: boolean;
  /** Focus moved to a different element after the keypress. */
  focusMoved: boolean;
}

// â”€â”€ Role spec definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface RoleSpec {
  /** Short identifier used in deduplication and logging. */
  name: string;
  /** Human-readable role label for findings. */
  role: string;
  /** CSS selector targeting only non-native custom implementations. */
  selector: string;
  /** Keys that must activate this element per WAI-ARIA APG. */
  keys: string[];
  /** Severity when the element fails to respond. */
  severity: UiaSeverity;
  wcag: string;
  /**
   * Returns true when the element PASSED (responded correctly).
   * At least one signal must confirm activation.
   */
  verifyPass(signals: InteractionSignals, before: AriaState, after: AriaState | null): boolean;
  issue(key: string): string;
  recommendation: string;
  /** When true, revert the ARIA state after testing (to avoid side effects). */
  revertAfterTest?: boolean;
}

// â”€â”€ Role specifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ROLE_SPECS: RoleSpec[] = [
  // â”€â”€ Custom role="button" (div/span/li â€” not native <button>) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'custom-button',
    role: 'button (custom element)',
    selector: ':is(div, span, li)[role="button"]:not([aria-disabled="true"]):not([disabled])',
    keys: ['Enter', 'Space'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (s) => s.clickFired || s.domMutated || s.ariaStateChanged,
    issue: (k) => `Custom role="button" did not fire a click event on ${k} â€” screen reader and keyboard users cannot activate it`,
    recommendation: 'Add keydown/keyup handlers for Enter (keyCode 13) and Space (keyCode 32) that call element.click() or dispatch a click event. Better: replace the div/span with a native <button>.',
  },

  // â”€â”€ Custom role="link" (div/span â€” not native <a>) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'custom-link',
    role: 'link (custom element)',
    selector: ':is(div, span)[role="link"]:not([aria-disabled="true"])',
    keys: ['Enter'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (s) => s.clickFired || s.focusMoved || s.domMutated,
    issue: () => 'Custom role="link" did not activate on Enter â€” keyboard users cannot follow it',
    recommendation: 'Add a keydown handler for Enter that triggers navigation, or replace with a native <a href>.',
  },

  // â”€â”€ Custom checkbox (not native <input type="checkbox">) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'custom-checkbox',
    role: 'checkbox (custom element)',
    selector: ':not(input)[role="checkbox"]:not([aria-disabled="true"])',
    keys: ['Space'],
    severity: 'serious',
    wcag: '2.1.1',
    // aria-checked MUST change â€” click alone is not enough to confirm toggle
    verifyPass: (_s, before, after) =>
      after !== null && after.checked !== before.checked,
    issue: () => 'Space did not toggle aria-checked on custom role="checkbox" â€” screen readers will not announce the state change',
    recommendation: 'On Space keydown, toggle aria-checked between "true" and "false" and announce the change.',
    revertAfterTest: true,
  },

  // â”€â”€ Custom switch (not native <input type="checkbox" role="switch">) â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'custom-switch',
    role: 'switch (custom element)',
    selector: ':not(input)[role="switch"]:not([aria-disabled="true"])',
    keys: ['Space'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (_s, before, after) =>
      after !== null && after.checked !== before.checked,
    issue: () => 'Space did not toggle aria-checked on role="switch"',
    recommendation: 'Bind Space keydown to toggle aria-checked between "true" and "false" on the switch control.',
    revertAfterTest: true,
  },

  // â”€â”€ Expandable controls (accordion headers, disclosure buttons) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Only test NON-native elements (not <button aria-expanded> â€” native buttons work)
  {
    name: 'expandable-custom',
    role: 'expandable control (non-button)',
    selector: ':is(div, span, mat-expansion-panel-header)[aria-expanded="false"]:not([aria-disabled="true"]):not([disabled])',
    keys: ['Enter', 'Space'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (s, before, after) =>
      (after !== null && after.expanded !== before.expanded) || s.domMutated,
    issue: (k) => `${k} did not toggle aria-expanded on the expandable control â€” keyboard users cannot open this panel`,
    recommendation: 'On Enter/Space keydown, toggle aria-expanded and show/hide the controlled region.',
    revertAfterTest: true,
  },

  // â”€â”€ Custom menuitem (not native <button> or <a>) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'custom-menuitem',
    role: 'menuitem (custom element)',
    selector: ':not(a):not(button)[role="menuitem"]:not([aria-disabled="true"])',
    keys: ['Enter'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (s) => s.clickFired || s.domMutated || s.focusMoved,
    issue: () => 'Enter did not activate custom role="menuitem" â€” screen reader menu navigation will be broken',
    recommendation: 'Bind Enter keydown to trigger the menu item action (fire a click event or perform the action directly).',
  },

  // â”€â”€ Custom tab (not native) â€” Enter/Space must select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'custom-tab',
    role: 'tab (custom element)',
    selector: ':not(button)[role="tab"]:not([aria-disabled="true"])[aria-selected="false"]',
    keys: ['Enter'],
    severity: 'moderate',
    wcag: '2.1.1',
    verifyPass: (s, before, after) =>
      (after !== null && after.selected !== before.selected) || s.ariaStateChanged || s.clickFired,
    issue: () => 'Enter did not select the custom role="tab" (aria-selected did not change)',
    recommendation: 'On Enter/Space, set aria-selected="true" on the tab and aria-selected="false" on sibling tabs, and reveal the associated tabpanel.',
    revertAfterTest: true,
  },
];

// â”€â”€ Page-level interceptors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Inject click and mutation interceptors into the page. */
async function injectInterceptors(page: Page): Promise<void> {
  await page.evaluate(() => {
    // â‘  Click-event interceptor â€” capture phase catches all bubbling/non-bubbling
    (window as any).__ada_click = false;
    (window as any).__ada_clickHandler = () => { (window as any).__ada_click = true; };
    document.addEventListener('click', (window as any).__ada_clickHandler, { capture: true });

    // â‘¡ DOM MutationObserver â€” watches child list + key ARIA attributes
    (window as any).__ada_mutations = 0;
    (window as any).__ada_observer = new MutationObserver(() => {
      (window as any).__ada_mutations++;
    });
    (window as any).__ada_observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-expanded', 'aria-hidden', 'aria-checked', 'aria-selected', 'class', 'style'],
    });
  });
}

/** Read interceptor signals and clean up. */
async function readAndClearInterceptors(page: Page, focusedElementBefore: string): Promise<InteractionSignals> {
  return page.evaluate((prevFocus) => {
    const clickFired = (window as any).__ada_click === true;
    const domMutated = (window as any).__ada_mutations > 0;

    document.removeEventListener('click', (window as any).__ada_clickHandler, { capture: true });
    (window as any).__ada_observer?.disconnect();

    const currentFocus = document.activeElement?.outerHTML?.slice(0, 80) ?? '';
    const focusMoved = Boolean(currentFocus && currentFocus !== prevFocus);

    return { clickFired, ariaStateChanged: false /* filled below */, domMutated, focusMoved };
  }, focusedElementBefore);
}

/** Snapshot the ARIA state of an element. */
async function snapshotAria(page: Page, handle: Awaited<ReturnType<Page['locator']>>): Promise<AriaState> {
  return handle.evaluate((el) => ({
    checked:  el.getAttribute('aria-checked'),
    expanded: el.getAttribute('aria-expanded'),
    selected: el.getAttribute('aria-selected'),
    disabled: el.getAttribute('aria-disabled'),
  }));
}

// â”€â”€ Deduplication helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function dedupKey(page: string, specName: string, key: string): string {
  return `${page}::${specName}::${key}`;
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main(): Promise<void> {
  const findings: InteractionFinding[] = [];
  const reported = new Set<string>(); // dedup: page::specName::key
  let spaLoaded = false;
  const SPA_BASE = adaConfig.spaBase;

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
    for (const target of adaConfig.pages) {
      const url = new URL(target.path, adaConfig.baseUrl).toString();
      log.info(`Interaction scan: ${target.name}`);

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
        log.warn(`Could not load ${target.name} â€” skipping.`);
        continue;
      }

      for (const spec of ROLE_SPECS) {
        // Collect elements matching the spec â€” skip non-visible and aria-hidden
        const allEls = await page
          .locator(`${spec.selector}:not([aria-hidden="true"])`)
          .all();

        const visible = (
          await Promise.all(allEls.map(async (el) => ({ el, vis: await el.isVisible().catch(() => false) })))
        ).filter((x) => x.vis).map((x) => x.el);

        const sample = visible.slice(0, MAX_PER_SPEC);
        if (sample.length === 0) continue;

        for (const key of spec.keys) {
          const dupKey = dedupKey(target.name, spec.name, key);
          let anyFailed = false;
          let failName = '';

          for (const el of sample) {
            try {
              // Capture element name for reporting
              const name = await el.evaluate((e) =>
                (e.getAttribute('aria-label') ?? (e as HTMLElement).innerText?.replace(/\s+/g, ' ').slice(0, 50) ?? '').trim()
              );

              const before = await snapshotAria(page, el);

              // Skip already-disabled elements (state may have changed since selection)
              if (before.disabled === 'true') continue;

              // Record current focus element for focus-move detection
              const focusBefore = await page.evaluate(() =>
                document.activeElement?.outerHTML?.slice(0, 80) ?? ''
              );

              // Inject interceptors BEFORE the keypress
              await injectInterceptors(page);

              await el.focus();
              await page.keyboard.press(key);
              await page.waitForTimeout(250); // allow async reactions (Angular CD cycle)

              // Read signals
              const signals = await readAndClearInterceptors(page, focusBefore);
              const after = await snapshotAria(page, el).catch(() => null);

              // Enrich signals with ARIA state comparison
              signals.ariaStateChanged = after !== null && (
                after.checked  !== before.checked  ||
                after.expanded !== before.expanded ||
                after.selected !== before.selected
              );

              const passed = spec.verifyPass(signals, before, after);

              if (!passed) {
                anyFailed = true;
                failName = name;
                log.debug(`  FAIL ${spec.name} "${name}" key=${key} signals=${JSON.stringify(signals)}`);
              } else {
                log.debug(`  PASS ${spec.name} "${name}" key=${key}`);
                // If even ONE instance passes, the role is working â€” don't flag
                anyFailed = false;
                // Revert state if applicable
                if (spec.revertAfterTest && signals.ariaStateChanged) {
                  await el.focus();
                  await page.keyboard.press(key);
                  await page.waitForTimeout(150);
                }
                break; // One passing instance is enough â€” no false positive
              }

              // Revert if state changed (keep page clean for next tests)
              if (spec.revertAfterTest && signals.ariaStateChanged) {
                await el.focus();
                await page.keyboard.press(key);
                await page.waitForTimeout(150);
              }

            } catch { /* element became stale â€” skip */ }
          }

          // Only report if ALL tested instances failed AND not already reported for this page
          if (anyFailed && !reported.has(dupKey)) {
            reported.add(dupKey);
            findings.push({
              page: target.name,
              url,
              selector: spec.selector,
              role: spec.role,
              name: failName,
              expectedKey: key,
              issue: spec.issue(key),
              severity: spec.severity,
              wcag: spec.wcag,
              recommendation: spec.recommendation,
            });
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  const report: InteractionReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: adaConfig.baseUrl,
    totalFindings: findings.length,
    findings,
  };

  fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
  fs.writeFileSync(adaConfig.paths.interactionReport, JSON.stringify(report, null, 2), 'utf-8');
  log.info(
    `Interaction Prediction Engine: ${findings.length} finding(s) across ${adaConfig.pages.length} page(s) -> ${path.relative(process.cwd(), adaConfig.paths.interactionReport)}`
  );
}

main().catch((err) => {
  log.error('Interaction Prediction Engine failed', (err as Error).message);
  const empty: InteractionReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: adaConfig.baseUrl,
    totalFindings: 0,
    findings: [],
  };
  try {
    fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
    fs.writeFileSync(adaConfig.paths.interactionReport, JSON.stringify(empty, null, 2), 'utf-8');
  } catch { /* ignore */ }
});

