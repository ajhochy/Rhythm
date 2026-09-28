import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// Agent Settings column browser against an intercepted live gateway: sections → items → inspector,
// plus multi-account OpenAI (ChatGPT) and Anthropic rename. Run with settings-columns-playwright.config.ts.
test.skip(process.env.RHYTHM_SETTINGS_COLUMNS_CONTRACT !== '1', 'Run with the settings-columns live-gateway Playwright config');

type Account = { id: string; label: string; status: string; email?: string };
type State = {
  anthropic: Account[]; anthropicDefault: string | null;
  openai: Account[]; openaiDefault: string | null; engineUpdated: boolean;
  mutations: string[];
};

async function openSettings(page: Page, hash = '#/tools/agent-settings', seed: Partial<State> = {}) {
  const state: State = {
    anthropic: [{ id: 'work', label: 'Work', status: 'ok' }], anthropicDefault: 'work',
    openai: [{ id: 'default', label: 'me@example.test', status: 'ok', email: 'me@example.test' }], openaiDefault: 'default', engineUpdated: true,
    mutations: [], ...seed,
  };
  await page.route('https://api.vcrcapps.com/**', (route) => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': request.headers().origin ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 200, headers, json: [] });
  });
  await page.route('http://127.0.0.1:7592/**', (route) => route.fulfill({ status: 200, json: { healthy: true, status: 'ready' } }));
  await page.route('http://127.0.0.1:7591/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const headers = { 'access-control-allow-origin': request.headers().origin ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    const send = (json: unknown, status = 200) => route.fulfill({ status, headers, json });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = method === 'GET' || method === 'DELETE' ? {} : request.postDataJSON() as Record<string, string>;
    if (path === '/health') return send({ healthy: true, status: 'ready' });
    if (path === '/opencode/auth/accounts' && method === 'GET') return send({ accounts: state.anthropic, defaultAccountId: state.anthropicDefault });
    if (path === '/opencode/auth/accounts/login-start') {
      state.mutations.push(`anthropic:start:${body.accountId}:${body.label ?? ''}`);
      return send({ authorizeUrl: `https://auth.anthropic.example/authorize?account=${body.accountId}` });
    }
    if (path === '/opencode/auth/accounts/login-complete') {
      state.mutations.push(`anthropic:complete:${body.accountId}:${body.code}`);
      if (!state.anthropic.some((account) => account.id === body.accountId)) state.anthropic.push({ id: body.accountId, label: body.accountId, status: 'ok' });
      return send({ ok: true });
    }
    const anthropicRename = path.match(/^\/opencode\/auth\/accounts\/([a-z0-9-]+)$/);
    if (anthropicRename && method === 'PATCH') {
      state.mutations.push(`anthropic:rename:${anthropicRename[1]}:${body.label}`);
      state.anthropic = state.anthropic.map((account) => account.id === anthropicRename[1] ? { ...account, label: body.label } : account);
      return send({ ok: true });
    }
    if (path === '/opencode/auth/openai/accounts' && method === 'GET') return send({ accounts: state.openai, defaultAccountId: state.openaiDefault });
    if (path === '/opencode/auth/openai/accounts/login-start') {
      state.mutations.push(`openai:start:${body.accountId}:${body.label ?? ''}`);
      return send({ authorizeUrl: `https://auth.openai.example/authorize?account=${body.accountId}`, redirectUri: 'http://localhost:1455/auth/callback' });
    }
    if (path === '/opencode/auth/openai/accounts/login-complete') {
      state.mutations.push(`openai:complete:${body.accountId}:${body.code}`);
      const existing = state.openai.find((account) => account.id === body.accountId);
      if (existing) existing.status = 'ok';
      else state.openai.push({ id: body.accountId, label: 'Personal', status: 'ok', email: 'personal@example.test' });
      return send({ ok: true });
    }
    if (path === '/opencode/auth/openai/accounts/default' && method === 'PATCH') {
      state.mutations.push(`openai:default:${body.accountId}`);
      state.openaiDefault = body.accountId;
      return send({ ok: true, defaultAccountId: body.accountId, engineUpdated: state.engineUpdated });
    }
    const openaiAccount = path.match(/^\/opencode\/auth\/openai\/accounts\/([a-z0-9-]+)$/);
    if (openaiAccount && method === 'PATCH') {
      state.mutations.push(`openai:rename:${openaiAccount[1]}:${body.label}`);
      state.openai = state.openai.map((account) => account.id === openaiAccount[1] ? { ...account, label: body.label } : account);
      return send({ ok: true });
    }
    if (openaiAccount && method === 'DELETE') {
      state.mutations.push(`openai:remove:${openaiAccount[1]}`);
      state.openai = state.openai.filter((account) => account.id !== openaiAccount[1]);
      return send({ ok: true });
    }
    if (path === '/opencode/auth') return send({ providers: [] });
    if (path === '/opencode/mcp') return send([
      { name: 'gitnexus', status: 'connected', error: null, requiredEnv: [], needsCredentials: false, source: 'curated', tools: ['query', 'impact', 'context'] },
      { name: 'rhythm', status: 'connected', error: null, requiredEnv: [], needsCredentials: false, source: 'rhythm', tools: ['rhythm_ping'] },
    ]);
    return send([]);
  });
  await page.goto(`/${hash}`);
  await expect(page.getByRole('listbox', { name: 'Agent settings sections' })).toHaveAttribute('aria-busy', 'false');
  return state;
}

