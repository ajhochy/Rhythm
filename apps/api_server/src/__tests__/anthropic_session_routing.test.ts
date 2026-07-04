/**
 * Task D (dual Anthropic accounts) — per-session account routing + spillover intake.
 *
 * Route-level tests through the REAL Express routers, controllers, repos, and
 * the REAL AnthropicAccountsService singleton (pointed at a temp file via
 * RHYTHM_ACCOUNTS_FILE). The only fakes: the SDK client (real SDK shapes),
 * the stream bridge (no-op), and ws_gateway (call capture).
 *
 * Covers the six cases from plan Step D2:
 *   1. body.anthropicAccountId wins → persisted + setRouting(sdkId, id)
 *   2. profile default_anthropic_account_id used when body omits it
 *   3. store defaultAccountId fallback; empty store → null, no setRouting
 *   4. unknown body id → 400
 *   5. POST /opencode/spillover with known sdkSessionId → row update +
 *      setRouting + session.spillover broadcast + broadcastSessionUpdated → 200
 *   6. unknown sdkSessionId → 202
 *
 * Run: cd apps/api_server && npx vitest run src/__tests__/anthropic_session_routing.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';
import os from 'os';
import { rmSync } from 'fs';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { OpencodeClientService } from '../services/opencode_client_service';

// AGENT_LOCAL + the accounts-file override must be set BEFORE any module under
// test evaluates (env.ts reads AGENT_LOCAL at import; the accounts service
// singleton captures RHYTHM_ACCOUNTS_FILE at construction).
const { service, fake, sessionMap, broadcasts, sessionUpdatedCalls, accountsPath } = vi.hoisted(() => {
  process.env.AGENT_LOCAL = 'true';
  const path = `${require('os').tmpdir()}/anthropic-routing-test-${process.pid}/accounts.json`;
  process.env.RHYTHM_ACCOUNTS_FILE = path;
  return {
    service: { ref: null as unknown as OpencodeClientService },
    fake: { ref: null as unknown as Record<string, unknown> },
    sessionMap: new Map<string, string>(),
    broadcasts: [] as Array<Record<string, unknown>>,
    sessionUpdatedCalls: [] as Array<Record<string, unknown>>,
    accountsPath: path,
  };
});

vi.mock('../services/ws_gateway', () => ({
  broadcast: (m: Record<string, unknown>) => broadcasts.push(m),
  broadcastSessionUpdated: (s: Record<string, unknown>) => sessionUpdatedCalls.push(s),
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
import { opencodeSpilloverRouter } from '../routes/opencode_spillover_routes';
import { errorHandler } from '../middleware/error_handler';
import { anthropicAccountsService } from '../services/anthropic_accounts_service';

function makeFakeClient() {
  return {
    app: {
      agents: vi.fn().mockResolvedValue({
        data: [{ name: 'build', mode: 'primary', builtIn: true }],
      }),
    },
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: 'sdk-session-1' } }),
    },
  };
}

function injectClient(svc: OpencodeClientService, client: unknown) {
  (svc as unknown as Record<string, unknown>)['status'] = 'ready';
  (svc as unknown as Record<string, unknown>)['client'] = client;
}

let server: http.Server;
let base: string;
let repo: AgentSessionsRepository;
let setRoutingSpy: ReturnType<typeof vi.spyOn>;

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
  app.use('/opencode/spillover', opencodeSpilloverRouter);
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
  sessionUpdatedCalls.length = 0;
  sessionMap.clear();
  rmSync(accountsPath, { force: true });
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo = new AgentSessionsRepository();
  service.ref = new OpencodeClientService();
  fake.ref = makeFakeClient();
  injectClient(service.ref, fake.ref);
  vi.spyOn(service.ref, 'listAuthedProviders').mockResolvedValue(['anthropic']);
  setRoutingSpy?.mockRestore();
  setRoutingSpy = vi.spyOn(anthropicAccountsService, 'setRouting');
});

function seedAccount(id: string) {
  anthropicAccountsService.upsertAccount({
    id,
    label: id,
    access: 'a',
    refresh: 'r',
    expires: Date.now() + 3_600_000,
    status: 'ok',
  });
}

describe('POST /agent-sessions — anthropic account resolution', () => {
  it('1. body.anthropicAccountId wins: persisted on the row + setRouting(sdkId, id)', async () => {
    seedAccount('team');
    seedAccount('personal');
    const { status, body } = await req('POST', '/agent-sessions', {
      cwd: os.homedir(),
      name: 'Override',
      anthropicAccountId: 'personal',
    });
    expect(status).toBe(201);
    expect(body.anthropicAccountId).toBe('personal');
    expect(repo.findById(body.id)!.anthropicAccountId).toBe('personal');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-session-1', 'personal');
  });

  it('2. profile default_anthropic_account_id used when body omits it', async () => {
    seedAccount('personal');
    seedAccount('team');
    anthropicAccountsService.setDefault('personal');
    const cfgRepo = new AgentConfigsRepository();
    cfgRepo.insert({ id: 'tester', label: 'Tester', icon: 'T' });
    cfgRepo.update('tester', { defaultAnthropicAccountId: 'team' });
    const { status, body } = await req('POST', '/agent-sessions', {
      agentId: 'tester',
      cwd: os.homedir(),
      name: 'ProfileDefault',
    });
    expect(status).toBe(201);
    expect(body.anthropicAccountId).toBe('team');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-session-1', 'team');
  });

  it('3a. store defaultAccountId fallback when body and profile are silent', async () => {
    seedAccount('team');
    const { status, body } = await req('POST', '/agent-sessions', {
      cwd: os.homedir(),
      name: 'StoreDefault',
    });
    expect(status).toBe(201);
    expect(body.anthropicAccountId).toBe('team');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-session-1', 'team');
  });

  it('3b. empty store → column null, NO setRouting call', async () => {
    const { status, body } = await req('POST', '/agent-sessions', {
      cwd: os.homedir(),
      name: 'NoAccounts',
    });
    expect(status).toBe(201);
    expect(body.anthropicAccountId).toBeNull();
    expect(setRoutingSpy).not.toHaveBeenCalled();
  });

  it('4. unknown body id → 400, no session created, no SDK call', async () => {
    seedAccount('team');
    const { status, body } = await req('POST', '/agent-sessions', {
      cwd: os.homedir(),
      name: 'Ghost',
      anthropicAccountId: 'ghost',
    });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('ghost');
    expect((fake.ref as any).session.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /agent-sessions/:id — switch anthropic account', () => {
  function seedSession(opts: { sdkSessionId?: string } = {}) {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Switchable',
      anthropicAccountId: 'team',
    });
    if (opts.sdkSessionId) repo.setSdkSessionId(session.id, opts.sdkSessionId);
    return session;
  }

  it('happy path: row updated + setRouting(sdkId, id) + session.updated broadcast', async () => {
    seedAccount('team');
    seedAccount('personal');
    const session = seedSession({ sdkSessionId: 'sdk-switch-1' });

    const { status, body } = await req('PATCH', `/agent-sessions/${session.id}`, {
      anthropicAccountId: 'personal',
    });
    expect(status).toBe(200);
    expect(body.anthropicAccountId).toBe('personal');
    expect(repo.findById(session.id)!.anthropicAccountId).toBe('personal');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-switch-1', 'personal');
    expect(sessionUpdatedCalls).toHaveLength(1);
    expect((sessionUpdatedCalls[0] as any).anthropicAccountId).toBe('personal');
  });

  it('unknown account id → 400, row untouched', async () => {
    seedAccount('team');
    const session = seedSession({ sdkSessionId: 'sdk-switch-2' });

    const { status, body } = await req('PATCH', `/agent-sessions/${session.id}`, {
      anthropicAccountId: 'ghost',
    });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('ghost');
    expect(repo.findById(session.id)!.anthropicAccountId).toBe('team');
    expect(setRoutingSpy).not.toHaveBeenCalled();
  });

  it('null → 400 (clearing is not supported)', async () => {
    seedAccount('team');
    const session = seedSession();

    const { status } = await req('PATCH', `/agent-sessions/${session.id}`, {
      anthropicAccountId: null,
    });
    expect(status).toBe(400);
    expect(repo.findById(session.id)!.anthropicAccountId).toBe('team');
  });

  it('session without sdk_session_id: row updates, no setRouting call', async () => {
    seedAccount('team');
    seedAccount('personal');
    const session = seedSession();

    const { status, body } = await req('PATCH', `/agent-sessions/${session.id}`, {
      anthropicAccountId: 'personal',
    });
    expect(status).toBe(200);
    expect(body.anthropicAccountId).toBe('personal');
    expect(repo.findById(session.id)!.anthropicAccountId).toBe('personal');
    expect(setRoutingSpy).not.toHaveBeenCalled();
    expect(sessionUpdatedCalls).toHaveLength(1);
  });
});

describe('POST /opencode/spillover — engine plugin failover intake', () => {
  it('5. known sdkSessionId → row updated + setRouting + broadcasts → 200', async () => {
    seedAccount('team');
    seedAccount('personal');
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Spill',
      anthropicAccountId: 'team',
    });
    repo.setSdkSessionId(session.id, 'sdk-spill-1');

    const { status } = await req('POST', '/opencode/spillover', {
      sdkSessionId: 'sdk-spill-1',
      fromAccountId: 'team',
      toAccountId: 'personal',
      reason: 'rate_limited',
    });
    expect(status).toBe(200);

    const updated = repo.findById(session.id)!;
    expect(updated.anthropicAccountId).toBe('personal');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-spill-1', 'personal');

    const spillEvent = broadcasts.find((b) => b.type === 'session.spillover');
    expect(spillEvent).toMatchObject({
      v: 1,
      type: 'session.spillover',
      sessionId: session.id,
      fromAccountId: 'team',
      toAccountId: 'personal',
      reason: 'rate_limited',
    });
    expect(sessionUpdatedCalls).toHaveLength(1);
    expect((sessionUpdatedCalls[0] as any).anthropicAccountId).toBe('personal');
  });

  it('6. unknown sdkSessionId → 202 accepted, no broadcast, no crash', async () => {
    const { status } = await req('POST', '/opencode/spillover', {
      sdkSessionId: 'sdk-never-seen',
      fromAccountId: 'team',
      toAccountId: 'personal',
      reason: 'rate_limited',
    });
    expect(status).toBe(202);
    expect(broadcasts).toHaveLength(0);
    expect(sessionUpdatedCalls).toHaveLength(0);
    expect(setRoutingSpy).not.toHaveBeenCalled();
  });
});
