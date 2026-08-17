/**
 * ============================================================================
 * WCAG 2.2 A/AA Success-Criterion Catalog
 * ============================================================================
 *
 * Static reference data used by coverage.ts to report which WCAG success
 * criteria this harness can detect at all, as opposed to which ones it found
 * issues for in a specific scan. The SC list itself is specification content
 * (W3C WCAG 2.2) and doesn't change per project — same spirit as the
 * hand-maintained NAME_RULES table in merge-report.ts.
 *
 * WCAG 2.2 matches config.json's axe wcagTags (which already requests
 * wcag22a/wcag22aa, not just wcag21a/wcag21aa). Relative to 2.1: 4.1.1
 * Parsing was removed (obsolete — modern browsers handle malformed markup
 * robustly), and six new A/AA criteria were added: 2.4.11, 2.5.7, 2.5.8,
 * 3.2.6, 3.3.7, 3.3.8 (2.4.12, 2.4.13, and 3.3.9 are AAA-only and out of
 * scope for this A/AA catalog).
 * ============================================================================
 */

import {
  allAriaPatternRules,
  allAxTreeRules,
  allDomRules,
  allUiaRules,
} from './accessibility-rule-engine/rules';
import type { AnyRule } from './accessibility-rule-engine/types';

/** Every WCAG success criterion at least one rule in a registry reports, deduplicated. */
function wcagCapabilityOf(rules: AnyRule[]): string[] {
  return [...new Set(rules.map((r) => r.wcag))];
}

export interface WcagCriterion {
  id: string;
  name: string;
  level: 'A' | 'AA';
}

