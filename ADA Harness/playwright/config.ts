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
 *      to scan, the base URL of the target React app, the WCAG rule tags to
 *      evaluate against, and the canonical filesystem paths for every artifact
 *      the harness produces (raw axe report, summary, comparison, dashboard).
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
  /** Python executable used to run the UIA capture script. */
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
  enabled: boolean;  /** When true, the full serialized DOM (outerHTML) is stored per page. */
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
 * Canonical, absolute filesystem paths for every artifact the harness reads
 * or writes. Centralising these avoids brittle relative-path bugs when scripts
 * are executed from different working directories.
 */
export interface HarnessPaths {
  /** Root directory of the ada-harness package. */
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
  /** Correlated, cross-scanner merged report. */
  merged: string;
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
}

/** Absolute root of the ada-harness package (…/ada-harness). */
const HARNESS_ROOT = path.resolve(__dirname, '..');

/** Absolute path to the project-specific configuration file. */
const CONFIG_FILE = path.join(HARNESS_ROOT, 'config.json');

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
  uia: raw.uia,
  dom: raw.dom ?? { enabled: true, fullHtml: true },
  keyboard: raw.keyboard ?? { enabled: true, maxTabs: 200 },
  screenshots: raw.screenshots,

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
    merged: path.join(REPORTS_DIR, 'merged-report.json'),
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
 * Run with:  npx playwright test --config ada-harness/playwright/config.ts
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
