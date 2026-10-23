// Recon receipt: exact signed private app 2b8c0a8ed0 created a disabled once
// schedule (201), Cancel made zero DELETE requests and retained UI/API/SQLite
// state, Confirm returned 204 and removed all three views after reload.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test as unverified } from '@playwright/test';
import {
  test, expect, API, ObservedApi, assertResponse, expectedRevision,
  localRows, responseFor,
} from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Schedule = {
  id: string; name: string; prompt: string; scheduleType: string;
  enabled: boolean; runAt: string | null; nextRunAt: string | null;
  createdByUserId: number | null; lastRunAt: string | null;
  lastRunStatus: string | null;
};

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI schedules] private disabled schedule Cancel retains and Confirm deletes';
if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor).toBeDefined();
  expect(manifest.publicUserSeed.email).toMatch(/\.invalid$/);
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me'))
    .toMatchObject({ user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email } });

  const nonce = randomUUID();
  const name = `[smoke] delete schedule ${nonce}`;
  const prompt = `[smoke] inert delete prompt ${nonce}; never dispatch`;
  const ownedRows = () => localRows(`SELECT id,name,prompt,schedule_type,run_at,next_run_at,enabled,
    created_by_user_id,last_run_at,last_run_status FROM agent_scheduled_tasks
    WHERE name=? AND prompt=?`, name, prompt);
  const runRows = (id: string) => localRows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', id);
  let createdId: string | null = null;
  const cleanupErrors: string[] = [];
  expect(ownedRows(), 'never adopt an existing nonce').toEqual([]);

  try {
    await page.goto('rhythm://app/index.html#/tools/tasks');
    await expect(page.getByTestId('schedule-new')).toBeVisible();
    const initialWait = responseFor(page, 'GET', '/agent-schedules');
    await page.reload();
    await assertResponse(await initialWait, 'GET', '/agent-schedules', 200);

    await page.getByTestId('schedule-new').click();
    const editor = page.getByTestId('schedule-editor');
    await editor.getByLabel('Name', { exact: true }).fill(name);
    await editor.getByLabel('Schedule Type').selectOption('once');
    await editor.getByLabel('Instructions / Prompt').fill(prompt);
    await editor.getByLabel('Enabled', { exact: true }).uncheck();
    const createWait = responseFor(page, 'POST', '/agent-schedules');
    await editor.getByTestId('schedule-save').click();
    const createResponse = await createWait;
    await assertResponse(createResponse, 'POST', '/agent-schedules', 201);
    expect(createResponse.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(createResponse.request().postDataJSON()).toMatchObject({
      name, prompt, scheduleType: 'once', enabled: false,
    });
    const created = await createResponse.json() as Schedule;
    if (created.id && created.name === name) createdId = created.id;
    expect(created).toMatchObject({ name, prompt, scheduleType: 'once', enabled: false,
      runAt: null, nextRunAt: null, createdByUserId: manifest.ownerUserId,
      lastRunAt: null, lastRunStatus: null });
    expect(ownedRows()).toHaveLength(1);
    expect(runRows(createdId!)).toEqual([]);

    const row = page.getByTestId(`schedule-${createdId}`);
    await expect(row).toContainText('once · Disabled');
    await row.click();
    await page.getByTestId('schedule-delete').click();
    const dialog = page.getByTestId('schedule-delete-dialog');
    await expect(dialog).toContainText(name);
    const cancelWrites: string[] = [];
    const watchCancel = (request: import('@playwright/test').Request) => {
      if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/agent-schedules/${createdId}`)
        cancelWrites.push(request.url());
    };
    page.on('request', watchCancel);
    try {
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    } finally { page.off('request', watchCancel); }
    await expect(row).toBeVisible();
    expect((await api.fetch(`/agent-schedules/${createdId}`)).status).toBe(200);
    expect(ownedRows()).toMatchObject([{ id: createdId, name, prompt, enabled: 0,
      created_by_user_id: manifest.ownerUserId }]);
    expect(cancelWrites).toEqual([]);
    expect(runRows(createdId!)).toEqual([]);

    await page.getByTestId('schedule-delete').click();
    await expect(dialog).toContainText(name);
    const deleteWait = responseFor(page, 'DELETE', `/agent-schedules/${createdId}`);
    await page.getByTestId('schedule-delete-dialog-confirm').click();
    const deleteResponse = await deleteWait;
    await assertResponse(deleteResponse, 'DELETE', `/agent-schedules/${createdId}`, 204);
    expect(deleteResponse.request().headers().authorization).toBe(`Bearer ${token}`);
    expect((await api.json<Schedule[]>('/agent-schedules')).some(item => item.id === createdId)).toBe(false);
    expect(ownedRows()).toEqual([]);

    const reloadWait = responseFor(page, 'GET', '/agent-schedules');
    await page.reload();
    const reloaded = await reloadWait;
    await assertResponse(reloaded, 'GET', '/agent-schedules', 200);
    await expect(page.getByTestId(`schedule-${createdId}`)).toHaveCount(0);
    expect((await api.json<Schedule[]>('/agent-schedules')).some(item => item.id === createdId)).toBe(false);
    expect(ownedRows()).toEqual([]);
    expect(runRows(createdId!)).toEqual([]);
  } finally {
    if (createdId) expect(runRows(createdId), 'this disabled nonce schedule must never execute').toEqual([]);
    const rows = ownedRows();
    if (rows.length > 1) cleanupErrors.push('multiple exact-nonce rows; refusing cleanup');
    for (const value of rows.length === 1 ? rows : []) {
      const id = String(value.id);
      const safe = (!createdId || id === createdId) && value.name === name && value.prompt === prompt
        && value.schedule_type === 'once' && value.enabled === 0
        && value.created_by_user_id === manifest.ownerUserId
        && value.run_at === null && value.next_run_at === null
        && value.last_run_at === null && value.last_run_status === null
        && runRows(id).length === 0;
      if (!safe) { cleanupErrors.push(`schedule ${id} changed; refusing cleanup`); continue; }
      try {
        const runs = await api.json<unknown[]>(`/agent-schedules/${id}/runs`);
        if (runs.length !== 0) throw new Error('run history exists; refusing cleanup');
        const removed = await api.fetch(`/agent-schedules/${id}`, { method: 'DELETE' });
        if (removed.status !== 204) throw new Error(`normal cleanup DELETE returned ${removed.status}`);
        if (localRows('SELECT id FROM agent_scheduled_tasks WHERE id=?', id).length !== 0)
          throw new Error('schedule persists after cleanup');
      } catch (error) { cleanupErrors.push(`${id}: ${String(error)}`); }
    }
    expect(ownedRows(), 'exact nonce schedule leaked').toEqual([]);
    expect(cleanupErrors).toEqual([]);
  }
});
