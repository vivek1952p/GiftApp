export { allAriaPatternRules } from './aria-pattern-rules';
export { allAxTreeRules } from './ax-tree-rules';
export { allDomRules } from './dom-rules';
export { allUiaRules } from './uia-rules';

import type { AnyRule } from '../types';
import { allAriaPatternRules } from './aria-pattern-rules';
import { allAxTreeRules } from './ax-tree-rules';
import { allDomRules } from './dom-rules';
import { allUiaRules } from './uia-rules';

/** All rules registered in the unified Accessibility Rule Engine. */
export const allRules: AnyRule[] = [
  ...allUiaRules,
  ...allDomRules,
  ...allAxTreeRules,
  ...allAriaPatternRules,
];
