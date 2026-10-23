import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test as unverified, type Request } from '@playwright/test';
import { test, expect, API, ObservedApi, assertResponse, expectedRevision,
  localRows, responseFor } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Kind = 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';
type Schedule = { id: string; name: string; prompt: string; scheduleType: Kind; enabled: boolean;
  runAt: string | null; scheduledTime: string | null; scheduledDay: number | null;
  cronExpression: string | null; timezone: string; nextRunAt: string | null;
  createdByUserId: number | null; lastRunAt: string | null; lastRunStatus: string | null };

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI schedules] private editor creates future due schedules and preserves timing through edit and reload';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  test.setTimeout(180_000);
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor, 'private signed-in schedule owner required').toBeDefined();
  expect(manifest.publicUserSeed.email).toMatch(/\.invalid$/);
  const token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me'))
    .toMatchObject({ user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email } });

  const nonce = randomUUID();
  const kinds: Kind[] = ['once', 'daily', 'weekly', 'monthly', 'cron'];
  const allKeys = ['disabled', ...kinds] as const;
  type Key = typeof allKeys[number];
  const names = Object.fromEntries(allKeys.map(key => [key, `[smoke] schedule timing ${key} ${nonce}`])) as Record<Key, string>;
  const prompts = Object.fromEntries(allKeys.map(key => [key, `[smoke] inert timing ${key} ${nonce}; never trigger`])) as Record<Key, string>;
  const ids = new Map<Key, string>();
  const cleanupErrors: string[] = [];
  const pendingRunHistory = new Set<Request>();
  const trackRunHistory = (request: Request) => {
    if (request.method() !== 'GET') return;
    const url = new URL(request.url());
    if (url.origin === API && /^\/agent-schedules\/[^/]+\/runs$/.test(url.pathname)) pendingRunHistory.add(request);
  };
  const finishRunHistory = (request: Request) => { pendingRunHistory.delete(request); };
  page.on('request', trackRunHistory);
  page.on('requestfinished', finishRunHistory);
  page.on('requestfailed', finishRunHistory);
  const ownedRows = () => localRows(`SELECT id,name,prompt,schedule_type,enabled,run_at,scheduled_time,
    scheduled_day,cron_expression,timezone,next_run_at,created_by_user_id,last_run_at,last_run_status
    FROM agent_scheduled_tasks WHERE name LIKE ?`, `[smoke] schedule timing % ${nonce}`);
  const runRows = (id: string) => localRows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', id);
  const rootRows = (id: string) => localRows('SELECT id FROM agent_sessions WHERE scheduled_task_id=?', id);
  expect(ownedRows(), 'fresh nonce must not adopt prior schedules').toEqual([]);

  // All recurring candidates are at least about three hours ahead in UTC.
  // No wall-clock fake or model turn is needed to prove persistence.
  const futureUtc = new Date(Date.now() + 3 * 3_600_000);
  futureUtc.setUTCSeconds(0, 0);
  const time = `${String(futureUtc.getUTCHours()).padStart(2, '0')}:${String(futureUtc.getUTCMinutes()).padStart(2, '0')}`;
  const laterUtc = new Date(Date.now() + 4 * 3_600_000);
  laterUtc.setUTCSeconds(0, 0);
  const editedTime = `${String(laterUtc.getUTCHours()).padStart(2, '0')}:${String(laterUtc.getUTCMinutes()).padStart(2, '0')}`;
  const weekday = String(futureUtc.getUTCDay());
  const monthday = String(futureUtc.getUTCDate());
  const cron = `${futureUtc.getUTCMinutes()} ${futureUtc.getUTCHours()} * * *`;
  const onceLocal = '2099-01-15T12:00';
  const editedOnceLocal = '2099-02-15T12:00';

  try {
    await page.goto('rhythm://app/index.html#/tools/tasks');
    await expect(page.getByTestId('schedule-new')).toBeVisible();
    const initial = responseFor(page, 'GET', '/agent-schedules');
    await page.reload();
    await assertResponse(await initial, 'GET', '/agent-schedules', 200);

    // Enabled blank once must stay in the editor, issue no POST, and explain
    // the missing timing. The same blank definition remains valid disabled.
    await page.getByTestId('schedule-new').click();
    const blankEditor = page.getByTestId('schedule-editor');
    await blankEditor.getByLabel('Name', { exact: true }).fill(names.disabled);
    await blankEditor.getByLabel('Schedule Type').selectOption('once');
    await blankEditor.getByLabel('Instructions / Prompt').fill(prompts.disabled);
    await expect(blankEditor.getByLabel("Run at (this Mac's local time)")).toBeVisible();
    const invalidWrites: string[] = [];
    const onInvalid = (request: import('@playwright/test').Request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/agent-schedules')
        invalidWrites.push(request.url());
    };
    page.on('request', onInvalid);
    try {
      await blankEditor.getByTestId('schedule-save').click();
      await expect(blankEditor).toBeVisible();
      await expect(blankEditor.getByTestId('schedule-timing-error')).toBeVisible();
      await page.waitForTimeout(200);
      expect(invalidWrites).toEqual([]);
    } finally { page.off('request', onInvalid); }
    await blankEditor.getByLabel('Enabled', { exact: true }).uncheck();
    const blankPending = responseFor(page, 'POST', '/agent-schedules');
    await blankEditor.getByTestId('schedule-save').click();
    const blankResponse = await blankPending;
    await assertResponse(blankResponse, 'POST', '/agent-schedules', 201);
    const blank = await blankResponse.json() as Schedule;
    if (blank.id && blank.name === names.disabled) ids.set('disabled', blank.id);
    expect(blankResponse.request().postDataJSON()).toMatchObject({
      name: names.disabled, prompt: prompts.disabled, scheduleType: 'once', enabled: false,
    });
    expect(blank).toMatchObject({ name: names.disabled, prompt: prompts.disabled, enabled: false,
      runAt: null, nextRunAt: null, createdByUserId: manifest.ownerUserId });

    // The inspector's Enable shortcut must honor the same timing gate. It
    // opens the editor so the owner can supply a due time; it must not arm a
    // blank once row behind the editor's validation.
    await page.getByTestId(`schedule-${blank.id}`).click();
    const enableWrites: string[] = [];
    const onEnable = (request: import('@playwright/test').Request) => {
      if (request.method() === 'PATCH'
        && new URL(request.url()).pathname === `/agent-schedules/${blank.id}`)
        enableWrites.push(request.postData() ?? '');
    };
    page.on('request', onEnable);
    try {
      await page.getByTestId('schedule-toggle').click();
      const enableEditor = page.getByTestId('schedule-editor');
      await expect(enableEditor).toBeVisible();
      await expect(enableEditor.getByTestId('schedule-timing-error')).toBeVisible();
      await expect(enableEditor.getByLabel("Run at (this Mac's local time)")).toHaveValue('');
      await page.waitForTimeout(200);
      expect(enableWrites, 'blank inspector Enable must send no PATCH').toEqual([]);
      expect(await api.json<Schedule>(`/agent-schedules/${blank.id}`)).toMatchObject({
        id: blank.id, name: names.disabled, prompt: prompts.disabled,
        enabled: false, runAt: null, nextRunAt: null,
        createdByUserId: manifest.ownerUserId,
      });
      expect(ownedRows().filter(row => row.id === blank.id)).toMatchObject([{
        enabled: 0, run_at: null, next_run_at: null,
        created_by_user_id: manifest.ownerUserId,
      }]);
      expect(runRows(blank.id)).toEqual([]);
      expect(rootRows(blank.id)).toEqual([]);
      await enableEditor.getByRole('button', { name: 'Cancel', exact: true }).click();
    } finally { page.off('request', onEnable); }

    for (const kind of kinds) {
      await page.getByTestId('schedule-new').click();
      const editor = page.getByTestId('schedule-editor');
      await editor.getByLabel('Name', { exact: true }).fill(names[kind]);
      await editor.getByLabel('Schedule Type').selectOption(kind);
      await editor.getByLabel('Instructions / Prompt').fill(prompts[kind]);
      if (kind === 'once') await editor.getByLabel("Run at (this Mac's local time)").fill(onceLocal);
      if (kind !== 'once') {
        await editor.getByLabel('Timezone').selectOption('UTC');
        if (kind === 'cron') await editor.locator('input[name="cronExpression"]').fill(cron);
        else await editor.getByLabel('Time', { exact: true }).fill(time);
        if (kind === 'weekly') await editor.getByLabel('Weekday').selectOption(weekday);
        if (kind === 'monthly') await editor.getByLabel('Day of month').selectOption(monthday);
      }
      const expectedOnceIso = kind === 'once'
        ? await page.evaluate(value => new Date(value).toISOString(), onceLocal) : null;
      const pending = responseFor(page, 'POST', '/agent-schedules');
      await editor.getByTestId('schedule-save').click();
      const response = await pending;
      await assertResponse(response, 'POST', '/agent-schedules', 201);
      expect(response.request().headers().authorization).toBe(`Bearer ${token}`);
      const body = response.request().postDataJSON() as Record<string, unknown>;
      const created = await response.json() as Schedule;
      if (created.id && created.name === names[kind]) ids.set(kind, created.id);
      expect(created).toMatchObject({ id: ids.get(kind), name: names[kind], prompt: prompts[kind],
        scheduleType: kind, enabled: true, createdByUserId: manifest.ownerUserId });

      // Stop even an unexpected early due row before inspecting it further.
      const disabledResponse = await api.fetch(`/agent-schedules/${created.id}`, { method: 'PATCH',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
      expect(disabledResponse.status).toBe(200);
      expect(await disabledResponse.json() as Schedule).toMatchObject({
        id: created.id, enabled: false, createdByUserId: manifest.ownerUserId });

      expect(body).toMatchObject({ name: names[kind], prompt: prompts[kind], scheduleType: kind, enabled: true });
      if (kind === 'once') {
        expect(body.runAt).toBe(expectedOnceIso);
        expect(created).toMatchObject({ runAt: expectedOnceIso, nextRunAt: expectedOnceIso });
      } else {
        expect(body.timezone).toBe('UTC');
        if (kind === 'cron') expect(body.cronExpression).toBe(cron);
        else expect(body.scheduledTime).toBe(time);
        if (kind === 'weekly') expect(body.scheduledDay).toBe(Number(weekday));
        if (kind === 'monthly') expect(body.scheduledDay).toBe(Number(monthday));
        expect(created).toMatchObject({ timezone: 'UTC',
          scheduledTime: kind === 'cron' ? null : time,
          scheduledDay: kind === 'weekly' ? Number(weekday) : kind === 'monthly' ? Number(monthday) : null,
          cronExpression: kind === 'cron' ? cron : null });
        expect(Date.parse(created.nextRunAt!), `${kind} must have a computed due time`).toBeGreaterThan(Date.now() + 60 * 60_000);
      }
      expect(ownedRows().filter(row => row.id === created.id)).toMatchObject([{
        name: names[kind], prompt: prompts[kind], enabled: 0, schedule_type: kind,
        run_at: kind === 'once' ? expectedOnceIso : null,
        scheduled_time: kind === 'once' || kind === 'cron' ? null : time,
        scheduled_day: kind === 'weekly' ? Number(weekday) : kind === 'monthly' ? Number(monthday) : null,
        cron_expression: kind === 'cron' ? cron : null,
        timezone: kind === 'once' ? created.timezone : 'UTC',
        next_run_at: created.nextRunAt, created_by_user_id: manifest.ownerUserId,
        last_run_at: null, last_run_status: null,
      }]);
      expect(await api.json<Schedule>(`/agent-schedules/${created.id}`)).toMatchObject({
        id: created.id, enabled: false, nextRunAt: created.nextRunAt,
        createdByUserId: manifest.ownerUserId,
      });
      expect(runRows(created.id)).toEqual([]);
      expect(rootRows(created.id)).toEqual([]);
    }

    const reloaded = responseFor(page, 'GET', '/agent-schedules');
    await page.reload();
    await assertResponse(await reloaded, 'GET', '/agent-schedules', 200);
    for (const kind of kinds) {
      const id = ids.get(kind)!;
      await page.getByTestId(`schedule-${id}`).click();
      await page.getByTestId('schedule-edit').click();
      const editor = page.getByTestId('schedule-editor');
      await expect(editor.getByLabel('Enabled', { exact: true })).not.toBeChecked();
      if (kind === 'once') await expect(editor.getByLabel("Run at (this Mac's local time)")).toHaveValue(onceLocal);
      else {
        await expect(editor.getByLabel('Timezone')).toHaveValue('UTC');
        if (kind === 'cron') await expect(editor.locator('input[name="cronExpression"]')).toHaveValue(cron);
        else await expect(editor.getByLabel('Time', { exact: true })).toHaveValue(time);
        if (kind === 'weekly') await expect(editor.getByLabel('Weekday')).toHaveValue(weekday);
        if (kind === 'monthly') await expect(editor.getByLabel('Day of month')).toHaveValue(monthday);
      }
      if (kind === 'once' || kind === 'daily') {
        if (kind === 'once') await editor.getByLabel("Run at (this Mac's local time)").fill(editedOnceLocal);
        else await editor.getByLabel('Time', { exact: true }).fill(editedTime);
        const pending = responseFor(page, 'PATCH', `/agent-schedules/${id}`);
        await editor.getByTestId('schedule-save').click();
        const response = await pending;
        await assertResponse(response, 'PATCH', `/agent-schedules/${id}`, 200);
        const updated = await response.json() as Schedule;
        expect(updated).toMatchObject({ id, enabled: false, createdByUserId: manifest.ownerUserId });
        if (kind === 'once') {
          const expected = await page.evaluate(value => new Date(value).toISOString(), editedOnceLocal);
          expect(response.request().postDataJSON()).toMatchObject({ runAt: expected, enabled: false });
          expect(updated).toMatchObject({ runAt: expected, nextRunAt: expected });
        } else {
          expect(response.request().postDataJSON()).toMatchObject({ scheduledTime: editedTime, timezone: 'UTC', enabled: false });
          expect(updated.scheduledTime).toBe(editedTime);
          expect(Date.parse(updated.nextRunAt!)).toBeGreaterThan(Date.now() + 60 * 60_000);
        }
        expect(await api.json<Schedule>(`/agent-schedules/${id}`)).toMatchObject(updated);
        expect(ownedRows().filter(row => row.id === id)).toMatchObject([{
          enabled: 0,
          run_at: kind === 'once' ? updated.runAt : null,
          scheduled_time: kind === 'daily' ? editedTime : null,
          next_run_at: updated.nextRunAt,
          created_by_user_id: manifest.ownerUserId,
        }]);
      } else await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    const final = responseFor(page, 'GET', '/agent-schedules');
    await page.reload();
    await assertResponse(await final, 'GET', '/agent-schedules', 200);
    await page.getByTestId(`schedule-${ids.get('once')}`).click();
    await page.getByTestId('schedule-edit').click();
    await expect(page.getByTestId('schedule-editor').getByLabel("Run at (this Mac's local time)"))
      .toHaveValue(editedOnceLocal);
  } finally {
    // Recover a lost acknowledgement by exact nonce, disable first, then
    // delete only owner-bound rows with no dispatch, history, or root.
    const rows = ownedRows();
    if (rows.length > allKeys.length) cleanupErrors.push('multiple nonce rows; refusing cleanup');
    let cleanupUiQuiescent = false;
    try {
      await page.goto('rhythm://app/index.html#/tools/agent-tools');
      await page.getByRole('heading', { name: 'Choose a workspace', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
      await expect.poll(() => pendingRunHistory.size, { timeout: 10_000 }).toBe(0);
      cleanupUiQuiescent = true;
    } catch (error) {
      cleanupErrors.push(`could not unmount schedule UI and settle run-history reads: ${String(error)}`);
    } finally {
      page.off('request', trackRunHistory);
      page.off('requestfinished', finishRunHistory);
      page.off('requestfailed', finishRunHistory);
    }
    for (const key of cleanupUiQuiescent ? allKeys : []) {
      const matches = rows.filter(row => row.name === names[key] && row.prompt === prompts[key]);
      if (matches.length > 1) { cleanupErrors.push(`${key}: duplicate exact rows`); continue; }
      const row = matches[0];
      if (!row) continue;
      const id = String(row.id);
      try {
        if (ids.has(key) && ids.get(key) !== id) throw new Error('UI id differs from owner row');
        if (row.created_by_user_id !== manifest.ownerUserId || row.schedule_type !== (key === 'disabled' ? 'once' : key))
          throw new Error('owner/type changed');
        if (row.enabled === 1) {
          const stopped = await api.fetch(`/agent-schedules/${id}`, { method: 'PATCH',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
          if (stopped.status !== 200) throw new Error(`disable returned ${stopped.status}`);
        }
        const current = await api.json<Schedule>(`/agent-schedules/${id}`);
        if (current.name !== names[key] || current.prompt !== prompts[key]
          || current.createdByUserId !== manifest.ownerUserId || current.enabled
          || current.lastRunAt !== null || current.lastRunStatus !== null
          || runRows(id).length !== 0 || rootRows(id).length !== 0)
          throw new Error('changed or executed row; retaining fixture evidence');
        const deleted = await api.fetch(`/agent-schedules/${id}`, { method: 'DELETE' });
        if (deleted.status !== 204) throw new Error(`delete returned ${deleted.status}`);
        if (localRows('SELECT id FROM agent_scheduled_tasks WHERE id=?', id).length)
          throw new Error('deleted row still in SQLite');
      } catch (error) { cleanupErrors.push(`${key}: ${String(error)}`); }
    }
    if (cleanupUiQuiescent) expect(ownedRows(), 'exact nonce schedules must be removed').toEqual([]);
    expect(cleanupErrors).toEqual([]);
  }
});
