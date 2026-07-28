/**
 * Live E2E test for #1211 — stalled provider streams must become terminal.
 *
 * The sandbox engine must be configured with the `stalltest/stall-model`
 * OpenAI-compatible provider pointing at STALL_PROVIDER_URL. This test hosts
 * that provider, emits one valid SSE chunk, and then deliberately never emits
 * a finish event. The assertion is against Rhythm's public session API.
 *
 * Run:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   STALL_PROVIDER_URL=http://127.0.0.1:4197 \
 *     npx vitest run src/__tests__/issue_1211_live_e2e.test.ts
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const PROVIDER_URL = new URL(process.env.STALL_PROVIDER_URL ?? 'http://127.0.0.1:4197');
const describeLive = LIVE ? describe : describe.skip;

const createdAgentIds: string[] = [];
const createdSessionIds: string[] = [];
let providerServer: Server | undefined;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 100,
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
  throw new Error(`poll timed out after ${timeoutMs}ms; last=${String(lastError)}`);
}

beforeAll(async () => {
  if (!LIVE) return;
  if (BASE.includes(':4001') || BASE.includes(':4096')) {
    throw new Error('refusing to run #1211 live E2E against live app ports');
  }

  providerServer = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.write(
      'data: {"id":"stall-1211","object":"chat.completion.chunk","created":1,' +
        '"model":"stall-model","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
    );
  });
  await new Promise<void>((resolve, reject) => {
    providerServer!.once('error', reject);
    providerServer!.listen(Number(PROVIDER_URL.port), PROVIDER_URL.hostname, resolve);
  });

  const health = await api('/health');
  if (!health.ok) throw new Error(`sandbox server is not reachable at ${BASE}`);
  const engine = await apiJson<{ status: string }>('/opencode/health');
  if (engine.status !== 'ready') throw new Error(`fork engine is not ready: ${engine.status}`);
});

afterEach(async () => {
  for (const id of createdSessionIds.splice(0)) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of createdAgentIds.splice(0)) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
});

afterAll(async () => {
  if (!providerServer) return;
  providerServer.closeAllConnections();
  await new Promise<void>((resolve) => providerServer!.close(() => resolve()));
});

describeLive('live E2E — #1211 stalled provider stream', () => {
  it(
    'moves the public Rhythm session from working to a useful timeout error',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const agentId = `live-1211-${suffix}`;
      const agent = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: agentId,
          label: `1211 stalled provider ${suffix}`,
          isAgent: true,
          modelProvider: 'stalltest',
          modelId: 'stall-model',
          systemPrompt: 'Reply with one word.',
        }),
      });
      createdAgentIds.push(agent.id);

      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          name: `1211 provider inactivity probe ${suffix}`,
          cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
        }),
      });
      createdSessionIds.push(session.id);

      const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      try {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'session.input',
            id: session.id,
            data: 'Trigger the deliberately stalled provider.',
            modelOverride: { providerId: 'stalltest', modelId: 'stall-model' },
          }),
        );

        const terminal = await poll(async () => {
          const snapshot = await apiJson<{
            session: { status: string; statusMessage?: string | null };
          }>(`/agent-sessions/${session.id}`);
          if (snapshot.session.status === 'working' || snapshot.session.status === 'starting') {
            throw new Error(`session still ${snapshot.session.status}`);
          }
          return snapshot.session;
        }, 15_000);

        expect(terminal.status).toBe('error');
        expect(terminal.statusMessage).toContain('Provider stream inactive');
      } finally {
        ws.close();
      }
    },
    30_000,
  );
});