const items = (page: Page) => page.getByTestId('settings-column-items');
const inspectorTitle = (page: Page) => page.getByTestId('settings-column-inspector').getByRole('heading', { level: 2 });
const notice = (page: Page) => page.getByTestId('agent-settings-accounts-notice');

// Opt-in layout evidence: RHYTHM_SETTINGS_SHOTS=<dir> saves screenshots of the column layouts.
const shot = async (page: Page, name: string) => { if (process.env.RHYTHM_SETTINGS_SHOTS) await page.screenshot({ path: `${process.env.RHYTHM_SETTINGS_SHOTS}/${name}.png` }); };

test('column navigation: section → item → inspector, reflected in the URL and restored on reload', async ({ page }) => {
  await openSettings(page);
  await expect(page.getByRole('option', { name: 'Accounts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(items(page).getByRole('group')).toHaveText([/^Anthropic/, /^OpenAI/, /^Model providers/, /^Hermes/]);
  // The first item is inspected by default.
  await expect(inspectorTitle(page)).toHaveText('Work');
  await page.getByTestId('agent-settings-openai-row-default').click();
  await expect(inspectorTitle(page)).toHaveText('me@example.test');
  await expect(page.getByTestId('agent-settings-openai-account-default')).toContainText('Default');
  await shot(page, 'settings-agent-accounts-list');
  await expect.poll(() => new URL(page.url()).hash).toContain('settingsItem=openai%3Adefault');
  await page.reload();
  await expect(inspectorTitle(page)).toHaveText('me@example.test');

  await page.getByRole('option', { name: 'MCP servers', exact: true }).click();
  await expect(items(page).getByRole('option')).toHaveText([/^gitnexus/, /^rhythm/]);
  await page.getByTestId('agent-settings-mcp-row-rhythm').click();
  await expect(page.getByTestId('agent-settings-mcp-rhythm')).toContainText('1 tools');
  await expect(page.getByTestId('agent-settings-mcp-tools-rhythm')).toHaveText('rhythm_ping');
  await expect.poll(() => new URL(page.url()).hash).toMatch(/settingsSection=mcp.*settingsItem=mcp%3Arhythm|settingsItem=mcp%3Arhythm.*settingsSection=mcp/);
  // A form section (no items) follows the section list directly.
  await page.getByRole('option', { name: 'Behavior', exact: true }).click();
  await expect(items(page)).toHaveCount(0);
  await expect(inspectorTitle(page)).toHaveText('Behavior');
  await shot(page, 'settings-agent-behavior-form');
  expect((await new AxeBuilder({ page }).include('.column-browser').analyze()).violations).toEqual([]);
});

test('OpenAI: add a second account by pasting the callback address, then switch the default', async ({ page }) => {
  const state = await openSettings(page, '#/tools/agent-settings?settingsSection=accounts');
  await page.getByTestId('agent-settings-openai-add').click();
  await expect(inspectorTitle(page)).toHaveText('Add OpenAI account');
  await page.getByTestId('agent-settings-openai-label').fill('Personal');
  await page.getByTestId('agent-settings-openai-start').click();
  await expect(page.getByTestId('agent-settings-openai-authorization-link')).toHaveAttribute('href', 'https://auth.openai.example/authorize?account=openai-2');
  await expect(page.getByTestId('settings-column-inspector')).toContainText('the browser will fail to load a localhost:1455 page — copy the whole address from the address bar and paste it here');
  const callback = 'http://localhost:1455/auth/callback?code=abc&state=xyz';
  await page.getByTestId('agent-settings-openai-code').fill(callback);
  await page.getByTestId('agent-settings-openai-complete').click();
  await expect(inspectorTitle(page)).toHaveText('Personal');
  await expect(page.getByTestId('agent-settings-openai-row-openai-2')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('agent-settings-openai-row-openai-2')).toContainText('personal@example.test · OK');
  await expect(notice(page)).toHaveText('OpenAI account signed in and saved.');

  await page.getByTestId('agent-settings-openai-default-openai-2').click();
  await expect(notice(page)).toHaveText('Personal is now the default OpenAI account, and the engine is signed in with it.');
  await expect(page.getByTestId('agent-settings-openai-row-openai-2')).toContainText('Default');
  await expect(page.getByTestId('agent-settings-openai-default-openai-2')).toHaveCount(0);
  await expect(page.getByTestId('settings-column-inspector')).toContainText("Sessions and profiles that don't choose their own OpenAI account use the default account.");

  state.engineUpdated = false;
  await page.getByTestId('agent-settings-openai-row-default').click();
  await page.getByTestId('agent-settings-openai-default-default').click();
  await expect(notice(page)).toHaveText('me@example.test is now the default OpenAI account.');
  expect(state.mutations).toEqual([
    'openai:start:openai-2:Personal',
    `openai:complete:openai-2:${callback}`,
    'openai:default:openai-2',
    'openai:default:default',
  ]);
});

test('OpenAI and Anthropic sign-in links open through the shell bridge, and Copy link copies the URL', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__openExternalCalls = [];
    (window as any).rhythmShell = { openExternal: (url: string) => { (window as any).__openExternalCalls.push(url); return Promise.resolve(); } };
    (window as any).__clipboard = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (text: string) => { (window as any).__clipboard.push(text); return Promise.resolve(); } } });
  });
  await openSettings(page, '#/tools/agent-settings?settingsSection=accounts');

  // Anthropic: adding an account opens the authorization form with its sign-in link.
  await page.getByTestId('agent-settings-account-add').click();
  await page.getByTestId('agent-settings-account-id').fill('personal');
  await page.getByTestId('agent-settings-account-label').fill('Personal');
  await page.getByTestId('agent-settings-account-start').click();
  const anthropicLink = page.getByTestId('agent-settings-account-authorization-link');
  await expect(anthropicLink).toBeVisible();
  const anthropicUrl = await anthropicLink.getAttribute('href');
  await anthropicLink.click();
  await expect.poll(() => (page.evaluate(() => (window as any).__openExternalCalls))).toEqual([anthropicUrl]);
  await page.getByTestId('agent-settings-account-authorization-copy').click();
  await expect.poll(() => (page.evaluate(() => (window as any).__clipboard))).toEqual([anthropicUrl]);

  // OpenAI: adding an account opens its own sign-in link.
  await page.getByTestId('agent-settings-openai-add').click();
  await page.getByTestId('agent-settings-openai-label').fill('Personal');
  await page.getByTestId('agent-settings-openai-start').click();
  const openaiLink = page.getByTestId('agent-settings-openai-authorization-link');
  const openaiUrl = await openaiLink.getAttribute('href');
  await openaiLink.click();
  await expect.poll(() => (page.evaluate(() => (window as any).__openExternalCalls))).toEqual([anthropicUrl, openaiUrl]);
  await page.getByTestId('agent-settings-openai-authorization-copy').click();
  await expect.poll(() => (page.evaluate(() => (window as any).__clipboard))).toEqual([anthropicUrl, openaiUrl]);
});

