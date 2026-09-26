import { expect, test } from '@playwright/test';
import { openFixture } from '../helpers';
import { atNarrow, atZoom200, expectInspectorHeading, expectListInspectorAxeClean, expectSelected, keyboardSelect, selectRow } from '../helpers/list-inspector';
import { fulfillJson, openInterceptedLiveApp } from '../post-m1-phase-5-live-fixtures';

const profiles = 'Profiles overview';
const autoPromotion = 'Auto-promotion';
const runtime = 'Runtime / OpenCode server';

test.describe('Agent Settings list and inspector', () => {
  test('selects different configuration sections and keeps scope visible', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await expectSelected(page, profiles);
    await expectInspectorHeading(page, profiles);
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Agent / profile');

    await selectRow(page, autoPromotion);
    await expectInspectorHeading(page, autoPromotion);
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Workspace');

    await selectRow(page, 'Accounts');
    await expectInspectorHeading(page, 'Accounts');
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Desktop local');
    await expectListInspectorAxeClean(page);
  });

  test('uses roving keyboard focus without changing selection until activation', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await keyboardSelect(page, { fromTitle: profiles, presses: ['ArrowDown'] });
    await expect(page.getByRole('option', { name: autoPromotion, exact: true })).toBeFocused();
    await expectSelected(page, profiles);
    await page.keyboard.press('Enter');
    await expectSelected(page, autoPromotion);
    await keyboardSelect(page, { fromTitle: autoPromotion, presses: ['End', 'Space'] });
    await expectSelected(page, 'MCP servers');
    await keyboardSelect(page, { fromTitle: 'MCP servers', presses: ['Home', 'Space'] });
    await expectInspectorHeading(page, profiles);
  });

  test('restores a valid deep link and shows a clear state for a deleted id', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings?settingsSection=runtime');
    await expectSelected(page, runtime);
    await expectInspectorHeading(page, runtime);
    await page.reload();
    await expectInspectorHeading(page, runtime);

    await page.goto('/#/tools/agent-settings?settingsSection=deleted-section');
    await expectInspectorHeading(page, 'Item not found');
    const detail = page.getByTestId('list-inspector-detail');
    await expect(detail).toContainText('no longer available');
    await expect(detail.getByRole('button', { name: 'Desktop endpoint' })).toHaveCount(0);
    await selectRow(page, profiles);
    await expectInspectorHeading(page, profiles);
  });

  test('keeps empty, loading, error, and read-only states usable', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings?state=loading');
    await expect(page.getByTestId('tool-state-loading')).toContainText('fixture://agent-settings');
    await expect(page.locator('.list-inspector')).toHaveCount(0);

    await page.getByTestId('tool-state-select').selectOption('empty');
    await expect(page.getByTestId('tool-state-empty')).toContainText('No local defaults configured');
    await page.getByTestId('tool-load-example').click();
    await expectInspectorHeading(page, profiles);

    await page.getByTestId('tool-state-select').selectOption('server-error');
    await expect(page.getByTestId('tool-state-server-error')).toContainText('503');
    await page.getByTestId('tool-retry').click();
    await expectInspectorHeading(page, profiles);

    await page.getByTestId('tool-state-select').selectOption('readonly');
    await selectRow(page, runtime);
    await expectInspectorHeading(page, runtime);
    await expect(page.getByRole('button', { name: 'Desktop endpoint' })).toBeDisabled();
    await expectListInspectorAxeClean(page);
  });

  test('keeps every existing fixture action in the inspector', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await page.getByTestId('agent-settings-refresh').click();
    await expect(page.getByTestId('tool-trace')).toContainText('fixture://agent-settings');

    await selectRow(page, runtime);
    await page.getByRole('button', { name: 'Desktop endpoint', exact: true }).click();
    await expect(page.getByTestId('tool-trace')).toContainText('fixture://agent-settings/connection');
    await page.getByRole('button', { name: 'Offline buffering', exact: true }).click();
    await expect(page.getByTestId('tool-trace')).toContainText('fixture://agent-settings/offline-buffer');

    await selectRow(page, profiles);
    await page.getByTestId('agent-settings-open-profiles').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/profiles?settingsSection=profiles');
  });

  test('uses one pane at 640px and remains unclipped at 200% zoom', async ({ page }) => {
    await atNarrow(page);
    await openFixture(page, '#/tools/agent-settings');
    const list = page.getByRole('listbox', { name: 'Agent settings sections', includeHidden: true });
    await expect(list).toBeHidden();
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(list).toBeVisible();
    await selectRow(page, runtime);
    await expectInspectorHeading(page, runtime);
    await expect(list).toBeHidden();
    await expect(page.getByRole('button', { name: 'Desktop endpoint' })).toBeVisible();

    await atZoom200(page);
    const overflow = await page.locator('.list-inspector').evaluate((element) => ({ content: element.scrollWidth, available: element.clientWidth }));
    expect(overflow.content).toBeLessThanOrEqual(overflow.available + 1);
    await expectListInspectorAxeClean(page);
  });
});

