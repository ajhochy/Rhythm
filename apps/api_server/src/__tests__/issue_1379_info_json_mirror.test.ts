import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

/**
 * #1379 — `agent_session_messages.info_json` stores the engine's verbatim
 * `message.info`, which is what lets a mirror-served transcript return the
 * engine's exact shape instead of a lossy reconstruction.
 */

let db: Database.Database;
let messages: AgentSessionMessagesRepository;
/** agent_session_messages.session_id is FK-constrained to a real session row. */
let localSessionId: string;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  messages = new AgentSessionMessagesRepository();
  localSessionId = new AgentSessionsRepository().insert({
    agentKind: 'claude-code',
    cwd: '/private/tmp/rhythm-1379',
    name: 'Mirror transcript',
    taskId: null,
    taskTitle: null,
  }).id;
});

afterEach(() => {
  db.close();
});

describe('#1379 info_json migration', () => {
  it('adds info_json to agent_session_messages', () => {
    const columns = (
      db.pragma('table_info(agent_session_messages)') as { name: string }[]
    ).map((column) => column.name);
    expect(columns).toContain('info_json');
  });

  it('is idempotent and preserves pre-existing rows', () => {
    db.prepare(
      `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text)
       VALUES (?, 'output', 'legacy', 'legacy')`,
    ).run(localSessionId);

    expect(() => runMigrations(db)).not.toThrow();

    const row = db
      .prepare(
        `SELECT info_json, raw_text FROM agent_session_messages
          WHERE session_id = ? AND sdk_message_id IS NULL`,
      )
      .get(localSessionId) as { info_json: string | null; raw_text: string };
    expect(row.raw_text).toBe('legacy');
    expect(row.info_json).toBeNull();
  });
});

describe('#1379 listEngineShapedPage', () => {
  function persist(sdkMessageId: string, info: Record<string, unknown> | null) {
    messages.upsertPart(localSessionId, sdkMessageId, {
      id: `prt-${sdkMessageId}`,
      type: 'text',
      text: sdkMessageId,
    });
    messages.upsertMessageInfo(
      localSessionId,
      sdkMessageId,
      'output',
      null,
      null,
      info ? JSON.stringify(info) : null,
    );
  }

  function info(id: string) {
    return { id, sessionID: 'ses_engine', role: 'assistant' };
  }

  it('returns {info, parts} oldest-first with the engine info verbatim', () => {
    persist('msg_1', info('msg_1'));
    persist('msg_2', info('msg_2'));

    const page = messages.listEngineShapedPage(localSessionId, 20);

    expect(page.complete).toBe(true);
    expect(page.hasMore).toBe(false);
    expect(page.messages.map((message) => message.info.id)).toEqual([
      'msg_1',
      'msg_2',
    ]);
    expect(page.messages[0].info).toEqual(info('msg_1'));
    expect(page.messages[0].parts).toEqual([
      { id: 'prt-msg_1', type: 'text', text: 'msg_1' },
    ]);
  });

  it('reports incomplete when any row in the window lacks info_json', () => {
    persist('msg_1', info('msg_1'));
    persist('msg_2', null);

    const page = messages.listEngineShapedPage(localSessionId, 20);

    expect(page.complete).toBe(false);
    expect(page.messages).toEqual([]);
  });

  it('reports incomplete for a session with no mirrored messages', () => {
    expect(messages.listEngineShapedPage('ses-empty', 20)).toMatchObject({
      complete: false,
      messages: [],
    });
  });

  it('pages backwards from an exclusive message-id cursor', () => {
    for (const id of ['msg_1', 'msg_2', 'msg_3', 'msg_4']) {
      persist(id, info(id));
    }

    const newest = messages.listEngineShapedPage(localSessionId, 2);
    expect(newest.messages.map((m) => m.info.id)).toEqual(['msg_3', 'msg_4']);
    expect(newest.hasMore).toBe(true);

    const older = messages.listEngineShapedPage(localSessionId, 2, 'msg_3');
    expect(older.messages.map((m) => m.info.id)).toEqual(['msg_1', 'msg_2']);
    expect(older.hasMore).toBe(false);
  });

  it('reports incomplete for a cursor the mirror does not hold', () => {
    persist('msg_1', info('msg_1'));

    expect(
      messages.listEngineShapedPage(localSessionId, 20, 'msg_nope'),
    ).toMatchObject({ complete: false, messages: [] });
  });

  it('never regresses a mirrored info to null on a later info-less update', () => {
    persist('msg_1', info('msg_1'));
    // A later message.updated that carries no info must not blank the column.
    messages.upsertMessageInfo(localSessionId, 'msg_1', 'output', null, null, null);

    const page = messages.listEngineShapedPage(localSessionId, 20);
    expect(page.complete).toBe(true);
    expect(page.messages[0].info.id).toBe('msg_1');
  });

  it('ignores legacy rows with no sdk_message_id', () => {
    messages.append(localSessionId, 'output', 'legacy text', 'legacy text');
    persist('msg_1', info('msg_1'));

    const page = messages.listEngineShapedPage(localSessionId, 20);

    expect(page.complete).toBe(true);
    expect(page.messages.map((message) => message.info.id)).toEqual(['msg_1']);
  });
});
