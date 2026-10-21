/**
 * Real isolated API + fork + stdio Rhythm MCP. Only the external model choices
 * are scripted on a loopback provider. Never run against the installed app.
 * Parent runner owns the exact guarded build and tools/dev/sandbox.sh lifecycle.
 */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const API = process.env.RHYTHM_LIVE_API_URL ?? '';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? '';
const SANDBOX = process.env.RHYTHM_SANDBOX_DIR ?? '';
const TOKEN = process.env.RHYTHM_LIVE_SYNTHETIC_TOKEN ?? '';
const nonce = randomUUID();
const providerId = `mcp-canonical-${nonce.slice(0, 8)}`;
const modelId = 'scripted-tool-calls';
const canonical = 'rhythm_rhythm_list_tasks';
const registered = 'rhythm_list_tasks';
let provider: Server | undefined;
let providerError: Error | undefined;
let providerCalls = 0;
let profileId = '';
let sessionId = '';
let sdkSessionId = '';
let taskId = '';
let client: ReturnType<typeof createOpencodeClient>;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const body = await response.text();
  expect(response.status, `${path}: ${body.slice(0, 800)}`).toBeLessThan(300);
  return JSON.parse(body) as T;
}

function sendAnthropic(response: import('node:http').ServerResponse, tool?: { name: string; input: unknown }): void {
  const toolId = `toolu_${randomUUID().replaceAll('-', '')}`;
  const events = [
    { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: modelId,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool
      ? { type: 'tool_use', id: toolId, name: tool.name, input: {} }
      : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool
      ? { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) }
      : { type: 'text_delta', text: 'Fixture complete.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' },
      usage: { input_tokens: 5, output_tokens: 5 } },
    { type: 'message_stop' },
  ];
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(events.map(event => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n');
}

describe.skipIf(!LIVE)('live MCP canonical execution guidance (scripted provider)', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
    expect(API).toBe('http://127.0.0.1:4098');
    expect(ENGINE).toBe('http://127.0.0.1:4097');
    expect(SANDBOX.startsWith('/private/tmp/')).toBe(true);
    expect(process.env.DB_PATH).toBe(resolve(SANDBOX, 'rhythm.db'));
    expect(TOKEN).toBe('e02-synthetic-session-not-a-secret');
    expect((await json<{ status: string }>('/opencode/health')).status).toBe('ready');
    const config = await (await fetch(`${ENGINE}/global/config`, { signal: AbortSignal.timeout(10_000) })).json() as {
      mcp?: { rhythm?: { command?: string[]; environment?: Record<string, string> } };
    };
    const mcpBinary = config.mcp?.rhythm?.command?.[1];
    expect(config.mcp?.rhythm?.command?.[0]).toBe('node');
    expect([
      resolve(__dirname, '../../../mcp_server/dist/index.js'),
      resolve(SANDBOX, 'mcp-dist/index.js'),
    ]).toContain(mcpBinary);
    expect(config.mcp?.rhythm?.environment?.RHYTHM_API_URL).toBe(API);
    expect(config.mcp?.rhythm?.environment?.RHYTHM_AGENT_URL).toBe(API);
    expect(config.mcp?.rhythm?.environment?.RHYTHM_API_TOKEN).toBe(TOKEN);
    client = createOpencodeClient({ baseUrl: ENGINE, directory: SANDBOX });

    provider = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as { tools?: Array<{ name: string }> };
          if (!body.tools?.some(tool => tool.name === 'mcp_dispatch')) throw new Error('deferred dispatcher absent from scripted request');
          const step = providerCalls++;
          if (step > 4) throw new Error('scripted provider exceeded five bounded tool steps');
          const calls: Array<{ name: string; input: unknown }> = [
            { name: 'mcp_dispatch', input: { action: 'describe', name: registered } },
            { name: 'mcp_dispatch', input: { action: 'execute', name: registered, arguments: { id: taskId } } },
            { name: 'mcp_dispatch', input: { action: 'execute', name: 'obsidian_obsidian_get_file', arguments: {} } },
            { name: 'mcp_dispatch', input: { action: 'execute', name: canonical, arguments: { id: taskId } } },
          ];
          sendAnthropic(response, calls[step]);
        } catch (error) {
          providerError = error as Error;
          response.writeHead(500);
          response.end('synthetic provider rejected request');
        }
      });
    });
    await new Promise<void>(done => provider!.listen(0, '127.0.0.1', done));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('fixture provider did not bind');
    const patched = await fetch(`${ENGINE}/global/config`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: { [providerId]: {
        npm: '@ai-sdk/anthropic', name: 'Isolated canonical-name transport',
        options: { apiKey: 'synthetic-only', baseURL: `http://127.0.0.1:${address.port}/v1` },
        models: { [modelId]: { name: modelId, limit: { context: 200_000, output: 4_000 } } },
      } } }),
      signal: AbortSignal.timeout(10_000),
    });
    expect(patched.status).toBe(200);
    await json(`/opencode/auth/${providerId}`, { method: 'POST', body: JSON.stringify({ apiKey: 'synthetic-only' }) });
    await json('/system/refresh', { method: 'POST' });
    const task = await json<{ id: string }>('/tasks', { method: 'POST', body: JSON.stringify({
      title: `[smoke] canonical tool ${nonce}`, notes: `Owned sandbox marker ${nonce}`, status: 'open',
    }) });
    taskId = task.id;
    const profile = await json<{ id: string }>('/agent-configs', { method: 'POST', body: JSON.stringify({
      label: `[smoke] canonical ${nonce}`, icon: 'shield', ocAgent: 'build',
      modelProvider: providerId, modelId,
      allowedMcpsJson: JSON.stringify({ rhythm: [registered] }),
      corePermissionsJson: JSON.stringify({ [canonical]: 'allow' }),
    }) });
    profileId = profile.id;
    const session = await json<{ id: string; sdkSessionId: string }>('/agent-sessions', {
      method: 'POST', body: JSON.stringify({ profileId, cwd: SANDBOX, name: `[smoke] canonical ${nonce}` }),
    });
    sessionId = session.id;
    sdkSessionId = session.sdkSessionId;
    expect(sdkSessionId).toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    const cleanupErrors: string[] = [];
    for (const path of [
      sessionId && `/agent-sessions/${sessionId}/hard`,
      profileId && `/agent-configs/${profileId}`,
      taskId && `/tasks/${taskId}`,
    ].filter((value): value is string => Boolean(value))) {
      try {
        const response = await api(path, { method: 'DELETE' });
        if (!response.ok) cleanupErrors.push(`${path}: HTTP ${response.status}`);
      } catch (error) {
        cleanupErrors.push(`${path}: ${String(error)}`);
      }
    }
    if (provider) await new Promise<void>(done => provider!.close(() => done()));
    expect(cleanupErrors).toEqual([]);
  });

  it('describes canonical executeName, denies bare/foreign calls, and reads the exact owned task through real MCP', async () => {
    const before = await client.session.messages({ path: { id: sdkSessionId } });
    expect(before.error).toBeUndefined();
    const sent = await client.session.prompt({ path: { id: sdkSessionId }, body: {
      model: { providerID: providerId, modelID: modelId },
      parts: [{ type: 'text', text: `Run the bounded scripted canonical-name transport for ${nonce}` }],
    } });
    expect(sent.error).toBeUndefined();
    expect(providerError).toBeUndefined();
    expect(providerCalls).toBe(5);
    const after = await client.session.messages({ path: { id: sdkSessionId } });
    expect(after.error).toBeUndefined();
    const oldIds = new Set((before.data ?? []).map(message => message.info.id));
    const parts = (after.data ?? []).filter(message => !oldIds.has(message.info.id))
      .flatMap(message => message.parts)
      .filter((part): part is typeof part & { state: { status: string; input: Record<string, unknown>; output?: unknown; error?: unknown } } => part.type === 'tool' && part.tool === 'mcp_dispatch');
    expect(parts.map(part => part.state.status)).toEqual(['completed', 'error', 'error', 'completed']);
    const descriptor = JSON.parse(String(parts[0].state.output)) as { name: string; executeName: string; registeredName: string };
    expect(descriptor).toMatchObject({ name: canonical, executeName: canonical, registeredName: registered });
    expect(String(parts[1].state.error)).toContain('not permitted');
    expect(String(parts[1].state.error)).toContain('executeName');
    expect(String(parts[2].state.error)).toContain('not permitted');
    expect(String(parts[2].state.error)).not.toContain(nonce);
    expect(parts[3].state.input).toMatchObject({ name: canonical, arguments: { id: taskId } });
    expect(String(parts[3].state.output)).toContain(nonce);
    const persisted = await json<{ id: string; title: string }>(`/tasks/${taskId}`);
    expect(persisted).toMatchObject({ id: taskId, title: `[smoke] canonical tool ${nonce}` });
  }, 180_000);
});
