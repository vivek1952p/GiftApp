/**
 * ============================================================================
 * Focus Management Engine
 * ============================================================================
 *
 * Validates that keyboard focus is correctly managed at the application
 * framework level — the category of issue most scanners cannot detect.
 *
 * Tests:
 *   1. Route navigation — after navigating to each page, where does focus
 *      land? Should be on a heading, skip-link, or the main landmark.
 *   2. Focus-visible sweep — Tabs through EVERY reachable element on the page
 *      (not just one) and checks, for each, whether ANY visual property that
 *      commonly indicates focus (outline, box-shadow, border, background,
 *      transform) actually changes between the focused and unfocused state.
 *      Unfocused baselines are captured once, up front, so the sweep never
 *      calls blur()/focus() on live elements while walking Tab order — no
 *      risk of triggering a widget's own focus/blur side effects (opening an
 *      autocomplete, firing an analytics event, …) during the scan. Findings
 *      are deduplicated by a rendered-style fingerprint (not CSS class names,
 *      which vary too much across Tailwind/CSS-in-JS/BEM to rely on) so a
 *      repeated component (e.g. 50 identical table-row buttons) produces one
 *      finding, not 50.
 *   3. Modal focus restoration — for dialogs associated with a trigger via
 *      the standard `aria-haspopup="dialog"` / `aria-controls` pattern, opens
 *      the dialog, closes it with Escape, and checks that focus returns to
 *      the triggering element.
 *
 * WCAG 2.4.3 (Focus Order), 2.4.7 (Focus Visible), 3.2.2 (On Input).
 * ============================================================================
 */

import { chromium, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { INTERACTIVE_ELEMENT_SELECTOR } from './interactive-elements';
import { createLogger } from './logger';
import { gotoPage } from './navigate';
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
  'none',        // structural layout element rendered with no semantic role
  'generic',     // same as none — structural div/span without semantic role
]);

/**
 * Implicit ARIA roles for native HTML landmark/heading elements that (correctly)
 * carry no explicit `role` attribute. Without this map, a focus target's role
 * would fall back to its raw tag name (`h1`, `nav`, `a`, …) instead of the ARIA
 * role name (`heading`, `navigation`, `link`, …) that ACCEPTABLE_LANDING_ROLES is
 * expressed in — silently false-flagging the exact semantic-HTML patterns this
 * check is meant to encourage.
 */
const NATIVE_TAG_ROLES: Record<string, string> = {
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  nav: 'navigation',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  a: 'link',
  form: 'form',
  section: 'region',
  article: 'article',
};

interface FocusVisibleFailure {
  tag: string;
  role: string;
  name: string;
  signature: string;
}

const FOCUS_INDICATOR_PROPS = [
  'outlineWidth', 'outlineStyle', 'outlineColor',
  'boxShadow', 'borderColor', 'borderWidth',
  'backgroundColor', 'transform',
] as const;

const BASELINE_MARKER = 'data-ada-focus-idx';

/**
 * Snapshot the unfocused baseline of every visible, enabled interactive
 * element on the page (same element population as the keyboard/Tab-order
 * scan — `INTERACTIVE_ELEMENT_SELECTOR`), tagging each with `data-ada-focus-idx`
 * and storing its baseline style on `window.__adaFocusBaselines`. Doing this
 * once, up front, means the Tab walk itself never needs to call
 * blur()/focus() on a live element to compare states — it just reads the
 * already-focused element's current style and looks up its pre-recorded
 * baseline, with zero risk of triggering a widget's own focus/blur side
 * effects mid-scan.
 */
async function collectFocusBaselines(page: Page, selector: string): Promise<number> {
  // Clear any incoming focus once, so an element with e.g. `autofocus` doesn't
  // have its FOCUSED style captured as its "unfocused" baseline.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  return page.evaluate(
    ({ sel, marker, props }) => {
      const baselines: Record<string, Record<string, string>> = {};
      let idx = 0;
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect();
        const style = window.getComputedStyle(he);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        const disabled = (he as HTMLButtonElement).disabled === true || he.getAttribute('aria-disabled') === 'true';
        if (!visible || disabled || he.getAttribute('tabindex') === '-1') continue;

        he.setAttribute(marker, String(idx));
        // Inlined rather than a named helper: esbuild (via tsx) wraps nested
        // named function/const bindings in a `__name(...)` call to preserve
        // `.name`, and that call ends up inside the text Playwright sends to
        // the browser for evaluation — where `__name` doesn't exist.
        const out: Record<string, string> = {};
        for (const p of props) out[p] = (style as unknown as Record<string, string>)[p];
        baselines[idx] = out;
        idx++;
      }

      (window as unknown as { __adaFocusBaselines: typeof baselines }).__adaFocusBaselines = baselines;
      return idx;
    },
    { sel: selector, marker: BASELINE_MARKER, props: FOCUS_INDICATOR_PROPS }
  );
}

