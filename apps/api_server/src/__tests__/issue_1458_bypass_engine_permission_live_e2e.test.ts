/**
 * Live behavioral gate for #1458. The session is created through Rhythm's real
 * API, then inspected through the real engine API to prove bypass is engine-side.
 * Do not run outside the isolated sandbox.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const created: string[] = [];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((id) =>
    fetch(`${API}/agent-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  ));
});

describeLive('issue #1458 live engine-side permission bypass', () => {
  beforeAll(() => assertLiveE2EIsolation());

  it('creates wildcard engine permission covering external_directory with no pending ask', async () => {
    const session = await json<{ id: string; sdkSessionId: string }>(`${API}/agent-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        agentId: null,
        cwd: '/tmp',
        name: '#1458 engine bypass',
        permissionMode: 'bypassPermissions',
      }),
    });
    created.push(session.id);

    const engineSession = await json<{
      permission?: Array<{ permission: string; pattern: string; action: string }>;
    }>(`${ENGINE}/session/${encodeURIComponent(session.sdkSessionId)}`);
    expect(engineSession.permission).toContainEqual({
      permission: '*', pattern: '*', action: 'allow',
    });
    expect(['bash', 'external_directory', 'edit'].every((permission) =>
      engineSession.permission?.some((rule) =>
        (rule.permission === '*' || rule.permission === permission) &&
        rule.pattern === '*' && rule.action === 'allow'),
    )).toBe(true);

    const pending = await json<Array<{ sessionID: string }>>(`${ENGINE}/permission`);
    expect(pending.filter((ask) => ask.sessionID === session.sdkSessionId)).toEqual([]);
  });
});
