import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as rawTest } from '@playwright/test';
import { test, expect, API, ENGINE, ObservedApi, expectedRevision, localRows } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Model = { provider: string; modelId: string; authorized: boolean; visible: boolean };
type Profile = { id: string; label: string; revision: number; systemPrompt: string | null;
  corePermissionsJson: string | null; allowedMcpsJson: string | null; allowedSkillsJson: string | null;
  modelProvider: string | null; modelId: string | null };
type Session = { id: string; name: string; cwd: string; ownerUserId: number | null; profileId: string | null;
  sdkSessionId: string | null; category: string; isSystem: boolean };
type Detail = { session: Session; messages: Array<{ role: string; rawText: string; sdkMessageId?: string }> };
type EngineMessage = { info: { id: string; role: string; parentID?: string; providerID?: string; modelID?: string;
  time?: { completed?: number } }; parts: Array<{ type: string; text?: string }> };
type SystemRow = { id: string; name: string; cwd: string; sdk_session_id: string | null; owner_user_id: number | null;
  category: string; is_system: number };

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[P0] private chat sources one real Luna skill extraction and no duplicate after a third turn';

const systemRows = () => localRows(`SELECT id,name,cwd,sdk_session_id,owner_user_id,category,is_system
  FROM agent_sessions WHERE name='skill-extract' AND category='self_improvement' AND is_system=1`) as SystemRow[];
