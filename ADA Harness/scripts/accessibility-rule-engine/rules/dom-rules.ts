/**
 * DOM Snapshot Rules — evaluate computed styles and HTML attributes captured
 * in dom-snapshot.json. Catches visual and structural issues the accessibility
 * tree cannot expose.
 *
 * Colour contrast is intentionally NOT re-checked here: axe-core's
 * `color-contrast` rule already covers it (and more robustly — gradients,
 * layered/overlapping elements, alpha compositing), and merge-report.ts
 * already attaches this snapshot's computed styles to those axe findings via
 * `domProperties`/`verifiedIn.dom`. A parallel `dom-color-contrast` rule here
 * used to flag the exact same elements a second time, double-counting every
 * contrast issue in totalFindings/severityCounts.
 */

import type { DomElementStyle } from '../../types';
import type { DomRule, RuleResult } from '../types';

/** px string → number. */
function px(size: string): number {
  return parseFloat(size) || 0;
}

// ── Rules ────────────────────────────────────────────────────────────────

/** WCAG 1.4.4 — Resize Text: text set in px smaller than 10px is hard to resize. */
export const DomSmallTextRule: DomRule = {
  id: 'dom-text-too-small',
  source: 'dom',
  description: 'Text should not be smaller than 10 px to support browser zoom',
  wcag: '1.4.4',
  evaluate(el: DomElementStyle): RuleResult | null {
    if (px(el.fontSize ?? '16px') >= 10) return null;
    return {
      issue: `Text is ${el.fontSize} — too small to read at default zoom (min recommended 10 px)`,
      severity: 'minor',
      wcag: this.wcag,
      recommendation: 'Use relative units (rem/em) and a minimum font size of 0.625rem (10 px).',
      context: { target: el.target },
    };
  },
};

export const allDomRules: DomRule[] = [DomSmallTextRule];
