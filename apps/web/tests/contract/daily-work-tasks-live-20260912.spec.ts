import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { liveEnvironment } from '../live-environment';

test('tasks-live-binding: harness sources bind arbitrary assigned sandbox bases without retired ports', () => {
  // Regression: a nominally green command silently targets a retired sandbox or production host.
  const webRoot = resolve(import.meta.dirname, '../..');
  const config = readFileSync(resolve(webRoot, 'tests/tasks-live-playwright.config.ts'), 'utf8');
  const spec = readFileSync(import.meta.filename, 'utf8');
  for (const name of ['RHYTHM_LIVE_API_URL', 'RHYTHM_LIVE_ENGINE_URL', 'RHYTHM_LIVE_GATEWAY_URL']) {
    expect(config).toContain(name);
    expect(spec).toContain(name);
  }
  const sources = `${config}\n${spec}`;
  expect(sources).not.toMatch(/127\.0\.0\.1:569[789]|api\.vcrcapps\.com/);
  expect(config).toContain('bypassCSP: true');
  expect(config).toContain('VITE_RHYTHM_PRODUCTION_API_BASE=https://tasks-live.invalid');
  expect(spec).toContain("const interceptedProductionOrigin = 'https://tasks-live.invalid'");
  expect(spec).toContain('[base, engineBase, gatewayBase, interceptedProductionOrigin]');
  expect(spec).toContain('url: `${url.origin === engineBase ? engineBase : base}');
  expect(spec).toContain('maxRedirects: 0');
  expect(spec).toContain('expect(denied).toEqual([])');
});

