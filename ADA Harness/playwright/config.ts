/**
 * ============================================================================
 * ADA Harness — Playwright + Harness Configuration
 * ============================================================================
 *
 * This module has two responsibilities:
 *
 *   1. It exports the *Playwright configuration* (default export) used to run
 *      the accessibility spec. It points Playwright at this folder as the test
 *      directory and wires up the reporters/timeouts we need for a11y scans.
 *
 *   2. It exports the *harness configuration* (`adaConfig`) — the list of pages
 *      to scan, the base URL of the target application (any framework), the
 *      WCAG rule tags to evaluate against, and the canonical filesystem paths
 *      for every artifact the harness produces (raw axe report, summary,
 *      comparison, dashboard).
 *
 * Keeping both in one file means there is a single source of truth for "what
 * do we scan and where do the results go".
 * ============================================================================
 */

import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/** Supported browser engines. UIA capture always uses a Chromium window. */
export type BrowserName = 'chromium' | 'firefox' | 'webkit';

/**
 * A single page target to be scanned by axe-core.
 */
export interface PageTarget {
  /** Human friendly name used in reports (e.g. "Home"). */
  name: string;
  /** Route path appended to `baseUrl` (e.g. "/login"). */
  path: string;
}

/** Browser viewport size used for every scan. */
export interface ViewportConfig {
  width: number;
  height: number;
}

/** Per-stage timeouts (milliseconds). */
export interface Timeouts {
  /** Max time to wait for a navigation to complete. */
  navigationMs: number;
  /** Max time for a single Playwright test. */
  testMs: number;
}

/**
 * Optional authentication flow executed once before scanning protected routes.
 * Credentials are read from environment variables (never hardcoded) named by
 * `usernameEnv` / `passwordEnv`.
 */
export interface LoginConfig {
  /** When false the login step is skipped entirely. */
  enabled: boolean;
  /** Route that renders the login form (appended to baseUrl). */
  loginPath: string;
  /** CSS selector for the username/email field. */
  usernameSelector: string;
  /** CSS selector for the password field. */
  passwordSelector: string;
  /** CSS selector for the submit button. */
  submitSelector: string;
  /** Env var holding the username (e.g. ADA_LOGIN_USER). */
  usernameEnv: string;
  /** Env var holding the password (e.g. ADA_LOGIN_PASS). */
  passwordEnv: string;
  /** Optional selector to wait for that confirms a successful login. */
  waitForSelector?: string;
}

/** Configuration for the Windows UI Automation capture stage. */
export interface UiaConfig {
  /** When false the UIA capture is skipped (produces an unavailable report). */
  enabled: boolean;
  /** Python executable used to run the UIA capture script. Overridable via the ADA_UIA_PYTHON environment variable. */
  python: string;
  /** Maximum depth to walk the Windows accessibility tree. */
  maxDepth: number;
  /** Win32 class name of the browser window to attach to. */
  windowClass: string;
  /**
   * When true, the Rule Engine only evaluates the web Document subtree and skips
   * browser chrome (toolbar, tabs, address bar) so findings focus on the app.
   */
  documentOnly?: boolean;
}

/** Configuration for the full DOM snapshot capture (Technology 5). */
export interface DomConfig {
  /** When false the DOM snapshot is skipped. */
  enabled: boolean;
  /** When true, the full serialized DOM (outerHTML) is stored per page. */
  fullHtml: boolean;
}

/** Configuration for per-page screenshots captured during the scan. */
export interface ScreenshotConfig {
  enabled: boolean;
  /** Directory (relative to the harness root) where screenshots are written. */
  dir: string;
}

/** Configuration for the keyboard / Tab-order navigation scan. */
export interface KeyboardConfig {
  /** When false the keyboard traversal scan is skipped. */
  enabled: boolean;
  /** Maximum number of Tab presses to simulate per page. */
  maxTabs: number;
}

/**
 * How the specialized engines (widget behavior, focus management, interaction
 * prediction) move between configured pages.
 */
export interface NavigationConfig {
  /**
   * `"reload"` calls `page.goto()` for every route — works for any application,
   * SPA or multi-page, with no framework assumptions. `"spa"` performs a
   * same-document `history.pushState` + `popstate` navigation after the first
   * page, which is faster but only correct for apps with a real client-side
   * router. Defaults to `"reload"` so behavior is correct out of the box.
   */
  mode: 'reload' | 'spa';
}