/** All 55 WCAG 2.2 Level A + AA success criteria. */
export const WCAG_AA_CRITERIA: WcagCriterion[] = [
  { id: '1.1.1', name: 'Non-text Content', level: 'A' },
  { id: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A' },
  { id: '1.2.2', name: 'Captions (Prerecorded)', level: 'A' },
  { id: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A' },
  { id: '1.2.4', name: 'Captions (Live)', level: 'AA' },
  { id: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA' },
  { id: '1.3.1', name: 'Info and Relationships', level: 'A' },
  { id: '1.3.2', name: 'Meaningful Sequence', level: 'A' },
  { id: '1.3.3', name: 'Sensory Characteristics', level: 'A' },
  { id: '1.3.4', name: 'Orientation', level: 'AA' },
  { id: '1.3.5', name: 'Identify Input Purpose', level: 'AA' },
  { id: '1.4.1', name: 'Use of Color', level: 'A' },
  { id: '1.4.2', name: 'Audio Control', level: 'A' },
  { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA' },
  { id: '1.4.4', name: 'Resize Text', level: 'AA' },
  { id: '1.4.5', name: 'Images of Text', level: 'AA' },
  { id: '1.4.10', name: 'Reflow', level: 'AA' },
  { id: '1.4.11', name: 'Non-text Contrast', level: 'AA' },
  { id: '1.4.12', name: 'Text Spacing', level: 'AA' },
  { id: '1.4.13', name: 'Content on Hover or Focus', level: 'AA' },
  { id: '2.1.1', name: 'Keyboard', level: 'A' },
  { id: '2.1.2', name: 'No Keyboard Trap', level: 'A' },
  { id: '2.1.4', name: 'Character Key Shortcuts', level: 'A' },
  { id: '2.2.1', name: 'Timing Adjustable', level: 'A' },
  { id: '2.2.2', name: 'Pause, Stop, Hide', level: 'A' },
  { id: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A' },
  { id: '2.4.1', name: 'Bypass Blocks', level: 'A' },
  { id: '2.4.2', name: 'Page Titled', level: 'A' },
  { id: '2.4.3', name: 'Focus Order', level: 'A' },
  { id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A' },
  { id: '2.4.5', name: 'Multiple Ways', level: 'AA' },
  { id: '2.4.6', name: 'Headings and Labels', level: 'AA' },
  { id: '2.4.7', name: 'Focus Visible', level: 'AA' },
  { id: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA' },
  { id: '2.5.1', name: 'Pointer Gestures', level: 'A' },
  { id: '2.5.2', name: 'Pointer Cancellation', level: 'A' },
  { id: '2.5.3', name: 'Label in Name', level: 'A' },
  { id: '2.5.4', name: 'Motion Actuation', level: 'A' },
  { id: '2.5.7', name: 'Dragging Movements', level: 'AA' },
  { id: '2.5.8', name: 'Target Size (Minimum)', level: 'AA' },
  { id: '3.1.1', name: 'Language of Page', level: 'A' },
  { id: '3.1.2', name: 'Language of Parts', level: 'AA' },
  { id: '3.2.1', name: 'On Focus', level: 'A' },
  { id: '3.2.2', name: 'On Input', level: 'A' },
  { id: '3.2.3', name: 'Consistent Navigation', level: 'AA' },
  { id: '3.2.4', name: 'Consistent Identification', level: 'AA' },
  { id: '3.2.6', name: 'Consistent Help', level: 'A' },
  { id: '3.3.1', name: 'Error Identification', level: 'A' },
  { id: '3.3.2', name: 'Labels or Instructions', level: 'A' },
  { id: '3.3.3', name: 'Error Suggestion', level: 'AA' },
  { id: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA' },
  { id: '3.3.7', name: 'Redundant Entry', level: 'A' },
  { id: '3.3.8', name: 'Accessible Authentication (Minimum)', level: 'AA' },
  { id: '4.1.2', name: 'Name, Role, Value', level: 'A' },
  { id: '4.1.3', name: 'Status Messages', level: 'AA' },
];

/**
 * WCAG success criteria each harness source is capable of producing a
 * finding for, independent of any specific scan's results. Sourced from the
 * hardcoded `wcag` values in each rule/engine's own code:
 *   - axe-core: axe's own publicly documented WCAG 2.1 A/AA rule coverage
 *     (https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md),
 *     restricted to the criteria its bundled ruleset commonly maps to.
 *   - ax-tree / uia / dom / aria-pattern: derived below from each rule's own
 *     static `wcag` field in scripts/accessibility-rule-engine/rules/*.ts, so
 *     adding, removing, or re-mapping a rule can't silently desync this table
 *     the way the old hand-typed arrays could (and once did).
 *   - keyboard: playwright/accessibility.spec.ts (buildKeyboardFindings)
 *   - expected-focus / widget-behavior / focus-management / interaction-prediction:
 *     each engine's own scripts/*-engine.ts
 *   - screen-reader: re-verifies the same missing-name rule ids merge-report.ts's
 *     NAME_RULES table already tracks (targeted v1 scope)
 */
export const CAPABILITY: Record<string, string[]> = {
  axe: [
    '1.1.1',
    '1.2.2',
    '1.3.1',
    '1.3.2',
    '1.3.4',
    '1.3.5',
    '1.4.1',
    '1.4.2',
    '1.4.3',
    '1.4.4',
    '1.4.10',
    '1.4.11',
    '1.4.12',
    '1.4.13',
    '2.1.1',
    '2.1.4',
    '2.2.2',
    '2.4.1',
    '2.4.2',
    '2.4.3',
    '2.4.4',
    '2.4.6',
    '2.4.7',
    '2.5.3',
    '2.5.8',
    '3.1.1',
    '3.1.2',
    '3.2.1',
    '3.2.2',
    '3.3.2',
    '4.1.2',
    '4.1.3',
  ],
  'ax-tree': wcagCapabilityOf(allAxTreeRules),
  uia: wcagCapabilityOf(allUiaRules),
  dom: wcagCapabilityOf(allDomRules),
  'aria-pattern': wcagCapabilityOf(allAriaPatternRules),
  keyboard: ['2.1.1', '2.4.3'],
  'expected-focus': ['2.1.1', '2.4.3', '4.1.2'],
  'widget-behavior': ['2.1.1', '2.1.2'],
  'focus-management': ['2.4.3', '2.4.7'],
  'interaction-prediction': ['2.1.1'],
  'screen-reader': ['1.1.1', '4.1.2'],
};
