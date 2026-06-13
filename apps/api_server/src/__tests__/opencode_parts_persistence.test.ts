/**
 * OPC-M1-2 — Structured parts persistence (issue #686) [REPAIR]
 *
 * Root-cause of the false-green run: the previous implementation read
 * `event.properties.parts` on `message.updated`, but the real
 * UpdatedEventSchema = { sessionID, info } carries NO parts field.
 * Parts arrive exclusively via `message.part.updated` events.
 *
 * This suite drives a realistic v1.14.49 event SEQUENCE and verifies that
 * parts accumulate correctly from part events, not from message.updated.
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

// Import fixtures with real v1.14.49 shapes.
import msgUpdatedFixture from './fixtures/opencode_v1_14_49/message_updated_assistant.json';
import partUpdatedTextFixture from './fixtures/opencode_v1_14_49/message_part_updated_text.json';
import partUpdatedToolFixture from './fixtures/opencode_v1_14_49/message_part_updated_tool_completed.json';
import partUpdatedReasoningFixture from './fixtures/opencode_v1_14_49/message_part_updated_reasoning.json';
import partDeltaFixture from './fixtures/opencode_v1_14_49/message_part_delta.json';

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

const SDK_ID = (msgUpdatedFixture.properties as { sessionID: string }).sessionID; // 'ses_abc123'
const SDK_MSG_ID = (msgUpdatedFixture.properties as { info: { id: string } }).info.id; // 'msg_abc001'

let localSessionId: string;

function setupSession(repo: AgentSessionsRepository): string {
  const s = repo.insert({ agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: '/tmp', name: 'test' });
  sessionMap.set(s.id, SDK_ID);
  return s.id;
}

function relay(bridge: OpencodeStreamBridge, event: Record<string, unknown>): void {
  (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
}

/**
 * Drive the realistic v1.14.49 event sequence for one assistant turn:
 *   1. message.updated (info only, no parts)
 *   2. message.part.updated (text part — initial, empty text)
 *   3. message.part.delta × N (text streaming)
 *   4. message.part.updated (text part — final with full text)
 *   5. message.part.updated (tool part — completed state)
 *   6. message.part.updated (reasoning part)
 *   7. session.idle (turn boundary)
 *
 * This is the only path in which parts_json gets populated in production.
 */
function driveFullSequence(bridge: OpencodeStreamBridge): void {
  // 1. message.updated — info only (no parts)
  relay(bridge, msgUpdatedFixture as unknown as Record<string, unknown>);

  // 2. text part arrives (initial, may be empty or partial)
  relay(bridge, partUpdatedTextFixture as unknown as Record<string, unknown>);

  // 3. Several text deltas stream in
  relay(bridge, {
    type: 'message.part.delta',
    properties: {
      sessionID: SDK_ID,
      messageID: SDK_MSG_ID,
      partID: 'part_text_001',
      field: 'text',
      delta: ' More',
    },
  });
  relay(bridge, {
    type: 'message.part.delta',
    properties: {
      sessionID: SDK_ID,
      messageID: SDK_MSG_ID,
      partID: 'part_text_001',
      field: 'text',
      delta: ' text.',
    },
  });

  // 4. text part.updated with final merged text (supersedes deltas)
  const finalTextPart = JSON.parse(JSON.stringify(partUpdatedTextFixture));
  (finalTextPart.properties.part as { text: string }).text =
    "I've read the file. The function returns 42. More text.";
  relay(bridge, finalTextPart as unknown as Record<string, unknown>);

  // 5. tool part completed
  relay(bridge, partUpdatedToolFixture as unknown as Record<string, unknown>);

  // 6. reasoning part
  relay(bridge, partUpdatedReasoningFixture as unknown as Record<string, unknown>);

  // 7. session.idle — turn boundary
  relay(bridge, {
    type: 'session.idle',
    properties: { sessionID: SDK_ID },
  });
}

// ── fixture honesty guard ─────────────────────────────────────────────────────

describe('fixture honesty guard: message_updated_assistant.json has no parts key', () => {
  it('message_updated_assistant.json properties must NOT have a parts key', () => {
    // This locks the fixture to the real UpdatedEventSchema shape.
    // If this test fails, someone re-introduced the invented field.
    const props = msgUpdatedFixture.properties as Record<string, unknown>;
    expect('parts' in props).toBe(false);
  });

  it('message_updated_assistant.json info has no parts key', () => {
    const info = (msgUpdatedFixture.properties as { info: Record<string, unknown> }).info;
    expect('parts' in info).toBe(false);
  });
});

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

// ── c2: realistic event SEQUENCE persists parts from part events ──────────────

