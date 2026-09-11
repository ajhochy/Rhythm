import { test, expect, request as http } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires manager-owned phase2-integration sandbox');
test('E21-c5 real second HTTP client mutations reconcile visible rail and selected deletion without prompting', async ({ page }) => {
  page.on('pageerror', (error) => console.log('renderer error:', error.message));
  page.on('requestfailed', (req) => console.log('request failed:', req.url(), req.failure()?.errorText));
  page.on('response', async (res) => { if (res.status() >= 400) console.log('HTTP failure:', res.status(), res.url(), (await res.text()).slice(0, 200)); });
  const client = await http.newContext({ baseURL: 'http://127.0.0.1:4098' });
  const prefix = `E21-${randomUUID()}`; const ids: string[] = [];
  const create = async (suffix: string) => {
    const response = await client.post('/agent-sessions', { data: { name: `${prefix}-${suffix}`, agentId: null, projectId: null, cwd: '/private/tmp/rhythm-electron-phase2-integration' } });
    expect(response.status()).toBe(201);
    const body = await response.json(); ids.push(body.id); return body.id as string;
  };
  try {
    // Unrelated hosted notifications/threads only; session HTTP and WS are never intercepted.
    await page.route('https://e21.invalid/**', (route) => route.fulfill({ json: [] }));
    expect((await client.get('/opencode/health')).status()).toBe(200);
    const selected = await create('Z-selected');
    await page.addInitScript((id) => localStorage.setItem('rhythm-agents-live-selected-session', id), selected);
    const sockets: string[] = [];
    page.on('websocket', (ws) => { if (ws.url().endsWith('/ws/agents')) sockets.push(ws.url()); });
    await page.goto('/tests/electron-e21-harness.html');
    await expect(page.getByTestId(`session-${selected}`)).toHaveAttribute('aria-current', 'true');
    expect(sockets).toHaveLength(1);
    await page.getByTestId('session-search-toggle').click();
    await page.getByTestId('session-search').fill(prefix);
    await page.getByTestId('session-sort').selectOption('name');
    const other = await create('A-external');
    await expect(page.getByTestId(`session-${other}`)).toContainText(`${prefix}-A-external`);
    await expect(page.locator('button.session-row').first()).toHaveAttribute('data-testid', `session-${other}`);
    expect((await client.patch(`/agent-sessions/${other}`, { data: { name: `${prefix}-ZZ-renamed` } })).status()).toBe(200);
    await expect(page.getByTestId(`session-${other}`)).toContainText(`${prefix}-ZZ-renamed`);
    await expect(page.locator('button.session-row').first()).toHaveAttribute('data-testid', `session-${selected}`);
    expect((await client.patch(`/agent-sessions/${other}`, { data: { archived: true } })).status()).toBe(200);
    await expect(page.getByTestId(`session-${other}`)).toHaveCount(0);
    await expect(page.getByTestId(`session-${selected}`)).toHaveAttribute('aria-current', 'true');
    await page.getByRole('checkbox', { name: 'Archived sessions' }).check();
    await expect(page.getByTestId(`session-${other}`)).toBeVisible();
    expect((await client.delete(`/agent-sessions/${other}/hard`, { data: { removeWorktree: false } })).status()).toBe(204);
    await expect(page.getByTestId(`session-${other}`)).toHaveCount(0);
    expect((await client.delete(`/agent-sessions/${selected}/hard`, { data: { removeWorktree: false } })).status()).toBe(204);
    await expect.poll(async () => JSON.parse((await page.getByTestId('state').textContent())!).selectedId).toBe('');
    expect(JSON.parse((await page.getByTestId('state').textContent())!).selected.id).toBe('');
    console.log('E21 live: connected renderer observed external create, rename/order, archive, delete and explicit selection clearing; no prompts');
  } finally {
    for (const id of ids) await client.delete(`/agent-sessions/${id}/hard`, { data: { removeWorktree: false } });
    await client.dispose();
  }
});
