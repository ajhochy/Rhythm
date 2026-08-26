/**
 * Live behavioral gate for #1458. The session is created through Rhythm's real
 * API, then inspected through the real engine API to prove bypass is engine-side.
 * Do not run outside the isolated sandbox.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

function toolStream(
  model: string,
  name: 'read' | 'bash' | 'edit',
  input: Record<string, unknown>,
): string {
  return sse([
    messageStart(model),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '')}`, name, input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 5, output_tokens: 5 } },
    { type: 'message_stop' },
  ]);
}

function textStream(model: string, marker: string): string {
  return sse([
    messageStart(model),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: marker } },
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

  it('executes read, bash, and edit through wildcard engine permission with no pending ask', async () => {
    if (!SANDBOX.startsWith('/')) throw new Error('RHYTHM_SANDBOX_DIR is required');
    const fixtureRoot = join(SANDBOX, `issue-1458-${process.pid}`);
    const projectDir = join(fixtureRoot, 'project');
    const externalDir = join(fixtureRoot, 'external');
    const readMarker = `issue-1458-read-${randomUUID()}`;
    const bashMarker = `issue-1458-bash-${randomUUID()}`;
    const editMarker = `issue-1458-edit-${randomUUID()}`;
    const finalMarker = `issue-1458-final-${randomUUID()}`;
    const externalFile = join(externalDir, 'marker.txt');
    const editFile = join(projectDir, 'edit-fixture.txt');
    const oldEditText = 'issue-1458-edit-old';
    const providerId = `issue-1458-${process.pid}`;
    const modelId = 'external-directory-fixture';
    const providerRequests: Array<Record<string, unknown>> = [];
    let provider: Server | null = null;
    let originalConfig: Record<string, unknown> | null = null;

    await mkdir(projectDir, { recursive: true });
    await mkdir(externalDir, { recursive: true });
    await writeFile(externalFile, readMarker, 'utf8');
    await writeFile(editFile, oldEditText, 'utf8');

    try {
      provider = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          providerRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
          let stream: string;
          if (providerRequests.length === 1) {
            stream = toolStream(modelId, 'read', { filePath: externalFile });
          } else if (providerRequests.length === 2) {
            stream = toolStream(modelId, 'bash', {
              command: `printf '%s' '${bashMarker}'`,
              workdir: projectDir,
              description: 'Prints controlled bypass permission marker',
            });
          } else if (providerRequests.length === 3) {
            stream = toolStream(modelId, 'edit', {
              filePath: editFile,
              oldString: oldEditText,
              newString: editMarker,
            });
          } else {
            stream = textStream(modelId, finalMarker);
          }
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          response.end(stream);
        });
      });
      await new Promise<void>((done, reject) => {
        provider?.once('error', reject);
        provider?.listen(0, '127.0.0.1', done);
      });
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('provider fixture did not bind');

      originalConfig = await json<Record<string, unknown>>(`${ENGINE}/global/config`);
      const config = structuredClone(originalConfig) as { provider?: Record<string, unknown> };
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
          parts: [{ type: 'text', text: 'Run the controlled read, bash, and edit operations.' }],
        }),
      });
      expect(turn.status, await turn.clone().text()).toBe(200);
      expect(providerRequests.length).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(providerRequests[1])).toContain(readMarker);
      expect(JSON.stringify(providerRequests[2])).toContain(bashMarker);
      expect(JSON.stringify(providerRequests[3])).toContain(editMarker);

      const messages = await json<Array<{
        parts?: Array<{
          type?: string;
          tool?: string;
          text?: string;
          state?: { status?: string; output?: string };
        }>;
      }>>(`${ENGINE}/session/${encodeURIComponent(session.sdkSessionId)}/message`);
      const toolParts = messages.flatMap((message) => message.parts ?? [])
        .filter((part) => part.type === 'tool');
      expect(toolParts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          tool: 'read',
          state: expect.objectContaining({
            status: 'completed', output: expect.stringContaining(readMarker),
          }),
        }),
        expect.objectContaining({
          tool: 'bash',
          state: expect.objectContaining({
            status: 'completed', output: expect.stringContaining(bashMarker),
          }),
        }),
        expect.objectContaining({
          tool: 'edit',
          state: expect.objectContaining({ status: 'completed' }),
        }),
      ]));
      expect(messages.some((message) => message.parts?.some((part) =>
        part.type === 'text' && part.text?.includes(finalMarker),
      ))).toBe(true);
      expect(await readFile(editFile, 'utf8')).toBe(editMarker);

      const pending = await json<Array<{ sessionID: string }>>(`${ENGINE}/permission`);
      expect(pending.filter((ask) => ask.sessionID === session.sdkSessionId)).toEqual([]);
    } finally {
      if (originalConfig) {
        await fetch(`${ENGINE}/global/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(originalConfig),
        }).catch(() => undefined);
        await fetch(`${API}/system/refresh`, { method: 'POST' }).catch(() => undefined);
      }
      await closeServer(provider);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