/** CSS selectors the Widget Behavior Engine uses to find app widgets. */
export interface WidgetsConfig {
  /** Selector(s) for accordion headers, comma-separated (Playwright `locator` syntax). */
  accordionSelector: string;
}

/**
 * Optional interactive authentication flow (`npm run save-auth`) for apps that
 * require a real login (SSO, ADFS, OAuth, …) before scanning. Independent of
 * the scripted `LoginConfig` above, which only supports simple username/password
 * forms with known selectors.
 */
export interface AuthConfig {
  /**
   * Gates whether a saved `auth/session.json` is loaded by the main scan, the
   * UIA scan, and the 4 specialized engines. `save-auth` itself always runs
   * regardless of this flag (it's how the session file gets created); this
   * only controls whether an already-saved session is *reused*, so you can
   * temporarily disable session reuse without deleting the file.
   */
  enabled: boolean;
  /** Max time to wait for the user to complete login manually. */
  manualLoginTimeoutMs: number;
  /** CSS selector that only appears once login has succeeded. Optional. */
  readySelector: string;
}

/** Configuration for the auto-fix engine's project layout assumptions. */
export interface AutoFixConfig {
  /** File extensions (with leading dot) eligible for automatic source fixes. */
  sourceExtensions: string[];
  /** Candidate paths (relative to the application root, i.e. the parent of `appSrcDir`) for the `<html lang>` fix, tried in order. */
  htmlEntryPoints: string[];
  /**
   * When false (the default), the auto-fix engine never edits source files —
   * every SAFE-rule fix it would otherwise apply is instead reported as a
   * suggestion (same as UNSAFE rules), so `npm run auto-fix` is a pure report.
   * Set true to let it write the small set of unambiguous, additive fixes
   * (missing alt/aria-label/label/lang) directly to source.
   */
  applyFixes: boolean;
}

/**
 * Canonical, absolute filesystem paths for every artifact the harness reads
 * or writes. Centralising these avoids brittle relative-path bugs when scripts
 * are executed from different working directories.
 */
export interface HarnessPaths {
  /** Root directory of the harness package. */
  root: string;
  /** Directory where all generated reports live. */
  reportsDir: string;
  /** Raw, complete axe-core results (Step 1). */
  axeReport: string;
  /** Simplified, flattened violation summary (Step 2). */
  summary: string;
  /** Snapshot of the previous summary, used for before/after comparison. */
  previousSummary: string;
  /** Markdown before/after comparison report (Step 6). */
  comparison: string;
  /** Markdown dashboard (Step 7). */
  dashboard: string;
  /** Playwright accessibility-tree snapshot for every page. */
  a11yTree: string;
  /** Windows UI Automation tree capture for every page. */
  uiaTree: string;
  /** Accessibility findings inferred from the UIA tree by the Rule Engine. */
  uiaFindings: string;
  /** Full DOM snapshot (serialized DOM + computed styles) for every page. */
  domSnapshot: string;
  /** Keyboard / Tab-order navigation report. */
  keyboardReport: string;
  /** Expected Focus Engine report. */
  expectedFocusReport: string;
  /** Widget Behavior Engine report. */
  widgetBehaviorReport: string;
  /** Focus Management Engine report. */
  focusManagementReport: string;
  /** Interaction Prediction Engine report. */
  interactionReport: string;
  /** Correlated, cross-scanner merged report. */
  merged: string;
  /** Snapshot of the previous merged report — the basis for comparing ALL 7
   *  scanners across scans (not just axe-core, unlike `previousSummary`). */
  mergedPrevious: string;
  /** Auto-fix audit log. */
  fixes: string;
  /** Human-readable Markdown fix report. */
  fixesMd: string;
  /** Machine-readable resolved issues (after re-scan). */
  resolvedIssues: string;
  /** Machine-readable remaining issues (after re-scan). */
  remainingIssues: string;
  /** Project-independent knowledge base of resolved fix patterns. */
  knowledgeBase: string;
  /** Directory where per-page screenshots are written. */
  screenshotsDir: string;
  /** Root of the application source that auto-fixes are applied to. */
  appSrc: string;
}

/**
 * Full harness configuration contract.
 */
