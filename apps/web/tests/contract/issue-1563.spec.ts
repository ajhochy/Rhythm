import { expect, test, type Page, type Route } from '@playwright/test';

test.skip(process.env.RHYTHM_ISSUE_1563_CONTRACT !== '1', 'Run with the issue-1563 live-gateway Playwright config');

const autoPromotionState = {
  availability: true,
  state: {
    autoPromotionEnabled: false,
    enabledAt: null,
    autoPromotionEligible: true,
    totalVerified: 5,
    totalRegressions: 0,
    trustThreshold: 5,
  },
};

async function installRoutes(page: Page, options: { engineFails?: boolean; autoPromotionUnavailable?: boolean } = {}) {
  const counts = { apiHealth: 0, engineHealth: 0, autoPromotion: 0 };
  await page.route('http://127.0.0.1:7262/**', async (route: Route) => {
    counts.engineHealth++;
    await route.fulfill(options.engineFails
      ? { status: 503, json: { error: 'raw engine exception sentinel' } }
      : { status: 200, json: { healthy: true } });
  });
  await page.route('http://127.0.0.1:7261/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const headers = {
      'access-control-allow-origin': request.headers().origin ?? '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (pathname === '/health') { counts.apiHealth++; return route.fulfill({ status: 200, headers, json: { healthy: true } }); }
    if (pathname === '/opencode/auth/accounts') return route.fulfill({ status: 200, headers, json: { accounts: [] } });
    if (pathname === '/opencode/auth') return route.fulfill({ status: 200, headers, json: { providers: [] } });
    if (pathname === '/agent-configs' || pathname === '/opencode/mcp') return route.fulfill({ status: 200, headers, json: [] });
    return route.fulfill({ status: 404, headers, json: { error: 'not found' } });
  });
  await page.route('https://api.vcrcapps.com/**', async (route: Route) => {
    if (new URL(route.request().url()).pathname !== '/optimizer/auto-promotion') return route.fulfill({ status: 404, json: { error: 'not found' } });
    counts.autoPromotion++;
    if (options.autoPromotionUnavailable) return route.abort('connectionfailed');
    return route.fulfill({ status: 200, json: autoPromotionState });
  });
  return counts;
}

async function openAgentSettings(page: Page, options: Parameters<typeof installRoutes>[1] = {}) {
  const counts = await installRoutes(page, options);
  await page.goto('/#/tools/agent-settings');
  await expect(page.getByRole('listbox', { name: 'Agent settings sections' })).toHaveAttribute('aria-busy', 'false');
  return counts;
}

test('1563:runtime-and-auto-promotion-status:1 Runtime reports both known healthy services on open', async ({ page }) => {
  // Regression: Runtime initializes both services to Not checked until the user clicks twice.
  const counts = await openAgentSettings(page);
  await page.getByRole('option', { name: 'Runtime / OpenCode server' }).click();
  const detail = page.getByTestId('list-inspector-detail');
  await expect(detail.getByTestId('runtime-status-api')).toHaveText('Healthy');
  await expect(detail.getByTestId('runtime-status-engine')).toHaveText('Healthy');
  await expect(detail).not.toContainText('Not checked');
  expect(counts.apiHealth).toBeGreaterThan(0);
  expect(counts.engineHealth).toBeGreaterThan(0);
});

test('1563:runtime-and-auto-promotion-status:2 failed health is announced, visually distinct, and sanitized', async ({ page }) => {
  // Regression: a raw exception is dumped into an unannounced value cell styled like success.
  await openAgentSettings(page, { engineFails: true });
  await page.getByRole('option', { name: 'Runtime / OpenCode server' }).click();
  const healthy = page.getByTestId('runtime-status-api');
  const failed = page.getByTestId('runtime-status-engine');
  await expect(failed).toContainText('Failed');
  await expect(failed.getByRole('alert')).toContainText('OpenCode engine is unavailable');
  await expect(failed).not.toContainText('raw engine exception sentinel');
  expect(await failed.evaluate((node) => getComputedStyle(node).color)).not.toBe(await healthy.evaluate((node) => getComputedStyle(node).color));
});

test('1563:runtime-and-auto-promotion-status:3 status values are readable and paired with nearby labels', async ({ page }) => {
  // Regression: prose values fall back to 9px right-aligned monospace across a wide inspector.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAgentSettings(page);
  for (const option of ['Runtime / OpenCode server', 'Auto-promotion']) {
    await page.getByRole('option', { name: option, exact: true }).click();
    const rows = page.getByTestId('list-inspector-detail').locator('.agent-settings-property-list > div');
    await expect(rows.first()).toBeVisible();
    for (let index = 0; index < await rows.count(); index++) {
      const row = rows.nth(index);
      const value = row.locator('dd');
      const metrics = await value.evaluate((node) => {
        const style = getComputedStyle(node);
        return { fontSize: Number.parseFloat(style.fontSize), fontFamily: style.fontFamily };
      });
      expect(metrics.fontSize).toBeGreaterThanOrEqual(12);
      expect(metrics.fontFamily).not.toMatch(/mono|menlo|consolas|courier/i);
      const labelBox = await row.locator('dt').boundingBox();
      const valueBox = await value.boundingBox();
      expect(valueBox!.x - (labelBox!.x + labelBox!.width)).toBeLessThan(200);
    }
  }
});

test('1563:runtime-and-auto-promotion-status:4 unavailable auto-promotion is unknown, retryable, and accurately blocked', async ({ page }) => {
  // Regression: a failed GET is presented as Disabled with an eligibility explanation and inline link.
  const counts = await openAgentSettings(page, { autoPromotionUnavailable: true });
  await page.getByRole('option', { name: 'Auto-promotion', exact: true }).click();
  const card = page.getByTestId('auto-promotion-settings');
  await expect(card.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(card.getByText('Enabled', { exact: true })).toHaveCount(0);
  await expect(card.getByText('Disabled', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('alert')).toContainText('Auto-promotion service unavailable');
  const toggle = card.getByTestId('auto-promotion-toggle');
  await expect(toggle).toHaveAttribute('title', /service.*unreachable/i);
  const before = counts.autoPromotion;
  await card.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => counts.autoPromotion).toBe(before + 1);
  await expect(page.getByTestId('auto-promotion')).toContainText('Unavailable');
});

test('1563:runtime-and-auto-promotion-status:5 auto-promotion row exposes live state instead of placeholder copy', async ({ page }) => {
  // Regression: the row remains static even after the service reports a disabled eligible state.
  await openAgentSettings(page);
  const row = page.getByRole('option', { name: 'Auto-promotion', exact: true });
  await expect(row).toContainText('Disabled · Eligible');
  await expect(row).not.toContainText('Workspace eligibility and confirmation gates');
});
