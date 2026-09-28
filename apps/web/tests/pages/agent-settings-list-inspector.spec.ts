import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openFixture } from '../helpers';
import { atNarrow, atZoom200, expectSelected, keyboardSelect, selectRow } from '../helpers/list-inspector';
import { fulfillJson, openInterceptedLiveApp } from '../post-m1-phase-5-live-fixtures';

// Agent Settings is a column browser: sections → (items →) inspector.
const autoPromotion = 'Auto-promotion';
const runtime = 'Runtime / OpenCode server';
const sections = ['Accounts', 'Models', 'MCP servers', 'Auto-promotion', 'Behavior', 'Keybindings', 'Runtime / OpenCode server'];
const categories = (page: Page) => page.getByTestId('settings-column-categories');
const inspector = (page: Page) => page.getByTestId('settings-column-inspector');
const detail = (page: Page) => page.getByTestId('list-inspector-detail');

// Opt-in layout evidence: RHYTHM_SETTINGS_SHOTS=<dir> saves screenshots of the column layouts.
const shot = async (page: Page, name: string) => { if (process.env.RHYTHM_SETTINGS_SHOTS) await page.screenshot({ path: `${process.env.RHYTHM_SETTINGS_SHOTS}/${name}.png` }); };

async function expectInspectorTitle(page: Page, title: string) {
  const column = inspector(page);
  const heading = column.getByRole('heading', { name: title, exact: true });
  await expect(heading).toBeVisible();
  await expect(column).toHaveAttribute('aria-labelledby', (await heading.getAttribute('id'))!);
}

