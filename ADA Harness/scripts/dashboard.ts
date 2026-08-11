/**
 * ============================================================================
 * ADA Harness — Markdown Dashboard (Step 7)
 * ============================================================================
 *
 * Renders reports/dashboard.md from the current summary.json:
 *
 *   - Pages Scanned
 *   - Total Violations
 *   - Critical / Serious / Moderate / Minor counts
 *   - Resolved (vs previous scan, if available)
 *   - Accessibility Score
 *   - Per-page and per-rule breakdown tables
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import { computeScore } from './score';
import type { MergedReport, Summary } from './types';

const log = createLogger('dashboard');

/** Read a summary file or return null when it does not exist. */
function readSummary(file: string): Summary | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Summary;
}

/** Read the merged report or return null when it does not exist. */
function readMerged(file: string): MergedReport | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as MergedReport;
  } catch {
    return null;
  }
}

/** Count violations grouped by an arbitrary key selector. */
function groupCount(summary: Summary, key: (v: Summary['violations'][number]) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of summary.violations) {
    map.set(key(v), (map.get(key(v)) ?? 0) + 1);
  }
  return map;
}

/**
 * Entry point: generate dashboard.md from the current summary.
 */
function main(): void {
  try {
    const summary = readSummary(adaConfig.paths.summary);
    if (!summary) throw new Error('summary.json not found. Run "npm run ada" first.');

    const previous = readSummary(adaConfig.paths.previousSummary);
    const resolved = previous ? Math.max(0, previous.totalViolations - summary.totalViolations) : 0;
    const score = computeScore(summary);
    const { critical, serious, moderate, minor } = summary.severityCounts;

    const byPage = groupCount(summary, (v) => v.page);
    const byRule = groupCount(summary, (v) => v.ruleId);

    // Optional cross-scanner coverage from the merged report.
    const merged = readMerged(adaConfig.paths.merged);
    const confirmedByAll = merged
      ? merged.findings.filter(
          (f) => f.verifiedIn.playwrightTree === 'confirmed' && f.verifiedIn.uia === 'confirmed'
        ).length
      : 0;

    const pageRows =
      [...byPage.entries()].map(([page, count]) => `| ${page} | ${count} |`).join('\n') || '| _none_ | 0 |';
    const ruleRows =
      [...byRule.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([rule, count]) => `| \`${rule}\` | ${count} |`)
        .join('\n') || '| _none_ | 0 |';

    const md = [
      '# ♿ Accessibility Dashboard',
      '',
      `_Generated: ${new Date().toISOString()}_`,
      `_Target: ${summary.baseUrl}_`,
      '',
      '## Summary',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Pages Scanned | ${summary.pagesScanned} |`,
      `| Total Violations | ${summary.totalViolations} |`,
      `| Critical | ${critical} |`,
      `| Serious | ${serious} |`,
      `| Moderate | ${moderate} |`,
      `| Minor | ${minor} |`,
      `| Resolved (vs previous) | ${resolved} |`,
      `| **Accessibility Score** | **${score}/100** |`,
      '',
      '## Scanner Coverage',
      '',
      '| Scanner | Status |',
      '| --- | --- |',
      `| axe-core (WCAG 2.1 AA) | ${merged?.sources.axe ? '✅ used' : '—'} |`,
      `| Playwright Accessibility Tree | ${merged?.sources.playwrightTree ? `✅ ${merged.trees.playwrightNodeCount} nodes` : '—'} |`,
      `| Windows UI Automation | ${merged?.trees.uiaAvailable ? `✅ ${merged.trees.uiaNodeCount} nodes` : merged?.sources.uia ? '⚠️ unavailable on host' : '—'} |`,
      `| Full DOM Snapshot | ${merged?.sources.dom ? `✅ ${merged.trees.domElementsCaptured} elements` : '—'} |`,
      `| Accessibility Rule Engine | ${merged?.sources.uiaRuleEngine ? `✅ ${merged.trees.uiaRuleFindingCount} finding(s)` : '—'} |`,
      `| Keyboard / Tab-order | ${merged?.sources.keyboard ? `✅ ${merged.trees.keyboardFindingCount} finding(s)` : '—'} |`,
      `| Expected Focus Engine | ${merged?.sources.expectedFocus ? `✅ ${merged.trees.expectedFocusGapCount} gap(s)` : '—'} |`,
      `| Widget Behavior Engine | ${merged?.sources.widgetBehavior ? `✅ ${merged.trees.widgetFindingCount} finding(s)` : '—'} |`,
      `| Focus Management Engine | ${merged?.sources.focusManagement ? `✅ ${merged.trees.focusManagementFindingCount} finding(s)` : '—'} |`,
      `| Interaction Prediction Engine | ${merged?.sources.interactionPrediction ? `✅ ${merged.trees.interactionFindingCount} finding(s)` : '—'} |`,
      `| Findings confirmed by all scanners | ${confirmedByAll} |`,
      '',
      '## Violations by Page',
      '',
      '| Page | Violations |',
      '| --- | --- |',
      pageRows,
      '',
      '## Violations by Rule',
      '',
      '| Rule | Count |',
      '| --- | --- |',
      ruleRows,
      '',
    ].join('\n');

    fs.writeFileSync(adaConfig.paths.dashboard, md, 'utf-8');
    log.info(
      `Dashboard written: score ${score}/100, ${summary.totalViolations} violation(s) -> ` +
        path.relative(process.cwd(), adaConfig.paths.dashboard)
    );
  } catch (err) {
    log.error('Dashboard generation failed', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
