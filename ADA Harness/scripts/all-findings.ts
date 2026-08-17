/**
 * ============================================================================
 * All-Findings Normalizer — shared by dashboard.ts and compare.ts
 * ============================================================================
 *
 * Flattens axe-core plus all 6 other sources in a merged report into one
 * common shape, so both the dashboard's totals/score and the comparison's
 * before/after diff are computed from the SAME population of findings.
 * Previously dashboard.ts alone did this aggregation while compare.ts only
 * ever looked at axe-core — the two reports showed different totals (e.g.
 * 115 vs 73) with no way to reconcile them. Both now go through this module.
 * ============================================================================
 */

import type { MergedReport, SeverityCounts, Summary } from './types';

/** A finding normalized to a common shape so every source can be aggregated and diffed together. */
export interface NormalizedFinding {
  /** Stable identity for diffing the SAME finding across two scans. */
  key: string;
  page: string;
  /** axe/UIA/keyboard rule id, or a synthesized `engine:label` for the 5 specialized engines. */
  rule: string;
  severity: string | null;
  /** Short locator shown in report bullet lists (selector, name, or widget/scenario label). */
  detail: string;
  /** Full human-readable issue description. */
  issue: string;
  /** WCAG success criterion this finding maps to, e.g. "4.1.2", when known. */
  wcag?: string;
}

/**
 * Parse an axe-core WCAG tag (e.g. "wcag111", "wcag1412") into a dotted success
 * criterion id ("1.1.1", "1.4.12"). axe encodes the first two digits as SC
 * parts 1-2 and the remainder as part 3. Conformance-level tags that aren't a
 * specific criterion (e.g. "wcag2a", "wcag21aa", "best-practice") don't match
 * and return null.
 */
export function axeTagToWcag(tag: string): string | null {
  const match = /^wcag(\d{3,4})$/.exec(tag);
  if (!match) return null;
  const digits = match[1];
  return `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
}

/** First valid WCAG success criterion found among an axe violation's tags, if any. */
export function firstWcag(tags: string[]): string | undefined {
  for (const tag of tags) {
    const wcag = axeTagToWcag(tag);
    if (wcag) return wcag;
  }
  return undefined;
}

/**
 * The subset of MergedReport that collectAllFindings actually reads. A
 * MergedReport always satisfies this structurally, but callers that only
 * have the per-source arrays (not a full MergedReport) can pass those
 * directly instead of force-casting an incomplete object.
 */
export type FindingsSource = Pick<
  MergedReport,
  | 'uiaFindings'
  | 'keyboardFindings'
  | 'expectedFocusGaps'
  | 'widgetFindings'
  | 'focusManagementFindings'
  | 'interactionFindings'
  | 'screenReaderFindings'
>;

/**
 * Flatten axe-core plus every other scanner in a merged report into one
 * normalized list. Sources that already carry a `ruleId` (axe, the
 * Accessibility Rule Engine, the keyboard scan) use it directly; the four
 * specialized engines don't have a `ruleId` concept, so a readable synthetic
 * label is built from their own identifying field (widget name, scenario,
 * role) prefixed by engine name.
 */
export function collectAllFindings(summary: Summary, merged: FindingsSource | null): NormalizedFinding[] {
  const out: NormalizedFinding[] = summary.violations.map((v) => ({
    key: `axe::${v.page}::${v.ruleId}::${v.target}`,
    page: v.page,
    rule: v.ruleId,
    severity: v.impact,
    detail: v.target,
    issue: v.description,
    wcag: firstWcag(v.wcagRuleIds),
  }));
  if (!merged) return out;

  for (const f of merged.uiaFindings ?? []) {
    if (f.duplicateOfAxe) continue;
    out.push({
      key: `uia::${f.page}::${f.ruleId}::${f.name}`,
      page: f.page,
      rule: f.ruleId,
      severity: f.severity,
      detail: f.name || f.controlType,
      issue: f.issue,
      wcag: f.wcag,
    });
  }
  for (const f of merged.keyboardFindings ?? []) {
    out.push({
      key: `keyboard::${f.page}::${f.ruleId}::${f.tag}::${f.name}`,
      page: f.page,
      rule: f.ruleId,
      severity: f.severity,
      detail: `<${f.tag}> ${f.name}`.trim(),
      issue: f.issue,
      wcag: f.wcag,
    });
  }
  for (const f of merged.expectedFocusGaps ?? []) {
    if (f.duplicateOfAxe) continue;
    out.push({
      key: `expected-focus::${f.page}::${f.role}::${f.name}::${f.wcag}`,
      page: f.page,
      rule: `expected-focus:${f.wcag}`,
      severity: f.severity,
      detail: `${f.role} ${f.name}`.trim(),
      issue: f.issue,
      wcag: f.wcag,
    });
  }
  for (const f of merged.widgetFindings ?? []) {
    out.push({
      key: `widget::${f.page}::${f.widget}::${f.selector}`,
      page: f.page,
      rule: `widget-behavior:${f.widget}`,
      severity: f.severity,
      detail: f.name || f.selector,
      issue: f.issue,
      wcag: f.wcag,
    });
  }
  for (const f of merged.focusManagementFindings ?? []) {
    out.push({
      key: `focus-mgmt::${f.page}::${f.scenario}::${f.detail ?? ''}`,
      page: f.page,
      rule: `focus-management:${f.scenario}`,
      severity: f.severity,
      detail: f.detail ?? f.scenario,
      issue: f.issue,
      wcag: f.wcag,
    });
  }
  for (const f of merged.interactionFindings ?? []) {
    out.push({
      key: `interaction::${f.page}::${f.role}::${f.selector}::${f.expectedKey}`,
      page: f.page,
      rule: `interaction:${f.role}`,
      severity: f.severity,
      detail: `${f.name || f.selector} (${f.expectedKey})`,
      issue: f.issue,
      wcag: f.wcag,
    });
  }
  for (const f of merged.screenReaderFindings ?? []) {
    out.push({
      key: `screen-reader::${f.page}::${f.ruleId}::${f.target}`,
      page: f.page,
      rule: `screen-reader:${f.ruleId}`,
      severity: f.severity,
      detail: `${f.role} (${f.announcedText || '(nothing)'})`,
      issue: f.issue,
      wcag: f.wcag,
    });
  }
  return out;
}

/** Tally severity counts across a normalized finding list. Findings with no/unknown severity are not counted. */
export function severityCountsOf(findings: NormalizedFinding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const f of findings) {
    if (f.severity && f.severity in counts) {
      counts[f.severity as keyof SeverityCounts]++;
    }
  }
  return counts;
}

/** Count findings grouped by an arbitrary key selector. */
export function groupCount(
  findings: NormalizedFinding[],
  key: (f: NormalizedFinding) => string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of findings) map.set(key(f), (map.get(key(f)) ?? 0) + 1);
  return map;
}
