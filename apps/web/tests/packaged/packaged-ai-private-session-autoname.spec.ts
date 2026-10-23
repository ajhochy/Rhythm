import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { test as rawTest } from '@playwright/test';
import { test, expect, API, ENGINE, ObservedApi, expectedRevision, localRows } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Session = { id: string; name: string; cwd: string; profileId: string | null; sdkSessionId: string | null;
  ownerUserId: number; parentSessionId: string | null; modelMode?: string };
type Detail = { session: Session; messages: Array<{ role: string; rawText: string; sdkMessageId?: string }> };
type History = { sessions: Session[] };
type EngineMessage = { info: { id: string; role: string; parentID?: string; providerID?: string; modelID?: string;
  time?: { completed?: number } }; parts: Array<{ type: string; text?: string }> };
type EngineSession = { id: string; title: string; directory: string; parentID?: string };
type CatalogModel = { provider: string; modelId: string; visible: boolean; authorized: boolean };
type Profile = { id: string; label: string; revision: number; systemPrompt: string | null;
  corePermissionsJson: string | null; allowedMcpsJson: string | null; allowedSkillsJson: string | null;
  modelProvider: string | null; modelId: string | null };
type ProjectedAgent = { name: string; mode: string; prompt?: string;
  model?: { providerID: string; modelID: string };
  permission?: Array<{ permission: string; pattern: string; action: string }> };
type ProjectedRule = NonNullable<ProjectedAgent['permission']>[number];
type EngineConfig = { small_model?: unknown };
type TitleAgent = { name: string; hidden?: boolean; model?: { providerID: string; modelID: string } };

