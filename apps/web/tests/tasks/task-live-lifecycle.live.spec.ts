import { expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { liveEnvironment } from '../live-environment';

const { apiBase, engineBase } = liveEnvironment();
const dbPath = process.env.RHYTHM_LIVE_DB_PATH;
const live = process.env.RHYTHM_LIVE_E2E === '1';
const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
const evidence = path.resolve(import.meta.dirname, '../../../../docs/ai/runs/evidence/electron-m1-task-live.png');

test.skip(!live, 'requires RHYTHM_LIVE_E2E=1');
test.use({ bypassCSP: true });

type Db = {
  prepare(sql: string): { run(...values: unknown[]): { lastInsertRowid: number } };
  close(): void;
};

function openDb(): Db {
  const Database = requireApi('better-sqlite3') as new (file: string) => Db;
  return new Database(dbPath!);
}

function seedIdentity(db: Db, nonce: string, name: string) {
  const now = new Date().toISOString();
  const inserted = db.prepare('INSERT INTO users (name, email, role, is_facilities_manager, email_notifications_enabled, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, `smoke-task-${nonce}@example.invalid`, 'member', 0, 1, 'America/Los_Angeles', now, now);
  const userId = Number(inserted.lastInsertRowid);
  const token = randomUUID();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, now, '2099-01-01T00:00:00.000Z');
  return { userId, token };
}

async function startLiveWeb(token: string) {
  const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4175'], {
    cwd: new URL('../..', import.meta.url),
    env: { ...process.env, VITE_RHYTHM_GATEWAY_MODE: 'live', VITE_RHYTHM_API_BASE: apiBase, VITE_RHYTHM_EXPECTED_API_BASE: apiBase, VITE_RHYTHM_ENGINE_BASE: engineBase, VITE_RHYTHM_EXPECTED_ENGINE_BASE: engineBase, VITE_RHYTHM_PRODUCTION_API_BASE: apiBase, VITE_RHYTHM_LIVE_TOKEN: token },
    stdio: 'ignore',
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  return vite;
}

async function stop(process: ChildProcess | undefined) {
  if (!process || process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((resolve) => process.once('exit', () => resolve()));
}

test('task-live-lifecycle-c1: visible UI persists create edit complete reload and delete through the live task gateway', async ({ page, request }) => {
  // Regression caught: live mode silently renders fixtures, presents optimistic success, or loses the edited completed task after reload.
  expect(process.env.RHYTHM_LIVE_API_URL).toBe(apiBase);
  expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe(engineBase);
  expect(dbPath).toMatch(/\/rhythm\.db$/);

  const nonce = randomUUID();
  const db = openDb();
  const primary = seedIdentity(db, `${nonce}-primary`, 'Task smoke primary');
  const secondary = seedIdentity(db, `${nonce}-secondary`, 'Task smoke secondary');
  const collaborator = seedIdentity(db, `${nonce}-collaborator`, 'Task smoke collaborator');
  db.close();
  let vite: ChildProcess | undefined;
  let taskId = '';
  const responses: string[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(`${apiBase}/tasks`)) responses.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
  });

  try {
    vite = await startLiveWeb(primary.token);
    await page.goto('http://127.0.0.1:4175/#/tasks');
    await expect(page.getByTestId('page-state-empty')).toBeVisible();
    await page.getByTestId('tasks-empty-create').click();

    const title = `smoke-task-${nonce}`;
    const editedTitle = `${title} edited`;
    const notes = `live notes ${nonce}`;
    const editedNotes = `${notes} updated`;
    await page.getByTestId('task-create-title').fill(title);
    await page.getByTestId('task-create-notes').fill(notes);
    await page.getByTestId('task-create-submit').click();
    const row = page.locator('[data-testid^="task-row-"]', { hasText: title });
    await expect(row).toBeVisible();
    taskId = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
    await row.getByTestId(`task-select-${taskId}`).click();
    await page.getByTestId('task-edit-title').fill(editedTitle);
    await page.getByTestId('task-edit-notes').fill(editedNotes);
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-inspector')).toContainText(editedTitle);
    await page.getByTestId(`task-complete-${taskId}`).click();
    await page.getByTestId('tasks-completion-filter').selectOption('all');
    await expect(page.getByTestId(`task-row-${taskId}`)).toContainText(editedTitle);

    await mkdir(path.dirname(evidence), { recursive: true });
    await page.screenshot({ path: evidence });
    const image = await readFile(evidence);
    expect(image.subarray(16, 24).readUInt32BE(0)).toBe(1440);
    expect(image.subarray(16, 24).readUInt32BE(4)).toBe(900);
    console.log(`task screenshot sha256=${createHash('sha256').update(image).digest('hex')} bytes=${image.length} dimensions=1440x900`);

    await page.reload();
    await page.getByTestId('tasks-completion-filter').selectOption('all');
    await expect(page.getByTestId(`task-row-${taskId}`)).toContainText(editedTitle);
    await page.getByTestId(`task-inspect-${taskId}`).click();
    await expect(page.getByTestId('task-edit-notes')).toHaveValue(editedNotes);

    const otherHeaders = { Authorization: `Bearer ${secondary.token}` };
    const otherList = await request.get(`${apiBase}/tasks?status=all`, { headers: otherHeaders });
    expect(otherList.status()).toBe(200);
    expect((await otherList.json() as Array<{ id: string }>).map((task) => task.id)).not.toContain(taskId);
    for (const operation of [
      request.get(`${apiBase}/tasks/${taskId}`, { headers: otherHeaders }),
      request.patch(`${apiBase}/tasks/${taskId}`, { headers: otherHeaders, data: { title: 'forbidden edit' } }),
      request.delete(`${apiBase}/tasks/${taskId}`, { headers: otherHeaders }),
    ]) expect([403, 404]).toContain((await operation).status());

    const shared = await request.post(`${apiBase}/tasks/${taskId}/collaborators`, {
      headers: { Authorization: `Bearer ${primary.token}` }, data: { userId: collaborator.userId },
    });
    expect(shared.status()).toBe(201);
    const collaboratorList = await request.get(`${apiBase}/tasks?status=all`, { headers: { Authorization: `Bearer ${collaborator.token}` } });
    expect(collaboratorList.status()).toBe(200);
    expect((await collaboratorList.json() as Array<{ id: string; isShared: boolean }>).find((task) => task.id === taskId)).toMatchObject({ isShared: true });
    const collaboratorPatch = await request.patch(`${apiBase}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${collaborator.token}` }, data: { status: 'done' },
    });
    expect(collaboratorPatch.status()).toBe(200);
    expect(await collaboratorPatch.json()).toMatchObject({ isShared: true });

    await page.getByTestId(`task-menu-${taskId}`).click();
    await page.getByTestId(`task-delete-${taskId}`).click();
    await page.getByTestId('task-delete-confirm').click();
    await expect(page.getByTestId(`task-row-${taskId}`)).toHaveCount(0);
    await expect.poll(() => responses).toContain(`DELETE /tasks/${taskId} 204`);
    await page.reload();
    await expect(page.getByText(editedTitle, { exact: true })).toHaveCount(0);
    expect(responses).toEqual(expect.arrayContaining([
      'GET /tasks 200', `POST /tasks 201`, `PATCH /tasks/${taskId} 200`, `DELETE /tasks/${taskId} 204`,
    ]));
  } finally {
    await stop(vite);
    const cleanup = openDb();
    cleanup.prepare('DELETE FROM tasks WHERE owner_id IN (?, ?, ?)').run(primary.userId, secondary.userId, collaborator.userId);
    cleanup.prepare('DELETE FROM sessions WHERE user_id IN (?, ?, ?)').run(primary.userId, secondary.userId, collaborator.userId);
    cleanup.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(primary.userId, secondary.userId, collaborator.userId);
    cleanup.close();
  }
});
