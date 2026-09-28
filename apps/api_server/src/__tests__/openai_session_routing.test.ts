/**
 * Multi-account OpenAI (ChatGPT/Codex) — per-session/per-profile routing and
 * provider-aware spillover, mirroring anthropic_session_routing.test.ts with
 * the REAL OpenAIAccountsService singleton on a temp RHYTHM_OPENAI_ACCOUNTS_FILE.
 * Synthetic tokens only.
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
  const path = `${require('os').tmpdir()}/openai-routing-test-${process.pid}/accounts.json`;
  process.env.RHYTHM_ACCOUNTS_FILE = `${path}.anthropic.json`;
  process.env.RHYTHM_OPENAI_ACCOUNTS_FILE = path;
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
import { openaiAccountsService } from '../services/openai_accounts_service';
import { readFileSync } from 'fs';
import { join } from 'path';

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
let anthropicRoutingSpy: ReturnType<typeof vi.spyOn>;

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
  rmSync(`${accountsPath}.anthropic.json`, { force: true });
  setRoutingSpy?.mockRestore();
  setRoutingSpy = vi.spyOn(openaiAccountsService, 'setRouting');
  anthropicRoutingSpy?.mockRestore();
  anthropicRoutingSpy = vi.spyOn(anthropicAccountsService, 'setRouting');
});

function seedAccount(id: string) {
  openaiAccountsService.upsertAccount({
    id,
    label: id,
    access: 'a',
    refresh: 'r',
    expires: Date.now() + 3_600_000,
    status: 'ok',
    chatgptAccountId: `ws-${id}`,
  });
}

describe('POST /agent-sessions — openai account resolution', () => {
  it('body.openaiAccountId wins: persisted + routing written to openai-accounts.json', async () => {
    seedAccount('work');
    seedAccount('home');
    const { status, body } = await req('POST', '/agent-sessions', {
      cwd: os.homedir(),
      name: 'Override',
      openaiAccountId: 'home',
    });
    expect(status).toBe(201);
    expect(body.openaiAccountId).toBe('home');
    expect(repo.findById(body.id)!.openaiAccountId).toBe('home');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-session-1', 'home');
    expect(JSON.parse(readFileSync(accountsPath, 'utf8')).routing).toEqual({ 'sdk-session-1': 'home' });
  });

  it('profile default_openai_account_id beats the store default', async () => {
    seedAccount('work');
    seedAccount('home');
    const cfgRepo = new AgentConfigsRepository();
    cfgRepo.insert({ id: 'tester', label: 'Tester', icon: 'T' });
    cfgRepo.update('tester', { defaultOpenaiAccountId: 'home' });
    expect(cfgRepo.getById('tester')!.defaultOpenaiAccountId).toBe('home');
    const { body } = await req('POST', '/agent-sessions', { agentId: 'tester', cwd: os.homedir(), name: 'P' });
    expect(body.openaiAccountId).toBe('home');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-session-1', 'home');
  });

  it('store default fallback; empty store → null and no routing', async () => {
    const empty = await req('POST', '/agent-sessions', { cwd: os.homedir(), name: 'None' });
    expect(empty.body.openaiAccountId).toBeNull();
    expect(setRoutingSpy).not.toHaveBeenCalled();
    seedAccount('work');
    const { body } = await req('POST', '/agent-sessions', { cwd: os.homedir(), name: 'Default' });
    expect(body.openaiAccountId).toBe('work');
  });

  it('unknown body id → 400 before any SDK call', async () => {
    seedAccount('work');
    const { status, body } = await req('POST', '/agent-sessions', { cwd: os.homedir(), name: 'G', openaiAccountId: 'ghost' });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('ghost');
    expect((fake.ref as any).session.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /agent-sessions/:id — switch openai account', () => {
  it('updates the row + routing, rejects unknown/null', async () => {
    seedAccount('work');
    seedAccount('home');
    const session = repo.insert({ agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: os.homedir(), name: 'S', openaiAccountId: 'work' });
    repo.setSdkSessionId(session.id, 'sdk-sw');
    const ok = await req('PATCH', `/agent-sessions/${session.id}`, { openaiAccountId: 'home' });
    expect(ok.status).toBe(200);
    expect(ok.body.openaiAccountId).toBe('home');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-sw', 'home');
    expect((await req('PATCH', `/agent-sessions/${session.id}`, { openaiAccountId: 'ghost' })).status).toBe(400);
    expect((await req('PATCH', `/agent-sessions/${session.id}`, { openaiAccountId: null })).status).toBe(400);
    expect(repo.findById(session.id)!.openaiAccountId).toBe('home');
  });
});

describe('POST /opencode/spillover — providerID openai', () => {
  it('moves the OpenAI account only; the Anthropic account and routing stay put', async () => {
    seedAccount('work');
    seedAccount('home');
    const session = repo.insert({
      agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: os.homedir(), name: 'Spill',
      anthropicAccountId: 'team', openaiAccountId: 'work',
    });
    repo.setSdkSessionId(session.id, 'sdk-oa-spill');
    const { status } = await req('POST', '/opencode/spillover', {
      sdkSessionId: 'sdk-oa-spill', providerID: 'openai', fromAccountId: 'work', toAccountId: 'home', reason: 'rate_limited',
    });
    expect(status).toBe(200);
    const updated = repo.findById(session.id)!;
    expect(updated.openaiAccountId).toBe('home');
    expect(updated.anthropicAccountId).toBe('team');
    expect(setRoutingSpy).toHaveBeenCalledWith('sdk-oa-spill', 'home');
    expect(anthropicRoutingSpy).not.toHaveBeenCalled();
    expect(broadcasts.find((b) => b.type === 'session.spillover')).toMatchObject({
      sessionId: session.id, fromAccountId: 'work', toAccountId: 'home', providerID: 'openai',
    });
  });

  it('without providerID it stays Anthropic (unchanged behaviour)', async () => {
    const session = repo.insert({
      agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: os.homedir(), name: 'A',
      anthropicAccountId: 'team', openaiAccountId: 'work',
    });
    repo.setSdkSessionId(session.id, 'sdk-a-spill');
    await req('POST', '/opencode/spillover', { sdkSessionId: 'sdk-a-spill', fromAccountId: 'team', toAccountId: 'personal' });
    expect(repo.findById(session.id)).toMatchObject({ anthropicAccountId: 'personal', openaiAccountId: 'work' });
    expect(anthropicRoutingSpy).toHaveBeenCalledWith('sdk-a-spill', 'personal');
    expect(setRoutingSpy).not.toHaveBeenCalled();
    expect(broadcasts.find((b) => b.type === 'session.spillover')).not.toHaveProperty('providerID');
  });
});

describe('schema: openai account columns exist in SQLite and Postgres', () => {
  it('SQLite migrations add agent_sessions.openai_account_id + agent_configs.default_openai_account_id', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = (t: string) => (db.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name);
    expect(cols('agent_sessions')).toContain('openai_account_id');
    expect(cols('agent_configs')).toContain('default_openai_account_id');
  });

  it('Postgres bootstrap adds the same columns (drift guard)', () => {
    const pg = readFileSync(join(__dirname, '..', 'database', 'postgres_bootstrap.ts'), 'utf8');
    expect(pg).toContain('ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS openai_account_id TEXT');
    expect(pg).toContain('ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS default_openai_account_id TEXT');
  });
});
