/**
 * UIA Rules — moved from scripts/rule-engine/rules.ts into the unified engine.
 * All rules evaluate a single flattened UIA element.
 */

import type { FlatUiaElement, RuleResult, UiaRule } from '../types';

const INTERACTIVE = new Set([
  'Button','Edit','CheckBox','RadioButton','ComboBox',
  'Hyperlink','Slider','MenuItem','TabItem',
]);

function noName(el: FlatUiaElement): boolean {
  return !el.name || el.name.trim() === '';
}

function nameRule(
  id: string, baseType: string, issue: string,
  severity: RuleResult['severity'], wcag = '4.1.2',
  recommendation = 'Provide an accessible name (aria-label, associated label, or visible text).'
): UiaRule {
  return {
    id, source: 'uia',
    description: `${baseType} must have an accessible name`,
    evaluate(el) {
      if (el.baseType !== baseType || !noName(el)) return null;
      return { issue, severity, wcag, recommendation };
    },
  };
}

export const UiaButtonRule    = nameRule('uia-button-name',   'Button',      'Button has no accessible name',         'critical');
export const UiaImageRule     = nameRule('uia-image-name',    'Image',       'Image may be missing alt text',         'serious',  '1.1.1', 'Add a descriptive alt attribute (or empty alt="" if decorative).');
export const UiaInputRule     = nameRule('uia-input-name',    'Edit',        'Input field has no accessible label',   'critical', '4.1.2', 'Associate a <label> or add aria-label to the input.');
export const UiaCheckboxRule  = nameRule('uia-checkbox-name', 'CheckBox',    'Checkbox has no accessible name',       'serious');
export const UiaRadioRule     = nameRule('uia-radio-name',    'RadioButton', 'Radio button is unlabeled',             'serious');
export const UiaComboBoxRule  = nameRule('uia-combobox-name', 'ComboBox',    'Combobox has no accessible name',       'serious');
export const UiaTreeItemRule  = nameRule('uia-treeitem-name', 'TreeItem',    'Tree item has no accessible name',      'moderate');
export const UiaMenuItemRule  = nameRule('uia-menuitem-name', 'MenuItem',    'Menu item has no accessible name',      'serious');
export const UiaTabRule       = nameRule('uia-tab-name',      'TabItem',     'Tab has no accessible name',            'serious');
export const UiaHyperlinkRule = nameRule('uia-link-name',     'Hyperlink',   'Hyperlink has no accessible name',      'serious',  '2.4.4', 'Provide descriptive link text or aria-label.');
export const UiaSliderRule    = nameRule('uia-slider-name',   'Slider',      'Slider has no accessible name',         'serious');

export const UiaProgressRule: UiaRule = {
  id: 'uia-progressbar-desc', source: 'uia',
  description: 'ProgressBar should have an accessible name/description',
  evaluate(el) {
    if (el.baseType !== 'ProgressBar' || !noName(el)) return null;
    return { issue: 'Progress bar has no accessible description', severity: 'moderate', wcag: '1.1.1', recommendation: 'Add aria-label / aria-describedby describing the progress.' };
  },
};

export const UiaKeyboardRule: UiaRule = {
  id: 'uia-keyboard-focusable', source: 'uia',
  description: 'Interactive controls must be keyboard focusable',
  evaluate(el) {
    if (!INTERACTIVE.has(el.baseType)) return null;
    if (el.isKeyboardFocusable !== false) return null;
    if (el.isEnabled === false) return null;
    return {
      issue: `${el.baseType} reports IsKeyboardFocusable=false in Windows UIA (verify Tab reachability)`,
      severity: 'moderate', wcag: '2.1.1',
      recommendation: 'Cross-check with keyboard-report.json. If reachable via Tab, add automationId or use a native focusable element.',
    };
  },
};

export const UiaVisibilityRule: UiaRule = {
  id: 'uia-offscreen-interactive', source: 'uia',
  description: 'Interactive controls should not be unexpectedly offscreen',
  evaluate(el) {
    if (!INTERACTIVE.has(el.baseType) || el.isOffscreen !== true || el.isEnabled === false) return null;
    return { issue: `Potentially hidden interactive ${el.baseType} (offscreen but enabled)`, severity: 'moderate', wcag: '1.3.1', recommendation: 'Verify the control is intentionally hidden; if active, ensure it is visible and reachable.' };
  },
};

export const UiaEnabledRule: UiaRule = {
  id: 'uia-disabled-interactive', source: 'uia',
  description: 'Flag disabled interactive controls for review',
  evaluate(el) {
    if (!INTERACTIVE.has(el.baseType) || el.isEnabled !== false) return null;
    return { issue: `${el.baseType} is disabled — verify this is intended`, severity: 'minor', wcag: '1.3.1', recommendation: 'Ensure disabled state is communicated to AT via aria-disabled="true" and is intentional.' };
  },
};

export const allUiaRules: UiaRule[] = [
  UiaButtonRule, UiaImageRule, UiaInputRule, UiaCheckboxRule, UiaRadioRule,
  UiaComboBoxRule, UiaTreeItemRule, UiaMenuItemRule, UiaTabRule, UiaHyperlinkRule,
  UiaSliderRule, UiaProgressRule, UiaKeyboardRule, UiaVisibilityRule, UiaEnabledRule,
];
