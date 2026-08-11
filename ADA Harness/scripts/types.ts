/**
 * ============================================================================
 * ADA Harness — Shared Type Definitions
 * ============================================================================
 *
 * Strong typing for the data structures that flow between the harness modules:
 *
 *   axe-report.json  -> AxeReport / AxePageResult (raw Playwright + axe output)
 *   summary.json     -> Summary / SummaryViolation (flattened, report-friendly)
 *
 * Every script imports from here so the shape of the data is enforced end to
 * end and refactors surface at compile time rather than runtime.
 * ============================================================================
 */

/** axe-core impact levels, ordered from most to least severe. */
export type Impact = 'critical' | 'serious' | 'moderate' | 'minor' | null;

/** A single DOM node flagged by an axe rule. */
export interface AxeNode {
  /** CSS selector(s) pointing at the offending element. */
  target: string[];
  /** The offending element's outer HTML. */
  html: string;
  /** Human readable explanation of what failed for this node. */
  failureSummary?: string;
}

/** A single axe rule violation (may span multiple nodes). */
export interface AxeViolation {
  /** axe rule id, e.g. "image-alt", "button-name". */
  id: string;
  /** Rule impact / severity. */
  impact: Impact;
  /** Short rule description. */
  description: string;
  /** Actionable guidance from axe. */
  help: string;
  /** Deep link to axe/Deque documentation. */
  helpUrl: string;
  /** WCAG / best-practice tags this rule maps to. */
  tags: string[];
  /** Affected DOM nodes. */
  nodes: AxeNode[];
}

/** Raw axe result for one scanned page. */
export interface AxePageResult {
  /** Friendly page name from the config. */
  page: string;
  /** Fully qualified URL that was scanned. */
  url: string;
  /** ISO timestamp of the scan. */
  timestamp: string;
  /** Rule violations found on the page. */
  violations: AxeViolation[];
  /** Rules that passed (kept for completeness / scoring). */
  passes: number;
  /** Rules that could not be determined automatically. */
  incomplete: number;
}

/** Top-level shape of reports/axe-report.json (Step 1). */
export interface AxeReport {
  /** ISO timestamp when the whole scan run completed. */
  generatedAt: string;
  /** Base URL that was scanned. */
  baseUrl: string;
  /** Per-page raw axe results. */
  results: AxePageResult[];
}

/** Counts of violations bucketed by impact. */
export interface SeverityCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

/**
 * A single flattened violation entry in summary.json (Step 2).
 * One entry is produced per (rule, page, node) combination so downstream
 * agents can act on a specific element.
 */
export interface SummaryViolation {
  /** Page friendly name. */
  page: string;
  /** Page URL. */
  url: string;
  /** axe rule id. */
  ruleId: string;
  /** WCAG / best-practice tag ids for the rule. */
  wcagRuleIds: string[];
  /** Rule description. */
  description: string;
  /** Impact / severity. */
  impact: Impact;
  /** CSS target selector of the offending element. */
  target: string;
  /** Offending element HTML. */
  html: string;
  /** Documentation URL. */
  helpUrl: string;
}

/** Top-level shape of reports/summary.json (Step 2). */
export interface Summary {
  /** ISO timestamp when the summary was generated. */
  generatedAt: string;
  /** Base URL scanned. */
  baseUrl: string;
  /** Total number of violation entries across all pages. */
  totalViolations: number;
  /** Number of distinct pages scanned. */
  pagesScanned: number;
  /** Aggregate severity counts. */
  severityCounts: SeverityCounts;
  /** Flattened, per-element violations. */
  violations: SummaryViolation[];
}

// ===========================================================================
// Technology 3 — Playwright Accessibility Snapshot
// ===========================================================================

/**
 * A node in the Playwright accessibility tree, captured via the Chrome
 * DevTools Protocol (`Accessibility.getFullAXTree`) since Playwright removed
 * the legacy `page.accessibility.snapshot()` API — roles, accessible names,
 * values and the child hierarchy exactly as the browser exposes them to
 * assistive tech.
 */
export interface A11yTreeNode {
  /** ARIA role, e.g. "button", "link", "img", "textbox". */
  role?: string;
  /** Computed accessible name. Empty/undefined means "no accessible name". */
  name?: string;
  /** Current value (for inputs / ranges). */
  value?: string;
  /** Accessible description. */
  description?: string;
  /** Whether the node is focusable (contributes to focus order). */
  focusable?: boolean;
  /** Child nodes, preserving document hierarchy. */
  children?: A11yTreeNode[];
  /** Any additional properties Playwright reports. */
  [key: string]: unknown;
}

