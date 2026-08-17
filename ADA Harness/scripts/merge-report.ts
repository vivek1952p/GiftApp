/**
 * ============================================================================
 * ADA Harness — Report Merger (Cross-Scanner Correlation)
 * ============================================================================
 *
 * Correlates findings from all scanners into a single reports/merged-report.json:
 *
 *   - axe-core                     -> reports/summary.json          (WHAT failed)
 *   - Playwright Accessibility Tree -> playwright-accessibility-tree.json (browser view)
 *   - Windows UI Automation         -> uia-tree.json                (Windows AT view)
 *
 * For every axe violation the merger cross-checks whether the SAME problem is
 * visible in the browser accessibility tree and in the Windows accessibility
 * tree, e.g. a "button-name" violation is `confirmed` when a button node with
 * an empty accessible name is present in those trees too.
 *
 * The result is the single source of truth the AI remediation agent consumes.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { collectAllFindings, severityCountsOf } from './all-findings';
import { createLogger } from './logger';
import type {
  A11yPageTree,
  A11yTreeNode,
  DomElementStyle,
  DomPageSnapshot,
  DomSnapshotReport,
  ExpectedFocusGap,
  ExpectedFocusReport,
  FocusManagementFinding,
  FocusManagementReport,
  InteractionFinding,
  InteractionReport,
  KeyboardFinding,
  KeyboardReport,
  MergedFinding,
  MergedReport,
  PlaywrightA11yReport,
  ScreenReaderFinding,
  ScreenReaderReport,
  Summary,
  SummaryViolation,
  UiaFinding,
  UiaFindingsReport,
  UiaNode,
  UiaPageResult,
  UiaReport,
  VerificationStatus,
  WidgetBehaviorReport,
  WidgetFinding,
} from './types';

const log = createLogger('merge');

/** Safely read + parse a JSON artifact, returning null when it is absent. */
export function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch (err) {
    log.warn(`Could not parse ${path.basename(file)}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Map an axe rule id to the accessibility roles it concerns and whether the
 * rule is about a MISSING ACCESSIBLE NAME (the class of issue we can verify in
 * the other trees). Roles use lowercase ARIA names for the Playwright tree and
 * substring matches for UIA control-type names.
 */
export const NAME_RULES: Record<string, { ariaRoles: string[]; uiaRoles: string[] }> = {
  'image-alt': { ariaRoles: ['img', 'image'], uiaRoles: ['Image'] },
  'button-name': { ariaRoles: ['button'], uiaRoles: ['Button'] },
  'input-button-name': { ariaRoles: ['button'], uiaRoles: ['Button'] },
  'aria-command-name': { ariaRoles: ['button'], uiaRoles: ['Button'] },
  'aria-toggle-field-name': { ariaRoles: ['button', 'checkbox', 'switch'], uiaRoles: ['Button', 'CheckBox'] },
  'link-name': { ariaRoles: ['link'], uiaRoles: ['Hyperlink'] },
  label: {
    ariaRoles: ['textbox', 'combobox', 'checkbox', 'radio'],
    uiaRoles: ['Edit', 'ComboBox', 'CheckBox', 'RadioButton'],
  },
  'select-name': { ariaRoles: ['combobox', 'listbox'], uiaRoles: ['ComboBox'] },
};

/**
 * Map an axe rule id to the UIA base control type(s) the Rule Engine would flag
 * for the SAME problem, used to correlate axe findings with uia-findings.json.
 */
export const AXE_TO_UIA_BASETYPE: Record<string, string[]> = {
  'image-alt': ['Image'],
  'button-name': ['Button'],
  'input-button-name': ['Button'],
  'aria-command-name': ['Button'],
  'aria-toggle-field-name': ['Button', 'CheckBox'],
  'link-name': ['Hyperlink'],
  label: ['Edit', 'ComboBox', 'CheckBox', 'RadioButton'],
  'select-name': ['ComboBox'],
};

/** True when a node's accessible name is missing/blank. */
export function hasNoName(name?: string): boolean {
  return !name || name.trim() === '';
}

/** Depth-first search of a Playwright a11y tree. */
export function searchA11y(
  node: A11yTreeNode | null,
  roles: string[]
): { anyRole: boolean; anyMissingName: boolean } {
  let anyRole = false;
  let anyMissingName = false;
  if (!node) return { anyRole, anyMissingName };

  const role = (node.role ?? '').toLowerCase();
  if (roles.includes(role)) {
    anyRole = true;
    if (hasNoName(node.name)) anyMissingName = true;
  }
  for (const child of (node.children ?? []) as A11yTreeNode[]) {
    const r = searchA11y(child, roles);
    anyRole = anyRole || r.anyRole;
    anyMissingName = anyMissingName || r.anyMissingName;
  }
  return { anyRole, anyMissingName };
}

/** Depth-first search of a UIA tree using control-type substring matches. */
export function searchUia(
  node: UiaNode | null,
  roleSubstrings: string[]
): { anyRole: boolean; anyMissingName: boolean } {
  let anyRole = false;
  let anyMissingName = false;
  if (!node) return { anyRole, anyMissingName };

  const role = node.role ?? '';
  if (roleSubstrings.some((r) => role.includes(r))) {
    anyRole = true;
    if (hasNoName(node.name)) anyMissingName = true;
  }
  for (const child of node.children ?? []) {
    const r = searchUia(child, roleSubstrings);
    anyRole = anyRole || r.anyRole;
    anyMissingName = anyMissingName || r.anyMissingName;
  }
  return { anyRole, anyMissingName };
}

/** Correlate one violation against the Playwright accessibility tree. */
export function verifyInA11y(v: SummaryViolation, pageTree?: A11yPageTree): VerificationStatus {
  const spec = NAME_RULES[v.ruleId];
  if (!spec || !pageTree) return 'not-detected';
  const { anyRole, anyMissingName } = searchA11y(pageTree.tree, spec.ariaRoles);
  if (anyMissingName) return 'confirmed';
  if (anyRole) return 'not-detected';
  return 'not-found';
}

/** Correlate one violation against the Windows UIA tree. */
export function verifyInUia(
  v: SummaryViolation,
  uiaResult?: UiaPageResult,
  uiaAvailable?: boolean
): VerificationStatus {
  if (!uiaAvailable || !uiaResult || !uiaResult.available) return 'unavailable';
  const spec = NAME_RULES[v.ruleId];
  if (!spec) return 'not-detected';
  const { anyRole, anyMissingName } = searchUia(uiaResult.tree, spec.uiaRoles);
  if (anyMissingName) return 'confirmed';
  if (anyRole) return 'not-detected';
  return 'not-found';
}

/**
 * Correlate one violation against the full DOM snapshot. Any finding whose
 * offending element is present in the DOM (with captured computed styles) is
 * `confirmed` against the real DOM — this is what lets visual rules such as
 * `color-contrast` be verified, since the DOM exposes colour/font facts the
 * accessibility trees cannot.
 */
export function verifyInDom(
  v: SummaryViolation,
  domPage?: DomPageSnapshot
): { status: VerificationStatus; props?: DomElementStyle } {
  if (!domPage) return { status: 'unavailable' };
  const match = domPage.elements.find((e) => e.target === v.target);
  if (match) return { status: 'confirmed', props: match };
  return { status: 'not-found' };
}

/**
 * Correlate one violation against real NVDA screen reader announcements
 * (guidepup). `screenReaderAvailable` mirrors the UIA availability pattern —
 * NVDA is Windows-only, so `unavailable` reflects that rather than "checked
 * and found nothing."
 */
export function verifyInScreenReader(
  v: SummaryViolation,
  screenReaderFindings: ScreenReaderFinding[],
  screenReaderAvailable: boolean
): VerificationStatus {
  if (!screenReaderAvailable) return 'unavailable';
  if (!(v.ruleId in NAME_RULES)) return 'not-detected';
  const match = screenReaderFindings.find((f) => f.page === v.page && f.target === v.target);
  return match ? 'confirmed' : 'not-detected';
}

/** Build a human-readable correlation summary. */
export function describeCorrelation(
  pw: VerificationStatus,
  uia: VerificationStatus,
  dom: VerificationStatus,
  sr: VerificationStatus
): string {
  const parts = ['axe-core'];
  if (pw === 'confirmed') parts.push('Playwright Accessibility Tree');
  if (uia === 'confirmed') parts.push('Windows UI Automation');
  if (dom === 'confirmed') parts.push('DOM');
  if (sr === 'confirmed') parts.push('NVDA (Screen Reader)');
  if (parts.length === 1) return 'Detected by axe-core.';
  const last = parts.pop();
  return `Confirmed by ${parts.join(', ')} and ${last}.`;
}

/** True when the Rule Engine independently flagged a matching control. */
export function matchesUiaRuleEngine(v: SummaryViolation, uiaFindingKeys: Set<string>): boolean {
  const baseTypes = AXE_TO_UIA_BASETYPE[v.ruleId];
  if (!baseTypes) return false;
  return baseTypes.some((bt) => uiaFindingKeys.has(`${v.page}::${bt}`));
}

/**
 * Rule Engine findings on the given page that describe the SAME "missing
 * accessible name" problem as the given axe ruleId — `ax-*` findings (sourced
 * from the Playwright AX-tree, whose `controlType` holds a lowercase ARIA
 * role) matched via NAME_RULES, and `uia-*` findings (sourced from real
 * Windows UI Automation, whose `controlType` holds a PascalCase base type
 * like "ButtonControl") matched via AXE_TO_UIA_BASETYPE.
 */
function corroboratingRuleEngineFindings(ruleId: string, page: string, uiaFindings: UiaFinding[]): UiaFinding[] {
  const ariaRoles = NAME_RULES[ruleId]?.ariaRoles ?? [];
  const baseTypes = AXE_TO_UIA_BASETYPE[ruleId] ?? [];
  return uiaFindings.filter((f) => {
    if (f.page !== page) return false;
    if (f.ruleId.startsWith('ax-')) return ariaRoles.includes(f.controlType);
    if (f.ruleId.startsWith('uia-')) return baseTypes.includes(f.controlType.replace(/Control$/, ''));
    return false;
  });
}

/**
 * Mark Rule Engine findings that re-detect an axe-core finding already
 * counted for the same page/issue, so totalFindings/severityCounts don't
 * double (or triple) count the same real defect once for axe, once for the
 * AX-tree rule, and once for the UIA rule. The entries are kept in
 * uiaFindings for corroboration evidence — only `duplicateOfAxe` is set;
 * all-findings.ts is what actually excludes them from totals.
 *
 * Each corroborating SOURCE (AX-tree, UIA) is capped independently at axe's
 * own count for that page+ruleId, not one shared cap across both sources. A
 * page where axe found 3 and BOTH the AX-tree rule and the UIA rule each
 * independently re-found the same 3 should have all 6 corroborations marked
 * duplicate (each source is, on its own, fully redundant with axe). A single
 * shared cap would only let one source's findings be claimed, wrongly leaving
 * the other source's 3 counted as "real". Conversely, if one source finds
 * MORE than axe did on a page (e.g. the AX-tree catches a second broken image
 * axe missed), only up to axe's count from THAT source is claimed - the
 * extra instance(s) stay counted as a genuine, distinct finding.
 */
export function markDuplicateRuleEngineFindings(
  violations: SummaryViolation[],
  uiaFindings: UiaFinding[]
): UiaFinding[] {
  const claimed = new Set<UiaFinding>();
  const countByPageRule = new Map<string, { page: string; ruleId: string; count: number }>();
  for (const v of violations) {
    if (!NAME_RULES[v.ruleId] && !AXE_TO_UIA_BASETYPE[v.ruleId]) continue;
    const key = `${v.page} ${v.ruleId}`;
    const entry = countByPageRule.get(key) ?? { page: v.page, ruleId: v.ruleId, count: 0 };
    entry.count += 1;
    countByPageRule.set(key, entry);
  }
  for (const { page, ruleId, count } of countByPageRule.values()) {
    const candidates = corroboratingRuleEngineFindings(ruleId, page, uiaFindings);
    const bySource = [
      candidates.filter((f) => f.ruleId.startsWith('ax-')),
      candidates.filter((f) => f.ruleId.startsWith('uia-')),
    ];
    for (const sourceCandidates of bySource) {
      for (const f of sourceCandidates.slice(0, count)) claimed.add(f);
    }
  }
  return uiaFindings.map((f) => (claimed.has(f) ? { ...f, duplicateOfAxe: true } : f));
}

/** HTML tag/role (as recorded by expected-focus-engine.ts) -> axe ruleIds covering the same missing-name family. */
const FOCUS_GAP_ROLE_TO_AXE_RULES: Record<string, string[]> = {
  input: ['label', 'select-name'],
  textarea: ['label'],
  select: ['label', 'select-name'],
  button: ['button-name', 'input-button-name', 'aria-command-name'],
  a: ['link-name'],
};

/**
 * Mark expected-focus gaps ("reachable by keyboard but no accessible name")
 * that re-detect an axe-core finding already counted for the same page. Only
 * a literal single-page gap can match — the engine's synthetic multi-page
 * label (e.g. "(3 pages: Home, Checkout, Contact)") for a shared component
 * never matches a real axe page name, so shared-component gaps on pages axe
 * missed stay fully counted; only the exact single-page overlap is cut.
 */
export function markDuplicateExpectedFocusGaps(
  violations: SummaryViolation[],
  gaps: ExpectedFocusGap[]
): ExpectedFocusGap[] {
  const remainingByPageRule = new Map<string, number>();
  for (const v of violations) {
    const key = `${v.page} ${v.ruleId}`;
    remainingByPageRule.set(key, (remainingByPageRule.get(key) ?? 0) + 1);
  }
  const claimed = new Set<ExpectedFocusGap>();
  for (const gap of gaps) {
    for (const ruleId of FOCUS_GAP_ROLE_TO_AXE_RULES[gap.role] ?? []) {
      const key = `${gap.page} ${ruleId}`;
      const remaining = remainingByPageRule.get(key) ?? 0;
      if (remaining > 0) {
        remainingByPageRule.set(key, remaining - 1);
        claimed.add(gap);
        break;
      }
    }
  }
  return gaps.map((g) => (claimed.has(g) ? { ...g, duplicateOfAxe: true } : g));
}

/**
 * Entry point: build merged-report.json from the three source artifacts.
 */
function main(): void {
  try {
    const summary = readJson<Summary>(adaConfig.paths.summary);
    if (!summary) throw new Error('summary.json not found. Run the scan first.');

    const a11y = readJson<PlaywrightA11yReport>(adaConfig.paths.a11yTree);
    const uia = readJson<UiaReport>(adaConfig.paths.uiaTree);
    const dom = readJson<DomSnapshotReport>(adaConfig.paths.domSnapshot);
    const uiaFindingsReport = readJson<UiaFindingsReport>(adaConfig.paths.uiaFindings);
    const keyboardReport = readJson<KeyboardReport>(adaConfig.paths.keyboardReport);
    const expectedFocusReport = readJson<ExpectedFocusReport>(adaConfig.paths.expectedFocusReport);
    const widgetReport = readJson<WidgetBehaviorReport>(adaConfig.paths.widgetBehaviorReport);
    const focusMgmtReport = readJson<FocusManagementReport>(adaConfig.paths.focusManagementReport);
    const interactionReport = readJson<InteractionReport>(adaConfig.paths.interactionReport);
    const screenReaderReport = readJson<ScreenReaderReport>(adaConfig.paths.screenReaderReport);

    // Index tree data by page name for quick lookup.
    const a11yByPage = new Map<string, A11yPageTree>((a11y?.results ?? []).map((r) => [r.page, r]));
    const uiaByPage = new Map<string, UiaPageResult>((uia?.results ?? []).map((r) => [r.page, r]));
    const domByPage = new Map<string, DomPageSnapshot>((dom?.results ?? []).map((r) => [r.page, r]));
    const uiaAvailable = uia?.available ?? false;

    // Despite the `uiaFindings`/`uia-findings.json` name (kept from before the
    // rule engine was unified), this also contains DOM, AX-tree, and
    // ARIA-pattern findings. `duplicateOfAxe` is set below for any entry that
    // re-detects a "missing accessible name" issue axe-core already counted
    // on the same page (via NAME_RULES for `ax-*` AX-tree roles, and
    // AXE_TO_UIA_BASETYPE for `uia-*` PascalCase control types) — the entry
    // stays here for corroboration evidence, but all-findings.ts excludes
    // flagged entries from totals so the same real defect isn't counted twice.
    const keyboardFindings: KeyboardFinding[] = keyboardReport?.findings ?? [];
    const widgetFindings: WidgetFinding[] = widgetReport?.findings ?? [];
    const focusManagementFindings: FocusManagementFinding[] = focusMgmtReport?.findings ?? [];
    const interactionFindings: InteractionFinding[] = interactionReport?.findings ?? [];
    const screenReaderFindings: ScreenReaderFinding[] = screenReaderReport?.findings ?? [];
    const screenReaderAvailable = screenReaderReport?.available ?? false;
    const uiaFindings: UiaFinding[] = markDuplicateRuleEngineFindings(
      summary.violations,
      uiaFindingsReport?.findings ?? []
    );
    const expectedFocusGaps: ExpectedFocusGap[] = markDuplicateExpectedFocusGaps(
      summary.violations,
      expectedFocusReport?.allGaps ?? []
    );
    const uiaFindingKeys = new Set<string>(
      uiaFindings.map((f) => `${f.page}::${(f.controlType || '').replace(/Control$/, '')}`)
    );

    const findings: MergedFinding[] = summary.violations.map((v) => {
      const pw = verifyInA11y(v, a11yByPage.get(v.page));
      const u = verifyInUia(v, uiaByPage.get(v.page), uiaAvailable);
      const d = verifyInDom(v, domByPage.get(v.page));
      const sr = verifyInScreenReader(v, screenReaderFindings, screenReaderAvailable);
      const uiaRuleFinding = matchesUiaRuleEngine(v, uiaFindingKeys);

      // Confidence: axe always counts; each confirming source adds weight.
      const confirmations =
        1 +
        (pw === 'confirmed' ? 1 : 0) +
        (u === 'confirmed' ? 1 : 0) +
        (d.status === 'confirmed' ? 1 : 0) +
        (sr === 'confirmed' ? 1 : 0) +
        (uiaRuleFinding ? 1 : 0);
      const confidence = Math.round((confirmations / 6) * 100);

      const detectedBy = ['axe-core'];
      if (uiaRuleFinding) detectedBy.push('uia-rule-engine');
      if (sr === 'confirmed') detectedBy.push('screen-reader');

      return {
        ...v,
        detectedBy,
        verifiedIn: { playwrightTree: pw, uia: u, dom: d.status, screenReader: sr },
        uiaRuleFinding,
        confidence,
        domProperties: d.props,
        correlation: describeCorrelation(pw, u, d.status, sr),
      };
    });

    const playwrightNodeCount = (a11y?.results ?? []).reduce((s, r) => s + r.nodeCount, 0);
    const uiaNodeCount = (uia?.results ?? []).reduce((s, r) => s + r.nodeCount, 0);
    const domElementsCaptured = (dom?.results ?? []).reduce((s, r) => s + r.elements.length, 0);

    // totalFindings/severityCounts must span all 8 scanners, not just axe-core,
    // otherwise this "single source of truth" field silently disagrees with
    // dashboard.md's total (which already aggregates via collectAllFindings).
    const allFindings = collectAllFindings(summary, {
      uiaFindings,
      keyboardFindings,
      expectedFocusGaps,
      widgetFindings,
      focusManagementFindings,
      interactionFindings,
      screenReaderFindings,
    } as MergedReport);
    const allSeverityCounts = severityCountsOf(allFindings);

    const merged: MergedReport = {
      generatedAt: new Date().toISOString(),
      baseUrl: summary.baseUrl,
      sources: {
        axe: true,
        playwrightTree: Boolean(a11y),
        uia: Boolean(uia),
        dom: Boolean(dom),
        uiaRuleEngine: Boolean(uiaFindingsReport),
        keyboard: Boolean(keyboardReport),
        expectedFocus: Boolean(expectedFocusReport),
        widgetBehavior: Boolean(widgetReport),
        focusManagement: Boolean(focusMgmtReport),
        interactionPrediction: Boolean(interactionReport),
        screenReader: Boolean(screenReaderReport),
      },
      totalFindings: allFindings.length,
      severityCounts: allSeverityCounts,
      findings,
      uiaFindings,
      keyboardFindings,
      expectedFocusGaps,
      widgetFindings,
      focusManagementFindings,
      interactionFindings,
      screenReaderFindings,
      trees: {
        playwrightNodeCount,
        uiaNodeCount,
        uiaAvailable,
        domElementsCaptured,
        uiaRuleFindingCount: uiaFindings.length,
        keyboardFindingCount: keyboardFindings.length,
        expectedFocusGapCount: expectedFocusGaps.length,
        widgetFindingCount: widgetFindings.length,
        focusManagementFindingCount: focusManagementFindings.length,
        interactionFindingCount: interactionFindings.length,
        screenReaderAvailable,
        screenReaderFindingCount: screenReaderFindings.length,
      },
    };

    fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });

    // Snapshot the outgoing merged report BEFORE overwriting it, so compare.ts
    // can diff ALL 8 scanners across runs (previousSummary/summary.json only
    // ever covered axe-core, which is why comparison.md and dashboard.md used
    // to disagree on the total finding count).
    if (fs.existsSync(adaConfig.paths.merged)) {
      fs.copyFileSync(adaConfig.paths.merged, adaConfig.paths.mergedPrevious);
    }
    fs.writeFileSync(adaConfig.paths.merged, JSON.stringify(merged, null, 2), 'utf-8');

    const confirmedByBoth = findings.filter(
      (f) => f.verifiedIn.playwrightTree === 'confirmed' && f.verifiedIn.uia === 'confirmed'
    ).length;
    const confirmedInDom = findings.filter((f) => f.verifiedIn.dom === 'confirmed').length;

    log.info(
      `Merged report: ${findings.length} axe finding(s), ${uiaFindings.length} UIA rule-engine finding(s), ` +
        `${keyboardFindings.length} keyboard finding(s), ${confirmedByBoth} confirmed by both a11y trees, ` +
        `${confirmedInDom} confirmed in DOM (a11y nodes: ${playwrightNodeCount}, UIA nodes: ${uiaNodeCount}, ` +
        `DOM elements: ${domElementsCaptured}, UIA available: ${uiaAvailable}) -> ${path.relative(process.cwd(), adaConfig.paths.merged)}`
    );
  } catch (err) {
    log.error('Merge failed', (err as Error).message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
