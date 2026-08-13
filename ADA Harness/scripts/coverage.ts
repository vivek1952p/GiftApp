/**
 * ============================================================================
 * ADA Harness — WCAG Success-Criterion Coverage Report
 * ============================================================================
 *
 * Renders reports/coverage.md: for every WCAG 2.2 A/AA success criterion,
 * reports whether this scan found an issue for it, whether the harness is
 * merely *capable* of detecting it (no findings this run), or whether it is
 * not automated by any scanner at all. Turns "trust me, it's decent" into
 * something an auditor can check against, and makes the manual-review gap
 * explicit instead of tribal knowledge.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { collectAllFindings } from './all-findings';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import { CAPABILITY, WCAG_AA_CRITERIA } from './wcag-catalog';
import type { MergedReport, Summary } from './types';

const log = createLogger('coverage');

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

/** Entry point: generate coverage.md from the current summary + merged report + static catalog. */
function main(): void {
  try {
    const summary = readSummary(adaConfig.paths.summary);
    if (!summary) throw new Error('summary.json not found. Run "npm run ada" first.');

    const merged = readMerged(adaConfig.paths.merged);
    const allFindings = collectAllFindings(summary, merged);

    const foundThisScan = new Set<string>();
    for (const f of allFindings) {
      if (f.wcag) foundThisScan.add(f.wcag);
    }

    const capable = new Set<string>();
    for (const scs of Object.values(CAPABILITY)) {
      for (const sc of scs) capable.add(sc);
    }

    let coveredCount = 0;
    let checkedCount = 0;
    let notAutomatedCount = 0;

    const rows = WCAG_AA_CRITERIA.map((c) => {
      let status: string;
      if (foundThisScan.has(c.id)) {
        status = '✅ Covered (findings this scan)';
        coveredCount++;
      } else if (capable.has(c.id)) {
        status = '⚠️ Checked (no findings this scan)';
        checkedCount++;
      } else {
        status = '❌ Not automated';
        notAutomatedCount++;
      }
      return `| ${c.id} | ${c.level} | ${c.name} | ${status} |`;
    }).join('\n');

    const total = WCAG_AA_CRITERIA.length;

    const md = [
      '# ♿ WCAG 2.2 A/AA Coverage',
      '',
      `_Generated: ${new Date().toISOString()}_`,
      `_Target: ${summary.baseUrl}_`,
      '',
      '## Summary',
      '',
      '| Status | Count |',
      '| --- | --- |',
      `| ✅ Covered (findings this scan) | ${coveredCount} / ${total} |`,
      `| ⚠️ Checked (no findings this scan) | ${checkedCount} / ${total} |`,
      `| ❌ Not automated | ${notAutomatedCount} / ${total} |`,
      '',
      '_"Checked" means at least one scanner is capable of detecting a violation of that' +
        ' criterion (the harness ran clean for it this time). "Not automated" criteria need' +
        ' a manual review — they are not currently produced by any scanner in this harness._',
      '',
      '## Success Criteria',
      '',
      '| SC | Level | Name | Status |',
      '| --- | --- | --- | --- |',
      rows,
      '',
    ].join('\n');

    fs.writeFileSync(adaConfig.paths.coverage, md, 'utf-8');
    log.info(
      `Coverage report written: ${coveredCount} covered, ${checkedCount} checked, ` +
        `${notAutomatedCount} not automated (of ${total}) -> ` +
        path.relative(process.cwd(), adaConfig.paths.coverage)
    );
  } catch (err) {
    log.error('Coverage report generation failed', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
