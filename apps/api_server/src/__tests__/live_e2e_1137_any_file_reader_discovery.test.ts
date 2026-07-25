/**
 * Live behavioral gate for #1137 — arbitrary local file reader discovery.
 *
 * This test drives the real Flutter entry shape through the running
 * api_server WebSocket and the standalone fork engine. It proves that an
 * unsupported binary is not rejected or forwarded to the model as opaque
 * bytes: the persisted user turn contains an actionable reader-discovery
 * task with the original path, MIME type, and available discovery routes.
 *
 * Run against an isolated sandbox built from this branch:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:5098 \
 *   DB_PATH=/tmp/rhythm-dev-sandbox-1137/rhythm.db \
 *   npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:5098';
const describeLive = LIVE ? describe : describe.skip;

const createdAgentIds: string[] = [];
const createdSessionIds: string[] = [];
const scratchDirs: string[] = [];

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
  intervalMs = 400,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    }
  }
  throw new Error(`poll timed out after ${timeoutMs}ms; last=${String(lastError)}`);
}

async function openWs(): Promise<WebSocket> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolvePromise, reject) => {
    ws.once('open', resolvePromise);
    ws.once('error', reject);
  });
  return ws;
}

afterEach(async () => {
  for (const id of createdSessionIds.splice(0)) {
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of createdAgentIds.splice(0)) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describeLive('live E2E — #1137 arbitrary file reader discovery', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (BASE.includes(':4001') || BASE.includes(':4096')) {
      throw new Error('refusing to run #1137 against the installed app; use an isolated sandbox');
    }
    const health = await api('/health');
    if (!health.ok) throw new Error(`sandbox server is not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') throw new Error(`fork engine is not ready: ${engine.status}`);
  });

  it(
    'persists an actionable discovery task for an unsupported local binary sent through session.input',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const agentId = `live1137reader${suffix}`;
      const agent = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: agentId,
          label: `Live 1137 reader ${suffix}`,
          isAgent: true,
          modelProvider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'google',
          modelId: process.env.RHYTHM_LIVE_MODEL_ID || 'gemini-2.5-pro',
          systemPrompt: 'Follow attachment reader discovery instructions before answering.',
        }),
      });
      createdAgentIds.push(agent.id);

      const cwd = mkdtempSync(join(tmpdir(), 'rhythm-live-1137-'));
      scratchDirs.push(cwd);
      const fixture = resolve(cwd, 'fixture.rhythmfixture');
      writeFileSync(fixture, Buffer.from([0x00, 0xff, 0x52, 0x48, 0x59, 0x54, 0x48, 0x4d]));

      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          name: `Live 1137 reader ${suffix}`,
          cwd,
        }),
      });
      createdSessionIds.push(session.id);

      const ws = await openWs();
      try {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'session.input',
            id: session.id,
            parts: [
              { type: 'text', text: 'Inspect the attached file and report what reader you use.' },
              {
                type: 'file',
                mime: 'application/x-rhythm-fixture',
                filename: 'fixture.rhythmfixture',
                url: pathToFileURL(fixture).href,
              },
            ],
          }),
        );

        const transcript = await poll(async () => {
          const snapshot = await apiJson<{ messages: unknown[] }>(`/agent-sessions/${session.id}`);
          const serialized = JSON.stringify(snapshot.messages);
          if (!serialized.includes('Attachment reader discovery required')) {
            throw new Error('reader-discovery task has not reached the persisted transcript');
          }
          return serialized;
        }, 60_000);

        expect(transcript).toContain(fixture);
        expect(transcript).toContain('application/x-rhythm-fixture');
        expect(transcript).toContain('.rhythmfixture');
        expect(transcript).toContain('available skills');
        expect(transcript).toContain('available MCP tools and servers');
        expect(transcript).toContain('web search');
        expect(transcript).toContain('Do not ignore or reject this attachment');
      } finally {
        ws.close();
      }
    },
    90_000,
  );
});
