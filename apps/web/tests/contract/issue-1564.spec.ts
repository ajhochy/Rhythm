import { expect, test, type Page, type Route } from '@playwright/test';

test.skip(process.env.RHYTHM_ISSUE_1564_CONTRACT !== '1', 'Run with the issue-1564 live-gateway Playwright config');

type Server = { name: string; status: string; error: null; requiredEnv: string[]; needsCredentials: boolean; source: 'curated'; tools: string[] };

const servers: Server[] = [
  { name: 'propresenter', status: 'connected', error: null, requiredEnv: [], needsCredentials: false, source: 'curated', tools: [] },
  { name: 'calendar', status: 'disabled', error: null, requiredEnv: [], needsCredentials: false, source: 'curated', tools: [] },
];

const deferred = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
};

async function openSettings(page: Page, override?: (route: Route, path: string, method: string) => Promise<boolean>) {
  await page.route('http://127.0.0.1:7161/**', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('http://127.0.0.1:7160/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': request.headers()['origin'] ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (override && await override(route, path, request.method())) return;
    if (path === '/agent-configs' || path === '/opencode/auth') return route.fulfill({ status: 200, headers, json: [] });
    if (path === '/opencode/auth/accounts') return route.fulfill({ status: 200, headers, json: { accounts: [] } });
    if (path === '/opencode/mcp') return route.fulfill({ status: 200, headers, json: servers });
    return route.fulfill({ status: 200, headers, json: {} });
  });
  await page.goto('/#/tools/agent-settings?settingsSection=mcp');
  await expect(page.getByTestId('agent-settings-mcp-propresenter')).toBeVisible();
}

for (const action of ['disconnect', 'connect', 'remove'] as const) {
  test(`1564-scoped-pending-and-notices:1 ${action} exposes row-scoped busy feedback`, async ({ page }) => {
    // Regression: the action disables the page while its mcp-less sentinel hides all feedback.
    const held = deferred();
    const path = action === 'remove' ? '/opencode/mcp/propresenter' : `/opencode/mcp/propresenter/${action}`;
    if (action === 'connect') servers[0].status = 'disabled';
    await openSettings(page, async (route, requestPath, method) => {
      if (requestPath === path && method !== 'GET') {
        await held.gate;
        await route.fulfill({ status: 200, json: {} });
        return true;
      }
      return false;
    });
    const trigger = action === 'remove'
      ? page.getByTestId('agent-settings-mcp-remove-confirm')
      : page.getByTestId(`agent-settings-mcp-${action}-propresenter`);
    if (action === 'remove') await page.getByTestId('agent-settings-mcp-remove-propresenter').click();
    await trigger.click({ noWaitAfter: true });
    await expect(page.getByTestId('list-inspector-detail').getByRole('status').filter({ hasText: new RegExp(`${action}.*propresenter|propresenter.*${action}`, 'i') })).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('agent-settings-mcp-connect-calendar')).toBeEnabled();
    held.release();
    servers[0].status = 'connected';
  });
}

test('1564-scoped-pending-and-notices:2 MCP notice is cleared when leaving and does not return stale', async ({ page }) => {
  // Regression: one shared notice appears under Accounts and returns when MCP is reopened.
  await openSettings(page);
  await page.getByTestId('agent-settings-mcp-disconnect-propresenter').click();
  await expect(page.getByTestId('list-inspector-detail').getByRole('status').filter({ hasText: 'propresenter disconnected.' })).toBeVisible();
  await page.getByRole('option', { name: 'Accounts', exact: true }).click();
  await expect(page.getByTestId('list-inspector-detail')).not.toContainText('propresenter disconnected.');
  await page.getByRole('option', { name: 'MCP servers', exact: true }).click();
  await expect(page.getByTestId('list-inspector-detail')).not.toContainText('propresenter disconnected.');
});

test('1564-scoped-pending-and-notices:3 Accounts progress is visible only in Accounts', async ({ page }) => {
  // Regression: account progress leaks into another inspector through global action state.
  const held = deferred();
  await openSettings(page, async (route, path) => {
    if (path === '/opencode/auth/accounts/login-start') {
      await held.gate;
      await route.fulfill({ status: 200, json: { authorizeUrl: 'https://example.test/auth' } });
      return true;
    }
    return false;
  });
  await page.getByRole('option', { name: 'Accounts', exact: true }).click();
  await page.getByTestId('agent-settings-account-id').fill('work');
  await page.getByTestId('agent-settings-account-start').click({ noWaitAfter: true });
  await expect(page.getByTestId('list-inspector-detail').getByRole('status').filter({ hasText: 'Saving account configuration' })).toBeVisible();
  await page.getByRole('option', { name: 'MCP servers', exact: true }).click();
  await expect(page.getByTestId('list-inspector-detail')).not.toContainText('Saving account configuration');
  held.release();
});
