/**
 * ============================================================================
 * ADA Harness — Issue Prioritization (Phase 2)
 * ============================================================================
 *
 * Pure, framework-independent logic that assigns a remediation priority to a
 * finding. Priority is NOT the same as axe severity ("impact"): it also factors
 * in how many pages are affected and whether multiple independent scanners
 * confirmed the issue (cross-scanner confirmation raises confidence and reach).
 *
 * Ordering (most to least urgent): critical > high > medium > low.
 * ============================================================================
 */

import type { Impact, MergedFinding } from './types';

/** Remediation priority buckets. */
export type Priority = 'critical' | 'high' | 'medium' | 'low';

/** Numeric rank so priorities can be compared / sorted. */
export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Context used to compute priority for a single finding. */
export interface PriorityContext {
  /** How many distinct pages the finding's rule affects across the scan. */
  affectedPages: number;
}

/** Base priority derived purely from axe impact. */
function basePriority(impact: Impact): Priority {
  switch (impact) {
    case 'critical':
      return 'critical';
    case 'serious':
      return 'high';
    case 'moderate':
      return 'medium';
    default:
      return 'low';
  }
}

/** Raise a priority by one level (clamped at critical). */
function bump(p: Priority): Priority {
  const order: Priority[] = ['low', 'medium', 'high', 'critical'];
  const idx = order.indexOf(p);
  return order[Math.min(order.length - 1, idx + 1)];
}

/**
 * Compute the remediation priority for a merged finding.
 *
 * @param finding The correlated finding.
 * @param ctx     Reach/confidence context (affected pages).
 * @returns The computed priority.
 */
export function prioritize(finding: MergedFinding, ctx: PriorityContext): Priority {
  let priority = basePriority(finding.impact);

  // Cross-scanner confirmation increases confidence + real-world reach.
  const confirmations = [
    finding.verifiedIn.playwrightTree === 'confirmed',
    finding.verifiedIn.uia === 'confirmed',
    finding.verifiedIn.dom === 'confirmed',
    finding.verifiedIn.screenReader === 'confirmed',
  ].filter(Boolean).length;
  if (confirmations >= 2) priority = bump(priority);

  // Widespread issues (present on many pages) are more impactful.
  if (ctx.affectedPages >= 3) priority = bump(priority);

  return priority;
}

/**
 * Build a map of ruleId -> number of distinct pages it affects, used as the
 * reach signal for prioritization.
 */
export function countAffectedPages(findings: MergedFinding[]): Map<string, number> {
  const pagesByRule = new Map<string, Set<string>>();
  for (const f of findings) {
    if (!pagesByRule.has(f.ruleId)) pagesByRule.set(f.ruleId, new Set());
    pagesByRule.get(f.ruleId)!.add(f.page);
  }
  const counts = new Map<string, number>();
  for (const [rule, pages] of pagesByRule) counts.set(rule, pages.size);
  return counts;
}
