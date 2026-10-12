import type Database from 'better-sqlite3';

const LEGACY_COLUMNS = [
  'id', 'owner_user_id', 'project_id', 'goal', 'constraints_text', 'criteria_text',
  'checkpoint_json', 'state', 'closed_reason', 'revision', 'create_key', 'payload_hash',
  'created_at', 'updated_at',
] as const;

const STANDARD_INDEX = 'idx_agent_workstreams_scope';

function normalize(value: string): string {
  return value.replace(/["`\[\]]/g, '').replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase();
}

function legacySql(name: string): string {
  return `CREATE TABLE ${name} (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id INTEGER NOT NULL CHECK(typeof(owner_user_id) = 'integer' AND owner_user_id > 0),
    project_id TEXT NOT NULL CHECK(length(project_id) > 0),
    goal TEXT NOT NULL CHECK(length(goal) > 0),
    constraints_text TEXT NOT NULL CHECK(length(constraints_text) > 0),
    criteria_text TEXT NOT NULL CHECK(length(criteria_text) > 0),
    checkpoint_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('ready', 'paused')),
    closed_reason TEXT CHECK((state = 'ready' AND closed_reason IS NULL) OR (state = 'paused' AND closed_reason IS NOT NULL AND closed_reason = 'user_paused')),
    revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision >= 1 AND revision <= 9007199254740991),
    create_key TEXT NOT NULL CHECK(length(create_key) > 0),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(owner_user_id, project_id, create_key)
  )`;
}

function coordinatorSql(name: string): string {
  return `CREATE TABLE ${name} (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id INTEGER NOT NULL CHECK(typeof(owner_user_id) = 'integer' AND owner_user_id > 0),
    project_id TEXT NOT NULL CHECK(length(project_id) > 0),
    goal TEXT NOT NULL CHECK(length(goal) > 0),
    constraints_text TEXT NOT NULL CHECK(length(constraints_text) > 0),
    criteria_text TEXT NOT NULL CHECK(length(criteria_text) > 0),
    checkpoint_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('ready','queued','running','blocked','paused','cancelled','completed','unknown')),
    state_reason TEXT NULL,
    closed_reason TEXT CHECK(
      (state = 'paused' AND closed_reason = 'user_paused') OR
      (state = 'cancelled' AND closed_reason = 'user_cancelled') OR
      (state NOT IN ('paused','cancelled') AND closed_reason IS NULL)
    ),
    executor_epoch TEXT NULL,
    last_job_id TEXT NULL,
    revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision >= 1 AND revision <= 9007199254740991),
    create_key TEXT NOT NULL CHECK(length(create_key) > 0),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(owner_user_id, project_id, create_key)
  )`;
}

/**
 * R13 adds one opaque, server-owned consent record to the existing durable
 * workstream row.  NULL is intentionally the only default: it is the
 * default-off state and cannot be interpreted as a future authorization.
 */
function automationSql(name: string): string {
  return `CREATE TABLE ${name} (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id INTEGER NOT NULL CHECK(typeof(owner_user_id) = 'integer' AND owner_user_id > 0),
    project_id TEXT NOT NULL CHECK(length(project_id) > 0),
    goal TEXT NOT NULL CHECK(length(goal) > 0),
    constraints_text TEXT NOT NULL CHECK(length(constraints_text) > 0),
    criteria_text TEXT NOT NULL CHECK(length(criteria_text) > 0),
    checkpoint_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('ready','queued','running','blocked','paused','cancelled','completed','unknown')),
    state_reason TEXT NULL,
    closed_reason TEXT CHECK(
      (state = 'paused' AND closed_reason = 'user_paused') OR
      (state = 'cancelled' AND closed_reason = 'user_cancelled') OR
      (state NOT IN ('paused','cancelled') AND closed_reason IS NULL)
    ),
    executor_epoch TEXT NULL,
    last_job_id TEXT NULL,
    revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision >= 1 AND revision <= 9007199254740991),
    create_key TEXT NOT NULL CHECK(length(create_key) > 0),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    automation_json TEXT NULL,
    UNIQUE(owner_user_id, project_id, create_key)
  )`;
}

function inventory(db: Database.Database): { sql: string; columns: string[] } | null {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_workstreams'").get() as { sql: string } | undefined;
  if (!row) return null;
  return {
    sql: row.sql,
    columns: (db.prepare('PRAGMA table_info(agent_workstreams)').all() as Array<{ name: string }>).map((column) => column.name),
  };
}

function exactColumns(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((column, index) => column === expected[index]);
}

function standardIndexSql(): string {
  return 'CREATE INDEX idx_agent_workstreams_scope ON agent_workstreams(owner_user_id, project_id, created_at DESC, id DESC)';
}

function hasStandardIndex(db: Database.Database): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(STANDARD_INDEX) as { sql: string } | undefined;
  return !!row && normalize(row.sql) === normalize(standardIndexSql());
}

function createIndex(db: Database.Database): void {
  db.exec(standardIndexSql());
}

function isLegacy(db: Database.Database, table: { sql: string; columns: string[] }): boolean {
  return exactColumns(table.columns, LEGACY_COLUMNS) &&
    normalize(table.sql) === normalize(legacySql('agent_workstreams')) && hasStandardIndex(db);
}

function isCoordinator(db: Database.Database, table: { sql: string; columns: string[] }): boolean {
  const columns = [
    ...LEGACY_COLUMNS.slice(0, 8),
    'state_reason',
    ...LEGACY_COLUMNS.slice(8, 9),
    'executor_epoch', 'last_job_id',
    ...LEGACY_COLUMNS.slice(9),
  ];
  return exactColumns(table.columns, columns) &&
    normalize(table.sql) === normalize(coordinatorSql('agent_workstreams')) && hasStandardIndex(db);
}

function isAutomation(db: Database.Database, table: { sql: string; columns: string[] }): boolean {
  const columns = [
    ...LEGACY_COLUMNS.slice(0, 8),
    'state_reason',
    ...LEGACY_COLUMNS.slice(8, 9),
    'executor_epoch', 'last_job_id',
    ...LEGACY_COLUMNS.slice(9), 'automation_json',
  ];
  return exactColumns(table.columns, columns) &&
    normalize(table.sql) === normalize(automationSql('agent_workstreams')) && hasStandardIndex(db);
}

function incomingForeignKeys(db: Database.Database): string[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'agent_workstreams'").all() as Array<{ name: string }>;
  return tables.flatMap(({ name }) => {
    const quoted = name.replace(/"/g, '""');
    const refs = db.prepare(`PRAGMA foreign_key_list("${quoted}")`).all() as Array<{ table: string }>;
    return refs.some((ref) => ref.table === 'agent_workstreams') ? [name] : [];
  });
}

function migrateLegacyToAutomation(db: Database.Database): void {
  const incoming = incomingForeignKeys(db);
  if (incoming.length > 0) {
    throw new Error(`Unsupported agent_workstreams incoming foreign key from: ${incoming.join(', ')}`);
  }
  const customObjects = (db.prepare(`SELECT type, name, sql FROM sqlite_master
      WHERE tbl_name='agent_workstreams' AND type IN ('index','trigger') AND sql IS NOT NULL
      ORDER BY type, name`).all() as Array<{ name: string; sql: string }>)
    .filter((object) => object.name !== STANDARD_INDEX);
  db.exec(automationSql('agent_workstreams_r13_new'));
  db.exec(`INSERT INTO agent_workstreams_r13_new (
      id, owner_user_id, project_id, goal, constraints_text, criteria_text,
      checkpoint_json, state, state_reason, closed_reason, executor_epoch,
      last_job_id, revision, create_key, payload_hash, created_at, updated_at, automation_json
    ) SELECT id, owner_user_id, project_id, goal, constraints_text, criteria_text,
      checkpoint_json, state, NULL, closed_reason, NULL, NULL, revision, create_key,
      payload_hash, created_at, updated_at, NULL FROM agent_workstreams`);
  db.exec('DROP TABLE agent_workstreams');
  db.exec('ALTER TABLE agent_workstreams_r13_new RENAME TO agent_workstreams');
  createIndex(db);
  for (const object of customObjects) db.exec(object.sql);
}

/**
 * The already-supported coordinator schema needs only one nullable, opaque
 * default-off column.  SQLite can add it in place, preserving table identity,
 * incoming foreign keys, root-page continuity, custom triggers/indexes, and
 * every existing lifecycle/usage receipt.  The appended column order is also
 * the canonical fresh-install order above, so a replay is a no-op.
 */
function upgradeCoordinatorToAutomation(db: Database.Database): void {
  db.exec('ALTER TABLE agent_workstreams ADD COLUMN automation_json TEXT NULL');
}

/** SQLite-only, transactional, content-preserving coordinator lifecycle upgrade. */
export function installAgentWorkstreamsSchema(db: Database.Database): void {
  db.exec('SAVEPOINT install_agent_workstreams_schema');
  try {
    const table = inventory(db);
    if (!table) {
      db.exec(automationSql('agent_workstreams'));
      createIndex(db);
    } else if (isLegacy(db, table)) {
      migrateLegacyToAutomation(db);
    } else if (isCoordinator(db, table)) {
      upgradeCoordinatorToAutomation(db);
    } else if (isAutomation(db, table)) {
      // Canonical replay is deliberately a no-op.
    } else {
      throw new Error('Unsupported agent_workstreams schema; refusing writes');
    }
    db.exec('RELEASE SAVEPOINT install_agent_workstreams_schema');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT install_agent_workstreams_schema');
    db.exec('RELEASE SAVEPOINT install_agent_workstreams_schema');
    throw error;
  }
}
