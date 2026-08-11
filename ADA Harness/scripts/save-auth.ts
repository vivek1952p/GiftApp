/**
 * ADA Harness - Save Authenticated Session
 *
 * Steps:
 *   1. Log in (ADFS / federated auth)
 *   2. Select your user group (Account Selection screen)
 *
 * A valid session only requires authentication + account selection.
 * File selection is handled during the scan via Angular SPA navigation.
 *
 * Usage:  npm run save-auth
 * Reset:  Delete auth/session.json and run again.
 */

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { adaConfig } from '../playwright/config';

const AUTH_DIR     = path.join(adaConfig.paths.root, 'auth');
const SESSION_FILE = path.join(AUTH_DIR, 'session.json');

function prompt(q: string): Promise<void> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, () => { rl.close(); resolve(); });
  });
}

async function main(): Promise<void> {
  console.log('\n=== ADA Harness - Save Auth Session ===\n');

  const browser = await chromium.launch({
    headless: false,
    ...(adaConfig.channel ? { channel: adaConfig.channel } : {}),
  });
  const context = await browser.newContext({ viewport: adaConfig.viewport });
  const page    = await context.newPage();

  try {
    await page.goto(`${adaConfig.baseUrl}/Home`, {
      waitUntil: 'load', timeout: adaConfig.timeouts.navigationMs,
    });
  } catch { /* external IdP redirect - handled by user */ }

  // Wait for login + account selection
  const onAcctSel = await page.title().then(t => t === 'Account Selection').catch(() => false);
  if (onAcctSel) console.log('Account Selection detected - click your user group in the browser.\n');

  console.log('Waiting for login + account selection...');
  await page.waitForFunction(
    () => document.title !== 'Account Selection' && document.title !== '',
    { timeout: 5 * 60 * 1000 }
  ).catch(() => {});

  console.log('Login complete.\n');

  // Verify Home page loads with real content (893+ AX nodes)
  const nodeCount = await page.evaluate(() =>
    document.querySelectorAll('[role]').length
  );
  console.log(`Home page AX nodes: ${nodeCount} (expect >50 for real content)`);

  if (nodeCount < 50) {
    console.log('Home page does not look fully loaded yet.');
    await prompt('Press Enter once you see the full Home dashboard in the browser: ');
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: SESSION_FILE });

  console.log(`\nSession saved -> ${SESSION_FILE}`);
  console.log('The scan will use Angular SPA navigation to visit other pages.\n');
  await browser.close();
}

main().catch(err => {
  console.error('save-auth failed:', (err as Error).message);
  process.exit(1);
});