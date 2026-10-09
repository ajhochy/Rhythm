import type Database from 'better-sqlite3';

/**
 * R16's sole durable storage addition is a nullable JSON control on an
 * existing chat row. NULL means no conversation coordinator is installed and
 * therefore no planning/continuation authority exists. C2 registers this
 * SQLite-only additive helper in the existing migration flow; importing the
 * helper alone still has no side effect.
 */
export const COORDINATOR_CONVERSATION_COLUMN = 'coordinator_conversation_json';

type Column = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
};

function columnInventory(db: Database.Database): Column[] {
  const table = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_sessions'",
  ).get();
  if (!table) {
    throw new Error('agent_sessions is unavailable; refusing coordinator conversation schema install');
  }
  return db.prepare('PRAGMA table_info(agent_sessions)').all() as Column[];
}

function isCanonicalNullableText(column: Column): boolean {
  return column.type.trim().toUpperCase() === 'TEXT' &&
    column.notnull === 0 &&
    column.dflt_value === null;
}

/**
 * SQLite-only, additive, replay-safe installation. Any pre-existing
 * noncanonical column is rejected instead of reinterpreting data or changing
 * a default into authorization. Existing session rows and their transcript
 * columns are never copied, rebuilt, or inspected.
 */
export function installCoordinatorConversationSchema(db: Database.Database): void {
  db.exec('SAVEPOINT install_coordinator_conversation_schema');
  try {
    const columns = columnInventory(db);
    const matching = columns.filter((column) => column.name === COORDINATOR_CONVERSATION_COLUMN);
    if (matching.length === 0) {
      db.exec(`ALTER TABLE agent_sessions ADD COLUMN ${COORDINATOR_CONVERSATION_COLUMN} TEXT NULL`);
    } else if (matching.length === 1 && isCanonicalNullableText(matching[0])) {
      // Exact replay is deliberately a no-op.
    } else {
      throw new Error('Unsupported coordinator conversation column; refusing writes');
    }
    db.exec('RELEASE SAVEPOINT install_coordinator_conversation_schema');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT install_coordinator_conversation_schema');
    db.exec('RELEASE SAVEPOINT install_coordinator_conversation_schema');
    throw error;
  }
}
