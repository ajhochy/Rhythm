import { test, expect, request as http } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires manager-owned phase2-integration sandbox');
test('E21-c5 real second HTTP client mutations reconcile visible rail and selected deletion without prompting', async ({ page }) => {
  page.on('pageerror', (error) => console.log('renderer error:', error.message));
  page.on('requestfailed', (req) => console.log('request failed:', req.url(), req.failure()?.errorText));
  page.on('response', async (res) => { if (res.status() >= 400) console.log('HTTP failure:', res.status(), res.url(), (await res.text()).slice(0, 200)); });
  const client = await http.newContext({ baseURL: process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098' });
  const prefix = `E21-${randomUUID()}`; const ids: string[] = [];
  const create = async (suffix: string) => {
    const response = await client.post('/agent-sessions', { data: { name: `${prefix}-${suffix}`, agentId: null, projectId: null, cwd: process.env.RHYTHM_SANDBOX_DIR ?? '/private/tmp/rhythm-electron-phase2-integration' } });
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
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'View archived sessions' }).click();
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

test('subagent-counts-c5 real API and web gateway keep exact 164 while loading only 100 then 64 children', async ({ page }) => {
  const sandbox = realpathSync(process.env.RHYTHM_SANDBOX_DIR!);
  expect(sandbox).toBe('/private/tmp/rhythm-subagent-counts-inline');
  const dbPath = realpathSync(path.join(sandbox, 'rhythm.db'));
  expect(path.dirname(dbPath)).toBe(sandbox);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  const prefix = `subagent-counts-${randomUUID()}`;
  const parentId = `${prefix}-parent`;
  const insert = db.prepare(`INSERT INTO agent_sessions
    (id, agent_kind, status, cwd, name, parent_session_id, category, is_system, created_at, updated_at, last_activity_at)
    VALUES (?, 'claude-code', ?, ?, ?, ?, 'chat', 0, ?, ?, ?)`);
  try {
    db.exec('BEGIN');
    const now = '2099-01-01T00:00:00.000Z';
    insert.run(parentId, 'closed', sandbox, `${prefix} parent`, null, now, now, now);
    for (let i = 0; i < 164; i++) {
      insert.run(`${prefix}-child-${String(i).padStart(3, '0')}`, i < 38 ? 'working' : 'closed', sandbox, `${prefix} child ${i}`, parentId, now, now, now);
    }
    db.exec('COMMIT');

    await page.route('https://e21.invalid/**', (route) => route.fulfill({ json: [] }));
    await page.goto('/tests/electron-e21-harness.html');
    const disclosure = page.getByTestId(`subagents-${parentId}`);
    await expect(disclosure).toHaveAccessibleName(`${prefix} parent: 164 subagents · 38 running`);
    const childRows = page.locator(`#subagent-children-${parentId} button.child-session`);
    await expect(childRows).toHaveCount(0);

    await page.getByRole('button', { name: `Load children of ${prefix} parent`, exact: true }).click();
    await expect(childRows).toHaveCount(100);
    await expect(disclosure).toHaveAccessibleName(`${prefix} parent: 164 subagents · 38 running`);
    await page.getByRole('button', { name: `Load older children of ${prefix} parent`, exact: true }).click();
    await expect(childRows).toHaveCount(164);
    await expect(disclosure).toHaveAccessibleName(`${prefix} parent: 164 subagents · 38 running`);
    expect(await childRows.evaluateAll((rows) => new Set(rows.map((row) => row.id)).size)).toBe(164);
  } finally {
    try { db.exec('ROLLBACK'); } catch { /* transaction already committed */ }
    db.prepare('DELETE FROM agent_sessions WHERE id LIKE ?').run(`${prefix}%`);
    db.close();
  }
});
