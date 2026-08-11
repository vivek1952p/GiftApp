/**
 * ============================================================================
 * ADA Harness — Accessibility Score
 * ============================================================================
 *
 * Produces a single 0–100 accessibility score from a summary. Violations are
 * weighted by impact so that a critical issue costs far more than a minor one.
 * The score is clamped to [0, 100]; a clean scan scores 100.
 *
 * Weighting (points deducted per violation):
 *   critical = 10, serious = 5, moderate = 2, minor = 1
 * ============================================================================
 */

import type { SeverityCounts } from './types';

/** Points deducted per violation, keyed by impact. */
const WEIGHTS = { critical: 10, serious: 5, moderate: 2, minor: 1 } as const;

/**
 * Compute a weighted accessibility score from severity counts. Takes
 * `SeverityCounts` directly (not a full `Summary`) so callers can score
 * axe-only totals (`Summary.severityCounts`) or an aggregate spanning every
 * scanner — the score itself doesn't care where the counts came from, only
 * that undercounting severities from any source silently inflates it.
 * @param counts Severity counts to score.
 * @returns Integer score in the range [0, 100].
 */
export function computeScore(counts: SeverityCounts): number {
  const { critical, serious, moderate, minor } = counts;
  const penalty =
    critical * WEIGHTS.critical +
    serious * WEIGHTS.serious +
    moderate * WEIGHTS.moderate +
    minor * WEIGHTS.minor;

  return Math.max(0, Math.min(100, 100 - penalty));
}
