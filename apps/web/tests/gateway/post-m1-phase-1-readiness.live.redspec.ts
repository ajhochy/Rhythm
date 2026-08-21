import { expect, test } from '@playwright/test';
import { liveEnvironment } from '../live-environment';

const { apiBase, engineBase } = liveEnvironment();

test('post-m1-p1-c1b: live cold launch gates application routes on API, engine, and auth readiness', async ({ page }) => {
  // Regression caught: the renderer exposes application routes while the live receipt still says
  // Connecting, or declares Live without observing both real sandbox health endpoints.
  const healthResponses: string[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(apiBase) || response.url().startsWith(engineBase)) {
      healthResponses.push(`${response.request().method()} ${response.url()} ${response.status()}`);
    }
  });
  await page.addInitScript(() => {
    const state = { routeExposedBeforeReady: false };
    Object.defineProperty(window, '__phase1Readiness', { value: state });
    const observer = new MutationObserver(() => {
      const receipt = document.querySelector('[data-testid="environment-receipt"]')?.textContent ?? '';
      if (document.querySelector('#main-content') && !receipt.includes('Environment: Live')) {
        state.routeExposedBeforeReady = true;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  });

  await page.goto('/#/agents');
  await expect(page.getByRole('status', { name: 'Environment receipt' })).toContainText('Environment: Live');
  expect(healthResponses).toEqual(expect.arrayContaining([
    `GET ${apiBase}/health 200`,
    `GET ${engineBase}/global/health 200`,
  ]));
  expect(await page.evaluate(() => (window as Window & { __phase1Readiness: { routeExposedBeforeReady: boolean } }).__phase1Readiness.routeExposedBeforeReady)).toBe(false);
  await expect(page.locator('#main-content')).toBeVisible();
});
