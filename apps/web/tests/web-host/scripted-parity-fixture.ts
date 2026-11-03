import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, type ParitySandbox, type Row } from './parity-fixture';

export const scriptedModel = { providerID: 'web-scripted', modelID: 's0-local' } as const;
export const scriptedAnswer = 'hello hello 🌱';
export type EngineMessage = { info: { id: string; sessionID?: string; role: string; parentID?: string;
  providerID?: string; modelID?: string; time?: { completed?: number }; error?: unknown };
  parts: Array<{ type: string; text?: string }> };
export type SessionDetail = { session: Row; messages: Array<{ role: string; rawText: string; sdkMessageId?: string }> };
type Catalog = Array<{ provider: string; modelId: string; authorized: boolean; visible: boolean }>;

/** Catalog curation uses the normal API, and restores the exact prior visibility. */
export async function prepareScriptedModel(parity: ParitySandbox, background = false) {
  expect(process.env.RHYTHM_FEATURE_MODEL, 'This suite must never consume a paid model loan').not.toBe('1');
  const catalog = await parity.api.json<Catalog>('/agents/models/catalog/full');
  const model = catalog.find(row => row.provider === scriptedModel.providerID && row.modelId === scriptedModel.modelID);
  expect(model, 'loopback model must be present and authorized before a turn').toMatchObject({ authorized: true });
  if (!model!.visible) {
    parity.deferCleanup('restore scripted model visibility', async () => {
      expect((await parity.api.request('PATCH', '/agent-models/visibility', { updates: [{ provider: scriptedModel.providerID, modelId: scriptedModel.modelID, visible: model!.visible }] })).status).toBe(200);
      expect((await parity.api.json<Catalog>('/agents/models/catalog/full')).find(row => row.provider === scriptedModel.providerID && row.modelId === scriptedModel.modelID)?.visible).toBe(model!.visible);
    });
    expect((await parity.api.request('PATCH', '/agent-models/visibility', { updates: [{ provider: scriptedModel.providerID, modelId: scriptedModel.modelID, visible: true }] })).status).toBe(200);
  }
  expect((await parity.api.json<Catalog>('/agents/models/catalog/full')).find(row => row.provider === scriptedModel.providerID && row.modelId === scriptedModel.modelID)).toMatchObject({ authorized: true, visible: true });
  const decisions = await parity.api.json<{ catalog: { source: string;
    models: Array<{ providerID: string; modelID: string; tier: string; enabled: boolean; excluded: boolean }> } }>('/agent-decisions/config');
  expect(decisions.catalog.source, 'routing authority must come from the real engine').toBe('live');
  expect(decisions.catalog.models.filter(row => row.enabled && !row.excluded).map(row => ({
    providerID: row.providerID, modelID: row.modelID, tier: row.tier,
  })), 'background routing must have exactly one eligible local cheap model').toEqual([{ ...scriptedModel, tier: 'cheap' }]);
  const config = await parity.engineFetch('/config');
  expect(config.status).toBe(200);
  const effective = await config.json();
  expect(effective, 'standard engine provider allowlist must exclude external model routes').toMatchObject({ enabled_providers: ['web-scripted'] });
  if (background) {
    expect(effective, 'separate scripted sandbox must pin both background defaults before launch').toMatchObject({ model: 'web-scripted/s0-local', small_model: 'web-scripted/s0-local' });
  }
}

export async function createScriptedProfile(parity: ParitySandbox, label: string) {
  assert(label.startsWith(parity.prefix));
  parity.deferCleanup('delete exact scripted profile', async () => {
    const profiles = await parity.api.json<Row[]>('/agent-configs');
    for (const row of profiles.filter(row => row.label === label)) {
      expect(parity.rows('SELECT id FROM agent_sessions WHERE profile_id=?', row.id), 'sessions must be removed before their profile').toEqual([]);
      expect((await parity.api.fetch(`/agent-configs/${encodeURIComponent(row.id)}`, { method: 'DELETE' })).status).toBe(204);
      expect(parity.rows('SELECT id FROM agent_configs WHERE id=?', row.id)).toEqual([]);
    }
  });
  const response = await parity.api.request('POST', '/agent-configs', { label, modelProvider: scriptedModel.providerID, modelId: scriptedModel.modelID,
    systemPrompt: 'Synthetic transport check. Do not use tools or external data.', schedulable: true,
    allowedMcpsJson: '[]', allowedSkillsJson: '[]', allowedDelegatesJson: '[]',
    corePermissionsJson: '{"*":"deny","task":"deny","rhythm_delegate_async":"deny","image_generation":"deny"}' });
  expect(response.status).toBe(201);
  const profile = await response.json() as Row;
  expect(profile).toMatchObject({ label, modelProvider: scriptedModel.providerID, modelId: scriptedModel.modelID, schedulable: true });
  return profile;
}

export async function assertProjectedNoTools(parity: ParitySandbox, profileId: string, cwd = parity.cwd) {
  assert(cwd === parity.cwd || cwd === parity.sandbox);
  const projected = async () => (await parity.api.json<{ agents: Row[] }>(`/agent-sessions/agents?full=1&cwd=${encodeURIComponent(cwd)}`)).agents.find(row => row.name === profileId);
  await expect.poll(async () => (await projected())?.model, { timeout: 25_000 }).toEqual(scriptedModel);
  const agent = await projected();
  expect(agent).toMatchObject({ name: profileId, mode: 'all', model: scriptedModel });
  const rules = agent!.permission as Array<{ permission: string; pattern: string; action: string }>;
  for (const permission of ['*', 'task', 'rhythm_delegate_async', 'image_generation']) expect(rules).toContainEqual({ permission, pattern: '*', action: 'deny' });
  const lastWildcard = rules.map(row => row.permission).lastIndexOf('*');
  expect(lastWildcard).toBeGreaterThanOrEqual(0);
  expect(rules[lastWildcard]).toEqual({ permission: '*', pattern: '*', action: 'deny' });
  const truncate = path.join(parity.sandbox, 'home/.local/share/opencode/tool-output/*');
  expect(rules.slice(lastWildcard + 1).every(row => row.action === 'deny' || row.permission === 'external_directory' && row.pattern === truncate && row.action === 'allow')).toBe(true);
}

