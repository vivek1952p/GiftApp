/**
 * ============================================================================
 * ADA Harness — Playwright Accessibility Spec (Steps 1 & 3)
 * ============================================================================
 *
 * This single Playwright test drives THREE of the four accessibility
 * technologies:
 *
 *   1. Playwright  — browser automation: launch, (optional) login, navigate
 *      every configured route, capture screenshots.
 *   2. axe-core    — WCAG 2.1 AA validation on each page -> axe-report.json.
 *   3. Playwright Accessibility Snapshot — capture the browser accessibility
 *      tree (roles, accessible names, hierarchy, focusability) for each page
 *      -> playwright-accessibility-tree.json.
 *
 * (Windows UI Automation — technology 4 — runs in a separate stage,
 * scripts/uia-scan.ts, because it must attach to a real Windows browser
 * window.)
 *
 * The test intentionally does NOT fail on violations — the harness treats
 * reporting / fixing as separate stages, and failing here would abort the
 * pipeline before summaries and the merged report are produced.
 * ============================================================================
 */

import { test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import path from 'path';
import { adaConfig } from './config';
import { INTERACTIVE_ELEMENT_SELECTOR } from '../scripts/interactive-elements';
import type {
  AxeReport,
  AxePageResult,
  AxeViolation,
  A11yTreeNode,
  A11yPageTree,
  PlaywrightA11yReport,
  DomElementStyle,
  DomPageSnapshot,
  DomSnapshotReport,
  KeyboardStep,
  KeyboardInteractive,
  KeyboardFinding,
  KeyboardPageResult,
  KeyboardReport,
} from '../scripts/types';

/** Ensure a directory exists before we attempt to write into it. */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Convert a page name into a filesystem-safe screenshot filename. */
function screenshotName(pageName: string): string {
  return (
    pageName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'page'
  );
}

/** Recursively count the nodes in an accessibility tree. */
function countA11yNodes(node: A11yTreeNode | null): number {
  if (!node) return 0;
  const children = (node.children ?? []) as A11yTreeNode[];
  return 1 + children.reduce((sum, child) => sum + countA11yNodes(child), 0);
}

/**
 * Capture the browser accessibility tree (Technology 3).
 *
 * Playwright removed the legacy `page.accessibility.snapshot()` API, so we use
 * the Chrome DevTools Protocol `Accessibility.getFullAXTree` (Chromium) and
 * rebuild the hierarchy of roles / accessible names / values. On non-Chromium
 * engines CDP is unavailable, so the tree is recorded as null (the axe scan and
 * UIA capture still run).
 */
async function captureA11yTree(page: Page): Promise<{ tree: A11yTreeNode | null; nodeCount: number }> {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Accessibility.enable');
    const { nodes } = (await client.send('Accessibility.getFullAXTree')) as {
      nodes: Array<{
        nodeId: string;
        role?: { value?: string };
        name?: { value?: string };
        value?: { value?: string };
        description?: { value?: string };
        childIds?: string[];
      }>;
    };
    await client.detach().catch(() => undefined);

    if (!nodes || nodes.length === 0) return { tree: null, nodeCount: 0 };

    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const build = (id: string): A11yTreeNode => {
      const n = byId.get(id);
      const node: A11yTreeNode = {
        role: n?.role?.value,
        name: n?.name?.value,
        value: n?.value?.value,
        description: n?.description?.value,
        children: [],
      };
      for (const childId of n?.childIds ?? []) {
        if (byId.has(childId)) (node.children as A11yTreeNode[]).push(build(childId));
      }
      return node;
    };

    const root = build(nodes[0].nodeId);
    return { tree: root, nodeCount: countA11yNodes(root) };
  } catch (err) {
    console.error('[scan] Accessibility tree capture failed:', err);
    return { tree: null, nodeCount: 0 };
  }
}

/**
 * Capture the full DOM snapshot (Technology 5).
 *
 * Accessibility trees cannot expose visual facts such as colour or font size,
 * so rules like `color-contrast` cannot be verified there. This captures the
 * serialized DOM plus the computed styles (colour, background, font) of every
 * element referenced by an axe finding, so those findings can be verified
 * against the real DOM.
 *
 * @param page      The Playwright page to snapshot.
 * @param selectors CSS selectors of elements axe flagged (styles are captured for these).
 */
