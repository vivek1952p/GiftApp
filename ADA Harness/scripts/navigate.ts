/**
 * ============================================================================
 * Shared page-navigation helper for the specialized engines
 * ============================================================================
 *
 * Every specialized engine (Widget Behavior, Focus Management, Interaction
 * Prediction) and the UIA capture stage need to visit every configured page in
 * a single browser session. This module is the one place that decides HOW to
 * move between pages, driven entirely by `adaConfig.navigation.mode`:
 *
 *   - "reload" (default) — plain `page.goto()` for every route. Works for any
 *     application (SPA or multi-page) with zero framework assumptions.
 *   - "spa"    — after the first page, performs a same-document
 *     `history.pushState` + `popstate` navigation instead of a full reload.
 *     Faster, but only correct for apps with a real client-side router;
 *     opt-in via config.
 * ============================================================================
 */

import type { Page } from '@playwright/test';
import type { AdaConfig, PageTarget } from '../playwright/config';

/**
 * Navigate `page` to `target`, using the configured strategy.
 *
 * @param page        The Playwright page to navigate.
 * @param target      The route to visit.
 * @param adaConfig   Harness configuration (base URL, navigation mode, timeouts).
 * @param isFirstPage True for the first page visited in this browser session —
 *                    always a full navigation regardless of mode, since there is
 *                    no prior document to patch with `pushState`.
 */
export async function gotoPage(
  page: Page,
  target: PageTarget,
  adaConfig: AdaConfig,
  isFirstPage: boolean
): Promise<void> {
  const url = new URL(target.path, adaConfig.baseUrl).toString();

  if (isFirstPage || adaConfig.navigation.mode !== 'spa') {
    await page.goto(url, { waitUntil: 'load', timeout: adaConfig.timeouts.navigationMs });
    await page.waitForTimeout(adaConfig.settleTimeoutMs);
    return;
  }

  // SPA mode: same-document navigation via the History API, then let the
  // app's own router react to the popstate event. Deliberately does NOT wait
  // for 'networkidle' — apps with a persistent websocket/SSE/polling
  // connection (common in enterprise dashboards, chat widgets, live
  // notifications) never go network-idle, which would otherwise block every
  // SPA navigation for the full navigation timeout. A bounded settle wait is
  // reliable regardless of what the app's network activity looks like.
  const spaBase = new URL(adaConfig.baseUrl).origin;
  await page.evaluate(
    ({ base, path }) => {
      window.history.pushState({}, '', `${base}${path}`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    },
    { base: spaBase, path: target.path }
  );
  await page.waitForTimeout(adaConfig.settleTimeoutMs);
}