/** Accessibility-tree snapshot captured for a single page. */
export interface A11yPageTree {
  /** Friendly page name. */
  page: string;
  /** Fully qualified URL. */
  url: string;
  /** ISO timestamp of the snapshot. */
  timestamp: string;
  /** Total number of nodes in the tree (roles/landmarks/controls). */
  nodeCount: number;
  /** Relative path to the page screenshot, when captured. */
  screenshot?: string;
  /** The raw accessibility tree, or null when it could not be captured. */
  tree: A11yTreeNode | null;
}

/** Top-level shape of reports/playwright-accessibility-tree.json (Step 3). */
export interface PlaywrightA11yReport {
  generatedAt: string;
  baseUrl: string;
  results: A11yPageTree[];
}

// ===========================================================================
// Technology 4 — Windows UI Automation (UIA)
// ===========================================================================

/**
 * A node in the Windows accessibility tree, as exposed to Windows Assistive
 * Technologies (Narrator, JAWS, NVDA) via the UI Automation API.
 */
export interface UiaNode {
  /** Accessible name Windows AT would announce. */
  name: string;
  /** UIA control type, e.g. "ButtonControl", "ImageControl", "EditControl". */
  role: string;
  /** UIA AutomationId. */
  automationId: string;
  /** Win32 class name. */
  className?: string;
  /** Whether the control is enabled. */
  isEnabled?: boolean | null;
  /** Whether the control can receive keyboard focus. */
  isKeyboardFocusable?: boolean | null;
  /** Whether the control is currently offscreen. */
  isOffscreen?: boolean | null;
  /** Screen bounding rectangle. */
  boundingRectangle?: { left: number; top: number; right: number; bottom: number } | null;
  /** Child controls, preserving hierarchy. */
  children: UiaNode[];
}

/** UIA capture for a single page/window. */
export interface UiaPageResult {
  /** Friendly page name. */
  page: string;
  /** Fully qualified URL. */
  url: string;
  /** ISO timestamp of the capture. */
  timestamp: string;
  /** Whether UIA data was successfully captured for this page. */
  available: boolean;
  /** Error message when capture failed. */
  error?: string;
  /** Title of the window that was inspected. */
  window?: string;
  /** Total number of UIA nodes captured. */
  nodeCount: number;
  /** The captured Windows accessibility tree, or null. */
  tree: UiaNode | null;
}

/** Top-level shape of reports/uia-tree.json (Step 4). */
export interface UiaReport {
  generatedAt: string;
  baseUrl: string;
  /** Host platform (UIA is Windows-only). */
  platform: string;
  /** Whether UIA executed at all on this host. */
  available: boolean;
  results: UiaPageResult[];
}

// ===========================================================================
// UIA Accessibility Rule Engine — turn raw UIA properties into findings
// ===========================================================================

/** Severity buckets shared by rule-engine findings. */
export type UiaSeverity = 'critical' | 'serious' | 'moderate' | 'minor';

/**
 * A single accessibility issue INFERRED from raw UIA properties by the Rule
 * Engine (uia-tree.json has no violations; this adds meaning).
 */
export interface UiaFinding {
  /** Id of the rule that produced this finding. */
  ruleId: string;
  /** Page the control was found on. */
  page: string;
  /** Page URL. */
  url: string;
  /** UIA control type (e.g. "ButtonControl"). */
  controlType: string;
  /** UIA AutomationId. */
  automationId: string;
  /** Accessible name (often empty for these findings). */
  name: string;
  /** Human-readable description of the issue. */
  issue: string;
  /** Severity. */
  severity: UiaSeverity;
  /** WCAG success criterion, e.g. "4.1.2". */
  wcag: string;
  /** How to fix it. */
  recommendation: string;
}

/** Top-level shape of reports/uia-findings.json. */
export interface UiaFindingsReport {
  generatedAt: string;
  baseUrl: string;
  totalFindings: number;
  severityCounts: { critical: number; serious: number; moderate: number; minor: number };
  findings: UiaFinding[];
}

// ===========================================================================
// Technology 5 — Full DOM Snapshot (visual / computed-style properties)
// ===========================================================================