describe('issue-686-c2: realistic event sequence — parts persisted from part events, not message.updated', () => {
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

  it('message.updated alone (no part events) leaves parts_json NULL or empty — parts do NOT come from message.updated', () => {
    // Drive ONLY the message.updated event — no part events.
    relay(bridge, msgUpdatedFixture as unknown as Record<string, unknown>);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Without part events, parts must be empty (the back-compat shim gives [] or [{type:text,...}])
    // but the raw parts_json from the DB should be NULL (not populated from message.updated).
    // The key invariant: parts is NOT populated from message.updated info.
    expect(row.sdkMessageId).toBe(SDK_MSG_ID);
    // parts is the back-compat shim result — either [] or [{type:text, text:''}]
    // The critical check is that it is NOT the 5-element fixture parts array.
    expect(Array.isArray(row.parts)).toBe(true);
    expect((row.parts as unknown[]).length).toBeLessThan(3); // Cannot be 5 parts from fixture
  });

  it('full sequence: message.updated + part events → final parts_json has all parts with delta-merged text', () => {
    driveFullSequence(bridge);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.sdkMessageId).toBe(SDK_MSG_ID);
    expect(row.role).toBe('output');
    expect(Array.isArray(row.parts)).toBe(true);

    const parts = row.parts as Array<{ type: string; id: string; text?: string }>;

    // All three part types must be present.
    const types = parts.map((p) => p.type);
    expect(types).toContain('text');
    expect(types).toContain('tool');
    expect(types).toContain('reasoning');

    // Text part has the final merged text (from the final message.part.updated).
    const textPart = parts.find((p) => p.type === 'text');
    expect(textPart).toBeTruthy();
    expect(textPart!.text).toBe("I've read the file. The function returns 42. More text.");

    // tokens and cost from message.updated info are persisted.
    expect(typeof row.cost).toBe('number');
    expect(row.cost).toBeCloseTo(0.0042, 6);
    expect(row.tokens).toBeTruthy();
    expect(typeof row.tokens).toBe('object');
  });

  it('tokens/cost from message.updated info are persisted even after part events', () => {
    driveFullSequence(bridge);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    const row = rows[0];
    const expectedTokens = (msgUpdatedFixture.properties as { info: { tokens: unknown } }).info.tokens;
    expect(row.tokens).toEqual(expectedTokens);
  });

  it('message.updated does NOT overwrite parts_json already accumulated from part events', () => {
    // Drive part events first, then message.updated (order can vary in practice).
    relay(bridge, partUpdatedTextFixture as unknown as Record<string, unknown>);
    relay(bridge, partUpdatedToolFixture as unknown as Record<string, unknown>);

    // Now message.updated arrives — must NOT wipe the accumulated parts.
    relay(bridge, msgUpdatedFixture as unknown as Record<string, unknown>);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    const parts = rows[0].parts as Array<{ type: string }>;
    const types = parts.map((p) => p.type);
    expect(types).toContain('text');
    expect(types).toContain('tool');
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
    // Drive full sequence (creates and populates the row).
    driveFullSequence(bridge);

    // Second message.updated: same sdk_message_id, updated cost.
    const updatedFixture = JSON.parse(JSON.stringify(msgUpdatedFixture));
    (updatedFixture.properties.info as { cost: number }).cost = 0.0099;
    relay(bridge, updatedFixture);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    // Still exactly one row — no duplicate
    expect(rows.filter((r) => r.sdkMessageId === SDK_MSG_ID)).toHaveLength(1);
  });

  it('second message.updated updates cost without clobbering parts_json', () => {
    driveFullSequence(bridge);

    const updatedFixture = JSON.parse(JSON.stringify(msgUpdatedFixture));
    const newCost = 0.0099;
    (updatedFixture.properties.info as { cost: number }).cost = newCost;
    relay(bridge, updatedFixture);

    const rows = messagesRepo.listBySessionStructured(localSessionId);
    expect(rows[0].cost).toBeCloseTo(newCost, 6);

    // Parts are still there after the second message.updated.
    const parts = rows[0].parts as Array<{ type: string }>;
    const types = parts.map((p) => p.type);
    expect(types).toContain('text');
    expect(types).toContain('tool');
    expect(types).toContain('reasoning');
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
    driveFullSequence(bridge);
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
    driveFullSequence(bridge);

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
    driveFullSequence(bridge);

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
    driveFullSequence(bridge);

    const initialRows = messagesRepo.listBySessionStructured(localSessionId);
    const initialParts = initialRows[0].parts as Array<{ id: string; type: string }>;
    const initialPartCount = initialParts.length;
    const partToRemove = initialParts.find((p) => p.type === 'reasoning')!;
    expect(partToRemove).toBeTruthy();

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
    const afterParts = afterRows[0].parts as Array<{ id: string; type: string }>;
    // One part removed
    expect(afterParts).toHaveLength(initialPartCount - 1);
    // The removed part ID is gone
    expect(afterParts.find((p) => p.id === partToRemove.id)).toBeUndefined();
    // Tool and text parts still there
    const remainingTypes = afterParts.map((p) => p.type);
    expect(remainingTypes).toContain('text');
    expect(remainingTypes).toContain('tool');
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
    // First bridge instance processes the full event sequence.
    const bridge1 = new OpencodeStreamBridge();
    driveFullSequence(bridge1);
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

    // All three part types must survive bridge restart (persisted in DB).
    const parts = row.parts as Array<{ type: string }>;
    const types = parts.map((p) => p.type);
    expect(types).toContain('text');
    expect(types).toContain('tool');
    expect(types).toContain('reasoning');
  });
});
