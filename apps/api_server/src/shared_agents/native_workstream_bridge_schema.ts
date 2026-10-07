import type Database from 'better-sqlite3';

export interface NativeWorkstreamSchemaMigrationTestHooks {
  afterLegacyCopy?: (db: Database.Database) => void;
}

const LEGACY_COLUMNS = [
  'id', 'direction', 'idempotency_key', 'request_sha256', 'local_user_id', 'hermes_profile',
  'parent_runtime', 'parent_runtime_instance', 'parent_session_id', 'parent_agent_id',
  'parent_projection_id', 'target_agent_id', 'target_revision', 'target_runtime',
  'child_runtime_instance', 'child_session_id', 'depth', 'chain_id', 'prompt', 'context', 'cwd',
  'state', 'state_reason', 'cancel_requested_at', 'result_text', 'result_truncated', 'progress_json',
  'lease_token_sha256', 'lease_expires_at', 'delivery_state', 'delivered_at', 'created_at',
  'updated_at', 'terminal_at',
] as const;

const NATIVE_COLUMNS = [
  'workstream_id', 'workstream_project_id', 'workstream_revision', 'host_epoch',
  'native_queue_deadline_at',
] as const;

/**
 * Coordinator-only data stays on the established native ledger.  These are
 * additive SQLite columns rather than a second attempt/event store.  Legacy
 * bridge rows retain NULLs and their existing triggers/indexes unchanged.
 */
const COORDINATOR_COLUMNS = [
  'native_execution_kind', 'native_metadata_json', 'native_dispatch_id',
  'native_sdk_user_message_id', 'native_usage_json', 'native_result_json',
  'native_application_json', 'native_started_at', 'native_progress_at',
  'native_child_session_id', 'native_child_sdk_session_id',
] as const;

const STANDARD_OBJECTS = new Set([
  'idx_agent_bridge_jobs_claim',
  'idx_agent_bridge_jobs_parent',
  'ux_agent_bridge_jobs_legacy_command',
  'ux_agent_bridge_jobs_native_command',
  'agent_bridge_jobs_terminal_immutable',
  'agent_bridge_jobs_unknown_exit',
]);

interface SchemaObjectDefinition {
  type: 'index' | 'trigger';
  name: string;
  sql: string;
}

const LEGACY_STANDARD_OBJECTS: SchemaObjectDefinition[] = [
  {
    type: 'index',
    name: 'idx_agent_bridge_jobs_claim',
    sql: `CREATE INDEX idx_agent_bridge_jobs_claim
      ON agent_bridge_jobs(local_user_id, hermes_profile, state, created_at)`,
  },
  {
    type: 'index',
    name: 'idx_agent_bridge_jobs_parent',
    sql: `CREATE INDEX idx_agent_bridge_jobs_parent
      ON agent_bridge_jobs(parent_runtime, parent_session_id, delivery_state)`,
  },
  {
    type: 'trigger',
    name: 'agent_bridge_jobs_terminal_immutable',
    sql: `CREATE TRIGGER agent_bridge_jobs_terminal_immutable BEFORE UPDATE OF state ON agent_bridge_jobs
      WHEN OLD.state IN ('succeeded','failed','cancelled') AND NEW.state <> OLD.state
      BEGIN SELECT RAISE(ABORT, 'agent_bridge_job_terminal'); END`,
  },
  {
    type: 'trigger',
    name: 'agent_bridge_jobs_unknown_exit',
    sql: `CREATE TRIGGER agent_bridge_jobs_unknown_exit BEFORE UPDATE OF state ON agent_bridge_jobs
      WHEN OLD.state = 'unknown' AND NEW.state NOT IN ('unknown','succeeded','failed')
      BEGIN SELECT RAISE(ABORT, 'agent_bridge_job_unknown'); END`,
  },
];

const NATIVE_STANDARD_OBJECTS: SchemaObjectDefinition[] = [
  ...LEGACY_STANDARD_OBJECTS,
  {
    type: 'index',
    name: 'ux_agent_bridge_jobs_legacy_command',
    sql: `CREATE UNIQUE INDEX ux_agent_bridge_jobs_legacy_command
      ON agent_bridge_jobs(local_user_id, parent_runtime, parent_session_id, idempotency_key)
      WHERE direction IN ('rhythm_to_hermes','hermes_to_rhythm')`,
  },
  {
    type: 'index',
    name: 'ux_agent_bridge_jobs_native_command',
    sql: `CREATE UNIQUE INDEX ux_agent_bridge_jobs_native_command
      ON agent_bridge_jobs(local_user_id, workstream_id, idempotency_key)
      WHERE direction = 'rhythm_to_native'`,
  },
];