/**
 * Computed style properties for a single DOM element. These capture the visual
 * facts (colours, font) that the accessibility trees cannot expose, so rules
 * like `color-contrast` can be verified against the real DOM.
 */
export interface DomElementStyle {
  /** CSS selector of the element. */
  target: string;
  /** Computed foreground colour. */
  color?: string;
  /** The element's OWN computed background colour — often transparent, since most
   *  text elements (span, p, li, …) don't set a background themselves. */
  backgroundColor?: string;
  /** Effective background colour actually rendered behind the element, found by
   *  walking up through ancestors and alpha-compositing every non-transparent
   *  background onto a white canvas default. Use THIS for contrast calculations —
   *  `backgroundColor` alone is transparent for most real-world text elements. */
  effectiveBackgroundColor?: string;
  /** Computed font size. */
  fontSize?: string;
  /** Computed font weight. */
  fontWeight?: string;
  /** Trimmed text content (for context). */
  text?: string;
}

/** Full DOM snapshot for a single page. */
export interface DomPageSnapshot {
  /** Friendly page name. */
  page: string;
  /** Fully qualified URL. */
  url: string;
  /** ISO timestamp of the snapshot. */
  timestamp: string;
  /** Total number of elements in the DOM. */
  nodeCount: number;
  /** Serialized full DOM (document.documentElement.outerHTML). */
  html: string;
  /** Computed styles for elements referenced by axe findings. */
  elements: DomElementStyle[];
}

/** Top-level shape of reports/dom-snapshot.json (Technology 5). */
export interface DomSnapshotReport {
  generatedAt: string;
  baseUrl: string;
  results: DomPageSnapshot[];
}

// ===========================================================================
// Keyboard / Tab-order navigation scan (WCAG 2.1.1, 2.4.3)
// ===========================================================================

/** One step in the actual Tab traversal order. */
export interface KeyboardStep {
  /** 1-based position in the Tab order. */
  order: number;
  /** Element tag, e.g. "button". */
  tag: string;
  /** Accessible/visible name snippet. */
  name: string;
  /** Internal marker linking back to the interactive element (or null). */
  kb: string | null;
}

/** An interactive element discovered in the DOM. */
export interface KeyboardInteractive {
  /** Internal index used to match against the Tab traversal. */
  index: number;
  /** Element tag. */
  tag: string;
  /** Accessible/visible name snippet. */
  name: string;
  /** The element's tabindex attribute value, if any. */
  tabindex: string | null;
}

/** A keyboard-accessibility issue inferred from Tab traversal. */
export interface KeyboardFinding {
  page: string;
  url: string;
  ruleId: string;
  issue: string;
  severity: UiaSeverity;
  wcag: string;
  recommendation: string;
  tag: string;
  name: string;
}

/** Keyboard traversal result for a single page. */
export interface KeyboardPageResult {
  page: string;
  url: string;
  timestamp: string;
  /** Count of distinct interactive elements reached by Tab. */
  reached: number;
  /** Total interactive elements found in the DOM. */
  interactiveTotal: number;
  /** The actual Tab order captured. */
  tabOrder: KeyboardStep[];
  /** Interactive elements never reached by Tab (keyboard gaps). */
  unreachable: KeyboardInteractive[];
  /** Elements using a positive tabindex (anti-pattern). */
  positiveTabindex: KeyboardInteractive[];
}

/** Top-level shape of reports/keyboard-report.json. */
export interface KeyboardReport {
  generatedAt: string;
  baseUrl: string;
  results: KeyboardPageResult[];
  /** Flattened findings for the merge step. */
  findings: KeyboardFinding[];
}

// ===========================================================================
// Report Merging — correlate findings across all scanners
// ===========================================================================
/** Outcome of cross-checking an axe finding against another scanner. */
export type VerificationStatus =
  | 'confirmed' // the other scanner also shows the problem (e.g. missing name)
  | 'not-detected' // the element exists but the problem was not observed
  | 'not-found' // no matching element found in that scanner's tree
  | 'unavailable'; // that scanner did not run (e.g. UIA off / non-Windows)

/**
 * A single merged finding: an axe-core violation correlated against the
 * Playwright accessibility tree and the Windows UI Automation tree.
 */
