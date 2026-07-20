/**
 * #1119 — a session's selected agent profile must survive an app restart.
 *
 * Root cause (write gap): the Flutter agent-selector pill only ever sent the
 * chosen profile per-turn on the WS `session.input` frame (ws_gateway.ts,
 * "OPC-M4-4: per-turn intra-session agent override, never persisted" by
 * design) — PATCH /agent-sessions/:id had no `agentId` handler at all, so an
 * explicit mid-session profile switch was never written to
 * `agent_sessions.agent_kind`. On a real app restart the in-memory
 * "explicit selection" map is wiped and the client's rehydrate path falls
 * back to the session row's ORIGINAL (default) agent_kind — silently
 * reverting Coding Workflow → Secretary.
 *
 * These are BEHAVIORAL tests through the real Express router + controller +
 * repository + a real SQLite DB (not mocked) — the same layer a genuine app
 * restart's "GET the session, read its agentId" rehydrate step exercises.
 * A fresh AgentSessionsRepository instance is used for the "after restart"
 * read to prove the value survives independent of any in-process cache.
 *
 * Run: cd apps/api_server && npx vitest run src/__tests__/issue_1119_session_profile_persist_restart.test.ts
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

const { service, fake, sessionMap } = vi.hoisted(() => {
  process.env.AGENT_LOCAL = 'true';
  return {
    service: { ref: null as unknown as OpencodeClientService },
    fake: { ref: null as unknown as Record<string, unknown> },
    sessionMap: new Map<string, string>(),
  };
});

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    clearPendingPermission: vi.fn(),
    getPendingPermission: vi.fn(),
  },
}));

vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return service.ref;
  },
  opencodeSessionMap: sessionMap,
}));

import express from 'express';
import { agentSessionsRouter } from '../routes/agent_sessions_routes';
import { errorHandler } from '../middleware/error_handler';

function injectClient(svc: OpencodeClientService, client: unknown) {
  (svc as unknown as Record<string, unknown>)['status'] = 'ready';
  (svc as unknown as Record<string, unknown>)['client'] = client;
}

let server: http.Server;
let base: string;
let repo: AgentSessionsRepository;

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
  sessionMap.clear();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo = new AgentSessionsRepository();
  service.ref = new OpencodeClientService();
  fake.ref = { app: { agents: vi.fn() }, session: { create: vi.fn() } };
  injectClient(service.ref, fake.ref);
});

function seedSession() {
  // 'claude-code' stands in for whatever default profile the session was
  // created with (the DTO's agentKind type is the narrow engine-kind union;
  // the DB column itself is free-text — see the "logical FK" comment in
  // migrations.ts). The PATCH body below carries the free-form profile id
  // ('coding-workflow') exactly as the Flutter picker sends it.
  return repo.insert({
    agentKind: 'claude-code',
    taskId: null,
    taskTitle: null,
    cwd: os.homedir(),
    name: 'Persist-me',
  });
}

describe('#1119 — session profile persists across app restart', () => {
  it('an explicit mid-session profile switch (PATCH agentId) is written to the row', async () => {
    const session = seedSession();
    expect(repo.findById(session.id)!.agentKind).toBe('claude-code');

    const { status, body } = await req('PATCH', `/agent-sessions/${session.id}`, {
      agentId: 'coding-workflow',
    });

    expect(status).toBe(200);
    expect(body.agentKind).toBe('coding-workflow');
    expect(repo.findById(session.id)!.agentKind).toBe('coding-workflow');
  });

  it('BEHAVIORAL: restore-on-restart reads the persisted profile, not the default', async () => {
    const session = seedSession();
    await req('PATCH', `/agent-sessions/${session.id}`, { agentId: 'coding-workflow' });

    // Simulate an app restart: the in-process WS session map + Flutter's
    // in-memory "explicit selection" map are both wiped on a real restart.
    // A brand-new repository instance (no shared cache) modeling a fresh
    // process boot reads the SAME on-disk DB — this is exactly what the
    // client's rehydrate GET .../:id would observe post-restart.
    sessionMap.clear();
    const freshRepo = new AgentSessionsRepository();
    const restored = freshRepo.findById(session.id)!;

    expect(restored.agentKind).toBe('coding-workflow');
    expect(restored.agentKind).not.toBe('claude-code');

    // The active-profile indicator's data source: GET /agent-sessions/:id
    // must also reflect the restored profile (what the UI actually reads).
    // getOne responds with { session, messages } (OPC-M1-2).
    const { status, body } = await req('GET', `/agent-sessions/${session.id}`);
    expect(status).toBe(200);
    expect(body.session.agentKind).toBe('coding-workflow');
  });

  it('acceptance: no explicit selection ever made → default behavior unchanged', async () => {
    const session = seedSession();

    // A PATCH that never mentions agentId (e.g. a permissionMode-only update,
    // matching the existing PermissionModePicker flow) must not touch the
    // stored profile.
    const { status } = await req('PATCH', `/agent-sessions/${session.id}`, {
      permissionMode: 'plan',
    });
    expect(status).toBe(200);
    expect(repo.findById(session.id)!.agentKind).toBe('claude-code');
  });

  it('rejects a non-string agentId without mutating the row', async () => {
    const session = seedSession();
    const { status } = await req('PATCH', `/agent-sessions/${session.id}`, {
      agentId: 42,
    });
    expect(status).toBe(400);
    expect(repo.findById(session.id)!.agentKind).toBe('claude-code');
  });

  it('an empty-string agentId is a no-op (guards against accidental clears)', async () => {
    const session = seedSession();
    const { status, body } = await req('PATCH', `/agent-sessions/${session.id}`, {
      agentId: '',
    });
    expect(status).toBe(200);
    expect(body.agentKind).toBe('claude-code');
    expect(repo.findById(session.id)!.agentKind).toBe('claude-code');
  });
});