async function captureDom(
  page: Page,
  selectors: string[]
): Promise<{ html: string; nodeCount: number; elements: DomElementStyle[] }> {
  try {
    const html = adaConfig.dom.fullHtml ? await page.content() : '';
    const { nodeCount, elements } = await page.evaluate((sels: string[]) => {
      const total = document.getElementsByTagName('*').length;
      const out: Array<{
        target: string;
        color?: string;
        backgroundColor?: string;
        effectiveBackgroundColor?: string;
        fontSize?: string;
        fontWeight?: string;
        text?: string;
      }> = [];

      // Most text elements (span, p, li, …) never set their own background —
      // it's inherited visually from an ancestor. Reading only the element's
      // own computed backgroundColor gives "transparent" for the vast majority
      // of real-world markup, which makes contrast checks against it useless.
      // Walk up to <html>, alpha-composite every non-transparent background
      // found, over a white canvas default (the browser's own default) — this
      // is what actually renders behind the element.
      function effectiveBackground(el: Element): string {
        const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
        let current: Element | null = el;
        while (current) {
          const bg = window.getComputedStyle(current).backgroundColor;
          const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (m) {
            const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
            if (a > 0) layers.push({ r: +m[1], g: +m[2], b: +m[3], a });
          }
          current = current.parentElement;
        }
        // layers[0] = closest to the element (topmost), layers[end] = closest to <html>.
        // Composite from the outermost layer down to the innermost, over white.
        let r = 255,
          g = 255,
          b = 255;
        for (let i = layers.length - 1; i >= 0; i--) {
          const layer = layers[i];
          r = layer.r * layer.a + r * (1 - layer.a);
          g = layer.g * layer.a + g * (1 - layer.a);
          b = layer.b * layer.a + b * (1 - layer.a);
        }
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
      }

      const seen = new Set<string>();
      for (const sel of sels) {
        if (seen.has(sel)) continue;
        seen.add(sel);
        let el: Element | null = null;
        try {
          el = document.querySelector(sel);
        } catch {
          el = null;
        }
        if (!el) continue;
        const cs = window.getComputedStyle(el);
        out.push({
          target: sel,
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          effectiveBackgroundColor: effectiveBackground(el),
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          text: (el.textContent ?? '').trim().slice(0, 80),
        });
      }
      return { nodeCount: total, elements: out };
    }, selectors);
    return { html, nodeCount, elements };
  } catch (err) {
    console.error('[scan] DOM snapshot capture failed:', err);
    return { html: '', nodeCount: 0, elements: [] };
  }
}

/**
 * Perform the optional login flow exactly once. Credentials are read from the
 * environment variables named in config.json (never hardcoded). A failure here
 * is logged but does not abort the scan.
 */
async function maybeLogin(page: Page): Promise<void> {
  const login = adaConfig.login;
  if (!login.enabled) return;

  const username = process.env[login.usernameEnv] ?? '';
  const password = process.env[login.passwordEnv] ?? '';

  try {
    const loginUrl = new URL(login.loginPath, adaConfig.baseUrl).toString();
    console.log(`[login] Authenticating via ${loginUrl}`);
    // 'load' + a bounded settle wait, not 'networkidle' — apps with a
    // persistent websocket/SSE/polling connection (common post-login, e.g. a
    // live dashboard) never go network-idle, which would otherwise stall
    // every login attempt for the full navigation timeout.
    await page.goto(loginUrl, { waitUntil: 'load', timeout: adaConfig.timeouts.navigationMs });
    await page.fill(login.usernameSelector, username);
    await page.fill(login.passwordSelector, password);
    await page.click(login.submitSelector);
    if (login.waitForSelector) {
      await page.waitForSelector(login.waitForSelector, { timeout: adaConfig.timeouts.navigationMs });
    } else {
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(adaConfig.settleTimeoutMs);
    }
    console.log('[login] Login flow completed.');
  } catch (err) {
    console.error('[login] Login flow failed (continuing unauthenticated):', err);
  }
}