export interface MergedFinding extends SummaryViolation {
  /** Scanners that originally reported the issue. */
  detectedBy: string[];
  /** Cross-scanner verification of the issue. */
  verifiedIn: {
    playwrightTree: VerificationStatus;
    uia: VerificationStatus;
    /** Verified against real DOM computed styles (e.g. colour-contrast). */
    dom: VerificationStatus;
  };
  /** True when the UIA Rule Engine independently flagged a matching control. */
  uiaRuleFinding?: boolean;
  /** Correlation confidence 0-100 based on how many sources confirm it. */
  confidence?: number;
  /** Computed DOM style properties for the offending element, when captured. */
  domProperties?: DomElementStyle;
  /** Human-readable correlation summary. */
  correlation: string;
}

/** Top-level shape of reports/merged-report.json. */
export interface MergedReport {
  generatedAt: string;
  baseUrl: string;
  sources: {
    axe: boolean;
    playwrightTree: boolean;
    uia: boolean;
    dom: boolean;
    uiaRuleEngine: boolean;
    keyboard: boolean;
    expectedFocus: boolean;
    widgetBehavior: boolean;
    focusManagement: boolean;
    interactionPrediction: boolean;
  };
  totalFindings: number;
  severityCounts: SeverityCounts;
  findings: MergedFinding[];
  uiaFindings: UiaFinding[];
  keyboardFindings: KeyboardFinding[];
  expectedFocusGaps: ExpectedFocusGap[];
  widgetFindings: WidgetFinding[];
  focusManagementFindings: FocusManagementFinding[];
  interactionFindings: InteractionFinding[];
  trees: {
    playwrightNodeCount: number;
    uiaNodeCount: number;
    uiaAvailable: boolean;
    domElementsCaptured: number;
    uiaRuleFindingCount: number;
    keyboardFindingCount: number;
    expectedFocusGapCount: number;
    widgetFindingCount: number;
    focusManagementFindingCount: number;
    interactionFindingCount: number;
  };
}

// ===========================================================================
// Accessibility Rule Engine — unified finding type
// ===========================================================================

/** A flattened UIA element for rule evaluation. */
export interface FlatUiaElement {
  page: string;
  url: string;
  name: string;
  controlType: string;
  baseType: string;
  automationId: string;
  className?: string;
  isEnabled?: boolean | null;
  isKeyboardFocusable?: boolean | null;
  isOffscreen?: boolean | null;
  boundingRectangle?: { left: number; top: number; right: number; bottom: number } | null;
  depth: number;
}

// ===========================================================================
// Expected Focus Engine — expected vs actual keyboard focus comparison
// ===========================================================================

export interface ExpectedFocusGap {
  page: string;
  url: string;
  role: string;
  name: string;
  issue: string;
  severity: UiaSeverity;
  wcag: string;
  recommendation: string;
}

export interface ExpectedFocusReport {
  generatedAt: string;
  baseUrl: string;
  totalGaps: number;
  results: Array<{
    page: string;
    url: string;
    expectedFocusableCount: number;
    actualTabCount: number;
    gapCount: number;
    gaps: ExpectedFocusGap[];
  }>;
  allGaps: ExpectedFocusGap[];
}

// ===========================================================================
// Widget Behavior Engine — WAI-ARIA pattern interaction testing
// ===========================================================================

export interface WidgetFinding {
  page: string;
  url: string;
  widget: string;
  selector: string;
  name?: string;
  issue: string;
  severity: UiaSeverity;
  wcag: string;
  recommendation: string;
}

export interface WidgetBehaviorReport {
  generatedAt: string;
  baseUrl: string;
  totalFindings: number;
  findings: WidgetFinding[];
}

// ===========================================================================
// Focus Management Engine — focus after navigation / dialog lifecycle
// ===========================================================================

export interface FocusManagementFinding {
  page: string;
  url: string;
  scenario: string;
  issue: string;
  severity: UiaSeverity;
  wcag: string;
  recommendation: string;
  detail?: string;
}

export interface FocusManagementReport {
  generatedAt: string;
  baseUrl: string;
  totalFindings: number;
  findings: FocusManagementFinding[];
}

// ===========================================================================
// Interaction Prediction Engine — keyboard key response testing
// ===========================================================================

export interface InteractionFinding {
  page: string;
  url: string;
  selector: string;
  role: string;
  name: string;
  expectedKey: string;
  issue: string;
  severity: UiaSeverity;
  wcag: string;
  recommendation: string;
}

export interface InteractionReport {
  generatedAt: string;
  baseUrl: string;
  totalFindings: number;
  findings: InteractionFinding[];
}