for (const width of [1440, 390]) test(`tasks-mutation-recovery: real persisted status, pending, failed Save and retry at ${width}`, async ({ page, request }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires an assigned owned Tasks sandbox');
  // Regression: status submits dirty fields, duplicate writes race, or a failure unmounts the editor.
  const { apiBase: base, engineBase } = liveEnvironment();
  const gatewayBase = new URL(process.env.RHYTHM_LIVE_GATEWAY_URL ?? '').origin;
  // Test-only nominal HTTPS origin: Playwright intercepts it and route.fetch maps it
  // to the assigned sandbox base below; the browser never contacts this hostname.
  const interceptedProductionOrigin = 'https://tasks-live.invalid';
  expect(process.env.RHYTHM_LIVE_API_URL).toBe(base);
  expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe(engineBase);
  expect(process.env.RHYTHM_LIVE_GATEWAY_URL).toBe(gatewayBase);
  const headers = { Authorization: 'Bearer e02-synthetic-session-not-a-secret' };
  expect((await (await request.get(`${base}/opencode/health`)).json()).status).toBe('ready');
  const stored = { title: `Tasks acceptance ${width}`, notes: 'Stored notes', scheduledDate: '2026-09-13', dueDate: '2026-09-14', preferredAgent: 'codex', energy: '⚡' };
  const response = await request.post(`${base}/tasks`, { headers, data: stored });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  const writes: unknown[] = [];
  const denied: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let failSave = true;
  try {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript(({ apiBase, engineBase, productionApiBase }) => {
      Object.defineProperty(window, 'rhythmShell', { configurable: true, value: {
        version: 8,
        gateway: { apiBase, engineBase, productionApiBase },
        auth: { currentSession: async () => ({ sessionToken: 'e02-synthetic-session-not-a-secret', user: { id: 1, name: 'Synthetic Admin', email: 'admin@example.invalid', role: 'admin', artifactTabIds: [] } }) },
      } });
    }, { apiBase: base, engineBase, productionApiBase: interceptedProductionOrigin });
    await page.routeWebSocket(/.*/, socket => socket.close());
    await page.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === 'http://127.0.0.1:4175') return route.continue();
      if (![base, engineBase, gatewayBase, interceptedProductionOrigin].includes(url.origin)) { denied.push(url.origin); return route.abort(); }
      const cors = { 'access-control-allow-origin': 'http://127.0.0.1:4175', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname === `/tasks/${created.id}` && req.method() === 'PATCH') {
        const body = req.postDataJSON();
        writes.push(body);
        if (writes.length === 1) { await held; return route.fulfill({ status: 503, headers: cors, json: { error: 'Injected transport failure' } }); }
        if ('title' in body && failSave) { failSave = false; return route.fulfill({ status: 503, headers: cors, json: { error: 'Injected transport failure' } }); }
      }
      // Only transport failures above are injected. Successful reads/writes hit the real sandbox.
      const real = await route.fetch({
        url: `${url.origin === engineBase ? engineBase : base}${url.pathname}${url.search}`,
        headers: { ...req.headers(), ...headers, origin: 'http://127.0.0.1:4175' },
        maxRedirects: 0,
      });
      await route.fulfill({ status: real.status(), headers: { ...real.headers(), ...cors }, body: await real.body() });
    });
    await page.goto(`/#/tasks/task/${created.id}?completion=all`);
    await page.getByTestId('task-edit-title').fill('Unsaved title');
    await page.getByTestId('task-edit-notes').fill('Unsaved notes');
    await page.getByTestId('task-edit-scheduled-date').fill('2026-09-15');
    await page.getByTestId('task-edit-due-date').fill('2026-09-16');
    await page.getByTestId('task-edit-agent').selectOption('claude-code');
    await page.getByTestId('task-edit-energy').selectOption('🌱');
    const action = page.getByTestId('task-detail-complete');
    await action.focus();
    await page.keyboard.press('Space');
    await expect(action).toBeDisabled();
    await page.keyboard.press('Space');
    await expect.poll(() => writes.length).toBe(1);
    release();
    await expect(page.getByTestId('task-inspector').getByRole('alert')).toContainText('Could not update task status');
    await expect(action).toHaveText('Complete task');
    await expect(page.getByTestId('task-edit-title')).toHaveValue('Unsaved title');
    const read = async () => (await (await request.get(`${base}/tasks/${created.id}`, { headers })).json());
    expect(await read()).toMatchObject({ ...stored, status: 'open' });
    await action.click();
    await expect(action).toHaveText('Reopen task');
    expect(await read()).toMatchObject({ ...stored, status: 'done' });
    await action.click();
    await expect(action).toHaveText('Complete task');
    expect(await read()).toMatchObject({ ...stored, status: 'open' });
    expect(writes).toEqual([{ status: 'done' }, { status: 'done' }, { status: 'open' }]);
    for (const [field, value] of Object.entries({ title: 'Unsaved title', notes: 'Unsaved notes', 'scheduled-date': '2026-09-15', 'due-date': '2026-09-16', agent: 'claude-code', energy: '🌱' })) {
      await expect(page.getByTestId(`task-edit-${field}`)).toHaveValue(value);
    }
    await page.getByTestId('task-detail-close').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('task-inspector').getByRole('alert').filter({ hasText: 'Could not save task details' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/task/${created.id}\\?completion=all$`));
    await expect(page.getByTestId('task-edit-notes')).toHaveValue('Unsaved notes');
    expect(await read()).toMatchObject({ ...stored, status: 'open' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('task-inspector')).toHaveCount(0);
    expect(await read()).toMatchObject({ title: 'Unsaved title', notes: 'Unsaved notes', scheduledDate: '2026-09-15', dueDate: '2026-09-16', preferredAgent: 'claude-code', energy: '🌱', status: 'open' });
    await page.reload();
    await page.getByTestId(`task-select-${created.id}`).click();
    await expect(page.getByTestId('task-edit-notes')).toHaveValue('Unsaved notes');
    expect(denied).toEqual([]);
  } finally {
    release();
    expect((await request.delete(`${base}/tasks/${created.id}`, { headers })).ok()).toBe(true);
  }
});
