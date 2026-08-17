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
 *      → only roles that belong in the natural Tab order (button, link,
 *        checkbox, combobox, textbox, …). Roles that use arrow-key navigation
 *        inside composite widgets (option, menuitem, treeitem, gridcell, tab)
 *        are intentionally excluded — they do NOT belong in the Tab order.
 *        Compared by COUNT per normalised name, not "was this name seen at
 *        least once": on a page with 20 identically-named row-action buttons
 *        where only 1 is reachable, a presence-only check would treat all 20
 *        as fine. Counting surfaces the numeric deficit instead.
 *   2. Elements in the Tab order with no accessible name
 *      → screen reader users will hear "button" with no context.
 *   3. Elements using a positive tabindex (disrupts natural order)
 *      → already in keyboard-report; surfaced here with a WCAG fix.
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

// ── Role classification ─────────────────────────────────────────────────────

/**
 * Roles that SHOULD appear in the natural Tab order.
 * Excludes roles that use arrow-key navigation WITHIN composite widgets
 * (option, menuitem, treeitem, gridcell, tab) — these must NOT be in Tab order.
 */
const TAB_NAVIGABLE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'combobox', // the combobox trigger is Tab-navigable; its options are not
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
]);

/**
 * DOM tags a given ARIA role is typically implemented with. Used only as a
 * last-resort correlation in Check 1 (see buildUnnamedReachedByTag) — never
 * exact, deliberately permissive since it's just absorbing a deficit against
 * elements Check 2 already independently confirmed were reached.
 */
const ROLE_TO_TAGS: Record<string, string[]> = {
  button: ['button', 'input'],
  link: ['a'],
  checkbox: ['input'],
  radio: ['input'],
  combobox: ['select', 'input'],
  textbox: ['input', 'textarea'],
  searchbox: ['input'],
  slider: ['input'],
  spinbutton: ['input'],
  switch: ['input', 'button'],
};

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
  'tablist', // only the active/selected tab is in the Tab order
]);

// ── Tree traversal ──────────────────────────────────────────────────────────

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

  // Nodes inside composite widgets use arrow-key navigation — skip them.
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

// ── Name matching ────────────────────────────────────────────────────────────

