import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test as unverified, type Page } from '@playwright/test';
import { test, expect, API, ENGINE, ObservedApi, OwnedRecords, expectedRevision, localRows, responseFor } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const title = '[AI MCP] private profile scopes allow owned task calls and deny forbidden canonical calls';
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Json = Record<string, any>;
type Kind = 'inherited' | 'selected' | 'none';
type Profile = { kind: Kind; id: string; label: string };
type ToolPart = { tool?: string; state?: { status?: string; input?: Json; output?: unknown; error?: unknown } };
type SdkMessage = { info: { id: string; role: string; parentID?: string; finish?: string; providerID?: string;
  modelID?: string; time?: { completed?: number } }; parts: Array<ToolPart & { type: string; text?: string }> };

async function request(api: ObservedApi, route: string, init?: RequestInit) {
  const response = await api.fetch(route, init);
  return { status: response.status, body: await response.json().catch(() => null) as Json | null };
}

async function group(page: Page, name: string) {
  const choice = page.getByTestId('settings-column-groups').getByRole('option', { name, exact: true, includeHidden: true });
  for (let n = 0; n < 4 && !(await choice.isVisible()); n++) {
    const back = page.locator('.column-browser-back:visible').first();
    if (!(await back.count())) break;
    await back.click();
  }
  await choice.click();
  await expect(choice).toHaveAttribute('aria-selected', 'true');
}

async function waitTurn(sdkId: string, cwd: string, prompt: string, deadline: number) {
  let messages: SdkMessage[] = [];
  let user: SdkMessage | undefined;
  let assistants: SdkMessage[] = [];
  let terminalIdle = false;
  while (Date.now() < deadline) {
    const response = await fetch(`${ENGINE}/session/${encodeURIComponent(sdkId)}/message?directory=${encodeURIComponent(cwd)}&limit=100`,
      { signal: AbortSignal.timeout(10_000) });
    expect(response.status).toBe(200);
    messages = await response.json() as SdkMessage[];
    const matchingUsers = messages.filter(item => item.info.role === 'user'
      && item.parts.some(part => part.type === 'text' && part.text === prompt));
    user = matchingUsers.length === 1 ? matchingUsers[0] : undefined;
    assistants = user ? messages.filter(item => item.info.role === 'assistant' && item.info.parentID === user!.info.id)
      .sort((a, b) => a.info.id.localeCompare(b.info.id)) : [];
    const last = assistants.at(-1);
    if (last?.info.time?.completed && last.info.finish && last.info.finish !== 'tool-calls'
      && assistants.every(item => item.info.time?.completed && item.parts.every(part => part.type !== 'tool'
        || ['completed', 'error'].includes(part.state?.status ?? '')))) {
      const status = await fetch(`${ENGINE}/session/status?directory=${encodeURIComponent(cwd)}`,
        { signal: AbortSignal.timeout(10_000) });
      expect(status.status).toBe(200);
      const states = await status.json() as Record<string, { type?: string }>;
      if ((states[sdkId]?.type ?? 'idle') === 'idle') {
        terminalIdle = true;
        break;
      }
    }
    await pause(1250);
  }
  const last = assistants.at(-1);
  expect(messages.filter(item => item.info.role === 'user'
    && item.parts.some(part => part.type === 'text' && part.text === prompt)),
  'one SDK user message must correspond to this UI prompt').toHaveLength(1);
  expect(user, 'the real SDK user message must match this UI send').toBeDefined();
  expect(terminalIdle, 'the engine must return to idle before this turn counts').toBe(true);
  expect(last?.info.time?.completed, 'the complete parent-linked turn must finish').toBeTruthy();
  expect(last?.info.finish).toBe('stop');
  expect(assistants.length).toBeGreaterThan(0);
  for (const message of assistants) {
    expect(message.info.time?.completed).toBeTruthy();
    expect(message.info.providerID).toBe('openai');
    expect(message.info.modelID).toBe('gpt-6-luna');
  }
  const tools = assistants.flatMap(item => item.parts.filter(part => part.type === 'tool'));
  expect(tools.every(part => part.tool === 'mcp_dispatch'), 'no unrelated SDK tool may execute in this scoped turn').toBe(true);
  return { user: user!, tools };
}

