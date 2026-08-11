/**
 * UIA tree parser — shared between the old rule-engine/ and the new
 * accessibility-rule-engine/. Extracted so both can import without a cycle.
 */

import type { UiaNode, UiaPageResult } from '../types';
import type { FlatUiaElement } from './types';

export function baseControlType(ct: string): string {
  return (ct || '').replace(/Control$/, '');
}

export function flattenTree(
  node: UiaNode | null,
  page: string,
  url: string,
  depth = 0,
  out: FlatUiaElement[] = []
): FlatUiaElement[] {
  if (!node) return out;
  out.push({
    page, url,
    name: node.name ?? '',
    controlType: node.role ?? '',
    baseType: baseControlType(node.role ?? ''),
    automationId: node.automationId ?? '',
    className: node.className,
    isEnabled: node.isEnabled ?? null,
    isKeyboardFocusable: node.isKeyboardFocusable ?? null,
    isOffscreen: node.isOffscreen ?? null,
    boundingRectangle: node.boundingRectangle ?? null,
    depth,
  });
  for (const child of node.children ?? []) flattenTree(child, page, url, depth + 1, out);
  return out;
}

function collectDocumentRoots(node: UiaNode | null, out: UiaNode[] = []): UiaNode[] {
  if (!node) return out;
  if (baseControlType(node.role ?? '') === 'Document') { out.push(node); return out; }
  for (const child of node.children ?? []) collectDocumentRoots(child, out);
  return out;
}

export function flattenPages(results: UiaPageResult[]): FlatUiaElement[] {
  const out: FlatUiaElement[] = [];
  for (const r of results) {
    if (r.available && r.tree) flattenTree(r.tree, r.page, r.url, 0, out);
  }
  return out;
}

export function flattenScoped(results: UiaPageResult[], documentOnly: boolean): FlatUiaElement[] {
  if (!documentOnly) return flattenPages(results);
  const out: FlatUiaElement[] = [];
  for (const r of results) {
    if (!r.available || !r.tree) continue;
    const docs = collectDocumentRoots(r.tree);
    const roots = docs.length ? docs : [r.tree];
    for (const root of roots) flattenTree(root, r.page, r.url, 0, out);
  }
  return out;
}
