import type Database from 'better-sqlite3';

/**
 * R16's sole durable storage addition is a nullable JSON control on an
 * existing chat row. NULL means no conversation coordinator is installed and
 * therefore no planning/continuation authority exists. C2 registers this
 * SQLite-only additive helper in the existing migration flow; importing the
 * helper alone still has no side effect.
 */
export const COORDINATOR_CONVERSATION_COLUMN = 'coordinator_conversation_json';

/** Portable additive DDL: the journal owns admission/correlation, never async lifecycle. */
export const COORDINATOR_COMMAND_JOURNAL_SQL = `
  CREATE TABLE IF NOT EXISTS coordinator_conversation_commands (
    root_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    command_key TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('add_goal','status','foreground','delegate_goal')),
    intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
    replay_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    journal_ordinal INTEGER NOT NULL,
    goal_id TEXT,
    goal_revision INTEGER,
    approval_id TEXT,
    approval_digest TEXT,
    role TEXT CHECK(role IS NULL OR role IN ('manager','worker')),
    parent_command_key TEXT,
    attempt_ordinal INTEGER CHECK(attempt_ordinal IS NULL OR attempt_ordinal=1),
    target_agent_config_id TEXT,
    policy_fingerprint TEXT,
    allocation_intent_at TEXT,
    child_session_id TEXT,
    child_sdk_session_id TEXT,
    delegation_id TEXT,
    initial_dispatch_id TEXT,
    initial_sdk_user_message_id TEXT,
    callback_dispatch_id TEXT,
    callback_sdk_user_message_id TEXT,
    engine_identity TEXT,
    canonical_cwd TEXT,
    acceptance TEXT CHECK(acceptance IS NULL OR acceptance IN ('pending','accepted','rejected','unknown')),
    hold_reason TEXT CHECK(hold_reason IS NULL OR length(hold_reason)<=256),
    coding_grant_json TEXT NULL,
    PRIMARY KEY(root_session_id,command_key),
    FOREIGN KEY(root_session_id,parent_command_key)
      REFERENCES coordinator_conversation_commands(root_session_id,command_key),
    CHECK(role<>'worker' OR (parent_command_key IS NOT NULL AND goal_id IS NOT NULL AND attempt_ordinal=1)),
    CHECK(callback_dispatch_id IS NULL OR
      (initial_dispatch_id IS NOT NULL AND callback_dispatch_id<>initial_dispatch_id)),
    CHECK(callback_sdk_user_message_id IS NULL OR
      (initial_sdk_user_message_id IS NOT NULL AND callback_sdk_user_message_id<>initial_sdk_user_message_id))
  );
  CREATE INDEX IF NOT EXISTS idx_coordinator_commands_page
    ON coordinator_conversation_commands(root_session_id,journal_ordinal);
  CREATE INDEX IF NOT EXISTS idx_coordinator_commands_kind
    ON coordinator_conversation_commands(root_session_id,kind,command_key);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_coordinator_commands_delegation
    ON coordinator_conversation_commands(root_session_id,delegation_id) WHERE delegation_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_coordinator_commands_slot
    ON coordinator_conversation_commands(root_session_id,parent_command_key,role,attempt_ordinal)
    WHERE role='worker';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_coordinator_commands_manager_slot
    ON coordinator_conversation_commands(root_session_id,goal_id) WHERE role='manager';
`;

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
    for (const name of ['coordinator_command_storage', 'coordinator_command_legacy_hash', 'coordinator_command_hold']) {
      const column = columns.find((candidate) => candidate.name === name);
      if (!column) {
        db.exec(`ALTER TABLE agent_sessions ADD COLUMN ${name} TEXT NULL`);
      } else if (!isCanonicalNullableText(column)) {
        throw new Error('Unsupported coordinator journal marker; refusing writes');
      }
    }
    db.exec(COORDINATOR_COMMAND_JOURNAL_SQL);
    const grantColumn = (db.prepare('PRAGMA table_info(coordinator_conversation_commands)').all() as Column[])
      .find(column => column.name === 'coding_grant_json');
    if (!grantColumn) db.exec('ALTER TABLE coordinator_conversation_commands ADD COLUMN coding_grant_json TEXT NULL');
    else if (!isCanonicalNullableText(grantColumn)) throw new Error('Unsupported coding grant binding column');
    // Prompt anchors are write-once, even for unknown acceptance. R3 owns exposure.
    db.exec(`CREATE TRIGGER IF NOT EXISTS coordinator_commands_immutable
      BEFORE UPDATE ON coordinator_conversation_commands
      WHEN OLD.root_session_id<>NEW.root_session_id OR OLD.command_key<>NEW.command_key
        OR OLD.owner_user_id<>NEW.owner_user_id OR OLD.project_id<>NEW.project_id
        OR OLD.kind<>NEW.kind OR OLD.intent_hash<>NEW.intent_hash OR OLD.created_at<>NEW.created_at
        OR OLD.journal_ordinal<>NEW.journal_ordinal
        OR (OLD.goal_id IS NOT NULL AND OLD.goal_id IS NOT NEW.goal_id)
        OR (OLD.goal_revision IS NOT NULL AND OLD.goal_revision IS NOT NEW.goal_revision)
        OR (OLD.attempt_ordinal IS NOT NULL AND OLD.attempt_ordinal IS NOT NEW.attempt_ordinal)
        OR (OLD.allocation_intent_at IS NOT NULL AND OLD.allocation_intent_at IS NOT NEW.allocation_intent_at)
        OR (OLD.role IS NOT NULL AND OLD.role IS NOT NEW.role)
        OR (OLD.parent_command_key IS NOT NULL AND OLD.parent_command_key IS NOT NEW.parent_command_key)
        OR (OLD.approval_id IS NOT NULL AND OLD.approval_id IS NOT NEW.approval_id)
        OR (OLD.approval_digest IS NOT NULL AND OLD.approval_digest IS NOT NEW.approval_digest)
        OR (OLD.target_agent_config_id IS NOT NULL AND OLD.target_agent_config_id IS NOT NEW.target_agent_config_id)
        OR (OLD.policy_fingerprint IS NOT NULL AND OLD.policy_fingerprint IS NOT NEW.policy_fingerprint)
        OR (OLD.child_session_id IS NOT NULL AND OLD.child_session_id IS NOT NEW.child_session_id)
        OR (OLD.child_sdk_session_id IS NOT NULL AND OLD.child_sdk_session_id IS NOT NEW.child_sdk_session_id)
        OR (OLD.delegation_id IS NOT NULL AND OLD.delegation_id IS NOT NEW.delegation_id)
        OR (OLD.canonical_cwd IS NOT NULL AND OLD.canonical_cwd IS NOT NEW.canonical_cwd)
        OR (OLD.engine_identity IS NOT NULL AND OLD.engine_identity IS NOT NEW.engine_identity)
        OR (OLD.initial_dispatch_id IS NOT NULL AND OLD.initial_dispatch_id IS NOT NEW.initial_dispatch_id)
        OR (OLD.initial_sdk_user_message_id IS NOT NULL AND OLD.initial_sdk_user_message_id IS NOT NEW.initial_sdk_user_message_id)
        OR (OLD.callback_dispatch_id IS NOT NULL AND OLD.callback_dispatch_id IS NOT NEW.callback_dispatch_id)
        OR (OLD.callback_sdk_user_message_id IS NOT NULL AND OLD.callback_sdk_user_message_id IS NOT NEW.callback_sdk_user_message_id)
      BEGIN SELECT RAISE(ABORT, 'coordinator journal immutable binding'); END;`);
    db.exec('RELEASE SAVEPOINT install_coordinator_conversation_schema');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT install_coordinator_conversation_schema');
    db.exec('RELEASE SAVEPOINT install_coordinator_conversation_schema');
    throw error;
  }
}
