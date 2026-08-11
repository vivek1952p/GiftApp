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
function readJson<T>(file: string): T | null {
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
const NAME_RULES: Record<string, { ariaRoles: string[]; uiaRoles: string[] }> = {
  'image-alt': { ariaRoles: ['img', 'image'], uiaRoles: ['Image'] },
  'button-name': { ariaRoles: ['button'], uiaRoles: ['Button'] },
  'input-button-name': { ariaRoles: ['button'], uiaRoles: ['Button'] },
  'aria-command-name': { ariaRoles: ['button'], uiaRoles: ['Button'] },
  'aria-toggle-field-name': { ariaRoles: ['button', 'checkbox', 'switch'], uiaRoles: ['Button', 'CheckBox'] },
  'link-name': { ariaRoles: ['link'], uiaRoles: ['Hyperlink'] },
  'label': { ariaRoles: ['textbox', 'combobox', 'checkbox', 'radio'], uiaRoles: ['Edit', 'ComboBox', 'CheckBox', 'RadioButton'] },
};

/**
 * Map an axe rule id to the UIA base control type(s) the Rule Engine would flag
 * for the SAME problem, used to correlate axe findings with uia-findings.json.
 */
const AXE_TO_UIA_BASETYPE: Record<string, string[]> = {
  'image-alt': ['Image'],
  'button-name': ['Button'],
  'input-button-name': ['Button'],
  'aria-command-name': ['Button'],
  'aria-toggle-field-name': ['Button', 'CheckBox'],
  'link-name': ['Hyperlink'],
  'label': ['Edit', 'ComboBox', 'CheckBox', 'RadioButton'],
  'select-name': ['ComboBox'],
};

/** True when a node's accessible name is missing/blank. */
function hasNoName(name?: string): boolean {
  return !name || name.trim() === '';
}

/** Depth-first search of a Playwright a11y tree. */
function searchA11y(
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
function searchUia(
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
function verifyInA11y(v: SummaryViolation, pageTree?: A11yPageTree): VerificationStatus {
  const spec = NAME_RULES[v.ruleId];
  if (!spec || !pageTree) return 'not-detected';
  const { anyRole, anyMissingName } = searchA11y(pageTree.tree, spec.ariaRoles);
  if (anyMissingName) return 'confirmed';
  if (anyRole) return 'not-detected';
  return 'not-found';
}

/** Correlate one violation against the Windows UIA tree. */
function verifyInUia(v: SummaryViolation, uiaResult?: UiaPageResult, uiaAvailable?: boolean): VerificationStatus {
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
function verifyInDom(
  v: SummaryViolation,
  domPage?: DomPageSnapshot
): { status: VerificationStatus; props?: DomElementStyle } {
  if (!domPage) return { status: 'unavailable' };
  const match = domPage.elements.find((e) => e.target === v.target);
  if (match) return { status: 'confirmed', props: match };
  return { status: 'not-found' };
}

/** Build a human-readable correlation summary. */
function describeCorrelation(
  pw: VerificationStatus,
  uia: VerificationStatus,
  dom: VerificationStatus
): string {
  const parts = ['axe-core'];
  if (pw === 'confirmed') parts.push('Playwright Accessibility Tree');
  if (uia === 'confirmed') parts.push('Windows UI Automation');
  if (dom === 'confirmed') parts.push('DOM');
  if (parts.length === 1) return 'Detected by axe-core.';
  const last = parts.pop();
  return `Confirmed by ${parts.join(', ')} and ${last}.`;
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

    // Index tree data by page name for quick lookup.
    const a11yByPage = new Map<string, A11yPageTree>((a11y?.results ?? []).map((r) => [r.page, r]));
    const uiaByPage = new Map<string, UiaPageResult>((uia?.results ?? []).map((r) => [r.page, r]));
    const domByPage = new Map<string, DomPageSnapshot>((dom?.results ?? []).map((r) => [r.page, r]));
    const uiaAvailable = uia?.available ?? false;

    // Index UIA Rule-Engine findings by `${page}::${baseControlType}` so an axe
    // finding can be correlated to an independent UIA-inferred finding.
    const uiaFindings: UiaFinding[] = uiaFindingsReport?.findings ?? [];
    const keyboardFindings: KeyboardFinding[] = keyboardReport?.findings ?? [];
    const expectedFocusGaps: ExpectedFocusGap[] = expectedFocusReport?.allGaps ?? [];
    const widgetFindings: WidgetFinding[] = widgetReport?.findings ?? [];
    const focusManagementFindings: FocusManagementFinding[] = focusMgmtReport?.findings ?? [];
    const interactionFindings: InteractionFinding[] = interactionReport?.findings ?? [];
    const uiaFindingKeys = new Set<string>(
      uiaFindings.map((f) => `${f.page}::${(f.controlType || '').replace(/Control$/, '')}`)
    );

    /** True when the Rule Engine independently flagged a matching control. */
    const matchedByUiaRuleEngine = (v: SummaryViolation): boolean => {
      const baseTypes = AXE_TO_UIA_BASETYPE[v.ruleId];
      if (!baseTypes) return false;
      return baseTypes.some((bt) => uiaFindingKeys.has(`${v.page}::${bt}`));
    };

    const findings: MergedFinding[] = summary.violations.map((v) => {
      const pw = verifyInA11y(v, a11yByPage.get(v.page));
      const u = verifyInUia(v, uiaByPage.get(v.page), uiaAvailable);
      const d = verifyInDom(v, domByPage.get(v.page));
      const uiaRuleFinding = matchedByUiaRuleEngine(v);

      // Confidence: axe always counts; each confirming source adds weight.
      const confirmations =
        1 +
        (pw === 'confirmed' ? 1 : 0) +
        (u === 'confirmed' ? 1 : 0) +
        (d.status === 'confirmed' ? 1 : 0) +
        (uiaRuleFinding ? 1 : 0);
      const confidence = Math.round((confirmations / 5) * 100);

      return {
        ...v,
        detectedBy: uiaRuleFinding ? ['axe-core', 'uia-rule-engine'] : ['axe-core'],
        verifiedIn: { playwrightTree: pw, uia: u, dom: d.status },
        uiaRuleFinding,
        confidence,
        domProperties: d.props,
        correlation: describeCorrelation(pw, u, d.status),
      };
    });

    const playwrightNodeCount = (a11y?.results ?? []).reduce((s, r) => s + r.nodeCount, 0);
    const uiaNodeCount = (uia?.results ?? []).reduce((s, r) => s + r.nodeCount, 0);
    const domElementsCaptured = (dom?.results ?? []).reduce((s, r) => s + r.elements.length, 0);

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
      },
      totalFindings: findings.length,
      severityCounts: summary.severityCounts,
      findings,
      uiaFindings,
      keyboardFindings,
      expectedFocusGaps,
      widgetFindings,
      focusManagementFindings,
      interactionFindings,
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
      },
    };

    fs.mkdirSync(adaConfig.paths.reportsDir, { recursive: true });
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

main();
