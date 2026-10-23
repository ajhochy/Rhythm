import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test as unverified } from '@playwright/test';
import { test, expect, API, ObservedApi, assertResponse, expectedRevision, localRows, reloadJsonFor, responseFor } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Schedule = {
  id: string;
  name: string;
  prompt: string;
  scheduleType: string;
  enabled: boolean;
  runAt: string | null;
  nextRunAt: string | null;
  createdByUserId: number | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
};

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI schedules] private disabled once-only job keeps owner and disabled state through edit and reload';
const futureRunAt = '2099-01-01T12:00:00.000Z';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor, 'schedule writes require the private signed-in actor').toBeDefined();
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
    user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
  });

  const nonce = randomUUID();
  const name = `[smoke] disabled schedule ${nonce}`;
  const prompt = `[smoke] inert schedule prompt ${nonce}; never dispatch`;
  const editedPrompt = `${prompt} edited`;
  const ownedRows = () => localRows(`SELECT id,name,prompt,schedule_type,run_at,next_run_at,enabled,
    created_by_user_id,last_run_at,last_run_status FROM agent_scheduled_tasks
    WHERE name=? AND prompt IN (?,?)`, name, prompt, editedPrompt);
  const runRows = (id: string) => localRows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', id);
  const cleanupErrors: string[] = [];
  let createdId: string | null = null;
  expect(ownedRows(), 'fresh nonce must not adopt an existing schedule').toEqual([]);

  try {
    // Reload on the live Tasks route: hash navigation can reuse the mounted
    // workspace and emit no GET. Consume the CDP body before later navigation.
    await page.goto('rhythm://app/index.html#/tools/tasks');
    await expect(page.getByTestId('schedule-new')).toBeVisible();
    const { response: initialResponse, body: initialBody } = await reloadJsonFor<Schedule[]>(page, '/agent-schedules');
    await assertResponse(initialResponse, 'GET', '/agent-schedules', 200);
    expect(new URL(initialResponse.url()).origin).toBe(API);
    expect(initialResponse.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(Array.isArray(initialBody)).toBe(true);
    await expect(page.getByTestId('schedule-new')).toBeVisible();

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
    expect(ownedRows()).toMatchObject([{ id: createdId, name, prompt, schedule_type: 'once',
      run_at: null, next_run_at: null, enabled: 0, created_by_user_id: manifest.ownerUserId,
      last_run_at: null, last_run_status: null }]);

    // The UI currently has no once-only date field. Set a distant future date
    // through the ordinary authenticated API only after disabled creation.
    const patch = await api.fetch(`/agent-schedules/${createdId}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runAt: futureRunAt }) });
    expect(patch.status).toBe(200);
    expect(await patch.json() as Schedule).toMatchObject({ id: createdId, enabled: false,
      runAt: futureRunAt, nextRunAt: futureRunAt, createdByUserId: manifest.ownerUserId });
    const durable = () => ({ id: createdId, name, schedule_type: 'once', run_at: futureRunAt,
      next_run_at: futureRunAt, enabled: 0, created_by_user_id: manifest.ownerUserId,
      last_run_at: null, last_run_status: null });
    expect(ownedRows()).toMatchObject([durable()]);
    expect(runRows(createdId!)).toEqual([]);

    const { response: reloaded, body: listed } = await reloadJsonFor<Schedule[]>(page, '/agent-schedules');
    await assertResponse(reloaded, 'GET', '/agent-schedules', 200);
    expect(listed.find(item => item.id === createdId)).toMatchObject({
      id: createdId, name, prompt, enabled: false, createdByUserId: manifest.ownerUserId,
    });
    const row = page.getByTestId(`schedule-${createdId}`);
    await expect(row).toContainText(name);
    await expect(row).toContainText('once · Disabled');
    await row.click();
    const detail = page.getByTestId('list-inspector-detail');
    await expect(detail).toContainText(prompt);
    await expect(detail.getByText('Disabled', { exact: true })).toBeVisible();
    await expect(detail).toContainText('No runs yet.');
    expect(await api.json<Schedule>(`/agent-schedules/${createdId}`)).toMatchObject({
      id: createdId, name, prompt, enabled: false, runAt: futureRunAt,
      nextRunAt: futureRunAt, createdByUserId: manifest.ownerUserId,
    });
    expect(await api.json<unknown[]>(`/agent-schedules/${createdId}/runs`)).toEqual([]);

    await page.getByTestId('schedule-edit').click();
    const edit = page.getByTestId('schedule-editor');
    await expect(edit.getByLabel('Enabled', { exact: true })).not.toBeChecked();
    await edit.getByLabel('Instructions / Prompt').fill(editedPrompt);
    const editWait = responseFor(page, 'PATCH', `/agent-schedules/${createdId}`);
    await edit.getByTestId('schedule-save').click();
    const editResponse = await editWait;
    await assertResponse(editResponse, 'PATCH', `/agent-schedules/${createdId}`, 200);
    expect(editResponse.request().postDataJSON()).toMatchObject({ enabled: false, prompt: editedPrompt });
    expect(await editResponse.json() as Schedule).toMatchObject({ id: createdId, prompt: editedPrompt,
      enabled: false, runAt: futureRunAt, nextRunAt: futureRunAt,
      createdByUserId: manifest.ownerUserId });
    expect(ownedRows()).toMatchObject([{ ...durable(), prompt: editedPrompt }]);

    const { response: finalResponse, body: finalBody } = await reloadJsonFor<Schedule[]>(page, '/agent-schedules');
    await assertResponse(finalResponse, 'GET', '/agent-schedules', 200);
    expect(finalBody.find(item => item.id === createdId))
      .toMatchObject({ id: createdId, prompt: editedPrompt, enabled: false,
        runAt: futureRunAt, nextRunAt: futureRunAt, createdByUserId: manifest.ownerUserId });
    await expect(page.getByTestId(`schedule-${createdId}`)).toContainText('once · Disabled');
    await page.getByTestId(`schedule-${createdId}`).click();
    await expect(page.getByTestId('list-inspector-detail')).toContainText(editedPrompt);
    await expect(page.getByTestId('list-inspector-detail')).toContainText('No runs yet.');
    expect(runRows(createdId!)).toEqual([]);
  } finally {
    // Recover a lost POST acknowledgement by exact nonce. Never adopt a null-
    // owner, queued, executed, enabled, or otherwise changed schedule.
    const rows = ownedRows();
    if (rows.length > 1) cleanupErrors.push('multiple exact-nonce schedule rows; refusing cleanup');
    for (const row of rows.length === 1 ? rows : []) {
      const id = String(row.id);
      const safe = (!createdId || createdId === id) && row.name === name
        && [prompt, editedPrompt].includes(String(row.prompt))
        && row.schedule_type === 'once' && row.enabled === 0
        && row.created_by_user_id === manifest.ownerUserId
        && (row.run_at === null && row.next_run_at === null
          || row.run_at === futureRunAt && row.next_run_at === futureRunAt)
        && row.last_run_at === null && row.last_run_status === null
        && runRows(id).length === 0;
      if (!safe) { cleanupErrors.push(`schedule ${id} changed; refusing cleanup`); continue; }
      try {
        const runs = await api.json<unknown[]>(`/agent-schedules/${id}/runs`);
        if (runs.length !== 0) throw new Error('schedule has run history; refusing cleanup');
        const removed = await api.fetch(`/agent-schedules/${id}`, { method: 'DELETE' });
        if (removed.status !== 204) throw new Error(`normal delete returned ${removed.status}`);
        if (localRows('SELECT id FROM agent_scheduled_tasks WHERE id=?', id).length !== 0)
          throw new Error('deleted schedule persists in SQLite');
      } catch (error) { cleanupErrors.push(`${id}: ${String(error)}`); }
    }
    expect(ownedRows(), 'exact nonce schedule must be removed').toEqual([]);
    expect(cleanupErrors).toEqual([]);
  }
});
