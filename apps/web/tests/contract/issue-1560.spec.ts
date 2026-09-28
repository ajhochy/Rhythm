import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.skip(process.env.RHYTHM_ISSUE_1560_CONTRACT !== '1', 'Run with the issue-1560 live-gateway Playwright config');

async function openSettings(page: Page) {
  await page.route('http://127.0.0.1:7165/**', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('http://127.0.0.1:7164/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': request.headers()['origin'] ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/agent-configs' || path === '/opencode/auth') return route.fulfill({ status: 200, headers, json: [] });
    if (path === '/opencode/auth/accounts') return route.fulfill({ status: 200, headers, json: { accounts: [] } });
    if (path === '/opencode/mcp') return route.fulfill({ status: 200, headers, json: [
      { name: 'gitnexus', status: 'connected', error: null, requiredEnv: [], needsCredentials: false, source: 'curated', tools: ['query'] },
      { name: 'notion', status: 'needs_auth', error: null, requiredEnv: [], needsCredentials: true, source: 'curated', tools: [] },
      { name: 'mailchimp', status: 'failed', error: 'MCP error -32000: Connection closed', requiredEnv: ['MAILCHIMP_API_KEY'], needsCredentials: true, source: 'curated', tools: [] },
    ] });
    return route.fulfill({ status: 200, headers, json: {} });
  });
  await page.goto('/#/tools/agent-settings?settingsSection=mcp');
  await expect(page.getByTestId('agent-settings-mcp-mailchimp')).toBeVisible();
}

test('1560-mcp-status-presentation:1 statuses have human labels and distinct card and badge treatments', async ({ page }) => {
  // Regression: connected, needs_auth and failed render as identical neutral cards with snake_case text.
  await openSettings(page);
  // Column layout: each server's card is the inspector for its row; the row carries the label too.
  const expected = [['gitnexus', /status-connected/, 'Connected'], ['notion', /status-needs-auth/, 'Needs authorization'], ['mailchimp', /status-failed/, 'Failed']] as const;
  const borders: string[] = []; const badgeColors: string[] = [];
  for (const [name, className, label] of expected) {
    await expect(page.getByTestId(`agent-settings-mcp-row-${name}`)).toContainText(label);
    await page.getByTestId(`agent-settings-mcp-row-${name}`).click();
    const row = page.getByTestId(`agent-settings-mcp-${name}`);
    await expect(row).toHaveClass(className);
    await expect(row.getByTestId(`agent-settings-mcp-status-${name}`)).toHaveText(label);
    borders.push(await row.evaluate((node) => getComputedStyle(node).borderColor));
    badgeColors.push(await row.locator('.kind-badge').evaluate((node) => getComputedStyle(node).color));
  }
  expect(new Set(borders).size).toBe(3);
  expect(new Set(badgeColors).size).toBe(3);
});

test('1560-mcp-status-presentation:2 server error is prominent and badges pass axe color contrast', async ({ page }) => {
  // Regression: the only error explanation is muted and smaller than every other card detail.
  await openSettings(page);
  const row = page.getByTestId('agent-settings-mcp-mailchimp');
  const error = row.getByRole('alert');
  const styles = await error.evaluate((node) => {
    const own = getComputedStyle(node);
    return { color: own.color, fontSize: Number.parseFloat(own.fontSize) };
  });
  const mutedColor = await row.locator('small').evaluate((node) => getComputedStyle(node).color);
  const smallestOther = Math.min(...await row.locator('small, .kind-badge').evaluateAll((nodes) => nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))));
  expect(styles.color).not.toBe(mutedColor);
  expect(styles.fontSize).toBeGreaterThanOrEqual(smallestOther);
  expect((await new AxeBuilder({ page }).include('.agent-settings-mcp-list').withRules(['color-contrast']).analyze()).violations).toEqual([]);
});
