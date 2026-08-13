/**
 * ============================================================================
 * Unit tests for the merge-report.ts correlation/confidence logic
 * ============================================================================
 *
 * These protect the cross-scanner correlation logic from silent regressions
 * (e.g. a schema change to uia-tree.json that quietly zeroes out a whole
 * verification source without any error). Run via `npm test`.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  describeCorrelation,
  hasNoName,
  matchesUiaRuleEngine,
  verifyInA11y,
  verifyInDom,
  verifyInScreenReader,
  verifyInUia,
} from './merge-report';
import type {
  A11yPageTree,
  DomPageSnapshot,
  ScreenReaderFinding,
  SummaryViolation,
  UiaPageResult,
} from './types';

function violation(overrides: Partial<SummaryViolation> = {}): SummaryViolation {
  return {
    page: 'home',
    url: 'https://example.test/',
    ruleId: 'button-name',
    wcagRuleIds: ['wcag412'],
    description: 'Buttons must have discernible text',
    impact: 'serious',
    target: '#submit',
    html: '<button id="submit"></button>',
    helpUrl: 'https://dequeuniversity.com/rules/axe/button-name',
    ...overrides,
  };
}

describe('hasNoName', () => {
  test('treats undefined, empty, and whitespace-only names as missing', () => {
    assert.equal(hasNoName(undefined), true);
    assert.equal(hasNoName(''), true);
    assert.equal(hasNoName('   '), true);
    assert.equal(hasNoName('Submit'), false);
  });
});

describe('verifyInA11y', () => {
  const pageTree: A11yPageTree = {
    page: 'home',
    url: 'https://example.test/',
    timestamp: '2026-01-01T00:00:00.000Z',
    nodeCount: 2,
    tree: {
      role: 'generic',
      children: [{ role: 'button', name: '' }],
    },
  };

  test('confirmed when the flagged role exists with an empty name', () => {
    assert.equal(verifyInA11y(violation(), pageTree), 'confirmed');
  });

  test('not-detected when the role exists but already has a name', () => {
    const namedTree: A11yPageTree = {
      ...pageTree,
      tree: { role: 'generic', children: [{ role: 'button', name: 'Submit' }] },
    };
    assert.equal(verifyInA11y(violation(), namedTree), 'not-detected');
  });

  test('not-found when the role never appears in the tree', () => {
    const emptyTree: A11yPageTree = {
      ...pageTree,
      tree: { role: 'generic', children: [{ role: 'link', name: 'Home' }] },
    };
    assert.equal(verifyInA11y(violation(), emptyTree), 'not-found');
  });
});

describe('verifyInUia', () => {
  const uiaResult: UiaPageResult = {
    page: 'home',
    url: 'https://example.test/',
    timestamp: '2026-01-01T00:00:00.000Z',
    available: true,
    nodeCount: 2,
    tree: {
      name: '',
      role: 'PaneControl',
      automationId: '',
      children: [{ name: '', role: 'ButtonControl', automationId: 'submit', children: [] }],
    },
  };

  test('unavailable when UIA did not run on this host', () => {
    // This is the regression this suite exists to catch: a schema/availability
    // change here should fail loudly instead of silently reporting 'not-found'.
    assert.equal(verifyInUia(violation(), uiaResult, false), 'unavailable');
  });

  test('confirmed when UIA is available and the control has an empty name', () => {
    assert.equal(verifyInUia(violation(), uiaResult, true), 'confirmed');
  });
});

describe('verifyInDom', () => {
  const domPage: DomPageSnapshot = {
    page: 'home',
    url: 'https://example.test/',
    timestamp: '2026-01-01T00:00:00.000Z',
    nodeCount: 1,
    html: '<html></html>',
    elements: [{ target: '#submit', color: '#000', effectiveBackgroundColor: '#fff' }],
  };

  test('confirmed when the target selector matches a captured DOM element', () => {
    assert.equal(verifyInDom(violation(), domPage).status, 'confirmed');
  });

  test('not-found when no element in the snapshot matches the target', () => {
    assert.equal(verifyInDom(violation({ target: '#missing' }), domPage).status, 'not-found');
  });
});

describe('matchesUiaRuleEngine', () => {
  test('true when the Rule Engine independently flagged the same page/base type', () => {
    const keys = new Set(['home::Button']);
    assert.equal(matchesUiaRuleEngine(violation(), keys), true);
  });

  test('false when no matching key is present', () => {
    const keys = new Set(['other-page::Button']);
    assert.equal(matchesUiaRuleEngine(violation(), keys), false);
  });
});

describe('verifyInScreenReader', () => {
  const findings: ScreenReaderFinding[] = [
    {
      page: 'home',
      url: 'https://example.test/',
      ruleId: 'button-name',
      target: '#submit',
      role: 'button',
      expectedName: '',
      announcedText: 'button',
      issue: 'NVDA announced "button" — no accessible name is spoken.',
      severity: 'serious',
      wcag: '4.1.2',
      recommendation: 'Provide an accessible name.',
    },
  ];

  test('unavailable when NVDA did not run on this host', () => {
    assert.equal(verifyInScreenReader(violation(), findings, false), 'unavailable');
  });

  test('confirmed when NVDA re-verified the same page/target', () => {
    assert.equal(verifyInScreenReader(violation(), findings, true), 'confirmed');
  });

  test('not-detected when NVDA has no matching finding for this target', () => {
    assert.equal(verifyInScreenReader(violation({ target: '#other' }), findings, true), 'not-detected');
  });
});

describe('describeCorrelation', () => {
  test('axe-core alone when nothing else confirms', () => {
    assert.equal(
      describeCorrelation('not-found', 'not-found', 'not-found', 'not-found'),
      'Detected by axe-core.'
    );
  });

  test('lists every confirming source, joined with "and"', () => {
    assert.equal(
      describeCorrelation('confirmed', 'confirmed', 'confirmed', 'confirmed'),
      'Confirmed by axe-core, Playwright Accessibility Tree, Windows UI Automation, DOM and NVDA (Screen Reader).'
    );
  });
});
