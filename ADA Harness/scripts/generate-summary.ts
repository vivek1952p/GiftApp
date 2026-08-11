/**
 * ============================================================================
 * ADA Harness — Summary Generator (Step 2)
 * ============================================================================
 *
 * Reads the raw reports/axe-report.json and produces a simplified, flattened
 * reports/summary.json that downstream agents and dashboards consume.
 *
 * The summary flattens the nested axe structure (page -> violation -> nodes)
 * into a flat list where each entry describes ONE offending element, together
 * with aggregate totals and severity counts.
 *
 * Before overwriting an existing summary.json it is copied to
 * summary.previous.json so the comparison step (Step 6) can diff before/after.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import type {
  AxeReport,
  Summary,
  SummaryViolation,
  SeverityCounts,
  Impact,
} from './types';

const log = createLogger('summary');

/**
 * Read and parse the raw axe report, throwing a clear error if it is missing.
 */
function readAxeReport(): AxeReport {
  const file = adaConfig.paths.axeReport;
  if (!fs.existsSync(file)) {
    throw new Error(
      `Raw axe report not found at ${file}. Run the scan first (npm run ada:scan).`
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as AxeReport;
}

/**
 * Increment the correct severity bucket for a given impact.
 */
function tallySeverity(counts: SeverityCounts, impact: Impact): void {
  switch (impact) {
    case 'critical':
      counts.critical += 1;
      break;
    case 'serious':
      counts.serious += 1;
      break;
    case 'moderate':
      counts.moderate += 1;
      break;
    case 'minor':
      counts.minor += 1;
      break;
    default:
      // Unknown / null impact is not counted toward a severity bucket.
      break;
  }
}

/**
 * Transform the raw report into the flattened summary structure.
 */
function buildSummary(report: AxeReport): Summary {
  const violations: SummaryViolation[] = [];
  const severityCounts: SeverityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };

  for (const pageResult of report.results) {
    for (const violation of pageResult.violations) {
      // One summary entry per offending node so fixes can target an element.
      for (const node of violation.nodes) {
        violations.push({
          page: pageResult.page,
          url: pageResult.url,
          ruleId: violation.id,
          wcagRuleIds: violation.tags ?? [],
          description: violation.description,
          impact: violation.impact,
          target: node.target?.join(', ') ?? '',
          html: node.html,
          helpUrl: violation.helpUrl,
        });
        tallySeverity(severityCounts, violation.impact);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    baseUrl: report.baseUrl,
    totalViolations: violations.length,
    pagesScanned: report.results.length,
    severityCounts,
    violations,
  };
}

/**
 * Snapshot the existing summary (if any) to summary.previous.json so a later
 * comparison can compute resolved / remaining / new issues.
 */
function snapshotPrevious(): void {
  const { summary, previousSummary } = adaConfig.paths;
  if (fs.existsSync(summary)) {
    fs.copyFileSync(summary, previousSummary);
    log.info(`Previous summary snapshotted -> ${path.relative(process.cwd(), previousSummary)}`);
  }
}

/**
 * Entry point: generate summary.json from the raw axe report.
 */
function main(): void {
  try {
    log.info('Generating summary from raw axe report...');
    const report = readAxeReport();

    // Preserve the prior run for before/after comparison.
    snapshotPrevious();

    const summary = buildSummary(report);
    fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
    fs.writeFileSync(adaConfig.paths.summary, JSON.stringify(summary, null, 2), 'utf-8');

    log.info(
      `Summary written: ${summary.totalViolations} violation(s) across ` +
        `${summary.pagesScanned} page(s) -> ${path.relative(process.cwd(), adaConfig.paths.summary)}`
    );
    log.info('Severity counts', summary.severityCounts);
  } catch (err) {
    log.error('Failed to generate summary', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
