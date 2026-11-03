/**
 * Live gate for the contextual task handoff. This test is opt-in and only
 * runs against tools/dev/sandbox.sh on the dedicated 4098/4097 ports.
 *
 * Unlike an engine-only MCP smoke test, this starts at the same shared web
 * helper the Dashboard, Planner, and Tasks pages call. The helper creates the
 * real local session over HTTP and sends its first turn over the real WS
 * gateway. The authoritative task lives on a second authenticated API, so its
 * ID is deliberately absent from the local session database.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { WebSocket as NodeWebSocket } from 'ws';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { startTestServer, type TestServer } from './helpers/real_server';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const API = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const ENGINE = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const SANDBOX = process.env.RHYTHM_SANDBOX_DIR ?? '';
const LOCAL_OWNER_TOKEN = 'e02-synthetic-session-not-a-secret';
const TOOL_NAME = 'rhythm_rhythm_list_tasks';

type JsonObject = Record<string, unknown>;
type ProductionGateway = {
  connect: (...args: Array<(...args: never[]) => void>) => { send(frame: unknown): void; close(): void };
  hardDelete(localId: string): Promise<void>;
  [key: string]: unknown;
};

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`;
}

function messageStart(model: string): JsonObject {
  return {
    type: 'message_start',
    message: {
      id: `msg_task_handoff_${randomUUID()}`,
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

function toolStream(model: string, taskIdFromPrompt: string): string {
  return sse([
    messageStart(model),
    {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: `toolu_${randomUUID().replaceAll('-', '')}`,
        name: TOOL_NAME,
        input: {},
      },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify({ id: taskIdFromPrompt }),
      },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { input_tokens: 5, output_tokens: 5 },
    },
    { type: 'message_stop' },
  ]);
}

function textStream(model: string, text: string): string {
  return sse([
    messageStart(model),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 5, output_tokens: 5 },
    },
    { type: 'message_stop' },
  ]);
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as JsonObject).flatMap(stringsIn);
  }
  return [];
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

async function localApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${LOCAL_OWNER_TOKEN}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}: ${body}`);
  return (body ? JSON.parse(body) : undefined) as T;
}

async function remoteApi<T>(baseUrl: string, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}: ${body}`);
  return (body ? JSON.parse(body) : undefined) as T;
}

async function engineJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ENGINE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}: ${body}`);
  return (body ? JSON.parse(body) : undefined) as T;
}

async function until<T>(read: () => Promise<T | undefined> | T | undefined, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Task handoff live gate did not converge');
}

async function loadProductionHandoffModules(): Promise<{
  createLiveSessionsGateway: (
    apiBase: string,
    token: string,
    fetcher: typeof fetch,
    webSocketImpl: unknown,
  ) => ProductionGateway;
  launchQuickActionSession: (
    gateway: ProductionGateway,
    actionId: 'help-finish',
    task: { id: string; title: string },
    createFollowUpTask: undefined,
    resolveWorkingDirectory: () => Promise<string>,
  ) => Promise<{ sessionId: string }>;
}> {
  // Keep this opt-in live test inside api_server's rootDir while loading the
  // production web modules only when the guarded gate actually runs.
  const gatewayModulePath = resolve(__dirname, '../../../web/src/gateway/sessions.ts');
  const quickActionsModulePath = resolve(__dirname, '../../../web/src/components/quickActions.ts');
  const gatewayModule = await import(gatewayModulePath) as JsonObject;
  const quickActionsModule = await import(quickActionsModulePath) as JsonObject;
  return {
    createLiveSessionsGateway: gatewayModule.createLiveSessionsGateway as never,
    launchQuickActionSession: quickActionsModule.launchQuickActionSession as never,
  };
}

describe('task handoff live gate wiring', () => {
  it('loads the actual shared production helper and live gateway', async () => {
    const modules = await loadProductionHandoffModules();
    expect(modules.launchQuickActionSession).toEqual(expect.any(Function));
    expect(modules.createLiveSessionsGateway).toEqual(expect.any(Function));
  });
});

describeLive('task handoff live exact-context gate', () => {
  it('uses the production helper, local API/WS session, Secretary scope, and remote owned exact task', async () => {
    assertLiveE2EIsolation();
    if (API !== 'http://127.0.0.1:4098' || ENGINE !== 'http://127.0.0.1:4097') {
      throw new Error('task handoff live gate requires the isolated 4098/4097 sandbox');
    }
    if (!SANDBOX.startsWith('/') || realpathSync(SANDBOX) !== SANDBOX) {
      throw new Error('task handoff live gate requires a canonical sandbox directory');
    }
    expect(resolve(process.env.DB_PATH ?? '')).toBe(resolve(SANDBOX, 'rhythm.db'));

    const nonce = randomUUID();
    const providerId = `task-handoff-${nonce}`;
    const modelId = 'task-handoff-fixture';
    const notesMarker = `TASK-HANDOFF-NOTES-${nonce}`;
    const twinMarker = `TASK-HANDOFF-TWIN-${nonce}`;
    const finalMarker = `TASK-HANDOFF-CONTEXT-OK-${nonce}`;
    const failureMarker = `TASK-HANDOFF-CONTEXT-MISSING-${nonce}`;
    const title = `Duplicate-looking handoff task ${nonce.slice(0, 8)}`;
    const sourceId = `remote-source-${nonce}`;
    const providerBodies: JsonObject[] = [];
    const providerProtocolErrors: string[] = [];
    const idsDerivedFromPrompt: string[] = [];
    const gatewaySockets: Array<{ close(): void }> = [];

    let provider: Server | null = null;
    let remoteServer: TestServer | null = null;
    let remoteDb: Database.Database | null = null;
    let originalConfig: JsonObject | null = null;
    let localSessionId: string | null = null;
    let createdProfile = false;
    let workingDirectory: string | null = null;

    try {
      remoteDb = makeDb();
      setDb(remoteDb);
      const users = new UsersRepository();
      const sessions = new SessionsRepository();
      const tasks = new TasksRepository();
      const owner = users.create({ name: 'Remote task owner', email: `${nonce}-owner@example.invalid` });
      const member = users.create({ name: 'Remote unrelated member', email: `${nonce}-member@example.invalid` });
      const remoteOwnerToken = (await sessions.createAsync(owner.id)).token;
      const remoteMemberToken = (await sessions.createAsync(member.id)).token;
      const authoritativeTask = tasks.create({
        title,
        notes: `${'Context before the unique marker. '.repeat(10)}${notesMarker}`,
        status: 'in_progress',
        locked: true,
        sourceType: 'prod_mirror',
        sourceId,
        ownerId: owner.id,
      });
      tasks.create({
        title,
        notes: twinMarker,
        ownerId: member.id,
      });
      remoteServer = await startTestServer(createApp());

      const hidden = await fetch(
        `${remoteServer.baseUrl}/tasks/${encodeURIComponent(authoritativeTask.id)}`,
        { headers: { Authorization: `Bearer ${remoteMemberToken}` }, signal: AbortSignal.timeout(15_000) },
      );
      const hiddenBody = await hidden.text();
      expect(hidden.status).toBe(404);
      expect(hiddenBody).not.toContain(title);
      expect(hiddenBody).not.toContain(notesMarker);

      const localDb = new Database(join(SANDBOX, 'rhythm.db'), { readonly: true, fileMustExist: true });
      try {
        expect(localDb.prepare('SELECT id FROM tasks WHERE id = ?').get(authoritativeTask.id)).toBeUndefined();
      } finally {
        localDb.close();
      }

      provider = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          if (request.method !== 'POST') {
            response.writeHead(404).end();
            return;
          }
          if (!request.url?.startsWith('/v1/messages')) {
            providerProtocolErrors.push(`${request.method} ${request.url ?? '<missing-url>'}`);
            response.writeHead(404).end();
            return;
          }
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let body: JsonObject;
          try {
            body = JSON.parse(rawBody) as JsonObject;
          } catch {
            providerProtocolErrors.push(`${request.method} ${request.url} invalid-json:${rawBody.length}`);
            response.writeHead(400).end();
            return;
          }
          providerBodies.push(body);
          const text = stringsIn(body).join('\n');
          const exactSelector = text.match(/\{"id":"([^"\\]+)"\}/)?.[1];
          const hasToolResult = text.includes(notesMarker) || text.includes('UNTRUSTED_EXTERNAL_CONTENT');
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          if (!hasToolResult && exactSelector) {
            idsDerivedFromPrompt.push(exactSelector);
            response.end(toolStream(modelId, exactSelector));
            return;
          }
          const contextArrived = text.includes(notesMarker) && text.includes('UNTRUSTED_EXTERNAL_CONTENT');
          response.end(textStream(modelId, contextArrived ? finalMarker : failureMarker));
        });
      });
      await new Promise<void>((done, reject) => {
        provider?.once('error', reject);
        provider?.listen(0, '127.0.0.1', done);
      });
      const providerAddress = provider.address();
      if (!providerAddress || typeof providerAddress === 'string') {
        throw new Error('synthetic provider did not bind');
      }

      originalConfig = await engineJson<JsonObject>('/global/config');
      const nextConfig = structuredClone(originalConfig) as { provider?: Record<string, unknown> };
      nextConfig.provider = nextConfig.provider ?? {};
      nextConfig.provider[providerId] = {
        npm: '@ai-sdk/anthropic',
        name: 'Task handoff synthetic fixture',
        options: { apiKey: 'synthetic-only', baseURL: `http://127.0.0.1:${providerAddress.port}/v1` },
        models: {
          [modelId]: {
            name: 'Task handoff synthetic fixture',
            modalities: { input: ['text'], output: ['text'] },
            limit: { context: 20_000, output: 1_000 },
          },
        },
      };
      await engineJson('/global/config', { method: 'PATCH', body: JSON.stringify(nextConfig) });
      await localApi(`/opencode/auth/${encodeURIComponent(providerId)}`, {
        method: 'POST',
        body: JSON.stringify({ apiKey: 'synthetic-only' }),
      });
      await localApi('/opencode/mcp/rhythm/ensure', {
        method: 'POST',
        body: JSON.stringify({ apiToken: remoteOwnerToken, apiUrl: remoteServer.baseUrl }),
      });

      const profiles = await localApi<Array<{ id: string }>>('/agent-configs');
      expect(profiles.find((profile) => profile.id === 'secretary')).toBeUndefined();
      await localApi('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: 'secretary',
          label: 'Secretary task handoff fixture',
          icon: 'flask',
          enabled: true,
          isAgent: true,
          sessionSelectable: true,
          ocAgent: 'build',
          modelProvider: providerId,
          modelId,
          allowedMcpsJson: JSON.stringify({ rhythm: ['rhythm_list_tasks'] }),
          allowedSkillsJson: '[]',
          corePermissionsJson: JSON.stringify({
            rhythm_rhythm_list_tasks: 'allow',
            bash: 'ask',
            edit: 'ask',
            external_directory: 'ask',
          }),
          systemPrompt: 'Read only the exact selected task. Do not mutate tasks or source-owned records.',
          autoApproveActions: false,
        }),
      });
      createdProfile = true;
      await localApi('/system/refresh', { method: 'POST' });

      workingDirectory = join(SANDBOX, 'task handoff workspace ');
      mkdirSync(workingDirectory);
      expect(realpathSync(workingDirectory)).toBe(workingDirectory);

      const { createLiveSessionsGateway, launchQuickActionSession } = await loadProductionHandoffModules();
      const productionGateway = createLiveSessionsGateway(
        API,
        LOCAL_OWNER_TOKEN,
        fetch,
        NodeWebSocket,
      );
      const gateway: ProductionGateway = {
        ...productionGateway,
        connect: (...args) => {
          const socket = productionGateway.connect(...args);
          gatewaySockets.push(socket);
          return socket;
        },
      };
      const handoff = await launchQuickActionSession(
        gateway,
        'help-finish',
        { id: authoritativeTask.id, title },
        undefined,
        async () => workingDirectory!,
      );
      localSessionId = handoff.sessionId;

      await until(() => providerBodies.length >= 2 ? true : undefined);
      const completed = await until(async () => {
        const result = await localApi<{ messages: Array<{ role?: string; strippedText?: string }> }>(
          `/agent-sessions/${encodeURIComponent(localSessionId!)}/messages`,
        );
        return result.messages.find(
          (message) => message.role === 'output' && message.strippedText?.includes(finalMarker),
        );
      });
      expect(completed.strippedText).toContain(finalMarker);
      expect(completed.strippedText).not.toContain(failureMarker);
      expect(providerProtocolErrors).toEqual([]);
      expect(idsDerivedFromPrompt).toEqual([authoritativeTask.id]);

      const firstRequest = JSON.stringify(providerBodies[0]);
      const secondRequest = JSON.stringify(providerBodies[1]);
      const secondRequestText = stringsIn(providerBodies[1]).join('\n');
      expect(firstRequest).toContain(authoritativeTask.id);
      expect(firstRequest).toContain(TOOL_NAME);
      expect(firstRequest).not.toContain('rhythm_rhythm_create_task');
      expect(firstRequest).not.toContain('rhythm_rhythm_update_task');
      expect(firstRequest).not.toContain('rhythm_rhythm_complete_task');
      expect(secondRequest).toContain(notesMarker);
      expect(secondRequest).not.toContain(twinMarker);
      expect(secondRequest).toContain('UNTRUSTED_EXTERNAL_CONTENT');
      expect(secondRequestText).toContain('"readOnly":true');

      const localIdentity = await localApi<{ user: { id: number } }>('/auth/me');
      const localDetail = await localApi<{
        session: {
          id: string;
          taskId: string | null;
          taskTitle: string | null;
          profileId: string | null;
          ownerUserId: number | null;
          sdkSessionId: string | null;
          cwd: string;
          mcpRole: string | null;
          mcpAllowedToolsJson: string | null;
          permissionMode: string;
          approvalBypassExplicit: boolean;
        };
      }>(`/agent-sessions/${encodeURIComponent(localSessionId)}`);
      expect(localDetail.session).toMatchObject({
        id: localSessionId,
        taskId: null,
        taskTitle: title,
        profileId: 'secretary',
        ownerUserId: localIdentity.user.id,
        cwd: workingDirectory,
        mcpRole: 'secretary',
        permissionMode: 'default',
        approvalBypassExplicit: false,
      });
      expect(localDetail.session.sdkSessionId).toEqual(expect.any(String));
      expect(JSON.parse(localDetail.session.mcpAllowedToolsJson ?? '{}')).toEqual({
        rhythm: ['rhythm_list_tasks'],
      });

      const engineSession = await engineJson<{
        directory?: string;
        permission?: Array<{ permission: string; pattern: string; action: string }>;
        mcpAllowlist?: { servers?: string[]; tools?: string[] };
      }>(`/session/${encodeURIComponent(localDetail.session.sdkSessionId!)}`);
      expect(engineSession.directory).toBe(workingDirectory);
      expect(engineSession.mcpAllowlist).toEqual({
        servers: [],
        tools: [TOOL_NAME],
      });
      expect(engineSession.permission).toEqual(expect.arrayContaining([
        { permission: 'task', pattern: '*', action: 'deny' },
        { permission: 'task', pattern: 'explore', action: 'allow' },
        { permission: 'task', pattern: 'general', action: 'allow' },
      ]));
      expect(engineSession.permission).not.toContainEqual({
        permission: '*',
        pattern: '*',
        action: 'allow',
      });

      const after = await remoteApi<typeof authoritativeTask>(
        remoteServer.baseUrl,
        remoteOwnerToken,
        `/tasks/${encodeURIComponent(authoritativeTask.id)}`,
      );
      expect(after).toMatchObject({
        id: authoritativeTask.id,
        title,
        notes: authoritativeTask.notes,
        status: authoritativeTask.status,
        locked: authoritativeTask.locked,
        sourceType: 'prod_mirror',
        sourceId,
        ownerId: owner.id,
        updatedAt: authoritativeTask.updatedAt,
      });

      const localDbAfter = new Database(join(SANDBOX, 'rhythm.db'), { readonly: true, fileMustExist: true });
      try {
        expect(localDbAfter.prepare('SELECT id FROM tasks WHERE id = ?').get(authoritativeTask.id)).toBeUndefined();
      } finally {
        localDbAfter.close();
      }
    } finally {
      for (const socket of gatewaySockets) socket.close();
      if (localSessionId) {
        await localApi(`/agent-sessions/${encodeURIComponent(localSessionId)}/hard`, {
          method: 'DELETE',
          body: JSON.stringify({ removeWorktree: true }),
        }).catch(() => undefined);
      }
      if (createdProfile) {
        await localApi('/agent-configs/secretary', { method: 'DELETE' }).catch(() => undefined);
      }
      if (originalConfig) {
        await engineJson('/global/config', {
          method: 'PATCH',
          body: JSON.stringify(originalConfig),
        }).catch(() => undefined);
        await localApi('/system/refresh', { method: 'POST' }).catch(() => undefined);
      }
      if (workingDirectory) rmSync(workingDirectory, { recursive: true, force: true });
      await closeServer(provider);
      if (remoteServer) await remoteServer.close().catch(() => undefined);
      remoteDb?.close();
    }
  }, 180_000);
});
