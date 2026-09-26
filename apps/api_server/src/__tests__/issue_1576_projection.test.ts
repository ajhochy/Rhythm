/**
 * #1576 S2 — served-step capture, projection API and delegation servedModels.
 *
 * S1 (the fork stamping `served` onto step-finish parts) is out of scope and
 * blocked on AJ's authorization. These tests drive SYNTHETIC step-finish
 * parts that carry `served: { modelID, responseID?, requestModelID? }` the
 * way S1 would — the exact contract is docs/ai/contracts/issue-1576-b2.json.
 * Criterion ids: 1576:S2:1 .. 1576:S2:5, matching the lane's acceptance list.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { env } from '../config/env';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { startTestServer } from './helpers/real_server';

const originalDbClient = env.dbClient;

// ── 1576:S2:1 / 1576:S2:2 — bridge capture (real _relayEvent, mocked I/O) ───

const { sessionMap } = vi.hoisted(() => ({ sessionMap: new Map<string, string>() }));
vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
}));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { subscribeToEvents: vi.fn().mockResolvedValue(null) },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

function relay(bridge: OpencodeStreamBridge, event: Record<string, unknown>): void {
  (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
}

function stepFinishPart(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'step-finish',
    id: 'part_stepfinish_1',
    messageID: 'msg_1',
    sessionID: 'sdk-a',
    reason: 'stop',
    served: { modelID: 'meta-llama/x:free', responseID: 'gen-1', requestModelID: 'openrouter/free' },
    ...overrides,
  };
}

describe('#1576 S2 bridge captures served steps', () => {
  let db: Database.Database;
  let localSessionId: string;
  let bridge: OpencodeStreamBridge;

  beforeEach(() => {
    env.dbClient = 'sqlite';
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    const sessionsRepo = new AgentSessionsRepository();
    const session = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'test' });
    localSessionId = session.id;
    sessionMap.set(localSessionId, 'sdk-a');
    bridge = new OpencodeStreamBridge();
  });

  afterEach(() => {
    sessionMap.clear();
    setDb(null);
    db.close();
    env.dbClient = originalDbClient;
  });

  it('1576:S2:1 a step-finish part with served identity inserts exactly one agent_served_steps row', () => {
    relay(bridge, { type: 'message.part.updated', properties: { part: stepFinishPart() } });

    const rows = db.prepare('SELECT * FROM agent_served_steps').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_id: localSessionId,
      sdk_message_id: 'msg_1',
      sdk_part_id: 'part_stepfinish_1',
      request_model_id: 'openrouter/free',
      served_model_id: 'meta-llama/x:free',
      served_response_id: 'gen-1',
    });
  });

  it('1576:S2:1 a duplicate event for the same part still leaves exactly one row', () => {
    relay(bridge, { type: 'message.part.updated', properties: { part: stepFinishPart() } });
    relay(bridge, { type: 'message.part.updated', properties: { part: stepFinishPart() } });

    const count = db.prepare('SELECT COUNT(*) AS n FROM agent_served_steps').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('1576:S2:1 message.removed does not delete the served-step row', () => {
    relay(bridge, { type: 'message.part.updated', properties: { part: stepFinishPart() } });
    relay(bridge, {
      type: 'message.removed',
      properties: { sessionID: 'sdk-a', messageID: 'msg_1' },
    });

    const count = db.prepare('SELECT COUNT(*) AS n FROM agent_served_steps').get() as { n: number };
    expect(count.n).toBe(1);
  });
});

// ── 1576:S2:2 — sanitization + no content columns ───────────────────────────

describe('#1576 S2 served-step sanitization', () => {
  let db: Database.Database;

  beforeEach(() => {
    env.dbClient = 'sqlite';
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    setDb(null);
    db.close();
    env.dbClient = originalDbClient;
  });

  it('1576:S2:2 a served.modelID failing the identifier charset is stored as <unrecognized>', () => {
    const sessionId = new AgentSessionsRepository().insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 's' }).id;
    const repo = new ModelProvenanceRepository();
    const record = repo.insertServedStep({
      sessionId,
      sdkMessageId: 'msg_1',
      sdkPartId: 'part_1',
      requestModelId: 'openrouter/free',
      servedModelId: 'not a valid model id!!',
    });
    expect(record.servedModelId).toBe('<unrecognized>');
  });

  it('1576:S2:2 agent_served_steps has identifier columns only — no content columns', () => {
    const cols = (db.pragma('table_info(agent_served_steps)') as { name: string }[]).map((c) => c.name).sort();
    expect(cols).toEqual([
      'created_at', 'id', 'request_model_id', 'served_model_id',
      'served_response_id', 'session_id', 'sdk_message_id', 'sdk_part_id',
    ].sort());
  });
});

// ── 1576:S2:3 — GET /agent-sessions/:id/model-provenance ────────────────────

describe('#1576 S2 GET /agent-sessions/:id/model-provenance', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;
  let routedSessionId: string;
  let unattributedOnlySessionId: string;
  let plainSessionId: string;

  beforeAll(async () => {
    env.dbClient = 'sqlite';
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    // Imported lazily so mocked services above don't leak into route wiring.
    const { createApp } = await import('../app');
    const { UsersRepository } = await import('../repositories/users_repository');
    const { SessionsRepository } = await import('../repositories/sessions_repository');

    const user = new UsersRepository().create({ name: 'T', email: 'provenance-1576@example.com' });
    const authSession = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${authSession.token}` };

    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    const provenanceRepo = new ModelProvenanceRepository();

    const routed = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'routed' });
    routedSessionId = routed.id;
    sessionsRepo.backfillModel(routedSessionId, 'openrouter', 'openrouter/free');
    provenanceRepo.insertServedStep({
      sessionId: routedSessionId, sdkMessageId: 'msg-a', sdkPartId: 'part-a',
      requestModelId: 'openrouter/free', servedModelId: 'meta-llama/x:free',
    });
    provenanceRepo.insertServedStep({
      sessionId: routedSessionId, sdkMessageId: 'msg-b', sdkPartId: 'part-b',
      requestModelId: 'openrouter/free', servedModelId: 'mistralai/y:free',
    });
    messagesRepo.upsertPart(routedSessionId, 'msg-a', { type: 'step-finish', id: 'part-a', messageID: 'msg-a', served: { modelID: 'meta-llama/x:free' } });
    messagesRepo.upsertPart(routedSessionId, 'msg-b', { type: 'step-finish', id: 'part-b', messageID: 'msg-b', served: { modelID: 'mistralai/y:free' } });
    messagesRepo.upsertPart(routedSessionId, 'msg-c', { type: 'step-finish', id: 'part-c', messageID: 'msg-c' }); // no served -> unattributed

    const unattributedOnly = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'unattributed' });
    unattributedOnlySessionId = unattributedOnly.id;
    messagesRepo.upsertPart(unattributedOnlySessionId, 'msg-x', { type: 'step-finish', id: 'part-x', messageID: 'msg-x' });
    messagesRepo.upsertPart(unattributedOnlySessionId, 'msg-y', { type: 'step-finish', id: 'part-y', messageID: 'msg-y' });

    plainSessionId = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'plain' }).id;

    const started = await startTestServer(createApp());
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  afterAll(async () => {
    await closeServer();
    setDb(null);
    env.dbClient = originalDbClient;
  });

  it('1576:S2:3 returns servedModels in first-seen order, multiModel and routed true, plus the requested alias', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${routedSessionId}/model-provenance`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as { available: boolean; requestedModelId: string | null; servedModels: string[]; multiModel: boolean; routed: boolean; steps: { unattributed: number } };
    expect(body.available).toBe(true);
    expect(body.requestedModelId).toBe('openrouter/free');
    expect(body.servedModels).toEqual(['meta-llama/x:free', 'mistralai/y:free']);
    expect(body.multiModel).toBe(true);
    expect(body.routed).toBe(true);
    expect(body.steps.unattributed).toBe(1);
  });

  it('1576:S2:3 unattributed-only session reports zero servedModels, the right unattributed count, and no fabricated requested alias', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${unattributedOnlySessionId}/model-provenance`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as { available: boolean; requestedModelId: string | null; servedModels: string[]; multiModel: boolean; routed: boolean; steps: { unattributed: number } };
    expect(body.available).toBe(true);
    expect(body.requestedModelId).toBeNull();
    expect(body.servedModels).toEqual([]);
    expect(body.multiModel).toBe(false);
    expect(body.routed).toBe(false);
    expect(body.steps.unattributed).toBe(2);
  });

  it('1576:S2:3 an unknown session id returns 404', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/00000000-0000-0000-0000-000000000000/model-provenance`, { headers: authHeaders });
    expect(res.status).toBe(404);
  });

  it('1576:S2:3 existing GET /agent-sessions/:id response is unaffected (session + messages only)', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${plainSessionId}`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['messages', 'session']);
  });

  it('1576:S2:6 (review follow-up) under the Postgres/cloud role the controller returns 200 with a structured available:false body, never a 500', async () => {
    // A full authenticated HTTP round trip cannot exercise this: flipping
    // env.dbClient also flips SessionsRepository's auth lookup to a real
    // Postgres pool this test never initializes, 500ing before the request
    // ever reaches the controller. Unit-test the controller directly instead
    // (same pattern as agent_delegation_auth.test.ts's controller-level
    // tests) — this isolates exactly the code path the review flagged:
    // controller -> model_provenance_service -> repository's localOnly() guard.
    const { AgentSessionsController } = await import('../controllers/agent_sessions_controller');
    const controller = new AgentSessionsController();
    const next = vi.fn();
    const res = { json: vi.fn() };
    env.dbClient = 'postgres';
    try {
      await controller.getModelProvenance({ params: { id: routedSessionId } } as never, res as never, next);
    } finally {
      env.dbClient = 'sqlite';
    }
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      available: false,
      reason: 'local_only',
      requestedModelId: 'openrouter/free',
      servedModels: [],
      multiModel: false,
      routed: false,
      steps: { unattributed: 0 },
    });
  });
});

// ── 1576:S2:4 — delegation status carries servedModels ──────────────────────

describe('#1576 S2 delegation status includes servedModels', () => {
  let db: Database.Database;

  beforeEach(() => {
    env.dbClient = 'sqlite';
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    setDb(null);
    db.close();
    env.dbClient = originalDbClient;
  });

  it('1576:S2:4 a delegation whose child has served steps reports them', async () => {
    db.prepare(
      `INSERT INTO agent_sessions (id, name, agent_kind, status, cwd) VALUES ('parent-1576', 'p', 'librarian', 'idle', '/tmp')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_sessions (id, name, agent_kind, status, cwd) VALUES ('child-1576', 'c', 'librarian', 'idle', '/tmp')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_async_delegations
        (id, parent_session_id, child_session_id, target_agent_config_id, status, completed_at, created_at, updated_at)
       VALUES ('deleg-1576', 'parent-1576', 'child-1576', 'planning-agent', 'dispatched', NULL, '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')`,
    ).run();
    new ModelProvenanceRepository().insertServedStep({
      sessionId: 'child-1576', sdkMessageId: 'm', sdkPartId: 'p',
      requestModelId: 'openrouter/free', servedModelId: 'meta-llama/x:free',
    });

    const { getDelegationStatus } = await import('../services/async_delegation_status_service');
    const [view] = getDelegationStatus('parent-1576');
    expect(view.servedModels).toEqual(['meta-llama/x:free']);
  });
});

// ── 1576:S2:5 — Postgres no-ops before touching SQLite ──────────────────────

describe('#1576 S2 Postgres unavailability', () => {
  let db: Database.Database;

  beforeEach(() => {
    env.dbClient = 'sqlite';
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    new AgentSessionsRepository().insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 's' });
  });

  afterEach(() => {
    setDb(null);
    db.close();
    env.dbClient = originalDbClient;
  });

  it('1576:S2:5 insertServedStep and servedSummary refuse before touching SQLite under Postgres', () => {
    const repo = new ModelProvenanceRepository();
    const prepare = vi.spyOn(db, 'prepare');
    env.dbClient = 'postgres';
    expect(() => repo.insertServedStep({ sessionId: 's', sdkMessageId: 'm', sdkPartId: 'p', servedModelId: 'x' })).toThrow(/unavailable/i);
    expect(() => repo.servedSummary('s')).toThrow(/unavailable/i);
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
  });

  it('1576:S2:5 agent_served_steps is excluded from Postgres bootstrap and dual-engine parity ownership', () => {
    const bootstrap = readFileSync(join(__dirname, '../database/postgres_bootstrap.ts'), 'utf8');
    const parity = readFileSync(join(__dirname, 'skill_schema_parity.test.ts'), 'utf8');
    expect(bootstrap).not.toMatch(/CREATE TABLE IF NOT EXISTS agent_served_steps\b/i);
    expect(parity).not.toMatch(/^\s*'agent_served_steps',/m);
  });
});
