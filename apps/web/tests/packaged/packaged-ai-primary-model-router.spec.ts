import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test as unverified } from '@playwright/test';
import { test, expect, API, ENGINE, ObservedApi, expectedRevision, localRows, responseFor, assertResponse } from './feature-test';
import { ensurePrimaryForPrivateActor } from './primary-read';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type ModelRow = { provider: string; modelId: string; visible: boolean; authorized: boolean };
type Config = { catalog?: { source?: string; models?: Array<{ providerID: string; modelID: string; enabled: boolean }> } };
type Profile = { id: string; label: string; revision: number; modelProvider: string; modelId: string };
type EngineMessage = { info: { id: string; role: string; parentID?: string; providerID?: string; modelID?: string;
  time?: { completed?: number } }; parts: Array<{ type: string; text?: string }> };
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI primary] private main Auto serves the cheaper same-tier Grid model below its profile baseline';
const baselineModel = 'gpt-6.1-sol';
const lunaModel = 'gpt-6-luna';
const solModel = 'gpt-6-sol';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: fresh private synthetic actor and bounded model loan required'); });
} else test(title, async ({ page, sessions }) => {
  test.setTimeout(240_000);
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: one real model turn requires explicit opt-in').toBe('1');
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor, 'private model actor required').toBeDefined();
  expect(manifest.publicUserSeed.email).toMatch(/\.invalid$/);
  const loan = manifest.syntheticActor!.modelLoan as { issuedAt: number; stopAt: number; expires: number } | undefined;
  const now = Date.now();
  expect(loan, 'UNVERIFIED: bounded model loan required').toBeDefined();
  expect(Number.isSafeInteger(loan!.issuedAt) && Number.isSafeInteger(loan!.stopAt)
    && Number.isSafeInteger(loan!.expires)).toBe(true);
  expect(loan!.issuedAt).toBeLessThanOrEqual(now);
  expect(loan!.stopAt - loan!.issuedAt).toBeLessThanOrEqual(600_000);
  expect(loan!.stopAt).toBeLessThanOrEqual(loan!.expires - 1_200_000);
  expect(loan!.stopAt - now, 'UNVERIFIED: model loan is too near its hard stop').toBeGreaterThan(270_000);
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
    user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
  });
  const roots = () => localRows(`SELECT id,project_id,owner_user_id,profile_id,sdk_session_id,
    provider_id,model_id,model_mode FROM agent_sessions WHERE owner_user_id=?
    AND parent_session_id IS NULL AND is_system=0 AND category='chat'
    AND json_extract(coordinator_conversation_json,'$.primaryOwnerRoot')=1`, manifest.ownerUserId);
  expect(roots(), 'use a fresh private actor; the canonical root is durable').toEqual([]);

  const coldRows = await api.json<ModelRow[]>('/agents/models/catalog/full');
  const coldConfig = await api.json<Config>('/agent-decisions/config');
  expect(coldConfig.catalog?.source).toBe('live');
  for (const modelId of [solModel, 'gpt-6-astra', lunaModel, baselineModel]) {
    expect(coldRows.find(row => row.provider === 'openai' && row.modelId === modelId),
      `cold live catalog must include authorized ${modelId} before profile mutation`)
      .toMatchObject({ provider: 'openai', modelId, authorized: true });
  }
  const originalProfile = await api.json<Profile>('/agent-configs/coding-agent');
  expect(originalProfile.id).toBe('coding-agent');
  expect(originalProfile.label).toMatch(/^\[smoke\] /);
  const profileResponse = await api.fetch('/agent-configs/coding-agent', { method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: originalProfile.revision, modelProvider: 'openai', modelId: baselineModel }) });
  expect(profileResponse.status).toBe(200);
  const baseline = await profileResponse.json() as Profile;
  expect(baseline).toMatchObject({ id: 'coding-agent', modelProvider: 'openai', modelId: baselineModel });
  expect(baseline.modelId).toBe(baselineModel);

  // Keep every reviewed normal-API route eligible. Leaving Sol hidden made a
  // tier-3 decision step up to the expensive baseline in the failed Confirm.
  const visibility = await api.fetch('/agent-models/visibility', { method: 'PATCH',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updates: [
      { provider: 'openai', modelId: lunaModel, visible: true },
      { provider: 'openai', modelId: solModel, visible: true },
      { provider: 'openai', modelId: baselineModel, visible: true },
    ] }) });
  expect(visibility.status).toBe(200);
  const full = await api.json<ModelRow[]>('/agents/models/catalog/full');
  const config = await api.json<Config>('/agent-decisions/config');
  expect(config.catalog?.source).toBe('live');
  for (const modelId of [lunaModel, solModel, baselineModel]) {
    expect(full.find(row => row.provider === 'openai' && row.modelId === modelId))
      .toMatchObject({ visible: true, authorized: true });
    expect(config.catalog?.models?.find(row => row.providerID === 'openai' && row.modelID === modelId))
      .toMatchObject({ enabled: true });
  }

  await sessions.open();
  expect(sessions.api?.origin).toBe(API);
  const root = await ensurePrimaryForPrivateActor(page, sessions.api!);
  expect(root.owner_user_id).toBe(manifest.ownerUserId);
  expect(roots()).toMatchObject([{ id: root.id, project_id: root.project_id,
    owner_user_id: manifest.ownerUserId, profile_id: 'coding-agent', sdk_session_id: null,
    provider_id: null, model_id: null, model_mode: 'auto' }]);
  await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Rhythm is ready.');
  expect(loan!.stopAt - Date.now(), 'UNVERIFIED: loan too near stop before send').toBeGreaterThan(210_000);

  const prompt = `[smoke] main-auto-${randomUUID()}: Compute 12 + 7. Reply only with digits. No tools are needed.`;
  const commands: Array<Record<string, unknown>> = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/coordinator-conversations/message')
      commands.push(request.postDataJSON() as Record<string, unknown>);
  };
  page.on('request', onRequest);
  try {
    const sent = responseFor(page, 'POST', '/coordinator-conversations/message');
    await page.getByTestId('composer-input').fill(prompt);
    await page.getByTestId('composer-send').click();
    const accepted = await sent;
    await assertResponse(accepted, 'POST', '/coordinator-conversations/message', 200);
    expect(await accepted.json()).toMatchObject({ kind: 'foreground_accepted' });
  } finally { page.off('request', onRequest); }
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ sessionId: root.id, projectId: root.project_id,
    expectedControlRevision: 1, message: prompt });
  expect(commands[0].commandKey).toMatch(/^coordinator:[a-f0-9-]{36}$/);

  const project = localRows('SELECT cwd,coordinator_owner_user_id FROM projects WHERE id=?', root.project_id);
  expect(project).toHaveLength(1);
  expect(project[0].coordinator_owner_user_id).toBe(manifest.ownerUserId);
  const end = Math.min(Date.now() + 120_000, loan!.stopAt - 30_000);
  let engineMessages: EngineMessage[] = [];
  let user: EngineMessage | undefined;
  let assistant: EngineMessage | undefined;
  let sdkId = '';
  while (Date.now() < end) {
    const current = roots();
    sdkId = String(current[0]?.sdk_session_id ?? '');
    if (sdkId) {
      const result = await fetch(`${ENGINE}/session/${encodeURIComponent(sdkId)}/message?directory=${encodeURIComponent(String(project[0].cwd))}&limit=50`,
        { signal: AbortSignal.timeout(10_000) });
      if (result.ok) engineMessages = await result.json() as EngineMessage[];
      user = engineMessages.find(item => item.info.role === 'user'
        && item.parts.some(part => part.type === 'text' && part.text === prompt));
      assistant = engineMessages.find(item => item.info.role === 'assistant'
        && item.info.parentID === user?.info.id);
      if (assistant?.info.time?.completed) break;
    }
    await page.waitForTimeout(1500);
  }
  expect(user, 'SDK must contain the one UI prompt').toBeDefined();
  expect(assistant?.info.time?.completed, 'SDK assistant turn must complete').toBeTruthy();
  const attempts = localRows('SELECT classification_json,result_json FROM agent_router_grid_attempts WHERE session_id=? ORDER BY id', root.id)
    .map(row => ({ classification: JSON.parse(String(row.classification_json)) as Record<string, unknown>,
      result: JSON.parse(String(row.result_json)) as Record<string, unknown> }));
  expect(attempts).toHaveLength(2);
  expect(attempts.map(item => item.result.applied)).toEqual([false, true]);
  const tier = attempts[1].classification.tier;
  expect([3, 4], 'routine knowledge must stay in the observed same-tier Grid range').toContain(tier);
  const servedModel = tier === 3 ? solModel : lunaModel;
  const effortApplied = tier === 3 ? 'medium' : 'xhigh';
  expect(servedModel, 'Grid must route below the expensive profile baseline').not.toBe(baselineModel);
  for (const attempt of attempts) {
    expect(attempt.classification).toMatchObject({ source: 'decisions', reason: 'ok', category: 'knowledge', tier });
    expect(attempt.result).toMatchObject({ model: `openai/${servedModel}`, tierUsed: tier, effortApplied });
  }
  expect(assistant?.info).toMatchObject({ providerID: 'openai', modelID: servedModel, parentID: user!.info.id });
  expect(assistant!.parts.filter(part => part.type === 'tool')).toEqual([]);
  expect(assistant!.parts.filter(part => part.type === 'text').map(part => part.text).join('')).toBe('19');

  const after = roots();
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: root.id, project_id: root.project_id, model_mode: 'auto',
    provider_id: 'openai', model_id: servedModel, sdk_session_id: sdkId });
  const historyResponse = await api.fetch('/coordinator-conversations/history', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: root.id, projectId: root.project_id, limit: 50 }) });
  expect(historyResponse.status).toBe(200);
  const history = await historyResponse.json() as { kind: string; conversation: { sessionId: string };
    messages: Array<{ role: string; sdkMessageId: string; rawText: string }> };
  expect(history).toMatchObject({ kind: 'history', conversation: { sessionId: root.id } });
  expect(history.messages).toHaveLength(2);
  expect(history.messages[0]).toMatchObject({ role: 'input', sdkMessageId: user!.info.id, rawText: prompt });
  expect(history.messages[1]).toMatchObject({ role: 'output', sdkMessageId: assistant!.info.id, rawText: '19' });

  const last = await api.json<{ decision: { sessionId: string; applied: boolean; model: string; tier: number;
    served: { servedModelId: string; requestModelId: string } } }>('/agent-decisions/grid/last-decision');
  expect(last.decision).toMatchObject({ sessionId: root.id, applied: true, model: `openai/${servedModel}`,
    tier, served: { servedModelId: servedModel, requestModelId: servedModel } });
  const provenance = await api.json<{ servedModels: string[]; dispatches: Array<{
    sdkUserMessageId: string; requestedSource: string; finalProviderId: string;
    finalModelId: string; outcome: string }> }>(`/agent-sessions/${encodeURIComponent(root.id)}/model-provenance`);
  expect(provenance.servedModels).toEqual([servedModel]);
  expect(provenance.dispatches).toEqual([expect.objectContaining({ sdkUserMessageId: user!.info.id,
    requestedSource: 'session', finalProviderId: 'openai', finalModelId: servedModel, outcome: 'accepted' })]);
  expect(localRows(`SELECT sdk_message_id AS sdkMessageId,request_model_id AS requestedModelId,
    served_model_id AS servedModelId FROM agent_served_steps WHERE session_id=?`, root.id))
    .toEqual([{ sdkMessageId: assistant!.info.id, requestedModelId: servedModel, servedModelId: servedModel }]);

  await expect(page.getByTestId('transcript').getByText('19', { exact: true })).toBeVisible();
  const details = page.getByTestId('session-details');
  if (await details.getAttribute('aria-expanded') !== 'true') await details.click();
  await page.getByTestId('inspector-context').click();
  const card = page.getByTestId('model-provenance');
  await card.getByRole('button', { name: 'Refresh served models' }).click();
  await expect(card.locator('li')).toHaveText([servedModel]);
  // This canonical primary root is intentionally durable. The caller must scrub
  // the entire exact private fixture after the app stops; do not hard-delete it.
});
