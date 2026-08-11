/**
 * ============================================================================
 * ADA Harness — Markdown Dashboard (Step 7)
 * ============================================================================
 *
 * Renders reports/dashboard.md covering all 7 scanners (axe-core + the
 * Accessibility Rule Engine + keyboard + all 4 specialized engines) for the
 * CURRENT scan — the same population of findings that comparison.md diffs
 * across scans (see all-findings.ts, shared by both).
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { collectAllFindings, groupCount, severityCountsOf } from './all-findings';
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

/**
 * Entry point: generate dashboard.md from the current summary + merged report.
 */
function main(): void {
  try {
    const summary = readSummary(adaConfig.paths.summary);
    if (!summary) throw new Error('summary.json not found. Run "npm run ada" first.');

    const merged = readMerged(adaConfig.paths.merged);
    const allFindings = collectAllFindings(summary, merged);
    const allSeverity = severityCountsOf(allFindings);
    const score = computeScore(allSeverity);

    const confirmedByAll = merged
      ? merged.findings.filter(
          (f) => f.verifiedIn.playwrightTree === 'confirmed' && f.verifiedIn.uia === 'confirmed'
        ).length
      : 0;

    const byPage = groupCount(allFindings, (f) => f.page);
    const byRule = groupCount(allFindings, (f) => f.rule);

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
      `| Total Findings | ${allFindings.length} |`,
      `| Critical | ${allSeverity.critical} |`,
      `| Serious | ${allSeverity.serious} |`,
      `| Moderate | ${allSeverity.moderate} |`,
      `| Minor | ${allSeverity.minor} |`,
      `| **Accessibility Score** | **${score}/100** |`,
      '',
      '_Covers all 7 scanners (axe-core + the Accessibility Rule Engine + keyboard + all 4' +
        ' specialized engines). See_ `comparison.md` _for how this total changed since the' +
        ' previous scan._',
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
      '## Findings by Page (All Scanners)',
      '',
      '| Page | Findings |',
      '| --- | --- |',
      pageRows,
      '',
      '## Findings by Rule / Category (All Scanners)',
      '',
      '_Rows prefixed_ `expected-focus:` / `widget-behavior:` / `focus-management:` /' +
        ' `interaction:` _come from the specialized engines, which don\'t use axe rule ids —' +
        ' the suffix is that engine\'s own scenario/widget/role label instead._',
      '',
      '| Rule | Count |',
      '| --- | --- |',
      ruleRows,
      '',
    ].join('\n');

    fs.writeFileSync(adaConfig.paths.dashboard, md, 'utf-8');
    log.info(
      `Dashboard written: score ${score}/100, ${allFindings.length} finding(s) across all scanners -> ` +
        path.relative(process.cwd(), adaConfig.paths.dashboard)
    );
  } catch (err) {
    log.error('Dashboard generation failed', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
