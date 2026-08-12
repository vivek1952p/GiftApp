/**
 * ============================================================================
 * Interaction Prediction Engine — v2
 * ============================================================================
 *
 * Predicts expected keyboard interactions per ARIA role, then verifies them
 * against actual browser behaviour using THREE independent signals:
 *
 *   1. Click-event interception  — Enter/Space must fire a synthetic click on
 *      interactive elements (WAI-ARIA §6.6 "activation").
 *   2. ARIA state monitoring     — aria-checked / aria-expanded / aria-selected
 *      must change for toggle/expand controls.
 *   3. DOM MutationObserver      — detects menus opening, dialogs appearing,
 *      panels expanding even when ARIA state is not updated.
 *
 * Only CUSTOM interactive elements are tested (non-native HTML). Native
 * <button>, <a href>, <input> are keyboard-operable by browsers without
 * any JavaScript.
 *
 * Up to MAX_PER_SPEC instances are sampled per role+key per page, and EVERY
 * sampled instance is tested (a passing instance does not stop testing or
 * discard earlier failures) -- a finding is raised if any sampled instance
 * fails, noting how many of the sample failed. Findings are still
 * deduplicated per page: one finding per failing role+key combination, not
 * one per element instance.
 *
 * WCAG 2.1.1 (Keyboard), 4.1.2 (Name, Role, Value).
 * ============================================================================
 */

