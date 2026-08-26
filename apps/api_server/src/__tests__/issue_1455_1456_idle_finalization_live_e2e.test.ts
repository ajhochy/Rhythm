/** Live behavioral gates for #1455/#1456; run only in the isolated sandbox. */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const MARKER = 'RHYTHM_IDLE_FINALIZATION_1456';

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

type EngineMessage = {
  info?: {
    role?: string;
    model?: { providerID?: string; modelID?: string };
  };
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

function textStream(model: string): string {
  const events = [
    {
      type: 'message_start',
      message: {
        id: `msg_1456_${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: MARKER } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 5, output_tokens: 5 },
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

describeLive('issues #1455/#1456 live idle finalization', () => {
  beforeAll(() => assertLiveE2EIsolation());

  it('#1456 persists one structured assistant turn and independently publishes transcript and preview', async () => {
    const providerId = `issue-1456-${process.pid}-${randomUUID().slice(0, 8)}`;
    const modelId = `idle-finalization-${randomUUID().slice(0, 8)}`;
    let originalConfig: Record<string, unknown> | null = null;
    let provider: Server | null = null;
    let profile: { id: string } | null = null;
    let session: { id: string; sdkSessionId: string } | null = null;
    let socket: WebSocket | null = null;

    try {
      provider = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(textStream(modelId));
      });
      await new Promise<void>((done, reject) => {
        provider?.once('error', reject);
        provider?.listen(0, '127.0.0.1', done);
      });
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('provider fixture did not bind');

      originalConfig = await engineJson<Record<string, unknown>>('/global/config');
      const config = structuredClone(originalConfig) as { provider?: Record<string, unknown> };
      config.provider = config.provider ?? {};
      config.provider[providerId] = {
        npm: '@ai-sdk/anthropic',
        name: '#1456 idle-finalization fixture',
        options: { apiKey: 'issue-1456-fixture', baseURL: `http://127.0.0.1:${address.port}/v1` },
        models: { [modelId]: { name: modelId, limit: { context: 20_000, output: 1_000 } } },
      };
      await engineJson('/global/config', { method: 'PATCH', body: JSON.stringify(config) });
      const refresh = await fetch(`${BASE}/system/refresh`, { method: 'POST' });
      expect(refresh.status, await refresh.clone().text()).toBe(200);

      profile = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: `live-1456-${randomUUID().slice(0, 8)}`,
          label: '#1456 controlled idle finalization',
          isAgent: true,
          modelProvider: providerId,
          modelId,
          systemPrompt: `Reply with exactly ${MARKER} and nothing else.`,
        }),
      });
      session = await apiJson<{ id: string; sdkSessionId: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: profile.id,
          cwd: '/tmp',
          name: '#1456 idle finalization',
          permissionMode: 'default',
        }),
      });
      const activeSession = session;

      socket = await openSocket();
      const appendPromise = waitForFrame(socket, (frame) =>
        frame.type === 'transcript.append' &&
        frame.id === activeSession.id &&
        frame.role === 'output' &&
        frame.text?.includes(MARKER) === true,
      );
      socket.send(JSON.stringify({
        v: 1,
        type: 'session.input',
        id: activeSession.id,
        data: `Reply with exactly ${MARKER} and nothing else.`,
        modelOverride: { providerId, modelId },
      }));

      const userMessage = await poll(async () => {
        const messages = await engineJson<EngineMessage[]>(
          `/session/${encodeURIComponent(activeSession.sdkSessionId)}/message`,
        );
        return messages.find(({ info }) => info?.role === 'user') ?? null;
      });
      expect(userMessage.info?.model).toEqual({ providerID: providerId, modelID: modelId });

      const append = await appendPromise;
      expect(append).toMatchObject({
        type: 'transcript.append', id: activeSession.id, role: 'output',
      });
      expect(append.text).toContain(MARKER);

      const output = await poll(async () => {
        const page = await apiJson<{ messages: Message[] }>(
          `/agent-sessions/${activeSession.id}/messages`,
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
        }>(`/agent-sessions/${activeSession.id}`);
        return value.session.status === 'idle' && value.session.lastPreview?.includes(MARKER)
          ? value.session
          : null;
      });
      expect(detail).toMatchObject({ status: 'idle' });
      expect(detail.lastPreview).toContain(MARKER);

      const persisted = await apiJson<{ messages: Message[] }>(
        `/agent-sessions/${activeSession.id}/messages`,
      );
      const outputs = persisted.messages.filter(({ role }) => role === 'output');
      expect(outputs).toHaveLength(1);
      expect(outputs[0].sdkMessageId).not.toBeNull();
    } finally {
      socket?.close();
      if (session) {
        await fetch(`${BASE}/agent-sessions/${encodeURIComponent(session.id)}`, {
          method: 'DELETE',
        }).catch(() => undefined);
      }
      if (profile) {
        await fetch(`${BASE}/agent-configs/${encodeURIComponent(profile.id)}`, {
          method: 'DELETE',
        }).catch(() => undefined);
      }
      if (originalConfig) {
        await engineJson('/global/config', {
          method: 'PATCH', body: JSON.stringify(originalConfig),
        }).catch(() => undefined);
        await fetch(`${BASE}/system/refresh`, { method: 'POST' }).catch(() => undefined);
      }
      await closeServer(provider);
    }
  }, 100_000);

  it('#1455 maps a real provider refusal to one persisted content-filter finish and an actionable error', async () => {
    const providerId = `issue-1455-${process.pid}-${randomUUID().slice(0, 8)}`;
    const modelId = `content-filter-${randomUUID().slice(0, 8)}`;
    let originalConfig: Record<string, unknown> | null = null;
    let provider: Server | null = null;
    let profile: { id: string } | null = null;
    let session: { id: string; sdkSessionId: string } | null = null;
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

      originalConfig = await engineJson<Record<string, unknown>>('/global/config');
      const config = structuredClone(originalConfig) as { provider?: Record<string, unknown> };
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

      profile = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: `live-1455-${randomUUID().slice(0, 8)}`,
          label: '#1455 controlled content-filter refusal',
          isAgent: true,
          modelProvider: providerId,
          modelId,
          systemPrompt: 'Trigger the controlled zero-text refusal.',
        }),
      });
      session = await apiJson<{ id: string; sdkSessionId: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: profile.id,
          cwd: '/tmp',
          name: '#1455 content-filter refusal',
          permissionMode: 'default',
        }),
      });
      const activeSession = session;

      socket = await openSocket();
      const errorPromise = waitForFrame(socket, (frame) =>
        frame.type === 'error' && frame.id === activeSession.id,
      );
      socket.send(JSON.stringify({
        v: 1,
        type: 'session.input',
        id: activeSession.id,
        data: 'Trigger the controlled zero-text refusal.',
        modelOverride: { providerId, modelId },
      }));

      const userMessage = await poll(async () => {
        const messages = await engineJson<EngineMessage[]>(
          `/session/${encodeURIComponent(activeSession.sdkSessionId)}/message`,
        );
        return messages.find(({ info }) => info?.role === 'user') ?? null;
      });
      expect(userMessage.info?.model).toEqual({ providerID: providerId, modelID: modelId });

      const error = await errorPromise;
      expect(error).toMatchObject({
        type: 'error', id: activeSession.id, stopReason: 'content-filter',
      });
      expect(error.message).toMatch(/content filter/i);
      expect(error.message).toMatch(/start (a )?new session/i);

      const output = await poll(async () => {
        const page = await apiJson<{ messages: Message[] }>(
          `/agent-sessions/${activeSession.id}/messages`,
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
      if (session) {
        await fetch(`${BASE}/agent-sessions/${encodeURIComponent(session.id)}`, {
          method: 'DELETE',
        }).catch(() => undefined);
      }
      if (profile) {
        await fetch(`${BASE}/agent-configs/${encodeURIComponent(profile.id)}`, {
          method: 'DELETE',
        }).catch(() => undefined);
      }
      if (originalConfig) {
        await engineJson('/global/config', {
          method: 'PATCH', body: JSON.stringify(originalConfig),
        }).catch(() => undefined);
        await fetch(`${BASE}/system/refresh`, { method: 'POST' }).catch(() => undefined);
      }
      await closeServer(provider);
    }
  }, 100_000);
});
