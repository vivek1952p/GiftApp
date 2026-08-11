/**
 * ============================================================================
 * ADA Harness — Before/After Comparison (Step 6)
 * ============================================================================
 *
 * Compares the previous scan (summary.previous.json) against the current scan
 * (summary.json) and writes reports/comparison.md containing:
 *
 *   - Resolved Issues   (present before, gone now)
 *   - Remaining Issues  (present in both)
 *   - New Issues        (introduced after fixes)
 *   - Accessibility Score
 *
 * Each violation is identified by a stable key of page + rule + target so the
 * diff is element-accurate.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import { computeScore } from './score';
import type { Summary, SummaryViolation } from './types';

const log = createLogger('compare');

/** Stable identity for a single violation across scans. */
function keyOf(v: SummaryViolation): string {
  return `${v.page}::${v.ruleId}::${v.target}`;
}

/** Safely read a summary file, returning an empty summary when absent. */
function readSummary(file: string): Summary {
  if (!fs.existsSync(file)) {
    return {
      generatedAt: new Date().toISOString(),
      baseUrl: adaConfig.baseUrl,
      totalViolations: 0,
      pagesScanned: 0,
      severityCounts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      violations: [],
    };
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Summary;
}

/** Render a violation as a single Markdown bullet. */
function bullet(v: SummaryViolation): string {
  return `- \`${v.ruleId}\` (${v.impact ?? 'n/a'}) on **${v.page}** — \`${v.target}\``;
}

/**
 * Entry point: build comparison.md from previous vs current summaries.
 */
function main(): void {
  try {
    const previous = readSummary(adaConfig.paths.previousSummary);
    const current = readSummary(adaConfig.paths.summary);

    const prevKeys = new Map(previous.violations.map((v) => [keyOf(v), v]));
    const currKeys = new Map(current.violations.map((v) => [keyOf(v), v]));

    const resolved = previous.violations.filter((v) => !currKeys.has(keyOf(v)));
    const remaining = current.violations.filter((v) => prevKeys.has(keyOf(v)));
    const introduced = current.violations.filter((v) => !prevKeys.has(keyOf(v)));

    const prevScore = computeScore(previous);
    const currScore = computeScore(current);

    const md = [
      '# Accessibility Comparison Report',
      '',
      `_Generated: ${new Date().toISOString()}_`,
      '',
      '## Accessibility Score',
      '',
      '| Scan | Total Violations | Score |',
      '| --- | --- | --- |',
      `| Previous | ${previous.totalViolations} | ${prevScore}/100 |`,
      `| Current | ${current.totalViolations} | ${currScore}/100 |`,
      `| **Change** | **${current.totalViolations - previous.totalViolations}** | **${currScore - prevScore}** |`,
      '',
      `## ✅ Resolved Issues (${resolved.length})`,
      '',
      resolved.length ? resolved.map(bullet).join('\n') : '_None._',
      '',
      `## ⚠️ Remaining Issues (${remaining.length})`,
      '',
      remaining.length ? remaining.map(bullet).join('\n') : '_None._',
      '',
      `## 🆕 New Issues (${introduced.length})`,
      '',
      introduced.length ? introduced.map(bullet).join('\n') : '_None._',
      '',
    ].join('\n');

    fs.writeFileSync(adaConfig.paths.comparison, md, 'utf-8');

    // Machine-readable outputs for downstream tooling / the AI agent.
    fs.writeFileSync(
      adaConfig.paths.resolvedIssues,
      JSON.stringify({ generatedAt: new Date().toISOString(), count: resolved.length, issues: resolved }, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      adaConfig.paths.remainingIssues,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), count: remaining.length, introduced: introduced.length, issues: remaining, newIssues: introduced },
        null,
        2
      ),
      'utf-8'
    );

    log.info(
      `Comparison written: ${resolved.length} resolved, ${remaining.length} remaining, ` +
        `${introduced.length} new -> ${path.relative(process.cwd(), adaConfig.paths.comparison)}`
    );
  } catch (err) {
    log.error('Comparison failed', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
