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
  // Rendered (narrow layouts hide the list column behind Back).
  await expect(page.getByTestId('agent-settings-mcp-row-mailchimp')).toHaveCount(1);
}

const serverRows = (page: Page) => page.getByRole('listbox', { name: 'MCP servers' }).getByRole('option');

test.beforeEach(() => { fixture = [...connected, ...attention]; });

test('1561-mcp-layout-and-rail-containment:1 the server list leads; the add form appears only from the compact Add server action', async ({ page }) => {
  // Regression: the rarely used creation form occupies the top of a long management surface.
  await openSettings(page);
  const add = page.getByTestId('agent-settings-mcp-add-item');
  await expect(page.getByTestId('agent-settings-mcp-add-name')).toHaveCount(0);
  expect((await add.boundingBox())!.height).toBeLessThanOrEqual(32);
  await expect(page.getByTestId('agent-settings-mcp-ableton-mcp')).toBeVisible();
  await add.click();
  await expect(add).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('agent-settings-mcp-add-name')).toBeVisible();
});

test('1561-mcp-layout-and-rail-containment:2 attention servers sort before connected servers', async ({ page }) => {
  // Regression: failed and authorization-required servers remain scattered through API order.
  await openSettings(page);
  const firstFive = await serverRows(page).evaluateAll((nodes) => nodes.slice(0, 5).map((node) => node.getAttribute('data-testid')));
  expect(new Set(firstFive)).toEqual(new Set(attention.map(([name]) => `agent-settings-mcp-row-${name}`)));
});

test('1561-mcp-layout-and-rail-containment:3 search filters large catalogs and is absent for ten servers', async ({ page }) => {
  // Regression: users must scroll all 26 rows to locate mailchimp.
  await openSettings(page);
  const search = page.getByRole('searchbox', { name: 'Search MCP servers' });
  await search.fill('mail');
  await expect(serverRows(page)).toHaveCount(1);
  await expect(page.getByTestId('agent-settings-mcp-row-mailchimp')).toBeVisible();
  fixture = connected.slice(0, 10);
  await page.reload();
  await expect(serverRows(page)).toHaveCount(10);
  await expect(page.getByRole('searchbox', { name: 'Search MCP servers' })).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`1561-mcp-layout-and-rail-containment:4 navigation remains reachable after inspector scroll at ${viewport.width}px`, async ({ page }) => {
    // Regression: the entire page scrolls, taking the settings rail or narrow Back control off screen.
    await page.setViewportSize(viewport);
    await openSettings(page);
    const detail = page.getByTestId('list-inspector-detail');
    await detail.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const navigation = viewport.width < 900 ? page.getByRole('button', { name: 'Back to MCP servers', exact: true }) : page.getByRole('listbox', { name: 'Agent settings sections' });
    await expect(navigation).toBeInViewport();
    if (viewport.width >= 900) await expect(serverRows(page).first()).toBeInViewport();
  });
}
