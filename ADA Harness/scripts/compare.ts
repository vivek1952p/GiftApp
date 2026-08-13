/**
 * ============================================================================
 * ADA Harness — Before/After Comparison (Step 6)
 * ============================================================================
 *
 * Compares the previous scan against the current scan across ALL 8 scanners
 * (axe-core, the Accessibility Rule Engine, keyboard, and all 5 specialized
 * engines) and writes reports/comparison.md containing:
 *
 *   - Resolved Issues   (present before, gone now)
 *   - Remaining Issues  (present in both)
 *   - New Issues        (introduced after fixes)
 *   - Accessibility Score
 *
 * "Previous" is `merged-report.previous.json`, snapshotted by merge-report.ts
 * right before it overwrites merged-report.json — this is what makes the
 * totals here match dashboard.md's totals for the current scan; previously
 * this file only ever diffed axe-core (via summary.previous.json), while
 * dashboard.md counted every scanner, so the two reports disagreed.
 *
 * Each finding is identified by a stable key built per-source (see
 * all-findings.ts) so the diff is element-accurate across scans.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { collectAllFindings, severityCountsOf, type NormalizedFinding } from './all-findings';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import { computeScore } from './score';
import type { MergedReport, Summary } from './types';

const log = createLogger('compare');

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

/** Safely read a merged report, returning null when absent or unparseable. */
function readMerged(file: string): MergedReport | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as MergedReport;
  } catch {
    return null;
  }
}

/** Render a finding as a single Markdown bullet. */
function bullet(f: NormalizedFinding): string {
  return `- \`${f.rule}\` (${f.severity ?? 'n/a'}) on **${f.page}** — ${f.detail}`;
}

/**
 * Entry point: build comparison.md from previous vs current state, across
 * every scanner.
 */
function main(): void {
  try {
    const previousSummary = readSummary(adaConfig.paths.previousSummary);
    const currentSummary = readSummary(adaConfig.paths.summary);
    const previousMerged = readMerged(adaConfig.paths.mergedPrevious);
    const currentMerged = readMerged(adaConfig.paths.merged);

    const previousFindings = collectAllFindings(previousSummary, previousMerged);
    const currentFindings = collectAllFindings(currentSummary, currentMerged);

    const prevKeys = new Set(previousFindings.map((f) => f.key));
    const currKeys = new Set(currentFindings.map((f) => f.key));

    const resolved = previousFindings.filter((f) => !currKeys.has(f.key));
    const remaining = currentFindings.filter((f) => prevKeys.has(f.key));
    const introduced = currentFindings.filter((f) => !prevKeys.has(f.key));

    const prevScore = computeScore(severityCountsOf(previousFindings));
    const currScore = computeScore(severityCountsOf(currentFindings));

    const md = [
      '# Accessibility Comparison Report',
      '',
      `_Generated: ${new Date().toISOString()}_`,
      '',
      '_Covers all 8 scanners (axe-core + the Accessibility Rule Engine + keyboard + all 5' +
        ' specialized engines) — the same totals_ `dashboard.md` _shows for the current scan._',
      '',
      '## Accessibility Score',
      '',
      '| Scan | Total Findings | Score |',
      '| --- | --- | --- |',
      `| Previous | ${previousFindings.length} | ${prevScore}/100 |`,
      `| Current | ${currentFindings.length} | ${currScore}/100 |`,
      `| **Change** | **${currentFindings.length - previousFindings.length}** | **${currScore - prevScore}** |`,
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
      JSON.stringify(
        { generatedAt: new Date().toISOString(), count: resolved.length, issues: resolved },
        null,
        2
      ),
      'utf-8'
    );
    fs.writeFileSync(
      adaConfig.paths.remainingIssues,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          count: remaining.length,
          introduced: introduced.length,
          issues: remaining,
          newIssues: introduced,
        },
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