/** Cleanup authority survives generated titles: bind id, SDK id, owner, profile and unique cwd. */
export async function createScriptedSession(parity: ParitySandbox, profileId: string, name: string) {
  assert(name === '' || name.startsWith(parity.prefix));
  let id: string | undefined;
  parity.deferCleanup('remove exact scripted session API DB engine', async () => {
    const rows = parity.rows('SELECT id,cwd,profile_id,owner_user_id,sdk_session_id FROM agent_sessions WHERE cwd=? AND profile_id=?', parity.cwd, profileId);
    for (const row of rows) {
      expect(row).toMatchObject({ cwd: parity.cwd, profile_id: profileId, owner_user_id: 1 });
      if (id) expect(row.id).toBe(id);
      expect((await parity.api.fetch(`/agent-sessions/${row.id}/hard`, { method: 'DELETE' })).status).toBe(204);
      expect((await parity.api.fetch(`/agent-sessions/${row.id}`)).status).toBe(404);
      expect(parity.rows('SELECT id FROM agent_sessions WHERE id=?', row.id)).toEqual([]);
      if (row.sdk_session_id) expect((await parity.engineFetch(`/session/${encodeURIComponent(String(row.sdk_session_id))}`)).status).toBe(404);
    }
  });
  const created = await parity.api.request('POST', '/agent-sessions', { name, cwd: parity.cwd, profileId, modelMode: 'fixed', isolateWorktree: false });
  expect(created.status).toBe(201);
  const row = await created.json() as Row;
  expect(row).toMatchObject({ id: expect.any(String), sdkSessionId: expect.any(String), cwd: parity.cwd, profileId, ownerUserId: 1, modelMode: 'fixed' });
  id = row.id;
  return row;
}

export async function engineMessages(parity: ParitySandbox, sdkId: string) {
  const response = await parity.engineFetch(`/session/${encodeURIComponent(sdkId)}/message?limit=100`);
  expect(response.status).toBe(200);
  return await response.json() as EngineMessage[];
}
export function completed(messages: EngineMessage[]) { return messages.filter(row => row.info.role === 'assistant' && row.info.time?.completed && !row.info.error); }
export function noToolParts(messages: EngineMessage[]) { expect(messages.flatMap(row => row.parts).filter(part => part.type === 'tool')).toEqual([]); }

export async function sendScriptedTurn(page: Page, parity: ParitySandbox, session: Row, prompt: string) {
  await page.getByTestId('composer-input').fill(prompt);
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('transcript')).toContainText(scriptedAnswer, { timeout: 40_000 });
  await expect(page.getByTestId('composer-send')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const messages = await engineMessages(parity, String(session.sdkSessionId));
    const user = messages.find(row => row.info.role === 'user' && row.parts.some(part => part.text === prompt));
    return completed(messages).some(row => row.info.parentID === user?.info.id && row.parts.some(part => part.type === 'text' && part.text?.trim() === scriptedAnswer));
  }, { timeout: 30_000 }).toBe(true);
  const messages = await engineMessages(parity, String(session.sdkSessionId));
  const users = messages.filter(row => row.info.role === 'user' && row.parts.some(part => part.text === prompt));
  expect(users).toHaveLength(1);
  const answers = completed(messages).filter(row => row.info.parentID === users[0].info.id && row.parts.some(part => part.type === 'text' && part.text?.trim() === scriptedAnswer));
  expect(answers).toHaveLength(1);
  expect(answers[0].info).toMatchObject(scriptedModel);
  noToolParts(messages);
  await expect.poll(async () => {
    const detail = await parity.api.json<SessionDetail>(`/agent-sessions/${session.id}`);
    return detail.messages.filter(row => row.role === 'output' && row.sdkMessageId === answers[0].info.id && row.rawText.trim() === scriptedAnswer).length;
  }).toBe(1);
  const detail = await parity.api.json<SessionDetail>(`/agent-sessions/${session.id}`);
  expect(detail.messages.filter(row => row.role === 'input' && row.rawText === prompt)).toMatchObject([{ sdkMessageId: users[0].info.id }]);
  expect(detail.session.status).toBe('idle');
  return { messages, user: users[0], answer: answers[0], detail };
}

/** Read only; callers must first prove the background row belongs to their exact source or schedule. */
export async function backgroundEngineRead(parity: ParitySandbox, row: { id: string; cwd: string; sdk_session_id: string }, suffix = '') {
  assert(row.cwd === parity.sandbox, 'Background jobs must remain in the validated sandbox API cwd');
  assert(suffix === '' || suffix === '/message?limit=100');
  expect(parity.rows('SELECT id,cwd,sdk_session_id FROM agent_sessions WHERE id=?', row.id)).toEqual([{ id: row.id, cwd: row.cwd, sdk_session_id: row.sdk_session_id }]);
  const url = new URL(`/session/${encodeURIComponent(row.sdk_session_id)}${suffix}`, `http://127.0.0.1:${parity.enginePort}`);
  url.searchParams.set('directory', row.cwd);
  return fetch(url, { signal: AbortSignal.timeout(20_000) });
}
export function sandboxLog(parity: ParitySandbox) {
  const file = path.join(parity.sandbox, 'api_server.log');
  assert.equal(realpathSync(file), file);
  return readFileSync(file, 'utf8');
}
