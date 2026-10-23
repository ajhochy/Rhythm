// Browser ports of exact packaged cases 52–54 and 114 in web-parity-20261022.json.
// Inert nonce schedules are read back through API and SQLite and removed only after no-run checks.
import { randomUUID } from 'node:crypto';
import type { Request } from '@playwright/test';
import { test, expect, ObservedApi, assertResponse, responseFor, reloadJsonFor } from './parity-fixture';
type Kind = 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';
type Schedule = { id: string; name: string; prompt: string; scheduleType: Kind; enabled: boolean;
  runAt: string | null; scheduledTime: string | null; scheduledDay: number | null;
  cronExpression: string | null; timezone: string; nextRunAt: string | null;
  createdByUserId: number | null; lastRunAt: string | null; lastRunStatus: string | null;
  agentKind: string; agentConfigId: string | null; allowedMcpsJson: string | null; allowedSkillsJson: string | null };
type Profile = { id: string; label: string; enabled: boolean; isAgent: boolean; isManager: boolean;
  schedulable: boolean; sessionSelectable: boolean; autoApproveActions: boolean; modelProvider: string | null;
  modelId: string | null; allowedMcpsJson: string | null; allowedSkillsJson: string | null;
  corePermissionsJson: string | null; allowedDelegatesJson: string | null };