test.describe('Agent Settings live persistence', () => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires the live-gateway Playwright environment; the default suite serves fixture mode');

  test('authorizes an account, saves the default, and restores it after reload', async ({ page }) => {
    let defaultAccountId = 'work';
    let accounts = [{ id: 'work', label: 'Work account', status: 'active' }];
    const mutations: string[] = [];

    await openInterceptedLiveApp(page, '/#/tools/agent-settings?settingsSection=accounts', {
      handleApi: async (route, request) => {
        if (request.pathname === '/opencode/auth/accounts' && request.method === 'GET') {
          await fulfillJson(route, 200, { accounts, defaultAccountId });
          return true;
        }
        if (request.pathname === '/opencode/auth/accounts/login-start' && request.method === 'POST') {
          const body = request.body as { accountId: string; label: string };
          mutations.push(`start:${body.accountId}:${body.label}`);
          await fulfillJson(route, 200, { authorizeUrl: 'https://example.test/anthropic-authorize' });
          return true;
        }
        if (request.pathname === '/opencode/auth/accounts/login-complete' && request.method === 'POST') {
          const body = request.body as { accountId: string; code: string };
          mutations.push(`complete:${body.accountId}:${body.code}`);
          accounts = [...accounts, { id: body.accountId, label: 'Personal account', status: 'active' }];
          await fulfillJson(route, 200, { account: accounts.at(-1) });
          return true;
        }
        if (request.pathname === '/opencode/auth/accounts/default' && request.method === 'PATCH') {
          const body = request.body as { accountId: string };
          defaultAccountId = body.accountId;
          mutations.push(`default:${body.accountId}`);
          await fulfillJson(route, 200, { ok: true, defaultAccountId });
          return true;
        }
        if (request.pathname === '/opencode/mcp') {
          await fulfillJson(route, 200, []);
          return true;
        }
        return false;
      },
    });

    await page.getByTestId('agent-settings-account-id').fill('personal');
    await page.getByTestId('agent-settings-account-label').fill('Personal account');
    await page.getByTestId('agent-settings-account-start').click();
    await expect(page.getByTestId('agent-settings-account-authorization-link')).toHaveAttribute('href', 'https://example.test/anthropic-authorize');
    await page.getByTestId('agent-settings-account-code').fill('authorization-code#state');
    await page.getByTestId('agent-settings-account-complete').click();
    await expect(page.getByTestId('agent-settings-account-personal')).toContainText('Personal account');
    await page.getByTestId('agent-settings-account-default-personal').click();
    await expect(page.getByTestId('agent-settings-account-personal')).toContainText('Default');
    expect(mutations).toEqual([
      'start:personal:Personal account',
      'complete:personal:authorization-code#state',
      'default:personal',
    ]);

    await page.reload();
    await expect(page.getByTestId('agent-settings-account-personal')).toContainText('Default');
    await expect(page.getByTestId('agent-settings-account-default-personal')).toHaveCount(0);
  });

  test('re-authorizes an expired default account in place without removing it', async ({ page }) => {
    const defaultAccountId = 'personal';
    let accounts = [
      { id: 'team', label: 'Team', status: 'ok' },
      { id: 'personal', label: 'Personal', status: 'needs_relogin' },
    ];
    const mutations: string[] = [];

    await openInterceptedLiveApp(page, '/#/tools/agent-settings?settingsSection=accounts', {
      handleApi: async (route, request) => {
        if (request.pathname === '/opencode/auth/accounts' && request.method === 'GET') {
          await fulfillJson(route, 200, { accounts, defaultAccountId });
          return true;
        }
        if (request.pathname === '/opencode/auth/accounts/login-start' && request.method === 'POST') {
          const body = request.body as { accountId: string; label: string };
          mutations.push(`start:${body.accountId}:${body.label}`);
          await fulfillJson(route, 200, { authorizeUrl: 'https://example.test/anthropic-reauthorize' });
          return true;
        }
        if (request.pathname === '/opencode/auth/accounts/login-complete' && request.method === 'POST') {
          const body = request.body as { accountId: string; code: string };
          mutations.push(`complete:${body.accountId}:${body.code}`);
          accounts = accounts.map((account) => (account.id === body.accountId ? { ...account, status: 'ok' } : account));
          await fulfillJson(route, 200, { account: accounts.find((account) => account.id === body.accountId) });
          return true;
        }
        if (request.pathname === '/opencode/mcp') {
          await fulfillJson(route, 200, []);
          return true;
        }
        return false;
      },
    });

    const row = page.getByTestId('agent-settings-account-personal');
    await expect(row).toContainText('Default');
    await expect(page.getByTestId('agent-settings-account-attention-personal')).toBeVisible();
    await expect(page.getByTestId('agent-settings-account-attention-team')).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Accounts', exact: true })).toContainText('1 need re-authorization');

    await page.getByTestId('agent-settings-account-relogin-personal').click();
    await expect(page.getByTestId('agent-settings-account-authorizing')).toContainText('Personal');
    await expect(page.getByTestId('agent-settings-account-authorization-link')).toHaveAttribute('href', 'https://example.test/anthropic-reauthorize');
    await page.getByTestId('agent-settings-account-code').fill('fresh-code#state');
    await page.getByTestId('agent-settings-account-complete').click();

    await expect(page.getByTestId('agent-settings-account-attention-personal')).toHaveCount(0);
    await expect(row).toContainText('Default');
    await expect(page.getByTestId('agent-settings-account-team')).toBeVisible();
    expect(mutations).toEqual(['start:personal:Personal', 'complete:personal:fresh-code#state']);
  });

  test('connects OpenAI by paste-back, Google by re-check, and OpenCode/OpenRouter by API key', async ({ page }) => {
    let providers: string[] = [];
    const mutations: string[] = [];

    await openInterceptedLiveApp(page, '/#/tools/agent-settings?settingsSection=accounts', {
      handleApi: async (route, request) => {
        if (request.pathname === '/opencode/auth/accounts') {
          await fulfillJson(route, 200, { accounts: [], defaultAccountId: null });
          return true;
        }
        if (request.pathname === '/opencode/auth' && request.method === 'GET') {
          await fulfillJson(route, 200, { providers, ready: true });
          return true;
        }
        const authorize = request.pathname.match(/^\/opencode\/auth\/([^/]+)\/authorize$/);
        if (authorize) {
          mutations.push(`authorize:${authorize[1]}${request.search}`);
          await fulfillJson(route, 200, { authUrl: `https://example.test/${authorize[1]}-oauth`, instructions: `Sign in to ${authorize[1]}.` });
          return true;
        }
        const callback = request.pathname.match(/^\/opencode\/auth\/([^/]+)\/callback$/);
        if (callback) {
          mutations.push(`callback:${callback[1]}${request.search}`);
          providers = [...providers, callback[1]];
          await fulfillJson(route, 200, { success: true });
          return true;
        }
        const apiKey = request.pathname.match(/^\/opencode\/auth\/([^/]+)$/);
        if (apiKey && request.method === 'POST') {
          const body = request.body as { apiKey: string };
          mutations.push(`key:${apiKey[1]}:${body.apiKey}`);
          providers = [...providers, apiKey[1]];
          await fulfillJson(route, 200, { success: true });
          return true;
        }
        if (request.pathname === '/opencode/mcp') {
          await fulfillJson(route, 200, []);
          return true;
        }
        return false;
      },
    });

    for (const id of ['openai', 'google', 'opencode', 'openrouter']) {
      await expect(page.getByTestId(`agent-settings-provider-status-${id}`)).toHaveText('Not connected');
    }

    // OpenAI must use the paste-back method (method=1), not the in-process default.
    await page.getByTestId('agent-settings-provider-authorize-openai').click();
    await expect(page.getByTestId('agent-settings-provider-authorization-link')).toHaveAttribute('href', 'https://example.test/openai-oauth');
    await page.getByTestId('agent-settings-provider-code').fill('http://localhost:1455/auth/callback?code=abc');
    await page.getByTestId('agent-settings-provider-complete').click();
    await expect(page.getByTestId('agent-settings-provider-status-openai')).toHaveText('Connected');

    // Google completes out of band (method=0): the UI only re-reads the authorized list.
    await page.getByTestId('agent-settings-provider-authorize-google').click();
    await expect(page.getByTestId('agent-settings-provider-flow-google')).toBeVisible();
    await page.getByTestId('agent-settings-provider-check').click();
    await expect(page.getByTestId('agent-settings-provider-status-google')).toHaveText('Not connected');
    providers = [...providers, 'google'];
    await page.getByTestId('agent-settings-provider-check').click();
    await expect(page.getByTestId('agent-settings-provider-status-google')).toHaveText('Connected');
    await expect(page.getByTestId('agent-settings-provider-flow-google')).toHaveCount(0);

    await page.getByTestId('agent-settings-provider-key-opencode').fill('oc-key');
    await page.getByTestId('agent-settings-provider-key-save-opencode').click();
    await expect(page.getByTestId('agent-settings-provider-status-opencode')).toHaveText('Connected');
    await page.getByTestId('agent-settings-provider-key-openrouter').fill('or-key');
    await page.getByTestId('agent-settings-provider-key-save-openrouter').click();
    await expect(page.getByTestId('agent-settings-provider-status-openrouter')).toHaveText('Connected');

    expect(mutations).toEqual([
      'authorize:openai?method=1',
      'callback:openai?code=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback%3Fcode%3Dabc&method=1',
      'authorize:google?method=0',
      'key:opencode:oc-key',
      'key:openrouter:or-key',
    ]);
  });

  test('saves MCP server, credential, and OAuth changes and restores them after reload', async ({ page }) => {
    type Server = { name: string; status: string; error: null; requiredEnv: string[]; needsCredentials: boolean; source: 'curated' | 'adhoc'; tools: string[] };
    let servers: Server[] = [
      { name: 'stripe', status: 'disabled', error: null, requiredEnv: ['STRIPE_SECRET_KEY'], needsCredentials: true, source: 'curated', tools: [] },
      { name: 'notion', status: 'needs_auth', error: null, requiredEnv: [], needsCredentials: true, source: 'curated', tools: [] },
    ];
    const mutations: string[] = [];

    await openInterceptedLiveApp(page, '/#/tools/agent-settings?settingsSection=mcp', {
      handleApi: async (route, request) => {
        if (request.pathname === '/opencode/auth/accounts') {
          await fulfillJson(route, 200, { accounts: [], defaultAccountId: null });
          return true;
        }
        if (request.pathname === '/opencode/mcp' && request.method === 'GET') {
          await fulfillJson(route, 200, servers);
          return true;
        }
        if (request.pathname === '/opencode/mcp' && request.method === 'POST') {
          const body = request.body as { name: string; url?: string; command?: string };
          mutations.push(`add:${body.name}:${body.url ?? body.command}`);
          const added: Server = { name: body.name, status: 'disconnected', error: null, requiredEnv: [], needsCredentials: false, source: 'adhoc', tools: [] };
          servers = [...servers, added];
          await fulfillJson(route, 200, added);
          return true;
        }
        if (request.pathname === '/opencode/mcp/stripe/credentials' && request.method === 'POST') {
          const body = request.body as { environment: Record<string, string> };
          mutations.push(`credentials:${body.environment.STRIPE_SECRET_KEY}`);
          servers = servers.map((server) => server.name === 'stripe' ? { ...server, status: 'connected', needsCredentials: false } : server);
          await fulfillJson(route, 200, servers.find((server) => server.name === 'stripe'));
          return true;
        }
        if (request.pathname === '/opencode/mcp/notion/oauth/start' && request.method === 'POST') {
          mutations.push('oauth:start:notion');
          await fulfillJson(route, 200, { authorizationUrl: 'https://example.test/notion-authorize' });
          return true;
        }
        if (request.pathname === '/opencode/mcp/notion/oauth/status' && request.method === 'GET') {
          mutations.push('oauth:status:notion');
          servers = servers.map((server) => server.name === 'notion' ? { ...server, status: 'connected', needsCredentials: false } : server);
          await fulfillJson(route, 200, { status: 'connected' });
          return true;
        }
        return false;
      },
    });

    await page.getByTestId('agent-settings-mcp-add-disclosure').locator('summary').click();
    await page.getByTestId('agent-settings-mcp-add-name').fill('calendar');
    await page.getByTestId('agent-settings-mcp-add-value').fill('https://mcp.example.test');
    await page.getByTestId('agent-settings-mcp-add').click();
    await expect(page.getByTestId('agent-settings-mcp-calendar')).toContainText('disconnected');

    await page.getByTestId('agent-settings-mcp-credential-stripe-STRIPE_SECRET_KEY').fill('sk_test_saved');
    await page.getByTestId('agent-settings-mcp-credentials-save-stripe').click();
    await expect(page.getByTestId('agent-settings-mcp-stripe')).toContainText('connected');

    await page.getByTestId('agent-settings-mcp-oauth-notion').click();
    await expect(page.getByTestId('agent-settings-mcp-authorization-link')).toHaveAttribute('href', 'https://example.test/notion-authorize');
    await page.getByTestId('agent-settings-mcp-oauth-status').click();
    await expect(page.getByTestId('agent-settings-mcp-notion')).toContainText('connected');

    expect(mutations).toEqual([
      'add:calendar:https://mcp.example.test',
      'credentials:sk_test_saved',
      'oauth:start:notion',
      'oauth:status:notion',
    ]);
    await page.reload();
    await expect(page.getByTestId('agent-settings-mcp-calendar')).toContainText('disconnected');
    await expect(page.getByTestId('agent-settings-mcp-stripe')).toContainText('connected');
    await expect(page.getByTestId('agent-settings-mcp-notion')).toContainText('connected');
  });
});
