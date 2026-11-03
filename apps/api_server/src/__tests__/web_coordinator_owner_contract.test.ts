/** Public HTTP boundary contracts; real owner/auth/routes/stores, no engine or model. */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const web = vi.hoisted(() => ({ current: null as null | {
  hosts: string[]; origins: string[]; ownerUserId: number; distDir: string;
} }));
vi.mock('../config/web_host', () => ({ get webHostConfig() { return web.current; } }));

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';
import type { PersistentWorkstreamCoordinator } from '../services/persistent_workstream_coordinator';
import { initializeWebHost } from '../services/web_host';
import { startTestServer, type TestServer } from './helpers/real_server';

const origin = 'https://rhythm-web-coordinator.example.ts.net';
const host = new URL(origin).host;
type HttpResult = { status: number; body: any; text: string };

describe('web-coordinator-3: narrow configured-owner ingress', () => {
  let db: Database.Database;
  let previous: Database.Database | null;
  let directory: string;
  let server: TestServer;
  let service: CoordinatorConversationService;
  let owner: ReturnType<UsersRepository['create']>;
  let other: ReturnType<UsersRepository['create']>;
  let ownerToken: string;
  let otherToken: string;
  let ownerRoot: { sessionId: string; projectId: string };
  let otherRoot: { sessionId: string; projectId: string };
  const originalEnv = { agentLocal: env.agentLocal, agentExecutionEnabled: env.agentExecutionEnabled,
    agentOriginGuardEnabled: env.agentOriginGuardEnabled, localRendererOrigins: env.localRendererOrigins,
    dbClient: env.dbClient, bridgeEnabled: env.bridgeEnabled, workstreamsEnabled: env.workstreamsEnabled };

  function seedRoot(user: typeof owner, token: string) {
    const cwd = path.join(directory, String(user.id));
    fs.mkdirSync(cwd);
    const project = new ProjectsRepository().createCoordinatorOwned({ ownerUserId: user.id,
      setupKey: randomUUID(), cwd, profileId: 'web-coordinator-test', name: '[smoke] web coordinator', workspaceGeneration: 1 }).project;
    const result = service.resolvePrimary({ user, sessionToken: token }, { projectId: project.id });
    expect(result.kind, 'real service must create the inert fixture root').toBe('resolved');
    if (result.kind !== 'resolved') throw new Error(JSON.stringify(result));
    return { sessionId: result.sessionId, projectId: result.projectId };
  }

  function app() {
    return createApp({ coordinatorConversationService: service,
      // Only the existing mount gate reads this presence. The no-model routes
      // below never call a coordinator; actual runtime proof belongs to Playwright.
      workstreamCoordinator: {} as PersistentWorkstreamCoordinator });
  }

  beforeEach(async () => {
    Object.assign(env, { agentLocal: true, agentExecutionEnabled: true, agentOriginGuardEnabled: true,
      localRendererOrigins: ['rhythm://app'], dbClient: 'sqlite', bridgeEnabled: true, workstreamsEnabled: true });
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-web-coordinator-contract-')));
    fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><title>Synthetic Coordinator</title>');
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    previous = setDb(db);
    owner = new UsersRepository().create({ name: 'Synthetic Web Owner', email: 'coordinator-owner@example.invalid', role: 'admin' });
    other = new UsersRepository().create({ name: 'Other Synthetic Owner', email: 'coordinator-other@example.invalid', role: 'admin' });
    ownerToken = (await new SessionsRepository().createAsync(owner.id)).token;
    otherToken = (await new SessionsRepository().createAsync(other.id)).token;
    const configs = new AgentConfigsRepository();
    configs.insert({ id: 'web-coordinator-test', label: '[smoke] Coordinator contract', icon: 'bot', enabled: true,
      isAgent: true, modelProvider: 'synthetic-unused', modelId: 'never-called', corePermissionsJson: '{"*":"deny"}' });
    const projects = new ProjectsRepository();
    const unusedContext = { read: async (): Promise<never> => { throw new Error('Navigation must not request model context'); } };
    service = new CoordinatorConversationService({ repository: new CoordinatorConversationsRepository(db),
      context: new CoordinatorConversationContextAssembler({ tasks: unusedContext, schedules: unusedContext,
        workstreams: unusedContext, receipts: unusedContext }), sessions: new AgentSessionsRepository(),
      messages: new AgentSessionMessagesRepository(), configs, projects,
      projectAccess: { canAccess: ({ actor, projectId }) => projects.isCoordinatorOwnedBy(actor.user.id, projectId) },
      enabled: () => true });
    ownerRoot = seedRoot(owner, ownerToken);
    otherRoot = seedRoot(other, otherToken);
    web.current = { hosts: [host], origins: [origin], ownerUserId: owner.id, distDir: directory };
    await initializeWebHost();
    server = await startTestServer(app());
  });

  afterEach(async () => {
    await server?.close();
    web.current = null;
    Object.assign(env, originalEnv);
    setDb(previous);
    db?.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  async function call(route: string, body?: unknown, extra: Record<string, string | undefined> = {}): Promise<HttpResult> {
    const headers: Record<string, string> = { host, origin, 'content-type': 'application/json' };
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) delete headers[key.toLowerCase()]; else headers[key.toLowerCase()] = value;
    }
    return new Promise((resolve, reject) => {
      const req = http.request(`${server.baseUrl}${route}`, { method: body === undefined ? 'GET' : 'POST', headers }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => { let parsed: unknown = text; try { parsed = JSON.parse(text); } catch { /* Preserve error body. */ }
          resolve({ status: response.statusCode!, body: parsed, text }); });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  const roots = () => db.prepare('SELECT id,owner_user_id,project_id,sdk_session_id,coordinator_conversation_json FROM agent_sessions ORDER BY id').all();

  it('web-coordinator-3-a01: tokenless resolve, open and history use only the validated configured owner', async () => {
    const before = roots();
    for (const [route, input, kind] of [
      ['resolve', {}, 'resolved'], ['open', ownerRoot, 'replay'], ['history', { ...ownerRoot, limit: 50 }, 'history'],
    ] as const) {
      const result = await call(`/coordinator-conversations/${route}`, input);
      expect(result.status, result.text).toBe(200);
      expect(result.body).toMatchObject({ kind, conversation: { ...ownerRoot, ownerUserId: owner.id, primaryOwnerRoot: true } });
      if (route === 'resolve') expect(result.body).toMatchObject({ ...ownerRoot, created: false });
      if (route === 'history') expect(result.body).toMatchObject({ messages: [], hasMore: false });
    }
    expect(roots()).toEqual(before);
    expect(db.prepare('SELECT id FROM agent_sessions WHERE sdk_session_id IS NOT NULL').all()).toEqual([]);
  });

  it('web-coordinator-3-a02: tokenless callers cannot read a foreign root or spoof owner and runtime fields', async () => {
    const before = roots();
    for (const route of ['open', 'history']) {
      const result = await call(`/coordinator-conversations/${route}`, { ...otherRoot, ...(route === 'history' ? { limit: 50 } : {}) });
      // Existing history deliberately uses its closed unavailable envelope;
      // the web adapter must preserve it without exposing foreign contents.
      expect(result.status, result.text).toBe(route === 'history' ? 503 : 404);
      expect(result.body).toEqual({ kind: route === 'history' ? 'history_unavailable' : 'not_found' });
    }
    for (const injected of [{ ownerUserId: other.id }, { sessionToken: otherToken }, { sdkSessionId: 'spoofed' }]) {
      expect((await call('/coordinator-conversations/open', { ...ownerRoot, ...injected })).status).toBe(400);
    }
    expect(roots()).toEqual(before);
  });

  it('web-coordinator-3-a03: an explicit bearer remains authoritative and invalid authorization never falls back to owner', async () => {
    for (const authorization of ['Bearer invalid', 'Basic invalid', '']) {
      expect((await call('/coordinator-conversations/resolve', {}, { authorization })).status).toBe(401);
      expect((await call('/shared-agents/v1/catalog', undefined, { authorization })).status).toBe(401);
    }
    const selected = await call('/coordinator-conversations/resolve', {}, { authorization: `Bearer ${otherToken}` });
    expect(selected.status, selected.text).toBe(200);
    expect(selected.body).toMatchObject({ ...otherRoot, conversation: { ownerUserId: other.id } });
    expect((await call('/coordinator-conversations/open', ownerRoot, { authorization: `Bearer ${otherToken}` })).status).toBe(404);
  });

  it('web-coordinator-3-a04: tokenless shared catalog reports canonical revision and configured-owner scope', async () => {
    const result = await call('/shared-agents/v1/catalog');
    expect(result.status, result.text).toBe(200);
    expect(result.body.agents.length).toBeGreaterThan(0);
    const row = result.body.agents.find((agent: { id: string }) => agent.id === 'web-coordinator-test');
    expect(row.revision).toBe(new AgentConfigsRepository().getById(row.id)?.revision);
    expect(row.runtimes.opencode.readiness).toEqual(expect.any(String));
    const detail = await call(`/shared-agents/v1/catalog/${row.id}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body).toEqual(row);
    const desktop = await call('/shared-agents/v1/catalog', undefined, { authorization: `Bearer ${ownerToken}` });
    expect(desktop.status).toBe(200);
    expect(result.body.scope).toEqual(desktop.body.scope);
    expect(result.body.agents).toEqual(desktop.body.agents);
  });

  it('web-coordinator-3-a05: Host and Origin guard these routes and tokenless Hermes relay remains unauthorized', async () => {
    for (const headers of [{ host: 'foreign.example' }, { origin: 'https://foreign.example' }]) {
      expect((await call('/coordinator-conversations/resolve', {}, headers)).status).toBe(403);
      expect((await call('/shared-agents/v1/catalog', undefined, headers)).status).toBe(403);
    }
    expect((await call('/agent-approvals/relay/pending')).status).toBe(401);
  });

  it('web-coordinator-3-a06: web-off keeps both surfaces bearer-only and existing bearer navigation works', async () => {
    await server.close();
    web.current = null;
    server = await startTestServer(app());
    const nativeHeaders = { host: new URL(server.baseUrl).host, origin: 'rhythm://app' };
    expect((await call('/coordinator-conversations/resolve', {}, nativeHeaders)).status).toBe(401);
    expect((await call('/shared-agents/v1/catalog', undefined, nativeHeaders)).status).toBe(401);
    const result = await call('/coordinator-conversations/resolve', {}, { ...nativeHeaders, authorization: `Bearer ${ownerToken}` });
    expect(result.status, result.text).toBe(200);
    expect(result.body).toMatchObject({ ...ownerRoot, conversation: { ownerUserId: owner.id } });
  });
});
