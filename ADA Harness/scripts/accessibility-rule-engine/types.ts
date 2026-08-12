/**
 * ============================================================================
 * Accessibility Rule Engine — Shared Types
 * ============================================================================
 *
 * Source-agnostic contracts used by every rule set (UIA, DOM, AX-tree, ARIA
 * pattern). Rules receive a typed context object and return a finding or null.
 * ============================================================================
 */

import type { A11yTreeNode, DomElementStyle, UiaSeverity, FlatUiaElement as _FlatUiaElement } from '../types';

export type Severity = UiaSeverity;

// Re-export so rule files only need one import path.
export type { _FlatUiaElement as FlatUiaElement };

// ── Finding ────────────────────────────────────────────────────────────────

/** Unified finding produced by any rule in any rule set. */
export interface AccessibilityFinding {
  ruleId: string;
  /** Which data source produced the finding. */
  source: 'uia' | 'dom' | 'ax-tree' | 'aria-pattern' | 'keyboard';
  page: string;
  url: string;
  /** CSS selector or UIA control path identifying the element. */
  target?: string;
  /** Outer HTML of the offending element (when available). */
  html?: string;
  /** Accessible name (from UIA or AX tree). */
  name?: string;
  /** ARIA / UIA role. */
  role?: string;
  issue: string;
  severity: Severity;
  wcag: string;
  recommendation: string;
}

// ── Rule interfaces ────────────────────────────────────────────────────────

/** A rule that evaluates a single flattened UIA element. */
export interface UiaRule {
  readonly id: string;
  readonly description: string;
  readonly source: 'uia';
  evaluate(el: _FlatUiaElement): RuleResult | null;
}

/** A rule that evaluates a single DOM element style record. */
export interface DomRule {
  readonly id: string;
  readonly description: string;
  readonly source: 'dom';
  evaluate(el: DomElementStyle, page: string, url: string): RuleResult | null;
}

/** A rule that evaluates a single AX-tree node in context. */
export interface AxTreeRule {
  readonly id: string;
  readonly description: string;
  readonly source: 'ax-tree';
  evaluate(node: A11yTreeNode, page: string, url: string): RuleResult | null;
}

/** A rule that evaluates ARIA relationships across a full page's AX tree. */
export interface AriaPatternRule {
  readonly id: string;
  readonly description: string;
  readonly source: 'aria-pattern';
  evaluatePage(tree: A11yTreeNode | null, page: string, url: string): RuleResult[];
}

/** Union of all rule types. */
export type AnyRule = UiaRule | DomRule | AxTreeRule | AriaPatternRule;

/** What a rule returns when it matches (null means the rule does not apply). */
export interface RuleResult {
  issue: string;
  severity: Severity;
  wcag: string;
  recommendation: string;
  /** Optional extra context (selector, HTML, name, role). */
  context?: {
    target?: string;
    html?: string;
    name?: string;
    role?: string;
  };
}
