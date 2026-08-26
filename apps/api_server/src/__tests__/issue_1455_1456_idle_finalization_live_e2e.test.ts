/** Live behavioral gates for #1455/#1456; run only in the isolated sandbox. */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const MARKER = 'RHYTHM_IDLE_FINALIZATION_1456';
const created: string[] = [];

type Message = {
  role?: string;
  sdkMessageId?: string | null;
  parts?: Array<{ type?: string; text?: string; reason?: string }>;
};

type Frame = {
  type?: string;
  id?: string;
  role?: string;
  text?: string;
  message?: string;
  stopReason?: string;
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function engineJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ENGINE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function poll<T>(read: () => Promise<T | null>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`poll timed out after ${timeoutMs}ms`);
}

async function openSocket(): Promise<WebSocket> {
  const socket = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function waitForFrame(
  socket: WebSocket,
  matches: (frame: Frame) => boolean,
  timeoutMs = 90_000,
): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`WebSocket frame timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onMessage = (raw: RawData) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      if (!matches(frame)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(frame);
    };
    socket.on('message', onMessage);
  });
}

function refusalStream(model: string): string {
  const events = [
    {
      type: 'message_start',
      message: {
        id: `msg_1455_${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'refusal', stop_sequence: null },
      usage: { input_tokens: 5, output_tokens: 0 },
    },
    { type: 'message_stop' },
  ];
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`;
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((id) =>
    fetch(`${BASE}/agent-sessions/${id}`, { method: 'DELETE' }),
  ));
});

describeLive('issues #1455/#1456 live idle finalization', () => {
  beforeAll(() => assertLiveE2EIsolation());

  it('#1456 persists one structured assistant turn and independently publishes transcript and preview', async () => {
    const session = await apiJson<{ id: string }>('/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({
        agentId: null,
        cwd: '/tmp',
        name: '#1456 idle finalization',
        permissionMode: 'default',
      }),
    });
    created.push(session.id);

    const socket = await openSocket();
    try {
      const appendPromise = waitForFrame(socket, (frame) =>
        frame.type === 'transcript.append' &&
        frame.id === session.id &&
        frame.role === 'output' &&
        frame.text?.includes(MARKER) === true,
      );
      socket.send(JSON.stringify({
        v: 1,
        type: 'session.input',
        id: session.id,
        data: `Reply with exactly ${MARKER} and nothing else.`,
      }));

      const append = await appendPromise;
      expect(append).toMatchObject({
        type: 'transcript.append', id: session.id, role: 'output',
      });
      expect(append.text).toContain(MARKER);

      const output = await poll(async () => {
        const page = await apiJson<{ messages: Message[] }>(
          `/agent-sessions/${session.id}/messages`,
        );
        const outputs = page.messages.filter(({ role }) => role === 'output');
        return outputs.length === 1 &&
          outputs[0].sdkMessageId != null &&
          outputs[0].parts?.some((part) =>
            part.type === 'text' && part.text?.includes(MARKER),
          )
          ? outputs[0]
          : null;
      });
      expect(output.sdkMessageId).toBeTruthy();
      expect(output.parts).toContainEqual(expect.objectContaining({
        type: 'text', text: expect.stringContaining(MARKER),
      }));

      const detail = await poll(async () => {
        const value = await apiJson<{
          session: { status: string; lastPreview: string | null };
        }>(`/agent-sessions/${session.id}`);
        return value.session.status === 'idle' && value.session.lastPreview?.includes(MARKER)
          ? value.session
          : null;
      });
      expect(detail).toMatchObject({ status: 'idle' });
      expect(detail.lastPreview).toContain(MARKER);

      const persisted = await apiJson<{ messages: Message[] }>(
        `/agent-sessions/${session.id}/messages`,
      );
      const outputs = persisted.messages.filter(({ role }) => role === 'output');
      expect(outputs).toHaveLength(1);
      expect(outputs[0].sdkMessageId).not.toBeNull();
    } finally {
      socket.close();
    }
  }, 100_000);

  it('#1455 maps a real provider refusal to one persisted content-filter finish and an actionable error', async () => {
    const providerId = `issue-1455-${process.pid}`;
    const modelId = 'content-filter-fixture';
    const originalConfig = await engineJson<Record<string, unknown>>('/global/config');
    const config = structuredClone(originalConfig) as {
      provider?: Record<string, unknown>;
    };
    let provider: Server | null = null;
    let socket: WebSocket | null = null;

    try {
      provider = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(refusalStream(modelId));
      });
      await new Promise<void>((done, reject) => {
        provider?.once('error', reject);
        provider?.listen(0, '127.0.0.1', done);
      });
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('provider fixture did not bind');

      config.provider = config.provider ?? {};
      config.provider[providerId] = {
        npm: '@ai-sdk/anthropic',
        name: '#1455 content-filter fixture',
        options: { apiKey: 'issue-1455-fixture', baseURL: `http://127.0.0.1:${address.port}/v1` },
        models: { [modelId]: { name: modelId, limit: { context: 20_000, output: 1_000 } } },
      };
      await engineJson('/global/config', { method: 'PATCH', body: JSON.stringify(config) });
      const refresh = await fetch(`${BASE}/system/refresh`, { method: 'POST' });
      expect(refresh.status, await refresh.clone().text()).toBe(200);

      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: null,
          cwd: '/tmp',
          name: '#1455 content-filter refusal',
          permissionMode: 'default',
        }),
      });
      created.push(session.id);

      socket = await openSocket();
      const errorPromise = waitForFrame(socket, (frame) =>
        frame.type === 'error' && frame.id === session.id,
      );
      socket.send(JSON.stringify({
        v: 1,
        type: 'session.input',
        id: session.id,
        data: 'Trigger the controlled zero-text refusal.',
        modelOverride: { providerId, modelId },
      }));

      const error = await errorPromise;
      expect(error).toMatchObject({
        type: 'error', id: session.id, stopReason: 'content-filter',
      });
      expect(error.message).toMatch(/content filter/i);
      expect(error.message).toMatch(/start (a )?new session/i);

      const output = await poll(async () => {
        const page = await apiJson<{ messages: Message[] }>(
          `/agent-sessions/${session.id}/messages`,
        );
        const outputs = page.messages.filter(({ role }) => role === 'output');
        return outputs.length === 1 && outputs[0].parts?.some((part) =>
          part.type === 'step-finish' && part.reason === 'content-filter',
        )
          ? outputs[0]
          : null;
      });
      expect(output.parts).toContainEqual(expect.objectContaining({
        type: 'step-finish', reason: 'content-filter',
      }));
      expect(output.parts?.filter((part) =>
        part.type === 'text' && (part.text?.trim().length ?? 0) > 0,
      )).toEqual([]);
    } finally {
      socket?.close();
      await engineJson('/global/config', {
        method: 'PATCH', body: JSON.stringify(originalConfig),
      }).catch(() => undefined);
      await fetch(`${BASE}/system/refresh`, { method: 'POST' }).catch(() => undefined);
      await closeServer(provider);
    }
  }, 100_000);
});
