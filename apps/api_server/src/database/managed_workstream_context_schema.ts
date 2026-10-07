import type Database from 'better-sqlite3';

export const MANAGED_CONTEXT_DISPATCH_COLUMNS = [
  'managed_context_schema_version',
  'managed_context_owner_user_id',
  'managed_context_project_id',
  'managed_context_workstream_id',
  'managed_context_workstream_revision',
  'managed_context_role',
  'managed_context_host_epoch',
  'managed_context_sdk_session_id',
  'managed_context_sdk_turn_id',
  'managed_context_manifest_json',
  'managed_context_manifest_revision',
  'managed_context_enrolled_at',
] as const;

export const MANAGED_CONTEXT_SESSION_COLUMNS = [
  'managed_context_nonreuse_code',
  'managed_context_nonreuse_at',
] as const;

/**
 * Separate Dayflow receiving metadata. These columns intentionally do not
 * reuse managed-workstream enrollment, workstream ids, or nonreuse markers.
 */
export const DAYFLOW_CONTEXT_DISPATCH_COLUMNS = [
  'dayflow_context_schema_version',
  'dayflow_context_owner_user_id',
  'dayflow_context_project_id',
  'dayflow_context_sdk_session_id',
  'dayflow_context_sdk_turn_id',
  'dayflow_context_manifest_json',
  'dayflow_context_manifest_revision',
  'dayflow_context_recorded_at',
] as const;

export const DAYFLOW_CONTEXT_SESSION_COLUMNS = [
  'dayflow_context_nonreuse_code',
  'dayflow_context_nonreuse_at',
] as const;

const DISPATCH_DEFINITIONS: Record<typeof MANAGED_CONTEXT_DISPATCH_COLUMNS[number], string> = {
  managed_context_schema_version: 'INTEGER CHECK(managed_context_schema_version IS NULL OR managed_context_schema_version = 1)',
  managed_context_owner_user_id: "INTEGER CHECK(managed_context_owner_user_id IS NULL OR (typeof(managed_context_owner_user_id) = 'integer' AND managed_context_owner_user_id > 0))",
  managed_context_project_id: 'TEXT CHECK(managed_context_project_id IS NULL OR length(managed_context_project_id) > 0)',
  managed_context_workstream_id: 'TEXT CHECK(managed_context_workstream_id IS NULL OR length(managed_context_workstream_id) > 0)',
  managed_context_workstream_revision: "INTEGER CHECK(managed_context_workstream_revision IS NULL OR (typeof(managed_context_workstream_revision) = 'integer' AND managed_context_workstream_revision BETWEEN 1 AND 9007199254740991))",
  managed_context_role: "TEXT CHECK(managed_context_role IS NULL OR managed_context_role IN ('parent','worker'))",
  managed_context_host_epoch: 'TEXT CHECK(managed_context_host_epoch IS NULL OR length(managed_context_host_epoch) > 0)',
  managed_context_sdk_session_id: 'TEXT CHECK(managed_context_sdk_session_id IS NULL OR length(managed_context_sdk_session_id) > 0)',
  managed_context_sdk_turn_id: 'TEXT CHECK(managed_context_sdk_turn_id IS NULL OR length(managed_context_sdk_turn_id) > 0)',
  managed_context_manifest_json: 'TEXT',
  managed_context_manifest_revision: "INTEGER CHECK(managed_context_manifest_revision IS NULL OR (typeof(managed_context_manifest_revision) = 'integer' AND managed_context_manifest_revision BETWEEN 0 AND 9007199254740991))",
  managed_context_enrolled_at: 'TEXT CHECK(managed_context_enrolled_at IS NULL OR length(managed_context_enrolled_at) > 0)',
};

const SESSION_DEFINITIONS: Record<typeof MANAGED_CONTEXT_SESSION_COLUMNS[number], string> = {
  managed_context_nonreuse_code: "TEXT CHECK(managed_context_nonreuse_code IS NULL OR managed_context_nonreuse_code IN ('dependency_conflict','dependency_overflow','manifest_malformed','binding_ambiguous','scope_mismatch','persistence_failure','unknown_manifest_version'))",
  managed_context_nonreuse_at: 'TEXT CHECK(managed_context_nonreuse_at IS NULL OR length(managed_context_nonreuse_at) > 0)',
};