/**
 * Capture the keyboard / Tab-order traversal for a page (WCAG 2.1.1, 2.4.3).
 *
 * Simulates a keyboard-only user: tags every visible, enabled interactive
 * element, blurs focus, then presses Tab repeatedly and records which elements
 * actually receive focus. Interactive elements never reached by Tab are real
 * keyboard-access gaps that axe/UIA cannot detect on their own.
 */
async function captureKeyboard(
  page: Page,
  pageName: string,
  url: string,
  maxTabs: number
): Promise<KeyboardPageResult> {
  // 1. Tag every visible, enabled interactive element and collect descriptors.
  const interactive = (await page.evaluate((sel: string) => {
    const out: Array<{ index: number; tag: string; name: string; tabindex: string | null }> = [];
    let i = 0;
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const he = el as HTMLElement;
      const rect = he.getBoundingClientRect();
      const style = window.getComputedStyle(he);
      const visible =
        rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      const disabled =
        (he as HTMLButtonElement).disabled === true || he.getAttribute('aria-disabled') === 'true';
      const ti = he.getAttribute('tabindex');
      // Skip invisible/disabled and intentionally-removed (tabindex="-1") controls.
      if (!visible || disabled || ti === '-1') continue;
      he.setAttribute('data-ada-kb', String(i));
      const name = (he.getAttribute('aria-label') || he.textContent || he.getAttribute('name') || he.id || '')
        .trim()
        .slice(0, 60);
      out.push({ index: i, tag: he.tagName.toLowerCase(), name, tabindex: ti });
      i++;
    }
    return out;
  }, INTERACTIVE_ELEMENT_SELECTOR)) as KeyboardInteractive[];

  // 2. Start clean so the first Tab lands on the first tabbable element.
  await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && typeof a.blur === 'function') a.blur();
  });

  // 3. Press Tab repeatedly and record the actual focus order.
  // The bound must exceed the number of interactive elements (plus a buffer for
  // wrap-around) so we never report a false gap just because we ran out of Tabs.
  const limit = Math.min(3000, Math.max(maxTabs, interactive.length + 25));
  const tabOrder: KeyboardStep[] = [];
  const reached = new Set<string>();
  for (let n = 0; n < limit; n++) {
    await page.keyboard.press('Tab');
    const info = (await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body || a === document.documentElement) return null;
      return {
        kb: a.getAttribute ? a.getAttribute('data-ada-kb') : null,
        tag: a.tagName.toLowerCase(),
        name: ((a.getAttribute && a.getAttribute('aria-label')) || a.textContent || '').trim().slice(0, 60),
      };
    })) as { kb: string | null; tag: string; name: string } | null;

    if (!info) break; // focus left the document
    if (info.kb !== null && reached.has(info.kb)) break; // cycled back to the start
    tabOrder.push({ order: n + 1, tag: info.tag, name: info.name, kb: info.kb });
    if (info.kb !== null) reached.add(info.kb);
  }

  const unreachable = interactive.filter((e) => !reached.has(String(e.index)));
  const positiveTabindex = interactive.filter((e) => e.tabindex != null && Number(e.tabindex) > 0);

  return {
    page: pageName,
    url,
    timestamp: new Date().toISOString(),
    reached: reached.size,
    interactiveTotal: interactive.length,
    tabOrder,
    unreachable,
    positiveTabindex,
  };
}