function normalizeSql(value: string): string {
  const literals: string[] = [];
  let outsideLiterals = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "'") {
      outsideLiterals += value[index];
      continue;
    }
    let literal = "'";
    for (index += 1; index < value.length; index += 1) {
      literal += value[index];
      if (value[index] !== "'") continue;
      if (value[index + 1] === "'") {
        literal += value[index + 1];
        index += 1;
        continue;
      }
      break;
    }
    outsideLiterals += `\0${literals.length}\0`;
    literals.push(literal);
  }
  const normalized = outsideLiterals.replace(/["`\[\]]/g, '')
    .replace(/\bif\s+not\s+exists\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;$/, '')
    .trim()
    .toLowerCase();
  return normalized.replace(/\0(\d+)\0/g, (_match, index: string) => literals[Number(index)]!);
}

function legacyTableSql(name: string): string {
  return `CREATE TABLE ${name} (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('rhythm_to_hermes','hermes_to_rhythm')),
    idempotency_key TEXT NOT NULL, request_sha256 TEXT NOT NULL,
    local_user_id INTEGER NOT NULL, hermes_profile TEXT NOT NULL,
    parent_runtime TEXT NOT NULL CHECK (parent_runtime IN ('opencode','hermes')),
    parent_runtime_instance TEXT NOT NULL, parent_session_id TEXT NOT NULL,
    parent_agent_id TEXT NOT NULL, parent_projection_id TEXT NULL,
    target_agent_id TEXT NOT NULL, target_revision INTEGER NOT NULL,
    target_runtime TEXT NOT NULL CHECK (target_runtime IN ('opencode','hermes')),
    child_runtime_instance TEXT NULL, child_session_id TEXT NULL,
    depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 2), chain_id TEXT NOT NULL,
    prompt TEXT NOT NULL, context TEXT NULL, cwd TEXT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','claimed','running','succeeded','failed','cancelled','unknown')),
    state_reason TEXT NULL, cancel_requested_at TEXT NULL,
    result_text TEXT NULL, result_truncated INTEGER NOT NULL DEFAULT 0, progress_json TEXT NULL,
    lease_token_sha256 TEXT NULL, lease_expires_at TEXT NULL,
    delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','waking','delivered')),
    delivered_at TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_at TEXT NULL,
    UNIQUE (local_user_id, parent_runtime, parent_session_id, idempotency_key)
  )`;
}

function tableSql(name: string): string {
  return `CREATE TABLE ${name} (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('rhythm_to_hermes','hermes_to_rhythm','rhythm_to_native')),
    idempotency_key TEXT NOT NULL, request_sha256 TEXT NOT NULL,
    local_user_id INTEGER NOT NULL, hermes_profile TEXT NULL,
    parent_runtime TEXT NOT NULL CHECK (parent_runtime IN ('opencode','hermes')),
    parent_runtime_instance TEXT NOT NULL, parent_session_id TEXT NOT NULL,
    parent_agent_id TEXT NOT NULL, parent_projection_id TEXT NULL,
    target_agent_id TEXT NOT NULL, target_revision INTEGER NOT NULL,
    target_runtime TEXT NOT NULL CHECK (target_runtime IN ('opencode','hermes')),
    child_runtime_instance TEXT NULL, child_session_id TEXT NULL,
    depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 2), chain_id TEXT NOT NULL,
    prompt TEXT NOT NULL, context TEXT NULL, cwd TEXT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','claimed','running','succeeded','failed','cancelled','unknown')),
    state_reason TEXT NULL, cancel_requested_at TEXT NULL,
    result_text TEXT NULL, result_truncated INTEGER NOT NULL DEFAULT 0, progress_json TEXT NULL,
    lease_token_sha256 TEXT NULL, lease_expires_at TEXT NULL,
    delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','waking','delivered')),
    delivered_at TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_at TEXT NULL,
    workstream_id TEXT NULL, workstream_project_id TEXT NULL, workstream_revision INTEGER NULL,
    host_epoch TEXT NULL, native_queue_deadline_at TEXT NULL,
    CHECK (
      (direction IN ('rhythm_to_hermes','hermes_to_rhythm')
        AND hermes_profile IS NOT NULL
        AND workstream_id IS NULL AND workstream_project_id IS NULL
        AND workstream_revision IS NULL AND host_epoch IS NULL
        AND native_queue_deadline_at IS NULL)
      OR
      (direction = 'rhythm_to_native'
        AND hermes_profile IS NULL
        AND parent_runtime = 'opencode' AND target_runtime = 'opencode'
        AND local_user_id > 0
        AND length(idempotency_key) > 0 AND length(request_sha256) = 64
        AND workstream_id IS NOT NULL AND length(workstream_id) > 0
        AND workstream_project_id IS NOT NULL AND length(workstream_project_id) > 0
        AND workstream_revision IS NOT NULL AND workstream_revision >= 1
        AND host_epoch IS NOT NULL AND length(host_epoch) > 0
        AND length(parent_runtime_instance) > 0 AND length(parent_session_id) > 0
        AND length(parent_agent_id) > 0 AND length(target_agent_id) > 0 AND target_revision >= 1
        AND depth = 1 AND prompt = '' AND context IS NULL AND cwd IS NULL
        AND child_runtime_instance IS NULL AND child_session_id IS NULL
        AND result_text IS NULL AND result_truncated = 0 AND progress_json IS NULL
        AND lease_token_sha256 IS NULL AND lease_expires_at IS NULL
        AND (state_reason IS NULL OR state_reason IN (
          'native_status_unknown','native_queue_deadline_exceeded','cancelled_after_unknown'
        )))
    )
  )`;
}

function createStandardObjects(db: Database.Database): void {
  for (const object of NATIVE_STANDARD_OBJECTS) db.exec(object.sql);
}

function readTable(db: Database.Database): { sql: string; columns: string[] } | null {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_bridge_jobs'",
  ).get() as { sql: string } | undefined;
  if (!row) return null;
  const columns = (db.prepare('PRAGMA table_info(agent_bridge_jobs)').all() as Array<{ name: string }>)
    .map((column) => column.name);
  return { sql: row.sql, columns };
}