const DAYFLOW_DISPATCH_DEFINITIONS: Record<typeof DAYFLOW_CONTEXT_DISPATCH_COLUMNS[number], string> = {
  dayflow_context_schema_version: 'INTEGER CHECK(dayflow_context_schema_version IS NULL OR dayflow_context_schema_version = 1)',
  dayflow_context_owner_user_id: "INTEGER CHECK(dayflow_context_owner_user_id IS NULL OR (typeof(dayflow_context_owner_user_id) = 'integer' AND dayflow_context_owner_user_id > 0))",
  dayflow_context_project_id: 'TEXT CHECK(dayflow_context_project_id IS NULL OR length(dayflow_context_project_id) > 0)',
  dayflow_context_sdk_session_id: 'TEXT CHECK(dayflow_context_sdk_session_id IS NULL OR length(dayflow_context_sdk_session_id) > 0)',
  dayflow_context_sdk_turn_id: 'TEXT CHECK(dayflow_context_sdk_turn_id IS NULL OR length(dayflow_context_sdk_turn_id) > 0)',
  dayflow_context_manifest_json: 'TEXT',
  dayflow_context_manifest_revision: "INTEGER CHECK(dayflow_context_manifest_revision IS NULL OR (typeof(dayflow_context_manifest_revision) = 'integer' AND dayflow_context_manifest_revision BETWEEN 0 AND 9007199254740991))",
  dayflow_context_recorded_at: 'TEXT CHECK(dayflow_context_recorded_at IS NULL OR length(dayflow_context_recorded_at) > 0)',
};

const DAYFLOW_SESSION_DEFINITIONS: Record<typeof DAYFLOW_CONTEXT_SESSION_COLUMNS[number], string> = {
  dayflow_context_nonreuse_code: "TEXT CHECK(dayflow_context_nonreuse_code IS NULL OR dayflow_context_nonreuse_code IN ('dayflow_dependency_persistence_failure','dayflow_receiving_context_changed','dayflow_dependency_revalidation_failed','dayflow_manifest_malformed','dayflow_binding_ambiguous'))",
  dayflow_context_nonreuse_at: 'TEXT CHECK(dayflow_context_nonreuse_at IS NULL OR length(dayflow_context_nonreuse_at) > 0)',
};

function columns(db: Database.Database, table: string): Map<string, string> {
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table);
  if (!exists) throw new Error(`managed_context_missing_table:${table}`);
  return new Map((db.pragma(`table_info(${table})`) as Array<{ name: string; type: string }>)
    .map((column) => [column.name, column.type.toUpperCase()]));
}

function canonicalSql(value: string): string {
  return value.toLowerCase().replace(/[\s"`\[\]]/gu, '');
}

function tableSql(db: Database.Database, table: string): string {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table) as { sql: string } | undefined;
  if (!row?.sql) throw new Error(`managed_context_missing_table:${table}`);
  return canonicalSql(row.sql);
}

function addColumns(
  db: Database.Database,
  table: string,
  definitions: Record<string, string>,
): void {
  const existing = columns(db, table);
  const existingSql = tableSql(db, table);
  for (const [name, definition] of Object.entries(definitions)) {
    if (existing.has(name)) {
      const expectedType = definition.split(/\s/u, 1)[0];
      const expectedSql = canonicalSql(`${name} ${definition}`);
      if (existing.get(name) !== expectedType || !existingSql.includes(expectedSql)) {
        throw new Error(`managed_context_unsupported_column:${table}.${name}`);
      }
      continue;
    }
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

/** Additive SQLite-local metadata only; no table rebuilds or historical inference. */
export function installManagedWorkstreamContextSchema(db: Database.Database): void {
  columns(db, 'agent_sessions');
  columns(db, 'agent_turn_dispatches');
  db.exec('SAVEPOINT install_managed_workstream_context_schema');
  try {
    addColumns(db, 'agent_turn_dispatches', DISPATCH_DEFINITIONS);
    addColumns(db, 'agent_sessions', SESSION_DEFINITIONS);
    addColumns(db, 'agent_turn_dispatches', DAYFLOW_DISPATCH_DEFINITIONS);
    addColumns(db, 'agent_sessions', DAYFLOW_SESSION_DEFINITIONS);
    db.exec('RELEASE SAVEPOINT install_managed_workstream_context_schema');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT install_managed_workstream_context_schema');
    db.exec('RELEASE SAVEPOINT install_managed_workstream_context_schema');
    throw error;
  }
}