test('OpenAI: rename and remove an account', async ({ page }) => {
  const state = await openSettings(page, '#/tools/agent-settings?settingsSection=accounts&settingsItem=openai%3Aopenai-2', {
    openai: [{ id: 'default', label: 'Work ChatGPT', status: 'ok' }, { id: 'openai-2', label: 'Personal', status: 'ok' }],
  });
  const rename = page.getByTestId('agent-settings-openai-rename-openai-2');
  await expect(rename).toHaveValue('Personal');
  await expect(page.getByTestId('agent-settings-openai-rename-save-openai-2')).toBeDisabled();
  await rename.fill('Home ChatGPT');
  await page.getByTestId('agent-settings-openai-rename-save-openai-2').click();
  await expect(inspectorTitle(page)).toHaveText('Home ChatGPT');
  await expect(page.getByTestId('agent-settings-openai-row-openai-2')).toContainText('Home ChatGPT');

  await page.getByTestId('agent-settings-openai-remove-openai-2').click();
  const dialog = page.getByTestId('agent-settings-openai-remove-dialog');
  await expect(dialog).toContainText('Home ChatGPT will be removed');
  await page.getByTestId('agent-settings-openai-remove-confirm').click();
  await expect(page.getByTestId('agent-settings-openai-row-openai-2')).toHaveCount(0);
  await expect(notice(page)).toHaveText('Home ChatGPT removed.');
  expect(state.mutations).toEqual(['openai:rename:openai-2:Home ChatGPT', 'openai:remove:openai-2']);
});

