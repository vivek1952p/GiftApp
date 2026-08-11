/**
 * ============================================================================
 * Expected Focus Engine
 * ============================================================================
 *
 * Compares the elements that SHOULD receive keyboard focus (derived from the
 * browser accessibility tree) against the elements that ACTUALLY received
 * focus during the Tab-traversal scan (keyboard-report.json).
 *
 * Three checks:
 *   1. Tab-navigable AX nodes that were never reached by Tab
 *      â†’ only roles that belong in the natural Tab order (button, link,
 *        checkbox, combobox, textbox, â€¦). Roles that use arrow-key navigation
 *        inside composite widgets (option, menuitem, treeitem, gridcell, tab)
 *        are intentionally excluded â€” they do NOT belong in the Tab order.
 *   2. Elements in the Tab order with no accessible name
 *      â†’ screen reader users will hear "button" with no context.
 *   3. Elements using a positive tabindex (disrupts natural order)
 *      â†’ already in keyboard-report; surfaced here with a WCAG fix.
 *
 * Cross-page deduplication: if the same role+name gap appears on N pages
 * (shared component), it is reported once with an affected-pages count.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import type {
    A11yTreeNode,
    ExpectedFocusGap,
    ExpectedFocusReport,
    KeyboardPageResult,
    KeyboardReport,
    PlaywrightA11yReport,
} from './types';

const log = createLogger('expected-focus');

// â”€â”€ Role classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Roles that SHOULD appear in the natural Tab order.
 * Excludes roles that use arrow-key navigation WITHIN composite widgets
 * (option, menuitem, treeitem, gridcell, tab) â€” these must NOT be in Tab order.
 */
const TAB_NAVIGABLE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'combobox',   // the combobox trigger is Tab-navigable; its options are not
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
]);

/**
 * Composite widget container roles whose CHILDREN use arrow-key navigation
 * rather than Tab. Any element inside these must NOT be flagged as Tab-skipped.
 */
const COMPOSITE_CONTAINER_ROLES = new Set([
  'menu',
  'menubar',
  'listbox',
  'tree',
  'grid',
  'treegrid',
  'tablist',    // only the active/selected tab is in the Tab order
]);

// â”€â”€ Tree traversal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Collect nodes whose role is Tab-navigable, excluding children of composite
 * widget containers (those use arrow-key navigation, not Tab).
 *
 * @param node          Current AX tree node.
 * @param insideWidget  True when we are already inside a composite container.
 * @param out           Accumulator.
 */
function collectTabNavigable(
  node: A11yTreeNode | null,
  insideWidget = false,
  out: A11yTreeNode[] = []
): A11yTreeNode[] {
  if (!node) return out;

  const role = node.role ?? '';

  // Nodes inside composite widgets use arrow-key navigation â€” skip them.
  if (!insideWidget && TAB_NAVIGABLE_ROLES.has(role)) {
    // Only collect named elements: unnamed ones will be flagged by check #2.
    if ((node.name ?? '').trim()) out.push(node);
  }

  // Once inside a composite container, all descendants are arrow-navigated.
  const childInsideWidget = insideWidget || COMPOSITE_CONTAINER_ROLES.has(role);
  for (const child of (node.children ?? []) as A11yTreeNode[]) {
    collectTabNavigable(child, childInsideWidget, out);
  }
  return out;
}

// â”€â”€ Name matching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Normalise a name for comparison (lowercase, collapsed whitespace, max 60 chars). */
function norm(name: string | undefined | null): string {
  return (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Build a lookup from the keyboard tab order. Supports partial/substring
 * matching: if the AX tree name is a prefix of the tab-order name (or vice
 * versa), they are considered the same element.
 */
function buildTabNameSet(kbPage: KeyboardPageResult): Set<string> {
  const names = new Set<string>();
  for (const step of kbPage.tabOrder ?? []) {
    const n = norm(step.name);
    if (n) names.add(n);
  }
  return names;
}

/** True when `axName` has a reasonable match in the set of keyboard-reached names. */
function isReachedByTab(axName: string, tabNames: Set<string>): boolean {
  const ax = norm(axName);
  if (!ax) return true; // unnamed elements not checked here
  // Exact match
  if (tabNames.has(ax)) return true;
  // Substring match: keyboard-report name contains the AX name or vice versa
  for (const t of tabNames) {
    if (t.includes(ax) || ax.includes(t)) return true;
  }
  return false;
}

// â”€â”€ Per-page analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function analyseGaps(
  a11yPage: { page: string; url: string; tree: A11yTreeNode | null },
  kbPage: KeyboardPageResult | undefined
): ExpectedFocusGap[] {
  const gaps: ExpectedFocusGap[] = [];
  const tabNames = kbPage ? buildTabNameSet(kbPage) : new Set<string>();
  const tabNavigable = collectTabNavigable(a11yPage.tree);

  // â”€â”€ Check 1: Tab-navigable AX nodes not reached by Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const node of tabNavigable) {
    if (!isReachedByTab(node.name ?? '', tabNames)) {
      gaps.push({
        page: a11yPage.page,
        url: a11yPage.url,
        role: node.role ?? '',
        name: (node.name ?? '').trim(),
        issue: `${node.role} "${(node.name ?? '').slice(0, 50)}" is Tab-navigable in the AX tree but was never reached during Tab traversal`,
        severity: 'serious',
        wcag: '2.1.1',
        recommendation:
          'Check: (1) tabindex="-1" making it unreachable, (2) CSS visibility:hidden/display:none, ' +
          '(3) aria-hidden="true" on an ancestor, (4) a focus trap preventing Tab from leaving a widget.',
      });
    }
  }

  // â”€â”€ Check 2: Elements in Tab order with no accessible name â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const step of kbPage?.tabOrder ?? []) {
    if (!step.name || step.name.trim() === '') {
      gaps.push({
        page: a11yPage.page,
        url: a11yPage.url,
        role: step.tag,
        name: '',
        issue: `<${step.tag}> at Tab position ${step.order} is reachable by keyboard but has no accessible name â€” screen readers will announce the role only`,
        severity: 'serious',
        wcag: '4.1.2',
        recommendation:
          'Add aria-label, aria-labelledby referencing a visible label, or place descriptive text inside the element.',
      });
    }
  }

  // â”€â”€ Check 3: Positive tabindex â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const el of kbPage?.positiveTabindex ?? []) {
    gaps.push({
      page: a11yPage.page,
      url: a11yPage.url,
      role: el.tag,
      name: el.name ?? '',
      issue: `<${el.tag}> "${el.name ?? ''}" uses tabindex="${el.tabindex}" â€” positive values disrupt the natural DOM tab order`,
      severity: 'moderate',
      wcag: '2.4.3',
      recommendation:
        'Replace positive tabindex with tabindex="0" and reorder elements in the DOM to achieve the correct visual/logical sequence.',
    });
  }

  return gaps;
}

