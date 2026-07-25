/**
 * Live behavioral gate for #1164.
 *
 * Drives 50 concurrent child reader turns through the fork's real HTTP API.
 * The api_server is still used to create/project the disposable reader profile
 * and to prove the sandbox engine is healthy. The normal Vitest suite skips
 * this unless RHYTHM_LIVE_E2E=1. The isolation guard forbids the live app/DB.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE_BASE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const describeLive = LIVE ? describe : describe.skip;
const READER_COUNT = 50;
const DIRECTORY = process.cwd();

let createdAgentId: string | undefined;
let createdEngineSessionIds: string[] = [];
let readerModel: { providerID: string; modelID: string } | undefined;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function engineJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(path, ENGINE_BASE);
  url.searchParams.set('directory', DIRECTORY);
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`engine ${path} → ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(`poll timed out after ${timeoutMs}ms: ${String(lastError)}`);
}

async function createReaderAgent(): Promise<string> {
  const catalog = await apiJson<
    Array<{
      providerId: string;
      modelId: string;
      authorized: boolean;
    }>
  >('/agents/models/catalog');
  const model = catalog.find((item) => item.authorized && item.providerId && item.modelId);
  if (!model) throw new Error('PRECONDITION: sandbox has no authorized model for the 50-reader live gate');
  readerModel = { providerID: model.providerId, modelID: model.modelId };

  const profile = await apiJson<{ id: string }>('/agent-configs', {
    method: 'POST',
    body: JSON.stringify({
      label: `E2E 1164 Reader ${Date.now()}`,
      isAgent: true,
      enabled: true,
      sessionSelectable: true,
      modelProvider: model.providerId,
      modelId: model.modelId,
      allowedMcpsJson: '[]',
      allowedSkillsJson: '[]',
      systemPrompt:
        'You are a read-only smoke-test reader. Do not call tools. Reply with exactly READY-1164 and stop.',
    }),
  });
  createdAgentId = profile.id;
  const refresh = await api('/system/refresh', { method: 'POST' });
  expect(refresh.ok).toBe(true);
  await poll(async () => {
    const agents = await apiJson<{ agents: Array<{ name: string }> }>('/agent-sessions/agents');
    if (!agents.agents.some((agent) => agent.name === profile.id)) {
      throw new Error(`reader profile ${profile.id} not visible in the real engine registry`);
    }
    return true;
  }, 15_000);
  return profile.id;
}

async function createEngineSession(title: string, parentID?: string): Promise<string> {
  const session = await engineJson<{ id: string }>('/session', {
    method: 'POST',
    body: JSON.stringify({
      title,
      ...(parentID ? { parentID } : {}),
      permission: [{ permission: '*', pattern: '*', action: 'allow' }],
    }),
  });
  createdEngineSessionIds.push(session.id);
  return session.id;
}

async function runReader(sessionID: string, agent: string): Promise<string> {
  if (!readerModel) throw new Error('reader model was not resolved');
  const result = await engineJson<{
    info: { role: string; error?: unknown };
    parts: Array<{ type?: string; text?: string }>;
  }>(`/session/${sessionID}/message`, {
    method: 'POST',
    body: JSON.stringify({
      agent,
      model: readerModel,
      parts: [{ type: 'text', text: 'Reply with exactly READY-1164 and stop.' }],
    }),
  });
  if (result.info.error) throw new Error(`${sessionID} returned ${JSON.stringify(result.info.error)}`);
  return result.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

afterEach(async () => {
  for (const id of createdEngineSessionIds.reverse()) {
    await engineJson(`/session/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  if (createdAgentId) {
    await api(`/agent-configs/${createdAgentId}`, { method: 'DELETE' }).catch(() => {});
  }
  createdEngineSessionIds = [];
  createdAgentId = undefined;
  readerModel = undefined;
});

describeLive('live E2E — #1164 50-reader swarm', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    expect(new URL(ENGINE_BASE).port, 'live gate must use sandbox engine :4097, never app engine :4096').toBe(
      '4097',
    );
    expect((await apiJson<{ status: string }>('/opencode/health')).status).toBe('ready');
    expect((await engineJson<{ healthy: boolean }>('/global/health')).healthy).toBe(true);
  });

  it(
    'issue-1164-c10: 50 real reader sessions enter model execution and return output',
    async () => {
      const agentId = await createReaderAgent();
      const parentID = await createEngineSession('e2e-1164-parent');
      const children = await Promise.all(
        Array.from({ length: READER_COUNT }, (_, index) =>
          createEngineSession(`e2e-1164-reader-${index}`, parentID),
        ),
      );
      expect(children).toHaveLength(READER_COUNT);

      const output = await Promise.all(children.map((sessionID) => runReader(sessionID, agentId)));
      expect(output).toHaveLength(READER_COUNT);
      expect(
        output.filter((text) => text.includes('READY-1164')),
        'all 50 child readers must enter real model execution and return their marker',
      ).toHaveLength(READER_COUNT);
    },
    660_000,
  );
});
