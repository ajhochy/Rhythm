/**
 * Issue #751 — Agent session stuck on "Starting" when engine events arrive
 * for a session whose SDK id is NOT in the in-memory `opencodeSessionMap`.
 *
 * Root cause: OpencodeStreamBridge._relayEvent resolves the local session ONLY
 * by reverse-looking-up the event's SDK session id in the ephemeral
 * `opencodeSessionMap` (opencode_stream_bridge.ts ~278-286). That map is wiped
 * on every api_server restart and is not populated on every session-creation
 * path, so when it misses, EVERY event for the session is dropped:
 *   - session.status / session.idle  → status never leaves the 'starting' default
 *   - message.part.updated           → parts never persist (0 messages)
 *   - session.created (child)        → only fires when its OWN sdk id later maps
 *
 * The durable source of truth is the `agent_sessions.sdk_session_id` column,
 * which IS populated at creation time. These tests drive the REAL _relayEvent
 * with a parent row that has `sdk_session_id` set but is absent from the map,
 * and assert the PERSISTED status + messages (not just that a mock was called).
 *
 * RED proof on unfixed code: status stays 'starting', listBySession() is empty,
 * and the map is never repopulated.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

// ---------------------------------------------------------------------------
// Shared mocks — the bridge imports broadcast/broadcastSessionUpdated from
// ws_gateway, opencodeClient/opencodeSessionMap from opencode_engine, and
// queueSkillExtraction from skill_extractor. We mock all three so the real
// _relayEvent runs against an in-memory DB with no network/engine side effects.
// ---------------------------------------------------------------------------

const { broadcastSpy, broadcastSessionUpdatedSpy, sessionMap, queueSkillExtractionSpy } =
  vi.hoisted(() => ({
    broadcastSpy: vi.fn(),
    broadcastSessionUpdatedSpy: vi.fn(),
    sessionMap: new Map<string, string>(),
    queueSkillExtractionSpy: vi.fn(),
  }));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (s: unknown) => broadcastSessionUpdatedSpy(s),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    respondPermission: vi.fn(),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/skill_extractor', () => ({
  queueSkillExtraction: (id: string) => queueSkillExtractionSpy(id),
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return db;
}

/** Minimal opencode Event shape — `_relayEvent` only reads `type`/`properties`. */
function relay(bridge: OpencodeStreamBridge, event: unknown): void {
  (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent(event);
}

const PARENT_SDK = 'ses_parent_751_abcdef';
const CHILD_SDK = 'ses_child_751_ghijkl';

describe('issue-751: bridge resolves events via DB sdk_session_id when the in-memory map misses', () => {
  let sessionsRepo: AgentSessionsRepository;
  let messagesRepo: AgentSessionMessagesRepository;
  let bridge: OpencodeStreamBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
    messagesRepo = new AgentSessionMessagesRepository();
    bridge = new OpencodeStreamBridge();
  });

  /** Insert a parent row with a persisted SDK id but DO NOT register the map. */
  function insertOrphanedParent() {
    const parent = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/Users/test',
      name: 'Secretary',
    });
    sessionsRepo.setSdkSessionId(parent.id, PARENT_SDK);
    expect(sessionsRepo.findById(parent.id)!.status).toBe('starting'); // insert default
    expect(sessionMap.has(parent.id)).toBe(false); // the map-miss precondition
    return parent;
  }

  it('751-status: a session.status(busy) event transitions the row off "starting" via the DB fallback', () => {
    const parent = insertOrphanedParent();

    relay(bridge, {
      type: 'session.status',
      properties: { sessionID: PARENT_SDK, status: { type: 'busy' } },
    });

    expect(sessionsRepo.findById(parent.id)!.status).toBe('working');
  });

  it('751-idle: a session.idle event marks the row idle (badge leaves "Starting")', () => {
    const parent = insertOrphanedParent();
    // Accumulate some assistant text so idle has a turn to finalize.
    relay(bridge, {
      type: 'message.part.delta',
      properties: { messageID: 'm1', partID: 'p1', field: 'text', delta: 'hello' },
    });
    relay(bridge, { type: 'session.idle', properties: { sessionID: PARENT_SDK } });

    expect(sessionsRepo.findById(parent.id)!.status).toBe('idle');
  });

  it('751-messages: message.part.updated persists a structured message row (not 0 messages)', () => {
    const parent = insertOrphanedParent();

    relay(bridge, {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          messageID: 'msg-1',
          sessionID: PARENT_SDK,
          type: 'text',
          text: 'I summarized the project.',
        },
      },
    });

    const msgs = messagesRepo.listBySessionStructured(parent.id);
    expect(msgs.length).toBe(1);
    expect(JSON.stringify(msgs[0])).toContain('I summarized the project.');
  });

  it('751-map-repopulated: the fallback caches the resolution back into opencodeSessionMap', () => {
    const parent = insertOrphanedParent();

    relay(bridge, {
      type: 'session.status',
      properties: { sessionID: PARENT_SDK, status: { type: 'busy' } },
    });

    // Subsequent events take the fast in-memory path.
    expect(sessionMap.get(parent.id)).toBe(PARENT_SDK);
  });

  it('751-child: session.created for a delegated subagent upserts a local child row linked to the parent', () => {
    const parent = insertOrphanedParent();

    relay(bridge, {
      type: 'session.created',
      properties: {
        sessionID: CHILD_SDK,
        info: {
          id: CHILD_SDK,
          parentID: PARENT_SDK,
          title: 'List dir and summarize project (@general subagent)',
          directory: '/Users/test',
        },
      },
    });

    const child = sessionsRepo
      .listAll(50)
      .find((s) => s.sdkSessionId === CHILD_SDK);
    expect(child, 'child session row should be created').toBeTruthy();
    expect(child!.parentSessionId).toBe(parent.id);
  });

  it('751-control: events still resolve when the session IS in the map (no regression)', () => {
    const parent = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/Users/test',
      name: 'Mapped',
    });
    sessionsRepo.setSdkSessionId(parent.id, PARENT_SDK);
    sessionMap.set(parent.id, PARENT_SDK); // present in the map

    relay(bridge, {
      type: 'session.status',
      properties: { sessionID: PARENT_SDK, status: { type: 'busy' } },
    });

    expect(sessionsRepo.findById(parent.id)!.status).toBe('working');
  });
});
