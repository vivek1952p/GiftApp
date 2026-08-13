/**
 * ============================================================================
 * Unit tests for expected-focus-engine.ts's Check 1 / Check 2 correlation
 * ============================================================================
 *
 * Regression test for a real bug found in the field: an <input> whose only
 * label source is `placeholder` produced two CONTRADICTORY findings for the
 * same element — Check 1 said "never reached" (because the AX tree credits
 * `placeholder` as a name but the keyboard scan's own heuristic doesn't, so
 * the name-string match failed), while Check 2 correctly said "reached but
 * unnamed" at the same Tab position. Run via `npm test`.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { analyseGaps } from './expected-focus-engine';
import type { A11yTreeNode, KeyboardPageResult } from './types';

const page = { page: 'Home', url: 'https://example.test/' };

describe('analyseGaps — placeholder-only-labelled input (regression)', () => {
  // AX tree: browser's real accname algorithm credits `placeholder` as a
  // fallback name, so the search input shows up named "Search products".
  const tree: A11yTreeNode = {
    role: 'generic',
    children: [{ role: 'textbox', name: 'Search products' }],
  };

  // Keyboard scan: its own heuristic (aria-label || textContent || name || id)
  // does not consider `placeholder`, so the SAME element is recorded with an
  // empty name at Tab position 6.
  const kbPage: KeyboardPageResult = {
    page: 'Home',
    url: 'https://example.test/',
    timestamp: '2026-01-01T00:00:00.000Z',
    reached: 6,
    interactiveTotal: 6,
    tabOrder: [
      { order: 1, tag: 'a', name: 'Home', kb: null },
      { order: 6, tag: 'input', name: '', kb: null },
    ],
    unreachable: [],
    positiveTabindex: [],
  };

  test('does not report Check 1 "never reached" once Check 2 already explains the same element', () => {
    const gaps = analyseGaps({ ...page, tree }, kbPage);
    const neverReached = gaps.filter((g) => g.issue.includes('never reached'));
    assert.equal(neverReached.length, 0, 'Check 1 should not double-report the same element');
  });

  test('still reports Check 2 "reached but unnamed" for the real underlying issue', () => {
    const gaps = analyseGaps({ ...page, tree }, kbPage);
    const unnamed = gaps.filter((g) => g.issue.includes('no accessible name'));
    assert.equal(unnamed.length, 1);
    assert.equal(unnamed[0].wcag, '4.1.2');
  });
});

describe('analyseGaps — genuine unreachable element (no false negative introduced)', () => {
  test('still flags a real gap when nothing was reached at all', () => {
    const tree: A11yTreeNode = {
      role: 'generic',
      children: [{ role: 'button', name: 'Add to cart' }],
    };
    const kbPage: KeyboardPageResult = {
      page: 'Home',
      url: 'https://example.test/',
      timestamp: '2026-01-01T00:00:00.000Z',
      reached: 1,
      interactiveTotal: 1,
      tabOrder: [{ order: 1, tag: 'a', name: 'Home', kb: null }],
      unreachable: [],
      positiveTabindex: [],
    };

    const gaps = analyseGaps({ ...page, tree }, kbPage);
    const neverReached = gaps.filter((g) => g.issue.includes('never reached'));
    assert.equal(neverReached.length, 1, 'a genuinely unreached button must still be flagged');
    assert.equal(neverReached[0].role, 'button');
  });

  test('does not let an unrelated unnamed element mask a genuine gap of a different tag', () => {
    // A reached-but-unnamed <a> should NOT be allowed to absorb a deficit for
    // a missing "textbox" (input/textarea only) — tags must actually match.
    const tree: A11yTreeNode = {
      role: 'generic',
      children: [{ role: 'textbox', name: 'Email' }],
    };
    const kbPage: KeyboardPageResult = {
      page: 'Home',
      url: 'https://example.test/',
      timestamp: '2026-01-01T00:00:00.000Z',
      reached: 1,
      interactiveTotal: 1,
      tabOrder: [{ order: 1, tag: 'a', name: '', kb: null }],
      unreachable: [],
      positiveTabindex: [],
    };

    const gaps = analyseGaps({ ...page, tree }, kbPage);
    const neverReached = gaps.filter((g) => g.issue.includes('never reached'));
    assert.equal(neverReached.length, 1, 'an unnamed <a> must not mask a missing textbox');
  });
});