function exactExecution(parts: ToolPart[], name: string) {
  return parts.filter(part => part.tool === 'mcp_dispatch' && part.state?.input?.action === 'execute'
    && part.state.input.name === name);
}

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page, packaged }) => {
  test.setTimeout(390_000);
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: explicit bounded model opt-in required').toBe('1');
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor).toBeDefined();
  expect(manifest.publicUserSeed.email).toMatch(/@qualification\.invalid$/);
  const root = realpathSync(manifest.fixtureRoot);
  const rootStat = lstatSync(root);
  expect(root.startsWith('/private/tmp/') && !rootStat.isSymbolicLink()
    && typeof process.getuid === 'function' && rootStat.uid === process.getuid()
    && (rootStat.mode & 0o777) === 0o700).toBe(true);
  const loan = manifest.syntheticActor.modelLoan;
  const now = Date.now();
  expect(Number.isSafeInteger(loan?.issuedAt) && Number.isSafeInteger(loan?.expires) && Number.isSafeInteger(loan?.stopAt)
    && loan.issuedAt <= now && loan.stopAt > now + 390_000 && loan.stopAt <= loan.issuedAt + 600_000
    && loan.stopAt <= loan.expires - 1_200_000,
  'UNVERIFIED: four turns require the live exact-fixture loan with at least 390 seconds remaining').toBe(true);
  const hardStop = Math.min(now + 330_000, loan.stopAt - 30_000);
  const embedded = JSON.parse(readFileSync(path.join(packaged.appPath, 'Contents/Resources/api_server/build-identity.json'), 'utf8')) as Json;
  expect(embedded.sourceRevision).toBe(expectedRevision);
  expect(manifest.sourceRevision).toBe(expectedRevision);
  const token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  const me = await request(api, '/auth/me');
  expect(me).toMatchObject({ status: 200, body: { user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email } } });
  const nativeOwner = await page.evaluate(async () => {
    const shell = (window as unknown as { rhythmShell: { auth: {
      currentSession(): Promise<{ user: { id: number } } | null> } } }).rhythmShell;
    return (await shell.auth.currentSession())?.user.id ?? null;
  });
  expect(nativeOwner).toBe(manifest.ownerUserId);
  const engineHealth = await fetch(`${ENGINE}/global/health`, { signal: AbortSignal.timeout(10_000) });
  expect(engineHealth.status).toBe(200);
  expect((await engineHealth.json() as Json).version).toBe(`0.0.0-rhythm-${expectedRevision}`);

  const nonce = `mcp-profile-scope-${randomUUID()}`;
  const prefix = `[smoke] ${nonce} `;
  const profiles: Profile[] = [];
  let task: { id: string; title: string } | undefined;
  let sessions: OwnedRecords | undefined;
  let cwd: string | undefined;
  const cleanupErrors: string[] = [];
  try {
    // Actual first-boot CDP attach can precede auth restoration. Observe its
    // normal renderer ensure acknowledgment, then remount Profiles and Refresh.
    await page.goto('rhythm://app/index.html#/tools/agent-tools');
    const ensurePending = responseFor(page, 'POST', '/opencode/mcp/rhythm/ensure');
    await page.reload();
    const ensure = await ensurePending;
    expect(ensure.status()).toBe(200);
    expect(ensure.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(await ensure.json()).toMatchObject({ registered: true });
    const servers = await request(api, '/opencode/mcp');
    expect(servers.status).toBe(200);
    expect(servers.body).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'rhythm', status: 'connected',
      tools: expect.arrayContaining(['rhythm_list_tasks', 'rhythm_ping']) })]));
    expect((servers.body as Json[]).find(item => item.name === 'rhythm')?.tools).toHaveLength(114);
    const engineCatalog = await fetch(`${ENGINE}/mcp/tools`, { signal: AbortSignal.timeout(10_000) });
    expect(engineCatalog.status).toBe(200);
    const toolIds = await engineCatalog.json() as string[];
    expect(toolIds).toHaveLength(114);
    expect(toolIds).toEqual(expect.arrayContaining(['rhythm_rhythm_list_tasks', 'rhythm_rhythm_ping']));

    await page.goto('rhythm://app/index.html#/profiles');
    await page.getByTestId('profiles-workspace').waitFor({ state: 'visible' });
    const profileRead = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    expect((await profileRead).status()).toBe(200);
    await group(page, 'MCPs');
    const catalogPending = responseFor(page, 'GET', '/opencode/mcp');
    await page.getByTestId('profile-resync').click();
    const catalog = await catalogPending;
    expect(catalog.status()).toBe(200);
    expect((await catalog.json() as Json[]).find(item => item.name === 'rhythm')?.tools).toHaveLength(114);
    await group(page, 'MCPs');
    await page.getByTestId('profile-mcp-filter').fill('rhythm_list_tasks');
    await expect(page.getByTestId('mcp-rhythm-rhythm_list_tasks')).toBeVisible();
    for (const mode of ['all', 'selected', 'none']) await expect(page.getByTestId(`profile-mcp-mode-${mode}`)).toBeVisible();
    const models = await request(api, '/agents/models/catalog/full');
    expect(models.status).toBe(200);
    const luna = (models.body as Json[]).find(item => item.provider === 'openai' && item.modelId === 'gpt-6-luna');
    if (!luna) throw new Error('UNVERIFIED: live authorized Luna catalog entry is missing');
    expect(luna.authorized).toBe(true);
    if (!luna.visible) {
      const visible = await request(api, '/agent-models/visibility', { method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates: [{ provider: 'openai', modelId: 'gpt-6-luna', visible: true }] }) });
      expect(visible.status).toBe(200);
    }
    const decision = await request(api, '/agent-decisions/config');
    expect(decision).toMatchObject({ status: 200, body: { catalog: { source: 'live' } } });
    expect(decision.body?.catalog?.models).toEqual(expect.arrayContaining([expect.objectContaining({
      providerID: 'openai', modelID: 'gpt-6-luna', enabled: true })]));
    expect(hardStop - Date.now(), 'UNVERIFIED: setup consumed the bounded model loan').toBeGreaterThan(300_000);
    await page.reload();
    await page.getByTestId('profile-create').waitFor({ state: 'visible' });

    for (const [kind, mode] of [['inherited', 'all'], ['selected', 'selected'], ['none', 'none']] as const) {
      const label = `${prefix}${kind}`;
      await page.getByTestId('profile-create').click();
      await group(page, 'Identity & instructions');
      await page.getByTestId('profile-label').fill(label);
      await group(page, 'Provider, model & account');
      await page.getByTestId('profile-provider').selectOption('openai');
      await page.getByTestId('profile-model').selectOption('gpt-6-luna');
      await group(page, 'Availability & defaults');
      await page.getByTestId('profile-enabled').check();
      await page.getByTestId('profile-selectable').check();
      await group(page, 'Permissions');
      if (!await page.getByTestId('profile-permissions').isVisible())
        await page.getByText('Advanced (JSON)', { exact: true }).click();
      await page.getByTestId('profile-permissions').fill(JSON.stringify({ rhythm_rhythm_list_tasks: 'allow' }));
      await group(page, 'MCPs');
      if (mode === 'all') await page.getByTestId('profile-mcp-mode-all').check();
      if (mode === 'none') await page.getByTestId('profile-mcp-mode-none').check();
      if (mode === 'selected') {
        await page.getByTestId('profile-mcp-mode-none').check();
        await page.getByTestId('profile-mcp-mode-selected').check();
        await page.getByTestId('profile-mcp-filter').fill('rhythm_list_tasks');
        await page.getByTestId('mcp-rhythm-rhythm_list_tasks').check();
      }
      const saved = responseFor(page, 'POST', '/agent-configs');
      await page.getByTestId('profile-save').click();
      const response = await saved;
      expect(response.status()).toBe(201);
      const body = await response.json() as Json;
      expect(body).toMatchObject({ label, id: expect.any(String) });
      profiles.push({ kind, id: body.id, label });
      const detail = await request(api, `/agent-configs/${encodeURIComponent(body.id)}`);
      expect(detail.status).toBe(200);
      const sql = localRows('SELECT id,label,allowed_mcps_json,core_permissions_json,model_provider,model_id,enabled,session_selectable FROM agent_configs WHERE id=?', body.id);
      expect(sql).toHaveLength(1);
      expect(sql[0]).toMatchObject({ id: body.id, label, allowed_mcps_json: detail.body?.allowedMcpsJson,
        core_permissions_json: detail.body?.corePermissionsJson, model_provider: 'openai', model_id: 'gpt-6-luna', enabled: 1, session_selectable: 1 });
      const expectedPolicy = mode === 'all' ? null : mode === 'none' ? [] : { rhythm: ['rhythm_list_tasks'] };
      expect(detail.body?.allowedMcpsJson === null ? null : JSON.parse(detail.body!.allowedMcpsJson)).toEqual(expectedPolicy);
      expect(JSON.parse(detail.body?.corePermissionsJson ?? '{}')).toMatchObject({ rhythm_rhythm_list_tasks: 'allow' });
      await page.getByTestId('profile-mcp-filter').fill('');
    }

    const taskTitle = `${prefix}task`;
    const createdTask = await request(api, '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: taskTitle }) });
    expect(createdTask).toMatchObject({ status: 201, body: { id: expect.any(String), title: taskTitle } });
    task = { id: createdTask.body!.id, title: taskTitle };
    expect(await request(api, `/tasks/${encodeURIComponent(task.id)}`)).toMatchObject({ status: 200, body: { id: task.id, title: task.title } });
    expect(localRows('SELECT id,title FROM tasks WHERE id=?', task.id)).toMatchObject([{ id: task.id, title: task.title }]);

    sessions = new OwnedRecords(page, 'sessions', nonce);
    cwd = path.join(root, `${nonce}-cwd`);
    mkdirSync(cwd, { mode: 0o700 });
    expect(realpathSync(cwd)).toBe(cwd);
    expect(path.relative(root, cwd).startsWith('..')).toBe(false);
    sessions.directory = cwd;
    await sessions.open();
    const cases = [
      { name: 'inherited', profile: 'inherited', tool: 'rhythm_rhythm_list_tasks', denied: false },
      { name: 'selected-allow', profile: 'selected', tool: 'rhythm_rhythm_list_tasks', denied: false },
      { name: 'selected-deny', profile: 'selected', tool: 'rhythm_rhythm_ping', denied: true },
      { name: 'none-explicit-empty', profile: 'none', tool: 'rhythm_rhythm_list_tasks', denied: true },
    ] as const;
    for (const item of cases) {
      expect(hardStop - Date.now(), 'UNVERIFIED: remaining loan cannot fit one bounded turn').toBeGreaterThan(70_000);
      const profile = profiles.find(value => value.kind === item.profile)!;
      await sessions.prepare(` ${item.name}`);
      await page.getByTestId('advanced-profile').selectOption(profile.id);
      const created = responseFor(page, 'POST', '/agent-sessions');
      await page.getByTestId('advanced-create').click();
      const response = await created;
      expect(response.status()).toBe(201);
      const createdSession = await response.json() as Json;
      expect(createdSession).toMatchObject({ id: expect.any(String), profileId: profile.id });
      if (typeof createdSession.id !== 'string' || typeof createdSession.name !== 'string'
        || typeof createdSession.profileId !== 'string')
        throw new Error('UNVERIFIED: created SDK session lacks an owned ID, name or profile');
      const session = { id: createdSession.id, name: createdSession.name, profileId: createdSession.profileId };
      expect(sessions.owns(session.name)).toBe(true);
      sessions.remember(session);
      await page.getByTestId(`session-${session.id}`).click();
      await page.getByTestId('session-actions').click();
      await page.getByTestId('composer-model').selectOption('openai/gpt-6-luna');
      const pinned = responseFor(page, 'PATCH', `/agent-sessions/${session.id}`);
      await page.getByTestId('model-session-default').click();
      expect((await pinned).status()).toBe(200);
      const query = 'SELECT id,profile_id,cwd,model_mode,provider_id,model_id,mcp_role,mcp_allowed_tools_json,sdk_session_id FROM agent_sessions WHERE id=?';
      const before = localRows(query, session.id)[0];
      expect(before).toMatchObject({ id: session.id, profile_id: profile.id, cwd, model_mode: 'fixed', provider_id: 'openai', model_id: 'gpt-6-luna' });
      const rawTool = item.tool === 'rhythm_rhythm_ping' ? 'rhythm_ping' : 'rhythm_list_tasks';
      const diagnostic = { action: 'execute', family: 'mcp', name: item.tool,
        arguments: rawTool === 'rhythm_ping' ? {} : { id: task.id } };
      const prompt = item.denied
        ? `${prefix}${item.name}: Read-only permission diagnostic. Make exactly one mcp_dispatch call with this exact input: ${JSON.stringify(diagnostic)}. Do not search or describe first. Report the tool result or error. No other tools or writes.`
        : `${prefix}${item.name}: Call only rhythm_list_tasks through mcp_dispatch with id ${task.id}. Report the exact title of that task. No other tools or writes.`;
      await page.getByTestId('composer-input').fill(prompt);
      await page.getByTestId('composer-send').click();
      const sdkId = String(before.sdk_session_id ?? '');
      expect(sdkId).toMatch(/^ses_/);
      const turn = await waitTurn(sdkId, cwd, prompt, Math.min(Date.now() + 55_000, hardStop));
      const after = localRows(query, session.id)[0];
      if (!after) throw new Error('UNVERIFIED: created session row disappeared after the turn');
      const policy = item.profile === 'inherited' ? null : item.profile === 'none' ? [] : { rhythm: ['rhythm_list_tasks'] };
      expect(after).toMatchObject({ id: session.id, profile_id: profile.id, cwd, model_mode: 'fixed', provider_id: 'openai',
        model_id: 'gpt-6-luna', sdk_session_id: sdkId, mcp_role: item.profile === 'inherited' ? null : profile.id,
      });
      const rawPolicy = after.mcp_allowed_tools_json;
      if (rawPolicy !== null && typeof rawPolicy !== 'string')
        throw new Error('UNVERIFIED: session MCP policy is neither inherited nor serialized JSON');
      expect(rawPolicy === null ? null : JSON.parse(rawPolicy)).toEqual(policy);
      expect((await request(api, `/agent-sessions/${encodeURIComponent(session.id)}`)).status).toBe(200);
      const provenance = await request(api, `/agent-sessions/${encodeURIComponent(session.id)}/model-provenance`);
      expect(provenance.status).toBe(200);
      expect(provenance.body?.servedModels).toContain('gpt-6-luna');
      expect(provenance.body?.dispatches).toHaveLength(1);
      expect(provenance.body?.dispatches[0]).toMatchObject({
        sdkUserMessageId: turn.user.info.id, requestedSource: 'turn_override', finalProviderId: 'openai',
        finalModelId: 'gpt-6-luna', outcome: 'accepted' });
      expect(localRows('SELECT id FROM agent_router_grid_attempts WHERE session_id=?', session.id),
        'the fixed-Luna MCP turn must not create a Grid attempt').toEqual([]);
      const executed = exactExecution(turn.tools, item.tool);
      expect(executed, `${item.name}: actual SDK canonical tool execution missing`).toHaveLength(1);
      const part = executed[0];
      expect(part.state?.input?.family ?? 'mcp').toBe('mcp');
      if (item.denied) {
        expect(part.state?.status).toBe('error');
        const diagnosticText = JSON.stringify([part.state?.output ?? null, part.state?.error ?? null]);
        expect(/MCP tool [^\n]*? (?:is not|is no longer) permitted for this session's allowlist\./.test(diagnosticText)).toBe(true);
        expect(diagnosticText).not.toContain(task.id);
        expect(diagnosticText).not.toContain(task.title);
        expect(turn.tools.some(value => value.state?.status === 'completed' && value.state.input?.action === 'execute'
          && value.state.input?.name === item.tool)).toBe(false);
      } else {
        expect(part.state?.status).toBe('completed');
        expect(part.state?.input?.arguments?.id).toBe(task.id);
        const output = JSON.stringify(part.state?.output ?? null);
        expect(output).toContain(task.id);
        expect(output).toContain(task.title);
      }
      expect(turn.tools.filter(value => value.state?.input?.action === 'execute')).toHaveLength(1);
      // A served answer alone is not permission evidence. The assertions above
      // require an actual SDK mcp_dispatch part linked to this exact UI turn.
    }
  } finally {
    // Exact owned deletion order. If ownership or an earlier cleanup fails,
    // retain later resources for inspection instead of broad deletion.
    let sessionsClean = true, profilesClean = true, taskClean = true;
    if (sessions) try { await sessions.cleanup({ keepDirectory: true }); }
      catch (error) { sessionsClean = false; cleanupErrors.push(`sessions: ${String(error)}`); }
    if (sessionsClean) try {
      const list = await api.json<Json[]>('/agent-configs');
      for (const row of list.filter(item => typeof item.label === 'string' && item.label.startsWith(prefix))) {
        const owned = profiles.find(item => item.id === row.id && item.label === row.label);
        expect(owned, 'refuse foreign profile under nonce prefix').toBeDefined();
        const detail = await request(api, `/agent-configs/${encodeURIComponent(row.id)}`);
        expect(detail).toMatchObject({ status: 200, body: { id: row.id, label: row.label } });
        expect((await api.fetch(`/agent-configs/${encodeURIComponent(row.id)}`, { method: 'DELETE' })).status).toBe(204);
        expect(localRows('SELECT id FROM agent_configs WHERE id=?', row.id)).toEqual([]);
        const remaining = await api.json<Json[]>('/agent-configs');
        expect(remaining.some(item => item.id === row.id), 'deleted owned profile remains in the normal API list').toBe(false);
      }
      expect(localRows('SELECT id FROM agent_configs WHERE label LIKE ?', `${prefix}%`)).toEqual([]);
    } catch (error) { profilesClean = false; cleanupErrors.push(`profiles: ${String(error)}`); }
    if (sessionsClean && profilesClean && task) try {
      const detail = await request(api, `/tasks/${encodeURIComponent(task.id)}`);
      expect(detail).toMatchObject({ status: 200, body: { id: task.id, title: task.title } });
      expect((await api.fetch(`/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' })).status).toBe(204);
      expect(localRows('SELECT id FROM tasks WHERE id=?', task.id)).toEqual([]);
      const listed = await api.json<Json[]>('/tasks?status=all');
      expect(listed.some(item => item.id === task!.id)).toBe(false);
    } catch (error) { taskClean = false; cleanupErrors.push(`task: ${String(error)}`); }
    if (sessionsClean && profilesClean && taskClean && cwd) try {
      expect(realpathSync(cwd)).toBe(cwd);
      expect(lstatSync(cwd).isSymbolicLink()).toBe(false);
      expect(path.relative(root, cwd).startsWith('..')).toBe(false);
      rmSync(cwd, { recursive: true });
    } catch (error) { cleanupErrors.push(`cwd: ${String(error)}`); }
    expect(cleanupErrors, 'exact nonce-owned MCP scope cleanup must complete').toEqual([]);
  }
});
