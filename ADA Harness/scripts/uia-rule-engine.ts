/**
 * ============================================================================
 * ADA Harness — Accessibility Rule Engine Runner
 * ============================================================================
 *
 * Runs the full unified Accessibility Rule Engine across ALL data sources
 * produced by earlier pipeline stages, writing findings to uia-findings.json.
 *
 * Pipeline position:  uia-scan.ts  ->  THIS  ->  merge-report.ts
 *
 * Rule sets evaluated:
 *   UIA rules        — raw UIA properties (Name, ControlType, IsEnabled, …)
 *                      turned into "what/why/which WCAG/how to fix" findings.
 *   DOM rules        — computed colour/font from dom-snapshot.json:
 *                        • color-contrast (WCAG 1.4.3)
 *                        • text-too-small (WCAG 1.4.4)
 *   AX-tree rules    — browser accessibility tree from playwright-a11y-tree.json:
 *                        • image missing alt text (WCAG 1.1.1)
 *                        • interactive element missing name (WCAG 4.1.2)
 *                        • empty heading (WCAG 1.3.1)
 *   ARIA-pattern rules — whole-page ARIA widget structure:
 *                        • tab ↔ tabpanel relationship (WCAG 1.3.1)
 *                        • menu/menubar structure (WCAG 1.3.1)
 *
 * DOM and AX-tree findings are emitted even when UIA is unavailable (Windows-
 * only), so they always appear in the merged report on every platform.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { AccessibilityRuleEngine, allRules } from './accessibility-rule-engine';
import { createLogger } from './logger';
import type {
  DomSnapshotReport,
  KeyboardReport,
  PlaywrightA11yReport,
  UiaFinding,
  UiaFindingsReport,
  UiaReport,
} from './types';

const log = createLogger('uia-rules');

/** Safely read + parse a JSON report file, returning null when absent. */
function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** Map unified AccessibilityFinding to legacy UiaFinding shape for downstream compatibility. */
function toUiaFinding(f: {
  ruleId: string;
  page: string;
  url: string;
  name?: string;
  role?: string;
  target?: string;
  issue: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  wcag: string;
  recommendation: string;
}): UiaFinding {
  return {
    ruleId: f.ruleId,
    page: f.page,
    url: f.url,
    controlType: f.role ?? '',
    automationId: '',
    name: f.name ?? f.target ?? '',
    issue: f.issue,
    severity: f.severity,
    wcag: f.wcag,
    recommendation: f.recommendation,
  };
}

/**
 * Build a set of element names confirmed reachable via browser Tab order,
 * keyed by page name, for cross-referencing with UIA findings.
 */
function buildKeyboardReachable(keyboardPath: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!fs.existsSync(keyboardPath)) return map;
  try {
    const report: KeyboardReport = JSON.parse(fs.readFileSync(keyboardPath, 'utf-8'));
    for (const result of report.results ?? []) {
      const names = new Set<string>();
      for (const step of result.tabOrder ?? []) {
        if (step.name) names.add(step.name.trim().toLowerCase());
      }
      map.set(result.page, names);
    }
  } catch {
    // If parsing fails, cross-referencing is skipped silently.
  }
  return map;
}

/** Tally findings by severity for the report header. */
function countSeverity(findings: UiaFinding[]) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/**
 * Entry point: load all available report artifacts, run all rule sets, write
 * uia-findings.json.
 */
function main(): void {
  try {
    fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });

    // ── Load data sources (all optional — each rule set degrades gracefully) ──

    const uia = readJson<UiaReport>(adaConfig.paths.uiaTree);
    const dom = readJson<DomSnapshotReport>(adaConfig.paths.domSnapshot);
    const a11y = readJson<PlaywrightA11yReport>(adaConfig.paths.a11yTree);

    if (!uia && !dom && !a11y) {
      log.warn('No report artifacts found — writing empty uia-findings.json.');
      const emptyReport: UiaFindingsReport = {
        generatedAt: new Date().toISOString(),
        baseUrl: adaConfig.baseUrl,
        totalFindings: 0,
        severityCounts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
        findings: [],
      };
      fs.writeFileSync(adaConfig.paths.uiaFindings, JSON.stringify(emptyReport, null, 2), 'utf-8');
      return;
    }

    // ── Run unified rule engine across all available sources ──────────────────

    const engine = new AccessibilityRuleEngine(allRules);
    const documentOnly = adaConfig.uia.documentOnly ?? true;

    const rawFindings = engine
      .evaluateAll({
        uia: uia ?? undefined,
        dom: dom ?? undefined,
        a11y: a11y ?? undefined,
        documentOnly,
      })
      .map(toUiaFinding);

    // ── Suppress known false-positive: UIA keyboard-focusable ─────────────────
    // If an element is confirmed reachable via Tab in the browser, the UIA
    // IsKeyboardFocusable=false report is a false positive (UIA/browser mismatch).
    const kbReachable = buildKeyboardReachable(adaConfig.paths.keyboardReport);
    const findings: UiaFinding[] = rawFindings.filter((f) => {
      if (f.ruleId !== 'uia-keyboard-focusable') return true;
      const pageReachable = kbReachable.get(f.page);
      if (!pageReachable) return true;
      const isTabReachable = f.name && pageReachable.has(f.name.trim().toLowerCase());
      if (isTabReachable) {
        log.info(
          `Suppressed false-positive uia-keyboard-focusable for "${f.name}" on ${f.page} ` +
            `(confirmed reachable by Tab in keyboard-report.json)`
        );
        return false;
      }
      return true;
    });

    // ── Write report ──────────────────────────────────────────────────────────

    const report: UiaFindingsReport = {
      generatedAt: new Date().toISOString(),
      baseUrl: adaConfig.baseUrl,
      totalFindings: findings.length,
      severityCounts: countSeverity(findings),
      findings,
    };

    fs.writeFileSync(adaConfig.paths.uiaFindings, JSON.stringify(report, null, 2), 'utf-8');

    const sourcesSummary =
      [uia?.available ? 'UIA' : null, dom ? 'DOM' : null, a11y ? 'AX-tree' : null]
        .filter(Boolean)
        .join(', ') || 'none';

    log.info(
      `Rule Engine: evaluated sources [${sourcesSummary}] with ${allRules.length} rule(s); ` +
        `${findings.length} finding(s) -> ${path.relative(process.cwd(), adaConfig.paths.uiaFindings)}`
    );
    log.info('Severity counts', report.severityCounts);
  } catch (err) {
    log.error('Accessibility Rule Engine failed', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
