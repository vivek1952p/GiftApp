/**
 * AX Tree Rules — evaluate individual nodes in the Playwright browser
 * accessibility tree captured via Chrome DevTools Protocol.
 *
 * These rules catch issues that axe-core may miss because they operate on the
 * browser accessibility API layer rather than the DOM.
 */

import type { A11yTreeNode } from '../../types';
import type { AxTreeRule, RuleResult } from '../types';

const noName = (n: A11yTreeNode) => !n.name || n.name.trim() === '';

/** WCAG 1.1.1 — Images must have accessible names. */
export const AxImageAltRule: AxTreeRule = {
  id: 'ax-image-alt', source: 'ax-tree',
  description: 'Images exposed in the accessibility tree must have accessible names',
  evaluate(node: A11yTreeNode): RuleResult | null {
    if (node.role !== 'img' && node.role !== 'image') return null;
    if (!noName(node)) return null;
    return {
      issue: 'Image has no accessible name in the browser AX tree',
      severity: 'serious', wcag: '1.1.1',
      recommendation: 'Add alt text, aria-label, or aria-labelledby to the image.',
      context: { role: node.role },
    };
  },
};

/** WCAG 4.1.2 — Interactive elements must have accessible names. */
export const AxInteractiveNameRule: AxTreeRule = {
  id: 'ax-interactive-name', source: 'ax-tree',
  description: 'Interactive elements must have accessible names in the AX tree',
  evaluate(node: A11yTreeNode): RuleResult | null {
    const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'combobox', 'listbox', 'menuitem', 'tab', 'textbox', 'searchbox', 'slider', 'spinbutton', 'switch']);
    if (!INTERACTIVE_ROLES.has(node.role ?? '')) return null;
    if (!noName(node)) return null;
    return {
      issue: `${node.role} has no accessible name in the browser AX tree`,
      severity: 'serious', wcag: '4.1.2',
      recommendation: `Add aria-label, aria-labelledby, or visible label text to this ${node.role}.`,
      context: { role: node.role },
    };
  },
};

/** WCAG 1.3.1 — Headings should have non-empty text. */
export const AxEmptyHeadingRule: AxTreeRule = {
  id: 'ax-empty-heading', source: 'ax-tree',
  description: 'Headings must not be empty',
  evaluate(node: A11yTreeNode): RuleResult | null {
    if (!/^heading$/.test(node.role ?? '')) return null;
    if (!noName(node)) return null;
    return {
      issue: 'Heading element is empty (no accessible text content)',
      severity: 'moderate', wcag: '1.3.1',
      recommendation: 'Add descriptive text to the heading or remove it from the DOM.',
      context: { role: node.role },
    };
  },
};

/** WCAG 2.4.6 — Links with generic names provide no navigation context. */
export const AxGenericLinkRule: AxTreeRule = {
  id: 'ax-generic-link-name', source: 'ax-tree',
  description: 'Links should have descriptive names (not just "click here", "here", "more")',
  evaluate(node: A11yTreeNode): RuleResult | null {
    if (node.role !== 'link') return null;
    const GENERIC = new Set(['click here', 'here', 'more', 'read more', 'learn more', 'link', 'click']);
    if (!GENERIC.has((node.name ?? '').trim().toLowerCase())) return null;
    return {
      issue: `Link name "${node.name}" is generic and provides no out-of-context navigation cue`,
      severity: 'moderate', wcag: '2.4.6',
      recommendation: 'Use a descriptive link name that makes sense out of context (e.g. "Read the annual report").',
      context: { role: 'link', name: node.name },
    };
  },
};

export const allAxTreeRules: AxTreeRule[] = [
  AxImageAltRule,
  AxInteractiveNameRule,
  AxEmptyHeadingRule,
  AxGenericLinkRule,
];
