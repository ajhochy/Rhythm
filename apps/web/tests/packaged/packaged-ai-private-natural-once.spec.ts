import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Frame, Page, Request } from '@playwright/test';
import { test, expect, API, ENGINE, ObservedApi, assertResponse, expectedRevision,
  localRows, responseFor } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Schedule = { id: string; name: string; prompt: string; enabled: boolean; runAt: string | null;
  nextRunAt: string | null; agentConfigId: string | null; modelProvider: string | null; modelId: string | null;
  createdByUserId: number | null; lastRunAt: string | null; lastRunStatus: string | null };
type Run = { id: string; taskId: string; status: string; rootSessionId: string | null;
  startedAt: string; endedAt: string | null; error: string | null };
type RootBody = { session: { id: string; cwd: string; sdkSessionId: string | null;
  ownerUserId: number; scheduledTaskId: string; profileId: string; modelId: string }; messages: unknown[] };
type EngineMessage = { info: { id: string; role: string; sessionID: string; providerID?: string;
  modelID?: string; time?: { completed?: number }; error?: unknown }; parts: Array<{ type: string; text?: string }> };
type Profile = { id: string; revision: number; schedulable: boolean; label: string;
  corePermissionsJson: string | null; allowedMcpsJson: string | null; allowedSkillsJson: string | null };
type ProjectedAgent = { name: string; mode: string; prompt?: string;
  model?: { providerID: string; modelID: string };
  permission?: Array<{ permission: string; pattern: string; action: string }> };
type ProjectedRule = NonNullable<ProjectedAgent['permission']>[number];
const hasEffectiveNoToolsBoundary = (rules: ProjectedRule[], fixtureRoot: string) => {
  // Fork Permission.disabled and Permission.evaluate use the last matching
  // ordered rule. A final wildcard deny covers every tool permission, even
  // when inherited defaults earlier in the list say allow or ask.
  let lastWildcard = -1;
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    if (rules[index].permission !== '*') continue;
    lastWildcard = index;
    break;
  }
  if (lastWildcard < 0 || rules[lastWildcard].pattern !== '*' || rules[lastWildcard].action !== 'deny')
    return false;
  const truncateOutput = join(fixtureRoot, 'xdg-data', 'opencode', 'tool-output', '*');
  return rules.slice(lastWildcard + 1).every(rule =>
    rule.action === 'deny' ||
    (rule.permission === 'external_directory' && rule.pattern === truncateOutput && rule.action === 'allow'));
};
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const signatureHash = (app: string) => {
  const shown = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', app],
    { encoding: 'utf8', timeout: 30_000 });
  if (shown.status !== 0) throw new Error(`codesign display failed: ${shown.status}`);
  const cdHash = shown.stderr.match(/^CDHash=([a-fA-F0-9]+)$/m)?.[1];
  if (!cdHash) throw new Error('signed app has no CodeDirectory hash');
  return cdHash;
};
const reloadOwnedScheduleCatalog = async (page: Page, bearer: string): Promise<Schedule[]> => {
  // The reload can still complete an old document's GET after navigation.
  // Bind the response to a request made after the new main frame committed,
  // then consume its body before any further navigation (as in Skills).
  const currentDocumentRequests = new Set<Request>();
  let committed = false;
  const markDocument = (frame: Frame) => {
    if (frame === page.mainFrame()) committed = true;
  };
  const captureRequest = (request: Request) => {
    if (!committed || request.method() !== 'GET') return;
    const url = new URL(request.url());
    if (url.origin === API && url.pathname === '/agent-schedules') currentDocumentRequests.add(request);
  };
  page.on('framenavigated', markDocument);
  page.on('request', captureRequest);
  try {
    const pending = page.waitForResponse(response => currentDocumentRequests.has(response.request()), { timeout: 20_000 });
    void pending.catch(() => {});
    await page.reload();
    const response = await pending;
    await assertResponse(response, 'GET', '/agent-schedules', 200);
    expect(response.request().headers().authorization === bearer,
      'Tasks catalog must use the exact synthetic actor bearer').toBe(true);
    const body = await response.json();
    expect(Array.isArray(body), 'current-document Tasks catalog must be readable').toBe(true);
    return body as Schedule[];
  } finally {
    page.off('framenavigated', markDocument);
    page.off('request', captureRequest);
  }
};