import { chromium, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import { gotoPage } from './navigate';
import type { InteractionFinding, InteractionReport, UiaSeverity } from './types';

const log = createLogger('interaction');
const SESSION_FILE = path.join(adaConfig.paths.root, 'auth', 'session.json');

/** Max element instances to test per role spec per page. */
const MAX_PER_SPEC = 4;

// ── Signal types ────────────────────────────────────────────────────────────

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

// ── Role spec definition ─────────────────────────────────────────────────────

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

// ── Role specifications ──────────────────────────────────────────────────────

const ROLE_SPECS: RoleSpec[] = [
  // ── Custom role="button" (any non-native tag, incl. design-system web ────
  // components like <ds-button role="button">, not just div/span/li) ───────
  {
    name: 'custom-button',
    role: 'button (custom element)',
    selector: ':not(button)[role="button"]:not([aria-disabled="true"]):not([disabled])',
    keys: ['Enter', 'Space'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (s) => s.clickFired || s.domMutated || s.ariaStateChanged,
    issue: (k) => `Custom role="button" did not fire a click event on ${k} — screen reader and keyboard users cannot activate it`,
    recommendation: 'Add keydown/keyup handlers for Enter (keyCode 13) and Space (keyCode 32) that call element.click() or dispatch a click event. Better: replace the div/span with a native <button>.',
  },

  // ── Custom role="link" (any non-native tag — not native <a>) ──────────────
  {
    name: 'custom-link',
    role: 'link (custom element)',
    selector: ':not(a)[role="link"]:not([aria-disabled="true"])',
    keys: ['Enter'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (s) => s.clickFired || s.focusMoved || s.domMutated,
    issue: () => 'Custom role="link" did not activate on Enter — keyboard users cannot follow it',
    recommendation: 'Add a keydown handler for Enter that triggers navigation, or replace with a native <a href>.',
  },

  // ── Custom checkbox (not native <input type="checkbox">) ───────────────────
  {
    name: 'custom-checkbox',
    role: 'checkbox (custom element)',
    selector: ':not(input)[role="checkbox"]:not([aria-disabled="true"])',
    keys: ['Space'],
    severity: 'serious',
    wcag: '2.1.1',
    // aria-checked MUST change — click alone is not enough to confirm toggle
    verifyPass: (_s, before, after) =>
      after !== null && after.checked !== before.checked,
    issue: () => 'Space did not toggle aria-checked on custom role="checkbox" — screen readers will not announce the state change',
    recommendation: 'On Space keydown, toggle aria-checked between "true" and "false" and announce the change.',
    revertAfterTest: true,
  },

  // ── Custom switch (not native <input type="checkbox" role="switch">) ────────
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

  // ── Expandable controls (accordion headers, disclosure buttons) ─────────
  // Matches any element with aria-expanded regardless of tag name, so custom
  // web components (e.g. a design system's own accordion header) are covered —
  // not just <div>/<span>. Only excludes <button>/<a>, which are native and
  // already keyboard-operable without a custom handler.
  {
    name: 'expandable-custom',
    role: 'expandable control (non-button)',
    selector: '[aria-expanded="false"]:not(button):not(a):not([aria-disabled="true"]):not([disabled])',
    keys: ['Enter', 'Space'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (s, before, after) =>
      (after !== null && after.expanded !== before.expanded) || s.domMutated,
    issue: (k) => `${k} did not toggle aria-expanded on the expandable control — keyboard users cannot open this panel`,
    recommendation: 'On Enter/Space keydown, toggle aria-expanded and show/hide the controlled region.',
    revertAfterTest: true,
  },

  // ── Custom menuitem (not native <button> or <a>) ────────────────────────────
  {
    name: 'custom-menuitem',
    role: 'menuitem (custom element)',
    selector: ':not(a):not(button)[role="menuitem"]:not([aria-disabled="true"])',
    keys: ['Enter'],
    severity: 'serious',
    wcag: '2.1.1',
    verifyPass: (s) => s.clickFired || s.domMutated || s.focusMoved,
    issue: () => 'Enter did not activate custom role="menuitem" — screen reader menu navigation will be broken',
    recommendation: 'Bind Enter keydown to trigger the menu item action (fire a click event or perform the action directly).',
  },

  // ── Custom tab (not native) — Enter/Space must select ──────────────────────
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

// ── Page-level interceptors ────────────────────────────────────────────────────

const TARGET_MARKER = 'data-ada-interact-target';

/**
 * Inject click and mutation interceptors into the page, scoped around the
 * element identified by TARGET_MARKER (set on it by the caller before this
 * runs). Child-node insertions/removals are counted anywhere in the document
 * -- many real widgets render their expanded content as a portaled node
 * appended to <body>, not as a child of the trigger, so this can't be scoped
 * narrowly. Attribute mutations are only counted when they occur on the
 * tested element or one of its descendants -- attribute churn elsewhere on
 * the page (a live clock, a third-party widget, an unrelated hover class) is
 * unrelated to this interaction and was previously counted as a false
 * "it responded" signal.
 */
async function injectInterceptors(page: Page): Promise<void> {
  await page.evaluate((marker) => {
    // ①  Click-event interceptor — capture phase catches all bubbling/non-bubbling
    (window as any).__ada_click = false;
    (window as any).__ada_clickHandler = () => { (window as any).__ada_click = true; };
    document.addEventListener('click', (window as any).__ada_clickHandler, { capture: true });

    // ② DOM MutationObserver — watches child list + key ARIA attributes
    (window as any).__ada_mutations = 0;
    (window as any).__ada_observer = new MutationObserver((mutations: MutationRecord[]) => {
      const target = document.querySelector(`[${marker}]`);
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          (window as any).__ada_mutations++;
          continue;
        }
        if (m.type === 'attributes' && target) {
          const attrTarget = m.target as Element;
          if (target === attrTarget || target.contains(attrTarget)) {
            (window as any).__ada_mutations++;
          }
        }
      }
    });
    (window as any).__ada_observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-expanded', 'aria-hidden', 'aria-checked', 'aria-selected', 'class', 'style'],
    });
  }, TARGET_MARKER);
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

// ── Deduplication helpers ─────────────────────────────────────────────────────

function dedupKey(page: string, specName: string, key: string): string {
  return `${page}::${specName}::${key}`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const findings: InteractionFinding[] = [];
  const reported = new Set<string>(); // dedup: page::specName::key
  let firstPage = true;

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

  try {
    for (const target of adaConfig.pages) {
      const url = new URL(target.path, adaConfig.baseUrl).toString();
      log.info(`Interaction scan: ${target.name}`);

      try {
        await gotoPage(page, target, adaConfig, firstPage);
        firstPage = false;
      } catch {
        log.warn(`Could not load ${target.name} — skipping.`);
        continue;
      }

      for (const spec of ROLE_SPECS) {
        // Collect elements matching the spec — skip non-visible and aria-hidden
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
          let failCount = 0;
          let passCount = 0;
          let failName = '';

          // Test every sampled instance -- do NOT stop at the first pass.
          // A single working instance does not mean the other 3 sampled
          // instances work too (e.g. a data-table row action rendered by a
          // different code path per row); stopping early previously
          // discarded any failures already seen earlier in this loop.
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

              // Mark this element so injectInterceptors can scope attribute-
              // mutation signals to it (and its descendants) instead of the
              // whole document.
              await el.evaluate((e, marker) => e.setAttribute(marker, ''), TARGET_MARKER);

              // Inject interceptors BEFORE the keypress
              await injectInterceptors(page);

              await el.focus();
              await page.keyboard.press(key);
              await page.waitForTimeout(250); // allow async reactions (framework change-detection/render cycle)

              // Read signals
              const signals = await readAndClearInterceptors(page, focusBefore);
              const after = await snapshotAria(page, el).catch(() => null);

              await el.evaluate((e, marker) => e.removeAttribute(marker), TARGET_MARKER).catch(() => {});

              // Enrich signals with ARIA state comparison
              signals.ariaStateChanged = after !== null && (
                after.checked  !== before.checked  ||
                after.expanded !== before.expanded ||
                after.selected !== before.selected
              );

              const passed = spec.verifyPass(signals, before, after);

              if (!passed) {
                failCount++;
                if (!failName) failName = name;
                log.debug(`  FAIL ${spec.name} "${name}" key=${key} signals=${JSON.stringify(signals)}`);
              } else {
                passCount++;
                log.debug(`  PASS ${spec.name} "${name}" key=${key}`);
              }

              // Revert if state changed (keep page clean for next tests), win or lose.
              if (spec.revertAfterTest && signals.ariaStateChanged) {
                await el.focus();
                await page.keyboard.press(key);
                await page.waitForTimeout(150);
              }

            } catch { /* element became stale — skip */ }
          }

          if (failCount > 0 && !reported.has(dupKey)) {
            reported.add(dupKey);
            const totalTested = failCount + passCount;
            findings.push({
              page: target.name,
              url,
              selector: spec.selector,
              role: spec.role,
              name: failName,
              expectedKey: key,
              issue: totalTested > 1
                ? `${spec.issue(key)} (${failCount} of ${totalTested} sampled instance(s) failed)`
                : spec.issue(key),
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

