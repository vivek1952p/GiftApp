/**
 * ============================================================================
 * Shared interactive-element selector
 * ============================================================================
 *
 * The single definition of "what counts as an interactive/focusable element"
 * for the harness — used by the keyboard/Tab-order scan
 * (playwright/accessibility.spec.ts) and the Focus Management Engine's
 * focus-visible sweep, so both agree on the same population of elements
 * instead of drifting apart with two separately-maintained selectors.
 * ============================================================================
 */

export const INTERACTIVE_ELEMENT_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex],' +
  ' [role="button"], [role="link"], [role="checkbox"], [role="tab"], [contenteditable="true"]';
