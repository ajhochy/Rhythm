import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const API = process.env.RHYTHM_LIVE_API_URL;
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL;
const sandbox = process.env.RHYTHM_SANDBOX_DIR;
const marker = `issue-1576-${randomUUID()}`;
let token: string;
let profileId: string;
let localSession: { id: string; sdkSessionId: string };

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
}

async function apiJson(path: string, init: RequestInit = {}): Promise<any> {
  const response = await api(path, init);
  expect(response.status).toBeLessThan(300);
  return response.json();
}

async function engine(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${ENGINE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-opencode-directory': sandbox!, ...init.headers },
  });
}

async function waitFor<T>(read: () => Promise<T | undefined>, timeout = 120_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for routed provenance');
}

describe.skipIf(!live)('#1576 routed provenance in the isolated live sandbox', () => {
  beforeAll(async () => {
    expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
    if (!API || !ENGINE || !sandbox) throw new Error('isolated API, engine and sandbox variables are required');
    for (const value of [API, ENGINE]) {
      const url = new URL(value);
      expect(url.hostname).toBe('127.0.0.1');
      expect(['4001', '4096']).not.toContain(url.port);
    }
    const db = new Database(`${sandbox}/rhythm.db`, { readonly: true });
    try {
      token = (db.prepare('SELECT token FROM sessions ORDER BY created_at DESC LIMIT 1').get() as { token: string }).token;
    } finally {
      db.close();
    }
    profileId = (await apiJson('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({ label: marker, icon: 'route', ocAgent: 'build', modelProvider: 'openrouter', modelId: 'openrouter/free' }),
    })).id;
    localSession = await apiJson('/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({ profileId, cwd: sandbox, name: marker }),
    });
  });

  afterAll(async () => {
    if (localSession) await api(`/agent-sessions/${localSession.id}/hard`, { method: 'DELETE' }).catch(() => undefined);
    if (profileId) await api(`/agent-configs/${profileId}`, { method: 'DELETE' }).catch(() => undefined);
  });

  it('issue-1576-c8: routed alias publishes concrete served identity, survives forged PATCH, and links its dispatch projection', async () => {
    const sent = await api(`/agent-sessions/${localSession.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Reply with exactly: OK', provenance: { origin: 'forged' } }),
    });
    expect(sent.status).toBe(202);

    const finish = await waitFor(async () => {
      const response = await engine(`/session/${localSession.sdkSessionId}/message`);
      if (!response.ok) return undefined;
      const messages = await response.json() as Array<{ parts?: Array<Record<string, any>> }>;
      return messages.flatMap((message) => message.parts ?? []).find((part) =>
        part.type === 'step-finish' && part.served?.responseID?.startsWith('gen-'));
    });
    expect(finish.served.modelID).not.toBe('openrouter/free');
    expect(finish.served.responseID).toMatch(/^gen-/);
    expect(finish.served.requestModelID).toBe('openrouter/free');

    const forged = { ...finish, served: { modelID: 'forged/model', responseID: 'gen-forged', requestModelID: 'forged/request' } };
    const patch = await engine(`/session/${localSession.sdkSessionId}/message/${finish.messageID}/part/${finish.id}`, {
      method: 'PATCH',
      body: JSON.stringify(forged),
    });
    expect(patch.status).toBe(200);
    const history = await (await engine(`/session/${localSession.sdkSessionId}/message`)).json() as Array<{ parts?: Array<Record<string, any>> }>;
    const persisted = history.flatMap((message) => message.parts ?? []).find((part) => part.id === finish.id)!;
    expect(persisted.served).toEqual(finish.served);

    const projection = await waitFor(async () => {
      const value = await apiJson(`/agent-sessions/${localSession.id}/model-provenance`);
      return value.servedModels?.includes(finish.served.modelID) && value.dispatches?.[0]?.sdkUserMessageId
        ? value
        : undefined;
    });
    expect(projection.routed).toBe(true);
    expect(projection.dispatches[0]).toMatchObject({ origin: 'prompt_api', outcome: 'accepted' });
  }, 180_000);

  it('issue-1576-c9: nonexistent model failure never fabricates served identity', async () => {
    const created = await engine('/session', { method: 'POST', body: '{}' });
    expect(created.status).toBe(200);
    const id = (await created.json() as { id: string }).id;
    try {
      const response = await engine(`/session/${id}/message`, {
        method: 'POST',
        body: JSON.stringify({ agent: 'build', model: { providerID: 'openrouter', modelID: 'does-not-exist-1576' }, parts: [{ type: 'text', text: 'never sent' }] }),
      });
      expect(response.ok).toBe(false);
      const history = await (await engine(`/session/${id}/message`)).json() as Array<{ parts?: Array<Record<string, any>> }>;
      expect(history.flatMap((message) => message.parts ?? []).some((part) => part.served)).toBe(false);
    } finally {
      await engine(`/session/${id}`, { method: 'DELETE' });
    }
  });
});