// â”€â”€ Cross-page deduplication â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Stable key for deduplication. Shared-component findings (same role+name
 * issue on multiple pages) should be reported once, not once per page.
 */
function gapKey(g: ExpectedFocusGap): string {
  return `${g.role}::${norm(g.name)}::${g.wcag}`;
}

function deduplicateAcrossPages(allGaps: ExpectedFocusGap[]): ExpectedFocusGap[] {
  const map = new Map<string, { gap: ExpectedFocusGap; pages: Set<string> }>();
  for (const g of allGaps) {
    const k = gapKey(g);
    if (!map.has(k)) {
      map.set(k, { gap: { ...g }, pages: new Set([g.page]) });
    } else {
      map.get(k)!.pages.add(g.page);
    }
  }

  return [...map.values()].map(({ gap, pages }) => {
    if (pages.size > 1) {
      return {
        ...gap,
        page: `(${pages.size} pages: ${[...pages].slice(0, 4).join(', ')}${pages.size > 4 ? ', â€¦' : ''})`,
        issue: `[Shared component â€” ${pages.size} pages] ${gap.issue}`,
      };
    }
    return gap;
  });
}

// â”€â”€ Entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function main(): void {
  try {
    const a11yPath = adaConfig.paths.a11yTree;
    const kbPath   = adaConfig.paths.keyboardReport;

    if (!fs.existsSync(a11yPath)) {
      log.warn('playwright-accessibility-tree.json not found â€” skipping Expected Focus Engine.');
      return;
    }

    const a11y: PlaywrightA11yReport = JSON.parse(fs.readFileSync(a11yPath, 'utf-8'));
    const kb: KeyboardReport | null  = fs.existsSync(kbPath)
      ? JSON.parse(fs.readFileSync(kbPath, 'utf-8'))
      : null;

    const kbByPage = new Map<string, KeyboardPageResult>(
      (kb?.results ?? []).map((r) => [r.page, r])
    );

    const pageResults: ExpectedFocusReport['results'] = [];
    const rawGaps: ExpectedFocusGap[] = [];

    for (const a11yPage of a11y.results ?? []) {
      const kbPage = kbByPage.get(a11yPage.page);
      const gaps   = analyseGaps(a11yPage, kbPage);
      rawGaps.push(...gaps);

      const tabNavigableCount = collectTabNavigable(a11yPage.tree).length;
      pageResults.push({
        page: a11yPage.page,
        url: a11yPage.url,
        expectedFocusableCount: tabNavigableCount,
        actualTabCount: kbPage?.reached ?? 0,
        gapCount: gaps.length,
        gaps,
      });

      log.info(
        `${a11yPage.page}: ${tabNavigableCount} Tab-navigable AX nodes, ` +
        `${kbPage?.reached ?? 0} reached by Tab, ${gaps.length} gap(s)`
      );
    }

    // Deduplicate shared-component gaps before writing the report.
    const allGaps = deduplicateAcrossPages(rawGaps);

    const report: ExpectedFocusReport = {
      generatedAt: new Date().toISOString(),
      baseUrl: a11y.baseUrl,
      totalGaps: allGaps.length,
      results: pageResults,
      allGaps,
    };

    fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
    fs.writeFileSync(
      adaConfig.paths.expectedFocusReport,
      JSON.stringify(report, null, 2),
      'utf-8'
    );

    log.info(
      `Expected Focus Engine: ${allGaps.length} gap(s) (${rawGaps.length} raw, ` +
      `${rawGaps.length - allGaps.length} deduplicated) across ${pageResults.length} page(s) ` +
      `-> ${path.relative(process.cwd(), adaConfig.paths.expectedFocusReport)}`
    );
  } catch (err) {
    log.error('Expected Focus Engine failed', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