const engineMessages = async (sdkId: string, cwd: string) => {
  const response = await fetch(`${ENGINE}/session/${encodeURIComponent(sdkId)}/message?directory=${encodeURIComponent(cwd)}&limit=50`,
    { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return [] as EngineMessage[];
  return await response.json() as EngineMessage[];
};
const toolCount = (messages: EngineMessage[]) => messages.flatMap(message => message.parts).filter(part => part.type === 'tool').length;
const completedAssistant = (messages: EngineMessage[]) => messages.filter(message => message.info.role === 'assistant'
  && Boolean(message.info.time?.completed));

if (!manifestPath || process.env.RHYTHM_FEATURE_MODEL !== '1') {
  rawTest(title, () => { throw new Error('UNVERIFIED: fresh synthetic actor manifest and bounded model loan required'); });
} else {
test(title, async ({ page, sessions, packaged }, testInfo) => {
  test.setTimeout(480_000);
  const receipt: Record<string, unknown> = { schemaVersion: 1, status: 'UNRUN', phase: 'manifest-validation' };
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor, 'private synthetic actor required').toBeDefined();
  expect(manifest.publicUserSeed.email).toMatch(/\.invalid$/);
  const fixtureRoot = realpathSync(manifest.fixtureRoot);
  const stat = lstatSync(fixtureRoot);
  expect(fixtureRoot.startsWith('/private/tmp/') && !stat.isSymbolicLink()
    && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o700,
  'only an owner-private canonical fixture is allowed').toBe(true);
  const loan = manifest.syntheticActor!.modelLoan as { issuedAt: number; stopAt: number; expires: number } | undefined;
  const started = Date.now();
  expect(loan && Number.isSafeInteger(loan.issuedAt) && Number.isSafeInteger(loan.stopAt)
    && Number.isSafeInteger(loan.expires) && loan.issuedAt <= started
    && loan.stopAt - loan.issuedAt <= 600_000 && loan.stopAt <= loan.expires - 1_200_000,
  'bounded reviewed model loan required').toBe(true);
  expect(loan!.stopAt - started, 'need time for cold window, two UI turns, and extraction').toBeGreaterThan(420_000);
  const hardStop = Math.min(loan!.stopAt - 55_000, started + 455_000);
  test.setTimeout(Math.min(480_000, loan!.stopAt - started - 25_000));
  const nonce = randomUUID();
  const receiptPath = testInfo.outputPath(`skill-extraction-${nonce}.json`);
  const cwd = path.join(fixtureRoot, `skill-extract-${nonce}`);
  const name = `[smoke] skill-extract ${nonce}`;
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  let chatId = '';
  let chatSdk = '';
  let originalProfile: Profile | null = null;
  let originalVisibility: boolean | null = null;
  let profilePatched = false;
  let visibilityPatched = false;
  let attributableSystem: SystemRow | null = null;
  let systemTerminal = false;
  let primaryError: unknown;
  mkdirSync(cwd, { mode: 0o700 });
  receipt.nonce = nonce;
  receipt.productRevision = manifest.sourceRevision;
  try {
    expect(localRows('SELECT id FROM agent_sessions'), 'fresh fixture must have zero previous sessions').toEqual([]);
    await sessions.open();
    expect((await api.json<{ user: { id: number; email: string } }>('/auth/me')).user)
      .toMatchObject({ id: manifest.ownerUserId, email: manifest.publicUserSeed.email });
    receipt.phase = 'fresh-actor-and-renderer-ready';

    const catalog = await api.json<Model[]>('/agents/models/catalog/full');
    const luna = catalog.find(row => row.provider === 'openai' && row.modelId === 'gpt-6-luna');
    expect(luna).toMatchObject({ authorized: true });
    originalVisibility = luna!.visible;
    if (!luna!.visible) {
      const response = await api.fetch('/agent-models/visibility', { method: 'PATCH',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updates: [
          { provider: 'openai', modelId: 'gpt-6-luna', visible: true },
        ] }) });
      expect(response.status).toBe(200);
      visibilityPatched = true;
    }
    expect((await api.json<Model[]>('/agents/models/catalog/full'))
      .find(row => row.provider === 'openai' && row.modelId === 'gpt-6-luna'))
      .toMatchObject({ authorized: true, visible: true });
    const decisions = await api.json<{ catalog?: { source?: string; models?: Array<{ providerID: string; modelID: string; enabled: boolean }> } }>('/agent-decisions/config');
    expect(decisions.catalog?.source).toBe('live');
    expect(decisions.catalog?.models?.find(row => row.providerID === 'openai' && row.modelID === 'gpt-6-luna'))
      .toMatchObject({ enabled: true });

    const profile = await api.json<Profile>('/agent-configs/coding-agent');
    originalProfile = profile;
    expect(profile.label).toMatch(/^\[smoke\]/);
    const noTools = '{"*":"deny","task":"deny","rhythm_delegate_async":"deny","image_generation":"deny"}';
    const response = await api.fetch('/agent-configs/coding-agent', { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: profile.revision,
        systemPrompt: 'For this synthetic chat, answer each literal echo request with exactly the requested word. Do not use tools or external data.',
        corePermissionsJson: noTools, allowedMcpsJson: '{}', allowedSkillsJson: '[]',
        modelProvider: 'openai', modelId: 'gpt-6-luna' }) });
    expect(response.status).toBe(200);
    profilePatched = true;
    const readback = await api.json<Profile>('/agent-configs/coding-agent');
    expect(readback).toMatchObject({ id: 'coding-agent', corePermissionsJson: noTools,
      allowedMcpsJson: '{}', allowedSkillsJson: '[]', modelProvider: 'openai', modelId: 'gpt-6-luna' });
    receipt.phase = 'normal-model-and-profile-provisioned';

    const created = await api.fetch('/agent-sessions', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, cwd,
        profileId: 'coding-agent', modelMode: 'fixed', isolateWorktree: false }) });
    expect(created.status).toBe(201);
    const chat = await created.json() as Session;
    chatId = chat.id;
    chatSdk = chat.sdkSessionId ?? '';
    expect(chat).toMatchObject({ name, cwd, ownerUserId: manifest.ownerUserId, profileId: 'coding-agent' });
    expect(chatSdk).toMatch(/^ses_/);
    await page.reload();
    await expect(page.getByTestId(`session-${chatId}`)).toBeVisible();
    await page.getByTestId(`session-${chatId}`).click();
    receipt.phase = 'owned-named-chat-selected';

    // Engine readiness is stamped before the signed-in renderer opens. This
    // waits beyond the production 90-second curator cold-start gate, without
    // changing clocks or launch environment.
    expect(hardStop - Date.now(), 'insufficient loan headroom before mandatory 95-second wait')
      .toBeGreaterThan(260_000);
    await page.waitForTimeout(95_000);
    const prompts = [
      `[smoke] ${nonce} echo one: Reply exactly ALPHA. Do not use tools.`,
      `[smoke] ${nonce} echo two: Reply exactly BETA. Do not use tools.`,
    ];
    const answers = ['ALPHA', 'BETA'];
    for (let index = 0; index < prompts.length; index++) {
      expect(hardStop - Date.now(), 'loan stop reached before next paid turn').toBeGreaterThan(80_000);
      await page.getByTestId('composer-input').fill(prompts[index]);
      await page.getByTestId('composer-send').click();
      await expect(page.getByTestId('transcript').getByText(answers[index], { exact: true }))
        .toBeVisible({ timeout: Math.min(120_000, hardStop - Date.now()) });
      await expect(page.getByTestId('transcript').getByText(prompts[index], { exact: true })).toHaveCount(1);
      const turnDeadline = Math.min(Date.now() + 50_000, hardStop);
      let completed = false;
      while (Date.now() < turnDeadline) {
        completed = completedAssistant(await engineMessages(chatSdk, cwd)).some(message =>
          message.info.providerID === 'openai' && message.info.modelID === 'gpt-6-luna'
          && message.parts.some(part => part.type === 'text' && part.text?.trim() === answers[index]));
        if (completed) break;
        await page.waitForTimeout(500);
      }
      expect(completed, `UI turn ${index + 1} never reached a completed Luna SDK assistant`).toBe(true);
      receipt.phase = `main-turn-${index + 1}-visible`;
    }
    const mainSdk = await engineMessages(chatSdk, cwd);
    const mainCompleted = completedAssistant(mainSdk);
    const mainUsers = mainSdk.filter(message => message.info.role === 'user');
    expect(mainUsers.filter(message => message.parts.some(part => part.type === 'text' && part.text === prompts[0]))).toHaveLength(1);
    expect(mainUsers.filter(message => message.parts.some(part => part.type === 'text' && part.text === prompts[1]))).toHaveLength(1);
    for (const answer of answers) expect(mainCompleted.filter(message => message.parts.some(part => part.type === 'text' && part.text?.trim() === answer)
      && message.info.providerID === 'openai' && message.info.modelID === 'gpt-6-luna')).toHaveLength(1);
    expect(toolCount(mainSdk)).toBe(0);
    const detail = await api.json<Detail>(`/agent-sessions/${chatId}`);
    expect(detail.session).toMatchObject({ id: chatId, cwd, ownerUserId: manifest.ownerUserId, sdkSessionId: chatSdk });
    for (const prompt of prompts) expect(detail.messages.filter(message => message.role === 'input' && message.rawText.includes(prompt))).toHaveLength(1);
    for (const answer of answers) expect(detail.messages.filter(message => message.role === 'output' && message.rawText.trim() === answer)).toHaveLength(1);
    receipt.main = { uiAnswers: answers.length, sdkInputCount: mainUsers.length, sdkCompletedCount: mainCompleted.length,
      sdkToolParts: toolCount(mainSdk), model: 'openai/gpt-6-luna' };
    receipt.phase = 'two-real-ui-turns-observed';

    const queued = `[skill-extract] queued for ${chatId}`;
    const extractionDeadline = Math.min(hardStop, Date.now() + 100_000);
    let queueCount = 0;
    let candidates: SystemRow[] = [];
    let extractionMessages: EngineMessage[] = [];
    while (Date.now() < extractionDeadline) {
      queueCount = packaged.output().split(queued).length - 1;
      candidates = systemRows();
      if (queueCount === 1 && candidates.length === 1 && candidates[0].sdk_session_id) {
        extractionMessages = await engineMessages(candidates[0].sdk_session_id, candidates[0].cwd);
        if (completedAssistant(extractionMessages).length) break;
      }
      await page.waitForTimeout(1_000);
    }
    receipt.extraction = { ownedQueueMarkerCount: queueCount, newSystemRowCount: candidates.length,
      systemCategory: candidates[0]?.category ?? null, systemFlag: candidates[0]?.is_system ?? null,
      sdkInputCount: extractionMessages.filter(message => message.info.role === 'user').length,
      sdkCompletedCount: completedAssistant(extractionMessages).length,
      sdkToolParts: toolCount(extractionMessages),
      completedModels: completedAssistant(extractionMessages).map(message => `${message.info.providerID}/${message.info.modelID}`) };
    receipt.phase = 'background-extraction-metadata-recorded';
    expect(queueCount, 'UNVERIFIED: no exact owned source queue marker').toBe(1);
    expect(candidates, 'UNVERIFIED: no unique new system skill-extract row').toHaveLength(1);
    const system = candidates[0];
    expect(system).toMatchObject({ name: 'skill-extract', category: 'self_improvement', is_system: 1 });
    expect(system.sdk_session_id).toMatch(/^ses_/);
    const sourceInputs = extractionMessages.filter(message => message.info.role === 'user');
    const sourced = sourceInputs.some(message => message.parts.some(part => part.type === 'text'
      && prompts.every(prompt => part.text?.includes(prompt))));
    receipt.sourceTranscriptContainsBothNoncePrompts = sourced;
    expect(sourced, 'UNVERIFIED: system SDK input has no attributable owned transcript').toBe(true);
    attributableSystem = system;
    const done = completedAssistant(extractionMessages);
    expect(done, 'UNVERIFIED: extraction did not reach a terminal assistant').toHaveLength(1);
    systemTerminal = true;
    expect(done[0].info).toMatchObject({ providerID: 'openai', modelID: 'gpt-6-luna' });
    expect(toolCount(extractionMessages)).toBe(0);
    receipt.phase = 'source-attributed-real-background-assistant-observed';

    // The observed third turn probes the in-process lifetime guard. Require
    // sufficient loan headroom instead of silently narrowing this contract.
    expect(hardStop - Date.now(), 'UNVERIFIED: insufficient loan for third turn and lifetime guard')
      .toBeGreaterThan(125_000);
    {
      const third = `[smoke] ${nonce} echo three: Reply exactly GAMMA. Do not use tools.`;
      await page.getByTestId('composer-input').fill(third);
      await page.getByTestId('composer-send').click();
      await expect(page.getByTestId('transcript').getByText('GAMMA', { exact: true })).toBeVisible({ timeout: 90_000 });
      const thirdDetail = await api.json<Detail>(`/agent-sessions/${chatId}`);
      expect(thirdDetail.messages.filter(message => message.role === 'input' && message.rawText.includes(third))).toHaveLength(1);
      expect(thirdDetail.messages.filter(message => message.role === 'output' && message.rawText.trim() === 'GAMMA')).toHaveLength(1);
      let thirdSdk: EngineMessage[] = [];
      const thirdDeadline = Math.min(Date.now() + 50_000, hardStop);
      while (Date.now() < thirdDeadline) {
        thirdSdk = await engineMessages(chatSdk, cwd);
        if (completedAssistant(thirdSdk).some(message => message.parts.some(part =>
          part.type === 'text' && part.text?.trim() === 'GAMMA'))) break;
        await page.waitForTimeout(500);
      }
      expect(completedAssistant(thirdSdk).filter(message => message.info.providerID === 'openai'
        && message.info.modelID === 'gpt-6-luna'
        && message.parts.some(part => part.type === 'text' && part.text?.trim() === 'GAMMA'))).toHaveLength(1);
      expect(toolCount(thirdSdk)).toBe(0);
      await page.waitForTimeout(3_000);
      const thirdQueueCount = packaged.output().split(queued).length - 1;
      receipt.thirdTurn = { attempted: true, visibleAnswer: true, persistedInputAndOutput: true, ownedQueueMarkerCount: thirdQueueCount };
      expect(thirdQueueCount, 'third owned turn must not queue a second extraction').toBe(1);
      expect(systemRows(), 'third owned turn must not create another extractor session').toHaveLength(1);
    }
    receipt.phase = 'third-turn-lifetime-guard-observed';
    receipt.status = 'observed';
  } catch (error) {
    primaryError = error;
    receipt.status = 'observer-error';
    receipt.errorPhase = receipt.phase;
    receipt.errorClass = error instanceof Error ? error.name : typeof error;
  } finally {
    const cleanup: string[] = [];
    try {
      if (!page.isClosed()) await page.goto('rhythm://app/index.html#/tools/agent-tools');
      // A system row is deletable only after exact queue and SDK transcript
      // attribution, and only after a terminal assistant. Otherwise retain it
      // for the caller's whole-fixture scrub; never adopt a merely timed row.
      if (attributableSystem && systemTerminal) {
        const exact = systemRows().find(row => row.id === attributableSystem!.id);
        if (!exact || exact.sdk_session_id !== attributableSystem.sdk_session_id
          || exact.cwd !== attributableSystem.cwd || exact.is_system !== 1)
          throw new Error('system cleanup authority changed');
        const removed = await api.fetch(`/agent-sessions/${exact.id}/hard`, { method: 'DELETE' });
        receipt.systemDeleteHttpStatus = removed.status;
        if (removed.status !== 204) throw new Error('system session hard delete failed');
        if (systemRows().some(row => row.id === exact.id)) throw new Error('system row remains');
      }
      if (chatId) {
        const rows = localRows('SELECT id,name,cwd,owner_user_id,sdk_session_id FROM agent_sessions WHERE id=?', chatId);
        if (rows.length !== 1 || rows[0].id !== chatId || rows[0].name !== name || rows[0].cwd !== cwd
          || rows[0].owner_user_id !== manifest.ownerUserId || rows[0].sdk_session_id !== chatSdk)
          throw new Error('chat cleanup authority changed');
        const removed = await api.fetch(`/agent-sessions/${chatId}/hard`, { method: 'DELETE' });
        receipt.chatDeleteHttpStatus = removed.status;
        if (removed.status !== 204) throw new Error('owned chat hard delete failed');
      }
      if (localRows('SELECT id FROM agent_sessions WHERE id=?', chatId).length) throw new Error('owned chat row remains');
    } catch (error) { cleanup.push(error instanceof Error ? error.name : 'unknown'); }
    try {
      if (profilePatched && originalProfile) {
        const current = await api.json<Profile>('/agent-configs/coding-agent');
        if (current.revision !== originalProfile.revision + 1 || current.id !== originalProfile.id)
          throw new Error('profile cleanup authority changed');
        const restored = await api.fetch('/agent-configs/coding-agent', { method: 'PATCH',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: current.revision,
            systemPrompt: originalProfile.systemPrompt, corePermissionsJson: originalProfile.corePermissionsJson,
            allowedMcpsJson: originalProfile.allowedMcpsJson, allowedSkillsJson: originalProfile.allowedSkillsJson,
            modelProvider: originalProfile.modelProvider, modelId: originalProfile.modelId }) });
        if (restored.status !== 200) throw new Error('profile restore failed');
      }
      if (visibilityPatched && originalVisibility !== null) {
        const restored = await api.fetch('/agent-models/visibility', { method: 'PATCH',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updates: [
            { provider: 'openai', modelId: 'gpt-6-luna', visible: originalVisibility },
          ] }) });
        if (restored.status !== 200) throw new Error('visibility restore failed');
      }
    } catch (error) { cleanup.push(error instanceof Error ? error.name : 'unknown'); }
    try { rmdirSync(cwd); } catch { /* fixture scrub handles residual owned cwd */ }
    receipt.cleanupErrorClasses = cleanup;
    receipt.wholeCredentialFixtureScrub = 'caller-required-after-app-stop';
    if (cleanup.length) receipt.status = 'cleanup-error';
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await testInfo.attach('skill-extraction-sanitized', { contentType: 'application/json',
      body: Buffer.from(JSON.stringify(receipt)) });
    if (cleanup.length) primaryError ??= new Error('owned cleanup incomplete; inspect sanitized receipt and scrub whole loan');
  }
  if (primaryError) throw primaryError;
});
}