const futureRunAt = '2099-01-01T12:00:00.000Z';
const allowedTools = ['rhythm_read_org_review_context', 'rhythm_read_org_review_session', 'rhythm_read_org_review_catalog', 'rhythm_submit_org_review_proposal'];
test('[web-parity-052] [AI schedules] private disabled once-only job keeps owner and disabled state through edit and reload', async ({ page, parity }) => {
  const api = parity.api;
  const nonce = randomUUID();
  const name = `[smoke] disabled schedule ${nonce}`;
  const prompt = `[smoke] inert schedule prompt ${nonce}; never dispatch`;
  const editedPrompt = `${prompt} edited`;
  const ownedRows = () => parity.rows(`SELECT id,name,prompt,schedule_type,run_at,next_run_at,enabled,
    created_by_user_id,last_run_at,last_run_status FROM agent_scheduled_tasks
    WHERE name=? AND prompt IN (?,?)`, name, prompt, editedPrompt);
  const runRows = (id: string) => parity.rows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', id);
  const cleanupErrors: string[] = [];
  let createdId: string | null = null;
  expect(ownedRows(), 'fresh nonce must not adopt an existing schedule').toEqual([]);

  try {
    // Reload on the live Tasks route: hash navigation can reuse the mounted
    // workspace and emit no GET. Consume the CDP body before later navigation.
    await page.goto('/#/tools/tasks');
    await expect(page.getByTestId('schedule-new')).toBeVisible();
    const { response: initialResponse, body: initialBody } = await reloadJsonFor<Schedule[]>(page, '/agent-schedules', parity.origin);
    await assertResponse(initialResponse, 'GET', '/agent-schedules', 200);
    expect(new URL(initialResponse.url()).origin).toBe(parity.origin);
    ObservedApi.from(initialResponse, parity);
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
    ObservedApi.from(createResponse, parity);
    expect(createResponse.request().postDataJSON()).toMatchObject({
      name, prompt, scheduleType: 'once', enabled: false,
    });
    const created = await createResponse.json() as Schedule;
    if (created.id && created.name === name) createdId = created.id;
    expect(created).toMatchObject({ name, prompt, scheduleType: 'once', enabled: false,
      runAt: null, nextRunAt: null, createdByUserId: 1,
      lastRunAt: null, lastRunStatus: null });
    expect(ownedRows()).toMatchObject([{ id: createdId, name, prompt, schedule_type: 'once',
      run_at: null, next_run_at: null, enabled: 0, created_by_user_id: 1,
      last_run_at: null, last_run_status: null }]);

    // Exercise the API timing update only after safe disabled UI creation.
    const patch = await api.fetch(`/agent-schedules/${createdId}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runAt: futureRunAt }) });
    expect(patch.status).toBe(200);
    expect(await patch.json() as Schedule).toMatchObject({ id: createdId, enabled: false,
      runAt: futureRunAt, nextRunAt: futureRunAt, createdByUserId: 1 });
    const durable = () => ({ id: createdId, name, schedule_type: 'once', run_at: futureRunAt,
      next_run_at: futureRunAt, enabled: 0, created_by_user_id: 1,
      last_run_at: null, last_run_status: null });
    expect(ownedRows()).toMatchObject([durable()]);
    expect(runRows(createdId!)).toEqual([]);

    const { response: reloaded, body: listed } = await reloadJsonFor<Schedule[]>(page, '/agent-schedules', parity.origin);
    await assertResponse(reloaded, 'GET', '/agent-schedules', 200);
    expect(listed.find(item => item.id === createdId)).toMatchObject({
      id: createdId, name, prompt, enabled: false, createdByUserId: 1,
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
      nextRunAt: futureRunAt, createdByUserId: 1,
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
      createdByUserId: 1 });
    expect(ownedRows()).toMatchObject([{ ...durable(), prompt: editedPrompt }]);

    const { response: finalResponse, body: finalBody } = await reloadJsonFor<Schedule[]>(page, '/agent-schedules', parity.origin);
    await assertResponse(finalResponse, 'GET', '/agent-schedules', 200);
    expect(finalBody.find(item => item.id === createdId))
      .toMatchObject({ id: createdId, prompt: editedPrompt, enabled: false,
        runAt: futureRunAt, nextRunAt: futureRunAt, createdByUserId: 1 });
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
        && row.created_by_user_id === 1
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
        if (parity.rows('SELECT id FROM agent_scheduled_tasks WHERE id=?', id).length !== 0)
          throw new Error('deleted schedule persists in SQLite');
      } catch (error) { cleanupErrors.push(`${id}: ${String(error)}`); }
    }
    expect(ownedRows(), 'exact nonce schedule must be removed').toEqual([]);
    expect(cleanupErrors).toEqual([]);
  }
});

test('[web-parity-053] [AI schedules] private disabled schedule Cancel retains and Confirm deletes', async ({ page, parity }) => {
  const api = parity.api;
  const nonce = randomUUID();
  const name = `[smoke] delete schedule ${nonce}`;
  const prompt = `[smoke] inert delete prompt ${nonce}; never dispatch`;
  const ownedRows = () => parity.rows(`SELECT id,name,prompt,schedule_type,run_at,next_run_at,enabled,
    created_by_user_id,last_run_at,last_run_status FROM agent_scheduled_tasks
    WHERE name=? AND prompt=?`, name, prompt);
  const runRows = (id: string) => parity.rows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', id);
  let createdId: string | null = null;
  const cleanupErrors: string[] = [];
  expect(ownedRows(), 'never adopt an existing nonce').toEqual([]);

  try {
    await page.goto('/#/tools/tasks');
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
    ObservedApi.from(createResponse, parity);
    expect(createResponse.request().postDataJSON()).toMatchObject({
      name, prompt, scheduleType: 'once', enabled: false,
    });
    const created = await createResponse.json() as Schedule;
    if (created.id && created.name === name) createdId = created.id;
    expect(created).toMatchObject({ name, prompt, scheduleType: 'once', enabled: false,
      runAt: null, nextRunAt: null, createdByUserId: 1,
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
      created_by_user_id: 1 }]);
    expect(cancelWrites).toEqual([]);
    expect(runRows(createdId!)).toEqual([]);

    await page.getByTestId('schedule-delete').click();
    await expect(dialog).toContainText(name);
    const deleteWait = responseFor(page, 'DELETE', `/agent-schedules/${createdId}`);
    await page.getByTestId('schedule-delete-dialog-confirm').click();
    const deleteResponse = await deleteWait;
    await assertResponse(deleteResponse, 'DELETE', `/agent-schedules/${createdId}`, 204);
    ObservedApi.from(deleteResponse, parity);
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
        && value.created_by_user_id === 1
        && value.run_at === null && value.next_run_at === null
        && value.last_run_at === null && value.last_run_status === null
        && runRows(id).length === 0;
      if (!safe) { cleanupErrors.push(`schedule ${id} changed; refusing cleanup`); continue; }
      try {
        const runs = await api.json<unknown[]>(`/agent-schedules/${id}/runs`);
        if (runs.length !== 0) throw new Error('run history exists; refusing cleanup');
        const removed = await api.fetch(`/agent-schedules/${id}`, { method: 'DELETE' });
        if (removed.status !== 204) throw new Error(`normal cleanup DELETE returned ${removed.status}`);
        if (parity.rows('SELECT id FROM agent_scheduled_tasks WHERE id=?', id).length !== 0)
          throw new Error('schedule persists after cleanup');
      } catch (error) { cleanupErrors.push(`${id}: ${String(error)}`); }
    }
    expect(ownedRows(), 'exact nonce schedule leaked').toEqual([]);
    expect(cleanupErrors).toEqual([]);
  }
});

test('[web-parity-054] [AI schedules] private editor creates future due schedules and preserves timing through edit and reload', async ({ page, parity }) => {
  test.setTimeout(180_000);
  const api = parity.api;
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
    if (url.origin === parity.origin && /^\/agent-schedules\/[^/]+\/runs$/.test(url.pathname)) pendingRunHistory.add(request);
  };
  const finishRunHistory = (request: Request) => { pendingRunHistory.delete(request); };
  page.on('request', trackRunHistory);
  page.on('requestfinished', finishRunHistory);
  page.on('requestfailed', finishRunHistory);
  const ownedRows = () => parity.rows(`SELECT id,name,prompt,schedule_type,enabled,run_at,scheduled_time,
    scheduled_day,cron_expression,timezone,next_run_at,created_by_user_id,last_run_at,last_run_status
    FROM agent_scheduled_tasks WHERE name LIKE ?`, `[smoke] schedule timing % ${nonce}`);
  const runRows = (id: string) => parity.rows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', id);
  const rootRows = (id: string) => parity.rows('SELECT id FROM agent_sessions WHERE scheduled_task_id=?', id);
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
    await page.goto('/#/tools/tasks');
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
      runAt: null, nextRunAt: null, createdByUserId: 1 });

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
        createdByUserId: 1,
      });
      expect(ownedRows().filter(row => row.id === blank.id)).toMatchObject([{
        enabled: 0, run_at: null, next_run_at: null,
        created_by_user_id: 1,
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
      ObservedApi.from(response, parity);
      const body = response.request().postDataJSON() as Record<string, unknown>;
      const created = await response.json() as Schedule;
      if (created.id && created.name === names[kind]) ids.set(kind, created.id);
      expect(created).toMatchObject({ id: ids.get(kind), name: names[kind], prompt: prompts[kind],
        scheduleType: kind, enabled: true, createdByUserId: 1 });

      // Stop even an unexpected early due row before inspecting it further.
      const disabledResponse = await api.fetch(`/agent-schedules/${created.id}`, { method: 'PATCH',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
      expect(disabledResponse.status).toBe(200);
      expect(await disabledResponse.json() as Schedule).toMatchObject({
        id: created.id, enabled: false, createdByUserId: 1 });

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
        next_run_at: created.nextRunAt, created_by_user_id: 1,
        last_run_at: null, last_run_status: null,
      }]);
      expect(await api.json<Schedule>(`/agent-schedules/${created.id}`)).toMatchObject({
        id: created.id, enabled: false, nextRunAt: created.nextRunAt,
        createdByUserId: 1,
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
        expect(updated).toMatchObject({ id, enabled: false, createdByUserId: 1 });
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
          created_by_user_id: 1,
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
      await page.goto('/#/tools/agent-tools');
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
        if (row.created_by_user_id !== 1 || row.schedule_type !== (key === 'disabled' ? 'once' : key))
          throw new Error('owner/type changed');
        if (row.enabled === 1) {
          const stopped = await api.fetch(`/agent-schedules/${id}`, { method: 'PATCH',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
          if (stopped.status !== 200) throw new Error(`disable returned ${stopped.status}`);
        }
        const current = await api.json<Schedule>(`/agent-schedules/${id}`);
        if (current.name !== names[key] || current.prompt !== prompts[key]
          || current.createdByUserId !== 1 || current.enabled
          || current.lastRunAt !== null || current.lastRunStatus !== null
          || runRows(id).length !== 0 || rootRows(id).length !== 0)
          throw new Error('changed or executed row; retaining fixture evidence');
        const deleted = await api.fetch(`/agent-schedules/${id}`, { method: 'DELETE' });
        if (deleted.status !== 204) throw new Error(`delete returned ${deleted.status}`);
        if (parity.rows('SELECT id FROM agent_scheduled_tasks WHERE id=?', id).length)
          throw new Error('deleted row still in SQLite');
      } catch (error) { cleanupErrors.push(`${key}: ${String(error)}`); }
    }
    if (cleanupUiQuiescent) expect(ownedRows(), 'exact nonce schedules must be removed').toEqual([]);
    expect(cleanupErrors).toEqual([]);
  }
});

test('[web-parity-114] [AI Org Reviewer] private canonical entry shows exact review policy and an available manual trigger', async ({ page, parity }, testInfo) => {
  const api = parity.api;
  const writes: string[] = [];
  const trackScheduleWrites = (request: import('@playwright/test').Request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/agent-schedules') && request.method() !== 'GET')
      writes.push(`${request.method()} ${pathname}`);
  };
  page.on('request', trackScheduleWrites);
  parity.deferCleanup('canonical schedule entry performed no writes', async () => {
    page.off('request', trackScheduleWrites);
    expect(writes).toEqual([]);
  });
  expect(process.env.RHYTHM_FEATURE_MODEL, 'entry test must not spend a model loan').not.toBe('1');
  await page.goto('/#/tools/tasks');
  await expect(page.getByTestId('schedule-new')).toBeVisible();
  const { response, body } = await reloadJsonFor<Schedule[]>(page, '/agent-schedules', parity.origin);
  await assertResponse(response, 'GET', '/agent-schedules', 200);
  ObservedApi.from(response, parity);
  expect(Array.isArray(body)).toBe(true);
  const seeded = body.filter(row => row.name === 'Org Reviewer' && row.agentConfigId === 'org-reviewer');
  expect(seeded, 'the canonical reviewer must have one schedule').toHaveLength(1);
  const schedule = seeded[0];
  expect(schedule).toMatchObject({ scheduleType: 'weekly', scheduledDay: 1,
    scheduledTime: '08:30', timezone: 'America/Los_Angeles',
    agentKind: 'opencode', agentConfigId: 'org-reviewer' });
  expect(schedule.createdByUserId === null || schedule.createdByUserId === 1,
    'canonical task cannot belong to a foreign account').toBe(true);
  expect(JSON.parse(String(schedule.allowedMcpsJson))).toEqual({ rhythm: allowedTools });
  expect(JSON.parse(String(schedule.allowedSkillsJson))).toEqual(['review-agent-org-health']);
  const taskRows = parity.rows(`SELECT id,name,schedule_type,scheduled_day,scheduled_time,timezone,enabled,
    agent_kind,agent_config_id,allowed_mcps_json,allowed_skills_json,created_by_user_id
    FROM agent_scheduled_tasks WHERE id=?`, schedule.id);
  expect(taskRows).toHaveLength(1);
  expect(taskRows[0]).toMatchObject({ id: schedule.id, name: schedule.name,
    agent_config_id: schedule.agentConfigId, created_by_user_id: schedule.createdByUserId });
  expect(parity.rows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', schedule.id)).toEqual([]);
  expect(await api.json<unknown[]>(`/agent-schedules/${schedule.id}/runs`)).toEqual([]);

  const profile = await api.json<Profile>('/agent-configs/org-reviewer');
  expect(profile).toMatchObject({ id: 'org-reviewer', label: 'Org Reviewer', enabled: true,
    isAgent: true, isManager: false, schedulable: true, sessionSelectable: false,
    autoApproveActions: false, modelProvider: 'openai', modelId: 'gpt-5.6-sol' });
  expect(JSON.parse(String(profile.allowedMcpsJson))).toEqual({ rhythm: allowedTools });
  expect(JSON.parse(String(profile.allowedSkillsJson))).toEqual(['review-agent-org-health']);
  expect(JSON.parse(String(profile.allowedDelegatesJson))).toEqual([]);
  const permissions = JSON.parse(String(profile.corePermissionsJson)) as Record<string, unknown>;
  expect(permissions['*']).toBe('deny');
  expect(permissions.task).toBe('deny');
  // The real signed-tool Recon proved the deny-all profile needs this
  // transport grant; its four actual MCP grants remain exact above.
  expect(permissions.mcp_dispatch).toBe('allow');
  for (const tool of allowedTools) expect(permissions[`rhythm_${tool}`]).toBe('allow');
  expect(parity.rows(`SELECT id,label,model_provider,model_id,allowed_mcps_json,
    allowed_skills_json,core_permissions_json,allowed_delegates_json FROM agent_configs WHERE id=?`,
  profile.id)).toMatchObject([{ id: profile.id, label: profile.label,
    model_provider: profile.modelProvider, model_id: profile.modelId,
    allowed_mcps_json: profile.allowedMcpsJson,
    allowed_skills_json: profile.allowedSkillsJson }]);

  const enabledBefore = schedule.enabled;
  const snapshot = parity.rows('SELECT enabled,next_run_at FROM agent_scheduled_tasks WHERE id=?', schedule.id);
  expect(snapshot).toEqual([{ enabled: schedule.enabled ? 1 : 0, next_run_at: schedule.nextRunAt }]);
  // Recon: bootseed may be enabled with nextRunAt=null. findDueAsync excludes
  // NULL explicitly; reading its manual trigger neither arms nor runs it.
  if (schedule.nextRunAt !== null)
    expect(Date.parse(schedule.nextRunAt), 'a scheduled reviewer must remain safely in the future').toBeGreaterThan(Date.now() + 60 * 60_000);

  const row = page.getByTestId(`schedule-${schedule.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Org Reviewer');
  await row.click();
  const trigger = page.getByTestId('schedule-trigger');
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveText('Trigger now');
  const disabled = await trigger.getAttribute('aria-disabled');
  expect(disabled === null || disabled === 'false').toBe(true);
  expect(parity.rows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', schedule.id)).toEqual([]);
  expect(await api.json<unknown[]>(`/agent-schedules/${schedule.id}/runs`)).toEqual([]);
  expect(parity.rows('SELECT enabled,next_run_at FROM agent_scheduled_tasks WHERE id=?', schedule.id)).toEqual(snapshot);
  expect(writes).toEqual([]);

  const observation = { ownerUserId: 1,
    canonicalScheduleId: schedule.id, canonicalScheduleOwnerUserId: schedule.createdByUserId,
    enabledBefore,
    canReadActorEvidence: schedule.createdByUserId === 1,
    profileId: profile.id, allowedToolCount: allowedTools.length,
    triggerVisible: true, triggerClicked: false, runCount: 0, modelTurns: 0,
    reviewerScanProven: false, approvalProven: false };
  await testInfo.attach('org-reviewer-entry.json', {
    body: Buffer.from(JSON.stringify(observation, null, 2)), contentType: 'application/json' });
});