/** Normalise a name for comparison (lowercase, collapsed whitespace, max 60 chars). */
function norm(name: string | undefined | null): string {
  return (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Count how many times each normalised name appears in the keyboard tab
 * order. Counting — not a Set — matters: on a page with 20 "Edit" row-action
 * buttons where only 1 is actually reachable, a Set would contain "edit"
 * once and make every one of the 20 AX-tree nodes look "reached" even though
 * 19 are real gaps. Counting lets Check 1 compare AX-tree occurrences against
 * tab-order occurrences per name and surface the numeric deficit.
 */
function buildTabNameCounts(kbPage: KeyboardPageResult): Map<string, number> {
  const counts = new Map<string, number>();
  for (const step of kbPage.tabOrder ?? []) {
    const n = norm(step.name);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return counts;
}

/**
 * Count reached-but-UNNAMED tab-order steps per DOM tag. The AX tree and the
 * keyboard scan's own name heuristic can disagree on an element's name (e.g.
 * an <input> whose only label source is `placeholder` — the browser's real
 * accessible-name algorithm credits it, this harness's simpler keyboard-scan
 * heuristic in accessibility.spec.ts does not, by design, since placeholder-
 * only labelling is itself a real WCAG problem Check 2 needs to keep
 * flagging). Without this, the SAME element gets reported twice — as a
 * contradictory "never reached" (Check 1) AND "reached but unnamed"
 * (Check 2) — because Check 1's name-string match fails even though the
 * element genuinely was reached. These counts let Check 1 absorb its
 * deficit against exactly the elements Check 2 is already flagging.
 */
function buildUnnamedReachedByTag(kbPage: KeyboardPageResult): Map<string, number> {
  const counts = new Map<string, number>();
  for (const step of kbPage.tabOrder ?? []) {
    if (!step.name || step.name.trim() === '') {
      const tag = step.tag.toLowerCase();
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * True when `axName` has a reasonable match somewhere in the tab order.
 * Substring matching absorbs minor truncation differences between how the AX
 * tree computes a name and how the keyboard scan reads DOM text/aria-label —
 * used only as a last-resort fallback when the exact-count comparison in
 * Check 1 finds zero exact matches, never as the primary signal (that would
 * reintroduce the Set-collapsing problem above).
 */
function hasSubstringMatch(axName: string, tabNames: Iterable<string>): boolean {
  const ax = norm(axName);
  // collectTabNavigable only ever pushes named nodes into axByName (see its
  // "Only collect named elements" filter above), so this should be
  // unreachable today — but failing OPEN here would silently absorb a
  // genuine "unreachable AND unnamed" gap (the worst case this engine
  // exists to catch) if that filter is ever loosened. Fail closed instead.
  if (!ax) return false;
  for (const t of tabNames) {
    if (t.includes(ax) || ax.includes(t)) return true;
  }
  return false;
}

// ── Per-page analysis ────────────────────────────────────────────────────────

export function analyseGaps(
  a11yPage: { page: string; url: string; tree: A11yTreeNode | null },
  kbPage: KeyboardPageResult | undefined
): ExpectedFocusGap[] {
  const gaps: ExpectedFocusGap[] = [];
  const tabCounts = kbPage ? buildTabNameCounts(kbPage) : new Map<string, number>();
  const tabNames = new Set(tabCounts.keys());
  const unnamedByTag = kbPage ? buildUnnamedReachedByTag(kbPage) : new Map<string, number>();
  const tabNavigable = collectTabNavigable(a11yPage.tree);

  // ── Check 1: Tab-navigable AX nodes not reached by Tab ──────────────────
  // Grouped by normalised name so repeated components (data-table row
  // actions, list items, …) are compared by COUNT, not "was this name seen
  // at least once" — the latter hides gaps whenever any one instance happens
  // to be reachable.
  const axByName = new Map<string, { role: string; name: string; count: number }>();
  for (const node of tabNavigable) {
    const key = norm(node.name);
    const existing = axByName.get(key);
    if (existing) {
      existing.count++;
    } else {
      axByName.set(key, { role: node.role ?? '', name: (node.name ?? '').trim(), count: 1 });
    }
  }

  for (const [key, { role, name, count: axCount }] of axByName) {
    let tabCount = tabCounts.get(key) ?? 0;
    if (tabCount === 0 && hasSubstringMatch(name, tabNames)) tabCount = 1; // truncation fallback

    // Last-resort correlation: before concluding a deficit is a real gap,
    // absorb it against reached-but-unnamed tab-order steps of a matching
    // tag (see buildUnnamedReachedByTag) — these are exactly the elements
    // Check 2 is already flagging, so this avoids double-reporting the same
    // element as contradictory "never reached" + "reached but unnamed".
    let remaining = axCount - tabCount;
    if (remaining > 0) {
      for (const tag of ROLE_TO_TAGS[role] ?? []) {
        const available = unnamedByTag.get(tag) ?? 0;
        if (available <= 0) continue;
        const absorbed = Math.min(available, remaining);
        unnamedByTag.set(tag, available - absorbed);
        tabCount += absorbed;
        remaining -= absorbed;
        if (remaining <= 0) break;
      }
    }

    const deficit = axCount - tabCount;
    if (deficit <= 0) continue;

    gaps.push({
      page: a11yPage.page,
      url: a11yPage.url,
      role,
      name,
      issue:
        axCount === 1
          ? `${role} "${name.slice(0, 50)}" is Tab-navigable in the AX tree but was never reached during Tab traversal`
          : `${deficit} of ${axCount} "${role}" elements named "${name.slice(0, 50)}" are Tab-navigable in the AX tree, but only ${tabCount} instance(s) were reached during Tab traversal — likely a repeated component (e.g. a data-table row action) where some instances are unreachable`,
      severity: 'serious',
      wcag: '2.1.1',
      recommendation:
        'Check: (1) tabindex="-1" making it unreachable, (2) CSS visibility:hidden/display:none, ' +
        '(3) aria-hidden="true" on an ancestor, (4) a focus trap preventing Tab from leaving a widget. ' +
        'If this is a repeated component, verify EVERY instance, not just the first.',
    });
  }

  // ── Check 2: Elements in Tab order with no accessible name ───────────────
  for (const step of kbPage?.tabOrder ?? []) {
    if (!step.name || step.name.trim() === '') {
      gaps.push({
        page: a11yPage.page,
        url: a11yPage.url,
        role: step.tag,
        name: '',
        issue: `<${step.tag}> at Tab position ${step.order} is reachable by keyboard but has no accessible name — screen readers will announce the role only`,
        severity: 'serious',
        wcag: '4.1.2',
        recommendation:
          'Add aria-label, aria-labelledby referencing a visible label, or place descriptive text inside the element.',
      });
    }
  }

  // ── Check 3: Positive tabindex ───────────────────────────────────────────
  for (const el of kbPage?.positiveTabindex ?? []) {
    gaps.push({
      page: a11yPage.page,
      url: a11yPage.url,
      role: el.tag,
      name: el.name ?? '',
      issue: `<${el.tag}> "${el.name ?? ''}" uses tabindex="${el.tabindex}" — positive values disrupt the natural DOM tab order`,
      severity: 'moderate',
      wcag: '2.4.3',
      recommendation:
        'Replace positive tabindex with tabindex="0" and reorder elements in the DOM to achieve the correct visual/logical sequence.',
    });
  }

  return gaps;
}

// ── Cross-page deduplication ─────────────────────────────────────────────────

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
        page: `(${pages.size} pages: ${[...pages].slice(0, 4).join(', ')}${pages.size > 4 ? ', …' : ''})`,
        issue: `[Shared component — ${pages.size} pages] ${gap.issue}`,
      };
    }
    return gap;
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

function main(): void {
  try {
    const a11yPath = adaConfig.paths.a11yTree;
    const kbPath = adaConfig.paths.keyboardReport;

    if (!fs.existsSync(a11yPath)) {
      log.warn('playwright-accessibility-tree.json not found — skipping Expected Focus Engine.');
      return;
    }

    const a11y: PlaywrightA11yReport = JSON.parse(fs.readFileSync(a11yPath, 'utf-8'));
    const kb: KeyboardReport | null = fs.existsSync(kbPath)
      ? JSON.parse(fs.readFileSync(kbPath, 'utf-8'))
      : null;

    const kbByPage = new Map<string, KeyboardPageResult>((kb?.results ?? []).map((r) => [r.page, r]));

    const pageResults: ExpectedFocusReport['results'] = [];
    const rawGaps: ExpectedFocusGap[] = [];

    for (const a11yPage of a11y.results ?? []) {
      const kbPage = kbByPage.get(a11yPage.page);
      const gaps = analyseGaps(a11yPage, kbPage);
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
    fs.writeFileSync(adaConfig.paths.expectedFocusReport, JSON.stringify(report, null, 2), 'utf-8');

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

if (require.main === module) {
  main();
}
