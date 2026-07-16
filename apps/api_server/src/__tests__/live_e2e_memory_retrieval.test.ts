/**
 * #1093 live contract. Requires an isolated sandbox plus an Engraph 1.7.2
 * loopback server indexing that sandbox's memory directory.
 *
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_ENGRAPH_PID=<server-pid> \
 * RHYTHM_LIVE_ENGRAPH_SEMANTIC_PATH=<pre-indexed-memory-path> \
 * RHYTHM_LIVE_ENGRAPH_SEMANTIC_MARKER=<pre-indexed-marker> \
 * npx vitest run src/__tests__/live_e2e_memory_retrieval.test.ts
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGRAPH = process.env.ENGRAPH_MEMORY_URL ?? 'http://127.0.0.1:7788';
const describeLive = LIVE ? describe : describe.skip;

const sessions: string[] = [];
const memories: string[] = [];
let agentId: string | null = null;
let semanticPath: string;
let semanticMarker: string;

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) as T : undefined as T;
}

async function poll<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  let error: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${label} timed out: ${String(error)}`);
}

async function createMemory(content: string): Promise<{ id: string; path: string }> {
  const memory = await apiJson<{ id: string; path: string }>('/agent-memory', {
    method: 'POST', body: JSON.stringify({ kind: 'fact', content }),
  });
  memories.push(memory.id);
  return memory;
}

async function createSession(): Promise<string> {
  if (!agentId) {
    const agent = await apiJson<{ id: string }>('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({
        label: `memory E2E ${randomUUID().slice(0, 8)}`,
        isAgent: true,
        enabled: true,
        sessionSelectable: true,
        modelProvider: 'openrouter',
        systemPrompt: 'Reply briefly to every user turn.',
      }),
    });
    agentId = agent.id;
  }
  const session = await apiJson<{ id: string }>('/agent-sessions', {
    method: 'POST', body: JSON.stringify({ agentId, name: '#1093 memory E2E', cwd: process.cwd() }),
  });
  sessions.push(session.id);
  return session.id;
}

async function sendPrompt(sessionId: string, prompt: string, expectedNotePath: string): Promise<void> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: prompt }));
  await poll(async () => {
    const provenance = await apiJson<{ notePaths: string[] }>(
      `/agent-sessions/${sessionId}/memory-provenance`,
    );
    if (!provenance.notePaths?.includes(expectedNotePath)) {
      throw new Error(`memory note ${expectedNotePath} not yet recorded`);
    }
    return provenance;
  }, `memory provenance for ${sessionId}`);
  ws.close();
}

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await fetch(`${BASE}/agent-sessions/${session}`, { method: 'DELETE' }).catch(() => undefined);
    await fetch(`${BASE}/agent-sessions/${session}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const memory of memories.splice(0)) {
    await fetch(`${BASE}/agent-memory/${memory}`, { method: 'DELETE' }).catch(() => undefined);
  }
  if (agentId) {
    await fetch(`${BASE}/agent-configs/${agentId}`, { method: 'DELETE' }).catch(() => undefined);
    agentId = null;
  }
});

describeLive('live E2E — #1093 hybrid Engraph memory retrieval', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    semanticPath = process.env.RHYTHM_LIVE_ENGRAPH_SEMANTIC_PATH?.trim() ?? '';
    semanticMarker = process.env.RHYTHM_LIVE_ENGRAPH_SEMANTIC_MARKER?.trim() ?? '';
    if (!semanticPath || !semanticMarker) {
      throw new Error('RHYTHM_LIVE_ENGRAPH_SEMANTIC_PATH and RHYTHM_LIVE_ENGRAPH_SEMANTIC_MARKER are required');
    }
    expect((await fetch(`${BASE}/health`)).ok).toBe(true);
    expect((await apiJson<{ status: string }>('/opencode/health')).status).toBe('ready');
    expect(new URL(ENGRAPH).hostname).toBe('127.0.0.1');
    expect((await fetch(`${ENGRAPH}/api/search`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'health', top_n: 1 }),
    })).ok).toBe(true);
  });

  it('injects a pre-indexed real Engraph file_path hit, then keeps a fresh FTS memory visible after Engraph stops', async () => {
    const response = await fetch(`${ENGRAPH}/api/search`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: semanticMarker, top_n: 5 }),
    });
    expect(response.ok).toBe(true);
    const body = await response.json() as unknown;
    const hits = Array.isArray(body)
      ? body
      : (body as { results?: unknown }).results;
    expect(Array.isArray(hits) && hits.some((hit) => (
      hit && typeof hit === 'object' && typeof (hit as { file_path?: unknown }).file_path === 'string'
    ))).toBe(true);

    const semanticSession = await createSession();
    await sendPrompt(semanticSession, semanticMarker, semanticPath);

    const freshMarker = `fresh-fts-${randomUUID()}`;
    const fresh = await createMemory(`Fresh fallback marker ${freshMarker}.`);

    const pid = Number(process.env.RHYTHM_LIVE_ENGRAPH_PID);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error('RHYTHM_LIVE_ENGRAPH_PID must identify the isolated Engraph service');
    }
    process.kill(pid, 'SIGTERM');
    await poll(async () => {
      try {
        await fetch(`${ENGRAPH}/api/search`);
      } catch {
        return true;
      }
      throw new Error('Engraph is still reachable');
    }, 'Engraph shutdown');

    const freshSession = await createSession();
    await sendPrompt(freshSession, freshMarker, fresh.path);
  }, 180_000);
});
