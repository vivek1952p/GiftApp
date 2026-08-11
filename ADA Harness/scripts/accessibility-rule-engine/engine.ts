/**
 * ============================================================================
 * Accessibility Rule Engine — Unified Evaluator
 * ============================================================================
 *
 * One engine that accepts all data sources (UIA tree, DOM snapshot, AX tree)
 * and runs the appropriate rule sets against each. Produces a single flat list
 * of `AccessibilityFinding`s that feed into the report merger.
 *
 * Design (Open/Closed): to add a new rule, create a rule object and register
 * it in rules/index.ts. No engine code changes.
 * ============================================================================
 */

import type {
    A11yTreeNode,
    DomElementStyle,
    DomSnapshotReport,
    PlaywrightA11yReport,
    UiaReport
} from '../types';
import type {
    AccessibilityFinding,
    AnyRule,
    AriaPatternRule,
    AxTreeRule,
    DomRule,
    RuleResult,
    UiaRule,
} from './types';
import { flattenScoped } from './uia-parser';

export { flattenScoped };

// ── Type guards ────────────────────────────────────────────────────────────

function isUiaRule(r: AnyRule): r is UiaRule        { return r.source === 'uia'; }
function isDomRule(r: AnyRule): r is DomRule         { return r.source === 'dom'; }
function isAxRule(r: AnyRule): r is AxTreeRule       { return r.source === 'ax-tree'; }
function isAriaRule(r: AnyRule): r is AriaPatternRule{ return r.source === 'aria-pattern'; }

// ── Helpers ────────────────────────────────────────────────────────────────

function finding(
  rule: AnyRule,
  page: string,
  url: string,
  result: RuleResult
): AccessibilityFinding {
  return {
    ruleId: rule.id,
    source: rule.source,
    page,
    url,
    issue: result.issue,
    severity: result.severity,
    wcag: result.wcag,
    recommendation: result.recommendation,
    ...(result.context ?? {}),
  };
}

/** Depth-first walk of an AX tree, calling `fn` on every node. */
function walkAxTree(node: A11yTreeNode | null, fn: (n: A11yTreeNode) => void): void {
  if (!node) return;
  fn(node);
  for (const child of (node.children ?? []) as A11yTreeNode[]) walkAxTree(child, fn);
}

// ── Engine ─────────────────────────────────────────────────────────────────

/**
 * Unified Accessibility Rule Engine.
 *
 * Register rules once at construction time. Call `evaluateAll()` to run all
 * rule sets and get a flat list of findings.
 */
export class AccessibilityRuleEngine {
  private readonly rules: AnyRule[];

  constructor(rules: AnyRule[]) {
    this.rules = rules;
  }

  /** Evaluate UIA tree rules. */
  evaluateUia(uia: UiaReport, documentOnly = true): AccessibilityFinding[] {
    if (!uia.available) return [];
    const uiaRules = this.rules.filter(isUiaRule);
    const elements = flattenScoped(uia.results, documentOnly);
    const findings: AccessibilityFinding[] = [];

    for (const el of elements) {
      for (const rule of uiaRules) {
        const result = rule.evaluate(el);
        if (!result) continue;
        findings.push(finding(rule, el.page, el.url, {
          ...result,
          context: { name: el.name, role: el.controlType, ...result.context },
        }));
      }
    }
    return findings;
  }

  /** Evaluate DOM snapshot rules. */
  evaluateDom(dom: DomSnapshotReport): AccessibilityFinding[] {
    const domRules = this.rules.filter(isDomRule);
    if (!domRules.length) return [];
    const findings: AccessibilityFinding[] = [];

    for (const page of dom.results ?? []) {
      for (const el of page.elements ?? []) {
        for (const rule of domRules) {
          const result = rule.evaluate(el as DomElementStyle, page.page, page.url);
          if (!result) continue;
          findings.push(finding(rule, page.page, page.url, {
            ...result,
            context: { target: el.target, ...result.context },
          }));
        }
      }
    }
    return findings;
  }

  /** Evaluate AX tree rules (per-node). */
  evaluateAxTree(a11y: PlaywrightA11yReport): AccessibilityFinding[] {
    const axRules = this.rules.filter(isAxRule);
    if (!axRules.length) return [];
    const findings: AccessibilityFinding[] = [];

    for (const page of a11y.results ?? []) {
      walkAxTree(page.tree, (node) => {
        for (const rule of axRules) {
          const result = rule.evaluate(node, page.page, page.url);
          if (!result) continue;
          findings.push(finding(rule, page.page, page.url, {
            ...result,
            context: { role: node.role, name: node.name, ...result.context },
          }));
        }
      });
    }
    return findings;
  }

  /** Evaluate ARIA pattern rules (per-page, whole tree). */
  evaluateAriaPatterns(a11y: PlaywrightA11yReport): AccessibilityFinding[] {
    const ariaRules = this.rules.filter(isAriaRule);
    if (!ariaRules.length) return [];
    const findings: AccessibilityFinding[] = [];

    for (const page of a11y.results ?? []) {
      for (const rule of ariaRules) {
        const results = rule.evaluatePage(page.tree, page.page, page.url);
        for (const result of results) {
          findings.push(finding(rule, page.page, page.url, result));
        }
      }
    }
    return findings;
  }

  /**
   * Run all rule sets against all available data sources and return the
   * combined, deduplicated finding list.
   */
  evaluateAll(opts: {
    uia?: UiaReport;
    dom?: DomSnapshotReport;
    a11y?: PlaywrightA11yReport;
    documentOnly?: boolean;
  }): AccessibilityFinding[] {
    const findings: AccessibilityFinding[] = [];
    if (opts.uia)   findings.push(...this.evaluateUia(opts.uia, opts.documentOnly ?? true));
    if (opts.dom)   findings.push(...this.evaluateDom(opts.dom));
    if (opts.a11y)  findings.push(...this.evaluateAxTree(opts.a11y));
    if (opts.a11y)  findings.push(...this.evaluateAriaPatterns(opts.a11y));
    return findings;
  }
}