export interface AdaConfig {
  /** Base URL of the running application under test. */
  baseUrl: string;
  /** Browser engine used for the axe-core / snapshot scan. */
  browser: BrowserName;
  /** Optional Chromium channel, e.g. "msedge" (Edge) or "chrome". */
  channel?: string;
  /** Viewport size for every scanned page. */
  viewport: ViewportConfig;
  /** Milliseconds to wait for network idle / hydration before scanning. */
  settleTimeoutMs: number;
  /** Per-stage timeouts. */
  timeouts: Timeouts;
  /** WCAG + best-practice tags passed to axe-core `withTags`. */
  wcagTags: string[];
  /** axe rule ids to disable (e.g. project-approved exceptions). */
  ignoredRules: string[];
  /** Every page that should be scanned (after ignoredRoutes are removed). */
  pages: PageTarget[];
  /** Route paths that must never be scanned. */
  ignoredRoutes: string[];
  /** Optional authentication flow. */
  login: LoginConfig;
  /** Windows UI Automation capture settings. */
  uia: UiaConfig;
  /** Full DOM snapshot settings. */
  dom: DomConfig;
  /** Keyboard / Tab-order navigation scan settings. */
  keyboard: KeyboardConfig;
  /** Screenshot capture settings. */
  screenshots: ScreenshotConfig;
  /** Multi-page navigation strategy for the specialized engines. */
  navigation: NavigationConfig;
  /** Selectors used by the Widget Behavior Engine. */
  widgets: WidgetsConfig;
  /** Optional interactive authentication flow (`npm run save-auth`). */
  auth: AuthConfig;
  /** Auto-fix engine's project-layout assumptions. */
  autoFix: AutoFixConfig;
  /** Absolute artifact paths. */
  paths: HarnessPaths;
}

/** Raw shape of config.json before path resolution. */
interface RawConfig {
  baseUrl: string;
  browser: BrowserName;
  channel?: string;
  viewport: ViewportConfig;
  settleTimeoutMs: number;
  timeouts: Timeouts;
  appSrcDir: string;
  reportDir: string;
  screenshots: ScreenshotConfig;
  wcagTags: string[];
  ignoredRules: string[];
  routes: PageTarget[];
  ignoredRoutes: string[];
  login: LoginConfig;
  uia: UiaConfig;
  dom: DomConfig;
  keyboard: KeyboardConfig;
  navigation?: NavigationConfig;
  widgets?: WidgetsConfig;
  auth?: AuthConfig;
  autoFix?: AutoFixConfig;
}

/** Absolute root of the harness package. */
const HARNESS_ROOT = path.resolve(__dirname, '..');

/** Absolute path to the project-specific configuration file. */
const CONFIG_FILE = path.join(HARNESS_ROOT, 'config.json');

/**
 * Session file produced by `npm run save-auth`, for apps that need a real
 * login (SSO/ADFS/OAuth/…) the scripted `login` block can't handle. Loaded
 * into the main scan's browser context below when present and enabled — the
 * specialized engines and UIA scan already load it themselves, and without
 * this the main axe-core scan (the source of the primary summary.json
 * violation counts) would run unauthenticated while everything else ran
 * authenticated, producing inconsistent results.
 */
const AUTH_SESSION_FILE = path.join(HARNESS_ROOT, 'auth', 'session.json');

/**
 * Load and parse config.json. This is the ONLY place project-specific values
 * enter the harness — nothing below is hardcoded.
 */
function loadRawConfig(): RawConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Missing configuration file: ${CONFIG_FILE}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as RawConfig;
}

const raw = loadRawConfig();

/** Directory that holds every generated artifact (configurable). */
const REPORTS_DIR = path.resolve(HARNESS_ROOT, raw.reportDir);

/** Absolute root of the application source that fixes are applied to. */
const APP_SRC = path.resolve(HARNESS_ROOT, raw.appSrcDir);

/** Directory where per-page screenshots are written (configurable). */
const SCREENSHOTS_DIR = path.resolve(HARNESS_ROOT, raw.screenshots.dir);

/**
 * The harness configuration consumed by the spec and every script.
 *
 * `baseUrl` / `ADA_SETTLE_MS` can still be overridden via environment variables
 * so the same harness can point at staging / preview deployments in CI without
 * editing config.json.
 */