async function expectColumnAxeClean(page: Page) {
  const axe = new AxeBuilder({ page }).include('.column-browser');
  const result = await axe.analyze();
  expect(result.violations, result.violations.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
}

test.describe('Agent Settings column browser', () => {
  test('lists every section except Profiles, which live in the Profiles tool', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await expect(categories(page).getByRole('option')).toHaveText(sections.map((name) => new RegExp(`^${name.replace(/[/()]/g, '\\$&')}`)));
    await expect(page.getByRole('option', { name: /Profiles/ })).toHaveCount(0);
    await expect(page.getByText('Profiles overview')).toHaveCount(0);
    // Old deep links to the removed section explain where profiles moved.
    await page.goto('/#/tools/agent-settings?settingsSection=profiles');
    await expectInspectorTitle(page, 'Item not found');
    await page.getByTestId('agent-settings-open-profiles').click();
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/profiles/);
  });

  test('selecting a section shows its form in the next column and keeps scope visible', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await expectSelected(page, 'Accounts');
    await expectInspectorTitle(page, 'Accounts');
    await expect(detail(page)).toContainText('Desktop local');

    await selectRow(page, autoPromotion);
    await expectInspectorTitle(page, autoPromotion);
    await expect(detail(page)).toContainText('Workspace');
    await expect.poll(() => new URL(page.url()).hash).toContain('settingsSection=auto-promotion');
    // Form sections skip the item column.
    await expect(page.getByTestId('settings-column-items')).toHaveCount(0);
    await expectColumnAxeClean(page);
  });

  test('keyboard: arrows move within a column, Enter/Right moves into the next, Left goes back', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await keyboardSelect(page, { fromTitle: 'Accounts', presses: ['ArrowDown'] });
    await expect(page.getByRole('option', { name: 'Models', exact: true })).toBeFocused();
    await expectSelected(page, 'Accounts');
    await page.keyboard.press('End');
    await expect(page.getByRole('option', { name: runtime, exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expectSelected(page, runtime);
    await expect(detail(page)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('option', { name: runtime, exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expectSelected(page, 'Models');
    await expectInspectorTitle(page, 'Models');
  });

  test('restores a valid deep link and shows a clear state for a deleted id', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings?settingsSection=runtime');
    await expectSelected(page, runtime);
    await expectInspectorTitle(page, runtime);
    await page.reload();
    await expectInspectorTitle(page, runtime);

    await page.goto('/#/tools/agent-settings?settingsSection=deleted-section');
    await expectInspectorTitle(page, 'Item not found');
    await expect(detail(page)).toContainText('no longer available');
    await expect(detail(page).getByRole('button', { name: 'Desktop endpoint' })).toHaveCount(0);
    await selectRow(page, 'Behavior');
    await expectInspectorTitle(page, 'Behavior');
  });

  test('keeps empty, loading, error, and read-only states usable', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings?state=loading');
    await expect(page.getByTestId('tool-state-loading')).toContainText('fixture://agent-settings');
    await expect(page.locator('.column-browser')).toHaveCount(0);

    await page.getByTestId('tool-state-select').selectOption('empty');
    await expect(page.getByTestId('tool-state-empty')).toContainText('No local defaults configured');
    await page.getByTestId('tool-load-example').click();
    await expectInspectorTitle(page, 'Accounts');

    await page.getByTestId('tool-state-select').selectOption('server-error');
    await expect(page.getByTestId('tool-state-server-error')).toContainText('503');
    await page.getByTestId('tool-retry').click();
    await expectInspectorTitle(page, 'Accounts');

    await page.getByTestId('tool-state-select').selectOption('readonly');
    await selectRow(page, runtime);
    await expectInspectorTitle(page, runtime);
    await expect(page.getByRole('button', { name: 'Desktop endpoint' })).toBeDisabled();
    await expectColumnAxeClean(page);
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
  });

  test('narrow widths drill in one column at a time with Back, and stay unclipped at 200% zoom', async ({ page }) => {
    await atNarrow(page);
    await openFixture(page, '#/tools/agent-settings');
    await expect(categories(page)).toBeHidden();
    await expect(inspector(page)).toBeVisible();
    await page.getByRole('button', { name: 'Back to Agent settings sections', exact: true }).click();
    await expect(categories(page)).toBeVisible();
    await expect(inspector(page)).toBeHidden();
    await expect(page.getByRole('option', { name: 'Accounts', exact: true })).toBeFocused();
    await shot(page, 'settings-agent-narrow-sections');
    await selectRow(page, runtime);
    await expectInspectorTitle(page, runtime);
    await expect(categories(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Desktop endpoint' })).toBeVisible();

    await atZoom200(page);
    const overflow = await page.locator('.column-browser').evaluate((element) => ({ content: element.scrollWidth, available: element.clientWidth }));
    expect(overflow.content).toBeLessThanOrEqual(overflow.available + 1);
    await expectColumnAxeClean(page);
  });

  test('uses dense 28px rows on fine pointers', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    const box = await page.getByRole('option', { name: 'Behavior', exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeLessThanOrEqual(32);
  });
});

test.describe('Agent Settings live persistence', () => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires the live-gateway Playwright environment; the default suite serves fixture mode');

  test('authorizes an account, saves the default, and restores it after reload', async ({ page }) => {
    let defaultAccountId = 'work';
    let accounts = [{ id: 'work', label: 'Work account', status: 'active' }];
    const mutations: string[] = [];

    await openInterceptedLiveApp(page, '/#/tools/agent-settings?settingsSection=accounts&settingsItem=add', {
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

    await openInterceptedLiveApp(page, '/#/tools/agent-settings?settingsSection=accounts&settingsItem=account%3Apersonal', {
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
    await expect(page.getByTestId('agent-settings-account-row-team')).not.toContainText('Re-authorize');
    await expect(page.getByRole('option', { name: 'Accounts', exact: true })).toContainText('1 need re-authorization');

    await page.getByTestId('agent-settings-account-relogin-personal').click();
    await expect(page.getByTestId('agent-settings-account-authorizing')).toContainText('Personal');
    await expect(page.getByTestId('agent-settings-account-authorization-link')).toHaveAttribute('href', 'https://example.test/anthropic-reauthorize');
    await page.getByTestId('agent-settings-account-code').fill('fresh-code#state');
    await page.getByTestId('agent-settings-account-complete').click();

    await expect(page.getByTestId('agent-settings-account-attention-personal')).toHaveCount(0);
    await expect(row).toContainText('Default');
    await expect(page.getByTestId('agent-settings-account-row-team')).toBeVisible();
    expect(mutations).toEqual(['start:personal:Personal', 'complete:personal:fresh-code#state']);
  });

  test('connects Google by re-check and OpenCode/OpenRouter by API key; OpenAI lives under OpenAI accounts', async ({ page }) => {
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

    await expect(page.getByTestId('agent-settings-provider-row-openai')).toHaveCount(0);
    await expect(page.getByTestId('agent-settings-openai-add')).toBeVisible();
    await page.getByTestId('agent-settings-provider-row-google').click();
    await expect(page.getByTestId('agent-settings-provider-status-google')).toHaveText('Not connected');
    // Google completes out of band (method=0): the UI only re-reads the authorized list.
    await page.getByTestId('agent-settings-provider-authorize-google').click();
    await expect(page.getByTestId('agent-settings-provider-flow-google')).toBeVisible();
    await page.getByTestId('agent-settings-provider-check').click();
    await expect(page.getByTestId('agent-settings-provider-status-google')).toHaveText('Not connected');
    providers = [...providers, 'google'];
    await page.getByTestId('agent-settings-provider-check').click();
    await expect(page.getByTestId('agent-settings-provider-status-google')).toHaveText('Connected');
    await expect(page.getByTestId('agent-settings-provider-flow-google')).toHaveCount(0);

    for (const [id, key] of [['opencode', 'oc-key'], ['openrouter', 'or-key']] as const) {
      await page.getByTestId(`agent-settings-provider-row-${id}`).click();
      await page.getByTestId(`agent-settings-provider-key-${id}`).fill(key);
      await page.getByTestId(`agent-settings-provider-key-save-${id}`).click();
      await expect(page.getByTestId(`agent-settings-provider-status-${id}`)).toHaveText('Connected');
    }

    expect(mutations).toEqual(['authorize:google?method=0', 'key:opencode:oc-key', 'key:openrouter:or-key']);
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

    await page.getByTestId('agent-settings-mcp-add-item').click();
    await page.getByTestId('agent-settings-mcp-add-name').fill('calendar');
    await page.getByTestId('agent-settings-mcp-add-value').fill('https://mcp.example.test');
    await page.getByTestId('agent-settings-mcp-add').click();
    await expect(page.getByTestId('agent-settings-mcp-status-calendar')).toHaveText('Disconnected');

    await page.getByTestId('agent-settings-mcp-row-stripe').click();
    await page.getByTestId('agent-settings-mcp-credential-stripe-STRIPE_SECRET_KEY').fill('sk_test_saved');
    await page.getByTestId('agent-settings-mcp-credentials-save-stripe').click();
    await expect(page.getByTestId('agent-settings-mcp-status-stripe')).toHaveText('Connected');

    await page.getByTestId('agent-settings-mcp-row-notion').click();
    await page.getByTestId('agent-settings-mcp-oauth-notion').click();
    await expect(page.getByTestId('agent-settings-mcp-authorization-link')).toHaveAttribute('href', 'https://example.test/notion-authorize');
    await page.getByTestId('agent-settings-mcp-oauth-status').click();
    await expect(page.getByTestId('agent-settings-mcp-status-notion')).toHaveText('Connected');

    expect(mutations).toEqual([
      'add:calendar:https://mcp.example.test',
      'credentials:sk_test_saved',
      'oauth:start:notion',
      'oauth:status:notion',
    ]);
    await page.reload();
    for (const [name, label] of [['calendar', 'Disconnected'], ['stripe', 'Connected'], ['notion', 'Connected']]) await expect(page.getByTestId(`agent-settings-mcp-row-${name}`)).toContainText(label);
  });
});