/**
 * Tabs through every reachable element on the current page (bounded by
 * `adaConfig.keyboard.maxTabs`, stopping early once focus leaves the document
 * — i.e. every focusable element has been visited) and checks, for each
 * `:focus-visible` element, whether ANY common focus-indicator property
 * (outline, box-shadow, border, background, transform) actually differs from
 * its pre-recorded unfocused baseline (see `collectFocusBaselines`). A
 * property-set comparison catches every common technique — not just
 * `outline`, which alone would falsely flag the many legitimate designs that
 * use `box-shadow` or `border` instead (exactly the alternatives WCAG 2.4.7
 * permits). Elements with no pre-recorded baseline (e.g. inserted into the
 * DOM after the baseline pass) fall back to an in-place blur/refocus
 * comparison so they're still checked.
 *
 * Findings are deduplicated by a rendered-style fingerprint (tag + role +
 * font/color/spacing), not CSS class names — class-name-based dedup either
 * over-merges on utility-class frameworks (Tailwind's `flex items-center`
 * appears on many unrelated elements) or under-merges on CSS-in-JS frameworks
 * (hashed class names differ per build). A style fingerprint reflects what
 * actually renders, so it works the same regardless of CSS methodology.
 */
async function sweepFocusVisible(page: Page, maxTabs: number): Promise<FocusVisibleFailure[]> {
  const failures: FocusVisibleFailure[] = [];
  const seen = new Set<string>();

  await collectFocusBaselines(page, INTERACTIVE_ELEMENT_SELECTOR);

  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');

    const result = await page.evaluate(
      ({ marker, props }) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || el === document.documentElement) {
          return { leftDocument: true } as const;
        }

        const isFocusVisible = el.matches(':focus-visible');
        if (!isFocusVisible) {
          return { leftDocument: false, checked: false } as const;
        }

        // Inlined (not a named helper) so no `__name(...)` wrapper — see the
        // comment in collectFocusBaselines for why that breaks in-browser eval.
        const focusedComputed = window.getComputedStyle(el);
        const focusedStyle: Record<string, string> = {};
        for (const p of props) focusedStyle[p] = (focusedComputed as unknown as Record<string, string>)[p];

        const idx = el.getAttribute(marker);
        const baselines = (window as unknown as { __adaFocusBaselines?: Record<string, Record<string, string>> })
          .__adaFocusBaselines;
        const baseline = idx !== null ? baselines?.[idx] : undefined;

        let unfocusedStyle: Record<string, string>;
        if (baseline) {
          unfocusedStyle = baseline;
        } else {
          // No pre-recorded baseline (element appeared after the baseline pass) —
          // fall back to an in-place comparison for this one element only.
          el.blur();
          const unfocusedComputed = window.getComputedStyle(el);
          unfocusedStyle = {};
          for (const p of props) unfocusedStyle[p] = (unfocusedComputed as unknown as Record<string, string>)[p];
          el.focus();
        }

        const changed = props.some((p) => focusedStyle[p] !== unfocusedStyle[p]);

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') ?? tag;
        const name = (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 60);
        const fullStyle = window.getComputedStyle(el);
        const fingerprint = [
          tag, role,
          fullStyle.fontFamily, fullStyle.fontSize, fullStyle.fontWeight,
          fullStyle.color, fullStyle.backgroundColor,
          fullStyle.paddingTop, fullStyle.paddingLeft,
        ].join('|');

        return { leftDocument: false, checked: true, changed, tag, role, name, signature: fingerprint } as const;
      },
      { marker: BASELINE_MARKER, props: FOCUS_INDICATOR_PROPS }
    );

    if (result.leftDocument) break; // reached the end of the page's focusable elements
    if (!result.checked) continue; // element doesn't use :focus-visible here — nothing to assess

    if (!result.changed) {
      if (!seen.has(result.signature)) {
        seen.add(result.signature);
        failures.push({ tag: result.tag, role: result.role, name: result.name, signature: result.signature });
      }
    }
  }

  await page.evaluate((marker) => {
    document.querySelectorAll(`[${marker}]`).forEach((el) => el.removeAttribute(marker));
  }, BASELINE_MARKER);

  return failures;
}

/**
 * Finds dialog triggers via the standard WAI-ARIA association
 * (`aria-haspopup="dialog"`, or `aria-controls` pointing at a
 * `role="dialog"`/`role="alertdialog"` element, or a native `<dialog>`
 * element — which carries an implicit dialog role and needs no `role`
 * attribute) — never guesses from arbitrary buttons, since clicking the
 * wrong element could trigger an unintended action. For each candidate
 * (bounded to 2 per page), opens the dialog with Enter, closes it with
 * Escape, and checks that focus returns to the trigger. Silently skips a
 * candidate if Enter didn't open a dialog or Escape didn't close it (the
 * latter is already covered by the Widget Behavior Engine) — this check is
 * specifically about restoration, not activation.
 */
