/**
 * ============================================================================
 * ADA Harness — Scan Orchestrator (analyze.ts)
 * ============================================================================
 *
 * Full pipeline:
 *   1. Playwright spec   -> axe-core + AX tree + DOM snapshot + keyboard
 *   2. Summary           -> summary.json (only depends on step 1's axe-report.json;
 *                           run early so the Screen Reader Engine at step 9 has a
 *                           target list to re-verify)
 *   3. UIA scan          -> Windows UI Automation tree
 *   4. Accessibility Rule Engine -> uia-findings.json (merged rule engine)
 *   5. Expected Focus Engine    -> expected-focus-report.json
 *   6. Widget Behavior Engine   -> widget-behavior-report.json
 *   7. Focus Management Engine  -> focus-management-report.json
 *   8. Interaction Prediction   -> interaction-report.json
 *   9. Screen Reader Engine     -> screen-reader-report.json (guidepup + NVDA)
 *  10. Merge            -> merged-report.json
 * ============================================================================
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';

const log = createLogger('analyze');

/** Absolute path to this harness's Playwright config. */
const PLAYWRIGHT_CONFIG = path.join(adaConfig.paths.root, 'playwright', 'config.ts');

/** Absolute path to the scripts directory. */
const SCRIPTS_DIR = path.join(adaConfig.paths.root, 'scripts');

/**
 * Run a command synchronously, streaming its output, and throw on failure.
 * @param cmd  Executable to run.
 * @param args Arguments passed to the executable.
 */
function run(cmd: string, args: string[]): void {
  log.info(`> ${cmd} ${args.join(' ')}`);
  const useShell = process.platform === 'win32'; // allow npx.cmd resolution on Windows
  // When running through a shell, arguments are concatenated (not escaped), so any
  // path containing spaces (e.g. "Assign spec") must be quoted or it will be split.
  const finalArgs = useShell ? args.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `"${a}"` : a)) : args;
  const result = spawnSync(cmd, finalArgs, {
    stdio: 'inherit',
    shell: useShell,
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${cmd} ${args.join(' ')}`);
  }
}

/**
 * Run a command but do NOT stop the pipeline if it fails.
 * Used for optional enhancement engines — a failure is logged and the pipeline
 * continues so the core scan report is always produced.
 */
function runOptional(cmd: string, args: string[], label: string): void {
  try {
    run(cmd, args);
  } catch (err) {
    log.warn(`Optional stage "${label}" failed (pipeline continues): ${(err as Error).message}`);
  }
}

/**
 * Execute the full four-technology scan pipeline.
 */
export function analyze(): void {
  log.info('Starting full accessibility scan pipeline...');

  // 1. Playwright: axe-core + AX tree + DOM snapshot + keyboard traversal.
  run('npx', ['playwright', 'test', '--config', PLAYWRIGHT_CONFIG]);

  // 2. Generate the flattened summary from the raw axe report. Run early (only
  //    depends on step 1's axe-report.json) so the Screen Reader Engine at
  //    step 9 has a target list of missing-name violations to re-verify.
  run('npx', ['tsx', path.join(SCRIPTS_DIR, 'generate-summary.ts')]);

  // 3. Windows UI Automation tree (headed browser + Python UIA).
  run('npx', ['tsx', path.join(SCRIPTS_DIR, 'uia-scan.ts')]);

  // 4. Unified Accessibility Rule Engine (UIA findings — merged from rule-engine/).
  run('npx', ['tsx', path.join(SCRIPTS_DIR, 'uia-rule-engine.ts')]);

  // 5. Expected Focus Engine — expected vs actual keyboard focus comparison.
  runOptional('npx', ['tsx', path.join(SCRIPTS_DIR, 'expected-focus-engine.ts')], 'expected-focus');

  // 6. Widget Behavior Engine — WAI-ARIA pattern interaction tests.
  runOptional('npx', ['tsx', path.join(SCRIPTS_DIR, 'widget-behavior-engine.ts')], 'widget-behavior');

  // 7. Focus Management Engine — focus after client-side route navigation.
  runOptional('npx', ['tsx', path.join(SCRIPTS_DIR, 'focus-management-engine.ts')], 'focus-management');

  // 8. Interaction Prediction Engine — keyboard key response tests.
  runOptional('npx', ['tsx', path.join(SCRIPTS_DIR, 'interaction-prediction-engine.ts')], 'interaction');

  // 9. Screen Reader Engine — re-verifies missing-name findings with real NVDA (guidepup).
  runOptional('npx', ['tsx', path.join(SCRIPTS_DIR, 'screen-reader-engine.ts')], 'screen-reader');

  // 10. Merge all scanners into the correlated report.
  run('npx', ['tsx', path.join(SCRIPTS_DIR, 'merge-report.ts')]);

  log.info('Scan pipeline complete.');
}

// Allow running directly: `tsx scripts/analyze.ts`
if (require.main === module) {
  try {
    analyze();
  } catch (err) {
    log.error('Scan pipeline failed', (err as Error).message);
    process.exitCode = 1;
  }
}