function hasEffectiveNoToolsBoundary(rules: ProjectedRule[], fixtureRoot: string) {
  // The engine evaluates the last matching ordered rule. The only later
  // allow is its fixture-owned external-directory tool-output truncation.
  let lastWildcard = -1;
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    if (rules[index].permission === '*') { lastWildcard = index; break; }
  }
  if (lastWildcard < 0 || rules[lastWildcard].pattern !== '*' || rules[lastWildcard].action !== 'deny')
    return false;
  const truncateOutput = path.join(fixtureRoot, 'xdg-data', 'opencode', 'tool-output', '*');
  return rules.slice(lastWildcard + 1).every(rule => rule.action === 'deny'
    || (rule.permission === 'external_directory' && rule.pattern === truncateOutput && rule.action === 'allow'));
}

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI sessions] one private untitled real turn generates a durable visible session name';
const observation: Record<string, unknown> = { schemaVersion: 1, phase: 'loaded', status: 'UNRUN' };
const placeholders = /^(|Untitled chat|Untitled session|Resumed|New session|(New|Child) session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;

function sessionRows(id: string) {
  return localRows('SELECT id,name,cwd,profile_id,sdk_session_id,owner_user_id,parent_session_id FROM agent_sessions WHERE id=?', id);
}

if (!manifestPath) {
  // This branch never requests a packaged page or launches the saved operator profile.
  rawTest(title, () => { throw new Error('UNVERIFIED: exact private synthetic actor/model loan manifest required'); });
} else {
  test(title, async ({ page, sessions }, testInfo) => {
    test.setTimeout(270_000);
    expect(process.env.RHYTHM_FEATURE_MODEL, 'bounded one-turn model opt-in required').toBe('1');
    const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
    expect(manifest.syntheticActor, 'only the wholly disposable actor is allowed').toBeDefined();
    expect(manifest.publicUserSeed.email).toMatch(/\.invalid$/);
    const fixtureRoot = realpathSync(manifest.fixtureRoot);
    const rootStat = lstatSync(fixtureRoot);
    expect(fixtureRoot.startsWith('/private/tmp/') && !rootStat.isSymbolicLink()
      && typeof process.getuid === 'function' && rootStat.uid === process.getuid()
      && (rootStat.mode & 0o777) === 0o700,
    'only an owner-private canonical disposable fixture may be used').toBe(true);
    const loan = manifest.syntheticActor!.modelLoan as { issuedAt: number; stopAt: number; expires: number } | undefined;
    expect(loan, 'bounded model loan required').toBeDefined();
    const started = Date.now();
    expect(Number.isSafeInteger(loan!.issuedAt) && Number.isSafeInteger(loan!.stopAt)
      && Number.isSafeInteger(loan!.expires)).toBe(true);
    expect(loan!.issuedAt).toBeLessThanOrEqual(started);
    expect(loan!.stopAt - loan!.issuedAt).toBeLessThanOrEqual(600_000);
    expect(loan!.stopAt).toBeLessThanOrEqual(loan!.expires - 1_200_000);
    expect(loan!.stopAt - started, 'loan too near hard stop').toBeGreaterThan(250_000);
    observation.phase = 'private-loan-validated';
    observation.productRevision = manifest.sourceRevision;
    observation.ownerUserId = manifest.ownerUserId;

    // A newly created cwd is the immutable ownership anchor even after the
    // engine replaces the blank session name with an arbitrary generated title.
    const nonce = randomUUID();
    const cwd = path.join(fixtureRoot, `autoname-${nonce}`);
    let id = '';
    let sdkId = '';
    let createdName = '';
    let originalProfile: Profile | null = null;
    let originalLunaVisible: boolean | null = null;
    let profilePatched = false;
    let visibilityPatched = false;
    let primaryError: unknown;
    mkdirSync(cwd, { mode: 0o700 });
    const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
    const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
    try {
      expect(localRows('SELECT id FROM agent_sessions WHERE cwd=?', cwd)).toEqual([]);
      await sessions.open();
      expect(sessions.api?.origin).toBe(API);
      const actor = await api.json<{ user: { id: number; email: string } }>('/auth/me');
      expect(actor.user).toMatchObject({ id: manifest.ownerUserId, email: manifest.publicUserSeed.email });
      observation.phase = 'private-auth-and-empty-cwd-confirmed';

      // The synthetic seed starts with model visibility hidden. Opt in only
      // the reviewed fixed Luna model through the normal private API; do not
      // alter the hidden engine title agent or the managed small-model route.
      const coldCatalog = await api.json<CatalogModel[]>('/agents/models/catalog/full');
      const coldLuna = coldCatalog.find(row => row.provider === 'openai' && row.modelId === 'gpt-6-luna');
      expect(coldLuna)
        .toMatchObject({ authorized: true });
      originalLunaVisible = coldLuna!.visible;
      const visible = await api.fetch('/agent-models/visibility', { method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates: [{ provider: 'openai', modelId: 'gpt-6-luna', visible: true }] }) });
      expect(visible.status).toBe(200);
      visibilityPatched = true;
      expect((await api.json<CatalogModel[]>('/agents/models/catalog/full'))
        .find(row => row.provider === 'openai' && row.modelId === 'gpt-6-luna'))
        .toMatchObject({ visible: true, authorized: true });
      const routerCatalog = await api.json<{ catalog?: { source?: string;
        models?: Array<{ providerID: string; modelID: string; enabled: boolean }> } }>('/agent-decisions/config');
      expect(routerCatalog.catalog?.source).toBe('live');
      expect(routerCatalog.catalog?.models?.find(row => row.providerID === 'openai' && row.modelID === 'gpt-6-luna'))
        .toMatchObject({ enabled: true });
      observation.phase = 'private-luna-eligible';

      const profile = await api.json<Profile>('/agent-configs/coding-agent');
      originalProfile = profile;
      expect(profile.label).toMatch(/^\[smoke\]/);
      const noTools = '{"*":"deny","task":"deny","rhythm_delegate_async":"deny","image_generation":"deny"}';
      const arithmeticPrompt = 'Compute the arithmetic in the user prompt mentally. Do not use tools, read files, or access external data. Reply with digits only.';
      const denied = await api.fetch('/agent-configs/coding-agent', { method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: profile.revision, corePermissionsJson: noTools,
          allowedMcpsJson: '[]', allowedSkillsJson: '[]', systemPrompt: arithmeticPrompt,
          modelProvider: 'openai', modelId: 'gpt-6-luna' }) });
      expect(denied.status).toBe(200);
      profilePatched = true;
      const restricted = await api.json<Profile>('/agent-configs/coding-agent');
      expect(restricted).toMatchObject({ id: 'coding-agent', corePermissionsJson: noTools,
        allowedMcpsJson: '[]', allowedSkillsJson: '[]', modelProvider: 'openai', modelId: 'gpt-6-luna' });
      expect(realpathSync(path.join(manifest.fixtureRoot, 'xdg-data')))
        .toBe(path.join(manifest.fixtureRoot, 'xdg-data'));
      const projectionDeadline = Date.now() + 20_000;
      let projected: ProjectedAgent | undefined;
      while (Date.now() < projectionDeadline) {
        const agents = await api.json<{ agents: ProjectedAgent[] }>(
          `/agent-sessions/agents?full=1&cwd=${encodeURIComponent(cwd)}`);
        projected = agents.agents.find(agent => agent.name === 'coding-agent');
        const rules = projected?.permission ?? [];
        if (projected?.mode === 'all' && projected.prompt?.includes(arithmeticPrompt)
          && projected.model?.providerID === 'openai' && projected.model?.modelID === 'gpt-6-luna'
          && ['*', 'task', 'rhythm_delegate_async', 'image_generation'].every(permission =>
            rules.some(rule => rule.permission === permission && rule.pattern === '*' && rule.action === 'deny'))
          && hasEffectiveNoToolsBoundary(rules, manifest.fixtureRoot)) break;
        await page.waitForTimeout(500);
      }
      expect(projected).toMatchObject({ name: 'coding-agent', mode: 'all',
        prompt: expect.stringContaining(arithmeticPrompt),
        model: { providerID: 'openai', modelID: 'gpt-6-luna' } });
      for (const permission of ['*', 'task', 'rhythm_delegate_async', 'image_generation'])
        expect(projected!.permission).toContainEqual({ permission, pattern: '*', action: 'deny' });
      expect(hasEffectiveNoToolsBoundary(projected!.permission!, manifest.fixtureRoot)).toBe(true);
      observation.phase = 'live-no-tools-coding-profile-confirmed';

      // Normal create route, deliberately blank title; never inject a chosen
      // name or synthetic engine event. The UI drives the real user turn.
      const createdResponse = await api.fetch('/agent-sessions', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '', cwd, profileId: 'coding-agent', modelMode: 'fixed',
          isolateWorktree: false }) });
      expect(createdResponse.status, 'normal untitled create').toBe(201);
      const created = await createdResponse.json() as Session;
      id = created.id;
      sdkId = String(created.sdkSessionId ?? '');
      createdName = created.name;
      expect(id).toMatch(/^[a-f0-9-]{36}$/);
      expect(sdkId).toMatch(/^ses_/);
      expect(created).toMatchObject({ cwd, profileId: 'coding-agent', ownerUserId: manifest.ownerUserId,
        parentSessionId: null, modelMode: 'fixed' });
      expect(placeholders.test(createdName.trim()), 'the normal create must actually start untitled').toBe(true);
      observation.phase = 'untitled-normal-api-session-created';
      observation.sessionId = id;
      observation.sdkSessionId = sdkId;
      observation.initialName = createdName;

      await page.reload();
      await expect(page.getByTestId(`session-${id}`)).toBeVisible();
      await page.getByTestId(`session-${id}`).click();
      const prompt = `[smoke] autoname-${nonce}: Compute 17 + 25. Reply only with the digits. Do not use tools.`;
      expect(loan!.stopAt - Date.now(), 'loan too near stop before the single turn').toBeGreaterThan(190_000);
      await page.getByTestId('composer-input').fill(prompt);
      await page.getByTestId('composer-send').click();
      // Ordinary desktop sends over the authenticated session.input WebSocket,
      // so SDK/API persistence below, not an invented HTTP prompt route, proves admission.
      observation.phase = 'one-ui-prompt-submitted';
      await expect(page.getByTestId('transcript').getByText('42', { exact: true })).toBeVisible({ timeout: 150_000 });
      await expect(page.getByTestId('transcript').getByText(prompt, { exact: true })).toHaveCount(1);
      observation.phase = 'real-ui-answer-visible';

      const endpoint = `${ENGINE}/session/${encodeURIComponent(sdkId)}`;
      const deadline = Math.min(Date.now() + 70_000, loan!.stopAt - 25_000);
      let engine: EngineSession | null = null;
      let engineMessages: EngineMessage[] = [];
      let detail: Detail | null = null;
      while (Date.now() < deadline) {
        const engineResponse = await fetch(`${endpoint}?directory=${encodeURIComponent(cwd)}`,
          { signal: AbortSignal.timeout(10_000) });
        if (engineResponse.ok) engine = await engineResponse.json() as EngineSession;
        const messagesResponse = await fetch(`${endpoint}/message?directory=${encodeURIComponent(cwd)}&limit=50`,
          { signal: AbortSignal.timeout(10_000) });
        if (messagesResponse.ok) engineMessages = await messagesResponse.json() as EngineMessage[];
        detail = await api.json<Detail>(`/agent-sessions/${id}`);
        const hasAnswer = engineMessages.some(message => message.info.role === 'assistant'
          && Boolean(message.info.time?.completed)
          && message.parts.some(part => part.type === 'text' && part.text?.trim() === '42'));
        if (hasAnswer && engine && !placeholders.test(engine.title.trim())
          && detail?.session.name === engine.title) break;
        await page.waitForTimeout(1500);
      }
      const users = engineMessages.filter(message => message.info.role === 'user'
        && message.parts.some(part => part.type === 'text' && part.text === prompt));
      const answers = engineMessages.filter(message => message.info.role === 'assistant'
        && message.info.parentID === users[0]?.info.id && Boolean(message.info.time?.completed)
        && message.parts.some(part => part.type === 'text' && part.text?.trim() === '42'));
      expect(users, 'one real SDK user prompt').toHaveLength(1);
      expect(answers, 'one completed real SDK answer').toHaveLength(1);
      expect(answers[0].info).toMatchObject({ parentID: users[0].info.id,
        providerID: 'openai', modelID: 'gpt-6-luna' });
      expect(engineMessages.flatMap(message => message.parts).filter(part => part.type === 'tool')).toEqual([]);
      expect(detail?.messages.filter(message => message.role === 'input' && message.rawText === prompt))
        .toMatchObject([{ sdkMessageId: users[0].info.id }]);
      expect(detail?.messages.filter(message => message.role === 'output' && message.rawText.trim() === '42'))
        .toMatchObject([{ sdkMessageId: answers[0].info.id }]);
      // Preserve only title-route metadata before the naming assertion. The
      // engine's background title call is separate from this proven SDK answer.
      observation.engineTitle = engine?.title ?? null;
      observation.apiName = detail?.session.name ?? null;
      try {
        const query = `?directory=${encodeURIComponent(cwd)}`;
        const [configResponse, agentsResponse] = await Promise.all([
          fetch(`${ENGINE}/config${query}`, { signal: AbortSignal.timeout(10_000) }),
          fetch(`${ENGINE}/agent${query}`, { signal: AbortSignal.timeout(10_000) }),
        ]);
        observation.titleConfigStatus = configResponse.status;
        observation.titleAgentStatus = agentsResponse.status;
        const config = configResponse.ok ? await configResponse.json() as EngineConfig : null;
        const agents = agentsResponse.ok ? await agentsResponse.json() as TitleAgent[] : null;
        const titleAgent = Array.isArray(agents) ? agents.find(agent => agent.name === 'title') : undefined;
        const smallModel = typeof config?.small_model === 'string' ? config.small_model : null;
        const configuredTitleModel = titleAgent?.model;
        const selected = configuredTitleModel
          ?? (smallModel?.includes('/') ? {
            providerID: smallModel.slice(0, smallModel.indexOf('/')),
            modelID: smallModel.slice(smallModel.indexOf('/') + 1),
          } : null);
        const titleCatalog = await api.json<CatalogModel[]>('/agents/models/catalog/full');
        const candidate = selected && titleCatalog.find(row => row.provider === selected.providerID
          && row.modelId === selected.modelID);
        observation.managedSmallModel = smallModel;
        observation.hiddenTitleAgentPresent = Boolean(titleAgent);
        observation.hiddenTitleAgentHidden = titleAgent?.hidden === true;
        observation.titleCandidateSource = configuredTitleModel ? 'title-agent-model'
          : smallModel ? 'effective-small-model' : 'engine-provider-default-or-main';
        observation.titleCandidate = selected ?? null;
        observation.titleCandidateInApiCatalog = candidate ? {
          authorized: candidate.authorized, visible: candidate.visible,
        } : null;
      } catch (error) {
        observation.titleMetadataReadErrorClass = error instanceof Error ? error.name : typeof error;
      }
      expect(engine, 'the real engine must generate a title after the one completed turn').not.toBeNull();
      const generatedTitle = engine!.title.trim();
      expect(generatedTitle.length).toBeGreaterThan(0);
      expect(placeholders.test(generatedTitle), 'the engine title must no longer be a placeholder').toBe(false);
      expect(generatedTitle).not.toBe(createdName.trim());
      expect(detail?.session).toMatchObject({ id, cwd, profileId: 'coding-agent',
        sdkSessionId: sdkId, ownerUserId: manifest.ownerUserId, name: generatedTitle });
      expect(sessionRows(id)).toMatchObject([{ id, name: generatedTitle, cwd,
        profile_id: 'coding-agent', sdk_session_id: sdkId,
        owner_user_id: manifest.ownerUserId, parent_session_id: null }]);
      observation.phase = 'sdk-and-api-turn-confirmed';
      observation.titleGeneratedInEngine = Boolean(engine && !placeholders.test(engine.title.trim()));
      observation.titleAdoptedInApi = Boolean(detail && !placeholders.test(detail.session.name.trim()));
      observation.sdkUserId = users[0].info.id;
      observation.sdkAnswerId = answers[0].info.id;
      observation.sdkAnswerModelId = answers[0].info.modelID ?? null;
      observation.sdkToolPartCount = 0;
      observation.localInputBoundToSdkUser = true;
      observation.localOutputBoundToSdkAssistant = true;
      observation.dbRow = sessionRows(id);
      const beforeList = await api.json<History>('/agent-sessions?scope=chats&includeArchived=true&limit=100');
      observation.listNameBeforeReload = beforeList.sessions.find(row => row.id === id)?.name ?? null;
      observation.railLabelBeforeReload = await page.getByTestId(`session-${id}`).innerText();
      expect(beforeList.sessions.filter(row => row.id === id))
        .toMatchObject([{ id, name: generatedTitle, ownerUserId: manifest.ownerUserId }]);
      await expect(page.getByTestId(`session-${id}`)).toContainText(generatedTitle);

      await page.reload();
      await expect(page.getByTestId(`session-${id}`)).toBeVisible();
      await page.getByTestId(`session-${id}`).click();
      observation.railLabelAfterReload = await page.getByTestId(`session-${id}`).innerText();
      const reloaded = await api.json<Detail>(`/agent-sessions/${id}`);
      const afterList = await api.json<History>('/agent-sessions?scope=chats&includeArchived=true&limit=100');
      observation.apiNameAfterReload = reloaded.session.name;
      observation.listNameAfterReload = afterList.sessions.find(row => row.id === id)?.name ?? null;
      observation.dbRowAfterReload = sessionRows(id);
      observation.visibleAnswerAfterReload = await page.getByTestId('transcript').getByText('42', { exact: true }).isVisible();
      expect(reloaded.session).toMatchObject({ id, name: generatedTitle, sdkSessionId: sdkId,
        ownerUserId: manifest.ownerUserId });
      expect(afterList.sessions.filter(row => row.id === id))
        .toMatchObject([{ id, name: generatedTitle, ownerUserId: manifest.ownerUserId }]);
      expect(sessionRows(id)).toMatchObject([{ id, name: generatedTitle, cwd,
        profile_id: 'coding-agent', sdk_session_id: sdkId,
        owner_user_id: manifest.ownerUserId, parent_session_id: null }]);
      await expect(page.getByTestId(`session-${id}`)).toContainText(generatedTitle);
      await expect(page.getByTestId('transcript').getByText('42', { exact: true })).toBeVisible();
      observation.status = 'observed';
      observation.phase = 'reload-readback-recorded';
    } catch (error) {
      primaryError = error;
      observation.status = 'observer-error';
      observation.errorPhase = observation.phase;
      observation.errorName = error instanceof Error ? error.name : 'unknown';
    } finally {
      const cleanupErrors: string[] = [];
      try {
        // Leave the selected chat before normal hard deletion so the UI does
        // not race a post-delete detail request against the exact owned row.
        if (id && !page.isClosed()) await page.goto('rhythm://app/index.html#/tools/agent-tools');
        const candidates = localRows('SELECT id,name,cwd,profile_id,sdk_session_id,owner_user_id FROM agent_sessions WHERE cwd=?', cwd);
        // The cwd did not exist before this observer; still prove exact owner,
        // profile and SDK identity before any deletion.
        for (const row of candidates) {
          if (row.cwd !== cwd || row.owner_user_id !== manifest.ownerUserId
            || row.profile_id !== 'coding-agent' || (id && row.id !== id)
            || (sdkId && row.sdk_session_id !== sdkId)) throw new Error('cleanup ownership guard refused row');
          const current = await api.json<Detail>(`/agent-sessions/${row.id}`);
          if (current.session.id !== row.id || current.session.ownerUserId !== manifest.ownerUserId
            || current.session.cwd !== cwd || current.session.profileId !== 'coding-agent')
            throw new Error('cleanup API ownership guard refused row');
          const removed = await api.fetch(`/agent-sessions/${row.id}/hard`, { method: 'DELETE' });
          if (removed.status !== 204) throw new Error('normal hard delete did not return 204');
        }
        if (localRows('SELECT id FROM agent_sessions WHERE cwd=?', cwd).length !== 0)
          throw new Error('owned local session row remains');
        if (sdkId) {
          const engineRead = await fetch(`${ENGINE}/session/${encodeURIComponent(sdkId)}?directory=${encodeURIComponent(cwd)}`,
            { signal: AbortSignal.timeout(10_000) });
          if (engineRead.status !== 404) throw new Error('owned engine session remains after hard delete');
        }
      } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : 'unknown cleanup error'); }
      try {
        if (profilePatched && originalProfile) {
          const current = await api.json<Profile>('/agent-configs/coding-agent');
          if (current.id !== originalProfile.id || current.label !== originalProfile.label
            || current.revision !== originalProfile.revision + 1
            || current.modelProvider !== 'openai' || current.modelId !== 'gpt-6-luna')
            throw new Error('cleanup refused to restore a changed or foreign coding profile');
          const restored = await api.fetch('/agent-configs/coding-agent', { method: 'PATCH',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({
              expectedRevision: current.revision,
              systemPrompt: originalProfile.systemPrompt,
              corePermissionsJson: originalProfile.corePermissionsJson,
              allowedMcpsJson: originalProfile.allowedMcpsJson,
              allowedSkillsJson: originalProfile.allowedSkillsJson,
              modelProvider: originalProfile.modelProvider, modelId: originalProfile.modelId,
            }) });
          if (restored.status !== 200) throw new Error('normal profile restore failed');
          const final = await api.json<Profile>('/agent-configs/coding-agent');
          for (const key of ['systemPrompt', 'corePermissionsJson', 'allowedMcpsJson',
            'allowedSkillsJson', 'modelProvider', 'modelId'] as const)
            if (final[key] !== originalProfile[key]) throw new Error(`profile restore mismatch: ${key}`);
        }
      } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : 'profile cleanup error'); }
      try {
        if (visibilityPatched && originalLunaVisible !== null) {
          const restored = await api.fetch('/agent-models/visibility', { method: 'PATCH',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({
              updates: [{ provider: 'openai', modelId: 'gpt-6-luna', visible: originalLunaVisible }],
            }) });
          if (restored.status !== 200) throw new Error('normal model visibility restore failed');
          const final = await api.json<CatalogModel[]>('/agents/models/catalog/full');
          if (final.find(row => row.provider === 'openai' && row.modelId === 'gpt-6-luna')?.visible
            !== originalLunaVisible) throw new Error('model visibility restore mismatch');
        }
      } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : 'visibility cleanup error'); }
      if (cleanupErrors.length === 0) {
        try {
          const currentCwd = lstatSync(cwd);
          if (!currentCwd.isDirectory() || currentCwd.isSymbolicLink()
            || realpathSync(cwd) !== cwd || currentCwd.uid !== process.getuid?.()
            || (currentCwd.mode & 0o777) !== 0o700 || readdirSync(cwd).length !== 0)
            throw new Error('exact empty private cwd cleanup authority failed');
          rmdirSync(cwd);
        } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : 'cwd cleanup error'); }
      }
      observation.cleanupErrors = cleanupErrors;
    }
    await testInfo.attach('private-session-auto-name', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
      revision: expectedRevision, phase: observation.phase, status: observation.status,
      initialName: observation.initialName, generatedTitle: observation.engineTitle,
      apiName: observation.apiName, apiNameAfterReload: observation.apiNameAfterReload,
      managedSmallModel: observation.managedSmallModel,
      titleConfigStatus: observation.titleConfigStatus,
      titleAgentStatus: observation.titleAgentStatus,
      hiddenTitleAgentPresent: observation.hiddenTitleAgentPresent,
      hiddenTitleAgentHidden: observation.hiddenTitleAgentHidden,
      titleCandidateSource: observation.titleCandidateSource,
      titleCandidate: observation.titleCandidate,
      titleCandidateInApiCatalog: observation.titleCandidateInApiCatalog,
      titleMetadataReadErrorClass: observation.titleMetadataReadErrorClass,
      listNameBeforeReload: observation.listNameBeforeReload,
      listNameAfterReload: observation.listNameAfterReload,
      servedModel: observation.sdkAnswerModelId, sdkToolPartCount: observation.sdkToolPartCount,
      visibleAnswerAfterReload: observation.visibleAnswerAfterReload,
      cleanupErrors: observation.cleanupErrors,
    })) });
    if (primaryError) throw primaryError;
    if ((observation.cleanupErrors as string[]).length) throw new Error('Exact owned cleanup failed; retained private cwd');
  });
}
