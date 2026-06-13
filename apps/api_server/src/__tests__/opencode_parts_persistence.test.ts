/**
 * OPC-M1-2 — Structured parts persistence (issue #686)
 *
 * Tests cover criteria c1–c6. All tests run against an in-memory SQLite DB
 * with the bridge replaying recorded v1.14.49 SDK event fixtures.
 *
 * Design notes:
 *  - OpencodeStreamBridge is constructed directly (not singleton) so each test
 *    controls its own instance — simulates bridge restart for c6.
 *  - Mocks use method properties (not arrow functions) where the production
 *    code uses `this`-bound methods, per constraint in issue.
 *  - SDK mocks keep {data, error} envelope shapes (OPC-M1-1 convention).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import type { StructuredAgentSessionMessage } from '../models/agent_session';

// Import fixture with real v1.14.49 shapes.
import fixture from './fixtures/opencode_v1_14_49/message_updated_assistant.json';

// ── mocks ─────────────────────────────────────────────────────────────────────

const { broadcastSpy, broadcastSessionUpdatedSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (s: unknown) => broadcastSessionUpdatedSpy(s),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    respondPermission: vi.fn().mockResolvedValue({ data: true, error: undefined }),
  },
  opencodeSessionMap: sessionMap,
}));

// Import AFTER mocks are registered.
import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const SDK_ID = (fixture.properties as { sessionID: string }).sessionID; // 'ses_abc123'
const SDK_MSG_ID = (fixture.properties as { info: { id: string } }).info.id; // 'msg_abc001'

let localSessionId: string;

function setupSession(repo: AgentSessionsRepository): string {
  const s = repo.insert({ agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: '/tmp', name: 'test' });
  sessionMap.set(s.id, SDK_ID);
  return s.id;
}

function relay(bridge: OpencodeStreamBridge, event: Record<string, unknown>): void {
  (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
}

// ── c1: migration idempotency ─────────────────────────────────────────────────

describe('issue-686-c1: migration is idempotent and preserves existing rows', () => {
  it('running migrations twice does not throw and leaves existing rows intact', () => {
    const db = makeDb();
    // Seed an agent_sessions row so the FK is satisfied.
    db.prepare(`INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
      .run('ses-legacy', 'claude-code', 'idle', '/tmp', 'legacy-test');
    // Insert a legacy row before second migration run.
    db.prepare(`INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text) VALUES (?, ?, ?, ?)`)
      .run('ses-legacy', 'output', 'hello', 'hello');

    // Run migrations a second time — must not throw.
    expect(() => runMigrations(db)).not.toThrow();

    // Legacy row must still exist with parts_json = NULL.
    const row = db.prepare(`SELECT * FROM agent_session_messages WHERE session_id = 'ses-legacy'`).get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.parts_json).toBeNull();
    expect(row.sdk_message_id).toBeNull();
  });

  it('new columns exist after migration: sdk_message_id, parts_json, tokens_json, cost', () => {
    const db = makeDb();
    const cols = (db.pragma('table_info(agent_session_messages)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('sdk_message_id');
    expect(cols).toContain('parts_json');
    expect(cols).toContain('tokens_json');
    expect(cols).toContain('cost');
  });

  it('unique index idx_asm_sdk_msg exists on (session_id, sdk_message_id)', () => {
    const db = makeDb();
    const indexes = db.pragma('index_list(agent_session_messages)') as { name: string; unique: number }[];
    const idx = indexes.find((i) => i.name === 'idx_asm_sdk_msg');
    expect(idx).toBeTruthy();
    expect(idx?.unique).toBe(1);
  });
});

// ── c2: message.updated upserts parts_json/tokens_json/cost ──────────────────

describe('issue-686-c2: message.updated upserts parts_json/tokens_json/cost from v1.14.49 fixture', () => {
  let bridge: OpencodeStreamBridge;
  let messagesRepo: AgentSessionMessagesRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    const sessionsRepo = new AgentSessionsRepository();
    localSessionId = setupSession(sessionsRepo);
    messagesRepo = new AgentSessionMessagesRepository();
    bridge = new OpencodeStreamBridge();
  });

  afterEach(() => {
    sessionMap.clear();
  });

  it('feeding message.updated creates one row with correct parts_json, tokens_json, cost', () => {
    relay(bridge, fixture as unknown as Record<string, unknown>);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // sdk_message_id set
    expect(row.sdkMessageId).toBe(SDK_MSG_ID);
    // assistant maps to 'output' role in the DB (existing convention)
    expect(row.role).toBe('output');
    // parts array round-trips
    expect(Array.isArray(row.parts)).toBe(true);
    const fixtureInfo = fixture.properties as { info: unknown; parts: unknown[] };
    expect(row.parts).toHaveLength(fixtureInfo.parts.length);
    // tokens round-trips
    const fixtureAssistant = fixtureInfo.info as { tokens: unknown; cost: number };
    expect(row.tokens).toEqual(fixtureAssistant.tokens);
    // cost round-trips
    expect(row.cost).toBeCloseTo(fixtureAssistant.cost, 6);
  });

  it('parts array contains entries with correct type discriminators', () => {
    relay(bridge, fixture as unknown as Record<string, unknown>);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    const parts = rows[0].parts as Array<{ type: string }>;
    const types = parts.map((p) => p.type);
    expect(types).toContain('step-start');
    expect(types).toContain('reasoning');
    expect(types).toContain('tool');
    expect(types).toContain('text');
    expect(types).toContain('step-finish');
  });
});

// ── c3: second message.updated for same sdk_message_id updates, no duplicate ─

describe('issue-686-c3: second message.updated for same sdk_message_id updates row without duplication', () => {
  let bridge: OpencodeStreamBridge;
  let messagesRepo: AgentSessionMessagesRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    const sessionsRepo = new AgentSessionsRepository();
    localSessionId = setupSession(sessionsRepo);
    messagesRepo = new AgentSessionMessagesRepository();
    bridge = new OpencodeStreamBridge();
  });

  afterEach(() => {
    sessionMap.clear();
  });

  it('second message.updated with same sdk_message_id results in exactly one row', () => {
    // First upsert
    relay(bridge, fixture as unknown as Record<string, unknown>);

    // Second upsert: same sdk_message_id, updated cost
    const updatedFixture = JSON.parse(JSON.stringify(fixture));
    (updatedFixture.properties.info as { cost: number }).cost = 0.0099;
    relay(bridge, updatedFixture);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    // Still exactly one row — no duplicate
    expect(rows.filter((r) => r.sdkMessageId === SDK_MSG_ID)).toHaveLength(1);
  });

  it('second message.updated updates cost on the same row', () => {
    relay(bridge, fixture as unknown as Record<string, unknown>);

    const updatedFixture = JSON.parse(JSON.stringify(fixture));
    const newCost = 0.0099;
    (updatedFixture.properties.info as { cost: number }).cost = newCost;
    relay(bridge, updatedFixture);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows[0].cost).toBeCloseTo(newCost, 6);
  });
});

// ── c4: GET messages returns structured parts + back-compat shim ──────────────

describe('issue-686-c4: GET messages returns structured parts and back-compat shim for legacy rows', () => {
  let bridge: OpencodeStreamBridge;
  let messagesRepo: AgentSessionMessagesRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    const sessionsRepo = new AgentSessionsRepository();
    localSessionId = setupSession(sessionsRepo);
    messagesRepo = new AgentSessionMessagesRepository();
    bridge = new OpencodeStreamBridge();
  });

  afterEach(() => {
    sessionMap.clear();
  });

  it('structured message has parts as array, tokens as object, cost as number', () => {
    relay(bridge, fixture as unknown as Record<string, unknown>);
    const rows = messagesRepo.listBySessionStructured(localSessionId);
    const row = rows[0] as StructuredAgentSessionMessage;
    expect(Array.isArray(row.parts)).toBe(true);
    expect(typeof row.tokens).toBe('object');
    expect(row.tokens).not.toBeNull();
    expect(typeof row.cost).toBe('number');
  });

  it('legacy row with parts_json = NULL comes back as [{type:text, text:<rawText>}]', () => {
    // Insert a legacy row directly
    messagesRepo.append(localSessionId, 'output', 'legacy message text', 'legacy message text');
    const rows = messagesRepo.listBySessionStructured(localSessionId);
    const legacyRow = rows.find((r) => r.sdkMessageId === null || r.sdkMessageId === undefined);
    expect(legacyRow).toBeTruthy();
    const parts = legacyRow!.parts as Array<{ type: string; text: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toBe('legacy message text');
  });

  it('messages are ordered by creation time (oldest first)', () => {
    // Insert legacy row first, then structured via bridge
    messagesRepo.append(localSessionId, 'input', 'user prompt', 'user prompt');
    relay(bridge, fixture as unknown as Record<string, unknown>);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Legacy input row should come first (created before bridge emit)
    expect(rows[0].role).toBe('input');
  });
});

// ── c5: message.removed / message.part.removed ────────────────────────────────

describe('issue-686-c5: message.removed deletes row; message.part.removed removes only that part', () => {
  let bridge: OpencodeStreamBridge;
  let messagesRepo: AgentSessionMessagesRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    const sessionsRepo = new AgentSessionsRepository();
    localSessionId = setupSession(sessionsRepo);
    messagesRepo = new AgentSessionMessagesRepository();
    bridge = new OpencodeStreamBridge();
  });

  afterEach(() => {
    sessionMap.clear();
  });

  it('message.removed deletes the row for the given sdk_message_id', () => {
    relay(bridge, fixture as unknown as Record<string, unknown>);

    // Verify row exists
    let rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows.filter((r) => r.sdkMessageId === SDK_MSG_ID)).toHaveLength(1);

    // Emit message.removed
    relay(bridge, {
      type: 'message.removed',
      properties: {
        sessionID: SDK_ID,
        messageID: SDK_MSG_ID,
      },
    });

    rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows.filter((r) => r.sdkMessageId === SDK_MSG_ID)).toHaveLength(0);
  });

  it('message.part.removed removes only the specified part, leaving others intact', () => {
    relay(bridge, fixture as unknown as Record<string, unknown>);

    const fixtureInfo = fixture.properties as { parts: Array<{ id: string; type: string }> };
    const partToRemove = fixtureInfo.parts.find((p) => p.type === 'reasoning')!;
    const initialRows = messagesRepo.listBySessionStructured(localSessionId);
    const initialPartCount = (initialRows[0].parts as unknown[]).length;

    // Emit message.part.removed
    relay(bridge, {
      type: 'message.part.removed',
      properties: {
        sessionID: SDK_ID,
        messageID: SDK_MSG_ID,
        partID: partToRemove.id,
      },
    });

    const afterRows = messagesRepo.listBySessionStructured(localSessionId);
    const afterParts = afterRows[0].parts as Array<{ id: string }>;
    // One part removed
    expect(afterParts).toHaveLength(initialPartCount - 1);
    // The removed part ID is gone
    expect(afterParts.find((p) => p.id === partToRemove.id)).toBeUndefined();
    // Other parts still there
    const remainingIds = afterParts.map((p) => p.id);
    fixtureInfo.parts
      .filter((p) => p.id !== partToRemove.id)
      .forEach((p) => expect(remainingIds).toContain(p.id));
  });
});

// ── c6: bridge restart — persistence survives ─────────────────────────────────

describe('issue-686-c6: bridge restart — GET still returns full structured transcript from DB', () => {
  let messagesRepo: AgentSessionMessagesRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    const sessionsRepo = new AgentSessionsRepository();
    localSessionId = setupSession(sessionsRepo);
    messagesRepo = new AgentSessionMessagesRepository();
  });

  afterEach(() => {
    sessionMap.clear();
  });

  it('after bridge restart (new instance), structured transcript is fully readable from DB', () => {
    // First bridge instance processes the event.
    const bridge1 = new OpencodeStreamBridge();
    relay(bridge1, fixture as unknown as Record<string, unknown>);
    bridge1.dispose();

    // Simulate restart: create a completely new bridge instance.
    const bridge2 = new OpencodeStreamBridge();
    // bridge2 has no in-memory pendingText, no in-flight state.
    void bridge2; // not used — just verifies we can create a fresh instance

    // GET still returns full transcript from DB.
    const rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows.filter((r) => r.sdkMessageId === SDK_MSG_ID)).toHaveLength(1);
    const row = rows[0];
    expect(Array.isArray(row.parts)).toBe(true);
    const fixtureInfo = fixture.properties as { parts: unknown[] };
    expect(row.parts).toHaveLength(fixtureInfo.parts.length);
  });
});
