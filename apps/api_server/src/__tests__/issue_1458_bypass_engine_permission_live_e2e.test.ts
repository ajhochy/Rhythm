/**
 * Live behavioral gate for #1458. The session is created through Rhythm's real
 * API, then inspected through the real engine API to prove bypass is engine-side.
 * Do not run outside the isolated sandbox.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

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
  name: 'read' | 'edit',
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

async function waitFor<T>(read: () => Promise<T | null> | T | null, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for #1458 live assertion');
}

function observeEnginePermissions(engine: string, sdkSessionId: string) {
  const controller = new AbortController();
  const events: Array<{ type: string; sessionID: string; directory?: string }> = [];
  const ready = (async () => {
    const response = await fetch(`${engine}/global/event`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`global event observer -> ${response.status}`);
    return response.body;
  })();
  const finished = (async () => {
    const body = await ready;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = frame.split('\n').find((value) => value.startsWith('data:'));
          if (!line) continue;
          try {
            const envelope = JSON.parse(line.slice(5).trim()) as {
              directory?: unknown;
              payload?: { type?: unknown; properties?: { sessionID?: unknown } };
            };
            const payload = envelope.payload;
            if (
              (payload?.type === 'permission.asked' || payload?.type === 'permission.replied') &&
              payload.properties?.sessionID === sdkSessionId
            ) {
              events.push({
                type: payload.type,
                sessionID: sdkSessionId,
                ...(typeof envelope.directory === 'string' ? { directory: envelope.directory } : {}),
              });
            }
          } catch {
            // Ignore malformed unrelated engine frames in this observation-only stream.
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  return { controller, events, ready, finished };
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((id) =>
    fetch(`${API}/agent-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  ));
});

describeLive('issue #1458 live engine-side permission bypass', () => {
  beforeAll(() => assertLiveE2EIsolation());

  it('executes read, edit, and external-directory access while the API global stream is suspended', async () => {
    if (!SANDBOX.startsWith('/')) throw new Error('RHYTHM_SANDBOX_DIR is required');
    const fixtureRoot = join(SANDBOX, `issue-1458-${process.pid}`);
    const projectDir = join(fixtureRoot, 'project');
    const externalDir = join(fixtureRoot, 'external');
    const readMarker = `issue-1458-read-${randomUUID()}`;
    const externalMarker = `issue-1458-external-${randomUUID()}`;
    const editMarker = `issue-1458-edit-${randomUUID()}`;
    const finalMarker = `issue-1458-final-${randomUUID()}`;
    const externalFile = join(externalDir, 'marker.txt');
    const readFilePath = join(projectDir, 'read-fixture.txt');
    const editFile = join(projectDir, 'edit-fixture.txt');
    const oldEditText = 'issue-1458-edit-old';
    const providerId = `issue-1458-${process.pid}`;
    const modelId = 'external-directory-fixture';
    const providerRequests: Array<Record<string, unknown>> = [];
    let provider: Server | null = null;
    let socket: WebSocket | null = null;
    let streamSuspended = false;
    let originalConfig: Record<string, unknown> | null = null;
    const websocketFrames: Array<{ type?: string; sessionId?: string; status?: string }> = [];

    await mkdir(projectDir, { recursive: true });
    await mkdir(externalDir, { recursive: true });
    await writeFile(readFilePath, readMarker, 'utf8');
    await writeFile(externalFile, externalMarker, 'utf8');
    await writeFile(editFile, oldEditText, 'utf8');

    try {
      provider = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          providerRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
          let stream: string;
          if (providerRequests.length === 1) {
            stream = toolStream(modelId, 'read', { filePath: readFilePath });
          } else if (providerRequests.length === 2) {
            stream = toolStream(modelId, 'edit', {
              filePath: editFile,
              oldString: oldEditText,
              newString: editMarker,
            });
          } else if (providerRequests.length === 3) {
            stream = toolStream(modelId, 'read', { filePath: externalFile });
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
      expect(engineSession.permission).toContainEqual({
        permission: 'bash', pattern: '*', action: 'ask',
      });
      expect(['external_directory', 'edit'].every((permission) =>
        engineSession.permission?.some((rule) =>
          (rule.permission === '*' || rule.permission === permission) &&
          rule.pattern === '*' && rule.action === 'allow'),
      )).toBe(true);

      socket = new WebSocket(API.replace(/^http/, 'ws') + '/ws/agents');
      await new Promise<void>((resolveOpen, rejectOpen) => {
        socket?.once('open', resolveOpen);
        socket?.once('error', rejectOpen);
      });
      socket.on('message', (raw) => {
        websocketFrames.push(JSON.parse(raw.toString()) as {
          type?: string;
          sessionId?: string;
          status?: string;
        });
      });

      await json(`${API}/__test/opencode/global-stream/suspend`, { method: 'POST' });
      streamSuspended = true;
      await waitFor(() => websocketFrames.some((frame) =>
        frame.type === 'bridge.status' && frame.status === 'reconnecting') ? true : null);
      const degraded = await waitFor(async () => {
        const health = await json<{ status: string; bridgeLive: boolean }>(`${API}/opencode/health`);
        return health.status === 'unavailable' && !health.bridgeLive ? health : null;
      });
      expect(degraded).toMatchObject({ status: 'unavailable', bridgeLive: false });
      expect(await json<{ healthy: boolean }>(`${ENGINE}/global/health`)).toMatchObject({ healthy: true });

      const turn = await fetch(`${ENGINE}/session/${encodeURIComponent(session.sdkSessionId)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OpenCode-Directory': projectDir },
        body: JSON.stringify({
          agent: 'build',
          model: { providerID: providerId, modelID: modelId },
          parts: [{ type: 'text', text: 'Run the controlled read, edit, and external read operations.' }],
        }),
      });
      expect(turn.status, await turn.clone().text()).toBe(200);
      expect(providerRequests.length).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(providerRequests[1])).toContain(readMarker);
      expect(JSON.stringify(providerRequests[3])).toContain(externalMarker);

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
          tool: 'edit',
          state: expect.objectContaining({ status: 'completed' }),
        }),
      ]));
      const completedReads = toolParts.filter((part) =>
        part.tool === 'read' && part.state?.status === 'completed');
      expect(completedReads.some((part) => part.state?.output?.includes(readMarker))).toBe(true);
      expect(completedReads.some((part) => part.state?.output?.includes(externalMarker))).toBe(true);
      expect(messages.some((message) => message.parts?.some((part) =>
        part.type === 'text' && part.text?.includes(finalMarker),
      ))).toBe(true);
      expect(await readFile(editFile, 'utf8')).toBe(editMarker);

      const pending = await json<Array<{ sessionID: string }>>(`${ENGINE}/permission`);
      expect(pending.filter((ask) => ask.sessionID === session.sdkSessionId)).toEqual([]);
      expect(websocketFrames.filter((frame) =>
        frame.type === 'permission.asked' && frame.sessionId === session.id)).toEqual([]);
      expect(await json<{ healthy: boolean }>(`${ENGINE}/global/health`)).toMatchObject({ healthy: true });

      await json(`${API}/__test/opencode/global-stream/resume`, { method: 'POST' });
      streamSuspended = false;
      await waitFor(async () => {
        const health = await json<{ status: string; bridgeLive: boolean }>(`${API}/opencode/health`);
        return health.status === 'ready' && health.bridgeLive ? health : null;
      });
      await waitFor(() => websocketFrames.some((frame) =>
        frame.type === 'bridge.status' && frame.status === 'ready') ? true : null);
    } finally {
      if (streamSuspended) {
        await fetch(`${API}/__test/opencode/global-stream/resume`, { method: 'POST' }).catch(() => undefined);
      }
      socket?.close();
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

  it('replies to a real headless-child permission through the global event directory when its persisted cwd is stale', async () => {
    if (!SANDBOX.startsWith('/')) throw new Error('RHYTHM_SANDBOX_DIR is required');
    const dbPath = process.env.DB_PATH ?? '';
    if (!dbPath.startsWith(`${SANDBOX}/`)) throw new Error('DB_PATH must be the owned sandbox database');

    const fixtureRoot = join(SANDBOX, `issue-1458-directory-${process.pid}`);
    const engineDir = join(fixtureRoot, 'engine-worktree');
    const staleDir = join(fixtureRoot, 'stale-persisted-cwd');
    const target = join(engineDir, 'target.txt');
    const oldText = 'issue-1458-directory-old';
    const marker = `issue-1458-directory-green-${randomUUID()}`;
    const finalMarker = `issue-1458-directory-final-${randomUUID()}`;
    const providerId = `issue-1458-directory-${process.pid}`;
    const modelId = 'directory-routing-fixture';
    const providerRequests: Array<Record<string, unknown>> = [];
    let provider: Server | null = null;
    let originalConfig: Record<string, unknown> | null = null;
    let parent: { id: string; sdkSessionId: string } | null = null;
    let child: { id: string; sdkSessionId: string } | null = null;
    let profileId: string | null = null;
    let projectId: string | null = null;
    let auth: Record<string, string> = {};
    let childCwdMutated = false;
    let permissionObserver: ReturnType<typeof observeEnginePermissions> | null = null;

    await mkdir(engineDir, { recursive: true });
    await mkdir(staleDir, { recursive: true });
    await writeFile(target, oldText, 'utf8');

    try {
      provider = createServer((request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(204);
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (!raw) {
            response.writeHead(204);
            response.end();
            return;
          }
          providerRequests.push(JSON.parse(raw) as Record<string, unknown>);
          // Provider admission is complete before a model can request this
          // tool. Mutate only the owned fixture's local CWD at the exact
          // routing boundary, so admission itself retains its valid binding.
          if (providerRequests.length === 2 && child && parent) {
            const db = new Database(dbPath);
            try {
              db.prepare('UPDATE agent_sessions SET parent_session_id = ?, cwd = ? WHERE id = ?')
                .run(parent.id, staleDir, child.id);
              childCwdMutated = true;
            } finally {
              db.close();
            }
          }
          const stream = providerRequests.length === 1
            ? toolStream(modelId, 'read', { filePath: target })
            : providerRequests.length === 2
              ? toolStream(modelId, 'edit', { filePath: target, oldString: oldText, newString: marker })
              : textStream(modelId, finalMarker);
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
        name: '#1458 directory routing fixture',
        options: { apiKey: 'issue-1458-directory-fixture', baseURL: `http://127.0.0.1:${address.port}/v1` },
        models: { [modelId]: { name: modelId, limit: { context: 20_000, output: 1_000 } } },
      };
      await json(`${ENGINE}/global/config`, { method: 'PATCH', body: JSON.stringify(config) });

      // Bind this synthetic turn to the stock fixture's sole owner and a
      // fixture project. An anonymous direct engine prompt is intentionally
      // withheld by Dayflow provider admission before any provider call.
      const fixtureDb = new Database(dbPath, { readonly: true });
      let authorization: string;
      try {
        const row = fixtureDb.prepare('SELECT token FROM sessions ORDER BY created_at DESC LIMIT 1').get() as { token?: unknown } | undefined;
        if (!row || typeof row.token !== 'string' || row.token.length === 0) throw new Error('isolated fixture has no bearer session');
        authorization = `Bearer ${row.token}`;
      } finally {
        fixtureDb.close();
      }
      auth = { Authorization: authorization, Origin: 'rhythm://app', 'Content-Type': 'application/json' };
      const project = await json<{ id: string }>(`${API}/projects`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ name: `#1458 directory ${randomUUID()}`, cwd: engineDir }),
      });
      projectId = project.id;
      const profile = await json<{ id: string }>(`${API}/agent-configs`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          id: `issue-1458-directory-${randomUUID()}`,
          label: '#1458 directory fixture', isAgent: true, enabled: true, sessionSelectable: true,
          ocAgent: 'build', modelProvider: providerId, modelId,
          corePermissionsJson: JSON.stringify({ read: 'allow', edit: 'ask' }),
          systemPrompt: 'Execute the controlled fixture request.',
        }),
      });
      profileId = profile.id;
      expect((await fetch(`${API}/system/refresh`, { method: 'POST' })).status).toBe(200);

      parent = await json<{ id: string; sdkSessionId: string }>(`${API}/agent-sessions`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ profileId, cwd: engineDir, projectId, name: '#1458 directory parent', permissionMode: 'default' }),
      });
      child = await json<{ id: string; sdkSessionId: string }>(`${API}/agent-sessions`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ profileId, cwd: engineDir, projectId, name: '#1458 directory child', permissionMode: 'default' }),
      });
      created.push(parent.id, child.id);
      const childSdkSessionId = child.sdkSessionId;

      // Profile projection controls the prompt identity; install the exact
      // fixture-only engine rules through the supported session route so this
      // turn has one allowed read followed by one asked edit.
      await json(`${ENGINE}/session/${encodeURIComponent(childSdkSessionId)}?directory=${encodeURIComponent(engineDir)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          permission: [
            { permission: '*', pattern: '*', action: 'deny' },
            { permission: 'read', pattern: '*', action: 'allow' },
            { permission: 'edit', pattern: '*', action: 'ask' },
          ],
        }),
      });
      const engineSession = await json<{
        permission?: Array<{ permission: string; pattern: string; action: string }>;
      }>(`${ENGINE}/session/${encodeURIComponent(child.sdkSessionId)}?directory=${encodeURIComponent(engineDir)}`);
      expect(engineSession.permission?.some((rule) =>
        rule.permission === 'edit' && rule.pattern === '*' && rule.action === 'ask',
      )).toBe(true);

      permissionObserver = observeEnginePermissions(ENGINE, childSdkSessionId);
      await permissionObserver.ready;

      const turn = await fetch(`${API}/agent-sessions/${encodeURIComponent(child.id)}/prompt`, {
        method: 'POST',
        headers: auth,
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          prompt: 'Apply the controlled edit.',
          modelOverride: { providerId, modelId },
        }),
      });
      expect(turn.status, await turn.clone().text()).toBe(202);
      await waitFor(() => providerRequests.length === 3 ? true : null);
      expect(providerRequests).toHaveLength(3);
      const staleChild = new Database(dbPath, { readonly: true });
      try {
        expect(staleChild.prepare('SELECT cwd FROM agent_sessions WHERE id = ?').get(child.id)).toEqual({ cwd: staleDir });
      } finally {
        staleChild.close();
      }
      expect(await readFile(target, 'utf8')).toBe(marker);
      await waitFor(() =>
        permissionObserver!.events.some((event) => event.type === 'permission.asked') &&
        permissionObserver!.events.some((event) => event.type === 'permission.replied')
          ? true
          : null,
      );
      expect(permissionObserver.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'permission.asked', sessionID: childSdkSessionId, directory: engineDir }),
        expect.objectContaining({ type: 'permission.replied', sessionID: childSdkSessionId, directory: engineDir }),
      ]));

      const pending = await json<Array<{ sessionID: string }>>(
        `${ENGINE}/permission?directory=${encodeURIComponent(engineDir)}`,
      );
      expect(pending.filter((ask) => ask.sessionID === childSdkSessionId)).toEqual([]);
      await waitFor(async () => {
        const messages = await json<Array<{ parts?: Array<{ type?: string; text?: string }> }>>(
          `${ENGINE}/session/${encodeURIComponent(childSdkSessionId)}/message?directory=${encodeURIComponent(engineDir)}`,
        );
        return messages.some((message) => message.parts?.some((part) =>
          part.type === 'text' && part.text?.includes(finalMarker),
        )) ? true : null;
      });
    } finally {
      permissionObserver?.controller.abort();
      await permissionObserver?.finished.catch(() => undefined);
      if (child) {
        await fetch(
          `${ENGINE}/session/${encodeURIComponent(child.sdkSessionId)}/abort?directory=${encodeURIComponent(engineDir)}`,
          { method: 'POST' },
        ).catch(() => undefined);
      }
      if (childCwdMutated && child) {
        const db = new Database(dbPath);
        try {
          db.prepare('UPDATE agent_sessions SET parent_session_id = NULL, cwd = ? WHERE id = ?')
            .run(engineDir, child.id);
        } finally {
          db.close();
        }
      }
      if (originalConfig) {
        await fetch(`${ENGINE}/global/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(originalConfig),
        }).catch(() => undefined);
        await fetch(`${API}/system/refresh`, { method: 'POST' }).catch(() => undefined);
      }
      for (const local of [child, parent]) {
        if (!local) continue;
        await fetch(`${API}/agent-sessions/${encodeURIComponent(local.id)}`, { method: 'DELETE', headers: auth }).catch(() => undefined);
      }
      if (profileId) {
        await fetch(`${API}/agent-configs/${encodeURIComponent(profileId)}`, { method: 'DELETE', headers: auth }).catch(() => undefined);
      }
      if (projectId) {
        await fetch(`${API}/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE', headers: auth }).catch(() => undefined);
      }
      await closeServer(provider);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
