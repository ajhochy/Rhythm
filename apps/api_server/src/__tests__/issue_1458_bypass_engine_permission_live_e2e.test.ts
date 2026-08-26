/**
 * Live behavioral gate for #1458. The session is created through Rhythm's real
 * API, then inspected through the real engine API to prove bypass is engine-side.
 * Do not run outside the isolated sandbox.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const SANDBOX = process.env.RHYTHM_SANDBOX_DIR ?? '';
const created: string[] = [];

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`;
}

function messageStart(model: string) {
  return {
    type: 'message_start',
    message: {
      id: `msg_1458_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 0 },
    },
  };
}

function toolStream(model: string, filePath: string): string {
  return sse([
    messageStart(model),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '')}`, name: 'read', input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ filePath }) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 5, output_tokens: 5 } },
    { type: 'message_stop' },
  ]);
}

function textStream(model: string): string {
  return sse([
    messageStart(model),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '#1458 external read complete' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 5, output_tokens: 5 } },
    { type: 'message_stop' },
  ]);
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((done) => server.close(() => done()));
}

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
    if (!SANDBOX.startsWith('/')) throw new Error('RHYTHM_SANDBOX_DIR is required');
    const fixtureRoot = join(SANDBOX, `issue-1458-${process.pid}`);
    const projectDir = join(fixtureRoot, 'project');
    const externalDir = join(fixtureRoot, 'external');
    const marker = `issue-1458-external-${randomUUID()}`;
    const externalFile = join(externalDir, 'marker.txt');
    const providerId = `issue-1458-${process.pid}`;
    const modelId = 'external-directory-fixture';
    const providerRequests: Array<Record<string, unknown>> = [];
    let provider: Server | null = null;

    await mkdir(projectDir, { recursive: true });
    await mkdir(externalDir, { recursive: true });
    await writeFile(externalFile, marker, 'utf8');

    try {
      provider = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          providerRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          response.end(providerRequests.length === 1
            ? toolStream(modelId, externalFile)
            : textStream(modelId));
        });
      });
      await new Promise<void>((done, reject) => {
        provider?.once('error', reject);
        provider?.listen(0, '127.0.0.1', done);
      });
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('provider fixture did not bind');

      const config = await json<{ provider?: Record<string, unknown> }>(`${ENGINE}/global/config`);
      config.provider = config.provider ?? {};
      config.provider[providerId] = {
        npm: '@ai-sdk/anthropic',
        name: '#1458 external_directory fixture',
        options: { apiKey: 'issue-1458-fixture', baseURL: `http://127.0.0.1:${address.port}/v1` },
        models: { [modelId]: { name: modelId, limit: { context: 20_000, output: 1_000 } } },
      };
      await json(`${ENGINE}/global/config`, { method: 'PATCH', body: JSON.stringify(config) });
      const refresh = await fetch(`${API}/system/refresh`, { method: 'POST' });
      expect(refresh.status, await refresh.clone().text()).toBe(200);

      const session = await json<{ id: string; sdkSessionId: string }>(`${API}/agent-sessions`, {
        method: 'POST',
        body: JSON.stringify({
          agentId: null,
          cwd: projectDir,
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

      const turn = await fetch(`${ENGINE}/session/${encodeURIComponent(session.sdkSessionId)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OpenCode-Directory': projectDir },
        body: JSON.stringify({
          agent: 'build',
          model: { providerID: providerId, modelID: modelId },
          parts: [{ type: 'text', text: 'Read the controlled external marker.' }],
        }),
      });
      expect(turn.status, await turn.clone().text()).toBe(200);
      expect(providerRequests.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(providerRequests[1])).toContain(marker);

      const messages = await json<Array<{
        parts?: Array<{ type?: string; tool?: string; state?: { status?: string; output?: string } }>;
      }>>(`${ENGINE}/session/${encodeURIComponent(session.sdkSessionId)}/message`);
      expect(messages.some((message) => message.parts?.some((part) =>
        part.type === 'tool' &&
        part.tool === 'read' &&
        part.state?.status === 'completed' &&
        part.state.output?.includes(marker),
      ))).toBe(true);

      const pending = await json<Array<{ sessionID: string }>>(`${ENGINE}/permission`);
      expect(pending.filter((ask) => ask.sessionID === session.sdkSessionId)).toEqual([]);
    } finally {
      await closeServer(provider);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
