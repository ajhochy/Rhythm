/**
 * #1424 scripted-provider live matrix: busy-turn queue ordering, multi-select
 * question answers, and permission rejection feedback to the next model turn.
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:7473';
const PROVIDER_PORT = Number(process.env.RHYTHM_1424_PROVIDER_PORT ?? '7476');
const PROVIDER_BASE = `http://127.0.0.1:${PROVIDER_PORT}`;
const PROVIDER_ID = 'issue1424';
const MODEL_ID = 'turn-lifecycle-scripted';
const SYNTHETIC_TOKEN = 'e02-synthetic-session-not-a-secret';
const REJECTION_MESSAGE = 'Synthetic rejection reaches the next model request.';

let provider: ChildProcess | null = null;
let providerStderr = '';
const profileIds: string[] = [];
const sessionIds: string[] = [];
const authHeaders = {
  Authorization: `Bearer ${SYNTHETIC_TOKEN}`,
  'Content-Type': 'application/json',
};

type Frame = Record<string, unknown>;
type ProviderStatus = {
  queueOrder: string[];
  requestLog: Array<{ user: string; toolCallId: string | null; toolText: string }>;
  activeRequests: number;
  maxActiveRequests: number;
  questionSelectedLabels: string[];
  permissionFeedback: string;
};

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path.startsWith('http://') ? path : `${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  });
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) as T : undefined as T;
}

async function poll<T>(read: () => Promise<T | null>, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out${last ? `: ${String(last)}` : ''}`);
}

async function providerStatus(): Promise<ProviderStatus> {
  return json<ProviderStatus>(`${PROVIDER_BASE}/_1424/status`);
}

async function startProvider(): Promise<void> {
  provider = spawn(
    process.execPath,
    [join(__dirname, 'fixtures', 'scripted_openai_provider_1424.mjs')],
    {
      env: { ...process.env, RHYTHM_1424_PROVIDER_PORT: String(PROVIDER_PORT) },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  provider.stderr?.on('data', (chunk: Buffer) => { providerStderr += chunk.toString('utf8'); });
  await poll(async () => {
    if (provider?.exitCode !== null) {
      throw new Error(`provider exited: ${providerStderr || String(provider?.exitCode)}`);
    }
    return fetch(`${PROVIDER_BASE}/_1424/status`)
      .then((response) => response.ok ? true : null)
      .catch(() => null);
  }, 'scripted provider readiness', 10_000);
}

async function openSocket(frames: Frame[]): Promise<WebSocket> {
  const socket = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  socket.on('message', (raw: RawData) => {
    try { frames.push(JSON.parse(raw.toString()) as Frame); } catch { /* ignore */ }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function createProfileAndSession(label: string): Promise<{ profileId: string; sessionId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const profileId = `live-1424-${label}-${suffix}`;
  const profile = await json<{ id: string }>('/agent-configs', {
    method: 'POST',
    body: JSON.stringify({
      id: profileId,
      label: `#1424 ${label} ${suffix}`,
      isAgent: true,
      enabled: true,
      sessionSelectable: true,
      ocAgent: profileId,
      modelProvider: PROVIDER_ID,
      modelId: MODEL_ID,
      corePermissionsJson: JSON.stringify({ question: 'allow', bash: 'ask' }),
      systemPrompt: 'Follow the scripted provider protocol exactly.',
    }),
  });
  profileIds.push(profile.id);
  await json('/system/refresh', { method: 'POST' });
  const session = await json<{ id: string }>('/agent-sessions', {
    method: 'POST',
    body: JSON.stringify({
      agentId: profile.id,
      cwd: homedir(),
      name: `#1424 ${label}`,
      permissionMode: 'default',
    }),
  });
  sessionIds.push(session.id);
  return { profileId: profile.id, sessionId: session.id };
}

function sendPrompt(socket: WebSocket, sessionId: string, data: string, profileId: string): void {
  socket.send(JSON.stringify({
    v: 1,
    type: 'session.input',
    id: sessionId,
    data,
    agent: profileId,
    modelOverride: { providerId: PROVIDER_ID, modelId: MODEL_ID },
  }));
}

beforeAll(async () => {
  if (!LIVE) return;
  assertLiveE2EIsolation();
  expect(PROVIDER_PORT).toBeGreaterThanOrEqual(7470);
  expect(PROVIDER_PORT).toBeLessThanOrEqual(7479);
  expect(new URL(BASE).port).not.toMatch(/^(4000|4001|4002|4096|4097|4098|4099|5173)$/);
  await startProvider();
  expect((await api('/health')).ok).toBe(true);
  expect(await json<{ status: string }>('/opencode/health')).toMatchObject({ status: 'ready' });
});

