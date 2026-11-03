// Natural scheduler + browser/API/engine linkage with scripted local responses. No paid model claim.
import { test, expect, responseFor, assertResponse, reloadJsonFor, type Row } from './parity-fixture';
import { prepareScriptedModel, createScriptedProfile, assertProjectedNoTools, backgroundEngineRead,
  completed, noToolParts, scriptedModel, scriptedAnswer, type EngineMessage, type SessionDetail } from './scripted-parity-fixture';

test('[web-parity-113] [AI schedules] private UI-created Once job fires on a natural local tick; disabled twin does not', async ({ page, parity }, testInfo) => {
  test.setTimeout(370_000);
  expect(process.env.RHYTHM_LOCAL_SMOKE, 'natural scheduler must be enabled').not.toBe('1');
  expect(process.env.NODE_ENV).not.toBe('test');
  await prepareScriptedModel(parity, true);
  const api = parity.api;
  const profile = await createScriptedProfile(parity, `${parity.prefix} natural-once profile`);
  await assertProjectedNoTools(parity, profile.id, parity.sandbox);
  const names = { disabled: `${parity.prefix} natural disabled`, enabled: `${parity.prefix} natural enabled` };
  const prompts = { disabled: `${parity.prefix}: S0:plain disabled control must not execute`,
    enabled: `${parity.prefix}: S0:plain natural scheduled turn` };
  const created = new Map<'disabled' | 'enabled', Row>();
  const owned = () => parity.rows(`SELECT id,name,prompt,enabled,schedule_type,run_at,next_run_at,
    agent_config_id,model_provider,model_id,created_by_user_id,last_run_at,last_run_status
    FROM agent_scheduled_tasks WHERE name IN (?,?)`, names.disabled, names.enabled);
  const rootRows = (id: string) => parity.rows(`SELECT id,scheduled_task_id,owner_user_id,profile_id,
    sdk_session_id,status,category,cwd,provider_id,model_id,parent_session_id FROM agent_sessions WHERE scheduled_task_id=?`, id);
  let manualTriggers = 0;
  const onRequest = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/trigger-now')) manualTriggers++;
  };
  page.on('request', onRequest);
  parity.deferCleanup('disable and delete exact natural schedules and bound roots', async () => {
    page.off('request', onRequest);
    expect(manualTriggers).toBe(0);
    await page.goto('/#/tools/agent-tools');
    await expect(page.getByTestId('agent-tools-catalog')).toBeVisible();
    const schedules = owned();
    expect(schedules.length).toBeLessThanOrEqual(2);
    // Disable every exact row before considering any destructive cleanup.
    for (const row of schedules) {
      const kind = row.name === names.enabled ? 'enabled' : 'disabled';
      expect(row).toMatchObject({ name: names[kind], prompt: prompts[kind], created_by_user_id: 1, schedule_type: 'once' });
      if (created.has(kind)) expect(row.id).toBe(created.get(kind)!.id);
      expect((await api.request('PATCH', `/agent-schedules/${row.id}`, { enabled: false })).status).toBe(200);
      expect((await api.json<Row>(`/agent-schedules/${row.id}`)).enabled).toBe(false);
    }
    for (const row of schedules) {
      const runs = await api.json<Row[]>(`/agent-schedules/${row.id}/runs`);
      const roots = rootRows(row.id);
      expect(runs.length).toBeLessThanOrEqual(1);
      expect(roots.length).toBe(runs.length);
      for (const root of roots) {
        expect(runs[0]).toMatchObject({ taskId: row.id, rootSessionId: root.id, status: 'completed_no_op', endedAt: expect.any(String) });
        expect(root).toMatchObject({ scheduled_task_id: row.id, owner_user_id: 1, profile_id: profile.id,
          cwd: parity.sandbox, category: 'scheduled', parent_session_id: null,
          provider_id: scriptedModel.providerID, model_id: scriptedModel.modelID });
        const bound = { id: root.id, cwd: String(root.cwd), sdk_session_id: String(root.sdk_session_id) };
        const response = await backgroundEngineRead(parity, bound, '/message?limit=100');
        expect(response.status).toBe(200);
        const messages = await response.json() as EngineMessage[];
        expect(messages.some(message => message.info.role === 'user' && message.parts.some(part => part.text?.includes(prompts.enabled)))).toBe(true);
        expect(completed(messages)).toHaveLength(1);
        noToolParts(messages);
        const endpoint = new URL(`/session/${encodeURIComponent(bound.sdk_session_id)}`, `http://127.0.0.1:${parity.enginePort}`);
        endpoint.searchParams.set('directory', parity.sandbox);
        expect((await api.fetch(`/agent-sessions/${root.id}/hard`, { method: 'DELETE' })).status).toBe(204);
        expect((await api.fetch(`/agent-sessions/${root.id}`)).status).toBe(404);
        expect(parity.rows('SELECT id FROM agent_sessions WHERE id=?', root.id)).toEqual([]);
        expect((await fetch(endpoint, { signal: AbortSignal.timeout(20_000) })).status).toBe(404);
      }
      expect((await api.fetch(`/agent-schedules/${row.id}`, { method: 'DELETE' })).status).toBe(204);
      expect((await api.fetch(`/agent-schedules/${row.id}`)).status).toBe(404);
      expect(parity.rows('SELECT id FROM agent_scheduled_tasks WHERE id=?', row.id)).toEqual([]);
      expect(parity.rows('SELECT id FROM agent_scheduled_task_runs WHERE task_id=?', row.id)).toEqual([]);
    }
    expect(owned()).toEqual([]);
  });
  expect(owned()).toEqual([]);
  await page.goto('/#/tools/tasks');
  await expect(page.getByTestId('schedule-new')).toBeVisible();
  await reloadJsonFor<Row[]>(page, '/agent-schedules', parity.origin);
  for (const kind of ['disabled', 'enabled'] as const) {
    await page.getByTestId('schedule-new').click();
    const editor = page.getByTestId('schedule-editor');
    await editor.getByLabel('Name', { exact: true }).fill(names[kind]);
    await editor.getByLabel('Schedule Type').selectOption('once');
    await editor.getByLabel('Instructions / Prompt').fill(prompts[kind]);
    await editor.getByLabel('Enabled', { exact: true }).uncheck();
    const pending = responseFor(page, 'POST', '/agent-schedules');
    await editor.getByTestId('schedule-save').click();
    const response = await pending;
    await assertResponse(response, 'POST', '/agent-schedules', 201);
    expect(response.request().headers().authorization).toBeUndefined();
    const row = await response.json() as Row;
    expect(row).toMatchObject({ name: names[kind], prompt: prompts[kind], enabled: false, runAt: null, nextRunAt: null, createdByUserId: 1 });
    created.set(kind, row);
    const configured = await api.request('PATCH', `/agent-schedules/${row.id}`, {
      agentConfigId: profile.id, agentKind: profile.id, modelProvider: scriptedModel.providerID, modelId: scriptedModel.modelID,
    });
    expect(configured.status).toBe(200);
    expect(await configured.json()).toMatchObject({ id: row.id, enabled: false, agentConfigId: profile.id,
      modelProvider: scriptedModel.providerID, modelId: scriptedModel.modelID, nextRunAt: null });
  }
  const toLocalInput = (iso: string) => page.evaluate(value => {
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, iso);
  let runAt = '';
  const disabledId = created.get('disabled')!.id;
  for (let attempt = 0; attempt < 3; attempt++) {
    runAt = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 60_000).toISOString();
    await page.getByTestId(`schedule-${disabledId}`).click();
    await page.getByTestId('schedule-edit').click();
    const editor = page.getByTestId('schedule-editor');
    await expect(editor.getByLabel('Enabled', { exact: true })).not.toBeChecked();
    const local = await toLocalInput(runAt);
    expect(await page.evaluate(value => new Date(value).toISOString(), local)).toBe(runAt);
    await editor.getByLabel("Run at (this Mac's local time)").fill(local);
    const pending = responseFor(page, 'PATCH', `/agent-schedules/${disabledId}`);
    await editor.getByTestId('schedule-save').click();
    const response = await pending;
    await assertResponse(response, 'PATCH', `/agent-schedules/${disabledId}`, 200);
    expect(response.request().postDataJSON()).toMatchObject({ runAt, enabled: false });
    expect(await response.json()).toMatchObject({ id: disabledId, enabled: false, runAt, nextRunAt: runAt });
    if (Date.parse(runAt) - Date.now() >= 65_000) break;
  }
  expect(Date.parse(runAt) - Date.now()).toBeGreaterThanOrEqual(60_000);
  const enabledId = created.get('enabled')!.id;
  await page.getByTestId(`schedule-${enabledId}`).click();
  await page.getByTestId('schedule-edit').click();
  const editor = page.getByTestId('schedule-editor');
  await editor.getByLabel("Run at (this Mac's local time)").fill(await toLocalInput(runAt));
  await editor.getByLabel('Enabled', { exact: true }).check();
  expect(Date.parse(runAt) - Date.now()).toBeGreaterThanOrEqual(45_000);
  const pending = responseFor(page, 'PATCH', `/agent-schedules/${enabledId}`);
  await editor.getByTestId('schedule-save').click();
  const response = await pending;
  await assertResponse(response, 'PATCH', `/agent-schedules/${enabledId}`, 200);
  expect(response.request().postDataJSON()).toMatchObject({ runAt, enabled: true });
  expect(await response.json()).toMatchObject({ id: enabledId, enabled: true, runAt, nextRunAt: runAt });
  await expect.poll(async () => {
    const runs = await api.json<Row[]>(`/agent-schedules/${enabledId}/runs`);
    return runs.length === 1 && runs[0].status === 'completed_no_op' && Boolean(runs[0].endedAt);
  }, { timeout: 220_000, intervals: [1000] }).toBe(true);
  const runs = await api.json<Row[]>(`/agent-schedules/${enabledId}/runs`);
  expect(runs).toHaveLength(1);
  const run = runs[0];
  expect(Date.parse(run.startedAt)).toBeGreaterThanOrEqual(Date.parse(runAt));
  const roots = rootRows(enabledId);
  expect(roots).toHaveLength(1);
  expect(roots[0]).toMatchObject({ id: run.rootSessionId, owner_user_id: 1, scheduled_task_id: enabledId,
    profile_id: profile.id, category: 'scheduled', cwd: parity.sandbox, provider_id: scriptedModel.providerID, model_id: scriptedModel.modelID });
  const root = roots[0];
  const sdk = await backgroundEngineRead(parity, { id: root.id, cwd: String(root.cwd), sdk_session_id: String(root.sdk_session_id) }, '/message?limit=100');
  expect(sdk.status).toBe(200);
  const messages = await sdk.json() as EngineMessage[];
  const users = messages.filter(message => message.info.role === 'user');
  const answers = completed(messages);
  expect(users).toHaveLength(1);
  expect(users[0].parts.some(part => part.text?.includes(prompts.enabled))).toBe(true);
  expect(answers).toHaveLength(1);
  expect(answers[0].info).toMatchObject({ ...scriptedModel, parentID: users[0].info.id, sessionID: root.sdk_session_id });
  expect(answers[0].parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('').trim()).toBe(scriptedAnswer);
  noToolParts(messages);
  const detail = await api.json<SessionDetail>(`/agent-sessions/${root.id}`);
  expect(detail.messages.filter(message => message.role === 'input')).toMatchObject([{ sdkMessageId: users[0].info.id }]);
  expect(detail.messages.filter(message => message.role === 'output')).toMatchObject([{ sdkMessageId: answers[0].info.id }]);
  expect(await api.json<Row>(`/agent-schedules/${enabledId}`)).toMatchObject({ enabled: true, nextRunAt: null, lastRunStatus: 'completed_no_op' });
  expect(await api.json<Row>(`/agent-schedules/${disabledId}`)).toMatchObject({ enabled: false, nextRunAt: runAt, lastRunAt: null, lastRunStatus: null });
  expect(await api.json<Row[]>(`/agent-schedules/${disabledId}/runs`)).toEqual([]);
  expect(rootRows(disabledId)).toEqual([]);
  expect(manualTriggers).toBe(0);
  await reloadJsonFor<Row[]>(page, '/agent-schedules', parity.origin);
  await page.getByTestId(`schedule-${enabledId}`).click();
  await expect(page.getByTestId('schedule-run-context')).toBeVisible();
  await expect(page.getByTestId('schedule-timing-warning')).not.toBeVisible();
  await expect(page.getByTestId(`schedule-run-${run.id}`)).toContainText('completed_no_op');
  await page.getByTestId(`schedule-run-${run.id}`).click();
  await expect(page).toHaveURL(new RegExp(`agents.*${root.id}`));
  await testInfo.attach('natural-once-scripted-proof.json', { contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ enabledId, disabledId, rootId: root.id, runId: run.id,
      completedRuns: 1, disabledRuns: 0, manualTriggers, sdkInputBound: true, sdkOutputBound: true,
      proof: 'scripted_ui_transport_only', realModelQualityClaimed: false })) });
});
