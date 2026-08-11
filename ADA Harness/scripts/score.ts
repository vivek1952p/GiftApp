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

import type { Summary } from './types';

/** Points deducted per violation, keyed by impact. */
const WEIGHTS = { critical: 10, serious: 5, moderate: 2, minor: 1 } as const;

/**
 * Compute the weighted accessibility score for a summary.
 * @param summary The scan summary to score.
 * @returns Integer score in the range [0, 100].
 */
export function computeScore(summary: Summary): number {
  const { critical, serious, moderate, minor } = summary.severityCounts;
  const penalty =
    critical * WEIGHTS.critical +
    serious * WEIGHTS.serious +
    moderate * WEIGHTS.moderate +
    minor * WEIGHTS.minor;

  return Math.max(0, Math.min(100, 100 - penalty));
}
