/**
 * Live behavioral gate for #1457. Run only after the shared sandbox is assigned:
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 DB_PATH=<sandbox>/rhythm.db \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
 * npx vitest run src/__tests__/issue_1457_global_stream_retry_live_e2e.test.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const SANDBOX = process.env.RHYTHM_SANDBOX_DIR ?? '';
const ROOT = resolve(__dirname, '../../../..');
const SANDBOX_SCRIPT = resolve(ROOT, 'tools/dev/sandbox.sh');

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json() as Promise<T>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

function recordedPid(name: 'api_server.pid' | 'opencode_engine.pid'): number {
  return Number(readFileSync(resolve(SANDBOX, name), 'utf8').trim());
}

function restartEngine(): void {
  execFileSync(SANDBOX_SCRIPT, ['restart-engine'], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    timeout: 30_000,
  });
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for engine/bridge recovery');
}

describeLive('issue #1457 live global stream recovery', () => {
  beforeAll(() => {
    assertLiveE2EIsolation();
    expect(SANDBOX.startsWith('/')).toBe(true);
    expect(new URL(API).port).toBe('4098');
    expect(new URL(ENGINE).port).toBe('4097');
  });

  it('recovers the bridge after the isolated engine process is replaced', async () => {
    const apiPid = recordedPid('api_server.pid');
    const before = await json<{ pid: number; bootId: string }>(`${ENGINE}/global/health`);
    expect(recordedPid('opencode_engine.pid')).toBe(before.pid);
    process.kill(before.pid, 'SIGTERM');

    await waitFor(async () => {
      const available = await fetch(`${ENGINE}/global/health`)
        .then((response) => response.ok)
        .catch(() => false);
      return available ? null : true;
    });
    const degraded = await waitFor(async () => {
      const response = await fetch(`${API}/opencode/health`);
      const health = await response.json() as {
        status: string;
        bridgeLive: boolean;
        message: string;
      };
      return !health.bridgeLive ? health : null;
    });
    expect(degraded).toMatchObject({ status: 'unavailable', bridgeLive: false });

    restartEngine();
    expect(recordedPid('api_server.pid')).toBe(apiPid);

    const after = await waitFor(async () => {
      const identity = await json<{ pid: number; bootId: string }>(`${ENGINE}/global/health`);
      return identity.pid !== before.pid && identity.bootId !== before.bootId ? identity : null;
    });
    expect(after.pid).not.toBe(before.pid);
    expect(after.bootId).not.toBe(before.bootId);
    expect(recordedPid('opencode_engine.pid')).toBe(after.pid);

    const health = await waitFor(async () => {
      const value = await json<{ status: string; bridgeLive: boolean }>(`${API}/opencode/health`);
      return value.status === 'ready' && value.bridgeLive ? value : null;
    });
    expect(health).toMatchObject({ status: 'ready', bridgeLive: true });

    const socket = new WebSocket(API.replace(/^http/, 'ws') + '/ws/agents');
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket.once('open', resolveOpen);
      socket.once('error', rejectOpen);
    });
    const observed = new Set<string>();
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as {
        type?: string;
        properties?: { info?: { id?: string } };
      };
      const id = frame.properties?.info?.id;
      if (frame.type === 'session.created' && id) observed.add(id);
    });

    let parent: { id: string; sdkSessionId: string } | undefined;
    let childId: string | undefined;
    try {
      const runId = randomUUID();
      parent = await requestJson<{ id: string; sdkSessionId: string }>(
        `${API}/agent-sessions`,
        {
          method: 'POST',
          body: JSON.stringify({
            agentId: null,
            cwd: SANDBOX,
            name: `#1457 recovered bridge ${runId}`,
          }),
        },
      );
      const child = await requestJson<{ id: string }>(`${ENGINE}/session`, {
        method: 'POST',
        body: JSON.stringify({
          title: `#1457 recovery child ${runId}`,
          parentID: parent.sdkSessionId,
          permission: [{ permission: '*', pattern: '*', action: 'allow' }],
        }),
      });
      childId = child.id;
      await waitFor(async () => observed.has(child.id) ? true : null, 15_000);
      expect(observed.has(child.id)).toBe(true);

      await waitFor(async () => {
        const page = await requestJson<{
          sessions: Array<{ sdkSessionId: string | null }>;
        }>(`${API}/agent-sessions?scope=chats`);
        return page.sessions.some(({ sdkSessionId }) => sdkSessionId === child.id)
          ? true
          : null;
      }, 15_000);
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      const persisted = await requestJson<{
        sessions: Array<{ sdkSessionId: string | null }>;
      }>(`${API}/agent-sessions?scope=chats`);
      expect(persisted.sessions.some(({ sdkSessionId }) => sdkSessionId === child.id)).toBe(true);
    } finally {
      socket.close();
      if (childId) await fetch(`${ENGINE}/session/${childId}`, { method: 'DELETE' }).catch(() => undefined);
      if (parent) await fetch(`${API}/agent-sessions/${parent.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  }, 90_000);
});
