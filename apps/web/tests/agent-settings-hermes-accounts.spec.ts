import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
// The real main helper creates metadata; only the browser's IPC boundary is faked.
// @ts-ignore Electron JS boundary.
import { createHermesAccountsMain } from '../../electron/src/hermes-accounts-main.mjs';
let bundle: string;
const mutation = { action: 'enable', provider: 'openai', source: 'opencode-auth-json' };
async function metadata() {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'rhythm-accounts-ui-')));
  const home = resolve(root, 'home'), hermes = resolve(home, '.hermes'), grants = resolve(root, 'grants');
  mkdirSync(resolve(home, '.local/share/opencode'), { recursive: true, mode: 0o700 }); mkdirSync(hermes, { mode: 0o700 }); mkdirSync(grants, { mode: 0o700 });
  writeFileSync(resolve(home, '.local/share/opencode/auth.json'), JSON.stringify({ openai: { type: 'api', key: 'synthetic-ui-secret' }, openrouter: { type: 'api', key: 'synthetic-other-key' }, anthropic: { type: 'oauth', refresh: 'synthetic-refresh' } }), { mode: 0o600 });
  writeFileSync(resolve(hermes, '.env'), 'OPENROUTER_API_KEY=synthetic-native-key\n', { mode: 0o600 });
  const contents = {}, frame = {}, event = { sender: contents, senderFrame: frame };
  const auth = { serverOrigin: 'https://rhythm.test', userId: '7', authGeneration: 'fixture-generation', authenticated: true };
  const adapter = createHermesAccountsMain({ osHome: home, hermesHome: hermes, grantsPath: resolve(grants, 'grants.json'), getAuthState: () => auth, getDocumentState: () => ({ contents, frame, url: 'rhythm://app/index.html#/tools/agent-settings', epoch: 1 }), confirmNative: async () => true, disposeOwnedBackend: async () => {} });
  try {
    const initial = await adapter.getStatus(event); await adapter.setGrant(event, mutation);
    const configured = await adapter.getStatus(event);
    const attempt = adapter.createBackendAttempt({ attemptId: 'fixture-owned', profile: 'default' });
    await attempt.backendEnv({ serverOrigin: auth.serverOrigin, rhythmUserId: auth.userId, authGeneration: auth.authGeneration, profile: 'default', hermesHome: hermes, source: 'opencode-auth-json' });
    attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] });
    const applied = await adapter.getStatus(event); await adapter.setGrant(event, { ...mutation, action: 'disable' });
    const pending = await adapter.getStatus(event); auth.authenticated = false;
    return { initial, configured, applied, pending, unavailable: await adapter.getStatus(event) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {FixtureAgentSettingsTool,LiveSettingsTool} from './src/components/tools/AgentSettingsTool'; import {GatewayProvider} from './src/gateway/context'; const gateway={mode:'live',domains:{sessions:{profiles:async()=>[],accounts:async()=>[],authProviders:async()=>[]},mcp:{list:async()=>[]}},health:{api:async()=>{},engine:async()=>{}}}; const Frame=({children,title})=><main><h1>{title}</h1>{children}</main>; const Tool=window.__fixture?FixtureAgentSettingsTool:LiveSettingsTool; createRoot(document.getElementById('root')).render(<GatewayProvider gateway={gateway}><Tool Frame={Frame}/></GatewayProvider>);`, resolveDir: process.cwd(), loader: 'tsx' }, jsx: 'automatic', bundle: true, write: false, format: 'iife', outfile: '/tmp/unused-accounts-bundle.js', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' }, loader: { '.css': 'empty' }, logLevel: 'silent' });
  bundle = result.outputFiles[0].text;
});
async function open(page: Page, status: unknown, fixture = false, bridge = true) {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://accounts.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await page.goto('https://accounts.test/#/tools/agent-settings?settingsSection=accounts');
  await page.evaluate(({ status, fixture, bridge }) => {
    const w = window as any; w.__fixture = fixture; w.__status = status; w.__mutations = []; w.__memoryMutations = [];
    if (bridge) w.rhythmShell = { aiAccounts: Object.freeze({
      getStatus: async () => w.__status,
      setGrant: (payload: unknown) => { w.__mutations.push(payload); return new Promise(resolve => { w.__confirm = resolve; }); },
      setMemorySearchConsent: (payload: unknown) => { w.__memoryMutations.push(payload); return new Promise(resolve => { w.__memoryConfirm = resolve; }); },
    }) };
  }, { status, fixture, bridge });
  await page.addScriptTag({ content: bundle });
  if (process.env.RHYTHM_ACCOUNTS_VISUAL === '1') for (const file of ['src/styles.css', 'src/components/ListInspector.css', 'src/components/ToolWorkspace.css', 'src/components/tools/AgentSettingsTool.css']) await page.addStyleTag({ content: readFileSync(resolve(file), 'utf8') });
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
  await expect(page.getByRole('option', { name: 'Accounts', exact: true })).toBeVisible();
  return page.getByRole('region', { name: 'Hermes account sharing', exact: true });
}

test('S4-U1: live and fixture settings compose sharing inside the existing Accounts inspector', async ({ page }) => {
  const data = await metadata();
  for (const fixture of [false, true]) {
    const sharing = await open(page, data.initial, fixture);
    await expect(sharing).toBeVisible();
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Hermes account sharing');
    await expect(page.getByRole('option', { name: 'Accounts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(sharing.getByRole('textbox')).toHaveCount(0);
    await expect(sharing).toContainText(/Memory.*disabled/i);
  }
});
test('S4-U2: configured applied and pending receipts have distinct honest labels', async ({ page }) => {
  const data = await metadata();
  for (const [status, label] of [[data.configured, /Configured.*next.*start/i], [data.applied, /Applied.*running/i], [data.pending, /Pending.*next.*start/i]] as const) {
    const sharing = await open(page, status);
    await expect(sharing.getByRole('group', { name: 'OpenAI', exact: true })).toContainText(label);
  }
});
test('S4-U3: native precedence and OAuth source never offer enable', async ({ page }) => {
  const sharing = await open(page, (await metadata()).initial);
  const native = sharing.getByRole('group', { name: 'OpenRouter', exact: true });
  await expect(native).toContainText(/Hermes.*own|Hermes.*configured/i);
  await expect(native.getByRole('button', { name: /enable|share/i })).toHaveCount(0);
  const oauth = sharing.getByRole('group', { name: 'Anthropic', exact: true });
  await expect(oauth).toContainText(/OAuth.*not.*shar|OAuth.*unsupported/i);
  await expect(oauth.getByRole('button', { name: /enable|share/i })).toHaveCount(0);
});
test('S4-U4: enable waits for native confirmation then refreshes metadata', async ({ page }) => {
  const data = await metadata(); const sharing = await open(page, data.initial);
  const openai = sharing.getByRole('group', { name: 'OpenAI', exact: true });
  await openai.getByRole('button', { name: /share.*Hermes|enable sharing/i }).click();
  await expect(openai).not.toContainText(/Applied|Configured.*next.*start/i);
  expect(await page.evaluate(() => (window as any).__mutations)).toEqual([mutation]);
  await page.evaluate(status => { (window as any).__status = status; (window as any).__confirm({ accepted: true }); }, data.configured);
  await expect(openai).toContainText(/Configured.*next.*start/i);
});
test('S4-U5: rejected native consent keeps prior state without success', async ({ page }) => {
  const sharing = await open(page, (await metadata()).initial);
  const openai = sharing.getByRole('group', { name: 'OpenAI', exact: true });
  await openai.getByRole('button', { name: /share.*Hermes|enable sharing/i }).click();
  await page.evaluate(() => (window as any).__confirm({ accepted: false }));
  await expect(sharing).toContainText(/not changed|canceled|not enabled/i);
  await expect(openai).not.toContainText(/Applied|Configured.*next.*start/i);
});
test('S4-U6: disable reports a retained running key until restart', async ({ page }) => {
  const data = await metadata(); const sharing = await open(page, data.applied);
  await sharing.getByRole('group', { name: 'OpenAI', exact: true }).getByRole('button', { name: /disable|stop sharing/i }).click();
  expect(await page.evaluate(() => (window as any).__mutations)).toEqual([{ ...mutation, action: 'disable' }]);
  await page.evaluate(status => { (window as any).__status = status; (window as any).__confirm({ accepted: true }); }, data.pending);
  await expect(sharing).toContainText(/running.*retain|running.*still.*key/i);
  await expect(sharing).toContainText(/Pending.*next.*start/i);
});
test('S4-U7: unavailable or missing desktop bridge exposes no grant actions', async ({ page }) => {
  const data = await metadata();
  for (const bridge of [true, false]) {
    const sharing = await open(page, data.unavailable, false, bridge);
    await expect(sharing).toContainText(/unavailable/i);
    await expect(sharing.getByRole('button', { name: /enable|disable|share.*Hermes|stop sharing/i })).toHaveCount(0);
  }
});

test('S4-U8: refresh clears old grants when the desktop identity becomes unavailable', async ({ page }) => {
  const data = await metadata(); const sharing = await open(page, data.applied);
  await expect(sharing).toContainText(/Applied.*running/i);
  await page.evaluate(status => { (window as any).__status = status; }, data.unavailable);
  await sharing.getByRole('button', { name: /refresh.*sharing|refresh.*status/i }).click();
  await expect(sharing).toContainText(/unavailable/i);
  await expect(sharing).not.toContainText(/Applied.*running/i);
  await expect(sharing.getByRole('button', { name: /enable|disable|share.*Hermes|stop sharing/i })).toHaveCount(0);
});

test('1569:s6d-accounts-memory-ui:1 memory states and exact toggle payload remain metadata-only', async ({ page }) => {
  // Regression caught: the memory row collapses states, sends renderer identity, or renders bridge-provided authority data.
  const data = await metadata();
  const states = [
    ['disabled', /Memory search is disabled/i, /Share memory search/i],
    ['enabled', /Memory search is enabled/i, /Stop sharing memory search/i],
    ['pending-next-start', /Memory search.*next.*start/i, /Stop sharing memory search/i],
    ['unavailable', /Memory search is unavailable/i, null],
  ] as const;
  for (const [state, label, action] of states) {
    const status = { ...data.initial, memory: { state, token: 'synthetic-memory-token-never-render', url: 'https://api.vcrcapps.com/private' } };
    const sharing = await open(page, status);
    const row = sharing.getByRole('group', { name: 'Rhythm memory search', exact: true });
    await expect(row).toContainText(label);
    if (action) await expect(row.getByRole('button', { name: action })).toBeVisible();
    else await expect(row.getByRole('button')).toHaveCount(0);
    await expect(row).not.toContainText('synthetic-memory-token-never-render');
    await expect(row).not.toContainText('api.vcrcapps.com');
  }
  const sharing = await open(page, { ...data.initial, memory: { state: 'disabled' } });
  await sharing.getByRole('group', { name: 'Rhythm memory search', exact: true }).getByRole('button', { name: /Share memory search/i }).click();
  await expect(sharing).toContainText('Waiting for desktop confirmation…');
  expect(await page.evaluate(() => (window as any).__memoryMutations)).toEqual([{ action: 'enable', capability: 'memory.search' }]);
  await page.evaluate(status => { const w = window as any; w.__status = status; w.__memoryConfirm({ accepted: true }); }, { ...data.initial, memory: { state: 'pending-next-start' } });
  await expect(sharing.getByRole('group', { name: 'Rhythm memory search', exact: true })).toContainText(/next.*start/i);
});

test('1569:s6d-accounts-memory-ui:2 memory toggle is keyboard operable, narrow, and axe clean', async ({ page }) => {
  // Regression caught: the newly interactive row cannot be reached at narrow width or introduces an accessible-name violation.
  const data = await metadata();
  const sharing = await open(page, { ...data.initial, memory: { state: 'disabled' } });
  await page.setViewportSize({ width: 390, height: 844 });
  const action = sharing.getByRole('group', { name: 'Rhythm memory search', exact: true }).getByRole('button', { name: /Share memory search/i });
  await action.focus();
  await expect(action).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sharing).toContainText('Waiting for desktop confirmation…');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.hermes-accounts-settings').analyze()).violations).toEqual([]);
});


test('S4-U9: real styles preserve desktop narrow keyboard access and existing Accounts selection', async ({ page }) => {
  test.skip(process.env.RHYTHM_ACCOUNTS_VISUAL !== '1', 'Bounded real-CSS qualification');
  const data = await metadata(); const sharing = await open(page, data.initial);
  await expect(sharing).toBeVisible();
  const accounts = page.getByRole('option', { name: 'Accounts', exact: true });
  await accounts.focus(); await page.keyboard.press('ArrowDown');
  await expect(accounts).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(sharing).toHaveCount(0);
  await accounts.click(); await expect(sharing).toBeVisible();
  const action = sharing.getByRole('group', { name: 'OpenAI', exact: true }).getByRole('button', { name: 'Share with Hermes', exact: true });
  await action.focus(); await expect(action).toBeFocused();
  expect((await new AxeBuilder({ page }).include('.hermes-accounts-settings').analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/private/tmp/rhythm-accounts-ui-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sharing).toBeVisible(); await action.focus(); await expect(action).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.hermes-accounts-settings').analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/private/tmp/rhythm-accounts-ui-narrow.png', fullPage: true });
});