afterEach(async () => {
  if (!LIVE) return;
  for (const id of sessionIds.splice(0).reverse()) {
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of profileIds.splice(0).reverse()) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
});

afterAll(async () => {
  if (!provider || provider.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => provider?.once('exit', () => resolve()));
  provider.kill('SIGTERM');
  await exited;
});

describeLive('#1424 live — scripted-provider turn lifecycle', () => {
  it('1424:mega-1042-scripted-provider-turn-lifecycle:2 preserves three busy-session prompts in send order', async () => {
    // Regression caught: concurrent WS handlers overwrite or reorder queued
    // prompts; the provider-observed exact sequence fails.
    const { profileId, sessionId } = await createProfileAndSession('queue');
    const frames: Frame[] = [];
    const socket = await openSocket(frames);
    try {
      sendPrompt(socket, sessionId, 'QUEUE-1', profileId);
      await poll(async () => {
        const status = await providerStatus();
        return status.queueOrder.includes('QUEUE-1') && status.activeRequests > 0 ? status : null;
      }, 'first provider request busy');
      sendPrompt(socket, sessionId, 'QUEUE-2', profileId);
      sendPrompt(socket, sessionId, 'QUEUE-3', profileId);

      const status = await poll(async () => {
        const value = await providerStatus();
        if (value.queueOrder.length < 3) throw new Error(JSON.stringify(value));
        return value;
      }, 'three queued provider requests');
      expect(status.queueOrder.slice(0, 3)).toEqual(['QUEUE-1', 'QUEUE-2', 'QUEUE-3']);
    } finally {
      socket.close();
    }
  }, 120_000);

  it('1424:mega-1042-scripted-provider-turn-lifecycle:3 sends exactly the selected multi-select labels to the next request', async () => {
    // Regression caught: the desktop-facing string[][] reply is flattened or
    // reordered before reaching the tool result in the next model request.
    const { profileId, sessionId } = await createProfileAndSession('question');
    const frames: Frame[] = [];
    const socket = await openSocket(frames);
    try {
      sendPrompt(socket, sessionId, 'QUESTION-MULTI', profileId);
      const asked = await poll(async () => {
        const frame = frames.find((item) => item.type === 'question.asked' && item.sessionId === sessionId);
        return typeof frame?.callId === 'string' ? frame : null;
      }, 'multi-select question ask');
      const reply = await api(
        `/agent-sessions/${sessionId}/question/${encodeURIComponent(String(asked.callId))}/reply`,
        { method: 'POST', body: JSON.stringify({ answers: [['Blue', 'Green']] }) },
      );
      expect(reply.status).toBe(204);
      const status = await poll(async () => {
        const value = await providerStatus();
        return value.questionSelectedLabels.length > 0 ? value : null;
      }, 'question answers in provider follow-up');
      expect(status.questionSelectedLabels).toEqual(['Blue', 'Green']);
    } finally {
      socket.close();
    }
  }, 120_000);

  it('1424:mega-1042-scripted-provider-turn-lifecycle:4 puts the permission rejection message in the next model request', async () => {
    // Regression caught: the rejection resolves the UI card but drops the
    // operator's reason before the engine resumes the model loop.
    const { profileId, sessionId } = await createProfileAndSession('permission');
    const frames: Frame[] = [];
    const socket = await openSocket(frames);
    try {
      sendPrompt(socket, sessionId, 'PERMISSION-REJECT', profileId);
      const asked = await poll(async () => {
        const frame = frames.find((item) =>
          item.type === 'permission.asked' &&
          item.sessionId === sessionId &&
          (typeof item.permissionId === 'string' || typeof item.permissionID === 'string'));
        if (!frame) {
          const status = await providerStatus();
          throw new Error(JSON.stringify({ status, frames: frames.slice(-12) }));
        }
        return frame;
      }, 'permission ask');
      const permissionId = String(asked.permissionId ?? asked.permissionID);
      const denied = await api(
        `/agent-sessions/${sessionId}/permission/${encodeURIComponent(permissionId)}/deny`,
        { method: 'POST', body: JSON.stringify({ message: REJECTION_MESSAGE }) },
      );
      expect(denied.status).toBe(204);
      const status = await poll(async () => {
        const value = await providerStatus();
        if (!value.permissionFeedback) throw new Error(JSON.stringify(value));
        return value;
      }, 'permission feedback in provider follow-up');
      expect(status.permissionFeedback).toContain(REJECTION_MESSAGE);
    } finally {
      socket.close();
    }
  }, 120_000);
});
