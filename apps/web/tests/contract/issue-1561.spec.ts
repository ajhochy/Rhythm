import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.RHYTHM_ISSUE_1561_CONTRACT !== '1', 'Run with the issue-1561 live-gateway Playwright config');

const attention = [
  ['ableton-mcp', 'failed'], ['mailchimp', 'failed'], ['propresenter', 'failed'], ['canva', 'needs_auth'], ['notion', 'needs_auth'],
] as const;
const connected = Array.from({ length: 21 }, (_, index) => [`server-${String(index + 1).padStart(2, '0')}`, 'connected'] as const);
let fixture = [...connected, ...attention];

async function openSettings(page: Page) {
  await page.route('http://127.0.0.1:7168/**', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('http://127.0.0.1:7167/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': request.headers()['origin'] ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/agent-configs' || path === '/opencode/auth') return route.fulfill({ status: 200, headers, json: [] });
    if (path === '/opencode/auth/accounts') return route.fulfill({ status: 200, headers, json: { accounts: [] } });
    if (path === '/opencode/mcp') return route.fulfill({ status: 200, headers, json: fixture.map(([name, status]) => ({ name, status, error: status === 'failed' ? 'Connection failed' : null, requiredEnv: [], needsCredentials: status === 'needs_auth', source: 'curated', tools: [] })) });
    return route.fulfill({ status: 200, headers, json: {} });
  });
  await page.goto('/#/tools/agent-settings?settingsSection=mcp');
  await expect(page.getByTestId('agent-settings-mcp-mailchimp')).toBeVisible();
}

test.beforeEach(() => { fixture = [...connected, ...attention]; });

test('1561-mcp-layout-and-rail-containment:1 list precedes collapsed add disclosure', async ({ page }) => {
  // Regression: the rarely used creation form occupies the top of a long management surface.
  await openSettings(page);
  const disclosure = page.getByTestId('agent-settings-mcp-add-disclosure');
  expect(await page.locator('.agent-settings-mcp-list, [data-testid="agent-settings-mcp-add-disclosure"]').evaluateAll((nodes) => nodes.map((node) => node.classList.contains('agent-settings-mcp-list') ? 'list' : 'add'))).toEqual(['list', 'add']);
  await expect(page.getByTestId('agent-settings-mcp-add-name')).not.toBeVisible();
  await disclosure.locator('summary').click();
  await expect(page.getByTestId('agent-settings-mcp-add-name')).toBeVisible();
});

test('1561-mcp-layout-and-rail-containment:2 attention servers sort before connected servers', async ({ page }) => {
  // Regression: failed and authorization-required servers remain scattered through API order.
  await openSettings(page);
  const firstFive = await page.locator('.agent-settings-mcp-list article').evaluateAll((nodes) => nodes.slice(0, 5).map((node) => node.getAttribute('data-testid')));
  expect(new Set(firstFive)).toEqual(new Set(attention.map(([name]) => `agent-settings-mcp-${name}`)));
});

test('1561-mcp-layout-and-rail-containment:3 search filters large catalogs and is absent for ten servers', async ({ page }) => {
  // Regression: users must scroll all 26 rows to locate mailchimp.
  await openSettings(page);
  const search = page.getByRole('searchbox', { name: 'Search MCP servers' });
  await search.fill('mail');
  await expect(page.locator('.agent-settings-mcp-list article')).toHaveCount(1);
  await expect(page.getByTestId('agent-settings-mcp-mailchimp')).toBeVisible();
  fixture = connected.slice(0, 10);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search MCP servers' })).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`1561-mcp-layout-and-rail-containment:4 navigation remains reachable after inspector scroll at ${viewport.width}px`, async ({ page }) => {
    // Regression: the entire page scrolls, taking the settings rail or narrow Back control off screen.
    await page.setViewportSize(viewport);
    await openSettings(page);
    const detail = page.getByTestId('list-inspector-detail');
    await detail.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const navigation = viewport.width < 720 ? page.getByRole('button', { name: 'Back to list', exact: true }) : page.getByRole('listbox', { name: 'Agent settings sections' });
    await expect(navigation).toBeInViewport();
  });
}