test('[AI schedules] private UI-created Once job fires on a natural local tick; disabled twin does not', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const toLocalInput = async (iso: string) => page.evaluate(value => {
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, iso);
  const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
  expect(manifestPath, 'UNRUN: explicit fresh synthetic fixture required').toBeTruthy();
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNRUN: bounded real model opt-in required').toBe('1');
  expect(process.env.RHYTHM_LOCAL_SMOKE, 'UNRUN: this mode disables the scheduler').not.toBe('1');
  const manifest = readQualificationFixture(manifestPath!, expectedRevision).manifest;
  expect(manifest.publicUserSeed.email).toMatch(/\.invalid$/);
  const loan = manifest.syntheticActor?.modelLoan as { issuedAt: number; stopAt: number; expires: number } | undefined;
  const now = Date.now();
  expect(loan && Number.isSafeInteger(loan.issuedAt) && Number.isSafeInteger(loan.stopAt)
    && Number.isSafeInteger(loan.expires) && loan.issuedAt <= now
    && loan.stopAt > loan.issuedAt && loan.stopAt - loan.issuedAt <= 600_000
    && loan.stopAt <= loan.expires - 1_200_000 && loan.stopAt - now >= 300_000,
    'UNRUN: at least five minutes of model loan needed before any schedule write').toBe(true);
  expect(process.env.RHYTHM_PACKAGED_APP, 'UNRUN: exact signed local app required').toBeTruthy();
  const app = realpathSync(process.env.RHYTHM_PACKAGED_APP ?? '');
  const apiResourceCwd = join(app, 'Contents/Resources/api_server');
  const identityPath = join(apiResourceCwd, 'build-identity.json');
  const serverPath = join(apiResourceCwd, 'dist/server.js');
  const identity = JSON.parse(readFileSync(identityPath, 'utf8')) as { schemaVersion: number; sourceRevision: string };
  expect(identity).toMatchObject({ schemaVersion: 1, sourceRevision: expectedRevision });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 60_000 });
  const codeDirectoryHash = signatureHash(app);
  const bundleHashes = { identity: sha256(identityPath), server: sha256(serverPath) };
  const token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me'))
    .toMatchObject({ user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email } });
  const catalog = await api.json<Array<{ provider: string; modelId: string; visible: boolean; authorized: boolean }>>('/agents/models/catalog/full');
  expect(catalog.find(row => row.provider === 'openai' && row.modelId === 'gpt-6-luna'))
    .toMatchObject({ authorized: true });
  const visibility = await api.fetch('/agent-models/visibility', { method: 'PATCH',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updates: [
      { provider: 'openai', modelId: 'gpt-6-luna', visible: true },
    ] }) });
  expect(visibility.status).toBe(200);
  expect((await api.json<typeof catalog>('/agents/models/catalog/full'))
    .find(row => row.provider === 'openai' && row.modelId === 'gpt-6-luna'))
    .toMatchObject({ visible: true, authorized: true });
  const config = await api.json<{ catalog?: { source?: string; models?: Array<{ providerID: string;
    modelID: string; enabled: boolean }> } }>('/agent-decisions/config');
  expect(config.catalog?.source).toBe('live');
  expect(config.catalog?.models?.find(row => row.providerID === 'openai' && row.modelID === 'gpt-6-luna'))
    .toMatchObject({ enabled: true });
  const profile = await api.json<Profile>('/agent-configs/coding-agent');
  expect(profile).toMatchObject({ id: 'coding-agent', schedulable: true });
  expect(profile.label).toMatch(/^\[smoke\]/);
  const noTools = '{"*":"deny","task":"deny","rhythm_delegate_async":"deny","image_generation":"deny"}';
  const arithmeticPrompt = 'Compute the arithmetic in the user prompt mentally. Do not use tools, read files, or access external data. Reply with digits only.';
  // The shipped process cwd is Resources/api_server. The synthetic profile
  // must prohibit every tool before a paid turn so nothing reads that bundle
  // or its environment, regardless of the arithmetic prompt's wording.
  const denied = await api.fetch('/agent-configs/coding-agent', { method: 'PATCH',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      expectedRevision: profile.revision,
      corePermissionsJson: noTools, allowedMcpsJson: '[]', allowedSkillsJson: '[]',
      systemPrompt: arithmeticPrompt, modelProvider: 'openai', modelId: 'gpt-6-luna',
    }) });
  expect(denied.status).toBe(200);
  const restricted = await api.json<Profile>('/agent-configs/coding-agent');
  expect(restricted).toMatchObject({ id: 'coding-agent', corePermissionsJson: noTools,
    allowedMcpsJson: '[]', allowedSkillsJson: '[]', modelProvider: 'openai', modelId: 'gpt-6-luna' });
  let projected: ProjectedAgent | undefined;
  // agent-server sets XDG_DATA_HOME to this validated synthetic fixture root.
  // Refuse a redirected data home before admitting the fork's one narrow
  // Truncate.GLOB external_directory exception.
  expect(realpathSync(join(manifest.fixtureRoot, 'xdg-data')),
    'UNRUN: engine data home must be fixture-owned').toBe(join(manifest.fixtureRoot, 'xdg-data'));
  const projectionDeadline = Date.now() + 20_000;
  while (Date.now() < projectionDeadline) {
    const agents = await api.json<{ agents: ProjectedAgent[] }>(
      `/agent-sessions/agents?full=1&cwd=${encodeURIComponent(apiResourceCwd)}`);
    projected = agents.agents.find(agent => agent.name === 'coding-agent');
    const rules = projected?.permission ?? [];
    if (projected?.mode === 'all' && projected.prompt?.includes(arithmeticPrompt)
      && projected.model?.providerID === 'openai' && projected.model?.modelID === 'gpt-6-luna'
      && ['*', 'task', 'rhythm_delegate_async', 'image_generation'].every(permission =>
        rules.some(rule => rule.permission === permission && rule.pattern === '*' && rule.action === 'deny'))
      && hasEffectiveNoToolsBoundary(rules, manifest.fixtureRoot)) break;
    await sleep(500);
  }
  expect(projected, 'UNRUN: live fork must load the no-tools synthetic profile before arming')
    .toMatchObject({ name: 'coding-agent', mode: 'all', prompt: expect.stringContaining(arithmeticPrompt),
      model: { providerID: 'openai', modelID: 'gpt-6-luna' } });
  for (const permission of ['*', 'task', 'rhythm_delegate_async', 'image_generation'])
    expect(projected!.permission, `UNRUN: live ${permission} denial must be loaded`)
      .toContainEqual({ permission, pattern: '*', action: 'deny' });
  expect(hasEffectiveNoToolsBoundary(projected!.permission!, manifest.fixtureRoot),
    'UNRUN: last effective rule must deny every tool; only fixture-owned truncation output may follow').toBe(true);

  const nonce = randomUUID();
  const names = { disabled: `[smoke] natural disabled ${nonce}`, enabled: `[smoke] natural enabled ${nonce}` };
  const prompts = { disabled: `[smoke] disabled control ${nonce}; do not execute`,
    enabled: `[smoke] scheduled ${nonce}: Compute 12 + 7. Reply only with digits. No tools are needed.` };
  const receipt: Record<string, unknown> = { sourceRevision: expectedRevision, ownerUserId: manifest.ownerUserId,
    bundleHashesBefore: bundleHashes, codeDirectoryHashBefore: codeDirectoryHash,
    stages: [], manualTriggers: 0, status: 'unrun' };
  const stages = receipt.stages as Array<Record<string, unknown>>;
  const owned = () => localRows(`SELECT id,name,prompt,enabled,schedule_type,run_at,next_run_at,
    agent_config_id,model_provider,model_id,created_by_user_id,last_run_at,last_run_status
    FROM agent_scheduled_tasks WHERE name IN (?,?)`, names.disabled, names.enabled);
  const rootRows = (id: string) => localRows(`SELECT id,scheduled_task_id,owner_user_id,profile_id,
    sdk_session_id,status,category,cwd,provider_id,model_id,parent_session_id
    FROM agent_sessions WHERE scheduled_task_id=?`, id);
  const created = new Map<'disabled' | 'enabled', Schedule>();
  const onRequest = (request: { method(): string; url(): string }) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/trigger-now'))
      receipt.manualTriggers = Number(receipt.manualTriggers) + 1;
  };
  page.on('request', onRequest);
  let rootId: string | null = null;
  let primaryError: unknown;
  let phase = 'initial Tasks catalog';
  const cleanupErrors: string[] = [];
  try {
    expect(owned(), 'fresh nonce must own zero prior rows').toEqual([]);
    await page.goto('rhythm://app/index.html#/tools/tasks');
    await expect(page.getByTestId('schedule-new')).toBeVisible();
    await reloadOwnedScheduleCatalog(page, `Bearer ${token}`);

    for (const kind of ['disabled', 'enabled'] as const) {
      phase = `create ${kind} inert schedule`;
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
      expect(response.request().headers().authorization === `Bearer ${token}`,
        'schedule creation must use the exact synthetic actor bearer').toBe(true);
      const row = await response.json() as Schedule;
      expect(row).toMatchObject({ name: names[kind], prompt: prompts[kind], enabled: false,
        runAt: null, nextRunAt: null, createdByUserId: manifest.ownerUserId });
      created.set(kind, row);
    }

    phase = 'bind private fixed model';
    // Configure the private fixed model/profile while both jobs remain inert.
    for (const kind of ['disabled', 'enabled'] as const) {
      const row = created.get(kind)!;
      const response = await api.fetch(`/agent-schedules/${row.id}`, { method: 'PATCH',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          agentConfigId: 'coding-agent', agentKind: 'coding-agent',
          modelProvider: 'openai', modelId: 'gpt-6-luna',
        }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: row.id, enabled: false,
        agentConfigId: 'coding-agent', modelProvider: 'openai', modelId: 'gpt-6-luna', nextRunAt: null });
    }
    expect(loan!.stopAt! - Date.now(), 'UNRUN: loan too short before arming').toBeGreaterThanOrEqual(300_000);
    // Next full minute plus another minute yields a 60–120 second horizon.
    // Refresh the target if editing the negative control consumed too much of
    // it; never enable a row with less than one minute remaining.
    phase = 'edit disabled control due time';
    let runAt = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(loan!.stopAt! - Date.now(), 'UNRUN: loan too short before arming').toBeGreaterThanOrEqual(300_000);
      runAt = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 60_000).toISOString();
      const id = created.get('disabled')!.id;
      await page.getByTestId(`schedule-${id}`).click();
      await page.getByTestId('schedule-edit').click();
      const editor = page.getByTestId('schedule-editor');
      await expect(editor.getByLabel('Enabled', { exact: true })).not.toBeChecked();
      const local = await toLocalInput(runAt);
      expect(await page.evaluate(value => new Date(value).toISOString(), local),
        'browser-local form must encode exact ISO due minute').toBe(runAt);
      await editor.getByLabel("Run at (this Mac's local time)").fill(local);
      const pending = responseFor(page, 'PATCH', `/agent-schedules/${id}`);
      await editor.getByTestId('schedule-save').click();
      const response = await pending;
      await assertResponse(response, 'PATCH', `/agent-schedules/${id}`, 200);
      expect(response.request().postDataJSON()).toMatchObject({ runAt, enabled: false });
      expect(await response.json()).toMatchObject({ id, enabled: false, runAt, nextRunAt: runAt });
      if (Date.parse(runAt) - Date.now() >= 65_000) break;
    }
    expect(Date.parse(runAt) - Date.now(), 'UNRUN: too little time to arm exact due date safely').toBeGreaterThanOrEqual(60_000);
    expect(loan!.stopAt! - Date.now(), 'UNRUN: loan too short before positive arming').toBeGreaterThanOrEqual(300_000);
    receipt.runAt = runAt;
    phase = 'arm enabled due time';
    const positiveId = created.get('enabled')!.id;
    await page.getByTestId(`schedule-${positiveId}`).click();
    await page.getByTestId('schedule-edit').click();
    const positiveEditor = page.getByTestId('schedule-editor');
    await positiveEditor.getByLabel("Run at (this Mac's local time)").fill(await toLocalInput(runAt));
    await positiveEditor.getByLabel('Enabled', { exact: true }).check();
    expect(Date.parse(runAt) - Date.now(), 'UNRUN: too little time before enabling').toBeGreaterThanOrEqual(45_000);
    const positivePending = responseFor(page, 'PATCH', `/agent-schedules/${positiveId}`);
    await positiveEditor.getByTestId('schedule-save').click();
    const positiveResponse = await positivePending;
    await assertResponse(positiveResponse, 'PATCH', `/agent-schedules/${positiveId}`, 200);
    expect(positiveResponse.request().postDataJSON()).toMatchObject({ runAt, enabled: true });
    expect(await positiveResponse.json()).toMatchObject({ id: positiveId, enabled: true, runAt, nextRunAt: runAt });
    stages.push({ at: new Date().toISOString(), event: 'armed', rows: owned() });

    phase = 'wait for natural scheduler';
    const enabledId = created.get('enabled')!.id;
    const disabledId = created.get('disabled')!.id;
    const deadline = Math.min(Date.now() + 240_000, loan!.stopAt! - 30_000);
    let runs: Run[] = [];
    let lastStatus = '';
    let rootBody: RootBody | null = null;
    let engineMessages: EngineMessage[] = [];
    let completedAssistant: EngineMessage | undefined;
    while (Date.now() < deadline) {
      const row = await api.json<Schedule>(`/agent-schedules/${enabledId}`);
      if (row.lastRunStatus !== lastStatus) {
        stages.push({ at: new Date().toISOString(), event: 'status', status: row.lastRunStatus,
          lastRunAt: row.lastRunAt, nextRunAt: row.nextRunAt });
        lastStatus = row.lastRunStatus ?? '';
      }
      runs = await api.json<Run[]>(`/agent-schedules/${enabledId}/runs`);
      const terminal = runs.length === 1 && Boolean(runs[0].endedAt)
        && !['queued', 'running'].includes(runs[0].status);
      if (terminal && runs[0].rootSessionId) {
        rootId = runs[0].rootSessionId;
        rootBody = await api.json<RootBody>(`/agent-sessions/${rootId}`);
        expect(rootBody.session.cwd, 'packaged scheduler inherits API process cwd').toBe(apiResourceCwd);
        const sdkId = rootBody.session.sdkSessionId;
        if (sdkId) {
          const sdk = await fetch(`${ENGINE}/session/${encodeURIComponent(sdkId)}/message?${new URLSearchParams({ directory: rootBody.session.cwd })}`,
            { signal: AbortSignal.timeout(20_000) });
          receipt.sdkStatus = sdk.status;
          if (sdk.ok) {
            engineMessages = await sdk.json() as EngineMessage[];
            completedAssistant = engineMessages.find(message => message.info.role === 'assistant'
              && message.info.sessionID === sdkId && Boolean(message.info.time?.completed) && !message.info.error);
          }
        }
      }
      if (terminal && completedAssistant) break;
      await sleep(1000);
    }
    receipt.enabledTask = await api.json<Schedule>(`/agent-schedules/${enabledId}`);
    receipt.enabledRuns = runs;
    receipt.disabledTask = await api.json<Schedule>(`/agent-schedules/${disabledId}`);
    receipt.disabledRuns = await api.json<Run[]>(`/agent-schedules/${disabledId}/runs`);
    expect(receipt.enabledTask).toMatchObject({ id: enabledId, enabled: true,
      lastRunStatus: 'completed_no_op', nextRunAt: null });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ taskId: enabledId, status: 'completed_no_op' });
    expect(runs[0].endedAt).toBeTruthy();
    expect(Date.parse(runs[0].startedAt)).toBeGreaterThanOrEqual(Date.parse(runAt));
    expect(receipt.disabledTask).toMatchObject({ id: disabledId, enabled: false,
      lastRunAt: null, lastRunStatus: null, nextRunAt: runAt });
    expect(receipt.disabledRuns).toEqual([]);
    receipt.enabledRoots = rootRows(enabledId);
    receipt.disabledRoots = rootRows(disabledId);
    receipt.manualTriggers = Number(receipt.manualTriggers);

    // Observe identity/output without storing raw engine messages or file/tool
    // arguments in the receipt. An unexpected tool part still fails Recon.
    const run = runs[0];
    if (rootBody) {
      receipt.root = {
        id: rootBody.session.id, cwd: rootBody.session.cwd,
        sdkSessionId: rootBody.session.sdkSessionId,
        ownerUserId: rootBody.session.ownerUserId,
        scheduledTaskId: rootBody.session.scheduledTaskId,
        profileId: rootBody.session.profileId, modelId: rootBody.session.modelId,
      };
      receipt.localMessageMetadata = rootBody.messages.map(message => {
        const row = message as { role?: string; sdkMessageId?: string };
        return { role: row.role, sdkMessageId: row.sdkMessageId };
      });
    }
    receipt.sdkMessageMetadata = engineMessages.map(message => ({
      id: message.info.id, role: message.info.role, providerID: message.info.providerID,
      modelID: message.info.modelID, completed: Boolean(message.info.time?.completed),
      error: Boolean(message.info.error), partTypes: message.parts.map(part => part.type),
    }));
    receipt.completedAssistant = completedAssistant ? {
      id: completedAssistant.info.id, sessionID: completedAssistant.info.sessionID,
      providerID: completedAssistant.info.providerID, modelID: completedAssistant.info.modelID,
      completed: Boolean(completedAssistant.info.time?.completed),
    } : null;
    const answer = completedAssistant?.parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('').trim() ?? '';
    const outputBound = Boolean(completedAssistant && rootBody?.messages.some(message => {
      const row = message as { role?: string; sdkMessageId?: string };
      return row.role === 'output' && row.sdkMessageId === completedAssistant.info.id;
    }));
    const sdkUsers = engineMessages.filter(message => message.info.role === 'user'
      && message.info.sessionID === rootBody?.session.sdkSessionId);
    const inputBound = sdkUsers.length === 1 && Boolean(rootBody?.messages.some(message => {
      const row = message as { role?: string; sdkMessageId?: string };
      return row.role === 'input' && row.sdkMessageId === sdkUsers[0].info.id;
    }));
    receipt.answer = answer;
    receipt.localOutputBoundToSdkAssistant = outputBound;
    receipt.localInputBoundToSdkUser = inputBound;
    receipt.sdkToolPartCount = engineMessages.flatMap(message => message.parts).filter(part => part.type === 'tool').length;
    phase = 'read rendered run history';
    await reloadOwnedScheduleCatalog(page, `Bearer ${token}`);
    await page.getByTestId(`schedule-${enabledId}`).click();
    receipt.uiProgress = await page.getByTestId('schedule-progress').innerText();
    if (run) {
      await expect(page.getByTestId(`schedule-run-${run.id}`)).toBeVisible();
      receipt.uiRun = await page.getByTestId(`schedule-run-${run.id}`).innerText();
      if (rootId) {
        await page.getByTestId(`schedule-run-${run.id}`).click();
        await expect(page).toHaveURL(/agents/);
        receipt.uiOpenedRoot = page.url();
        expect(page.url()).toContain(rootId);
      }
    }
    const localInputCount = rootBody?.messages.filter(message => (message as { role?: string }).role === 'input').length ?? 0;
    const localOutputCount = rootBody?.messages.filter(message => (message as { role?: string }).role === 'output').length ?? 0;
    receipt.localInputCount = localInputCount;
    receipt.localOutputCount = localOutputCount;
    const dispatchedOnce = runs.length === 1 && run?.status === 'completed_no_op'
      && Boolean(run?.endedAt) && Boolean(rootId)
      && Date.parse(run!.startedAt) >= Date.parse(runAt)
      && completedAssistant?.info.providerID === 'openai' && completedAssistant?.info.modelID === 'gpt-6-luna'
      && answer === '19' && inputBound && outputBound && receipt.sdkToolPartCount === 0
      && localInputCount === 1 && localOutputCount === 1
      && (receipt.enabledRoots as unknown[]).length === 1
      && (receipt.disabledRuns as unknown[]).length === 0
      && (receipt.disabledRoots as unknown[]).length === 0
      && (receipt.disabledTask as Schedule).lastRunAt === null
      && (receipt.disabledTask as Schedule).lastRunStatus === null
      && (receipt.disabledTask as Schedule).nextRunAt === runAt
      && String(receipt.uiRun).includes(run.status)
      && receipt.manualTriggers === 0;
    receipt.status = dispatchedOnce ? 'observed' : 'unverified';
    if (!dispatchedOnce) throw new Error('UNVERIFIED: natural tick, Luna answer, SDK/local/UI linkage, or disabled control differed');
  } catch (error) {
    primaryError = error;
  } finally {
    page.off('request', onRequest);
    const exactRows = new Map<'disabled' | 'enabled', Schedule>();
    // Disable every exact owned row first, even when Recon failed. Retain the
    // fixture if a run is active or attribution is uncertain.
    for (const kind of ['disabled', 'enabled'] as const) {
      try {
        const matches = owned().filter(row => row.name === names[kind] && row.prompt === prompts[kind]);
        if (matches.length > 1) throw new Error('multiple exact-nonce rows; retaining fixture');
        const id = matches[0]?.id as string | undefined;
        if (!id) continue;
        if (created.get(kind)?.id && created.get(kind)!.id !== id)
          throw new Error('acknowledgement and local row disagree; retaining fixture');
        const current = await api.json<Schedule>(`/agent-schedules/${id}`);
        if (current.name !== names[kind] || current.prompt !== prompts[kind]
          || current.createdByUserId !== manifest.ownerUserId
          || matches[0].schedule_type !== 'once')
          throw new Error('ownership changed; retaining fixture');
        if (current.enabled) {
          const stopped = await api.fetch(`/agent-schedules/${id}`, { method: 'PATCH',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
          if (stopped.status !== 200) throw new Error(`disable returned ${stopped.status}`);
        }
        const stopped = await api.json<Schedule>(`/agent-schedules/${id}`);
        if (stopped.enabled) throw new Error('schedule remained enabled');
        exactRows.set(kind, stopped);
        if (['queued', 'running'].includes(stopped.lastRunStatus ?? ''))
          throw new Error('run still active; retaining fixture');
      } catch (error) { cleanupErrors.push(`${kind}: ${String(error)}`); }
    }
    if (receipt.status !== 'observed') cleanupErrors.push('natural execution unverified; retaining fixture evidence');
    // Verify the schedule/run/root association while the schedule FK still
    // exists. DELETE schedule would SET NULL on agent_sessions.scheduled_task_id
    // and cascade its run history, erasing the cleanup authority.
    if (!cleanupErrors.length) {
      try {
        const positive = exactRows.get('enabled');
        const negative = exactRows.get('disabled');
        if (!positive || !negative || positive.agentConfigId !== 'coding-agent'
          || negative.agentConfigId !== 'coding-agent'
          || positive.modelProvider !== 'openai' || negative.modelProvider !== 'openai'
          || positive.modelId !== 'gpt-6-luna' || negative.modelId !== 'gpt-6-luna')
          throw new Error('private schedule bindings differ');
        const runs = await api.json<Run[]>(`/agent-schedules/${positive.id}/runs`);
        const negativeRuns = await api.json<Run[]>(`/agent-schedules/${negative.id}/runs`);
        const roots = rootRows(positive.id);
        if (runs.length !== 1 || !runs[0].endedAt || !runs[0].rootSessionId
          || roots.length !== 1 || roots[0].id !== runs[0].rootSessionId
          || (rootId && rootId !== roots[0].id)
          || negativeRuns.length !== 0 || rootRows(negative.id).length !== 0)
          throw new Error('run/root association differs; retaining fixture');
        rootId = String(roots[0].id);
        if (roots[0].owner_user_id !== manifest.ownerUserId
          || roots[0].category !== 'scheduled' || roots[0].profile_id !== 'coding-agent'
          || roots[0].scheduled_task_id !== positive.id || roots[0].cwd !== apiResourceCwd)
          throw new Error('root owner/category/profile/schedule/cwd mismatch; retaining fixture');
        const removed = await api.fetch(`/agent-sessions/${rootId}/hard`, { method: 'DELETE' });
        if (removed.status !== 204) throw new Error(`root hard-delete returned ${removed.status}`);
        if (localRows('SELECT id FROM agent_sessions WHERE id=?', rootId).length) throw new Error('root remains');
      } catch (error) { cleanupErrors.push(`root: ${String(error)}`); }
    }
    if (!cleanupErrors.length) {
      for (const kind of ['disabled', 'enabled'] as const) {
        try {
          const row = exactRows.get(kind)!;
          if (localRows('SELECT id FROM agent_scheduled_tasks WHERE id=? AND name=? AND prompt=? AND created_by_user_id=?',
            row.id, names[kind], prompts[kind], manifest.ownerUserId).length !== 1)
            throw new Error('local owner row mismatch; retaining fixture');
          const deleted = await api.fetch(`/agent-schedules/${row.id}`, { method: 'DELETE' });
          if (deleted.status !== 204) throw new Error(`delete returned ${deleted.status}`);
          if (localRows('SELECT id FROM agent_scheduled_tasks WHERE id=?', row.id).length)
            throw new Error('schedule remains after DELETE');
        } catch (error) { cleanupErrors.push(`${kind}: ${String(error)}`); }
      }
    }
    try {
      receipt.bundleHashesAfter = { identity: sha256(identityPath), server: sha256(serverPath) };
      if (JSON.stringify(receipt.bundleHashesAfter) !== JSON.stringify(bundleHashes))
        cleanupErrors.push('packaged API bundle hashes changed');
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 60_000 });
      receipt.codeDirectoryHashAfter = signatureHash(app);
      if (receipt.codeDirectoryHashAfter !== codeDirectoryHash)
        cleanupErrors.push('packaged app CodeDirectory hash changed');
    } catch (error) { cleanupErrors.push(`bundle signature check: ${String(error)}`); }
    receipt.cleanupErrors = cleanupErrors;
    try { await testInfo.attach('natural-once-sanitized-summary', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({
        sourceRevision: expectedRevision,
        phase,
        primaryErrorName: primaryError instanceof Error ? primaryError.name : primaryError === undefined ? null : typeof primaryError,
        observed: receipt.status === 'observed',
        manualTriggers: receipt.manualTriggers,
        runStatus: (receipt.enabledRuns as Run[] | undefined)?.[0]?.status ?? null,
        enabledRunCount: (receipt.enabledRuns as Run[] | undefined)?.length ?? null,
        disabledRunCount: (receipt.disabledRuns as Run[] | undefined)?.length ?? null,
        answer: receipt.answer ?? null,
        sdkToolPartCount: receipt.sdkToolPartCount ?? null,
        localInputBoundToSdkUser: receipt.localInputBoundToSdkUser ?? false,
        localOutputBoundToSdkAssistant: receipt.localOutputBoundToSdkAssistant ?? false,
        bundleHashesUnchanged: JSON.stringify(receipt.bundleHashesAfter) === JSON.stringify(bundleHashes),
        codeDirectoryHashUnchanged: receipt.codeDirectoryHashAfter === codeDirectoryHash,
        cleanupPassed: cleanupErrors.length === 0,
      }, null, 2) + '\n'),
    }); } catch (error) { cleanupErrors.push(`summary attachment: ${String(error)}`); }
    receipt.cleanupErrors = cleanupErrors;
  }
  // A cleanup failure is still recorded in the sanitized attachment. Preserve
  // the original assertion/transport error and stack when the body failed.
  if (primaryError !== undefined) throw primaryError;
  expect(cleanupErrors, 'strict nonce-owned cleanup').toEqual([]);
});
