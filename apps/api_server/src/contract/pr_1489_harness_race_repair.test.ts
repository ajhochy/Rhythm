import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BROAD_TABLES,
  INSTALL_TABLES,
  diffTableRows,
  snapshotBytes,
  snapshotTables,
  waitForBroadRowsToSettle,
} from '../__tests__/_s4_harness_rows';

describe('PR #1489 final harness race repair', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const { name, key } of [...BROAD_TABLES, ...INSTALL_TABLES]) {
      db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${key} TEXT PRIMARY KEY, value TEXT, unchanged TEXT)`);
    }
  });

  afterEach(() => db.close());

  it('snapshots broad and install surfaces in stable declared-key order', () => {
    db.prepare("INSERT INTO agent_configs (id, value) VALUES ('b', '2'), ('a', '1')").run();
    db.prepare("INSERT INTO agent_profile_projections (profile_id, value) VALUES ('z', '3'), ('c', '4')").run();

    expect(snapshotTables(db, BROAD_TABLES).agent_configs.map((row) => row.id)).toEqual(['a', 'b']);
    expect(snapshotTables(db, INSTALL_TABLES).agent_profile_projections.map((row) => row.profile_id))
      .toEqual(['c', 'z']);
  });

  it('reports only exact changed tables, rows, and fields', () => {
    db.prepare("INSERT INTO agent_sessions (id, value, unchanged) VALUES ('session-1', 'before', 'same')").run();
    const before = snapshotTables(db, BROAD_TABLES);
    db.prepare("UPDATE agent_sessions SET value = 'after' WHERE id = 'session-1'").run();
    const after = snapshotTables(db, BROAD_TABLES);

    expect(diffTableRows(before, after, BROAD_TABLES)).toEqual([{
      table: 'agent_sessions', row: 'session-1', status: 'changed',
      fields: { value: { before: 'before', after: 'after' } },
    }]);
  });

  it('waits through one late stream update and returns the stable broad snapshot', async () => {
    db.prepare("INSERT INTO agent_session_messages (id, value) VALUES ('message-1', 'pending')").run();
    let waits = 0;
    const settled = await waitForBroadRowsToSettle(db, {
      intervalMs: 0,
      timeoutMs: 100,
      sleep: async () => {
        if (waits++ === 0) db.prepare("UPDATE agent_session_messages SET value = 'settled' WHERE id = 'message-1'").run();
      },
    });

    expect(settled.agent_session_messages).toEqual([{ id: 'message-1', value: 'settled', unchanged: null }]);
  });

  it('bounds non-settlement errors to the exact latest row-field diff', async () => {
    db.prepare("INSERT INTO agent_sessions (id, value, unchanged) VALUES ('session-1', '0', 'do-not-dump')").run();
    let update = 0;
    await expect(waitForBroadRowsToSettle(db, {
      intervalMs: 1,
      timeoutMs: 3,
      sleep: async () => {
        db.prepare('UPDATE agent_sessions SET value = ? WHERE id = ?').run(String(++update), 'session-1');
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
    })).rejects.toThrow(/agent_sessions.*session-1.*value(?!.*do-not-dump)/);
  });

  it('compares declared install snapshots byte-for-byte', () => {
    const before = snapshotTables(db, INSTALL_TABLES);
    expect(snapshotBytes(snapshotTables(db, INSTALL_TABLES))).toBe(snapshotBytes(before));
  });
});
