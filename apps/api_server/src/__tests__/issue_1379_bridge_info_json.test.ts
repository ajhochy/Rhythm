import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

import msgUpdatedFixture from './fixtures/opencode_v1_14_49/message_updated_assistant.json';

/**
 * #1379 — the consolidated `/global/event` ingest must persist the engine's
 * verbatim `message.info` into `info_json`. Without this the mirror cannot
 * serve a transcript in the engine's shape, and every phone transcript read
 * keeps falling through to the live engine.
 *
 * Driven through the real bridge with a real v1.14.49 event fixture, so the
 * test breaks if the event shape or the handler drifts.
 */

const { sessionMap } = vi.hoisted(() => ({ sessionMap: new Map<string, string>() }));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastToSession: vi.fn(),
}));

// The bridge resolves sdk session id -> local session id through the engine's
// session map, so the mapping has to exist for the persist path to run.
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    respondPermission: vi.fn().mockResolvedValue({ data: true, error: undefined }),
  },
  opencodeSessionMap: sessionMap,
}));

let OpencodeStreamBridge: typeof import('../services/opencode_stream_bridge')['OpencodeStreamBridge'];
let db: Database.Database;
let messages: AgentSessionMessagesRepository;
let localSessionId: string;

const SDK_SESSION_ID = (msgUpdatedFixture.properties as { sessionID: string })
  .sessionID;
const SDK_MESSAGE_ID = (
  msgUpdatedFixture.properties as { info: { id: string } }
).info.id;

beforeEach(async () => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  sessionMap.clear();
  messages = new AgentSessionMessagesRepository();
  const sessions = new AgentSessionsRepository();
  const session = sessions.insert({
    agentKind: 'claude-code',
    cwd: '/private/tmp/rhythm-1379',
    name: 'Bridge mirror',
    taskId: null,
    taskTitle: null,
  });
  localSessionId = session.id;
  sessions.setSdkSessionId(session.id, SDK_SESSION_ID);
  sessionMap.set(session.id, SDK_SESSION_ID);
  ({ OpencodeStreamBridge } = await import(
    '../services/opencode_stream_bridge'
  ));
});

afterEach(() => {
  db.close();
  sessionMap.clear();
  vi.clearAllMocks();
});

describe('#1379 bridge persists info_json', () => {
  it('stores the engine message.info verbatim on message.updated', () => {
    const bridge = new OpencodeStreamBridge();
    (bridge as unknown as { _relayEvent: (event: unknown) => void })._relayEvent(
      msgUpdatedFixture as unknown as Record<string, unknown>,
    );

    const row = db
      .prepare(
        `SELECT info_json FROM agent_session_messages
          WHERE session_id = ? AND sdk_message_id = ?`,
      )
      .get(localSessionId, SDK_MESSAGE_ID) as { info_json: string | null };

    expect(row?.info_json, 'info_json must be persisted').toBeTruthy();
    expect(JSON.parse(row.info_json!)).toEqual(
      (msgUpdatedFixture.properties as { info: unknown }).info,
    );
  });

  it('makes the transcript mirror-servable end to end', () => {
    const bridge = new OpencodeStreamBridge();
    (bridge as unknown as { _relayEvent: (event: unknown) => void })._relayEvent(
      msgUpdatedFixture as unknown as Record<string, unknown>,
    );

    const page = messages.listEngineShapedPage(localSessionId, 20);

    expect(page.complete).toBe(true);
    expect(page.messages[0].info.id).toBe(SDK_MESSAGE_ID);
  });
});