/** Convert per-page keyboard results into flat WCAG findings. */
function buildKeyboardFindings(results: KeyboardPageResult[]): KeyboardFinding[] {
  const findings: KeyboardFinding[] = [];
  for (const r of results) {
    for (const el of r.unreachable) {
      findings.push({
        page: r.page,
        url: r.url,
        ruleId: 'keyboard-unreachable',
        issue: `Interactive <${el.tag}>${el.name ? ` "${el.name}"` : ''} cannot be reached with the Tab key`,
        severity: 'serious',
        wcag: '2.1.1',
        recommendation:
          'Make the control keyboard operable (native button/link, remove tabindex="-1", or add tabindex="0" with key handlers).',
        tag: el.tag,
        name: el.name,
      });
    }
    for (const el of r.positiveTabindex) {
      findings.push({
        page: r.page,
        url: r.url,
        ruleId: 'keyboard-positive-tabindex',
        issue: `<${el.tag}>${el.name ? ` "${el.name}"` : ''} uses a positive tabindex (${el.tabindex}) which disrupts natural tab order`,
        severity: 'moderate',
        wcag: '2.4.3',
        recommendation:
          'Remove the positive tabindex; rely on DOM order (use tabindex="0" only when needed).',
        tag: el.tag,
        name: el.name,
      });
    }
  }
  return findings;
}