function isExactColumnInventory(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function hasExpectedSchemaObjects(
  db: Database.Database,
  expected: SchemaObjectDefinition[],
): boolean {
  const rows = db.prepare(`SELECT type, name, sql FROM sqlite_master
    WHERE tbl_name='agent_bridge_jobs' AND type IN ('index','trigger') AND sql IS NOT NULL`)
    .all() as Array<{ type: string; name: string; sql: string }>;
  const expectedByName = new Map(expected.map((object) => [object.name, object]));
  for (const object of expected) {
    const actual = rows.find((row) => row.name === object.name);
    if (!actual || actual.type !== object.type
        || normalizeSql(actual.sql) !== normalizeSql(object.sql)) return false;
  }
  return rows.every((row) => !STANDARD_OBJECTS.has(row.name) || expectedByName.has(row.name));
}

function isSupportedLegacy(
  db: Database.Database,
  table: { sql: string; columns: string[] },
): boolean {
  if (!isExactColumnInventory(table.columns, LEGACY_COLUMNS)) return false;
  return normalizeSql(table.sql) === normalizeSql(legacyTableSql('agent_bridge_jobs'))
    && hasExpectedSchemaObjects(db, LEGACY_STANDARD_OBJECTS);
}

function isSupportedNativeBase(
  db: Database.Database,
  table: { sql: string; columns: string[] },
): boolean {
  if (!isExactColumnInventory(table.columns, [...LEGACY_COLUMNS, ...NATIVE_COLUMNS])) return false;
  return normalizeSql(table.sql) === normalizeSql(tableSql('agent_bridge_jobs'))
    && hasExpectedSchemaObjects(db, NATIVE_STANDARD_OBJECTS);
}

function isSupportedNativeWithCoordinator(
  db: Database.Database,
  table: { sql: string; columns: string[] },
): boolean {
  if (!isExactColumnInventory(table.columns, [...LEGACY_COLUMNS, ...NATIVE_COLUMNS, ...COORDINATOR_COLUMNS])) return false;
  // SQLite appends ALTER TABLE columns to sqlite_master's CREATE statement.
  // Verify the frozen native base and every exact added declaration rather
  // than accepting a merely similarly named hand-edited table.
  const sql = normalizeSql(table.sql);
  const additions = [
    'native_execution_kind text null', 'native_metadata_json text null',
    'native_dispatch_id text null', 'native_sdk_user_message_id text null',
    'native_usage_json text null', 'native_result_json text null',
    'native_application_json text null', 'native_started_at text null',
    'native_progress_at text null', 'native_child_session_id text null',
    'native_child_sdk_session_id text null',
  ];
  return ['direction text not null check', 'native_queue_deadline_at text null', ...additions]
    .every((fragment) => sql.includes(fragment)) &&
    hasExpectedSchemaObjects(db, NATIVE_STANDARD_OBJECTS);
}

function installCoordinatorColumns(db: Database.Database): void {
  const names = (db.prepare('PRAGMA table_info(agent_bridge_jobs)').all() as Array<{ name: string }>)
    .map((column) => column.name);
  const declarations: Record<typeof COORDINATOR_COLUMNS[number], string> = {
    native_execution_kind: 'TEXT NULL',
    native_metadata_json: 'TEXT NULL',
    native_dispatch_id: 'TEXT NULL',
    native_sdk_user_message_id: 'TEXT NULL',
    native_usage_json: 'TEXT NULL',
    native_result_json: 'TEXT NULL',
    native_application_json: 'TEXT NULL',
    native_started_at: 'TEXT NULL',
    native_progress_at: 'TEXT NULL',
    native_child_session_id: 'TEXT NULL',
    native_child_sdk_session_id: 'TEXT NULL',
  };
  for (const column of COORDINATOR_COLUMNS) {
    if (!names.includes(column)) db.exec(`ALTER TABLE agent_bridge_jobs ADD COLUMN ${column} ${declarations[column]}`);
  }
}

function incomingForeignKeyTables(db: Database.Database): string[] {
  const tables = db.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'agent_bridge_jobs'
    ORDER BY name`).all() as Array<{ name: string }>;
  const incoming: string[] = [];
  for (const table of tables) {
    const quoted = table.name.replace(/"/g, '""');
    const references = db.prepare(`PRAGMA foreign_key_list("${quoted}")`).all() as Array<{
      table: string;
    }>;
    if (references.some((reference) => reference.table.toLowerCase() === 'agent_bridge_jobs')) {
      incoming.push(table.name);
    }
  }
  return incoming;
}

function migrateLegacy(
  db: Database.Database,
  hooks: NativeWorkstreamSchemaMigrationTestHooks,
): void {
  const incoming = incomingForeignKeyTables(db);
  if (incoming.length > 0) {
    throw new Error(`Unsupported agent_bridge_jobs incoming foreign key from: ${incoming.join(', ')}`);
  }
  const customObjects = (db.prepare(`SELECT type, name, sql FROM sqlite_master
    WHERE tbl_name='agent_bridge_jobs' AND type IN ('index','trigger') AND sql IS NOT NULL
    ORDER BY type, name`).all() as Array<{ type: string; name: string; sql: string }>)
    .filter((object) => !STANDARD_OBJECTS.has(object.name));
  db.exec(tableSql('agent_bridge_jobs_s2a_new'));
  db.exec(`INSERT INTO agent_bridge_jobs_s2a_new (${LEGACY_COLUMNS.join(', ')})
    SELECT ${LEGACY_COLUMNS.join(', ')} FROM agent_bridge_jobs`);
  hooks.afterLegacyCopy?.(db);
  db.exec('DROP TABLE agent_bridge_jobs');
  db.exec('ALTER TABLE agent_bridge_jobs_s2a_new RENAME TO agent_bridge_jobs');
  createStandardObjects(db);
  for (const object of customObjects) db.exec(object.sql);
}

/** SQLite-only, caller-handle-local, content-preserving bridge ledger migration. */
export function installNativeWorkstreamBridgeSchema(
  db: Database.Database,
  hooks: NativeWorkstreamSchemaMigrationTestHooks = {},
): void {
  db.exec('SAVEPOINT install_native_workstream_bridge_schema');
  try {
    const existing = readTable(db);
    if (!existing) {
      db.exec(tableSql('agent_bridge_jobs'));
      createStandardObjects(db);
    } else if (isSupportedLegacy(db, existing)) {
      migrateLegacy(db, hooks);
      installCoordinatorColumns(db);
    } else if (isSupportedNativeBase(db, existing)) {
      installCoordinatorColumns(db);
    } else if (isSupportedNativeWithCoordinator(db, existing)) {
      // Canonical replay is intentionally a no-op.
    } else {
      throw new Error('Unsupported agent_bridge_jobs schema; refusing writes');
    }
    if (!existing) installCoordinatorColumns(db);
    db.exec('RELEASE SAVEPOINT install_native_workstream_bridge_schema');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT install_native_workstream_bridge_schema');
    db.exec('RELEASE SAVEPOINT install_native_workstream_bridge_schema');
    throw error;
  }
}
