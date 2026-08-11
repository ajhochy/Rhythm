/**
 * ROUTE-LEVEL SDK-boundary tests — the five priority paths, driven through the
 * REAL Express router, controller, service, and error handler. The ONLY fake is
 * the SDK client, and it has the REAL SDK shape.
 *
 *   fetch -> express(agentSessionsRouter) -> AgentSessionsController (REAL)
 *         -> OpencodeClientService (REAL) -> fakeSdkClient (REAL SDK shapes)
 *
 * No mocking of service methods (no `listAgents`/`createSession`
 * spies). The service calls the real-shaped fake client exactly as it would the
 * real SDK, so a wrong call site (`client.agents` vs `client.app.agents`) or a
 * wrong body shape surfaces here as an HTTP error, not a green false positive.
 *
 * Transport: a real `http` server on an ephemeral port + global fetch (Node 22).
 * This exercises Express routing (e.g. /agents declared before /:id), the JSON
 * body parser, and the real errorHandler (AppError -> status code) — the full
 * stack a smoke would hit, minus the network to a live opencode engine.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_agent_session_routes.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';
import os from 'os';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { OpencodeClientService } from '../services/opencode_client_service';

// AGENT_LOCAL must be true BEFORE env.ts evaluates so the router skips
// requireAuth. vi.hoisted runs before any import in this file.
const { service, fake, sessionMap, broadcasts } = vi.hoisted(() => {
  process.env.AGENT_LOCAL = 'true';
  return {
    service: { ref: null as unknown as OpencodeClientService },
    fake: { ref: null as unknown as Record<string, unknown> },
    sessionMap: new Map<string, string>(),
    broadcasts: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('../services/ws_gateway', () => ({
  broadcast: (m: Record<string, unknown>) => broadcasts.push(m),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

// The stream bridge is exercised in opc_event_stream_bridge.test.ts; here it is
// a no-op so create()/permission paths don't try to open a real SSE stream.
vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    clearPendingPermission: vi.fn(),
    getPendingPermission: vi.fn(),
  },
}));

// REAL service instance + REAL session map (NOT a service-method mock).
vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return service.ref;
  },
  opencodeSessionMap: sessionMap,
}));

import express from 'express';
import { agentSessionsRouter } from '../routes/agent_sessions_routes';
import { errorHandler } from '../middleware/error_handler';

// ---------------------------------------------------------------------------
// Real-shaped fake SDK client
// ---------------------------------------------------------------------------

function makeFakeClient() {
  return {
    app: {
      // GET /agent -> { data: Array<Agent> } (hey-api envelope).
      agents: vi.fn().mockResolvedValue({
        data: [
          { name: 'build', mode: 'primary', builtIn: true },
          { name: 'plan', mode: 'primary', builtIn: true },
        ],
      }),
    },
    session: {
      // POST /session -> { data: Session }.
      create: vi.fn().mockResolvedValue({ data: { id: 'sdk-session-1' } }),
    },
    // Top-level permission responder -> { data: boolean }.
    postSessionIdPermissionsPermissionId: vi.fn().mockResolvedValue({ data: true }),
  };
}

function injectClient(svc: OpencodeClientService, client: unknown) {
  (svc as unknown as Record<string, unknown>)['status'] = 'ready';
  (svc as unknown as Record<string, unknown>)['client'] = client;
}

function setNotReady(svc: OpencodeClientService) {
  (svc as unknown as Record<string, unknown>)['status'] = 'uninitialized';
  (svc as unknown as Record<string, unknown>)['client'] = null;
}

// ---------------------------------------------------------------------------
// HTTP harness
// ---------------------------------------------------------------------------

let server: http.Server;
let base: string;

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

let repo: AgentSessionsRepository;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/agent-sessions', agentSessionsRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  broadcasts.length = 0;
  sessionMap.clear();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo = new AgentSessionsRepository();
  service.ref = new OpencodeClientService();
  fake.ref = makeFakeClient();
  injectClient(service.ref, fake.ref);
  // listAuthedProviders reads auth.json off disk in production — stub it on the
  // instance so the model resolver picks the anthropic route. This is NOT the
  // SDK boundary (no SDK client call); it's a disk read.
  vi.spyOn(service.ref, 'listAuthedProviders').mockResolvedValue(['anthropic']);
});

function insertSession(name: string, cwd = os.homedir()) {
  return repo.insert({
    agentKind: 'claude-code',
    taskId: null,
    taskTitle: null,
    cwd,
    name,
  });
}

// ===========================================================================
// PATH 1 — GET /agent-sessions/agents?cwd=…  (OPC-M4-4, the #703 regression)
// ===========================================================================
describe('GET /agent-sessions/agents -> client.app.agents', () => {
  it('calls client.app.agents with the directory query and returns { agents }', async () => {
    const { status, body } = await req('GET', '/agent-sessions/agents?cwd=/Users/x/proj');
    expect(status).toBe(200);
    // The fixture reports build + plan. `plan` is an engine built-in Rhythm does
    // not use, so it is filtered out of the listing (2026-08-06) and only `build`
    // — the engine default — is offered. The point of this test is the SDK call
    // shape below; the count just has to match the filtered reality.
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({ name: 'build', builtIn: true });
    expect(body.agents.map((a: { name: string }) => a.name)).not.toContain('plan');
    // The REAL SDK call site: client.app.agents({ query: { directory } }).
    const agentsFn = (fake.ref as any).app.agents;
    expect(agentsFn).toHaveBeenCalledWith({ query: { directory: '/Users/x/proj' } });
  });

  it('returns an empty list (graceful degrade) when the engine is not ready', async () => {
    setNotReady(service.ref);
    const { status, body } = await req('GET', '/agent-sessions/agents');
    expect(status).toBe(200);
    expect(body.agents).toEqual([]);
    expect((fake.ref as any).app.agents).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// PATH 2 — POST /agent-sessions create + agentId validation (#653)
// ===========================================================================
describe('POST /agent-sessions -> agentId validation (#653) + client.session.create', () => {
  // Updated for #710 (instant new session): a missing agentId is now valid
  // and creates a placeholder session. The SDK session.create IS called so an
  // SDK session exists for the user to send messages to once they configure
  // their agent. The session is returned as 201.
  it('accepts a missing agentId (instant-create #710) and returns 201', async () => {
    const { status, body } = await req('POST', '/agent-sessions', {
      cwd: os.homedir(),
      name: 'NoAgent',
    });
    expect(status).toBe(201);
    expect(typeof body.id).toBe('string');
    // SDK IS called for instant-create — the session exists and can receive messages.
    expect((fake.ref as any).session.create).toHaveBeenCalledTimes(1);
  });

  it("rejects the legacy '__pending__' sentinel with 400", async () => {
    const { status, body } = await req('POST', '/agent-sessions', {
      agentId: '__pending__',
      cwd: os.homedir(),
      name: 'Pending',
    });
    expect(status).toBe(400);
    expect(body.error.message).toContain('__pending__');
    expect((fake.ref as any).session.create).not.toHaveBeenCalled();
  });

  it('creates a session and calls client.session.create with the title', async () => {
    const { status, body } = await req('POST', '/agent-sessions', {
      agentId: 'claude-code',
      cwd: os.homedir(),
      name: 'RealCreate',
    });
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    const createFn = (fake.ref as any).session.create;
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(createFn.mock.calls[0][0]).toMatchObject({ body: { title: 'RealCreate' } });
    // The SDK session id was mapped for the new local session.
    expect(sessionMap.get(body.id)).toBe('sdk-session-1');
  });
});

// ===========================================================================
// PATH 5 — Permission response -> modern POST /permission/:id/reply (OCU-01 #1042)
// ===========================================================================
describe('POST /:id/permission/:permissionId/:decision -> replyToPermission (OCU-01 #1042)', () => {
  it('maps accept→once and returns 204, broadcasting the canonical reply', async () => {
    const s = insertSession('PermSession', '/tmp/proj');
    sessionMap.set(s.id, 'sdk-perm-1');
    const reply = vi.spyOn(service.ref, 'replyToPermission').mockResolvedValue(true);

    const { status } = await req('POST', `/agent-sessions/${s.id}/permission/perm-42/accept`);
    expect(status).toBe(204);
    // requestID, reply, message, directory, sdkSessionId
    expect(reply).toHaveBeenCalledWith('perm-42', 'once', undefined, '/tmp/proj', 'sdk-perm-1');
    expect(
      broadcasts.some(
        (b) =>
          b.type === 'permission.replied' &&
          b.permissionID === 'perm-42' &&
          b.directory === '/tmp/proj',
      ),
    ).toBe(true);
  });

  it('maps allow→once (Flutter OCU-02 vocabulary)', async () => {
    const s = insertSession('PermAllow', '/tmp/proj');
    sessionMap.set(s.id, 'sdk-perm-allow');
    const reply = vi.spyOn(service.ref, 'replyToPermission').mockResolvedValue(true);

    const { status } = await req('POST', `/agent-sessions/${s.id}/permission/perm-a/allow`);
    expect(status).toBe(204);
    expect(reply).toHaveBeenCalledWith('perm-a', 'once', undefined, '/tmp/proj', 'sdk-perm-allow');
  });

  it('maps always→always for project-level persistence', async () => {
    const s = insertSession('PermAlways', '/tmp/proj');
    sessionMap.set(s.id, 'sdk-perm-always');
    const reply = vi.spyOn(service.ref, 'replyToPermission').mockResolvedValue(true);

    const { status } = await req('POST', `/agent-sessions/${s.id}/permission/perm-b/always`);
    expect(status).toBe(204);
    expect(reply).toHaveBeenCalledWith('perm-b', 'always', undefined, '/tmp/proj', 'sdk-perm-always');
  });

  it('maps deny→reject and passes the feedback message through to the agent', async () => {
    const s = insertSession('PermDeny', '/tmp/proj');
    sessionMap.set(s.id, 'sdk-perm-deny');
    const reply = vi.spyOn(service.ref, 'replyToPermission').mockResolvedValue(true);

    const { status } = await req(
      'POST',
      `/agent-sessions/${s.id}/permission/perm-c/deny`,
      { message: 'not allowed here' },
    );
    expect(status).toBe(204);
    expect(reply).toHaveBeenCalledWith(
      'perm-c',
      'reject',
      'not allowed here',
      '/tmp/proj',
      'sdk-perm-deny',
    );
    expect(broadcasts.some(
      (b) => b.type === 'permission.replied' && b.permissionID === 'perm-c',
    )).toBe(true);
  });

  it('rejects an invalid decision with 400 and never calls the engine', async () => {
    const s = insertSession('PermBad', '/tmp/proj');
    sessionMap.set(s.id, 'sdk-perm-2');
    const reply = vi.spyOn(service.ref, 'replyToPermission').mockResolvedValue(true);
    const { status } = await req('POST', `/agent-sessions/${s.id}/permission/perm-1/maybe`);
    expect(status).toBe(400);
    expect(reply).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Boundary unit guard — respondToPermission must verify the SDK method exists
// before calling it (the postmortem's "permission method exists" requirement).
// ===========================================================================
describe('service: respondToPermission asserts the SDK method exists before calling', () => {
  it('throws naming the method when the client lacks postSessionIdPermissionsPermissionId', async () => {
    const svc = new OpencodeClientService();
    // A client missing the permission method (e.g. an SDK downgrade).
    injectClient(svc, { session: {} });
    await expect(
      svc.respondToPermission('sdk-x', 'perm-x', 'once'),
    ).rejects.toThrow(/postSessionIdPermissionsPermissionId/);
  });

  it('calls the method when present (real shape)', async () => {
    const svc = new OpencodeClientService();
    const permFn = vi.fn().mockResolvedValue({ data: true });
    injectClient(svc, { postSessionIdPermissionsPermissionId: permFn });
    await svc.respondToPermission('sdk-y', 'perm-y', 'reject');
    expect(permFn).toHaveBeenCalledWith({
      path: { id: 'sdk-y', permissionID: 'perm-y' },
      body: { response: 'reject' },
    });
  });
});