export const adaConfig: AdaConfig = {
  baseUrl: process.env.ADA_BASE_URL ?? raw.baseUrl,
  browser: raw.browser,
  channel: raw.channel,
  viewport: raw.viewport,
  settleTimeoutMs: Number(process.env.ADA_SETTLE_MS ?? raw.settleTimeoutMs),
  timeouts: raw.timeouts,
  wcagTags: raw.wcagTags,
  ignoredRules: raw.ignoredRules ?? [],

  // Remove any explicitly ignored routes so no source change is needed to skip.
  pages: raw.routes.filter((r) => !(raw.ignoredRoutes ?? []).includes(r.path)),
  ignoredRoutes: raw.ignoredRoutes ?? [],

  login: raw.login,
  uia: { ...raw.uia, python: process.env.ADA_UIA_PYTHON ?? raw.uia.python },
  dom: raw.dom ?? { enabled: true, fullHtml: true },
  keyboard: raw.keyboard ?? { enabled: true, maxTabs: 200 },
  screenshots: raw.screenshots,
  navigation: raw.navigation ?? { mode: 'reload' },
  widgets: raw.widgets ?? {
    accordionSelector: 'details > summary, [role="button"][aria-expanded]',
  },
  auth: raw.auth ?? { enabled: false, manualLoginTimeoutMs: 300000, readySelector: '' },
  autoFix: raw.autoFix ?? {
    sourceExtensions: ['.tsx', '.ts', '.jsx', '.js', '.vue', '.html'],
    htmlEntryPoints: ['public/index.html', 'src/index.html', 'index.html'],
    applyFixes: false,
  },

  paths: {
    root: HARNESS_ROOT,
    reportsDir: REPORTS_DIR,
    axeReport: path.join(REPORTS_DIR, 'axe-report.json'),
    summary: path.join(REPORTS_DIR, 'summary.json'),
    previousSummary: path.join(REPORTS_DIR, 'summary.previous.json'),
    comparison: path.join(REPORTS_DIR, 'comparison.md'),
    dashboard: path.join(REPORTS_DIR, 'dashboard.md'),
    a11yTree: path.join(REPORTS_DIR, 'playwright-accessibility-tree.json'),
    uiaTree: path.join(REPORTS_DIR, 'uia-tree.json'),
    uiaFindings: path.join(REPORTS_DIR, 'uia-findings.json'),
    domSnapshot: path.join(REPORTS_DIR, 'dom-snapshot.json'),
    keyboardReport: path.join(REPORTS_DIR, 'keyboard-report.json'),
    expectedFocusReport: path.join(REPORTS_DIR, 'expected-focus-report.json'),
    widgetBehaviorReport: path.join(REPORTS_DIR, 'widget-behavior-report.json'),
    focusManagementReport: path.join(REPORTS_DIR, 'focus-management-report.json'),
    interactionReport: path.join(REPORTS_DIR, 'interaction-report.json'),
    merged: path.join(REPORTS_DIR, 'merged-report.json'),
    mergedPrevious: path.join(REPORTS_DIR, 'merged-report.previous.json'),
    fixes: path.join(REPORTS_DIR, 'fixes.json'),
    fixesMd: path.join(REPORTS_DIR, 'fixes.md'),
    resolvedIssues: path.join(REPORTS_DIR, 'resolved-issues.json'),
    remainingIssues: path.join(REPORTS_DIR, 'remaining-issues.json'),
    knowledgeBase: path.join(HARNESS_ROOT, 'agent', 'knowledge-base.json'),
    screenshotsDir: SCREENSHOTS_DIR,
    appSrc: APP_SRC,
  },
};

/** Map the configured browser name to a Playwright device descriptor. */
const DEVICE_BY_BROWSER: Record<BrowserName, typeof devices[string]> = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

/**
 * Playwright configuration (default export).
 *
 * Run with:  npx playwright test --config "ADA Harness/playwright/config.ts"
 */
export default defineConfig({
  // The spec lives alongside this config file.
  testDir: __dirname,
  testMatch: /accessibility\.spec\.ts/,

  // Accessibility scans should be deterministic; run serially in one worker
  // so the aggregated axe-report.json is written atomically by a single test.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: adaConfig.timeouts.testMs,

  reporter: [['list']],

  use: {
    baseURL: adaConfig.baseUrl,
    viewport: adaConfig.viewport,
    navigationTimeout: adaConfig.timeouts.navigationMs,
    trace: 'on-first-retry',
    ...(adaConfig.auth.enabled && fs.existsSync(AUTH_SESSION_FILE)
      ? { storageState: AUTH_SESSION_FILE }
      : {}),
  },

  projects: [
    {
      name: adaConfig.channel ?? adaConfig.browser,
      use: {
        ...DEVICE_BY_BROWSER[adaConfig.browser],
        viewport: adaConfig.viewport,
        // Use a specific Chromium channel (e.g. Microsoft Edge) when configured.
        ...(adaConfig.channel ? { channel: adaConfig.channel } : {}),
      },
    },
  ],
});