test.describe('ADA Accessibility Scan', () => {
  // A single test scans every page so we control when the reports are flushed.
  test('scan all configured pages (axe-core + accessibility snapshot)', async ({ page }) => {
    ensureDir(adaConfig.paths.reportsDir);
    if (adaConfig.screenshots.enabled) ensureDir(adaConfig.paths.screenshotsDir);

    // Technology 1: optional authentication before scanning protected routes.
    await maybeLogin(page);

    const axeResults: AxePageResult[] = [];
    const a11yResults: A11yPageTree[] = [];
    const domResults: DomPageSnapshot[] = [];
    const keyboardResults: KeyboardPageResult[] = [];

    for (const target of adaConfig.pages) {
      const url = new URL(target.path, adaConfig.baseUrl).toString();
      console.log(`[scan] Visiting ${target.name} -> ${url}`);

      try {
        // Technology 1: navigate + wait for hydration. 'load', not
        // 'networkidle' — apps with a persistent websocket/SSE/polling
        // connection (live dashboards, chat widgets, notifications: common
        // in enterprise apps) never go network-idle, which would otherwise
        // stall every page for the full navigation timeout and silently
        // produce an empty report for it.
        await page.goto(url, { waitUntil: 'load', timeout: adaConfig.timeouts.navigationMs });
        await page.waitForTimeout(adaConfig.settleTimeoutMs);

        // Technology 1: capture a screenshot for the report (optional).
        let screenshotRel: string | undefined;
        if (adaConfig.screenshots.enabled) {
          const file = path.join(adaConfig.paths.screenshotsDir, `${screenshotName(target.name)}.png`);
          await page.screenshot({ path: file, fullPage: true });
          screenshotRel = path.relative(adaConfig.paths.reportsDir, file);
        }

        // Technology 2: run axe-core scoped to the configured WCAG tags,
        // disabling any project-approved rule exceptions.
        let axe = new AxeBuilder({ page }).withTags(adaConfig.wcagTags);
        if (adaConfig.ignoredRules.length) axe = axe.disableRules(adaConfig.ignoredRules);
        const scan = await axe.analyze();

        axeResults.push({
          page: target.name,
          url,
          timestamp: new Date().toISOString(),
          // Cast: axe's Result type is structurally compatible with ours.
          violations: scan.violations as unknown as AxeViolation[],
          passes: scan.passes.length,
          incomplete: scan.incomplete.length,
        });

        // Technology 3: capture the browser accessibility tree (via CDP).
        const { tree, nodeCount } = await captureA11yTree(page);
        a11yResults.push({
          page: target.name,
          url,
          timestamp: new Date().toISOString(),
          nodeCount,
          screenshot: screenshotRel,
          tree,
        });

        // Technology 5: capture the full DOM + computed styles for every
        // element axe flagged (so visual rules like colour-contrast can be
        // verified against real DOM properties during merge).
        let domNodeCount = 0;
        if (adaConfig.dom.enabled) {
          const targets = scan.violations.flatMap((v) =>
            v.nodes.flatMap((n) => (n.target ?? []).map((t) => String(t)))
          );
          const dom = await captureDom(page, targets);
          domNodeCount = dom.nodeCount;
          domResults.push({
            page: target.name,
            url,
            timestamp: new Date().toISOString(),
            nodeCount: dom.nodeCount,
            html: dom.html,
            elements: dom.elements,
          });
        }

        // Keyboard / Tab-order scan (WCAG 2.1.1): simulate a keyboard-only
        // user to find interactive controls that Tab cannot reach.
        let kbGaps = 0;
        if (adaConfig.keyboard.enabled) {
          const kb = await captureKeyboard(page, target.name, url, adaConfig.keyboard.maxTabs);
          kbGaps = kb.unreachable.length;
          keyboardResults.push(kb);
        }

        console.log(
          `[scan] ${target.name}: ${scan.violations.length} violation(s), ` +
            `${scan.passes.length} pass(es), a11y nodes: ${nodeCount}, DOM nodes: ${domNodeCount}, ` +
            `keyboard gaps: ${kbGaps}`
        );
      } catch (err) {
        // Never let one bad page abort the whole scan; record empty results.
        console.error(`[scan] Failed to scan ${target.name} (${url}):`, err);
        axeResults.push({
          page: target.name,
          url,
          timestamp: new Date().toISOString(),
          violations: [],
          passes: 0,
          incomplete: 0,
        });
        a11yResults.push({
          page: target.name,
          url,
          timestamp: new Date().toISOString(),
          nodeCount: 0,
          tree: null,
        });
        if (adaConfig.dom.enabled) {
          domResults.push({
            page: target.name,
            url,
            timestamp: new Date().toISOString(),
            nodeCount: 0,
            html: '',
            elements: [],
          });
        }
        if (adaConfig.keyboard.enabled) {
          keyboardResults.push({
            page: target.name,
            url,
            timestamp: new Date().toISOString(),
            reached: 0,
            interactiveTotal: 0,
            tabOrder: [],
            unreachable: [],
            positiveTabindex: [],
          });
        }
      }
    }

    // Step 1: persist the aggregated raw axe report.
    const axeReport: AxeReport = {
      generatedAt: new Date().toISOString(),
      baseUrl: adaConfig.baseUrl,
      results: axeResults,
    };
    fs.writeFileSync(adaConfig.paths.axeReport, JSON.stringify(axeReport, null, 2), 'utf-8');
    console.log(`[scan] axe report -> ${path.relative(process.cwd(), adaConfig.paths.axeReport)}`);

    // Step 3: persist the Playwright accessibility-tree report.
    const a11yReport: PlaywrightA11yReport = {
      generatedAt: new Date().toISOString(),
      baseUrl: adaConfig.baseUrl,
      results: a11yResults,
    };
    fs.writeFileSync(adaConfig.paths.a11yTree, JSON.stringify(a11yReport, null, 2), 'utf-8');
    console.log(`[scan] accessibility tree -> ${path.relative(process.cwd(), adaConfig.paths.a11yTree)}`);

    // Technology 5: persist the full DOM snapshot report.
    if (adaConfig.dom.enabled) {
      const domReport: DomSnapshotReport = {
        generatedAt: new Date().toISOString(),
        baseUrl: adaConfig.baseUrl,
        results: domResults,
      };
      fs.writeFileSync(adaConfig.paths.domSnapshot, JSON.stringify(domReport, null, 2), 'utf-8');
      console.log(`[scan] DOM snapshot -> ${path.relative(process.cwd(), adaConfig.paths.domSnapshot)}`);
    }

    // Keyboard scan: persist the Tab-order report + derived WCAG findings.
    if (adaConfig.keyboard.enabled) {
      const keyboardReport: KeyboardReport = {
        generatedAt: new Date().toISOString(),
        baseUrl: adaConfig.baseUrl,
        results: keyboardResults,
        findings: buildKeyboardFindings(keyboardResults),
      };
      fs.writeFileSync(adaConfig.paths.keyboardReport, JSON.stringify(keyboardReport, null, 2), 'utf-8');
      console.log(
        `[scan] keyboard report -> ${path.relative(process.cwd(), adaConfig.paths.keyboardReport)} ` +
          `(${keyboardReport.findings.length} finding(s))`
      );
    }
  });
});
