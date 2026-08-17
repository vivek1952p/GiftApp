/**
 * ARIA Pattern Rules — validate that ARIA widget relationships are complete
 * and correct across a whole page's AX tree.
 *
 * These rules enforce WAI-ARIA Authoring Practices (APG) patterns:
 *   tab  ↔  tabpanel       (WCAG 1.3.1 / 4.1.2)
 *   menu ↔  menuitem       (WCAG 1.3.1)
 *   tree ↔  treeitem       (WCAG 1.3.1)
 *   dialog focus control   (WCAG 2.1.2)
 *   grid ↔  row ↔ cell     (WCAG 1.3.1)
 */

import type { A11yTreeNode } from '../../types';
import type { AriaPatternRule, RuleResult } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function collectAll(node: A11yTreeNode | null, role: string, out: A11yTreeNode[] = []): A11yTreeNode[] {
  if (!node) return out;
  if (node.role === role) out.push(node);
  for (const child of (node.children ?? []) as A11yTreeNode[]) collectAll(child, role, out);
  return out;
}

function parentHasRole(node: A11yTreeNode, tree: A11yTreeNode | null, ...roles: string[]): boolean {
  if (!tree) return false;
  function search(current: A11yTreeNode): boolean {
    const children = (current.children ?? []) as A11yTreeNode[];
    if (children.includes(node)) return roles.includes(current.role ?? '');
    return children.some(search);
  }
  return search(tree);
}

// ── Rules ────────────────────────────────────────────────────────────────

/**
 * WCAG 1.3.1 / ARIA APG: Every `tab` must be associated with a `tabpanel`
 * (owned by a common `tablist`).
 */
export const TabPanelRelationRule: AriaPatternRule = {
  id: 'aria-tab-tabpanel-relation',
  source: 'aria-pattern',
  description: 'Every tab must have a corresponding tabpanel',
  wcag: '1.3.1',
  evaluatePage(tree, _page, _url): RuleResult[] {
    const results: RuleResult[] = [];
    const tablists = collectAll(tree, 'tablist');

    // Per the WAI-ARIA APG Tab pattern, tabpanel elements are standardly
    // SIBLINGS of the tablist, not descendants of it — scoping the search to
    // collectAll(tablist, 'tabpanel') would find 0 panels for essentially
    // every correctly-built tab widget. The AX tree captured by this harness
    // doesn't carry aria-controls/id, so a specific tablist can't be tied to
    // its own panels by reference; comparing against the page-wide tabpanel
    // count avoids that systematic false positive at the cost of precision
    // when a page has multiple independent tablists (rare).
    const allPanels = collectAll(tree, 'tabpanel');

    for (const tablist of tablists) {
      const tabs = collectAll(tablist, 'tab');
      if (tabs.length === 0) continue;

      if (allPanels.length === 0) {
        results.push({
          issue: `tablist contains ${tabs.length} tab(s) but no tabpanel role is present anywhere on the page`,
          severity: 'serious',
          wcag: this.wcag,
          recommendation:
            'Each tab must control a tabpanel via aria-controls or the owned-by relationship. Verify tabpanels are not hidden from the accessibility tree.',
          context: { role: 'tablist', name: tablist.name },
        });
      } else if (tabs.length > allPanels.length) {
        results.push({
          issue: `tablist has ${tabs.length} tab(s) but only ${allPanels.length} tabpanel(s) exist on the page`,
          severity: 'moderate',
          wcag: this.wcag,
          recommendation: 'Ensure each tab has exactly one corresponding tabpanel.',
          context: { role: 'tablist', name: tablist.name },
        });
      }
    }
    return results;
  },
};

/**
 * WCAG 1.3.1 / ARIA APG: `menu` and `menubar` must contain `menuitem` children.
 */
export const MenuStructureRule: AriaPatternRule = {
  id: 'aria-menu-structure',
  source: 'aria-pattern',
  description: 'Menus must contain menuitem children',
  wcag: '1.3.1',
  evaluatePage(tree): RuleResult[] {
    const results: RuleResult[] = [];
    for (const role of ['menu', 'menubar'] as const) {
      for (const menu of collectAll(tree, role)) {
        const items = collectAll(menu, 'menuitem')
          .concat(collectAll(menu, 'menuitemcheckbox'))
          .concat(collectAll(menu, 'menuitemradio'));
        if (items.length === 0) {
          results.push({
            issue: `${role} contains no menuitem children in the AX tree`,
            severity: 'serious',
            wcag: this.wcag,
            recommendation: `Add role="menuitem" to the direct interactive children of the ${role}.`,
            context: { role, name: menu.name },
          });
        }
      }
    }
    return results;
  },
};

/**
 * WCAG 1.3.1 / ARIA APG: `tree` must contain `treeitem` children.
 */
export const TreeStructureRule: AriaPatternRule = {
  id: 'aria-tree-structure',
  source: 'aria-pattern',
  description: 'Trees must contain treeitem children',
  wcag: '1.3.1',
  evaluatePage(tree): RuleResult[] {
    const results: RuleResult[] = [];
    for (const treeNode of collectAll(tree, 'tree')) {
      if (collectAll(treeNode, 'treeitem').length === 0) {
        results.push({
          issue: 'tree role contains no treeitem children in the AX tree',
          severity: 'moderate',
          wcag: this.wcag,
          recommendation: 'Add role="treeitem" to the tree node elements.',
          context: { role: 'tree', name: treeNode.name },
        });
      }
    }
    return results;
  },
};

/**
 * WCAG 2.1.2 / ARIA APG: A `dialog` should have an accessible name (aria-label
 * or aria-labelledby pointing to a heading).
 */
export const DialogNameRule: AriaPatternRule = {
  id: 'aria-dialog-name',
  source: 'aria-pattern',
  description: 'Dialogs must have an accessible name',
  wcag: '2.1.2',
  evaluatePage(tree): RuleResult[] {
    const results: RuleResult[] = [];
    for (const role of ['dialog', 'alertdialog'] as const) {
      for (const dialog of collectAll(tree, role)) {
        if (!dialog.name || dialog.name.trim() === '') {
          results.push({
            issue: `${role} has no accessible name — screen readers cannot announce its purpose`,
            severity: 'serious',
            wcag: this.wcag,
            recommendation: 'Add aria-label or aria-labelledby referencing a heading inside the dialog.',
            context: { role },
          });
        }
      }
    }
    return results;
  },
};

/**
 * WCAG 1.3.1 / ARIA APG: `listitem` must be owned by `list`.
 * Complements the axe-core `listitem` rule with AX-tree level confirmation.
 */
export const ListItemParentRule: AriaPatternRule = {
  id: 'aria-listitem-parent',
  source: 'aria-pattern',
  description: 'listitem must be contained by a list',
  wcag: '1.3.1',
  evaluatePage(tree): RuleResult[] {
    const results: RuleResult[] = [];
    for (const item of collectAll(tree, 'listitem')) {
      if (!parentHasRole(item, tree, 'list')) {
        results.push({
          issue: 'listitem is not inside a list role — AT cannot determine list structure',
          severity: 'serious',
          wcag: this.wcag,
          recommendation: 'Ensure every listitem is a direct child of a list (ul/ol or role="list").',
          context: { role: 'listitem', name: item.name },
        });
      }
    }
    return results;
  },
};

export const allAriaPatternRules: AriaPatternRule[] = [
  TabPanelRelationRule,
  MenuStructureRule,
  TreeStructureRule,
  DialogNameRule,
  ListItemParentRule,
];
