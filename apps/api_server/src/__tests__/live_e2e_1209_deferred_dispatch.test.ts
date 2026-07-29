import { beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_OPENCODE_URL ?? 'http://127.0.0.1:4097';
const DIR = process.env.RHYTHM_LIVE_CWD ?? process.env.HOME ?? '.';
const describeLive = LIVE ? describe : describe.skip;

interface SessionInfo {
  id: string;
  mcpAllowlist?: {
    servers: string[];
    tools: string[];
    deferred?: boolean;
    deferredServers?: string[];
  };
}

async function engineJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}directory=${encodeURIComponent(DIR)}`;
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

describeLive('issue #1209 live selective deferred dispatcher', () => {
  beforeAll(async () => {
    await engineJson('/session');
  });

  it('issue-1209-c10: real engine preserves selective deferred scope across PATCH', async () => {
    // Regression caught: the API computes deferredServers, but the real fork
    // schema strips it during PATCH, reverting the next turn to eager schemas.
    const created = await engineJson<SessionInfo>('/session', {
      method: 'POST',
      body: JSON.stringify({ title: '#1209 selective deferral' }),
    });
    try {
      const allowlist = {
        servers: ['propresenter', 'rhythm'],
        tools: [],
        deferredServers: ['propresenter'],
      };
      const patched = await engineJson<SessionInfo>(`/session/${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ mcpAllowlist: allowlist }),
      });
      expect(patched.mcpAllowlist).toEqual(allowlist);
      expect(patched.mcpAllowlist?.deferred).toBeUndefined();

      const persisted = await engineJson<SessionInfo>(`/session/${created.id}`);
      expect(persisted.mcpAllowlist).toEqual(allowlist);

      // Fail-closed schema: malformed selective state must not overwrite the
      // valid authorization object.
      const malformed = await fetch(
        `${BASE}/session/${created.id}?directory=${encodeURIComponent(DIR)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mcpAllowlist: {
              servers: ['propresenter'],
              tools: [],
              deferredServers: 'propresenter',
            },
          }),
        },
      );
      expect(malformed.ok).toBe(false);
      expect((await engineJson<SessionInfo>(`/session/${created.id}`)).mcpAllowlist).toEqual(allowlist);
    } finally {
      await engineJson(`/session/${created.id}`, { method: 'DELETE' }).catch(() => {});
    }
  });
});