test('OpenAI: a needs_relogin account is flagged and signs in again in place', async ({ page }) => {
  const state = await openSettings(page, '#/tools/agent-settings?settingsSection=accounts', {
    openai: [{ id: 'default', label: 'Work ChatGPT', status: 'ok' }, { id: 'openai-2', label: 'Expired', status: 'needs_relogin' }],
  });
  const row = page.getByTestId('agent-settings-openai-row-openai-2');
  await expect(row).toContainText('Needs re-login');
  await expect(row).toContainText('Re-login');
  await row.click();
  await expect(page.getByTestId('agent-settings-openai-attention-openai-2')).toHaveText('Needs re-login');
  await page.getByTestId('agent-settings-openai-relogin-openai-2').click();
  await expect(page.getByTestId('agent-settings-openai-authorizing')).toContainText('Expired');
  await page.getByTestId('agent-settings-openai-code').fill('code#state');
  await page.getByTestId('agent-settings-openai-complete').click();
  await expect(page.getByTestId('agent-settings-openai-attention-openai-2')).toHaveCount(0);
  await expect(row).toContainText('OK');
  expect(state.mutations).toEqual(['openai:start:openai-2:Expired', 'openai:complete:openai-2:code#state']);
});

test('Anthropic: rename an account from its inspector', async ({ page }) => {
  const state = await openSettings(page, '#/tools/agent-settings?settingsSection=accounts&settingsItem=account%3Awork');
  await page.getByTestId('agent-settings-account-rename-work').fill('Team Claude');
  await page.getByTestId('agent-settings-account-rename-save-work').click();
  await expect(page.getByTestId('agent-settings-account-row-work')).toContainText('Team Claude');
  await expect(inspectorTitle(page)).toHaveText('Team Claude');
  expect(state.mutations).toEqual(['anthropic:rename:work:Team Claude']);
});
