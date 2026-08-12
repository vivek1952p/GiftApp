/**
 * ADA Harness - Save Authenticated Session
 *
 * Generic, config-driven interactive login capture for applications whose
 * authentication can't be scripted with the simple `login` block in
 * config.json (SSO, ADFS, OAuth, MFA, CAPTCHA, …). Opens a real, headed
 * browser at `baseUrl`, lets the user complete login by hand, then saves the
 * resulting storage state (cookies + localStorage) to `auth/session.json` so
 * the specialized engines (widget behavior, focus management, interaction
 * prediction) can reuse an authenticated session.
 *
 * Nothing about the target app is hardcoded: readiness is detected via the
 * optional `auth.readySelector` in config.json (a CSS selector that only
 * exists once login succeeds), or — when unset — a manual confirmation
 * prompt in the terminal.
 *
 * Usage:  npm run save-auth
 * Reset:  Delete auth/session.json and run again.
 */

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { adaConfig } from '../playwright/config';

const AUTH_DIR = path.join(adaConfig.paths.root, 'auth');
const SESSION_FILE = path.join(AUTH_DIR, 'session.json');

function prompt(q: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, () => {
      rl.close();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  console.log('\n=== ADA Harness - Save Auth Session ===\n');

  const browser = await chromium.launch({
    headless: false,
    ...(adaConfig.channel ? { channel: adaConfig.channel } : {}),
  });
  const context = await browser.newContext({ viewport: adaConfig.viewport });
  const page = await context.newPage();

  try {
    await page.goto(adaConfig.baseUrl, {
      waitUntil: 'load',
      timeout: adaConfig.timeouts.navigationMs,
    });
  } catch {
    /* external identity-provider redirect — handled by the user in the browser */
  }

  console.log('Complete the login in the opened browser window.');

  const { readySelector, manualLoginTimeoutMs } = adaConfig.auth;

  if (readySelector) {
    console.log(`Waiting for "${readySelector}" to appear (confirms login succeeded)...`);
    const ready = await page
      .waitForSelector(readySelector, { timeout: manualLoginTimeoutMs })
      .then(() => true)
      .catch(() => false);
    if (!ready) {
      console.log(`Timed out waiting for "${readySelector}". Continuing — verify manually.`);
    } else {
      console.log('Login detected.\n');
    }
  } else {
    await prompt('Press Enter once you are fully logged in and the app has loaded: ');
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: SESSION_FILE });

  console.log(`\nSession saved -> ${SESSION_FILE}`);
  console.log('The scan and specialized engines will reuse this session automatically.\n');
  await browser.close();
}

main().catch((err) => {
  console.error('save-auth failed:', (err as Error).message);
  process.exit(1);
});
