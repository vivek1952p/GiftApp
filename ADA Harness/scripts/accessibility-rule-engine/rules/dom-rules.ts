/**
 * DOM Snapshot Rules — evaluate computed styles and HTML attributes captured
 * in dom-snapshot.json. Catches visual and structural issues the accessibility
 * tree cannot expose (e.g. colour contrast from real rendered values).
 */

import type { DomElementStyle } from '../../types';
import type { DomRule, RuleResult } from '../types';

/** Parse "rgb(r, g, b)" or "rgba(r, g, b, a)" into [r,g,b]. */
function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [+m[1], +m[2], +m[3]];
}

/** sRGB → linear (WCAG formula). */
function linearise(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Relative luminance (WCAG 2.x). */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** Contrast ratio between two RGB colours. */
function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const L1 = luminance(fg), L2 = luminance(bg);
  const [light, dark] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (light + 0.05) / (dark + 0.05);
}

/** px string → number. */
function px(size: string): number {
  return parseFloat(size) || 0;
}

/** Required contrast ratio per WCAG 2.1 AA (large text ≥ 18pt normal or 14pt bold = 3:1, else 4.5:1). */
function requiredRatio(fontSize: string, fontWeight: string): number {
  const size = px(fontSize);
  const bold = fontWeight === 'bold' || +fontWeight >= 700;
  return (size >= 24 || (size >= 18.67 && bold)) ? 3 : 4.5;
}

// ── Rules ────────────────────────────────────────────────────────────────

/** WCAG 1.4.3 — Contrast (Minimum). */
export const DomContrastRule: DomRule = {
  id: 'dom-color-contrast', source: 'dom',
  description: 'Text must meet WCAG 2.1 AA minimum contrast ratio',
  evaluate(el: DomElementStyle): RuleResult | null {
    const fg = parseRgb(el.color ?? '');
    // Prefer the effective (ancestor-composited) background — the element's own
    // `backgroundColor` is transparent for most real-world text elements (span,
    // p, li, …), which don't set a background themselves. Falling back to the
    // raw value only covers the older report shape.
    const bgSource = el.effectiveBackgroundColor ?? el.backgroundColor ?? '';
    const bg = parseRgb(bgSource);
    if (!fg || !bg) return null;

    const ratio = contrastRatio(fg, bg);
    const required = requiredRatio(el.fontSize ?? '16px', el.fontWeight ?? '400');
    if (ratio >= required) return null;

    return {
      issue: `Insufficient colour contrast ${ratio.toFixed(2)}:1 on "${(el.text ?? '').slice(0, 60)}" (required ${required}:1)`,
      severity: ratio < 3 ? 'serious' : 'moderate',
      wcag: '1.4.3',
      recommendation: `Darken the foreground (${el.color}) or lighten the background (${bgSource}) until contrast ≥ ${required}:1.`,
      context: { target: el.target },
    };
  },
};

/** WCAG 1.4.4 — Resize Text: text set in px smaller than 10px is hard to resize. */
export const DomSmallTextRule: DomRule = {
  id: 'dom-text-too-small', source: 'dom',
  description: 'Text should not be smaller than 10 px to support browser zoom',
  evaluate(el: DomElementStyle): RuleResult | null {
    if (px(el.fontSize ?? '16px') >= 10) return null;
    return {
      issue: `Text is ${el.fontSize} — too small to read at default zoom (min recommended 10 px)`,
      severity: 'minor', wcag: '1.4.4',
      recommendation: 'Use relative units (rem/em) and a minimum font size of 0.625rem (10 px).',
      context: { target: el.target },
    };
  },
};

export const allDomRules: DomRule[] = [DomContrastRule, DomSmallTextRule];