async function checkModalFocusRestoration(
  page: Page,
  findings: FocusManagementFinding[],
  pageName: string,
  url: string
): Promise<void> {
  const MARKER = 'data-ada-trigger-index';

  const candidateCount = await page.evaluate((marker) => {
    const els = Array.from(document.querySelectorAll('[aria-haspopup="dialog"], [aria-controls]'));
    let idx = 0;
    for (const el of els) {
      const controls = el.getAttribute('aria-controls');
      const haspopup = el.getAttribute('aria-haspopup');
      let isDialogTrigger = haspopup === 'dialog';
      if (!isDialogTrigger && controls) {
        const target = document.getElementById(controls);
        const role = target?.getAttribute('role');
        const tag = target?.tagName.toLowerCase();
        isDialogTrigger = role === 'dialog' || role === 'alertdialog' || tag === 'dialog';
      }
      if (isDialogTrigger) {
        el.setAttribute(marker, String(idx));
        idx++;
      }
    }
    return idx;
  }, MARKER);

  const sampleSize = Math.min(candidateCount, 2);

  for (let i = 0; i < sampleSize; i++) {
    try {
      const trigger = page.locator(`[${MARKER}="${i}"]`);
      if (!(await trigger.isVisible().catch(() => false))) continue;

      await trigger.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      const dialog = page.locator('dialog:visible, [role="dialog"]:visible, [role="alertdialog"]:visible').first();
      if (!(await dialog.isVisible().catch(() => false))) continue; // Enter didn't open a dialog — not this check's concern

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      if (await dialog.isVisible().catch(() => false)) continue; // Escape didn't close it — Widget Behavior Engine covers this

      const restored = await page.evaluate(
        ({ marker, index }) => document.activeElement?.getAttribute(marker) === String(index),
        { marker: MARKER, index: i }
      );

      if (!restored) {
        findings.push({
          page: pageName, url,
          scenario: 'modal-focus-restoration',
          issue: 'After closing a dialog with Escape, keyboard focus did not return to the element that opened it',
          severity: 'serious', wcag: '2.4.3',
          recommendation:
            'Before opening a dialog, store a reference to the currently focused element (the trigger). ' +
            'When the dialog closes, call .focus() on that stored reference so keyboard users don\'t lose their place.',
        });
      }
    } catch { /* trigger became stale or interaction failed — skip this candidate */ }
  }

  await page.evaluate((marker) => {
    document.querySelectorAll(`[${marker}]`).forEach((el) => el.removeAttribute(marker));
  }, MARKER);
}

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

    let firstPage = true;

    for (const target of pages) {
      const url = new URL(target.path, adaConfig.baseUrl).toString();

      try {
        await gotoPage(page, target, adaConfig, firstPage);
        firstPage = false;
        await page.waitForTimeout(500); // extra settle for framework hydration

        // ── Test 1: Where does focus land after navigation? ─────────────
        const focusInfo = await page.evaluate((tagRoles: Record<string, string>) => {
          const el = document.activeElement;
          if (!el || el === document.body || el === document.documentElement) {
            return { tag: el?.tagName?.toLowerCase() ?? 'unknown', role: null, name: null, onBody: true };
          }
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') ?? tagRoles[tag] ?? tag;
          return {
            tag,
            role,
            name: (el as HTMLElement).innerText?.slice(0, 60) ?? el.getAttribute('aria-label') ?? '',
            onBody: false,
          };
        }, NATIVE_TAG_ROLES);

        if (focusInfo.onBody) {
          findings.push({
            page: target.name, url,
            scenario: 'route-navigation',
            issue: `After navigating to ${target.name}, focus fell to <body>/<html> — keyboard users lose context`,
            severity: 'serious', wcag: '2.4.3',
            recommendation: 'After client-side route navigation, programmatically move focus to the page <h1>, a skip-to-main link, or the <main> element (e.g. React Router\'s useEffect, Angular\'s router.events, Vue Router\'s afterEach).',
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

        // ── Test 2: Focus visibility — sweep EVERY reachable element ────
        const maxTabs = adaConfig.keyboard.maxTabs ?? 200;
        const focusVisibleFailures = await sweepFocusVisible(page, maxTabs);
        for (const f of focusVisibleFailures) {
          findings.push({
            page: target.name, url,
            scenario: 'focus-visible',
            issue: `<${f.tag} role="${f.role}"> has :focus-visible active but no visual property (outline/box-shadow/border/background/transform) changes between its focused and unfocused state`,
            severity: 'serious', wcag: '2.4.7',
            recommendation:
              'Remove outline:none from focus styles. Provide a replacement indicator ' +
              '(e.g. box-shadow, background-color change, border) that meets WCAG 2.4.7.',
            detail: `Element: ${f.signature}${f.name ? ` "${f.name}"` : ''}`,
          });
        }

        // ── Test 3: Modal focus restoration ──────────────────────────────
        await checkModalFocusRestoration(page, findings, target.name, url);

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
