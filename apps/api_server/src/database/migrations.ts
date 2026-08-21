import type Database from 'better-sqlite3';

import { convertLegacyNumberedCorePermissions } from './core_permissions_repair';
import { ENROLLMENT_FAILURE_CODES, ENROLLMENT_FAILURE_CODE_REASONS } from '../models/agent_org_experiment_enrollment';
import {
  LEGACY_MEMORY_CONSOLIDATION_PROMPT_V1,
  MEMORY_CONSOLIDATION_ALLOWED_MCPS_JSON,
  MEMORY_CONSOLIDATION_ALLOWED_SKILLS_JSON,
  MEMORY_CONSOLIDATION_PROMPT,
  MEMORY_CONSOLIDATION_REPAIR_KEY,
  MEMORY_CONSOLIDATION_SEED_NAME,
} from '../services/memory_consolidation_seed';

/**
 * W1 corrective-6 package B — monotonic persistence revisions.
 *
 * `revision` is the CAS token the scope lifecycle fences every approved →
 * applied → measuring transition on. A raw writer (a migration repair, a
 * bootstrap backfill, an ad-hoc UPDATE) that changes a row without touching
 * `revision` would leave a stale token valid, so a lifecycle caller could
 * commit against bytes it never read. Enforce the invariant in the schema
 * rather than at each of the ~10 call sites:
 *
 *   - BEFORE INSERT / BEFORE UPDATE OF revision guards pin the stored domain
 *     to a safe non-negative integer (SQLite's INTEGER affinity happily keeps
 *     -1, 1.5, Infinity and 2^53 in an `INTEGER NOT NULL` column).
 *   - AFTER UPDATE auto-bumps only when the writer left `revision` unchanged,
 *     so repository writes that already do `revision = revision + 1` are not
 *     double-incremented.
 *   - an explicit revision write must move FORWARD. Without that, raw SQL
 *     could roll a revision back and revive a stale CAS token: bytes go
 *     A -> B -> A while the revision returns to its old value, and a caller
 *     holding that token wins a compare-and-set over history it never saw.
 *
 * Known limitation: `INSERT OR REPLACE` / `DELETE`+`INSERT` destroy and
 * recreate the row rather than updating it, so no UPDATE trigger can observe
 * the old revision. SQLite cannot express that guard. No writer in this
 * repository replaces these rows; a future one must bump the revision itself.
 *
 * Pre-existing unsafe material fails the migration CLOSED. Silently
 * normalizing a corrupt revision would hand a lifecycle caller a token that
 * looks fresh but describes bytes nobody verified.
 */
const MAX_SAFE_SQL_REVISION = '9007199254740991';

function installRevisionInvariants(db: Database.Database, table: string): void {
  const columns = (db.pragma(`table_info(${table})`) as { name: string }[])
    .map((column) => column.name);
  if (!columns.includes('revision')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`);
  }

  const unsafeDomain =
    `typeof(revision) <> 'integer' OR revision < 0 OR revision > ${MAX_SAFE_SQL_REVISION}`;
  const corrupt = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${unsafeDomain}`)
    .get() as { n: number };
  if (corrupt.n > 0) {
    throw new Error(
      `${table}.revision holds ${corrupt.n} row(s) outside the safe non-negative integer ` +
      'domain; refusing to migrate. Reconcile the corrupt revisions before restarting.',
    );
  }

  const rowDomain =
    `typeof(NEW.revision) <> 'integer' OR NEW.revision < 0 ` +
    `OR NEW.revision > ${MAX_SAFE_SQL_REVISION}`;
  const abort = `SELECT RAISE(ABORT, '${table}.revision must be a safe non-negative integer');`;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_revision_insert_domain
    BEFORE INSERT ON ${table}
    FOR EACH ROW WHEN ${rowDomain}
    BEGIN ${abort} END;

    CREATE TRIGGER IF NOT EXISTS trg_${table}_revision_update_domain
    BEFORE UPDATE OF revision ON ${table}
    FOR EACH ROW WHEN ${rowDomain} OR NEW.revision <= OLD.revision
    BEGIN ${abort} END;

    CREATE TRIGGER IF NOT EXISTS trg_${table}_revision_autobump
    AFTER UPDATE ON ${table}
    FOR EACH ROW WHEN NEW.revision = OLD.revision
    BEGIN
      UPDATE ${table}
         SET revision = OLD.revision + 1
       WHERE id = NEW.id AND revision = OLD.revision;
    END;
  `);
}

export function runMigrations(db: Database.Database): void {
  // ── Write-discipline contract ─────────────────────────────────────────
  // runMigrations() runs on EVERY boot (db.ts initDb), not just first
  // install. Every statement here is one of exactly two classes:
  //   1. STRUCTURE — CREATE TABLE IF NOT EXISTS / add-column-if-missing /
  //      indexes / content-preserving rebuilds. Naturally idempotent.
  //   2. CONTENT — anything writing a value into a field a user or agent
  //      can also edit through the API (agent_configs prompts, scopes,
  //      models, CLI presets, …). These MUST be wrapped in runOnce():
  //      a durable schema_meta marker makes them one-time repairs. An
  //      unguarded content UPDATE here silently re-stomps live user edits
  //      on every restart — the "my Config Doctor changes are gone after
  //      reboot" bug class.
  // To ship a NEW revision of seeded content (e.g. an improved default
  // prompt), add a runOnce() with a NEW versioned key; never edit the
  // values inside an already-shipped key, and never write content
  // unguarded. migrations_replay_guard.test.ts enforces this contract:
  // it customizes every user-editable field, re-runs runMigrations, and
  // fails on any data change.
  //
  // Marker consumption is DELIBERATELY unconditional — a repair whose
  // target row doesn't exist yet (fresh install; the row arrives later via
  // profile sync/seeds) is consumed as a no-op and never retried. That is
  // the intent: these blocks repair PRE-EXISTING installs' drift; fresh
  // installs get their defaults from the insert paths. Do NOT "fix" this
  // by gating the marker on rowcount — a state-shaped repair (e.g. the
  // '[]'→NULL normalization) that stays armed until it matches would
  // silently rewrite a future deliberate user value, which is the exact
  // bug class this contract exists to kill.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Synology relay Phase 2 — durable, sequence-stamped mirror replication.
  // These are structure-only migrations: CREATE TABLE IF NOT EXISTS is safe
  // on every boot and does not rewrite user-editable content.
  db.exec(`
    CREATE TABLE IF NOT EXISTS relay_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tbl TEXT NOT NULL,
      op TEXT NOT NULL,
      pk TEXT NOT NULL,
      row_json TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS relay_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_applied_seq INTEGER NOT NULL DEFAULT 0
    );
  `);

  const runOnce = (key: string, fn: () => void): void => {
    const done = db.prepare(`SELECT key FROM schema_meta WHERE key = ?`).get(key);
    if (done) return;
    db.transaction(() => {
      fn();
      db.prepare(`INSERT INTO schema_meta (key, value) VALUES (?, ?)`).run(
        key,
        new Date().toISOString(),
      );
    })();
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      source_type TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS recurring_task_rules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      frequency TEXT NOT NULL,
      day_of_week INTEGER,
      day_of_month INTEGER,
      month INTEGER,
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS project_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      anchor_type TEXT NOT NULL DEFAULT 'date',
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS project_template_steps (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      offset_days INTEGER NOT NULL DEFAULT 0,
      offset_description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_instances (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES project_templates(id),
      name TEXT,
      anchor_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS project_milestones (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL REFERENCES project_instances(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_date TEXT,
      color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(instance_id, id)
    );

    CREATE TABLE IF NOT EXISTS project_instance_steps (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL REFERENCES project_instances(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES project_template_steps(id),
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      milestone_id TEXT,
      FOREIGN KEY (instance_id, milestone_id) REFERENCES project_milestones(instance_id, id)
    );

    CREATE TABLE IF NOT EXISTS weekly_plans (
      id TEXT PRIMARY KEY,
      week_label TEXT NOT NULL UNIQUE,
      week_start_date TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS integration_accounts (
      id TEXT PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_account_id TEXT NOT NULL,
      email TEXT,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      access_token TEXT,
      refresh_token TEXT,
      scope TEXT,
      token_type TEXT,
      expires_at TEXT,
      last_synced_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(owner_id, provider)
    );

    CREATE TABLE IF NOT EXISTS calendar_shadow_events (
      id TEXT PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      source_name TEXT,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(owner_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS gmail_signals (
      id TEXT PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      from_name TEXT,
      from_email TEXT,
      subject TEXT,
      snippet TEXT,
      received_at TEXT,
      is_unread INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(owner_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS integration_preferences (
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      key TEXT NOT NULL,
      json_value TEXT NOT NULL,
      PRIMARY KEY (owner_id, provider, key)
    );

    CREATE TABLE IF NOT EXISTS automation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT,
      action_type TEXT NOT NULL,
      action_config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS automation_signals (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      occurred_at TEXT,
      synced_at TEXT NOT NULL,
      source_account_id TEXT,
      source_label TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      google_sub TEXT UNIQUE,
      photo_url TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      is_facilities_manager INTEGER NOT NULL DEFAULT 0,
      email_notifications_enabled INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS message_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      sender_id INTEGER REFERENCES users(id),
      sender_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      capacity INTEGER,
      location TEXT,
      building TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS reservation_groups (
      id TEXT PRIMARY KEY,
      series_id TEXT REFERENCES reservation_series(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      requester_user_id INTEGER REFERENCES users(id),
      created_by_user_id INTEGER REFERENCES users(id),
      notes TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      occurrence_date TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      group_id TEXT REFERENCES reservation_groups(id) ON DELETE CASCADE,
      series_id TEXT REFERENCES reservation_series(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      reserved_by TEXT NOT NULL,
      reserved_by_user_id INTEGER REFERENCES users(id),
      created_by_user_id INTEGER REFERENCES users(id),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      external_event_id TEXT,
      external_source TEXT,
      created_by_rhythm INTEGER NOT NULL DEFAULT 1,
      is_conflicted INTEGER NOT NULL DEFAULT 0,
      conflict_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS reservation_series (
      id TEXT PRIMARY KEY,
      facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      requester_user_id INTEGER REFERENCES users(id),
      created_by_user_id INTEGER REFERENCES users(id),
      notes TEXT,
      recurrence_type TEXT NOT NULL,
      recurrence_interval INTEGER,
      weekday_pattern_json TEXT,
      custom_dates_json TEXT NOT NULL DEFAULT '[]',
      start_date TEXT NOT NULL,
      end_date TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS thread_participants (
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS thread_reads (
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TEXT,
      PRIMARY KEY (thread_id, user_id)
    );
  `);

  // Additive column migrations — safe to run on existing DBs
  const taskCols = (db.pragma('table_info(tasks)') as { name: string }[]).map((c) => c.name);
  if (!taskCols.includes('scheduled_date')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN scheduled_date TEXT`);
  }
  if (!taskCols.includes('locked')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`);
  }
  if (!taskCols.includes('notes')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN notes TEXT`);
  }
  if (!taskCols.includes('owner_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
  }
  if (!taskCols.includes('scheduled_order')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN scheduled_order INTEGER`);
  }

  // External-content FTS5 keeps task text indexed without duplicating task data.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts
      USING fts5(title, notes, content='tasks', content_rowid='rowid');

    CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(rowid, title, notes) VALUES (new.rowid, new.title, new.notes);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, title, notes)
        VALUES ('delete', old.rowid, old.title, old.notes);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE OF title, notes ON tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, title, notes)
        VALUES ('delete', old.rowid, old.title, old.notes);
      INSERT INTO tasks_fts(rowid, title, notes) VALUES (new.rowid, new.title, new.notes);
    END;
  `);
  runOnce('tasks_fts_backfill_v1', () => {
    db.exec(`INSERT INTO tasks_fts(tasks_fts) VALUES ('rebuild')`);
  });

  const stepCols = (db.pragma('table_info(project_instance_steps)') as { name: string }[]).map((c) => c.name);
  if (!stepCols.includes('notes')) {
    db.exec(`ALTER TABLE project_instance_steps ADD COLUMN notes TEXT`);
  }

  const instanceCols = (db.pragma('table_info(project_instances)') as { name: string }[]).map((c) => c.name);
  if (!instanceCols.includes('name')) {
    db.exec(`ALTER TABLE project_instances ADD COLUMN name TEXT`);
  }
  if (!instanceCols.includes('owner_id')) {
    db.exec(`ALTER TABLE project_instances ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
  }

  const projectTemplateCols = (db.pragma('table_info(project_templates)') as { name: string }[]).map((c) => c.name);
  if (!projectTemplateCols.includes('owner_id')) {
    db.exec(`ALTER TABLE project_templates ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
  }

  const recurringRuleCols = (db.pragma('table_info(recurring_task_rules)') as { name: string }[]).map((c) => c.name);
  if (!recurringRuleCols.includes('enabled')) {
    db.exec(`ALTER TABLE recurring_task_rules ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`);
  }
  if (!recurringRuleCols.includes('owner_id')) {
    db.exec(`ALTER TABLE recurring_task_rules ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
  }
  if (!recurringRuleCols.includes('steps_json')) {
    db.exec(`ALTER TABLE recurring_task_rules ADD COLUMN steps_json TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!recurringRuleCols.includes('sequential')) {
    db.exec(`ALTER TABLE recurring_task_rules ADD COLUMN sequential INTEGER NOT NULL DEFAULT 0`);
  }

  const userCols = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
  if (!userCols.includes('google_sub')) {
    db.exec(`ALTER TABLE users ADD COLUMN google_sub TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL`);
  }
  if (!userCols.includes('photo_url')) {
    db.exec(`ALTER TABLE users ADD COLUMN photo_url TEXT`);
  }
  if (!userCols.includes('is_facilities_manager')) {
    db.exec(
      `ALTER TABLE users ADD COLUMN is_facilities_manager INTEGER NOT NULL DEFAULT 0`,
    );
  }
  const userColsP9 = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
  if (!userColsP9.includes('email_notifications_enabled')) {
    db.exec(
      `ALTER TABLE users ADD COLUMN email_notifications_enabled INTEGER NOT NULL DEFAULT 1`,
    );
  }

  const facilityCols = (db.pragma('table_info(facilities)') as {
    name: string;
  }[]).map((c) => c.name);
  if (!facilityCols.includes('building')) {
    db.exec(`ALTER TABLE facilities ADD COLUMN building TEXT`);
  }

  const reservationCols = (db.pragma('table_info(reservations)') as { name: string }[]).map((c) => c.name);
  if (!reservationCols.includes('group_id')) {
    db.exec(`ALTER TABLE reservations ADD COLUMN group_id TEXT REFERENCES reservation_groups(id) ON DELETE CASCADE`);
  }
  if (!reservationCols.includes('series_id')) {
    db.exec(
      `ALTER TABLE reservations ADD COLUMN series_id TEXT REFERENCES reservation_series(id) ON DELETE SET NULL`,
    );
  }
  if (!reservationCols.includes('reserved_by_user_id')) {
    db.exec(`ALTER TABLE reservations ADD COLUMN reserved_by_user_id INTEGER REFERENCES users(id)`);
  }
  if (!reservationCols.includes('created_by_user_id')) {
    db.exec(
      `ALTER TABLE reservations ADD COLUMN created_by_user_id INTEGER REFERENCES users(id)`,
    );
  }
  if (!reservationCols.includes('external_event_id')) {
    db.exec(`ALTER TABLE reservations ADD COLUMN external_event_id TEXT`);
  }
  if (!reservationCols.includes('external_source')) {
    db.exec(`ALTER TABLE reservations ADD COLUMN external_source TEXT`);
  }
  if (!reservationCols.includes('created_by_rhythm')) {
    db.exec(
      `ALTER TABLE reservations ADD COLUMN created_by_rhythm INTEGER NOT NULL DEFAULT 1`,
    );
  }
  if (!reservationCols.includes('is_conflicted')) {
    db.exec(
      `ALTER TABLE reservations ADD COLUMN is_conflicted INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!reservationCols.includes('conflict_reason')) {
    db.exec(`ALTER TABLE reservations ADD COLUMN conflict_reason TEXT`);
  }
  if (!reservationCols.includes('updated_at')) {
    db.exec(
      `ALTER TABLE reservations ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    );
  }

  const reservationSeriesCols = (db.pragma('table_info(reservation_series)') as {
    name: string;
  }[]).map((c) => c.name);
  if (reservationSeriesCols.length > 0) {
    if (!reservationSeriesCols.includes('recurrence_interval')) {
      db.exec(
        `ALTER TABLE reservation_series ADD COLUMN recurrence_interval INTEGER`,
      );
    }
    if (!reservationSeriesCols.includes('weekday_pattern_json')) {
      db.exec(
        `ALTER TABLE reservation_series ADD COLUMN weekday_pattern_json TEXT`,
      );
    }
    if (!reservationSeriesCols.includes('custom_dates_json')) {
      db.exec(
        `ALTER TABLE reservation_series ADD COLUMN custom_dates_json TEXT NOT NULL DEFAULT '[]'`,
      );
    }
    if (!reservationSeriesCols.includes('end_date')) {
      db.exec(`ALTER TABLE reservation_series ADD COLUMN end_date TEXT`);
    }
    if (!reservationSeriesCols.includes('updated_at')) {
      db.exec(
        `ALTER TABLE reservation_series ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      );
    }
  }

  const integrationAccountCols = (db.pragma('table_info(integration_accounts)') as { name: string }[]).map((c) => c.name);
  if (!integrationAccountCols.includes('owner_id')) {
    db.exec(`ALTER TABLE integration_accounts RENAME TO integration_accounts_legacy`);
    db.exec(`
      CREATE TABLE integration_accounts (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        external_account_id TEXT NOT NULL,
        email TEXT,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'connected',
        access_token TEXT,
        refresh_token TEXT,
        scope TEXT,
        token_type TEXT,
        expires_at TEXT,
        last_synced_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(owner_id, provider)
      );
    `);
    db.exec(`
      INSERT INTO integration_accounts (
        id, owner_id, provider, external_account_id, email, display_name, status,
        access_token, refresh_token, scope, token_type, expires_at,
        last_synced_at, error_message, created_at, updated_at
      )
      SELECT
        id, NULL, provider, external_account_id, email, display_name, status,
        access_token, refresh_token, scope, token_type, expires_at,
        last_synced_at, error_message, created_at, updated_at
      FROM integration_accounts_legacy;
    `);
    db.exec(`DROP TABLE integration_accounts_legacy`);
  }

  const shadowEventCols = (db.pragma('table_info(calendar_shadow_events)') as { name: string }[]).map((c) => c.name);
  if (!shadowEventCols.includes('owner_id')) {
    db.exec(`ALTER TABLE calendar_shadow_events RENAME TO calendar_shadow_events_legacy`);
    db.exec(`
      CREATE TABLE calendar_shadow_events (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        source_name TEXT,
        title TEXT NOT NULL,
        description TEXT,
        location TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT,
        is_all_day INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(owner_id, external_id)
      );
    `);
    db.exec(`
      INSERT INTO calendar_shadow_events (
        id, owner_id, provider, external_id, calendar_id, source_name, title,
        description, location, start_at, end_at, is_all_day, created_at, updated_at
      )
      SELECT
        id, NULL, provider, external_id, calendar_id, source_name, title,
        description, location, start_at, end_at, is_all_day, created_at, updated_at
      FROM calendar_shadow_events_legacy;
    `);
    db.exec(`DROP TABLE calendar_shadow_events_legacy`);
  }

  const integrationPreferenceCols = (db.pragma('table_info(integration_preferences)') as { name: string }[]).map((c) => c.name);
  if (!integrationPreferenceCols.includes('owner_id')) {
    db.exec(`ALTER TABLE integration_preferences RENAME TO integration_preferences_legacy`);
    db.exec(`
      CREATE TABLE integration_preferences (
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        key TEXT NOT NULL,
        json_value TEXT NOT NULL,
        PRIMARY KEY (owner_id, provider, key)
      );
    `);
    db.exec(`
      INSERT INTO integration_preferences (owner_id, provider, key, json_value)
      SELECT NULL, provider, key, json_value
      FROM integration_preferences_legacy;
    `);
    db.exec(`DROP TABLE integration_preferences_legacy`);
  }

  const gmailSignalCols = (db.pragma('table_info(gmail_signals)') as { name: string }[]).map((c) => c.name);
  if (!gmailSignalCols.includes('owner_id')) {
    db.exec(`ALTER TABLE gmail_signals RENAME TO gmail_signals_legacy`);
    db.exec(`
      CREATE TABLE gmail_signals (
        id TEXT PRIMARY KEY,
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        from_name TEXT,
        from_email TEXT,
        subject TEXT,
        snippet TEXT,
        received_at TEXT,
        is_unread INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(owner_id, external_id)
      );
    `);
    db.exec(`
      INSERT INTO gmail_signals (
        id, owner_id, external_id, thread_id, from_name, from_email, subject,
        snippet, received_at, is_unread, created_at, updated_at
      )
      SELECT
        id, NULL, external_id, thread_id, from_name, from_email, subject,
        snippet, received_at, is_unread, created_at, updated_at
      FROM gmail_signals_legacy;
    `);
    db.exec(`DROP TABLE gmail_signals_legacy`);
  }

  const automationRuleCols = (db.pragma('table_info(automation_rules)') as { name: string }[]).map((c) => c.name);
  if (!automationRuleCols.includes('owner_id')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
  }
  if (!automationRuleCols.includes('source')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN source TEXT`);
  }
  if (!automationRuleCols.includes('trigger_key')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN trigger_key TEXT`);
  }
  if (!automationRuleCols.includes('source_account_id')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN source_account_id TEXT REFERENCES integration_accounts(id)`);
  }
  if (!automationRuleCols.includes('last_evaluated_at')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN last_evaluated_at TEXT`);
  }
  if (!automationRuleCols.includes('last_matched_at')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN last_matched_at TEXT`);
  }
  if (!automationRuleCols.includes('match_count_last_run')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN match_count_last_run INTEGER NOT NULL DEFAULT 0`);
  }
  if (!automationRuleCols.includes('preview_sample')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN preview_sample TEXT`);
  }
  if (!automationRuleCols.includes('conditions')) {
    db.exec(`ALTER TABLE automation_rules ADD COLUMN conditions TEXT`);
  }

  const automationRuleFks = db.pragma('foreign_key_list(automation_rules)') as {
    table: string;
    from: string;
  }[];
  const hasLegacyAutomationRuleAccountFk = automationRuleFks.some(
    (fk) => fk.from === 'source_account_id' && fk.table === 'integration_accounts_legacy',
  );
  if (hasLegacyAutomationRuleAccountFk) {
    db.exec(`ALTER TABLE automation_rules RENAME TO automation_rules_legacy`);
    db.exec(`
      CREATE TABLE automation_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_config TEXT,
        action_type TEXT NOT NULL,
        action_config TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        owner_id INTEGER REFERENCES users(id),
        source TEXT,
        trigger_key TEXT,
        source_account_id TEXT REFERENCES integration_accounts(id),
        last_evaluated_at TEXT,
        last_matched_at TEXT,
        match_count_last_run INTEGER NOT NULL DEFAULT 0,
        preview_sample TEXT
      );
    `);
    db.exec(`
      INSERT INTO automation_rules (
        id, name, trigger_type, trigger_config, action_type, action_config,
        enabled, created_at, updated_at, owner_id, source, trigger_key,
        source_account_id, last_evaluated_at, last_matched_at,
        match_count_last_run, preview_sample
      )
      SELECT
        id, name, trigger_type, trigger_config, action_type, action_config,
        enabled, created_at, updated_at, owner_id, source, trigger_key,
        source_account_id, last_evaluated_at, last_matched_at,
        match_count_last_run, preview_sample
      FROM automation_rules_legacy;
    `);
    db.exec(`DROP TABLE automation_rules_legacy`);
  }
  db.exec(`
    UPDATE automation_rules
    SET source = CASE trigger_type
      WHEN 'project_step_due' THEN 'rhythm'
      WHEN 'task_due' THEN 'rhythm'
      WHEN 'plan_assembly' THEN 'rhythm'
      ELSE COALESCE(source, 'rhythm')
    END
    WHERE source IS NULL
  `);
  db.exec(`
    UPDATE automation_rules
    SET trigger_key = CASE trigger_type
      WHEN 'project_step_due' THEN 'rhythm.project_step_due'
      WHEN 'task_due' THEN 'rhythm.task_due'
      WHEN 'plan_assembly' THEN 'rhythm.plan_assembly'
      ELSE COALESCE(trigger_key, trigger_type)
    END
    WHERE trigger_key IS NULL
  `);

  // Phase 7: workspaces, collaborators, messaging identity
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'staff',
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS task_collaborators (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS project_collaborators (
      project_instance_id TEXT NOT NULL REFERENCES project_instances(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (project_instance_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS live_artifacts (
      -- Explicit NOT NULL: SQLite lets a TEXT PRIMARY KEY hold NULL, Postgres
      -- does not. Without it the two databases disagree on artifact identity.
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL CHECK (type = 'html'),
      title TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
      visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'shared', 'organization')),
      current_bundle_revision INTEGER NOT NULL CHECK (current_bundle_revision > 0),
      current_bundle_hash TEXT NOT NULL CHECK (length(current_bundle_hash) = 64),
      current_state_revision INTEGER NOT NULL CHECK (current_state_revision > 0),
      current_state_hash TEXT NOT NULL CHECK (length(current_state_hash) = 64),
      declared_capabilities_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_by_user_id INTEGER NOT NULL REFERENCES users(id),
      deleted_at TEXT,
      deleted_by_user_id INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_live_artifacts_workspace_visibility
      ON live_artifacts(workspace_id, visibility, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_live_artifacts_owner_updated
      ON live_artifacts(owner_user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS live_artifact_collaborators (
      artifact_id TEXT NOT NULL REFERENCES live_artifacts(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      added_by_user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (artifact_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_live_artifact_collaborators_user
      ON live_artifact_collaborators(user_id, artifact_id);

    CREATE TABLE IF NOT EXISTS live_artifact_bundle_revisions (
      artifact_id TEXT NOT NULL REFERENCES live_artifacts(id),
      revision INTEGER NOT NULL CHECK (revision > 0),
      hash TEXT NOT NULL CHECK (length(hash) = 64),
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (artifact_id, revision)
    );

    CREATE TABLE IF NOT EXISTS live_artifact_state_revisions (
      artifact_id TEXT NOT NULL REFERENCES live_artifacts(id),
      revision INTEGER NOT NULL CHECK (revision > 0),
      hash TEXT NOT NULL CHECK (length(hash) = 64),
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (artifact_id, revision)
    );
  `);

  const userColsLiveArtifacts = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
  if (!userColsLiveArtifacts.includes('artifact_tab_ids_json')) {
    db.exec(`ALTER TABLE users ADD COLUMN artifact_tab_ids_json TEXT NOT NULL DEFAULT '[]'`);
  }

  const taskColsP7 = (db.pragma('table_info(tasks)') as { name: string }[]).map((c) => c.name);
  if (!taskColsP7.includes('workspace_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id)`);
  }

  const msgColsP7 = (db.pragma('table_info(messages)') as { name: string }[]).map((c) => c.name);
  if (!msgColsP7.includes('sender_photo_url')) {
    db.exec(`ALTER TABLE messages ADD COLUMN sender_photo_url TEXT`);
  }

  const threadColsP7 = (db.pragma('table_info(message_threads)') as { name: string }[]).map((c) => c.name);
  if (!threadColsP7.includes('thread_type')) {
    db.exec(`ALTER TABLE message_threads ADD COLUMN thread_type TEXT NOT NULL DEFAULT 'direct'`);
  }
  if (!threadColsP7.includes('task_id')) {
    db.exec(`ALTER TABLE message_threads ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_message_threads_task_id ON message_threads(task_id)`);
  }

  // Phase 8: step assignees + rhythm collaborators
  const templateStepCols = (db.pragma('table_info(project_template_steps)') as { name: string }[]).map((c) => c.name);
  if (!templateStepCols.includes('assignee_id')) {
    db.exec(`ALTER TABLE project_template_steps ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  }

  const instanceStepCols = (db.pragma('table_info(project_instance_steps)') as { name: string }[]).map((c) => c.name);
  if (!instanceStepCols.includes('assignee_id')) {
    db.exec(`ALTER TABLE project_instance_steps ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS rhythm_collaborators (
      rhythm_id TEXT NOT NULL REFERENCES recurring_task_rules(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (rhythm_id, user_id)
    );
  `);

  // Notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient
      ON notifications(recipient_user_id, read_at);
  `);

  // Claude collaborator trigger queue.
  // task_id is NULLABLE: human-collaborator triggers carry a task_id, but
  // scheduler / webhook / research triggers are taskless and insert task_id=NULL.
  // UNIQUE(task_id) still de-dups human triggers (SQL UNIQUE permits multiple NULLs).
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_claude_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      triggered_by_user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(task_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pending_claude_triggers_created_at ON pending_claude_triggers(created_at)`);

  // Agent Sessions
  //
  // agent_kind is the legacy OpenCode engine agent column. profile_id below is
  // the distinct nullable Rhythm agent_configs.id reference.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      -- agent_kind stores the OpenCode engine agent name (legacy column name)
      agent_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting',
      session_token TEXT,
      cwd TEXT NOT NULL,
      name TEXT NOT NULL,
      last_preview TEXT,
      last_activity_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_task_id ON agent_sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);

    CREATE TABLE IF NOT EXISTS agent_session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      stripped_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_session_messages_session_id
      ON agent_session_messages(session_id, created_at);
  `);

  // tasks.preferred_agent — dual-DB: SQLite pragma-guarded ALTER; Postgres uses ADD COLUMN IF NOT EXISTS
  const taskColsAgentSession = (db.pragma('table_info(tasks)') as { name: string }[]).map((c) => c.name);
  if (!taskColsAgentSession.includes('preferred_agent')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN preferred_agent TEXT`);
  }

  // agent_sessions.task_title — store display title alongside task_id so the local server
  // can show meaningful session names without round-tripping to production for the task record.
  const agentSessionCols = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionCols.includes('task_title')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN task_title TEXT`);
  }
  // MSP-001 — additive and nullable so unknown legacy engine-agent mappings
  // remain Unassigned instead of being guessed or rewritten.
  if (!agentSessionCols.includes('profile_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN profile_id TEXT`);
  }

  // Agent Configs — user-configurable list of CLI agents (issue #481 / #466)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT NOT NULL,
      command TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_agent INTEGER NOT NULL DEFAULT 1,
      can_resume INTEGER NOT NULL DEFAULT 0,
      resume_command TEXT,
      session_id_pattern TEXT,
      output_marker TEXT,
      preset_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_configs_enabled ON agent_configs(enabled);
  `);

  // Installed HERE, immediately after the table exists and BEFORE any seed or
  // content repair below can write a row — a repair that runs while the column
  // is missing would leave the lifecycle CAS token behind the actual bytes.
  installRevisionInvariants(db, 'agent_configs');

  // Seed built-in preset rows (INSERT OR IGNORE keeps migration idempotent)
  db.exec(`
    INSERT OR IGNORE INTO agent_configs
      (id, label, icon, command, is_agent, can_resume, resume_command, session_id_pattern, output_marker, preset_id, sort_order)
    VALUES
      (
        'claude-code',
        'Claude Code',
        'assets/agents/claude-code.png',
        'claude',
        1,
        1,
        'claude --resume {{sessionId}}',
        'Session ID:\\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
        '⏺',
        'claude-code',
        0
      ),
      (
        'codex',
        'Codex',
        'assets/agents/codex.png',
        'codex',
        1,
        0,
        NULL,
        NULL,
        '•',
        'codex',
        1
      ),
      (
        'gemini-cli',
        'Gemini CLI',
        'assets/agents/gemini-cli.png',
        'gemini',
        1,
        0,
        NULL,
        NULL,
        '✦',
        'gemini-cli',
        2
      ),
      (
        'opencode',
        'OpenCode',
        'assets/agents/opencode.png',
        'opencode',
        1,
        0,
        NULL,
        NULL,
        '│',
        'opencode',
        3
      );
  `);

  // Issue #483 — Normalise agent_sessions.agent_kind to valid agent_configs.id values.
  // These UPDATEs are defensive: the listed legacy spellings should not exist in production
  // data, but we cover the historical Dart wireValue surface to ensure every row is a valid
  // logical FK reference after migrations run. Both statements are idempotent.
  db.exec(`
    UPDATE agent_sessions
    SET agent_kind = 'claude-code'
    WHERE agent_kind IN ('claude', 'claudeCode');

    UPDATE agent_sessions
    SET agent_kind = 'codex'
    WHERE agent_kind IN ('codexCli');
  `);

  // Bug 1 milestone — Repair legacy agent_configs.id values from older seeds.
  // Older versions of Rhythm seeded the Claude Code preset with id='claude'. The
  // canonical id (matching /agents/capabilities and the current seed) is
  // 'claude-code'. Update any surviving rows in-place. INSERT OR IGNORE on the
  // seed above means the canonical row already exists; if a legacy 'claude' row
  // is present we must drop the alias row (sessions were already migrated above).
  db.exec(`
    UPDATE agent_configs SET id = 'claude-code' WHERE id = 'claude'
      AND NOT EXISTS (SELECT 1 FROM agent_configs WHERE id = 'claude-code');
    DELETE FROM agent_configs WHERE id = 'claude'
      AND EXISTS (SELECT 1 FROM agent_configs WHERE id = 'claude-code');
    UPDATE agent_configs SET id = 'gemini-cli' WHERE id = 'gemini'
      AND NOT EXISTS (SELECT 1 FROM agent_configs WHERE id = 'gemini-cli');
    DELETE FROM agent_configs WHERE id = 'gemini'
      AND EXISTS (SELECT 1 FROM agent_configs WHERE id = 'gemini-cli');
  `);

  // Issue #497 — Verify Gemini CLI end-to-end and lock in seed values.
  //
  // Smoke-test findings (gemini 0.41.2, run 2026-05-08):
  //   • `which gemini` → /usr/local/bin/gemini  ✓ on PATH
  //   • command = 'gemini' is correct; the binary starts an interactive PTY session.
  //   • output_marker = '✦' is confirmed: Gemini's docs list ✦ as its "Working" state
  //     icon (see configuration.md: "Working: ✦"), making it the correct activity glyph.
  //   • can_resume = 0 is intentional:
  //       Gemini's default interactive mode uses React Ink for its TUI. The session ID
  //       is an internal implementation detail — it does NOT appear as a parseable
  //       plain-text line in the PTY stdout stream. `gemini --output-format stream-json`
  //       DOES emit {"type":"init","session_id":"<UUID>",...}, but that mode collects all
  //       stdin before processing (non-interactive), making it unsuitable for a live chat
  //       PTY. The CLI supports `gemini --resume <UUID>`, but without a way to capture
  //       the UUID from the PTY stream, server-side resume cannot be wired up. A future
  //       enhancement could use `gemini --session-id <UUID>` at spawn time so Rhythm
  //       supplies the UUID itself (session.id) rather than parsing it from output; that
  //       would require a PTY-runner change and is tracked separately.
  //   • session_id_pattern = NULL for the same reason as can_resume = 0.
  //
  // One-time repair (runOnce): re-asserts the verified values once on DBs
  // that ran the original seed. Not re-applied every boot — the row is
  // user-editable and must not be re-stamped after this repair lands.
  runOnce('gemini_cli_preset_v1', () => {
    db.exec(`
      UPDATE agent_configs
      SET
        command        = 'gemini',
        can_resume     = 0,
        resume_command = NULL,
        session_id_pattern = NULL,
        output_marker  = '✦',
        updated_at     = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = 'gemini-cli';
    `);
  });

  // Issue #498 — Verify OpenCode end-to-end and lock in seed values.
  //
  // Smoke-test findings (opencode 1.14.40, run 2026-05-08):
  //   • `which opencode` → /Users/ajhochhalter/.opencode/bin/opencode  ✓ on PATH
  //   • command = 'opencode' is correct.
  //   • `opencode run --format json "say hi"` emits newline-delimited JSON events.
  //     Every event includes "sessionID":"ses_<alphanumeric>" in the top-level object.
  //   • session_id_pattern = '(ses_[a-zA-Z0-9]{10,})' reliably captures the ID from
  //     the very first JSON line (type:"step_start").
  //   • can_resume = 1 is intentional:
  //       `opencode run --session <sessionId>` successfully resumes a prior session.
  //       Verified by replaying a ses_* ID: the second run emitted the same sessionID
  //       and continued the conversation context (cache hits confirmed in token counts).
  //   • resume_command = 'opencode --session {{sessionId}}' matches CLIdeck's authoritative
  //       agent-presets.json (my-clideck repo) and is confirmed working via smoke-test.
  //   • output_marker = '│' (U+2502) is unchanged — CLIdeck presets list this as the
  //       OpenCode output indicator and the seed value is already correct.
  //
  // One-time repair (runOnce): re-asserts the verified values (with
  // can_resume corrected to 1) once on DBs that ran the original seed.
  // Not re-applied every boot — the row is user-editable.
  runOnce('opencode_preset_v1', () => {
    db.exec(`
      UPDATE agent_configs
      SET
        command            = 'opencode',
        can_resume         = 1,
        resume_command     = 'opencode --session {{sessionId}}',
        session_id_pattern = '(ses_[a-zA-Z0-9]{10,})',
        output_marker      = '│',
        updated_at         = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = 'opencode';
    `);
  });

  // PR #598 follow-up — relabel the bare "opencode" agent kind to "OpenRouter"
  // for the UI. The internal id stays 'opencode' (matches the SDK agent kind);
  // only the display label changes. This is the catch-all agent that routes
  // through whichever aggregator is authed — in practice always OpenRouter
  // today. The proper agent/model selector redesign in #602 will retire the
  // per-agent button row entirely.
  db.exec(`
    UPDATE agent_configs
    SET
      label      = 'OpenRouter',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = 'opencode' AND label = 'OpenCode';
  `);

  // agent_notifications — local delivery store for MCP-initiated push notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);

  // Issue #519 — scheduled_date column for project_instance_steps.
  // Additive, nullable, no default. Safe to run on existing DBs (idempotent via pragma check).
  const instanceStepColsScheduled = (db.pragma('table_info(project_instance_steps)') as { name: string }[]).map((c) => c.name);
  if (!instanceStepColsScheduled.includes('scheduled_date')) {
    db.exec(`ALTER TABLE project_instance_steps ADD COLUMN scheduled_date TEXT`);
  }

  // Issue #539 — users.timezone for per-user "today" computation.
  // Default: America/Los_Angeles (AJ's TZ; keeps existing rows stable on upgrade).
  const userColsP539 = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
  if (!userColsP539.includes('timezone')) {
    db.exec(
      `ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'`,
    );
  }

  // Issue #520 — One-time backfill: copy due_date → scheduled_date for legacy rows.
  //
  // Many tasks and project_steps were created by the legacy quick-add UI which only
  // wrote due_date. Under the new date-semantics model (scheduled_date primary, due_date
  // fallback) those rows appear "unscheduled". This migration copies due_date into
  // scheduled_date for every row where scheduled_date IS NULL AND due_date IS NOT NULL,
  // covering both tables in a single transaction.
  //
  // A schema_meta marker row prevents re-execution on DBs that have already received
  // this migration. Must run AFTER issue #519 (project_instance_steps.scheduled_date).

  // 1. Ensure schema_meta table exists.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // 2. Check for the idempotency marker.
  const backfillMarker = (db.prepare(`SELECT key FROM schema_meta WHERE key = 'backfill_scheduled_date_v1'`).get()) as { key: string } | undefined;

  if (!backfillMarker) {
    // 3. Run both UPDATEs inside a single transaction.
    const backfill = db.transaction(() => {
      const tasksResult = db.prepare(
        `UPDATE tasks SET scheduled_date = due_date WHERE scheduled_date IS NULL AND due_date IS NOT NULL`
      ).run();

      const stepsResult = db.prepare(
        `UPDATE project_instance_steps SET scheduled_date = due_date WHERE scheduled_date IS NULL AND due_date IS NOT NULL`
      ).run();

      // 4. Insert marker row with ISO timestamp.
      db.prepare(
        `INSERT INTO schema_meta (key, value) VALUES ('backfill_scheduled_date_v1', ?)`
      ).run(new Date().toISOString());

      return { tasksUpdated: tasksResult.changes, stepsUpdated: stepsResult.changes };
    });

    const { tasksUpdated, stepsUpdated } = backfill();

    // 5. Log affected row counts at INFO level for audit after deploy.
    console.log(`backfill_scheduled_date_v1: tasks updated=${tasksUpdated}, project_steps updated=${stepsUpdated}`);
  }

  // M1-1 (issue #586) — Projects: parent entity for agent sessions.
  // Local-only (SQLite); no Postgres path. VCS fields populated by services/vcs_probe.ts
  // at create / on demand via POST /projects/:id/refresh-vcs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      icon TEXT,
      vcs_root TEXT,
      vcs_branch TEXT,
      vcs_dirty INTEGER NOT NULL DEFAULT 0,
      vcs_checked_at TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived_at);
  `);

  // M2-1 (issue #593) — session-level provider/model/agentMode overrides.
  const m2Cols = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!m2Cols.includes('provider_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN provider_id TEXT`);
  }
  if (!m2Cols.includes('model_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN model_id TEXT`);
  }
  if (!m2Cols.includes('agent_mode')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN agent_mode TEXT`);
  }

  // M1-2 (issue #587) — agent_sessions.project_id (nullable, logical FK to projects.id).
  // PRAGMA foreign_keys is not enabled globally in this repo, so REFERENCES is informational.
  const agentSessionColsM1 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionColsM1.includes('project_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id)`);

  // #1309 — generated-media metadata. Bytes remain in the app-managed,
  // checksum-addressed filesystem store rather than bloating SQLite.
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_artifacts (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      session TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size >= 0),
      checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      created_at TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS idx_media_artifacts_project_created
      ON media_artifacts(project, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_artifacts_storage_key
      ON media_artifacts(storage_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_artifacts_session_checksum
      ON media_artifacts(project, session, checksum);
    CREATE INDEX IF NOT EXISTS idx_media_artifacts_retention
      ON media_artifacts(pinned, created_at);
  `);

  // Issue #601 — agent_sessions.archived_at (soft-archive, distinct from hard-delete)
  // Additive, nullable, no default. Idempotent via pragma check.
  const agentSessionColsArchive = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionColsArchive.includes('archived_at')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN archived_at TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_sessions_archived ON agent_sessions(archived_at)`);

  // Issue #611 — agent_sessions.permission_mode (default / acceptEdits / plan / bypassPermissions)
  // Additive, NOT NULL with DEFAULT 'default'. Idempotent via pragma check.
  const agentSessionColsPerm = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionColsPerm.includes('permission_mode')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'default'`);
  }

  // Issue #604 — reasoning effort (thinking_budget) and fast-mode columns for agent_sessions.
  // Both are additive and idempotent via pragma check.
  const agentSessionCols604 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionCols604.includes('thinking_budget')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN thinking_budget INTEGER`);
  }
  if (!agentSessionCols604.includes('fast_mode')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0`);
  }

  // Issue #609 — agent_model_visibility table for OpenRouter model curation.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_model_visibility (
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (provider, model_id)
    )
  `);

  // OPC-M1-2 (issue #686) — Structured parts persistence for agent_session_messages.
  // Adds sdk_message_id, parts_json, tokens_json, cost columns so the stream bridge
  // can store the full ordered part array as the single durable transcript store.
  // Legacy rows (parts_json IS NULL) are served via a back-compat text shim on read.
  const asmCols686 = (db.pragma('table_info(agent_session_messages)') as { name: string }[]).map((c) => c.name);
  if (!asmCols686.includes('sdk_message_id')) {
    db.exec(`ALTER TABLE agent_session_messages ADD COLUMN sdk_message_id TEXT`);
  }
  if (!asmCols686.includes('parts_json')) {
    db.exec(`ALTER TABLE agent_session_messages ADD COLUMN parts_json TEXT`);
  }
  if (!asmCols686.includes('tokens_json')) {
    db.exec(`ALTER TABLE agent_session_messages ADD COLUMN tokens_json TEXT`);
  }
  if (!asmCols686.includes('cost')) {
    db.exec(`ALTER TABLE agent_session_messages ADD COLUMN cost REAL`);
  }
  // #1379 — the verbatim engine `message.info` object, so a mirror-served
  // transcript can return the exact engine shape rather than a lossy
  // reconstruction from role/tokens/cost (which drops `error`, `summary`, and
  // `time.completed` — fields the phone renders). Rows written before this
  // column existed have info_json IS NULL, which is the mirror-incomplete
  // signal that makes the read fall back to a live engine fetch.
  if (!asmCols686.includes('info_json')) {
    db.exec(`ALTER TABLE agent_session_messages ADD COLUMN info_json TEXT`);
  }
  // Unique index on (session_id, sdk_message_id) — used for upsert keying.
  // The partial WHERE sdk_message_id IS NOT NULL prevents index from treating
  // multiple NULL sdk_message_ids as duplicates (legacy rows).
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_asm_sdk_msg
      ON agent_session_messages(session_id, sdk_message_id)
      WHERE sdk_message_id IS NOT NULL
  `);

  // OPC-M1-4 (issue #688) — Persisted error state for agent_sessions.
  // Replaces the in-memory `erroredSessions` 5s setTimeout sentinel with a
  // durable status='error' row and a human-readable status_message column.
  // Clearing happens only on an explicit user action (new prompt / resume).
  const agentSessionCols688 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionCols688.includes('status_message')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN status_message TEXT`);
  }

  // OPC-M1-5 (issue #689) — sdk_session_id column for resume continuity.
  // Stores the Opencode SDK session id so resume() can re-attach to the same
  // conversation instead of creating a fresh SDK session. The legacy
  // session_token field is retained for backward compatibility (not removed),
  // but sdk_session_id is the authoritative resume key from this migration on.
  const agentSessionCols689 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionCols689.includes('sdk_session_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN sdk_session_id TEXT`);
  }

  // C1 — MCP role gating: store the resolved role name and per-server allowedTools
  // allowlist on the session row so the WS gateway can enforce the init-time scope.
  const agentSessionColsC1 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionColsC1.includes('mcp_role')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN mcp_role TEXT`);
  }
  if (!agentSessionColsC1.includes('mcp_allowed_tools_json')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN mcp_allowed_tools_json TEXT`);
  }

  // ── Agent Subsystem: Scheduler, Memory, Webhooks, Research ──────────────
  //
  // These tables extend the agent subsystem with:
  //  • agent_scheduled_tasks — cron/recurring agent task definitions
  //  • agent_memory           — persistent, searchable agent memory store (FTS5)
  //  • agent_webhook_endpoints — inbound webhook → trigger drain (SSRF-safe)
  //  • agent_research_jobs    — deep research pipeline queue
  //
  // All tables use TEXT PKs (UUIDs) and follow the existing dual-DB pattern.
  // Changes to pending_claude_triggers are additive (nullable columns).

  // agent_scheduled_tasks — one row per scheduled agent task definition.
  // schedule_type: 'daily' | 'weekly' | 'monthly' | 'cron' | 'once'
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schedule_type TEXT NOT NULL DEFAULT 'daily',
      scheduled_time TEXT,        -- HH:MM wall-clock in the timezone column
      scheduled_day INTEGER,      -- 0-6 (Mon-Sun) for weekly; 1-31 for monthly
      cron_expression TEXT,       -- used when schedule_type = 'cron'
      run_at TEXT,                -- ISO datetime for schedule_type = 'once'
      timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      next_run_at TEXT,           -- ISO UTC; NULL = no future run
      prompt TEXT NOT NULL,       -- instructions delivered to the agent
      agent_kind TEXT NOT NULL DEFAULT 'opencode',
      allowed_mcps_json TEXT,     -- JSON string[] — permitted MCP server IDs
      allowed_skills_json TEXT,   -- JSON string[] — permitted skill names
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_run_status TEXT,       -- 'success' | 'error' | 'running' | NULL
      last_error TEXT,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_scheduled_tasks_next_run
      ON agent_scheduled_tasks(next_run_at)
      WHERE enabled = 1 AND next_run_at IS NOT NULL;
  `);

  // #1215 — repair only the exact managed v1 seed. The prompt + scopes form
  // the legacy fingerprint, so a user-authored schedule with the same display
  // name remains untouched. Fresh installs consume this marker before the seed
  // row exists and receive v2 directly from seedConsolidationTask().
  runOnce(MEMORY_CONSOLIDATION_REPAIR_KEY, () => {
    db.prepare(`
      UPDATE agent_scheduled_tasks
         SET prompt = ?,
             allowed_mcps_json = ?,
             allowed_skills_json = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE name = ?
         AND prompt = ?
         AND allowed_mcps_json = ?
         AND allowed_skills_json = ?
         AND created_by_user_id IS NULL
    `).run(
      MEMORY_CONSOLIDATION_PROMPT,
      MEMORY_CONSOLIDATION_ALLOWED_MCPS_JSON,
      MEMORY_CONSOLIDATION_ALLOWED_SKILLS_JSON,
      MEMORY_CONSOLIDATION_SEED_NAME,
      LEGACY_MEMORY_CONSOLIDATION_PROMPT_V1,
      MEMORY_CONSOLIDATION_ALLOWED_MCPS_JSON,
      JSON.stringify(['anthropic-skills:consolidate-memory']),
    );
  });

  // agent_memory — persistent facts extracted by the memory consolidation loop.
  // SQLite FTS5 virtual table enables full-text search over content.
  // The base row stores metadata; the FTS index stores the searchable text.
  //
  // #802 (memory epic #801): in SQLite this table + agent_memory_fts are a
  // DERIVED, DISPOSABLE index — the Obsidian Memory-Vault is the source of truth
  // and MemoryIndexService.rebuildIndexFromVault() can wipe + rebuild it from a
  // full vault scan at any time. No durable data lives here that isn't in the
  // vault. #1219 keeps a matching derived projection in role-gated Postgres
  // deployments so schema selection cannot drop provenance fields at runtime.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'fact',  -- 'fact' | 'preference' | 'context'
      content TEXT NOT NULL,
      source TEXT,                        -- 'session' | 'scheduler' | 'manual'
      source_id TEXT,                     -- e.g. session_id or scheduled_task_id
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'stable',
      stale_after TEXT,
      verified_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '[]',
      generated_by TEXT,
      generated_at TEXT,
      trust_tier TEXT NOT NULL DEFAULT 'unverified',
      auto_injectable INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_owner ON agent_memory(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_kind ON agent_memory(kind);
  `);

  // MEM-OKF #1189 — lifecycle/trust projection for the disposable SQLite
  // index. Guard every additive column so existing populated indexes upgrade
  // in place and repeated startup migrations remain a no-op. These columns do
  // not belong in the external-content FTS table: they are filter/sort
  // attributes, not searchable text.
  const agentMemoryCols = (
    db.pragma('table_info(agent_memory)') as { name: string }[]
  ).map((column) => column.name);
  if (!agentMemoryCols.includes('status')) {
    db.exec(
      `ALTER TABLE agent_memory ADD COLUMN status TEXT NOT NULL DEFAULT 'stable'`,
    );
  }
  if (!agentMemoryCols.includes('stale_after')) {
    db.exec(`ALTER TABLE agent_memory ADD COLUMN stale_after TEXT`);
  }
  if (!agentMemoryCols.includes('verified_json')) {
    db.exec(
      `ALTER TABLE agent_memory ADD COLUMN verified_json TEXT NOT NULL DEFAULT '[]'`,
    );
  }
  if (!agentMemoryCols.includes('sources_json')) {
    db.exec(
      `ALTER TABLE agent_memory ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[]'`,
    );
  }
  if (!agentMemoryCols.includes('generated_by')) {
    db.exec(`ALTER TABLE agent_memory ADD COLUMN generated_by TEXT`);
  }
  if (!agentMemoryCols.includes('generated_at')) {
    db.exec(`ALTER TABLE agent_memory ADD COLUMN generated_at TEXT`);
  }
  if (!agentMemoryCols.includes('trust_tier')) {
    db.exec(
      `ALTER TABLE agent_memory ADD COLUMN trust_tier TEXT NOT NULL DEFAULT 'unverified'`,
    );
  }
  if (!agentMemoryCols.includes('auto_injectable')) {
    // Fail closed for existing derived rows. The next vault sync/rebuild
    // applies explicit frontmatter/path classification; no legacy long-form
    // document becomes injectable merely because it was already indexed.
    db.exec(
      `ALTER TABLE agent_memory ADD COLUMN auto_injectable INTEGER NOT NULL DEFAULT 0`,
    );
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_memory_active
      ON agent_memory(status, stale_after);

    CREATE TABLE IF NOT EXISTS agent_memory_changes (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      memory_source_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      prior_state_json TEXT NOT NULL,
      rollback_target TEXT,
      source_context_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_changes_memory
      ON agent_memory_changes(memory_id, changed_at);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_changes_source
      ON agent_memory_changes(memory_source_id, changed_at);

    CREATE TRIGGER IF NOT EXISTS agent_memory_changes_no_update
      BEFORE UPDATE ON agent_memory_changes
      BEGIN
        SELECT RAISE(ABORT, 'agent_memory_changes is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS agent_memory_changes_no_delete
      BEFORE DELETE ON agent_memory_changes
      BEGIN
        SELECT RAISE(ABORT, 'agent_memory_changes is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS agent_memory_changes_validate_rollback_target
      BEFORE INSERT ON agent_memory_changes
      WHEN NEW.rollback_target IS NOT NULL
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1
            FROM agent_memory_changes target
           WHERE target.id = NEW.rollback_target
             AND target.memory_source_id = NEW.memory_source_id
        ) THEN RAISE(
          ABORT,
          'rollback_target must reference the same memory_source_id'
        ) END;
      END;
  `);

  // FTS5 virtual table for agent_memory full-text search.
  // content='' means external-content mode — we manage sync ourselves.
  // If FTS5 is unavailable (rare; all modern SQLite has it), the CREATE
  // fails silently and searches fall back to LIKE.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts
        USING fts5(content, kind, tags_json, content='agent_memory', content_rowid='rowid');
    `);
  } catch {
    // FTS5 not available — full-text search will fall back to LIKE queries.
  }

  // agent_skills — shared, instance-wide self-improving skill library (P1-1).
  // Skills are SHARED across all agents — there is intentionally NO owner_user_id.
  // steps_json / tags_json hold JSON string arrays.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      when_to_use TEXT,
      description TEXT,
      steps_json TEXT,
      tags_json TEXT,
      confidence REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      source TEXT,
      uses INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_skills_title ON agent_skills(title);
  `);

  // body TEXT (additive) — the full markdown procedure body for prose/seed
  // skills (everything after the frontmatter block). Nullable; extracted (P2)
  // skills that use steps_json leave this null. Guarded ALTER because the table
  // already exists on dev DBs (same pattern as the agent_configs columns below).
  const agentSkillsCols = (db.pragma('table_info(agent_skills)') as { name: string }[]).map(
    (c) => c.name,
  );
  if (!agentSkillsCols.includes('body')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN body TEXT`);
  }

  // P5-1 — version INTEGER (additive). Current version number of the live
  // agent_skills row; bumped by reviseInPlace/rollback. Guarded ALTER because
  // the table already exists on dev DBs.
  if (!agentSkillsCols.includes('version')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN version INTEGER DEFAULT 1`);
  }

  // #792 (skill-unify2) — repurpose agent_skills as a name-keyed metadata
  // SIDECAR + measurement LEDGER over the engine's filesystem skills, for the
  // auto-apply → measure → auto-revert self-improvement model. There is NO
  // human gate: `status` carries the data-only lifecycle 'active' / 'measuring'
  // / 'reverted' (no proposed/approved/rejected). agent_skill_versions remains
  // the untouched rollback fuel. All columns are additive + nullable, guarded
  // ALTERs so re-running migrate() is a no-op and no existing row is rewritten.
  //
  //  - applied_for_name : engine skill `name` (SKILL.md frontmatter) an
  //                       auto-applied revision targets; null otherwise.
  //  - base_version     : engine skill version the revision was based on =
  //                       the rollback target; null.
  //  - origin_location  : live skill filesystem `location` at apply time; null.
  //  - is_external      : 1 when the target lived OUTSIDE the managed dir
  //                       (fork-to-shadow); 0 otherwise.
  //  - baseline_score   : LLM-judge score of the PRIOR body; null until measured.
  //  - post_score       : LLM-judge score of the REVISED body; null until measured.
  //  - measure_reason   : judge's one-sentence rationale; null until measured.
  if (!agentSkillsCols.includes('applied_for_name')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN applied_for_name TEXT`);
  }
  if (!agentSkillsCols.includes('base_version')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN base_version INTEGER`);
  }
  if (!agentSkillsCols.includes('origin_location')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN origin_location TEXT`);
  }
  if (!agentSkillsCols.includes('is_external')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN is_external INTEGER DEFAULT 0`);
  }
  if (!agentSkillsCols.includes('baseline_score')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN baseline_score INTEGER`);
  }
  if (!agentSkillsCols.includes('post_score')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN post_score INTEGER`);
  }
  if (!agentSkillsCols.includes('measure_reason')) {
    db.exec(`ALTER TABLE agent_skills ADD COLUMN measure_reason TEXT`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_skills_applied_for_name
      ON agent_skills(applied_for_name);
  `);

  // P5-1 — agent_skill_versions: append-only version history for self-refinement.
  // Each row snapshots a prior (or restored) state of an agent_skills row so the
  // auto-apply refinement loop is non-destructive with one-click rollback.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      when_to_use TEXT,
      description TEXT,
      steps_json TEXT,
      tags_json TEXT,
      body TEXT,
      confidence REAL DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_skill_versions_skill_id
      ON agent_skill_versions(skill_id);
  `);

  // ── Stage A / Plan A↔Plan B shared contract — agent_capability_gaps ─────────
  // Local-SQLite-only bridge from the harvester's "no adequate library skill for
  // this intent" moment (skill_extractor step 3) to the next org-optimizer run
  // (Plan B external discovery). dedup_key is a STABLE hash of the normalized
  // intent (title + sorted tags) so re-asks collapse onto ONE 'open' row rather
  // than multiplying. Plan A owns this table + agent_capability_gaps_repository.ts;
  // Plan B only reads (listOpenAsync/findByDedupKeyAsync) and resolves
  // (resolveByDedupKeyAsync) on adopt+keep.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_capability_gaps (
      id                TEXT PRIMARY KEY,
      dedup_key         TEXT NOT NULL UNIQUE,
      intent_title      TEXT NOT NULL,
      intent_problem    TEXT,
      intent_tags_json  TEXT,
      sample_session_id TEXT,
      agent_config_id   TEXT,
      status            TEXT NOT NULL DEFAULT 'open',
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_capability_gaps_status ON agent_capability_gaps(status);
  `);

  // agent_webhook_endpoints — inbound webhook registrations.
  // The server verifies HMAC signatures on incoming requests.
  // SSRF guard lives in agentWebhookService.ts (no outbound calls to private
  // addresses — destination URLs are validated at registration time).
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_webhook_endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event_types_json TEXT NOT NULL DEFAULT '["*"]',  -- JSON string[]
      secret TEXT NOT NULL,                             -- HMAC secret (SHA-256)
      target_scheduled_task_id TEXT
        REFERENCES agent_scheduled_tasks(id) ON DELETE SET NULL,
      target_prompt TEXT,           -- override prompt on webhook fire
      enabled INTEGER NOT NULL DEFAULT 1,
      last_triggered_at TEXT,
      trigger_count INTEGER NOT NULL DEFAULT 0,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_webhook_endpoints_enabled
      ON agent_webhook_endpoints(enabled);
  `);

  // #1288 — named research-project persistence. Project runs are immutable
  // configuration snapshots; mutable execution state lives on their pass jobs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_research_projects (
      id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      question TEXT NOT NULL,
      goals_json TEXT NOT NULL DEFAULT '[]',
      domain TEXT,
      profile_id TEXT,
      pass_config_json TEXT NOT NULL DEFAULT '[]',
      model_policy_json TEXT NOT NULL DEFAULT '{}',
      critic_config_json TEXT NOT NULL DEFAULT '{}',
      synthesis_config_json TEXT NOT NULL DEFAULT '{}',
      schedule_ref TEXT,
      budget_json TEXT NOT NULL DEFAULT '{}',
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_research_projects_owner_activity
      ON agent_research_projects(owner_user_id, archived_at, updated_at);

    CREATE TABLE IF NOT EXISTS agent_research_project_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES agent_research_projects(id) ON DELETE CASCADE,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      config_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_json TEXT NOT NULL DEFAULT '{}',
      diagnostics_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_research_project_runs_project_activity
      ON agent_research_project_runs(project_id, created_at);
  `);

  // agent_research_jobs — deep research pipeline queue.
  // status: 'pending' | 'gathering' | 'reading' | 'synthesizing' | 'done' | 'error'
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_research_jobs (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sources_json TEXT NOT NULL DEFAULT '[]',   -- JSON array of URLs fetched
      report TEXT,                               -- final synthesized report
      error TEXT,
      agent_session_id TEXT,
      research_type TEXT NOT NULL DEFAULT 'generic',
      title TEXT,
      agent_profile_id TEXT,
      origin TEXT NOT NULL DEFAULT 'page',
      vault_path TEXT,
      requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES agent_research_projects(id) ON DELETE CASCADE,
      project_run_id TEXT REFERENCES agent_research_project_runs(id) ON DELETE CASCADE,
      pass_role TEXT,
      pass_ordinal INTEGER,
      run_config_json TEXT,
      progress_json TEXT,
      classification_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_research_jobs_status
      ON agent_research_jobs(status);
  `);
  const researchCols = (db.pragma('table_info(agent_research_jobs)') as { name: string }[]).map((c) => c.name);
  if (!researchCols.includes('agent_session_id')) {
    db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN agent_session_id TEXT`);
  }
  if (!researchCols.includes('research_type')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN research_type TEXT NOT NULL DEFAULT 'generic'`);
  if (!researchCols.includes('title')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN title TEXT`);
  if (!researchCols.includes('agent_profile_id')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN agent_profile_id TEXT`);
  if (!researchCols.includes('origin')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN origin TEXT NOT NULL DEFAULT 'page'`);
  if (!researchCols.includes('vault_path')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN vault_path TEXT`);
  if (!researchCols.includes('project_id')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN project_id TEXT REFERENCES agent_research_projects(id) ON DELETE CASCADE`);
  if (!researchCols.includes('project_run_id')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN project_run_id TEXT REFERENCES agent_research_project_runs(id) ON DELETE CASCADE`);
  if (!researchCols.includes('pass_role')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN pass_role TEXT`);
  if (!researchCols.includes('pass_ordinal')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN pass_ordinal INTEGER`);
  if (!researchCols.includes('run_config_json')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN run_config_json TEXT`);
  if (!researchCols.includes('progress_json')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN progress_json TEXT`);
  if (!researchCols.includes('classification_json')) db.exec(`ALTER TABLE agent_research_jobs ADD COLUMN classification_json TEXT`);
  db.exec(`UPDATE agent_research_jobs SET research_type = 'generic', title = query, agent_profile_id = 'research', origin = 'page' WHERE research_type IS NULL OR title IS NULL OR agent_profile_id IS NULL OR origin IS NULL`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_research_jobs_agent_session_id ON agent_research_jobs(agent_session_id) WHERE agent_session_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_research_jobs_project_run_pass ON agent_research_jobs(project_run_id, pass_ordinal)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_research_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES agent_research_projects(id) ON DELETE CASCADE,
      project_run_id TEXT REFERENCES agent_research_project_runs(id) ON DELETE CASCADE,
      job_id TEXT REFERENCES agent_research_jobs(id) ON DELETE SET NULL,
      artifact_role TEXT NOT NULL,
      vault_path TEXT NOT NULL,
      content_hash TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_research_artifacts_run_role
      ON agent_research_artifacts(project_run_id, artifact_role);

    CREATE TABLE IF NOT EXISTS agent_research_curated_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES agent_research_projects(id) ON DELETE CASCADE,
      project_run_id TEXT REFERENCES agent_research_project_runs(id) ON DELETE CASCADE,
      job_id TEXT REFERENCES agent_research_jobs(id) ON DELETE SET NULL,
      canonical_url TEXT NOT NULL,
      title TEXT,
      publisher TEXT,
      source_type TEXT,
      capture_status TEXT NOT NULL DEFAULT 'metadata-only',
      structured_vault_path TEXT,
      full_text_vault_path TEXT,
      content_hash TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_research_curated_sources_project_url
      ON agent_research_curated_sources(project_id, canonical_url);

    CREATE TABLE IF NOT EXISTS agent_research_qa_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES agent_research_projects(id) ON DELETE CASCADE,
      project_run_id TEXT REFERENCES agent_research_project_runs(id) ON DELETE SET NULL,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT,
      artifact_id TEXT REFERENCES agent_research_artifacts(id) ON DELETE SET NULL,
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_research_qa_links_project_activity
      ON agent_research_qa_links(project_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_research_pass_relationships (
      id TEXT PRIMARY KEY,
      parent_job_id TEXT NOT NULL REFERENCES agent_research_jobs(id) ON DELETE CASCADE,
      child_job_id TEXT NOT NULL REFERENCES agent_research_jobs(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(parent_job_id, child_job_id, relationship_type)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_research_pass_relationships_child
      ON agent_research_pass_relationships(child_job_id, relationship_type);
  `);

  const researchQaCols = (db.pragma('table_info(agent_research_qa_links)') as { name: string }[])
    .map((column) => column.name);
  if (!researchQaCols.includes('agent_session_id')) db.exec(`ALTER TABLE agent_research_qa_links ADD COLUMN agent_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL`);
  if (!researchQaCols.includes('context_snapshot_json')) db.exec(`ALTER TABLE agent_research_qa_links ADD COLUMN context_snapshot_json TEXT NOT NULL DEFAULT '{}'`);
  if (!researchQaCols.includes('context_hash')) db.exec(`ALTER TABLE agent_research_qa_links ADD COLUMN context_hash TEXT`);
  if (!researchQaCols.includes('model_usage_json')) db.exec(`ALTER TABLE agent_research_qa_links ADD COLUMN model_usage_json TEXT NOT NULL DEFAULT '{}'`);
  if (!researchQaCols.includes('diagnostics_json')) db.exec(`ALTER TABLE agent_research_qa_links ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '{}'`);

  // Extend pending_claude_triggers with scheduler context columns (additive).
  // These are all nullable — existing human-triggered rows have NULL here.
  const pctColsExt = (db.pragma('table_info(pending_claude_triggers)') as { name: string }[]).map((c) => c.name);
  if (!pctColsExt.includes('scheduled_task_id')) {
    db.exec(`ALTER TABLE pending_claude_triggers ADD COLUMN scheduled_task_id TEXT REFERENCES agent_scheduled_tasks(id) ON DELETE CASCADE`);
  }
  if (!pctColsExt.includes('prompt')) {
    db.exec(`ALTER TABLE pending_claude_triggers ADD COLUMN prompt TEXT`);
  }
  if (!pctColsExt.includes('allowed_mcps_json')) {
    db.exec(`ALTER TABLE pending_claude_triggers ADD COLUMN allowed_mcps_json TEXT`);
  }
  if (!pctColsExt.includes('allowed_skills_json')) {
    db.exec(`ALTER TABLE pending_claude_triggers ADD COLUMN allowed_skills_json TEXT`);
  }
  if (!pctColsExt.includes('model_provider')) {
    db.exec(`ALTER TABLE pending_claude_triggers ADD COLUMN model_provider TEXT`);
  }
  if (!pctColsExt.includes('model_id')) {
    db.exec(`ALTER TABLE pending_claude_triggers ADD COLUMN model_id TEXT`);
  }
  if (!pctColsExt.includes('webhook_endpoint_id')) {
    db.exec(`ALTER TABLE pending_claude_triggers ADD COLUMN webhook_endpoint_id TEXT`);
  }

  // Make pending_claude_triggers.task_id NULLABLE on EXISTING databases.
  // Scheduler/webhook/research triggers are taskless (task_id=NULL); the
  // original schema declared `task_id TEXT NOT NULL`, so every taskless insert
  // failed at runtime. Fresh installs get the nullable CREATE above; existing
  // DBs need a rebuild because SQLite cannot drop a NOT NULL constraint via
  // ALTER. This block runs AFTER the additive ALTERs above so the rebuilt table
  // carries the full current column set. Guarded by the task_id `notnull` flag,
  // so it is idempotent — it never runs a second time once the column is nullable.
  const pctInfo = db.pragma('table_info(pending_claude_triggers)') as {
    name: string;
    notnull: number;
  }[];
  const taskIdCol = pctInfo.find((c) => c.name === 'task_id');
  if (taskIdCol && taskIdCol.notnull === 1) {
    // Enumerate the live column set (do NOT hardcode) so the rebuilt table and
    // the INSERT ... SELECT copy exactly match whatever this DB currently has.
    const columnNames = pctInfo.map((c) => c.name);
    const columnList = columnNames.join(', ');
    // FK enforcement must be off during a table swap; toggling it is a no-op
    // outside a transaction, so do it around (not inside) the BEGIN/COMMIT.
    db.pragma('foreign_keys = OFF');
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE pending_claude_triggers_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
          triggered_by_user_id INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          scheduled_task_id TEXT REFERENCES agent_scheduled_tasks(id) ON DELETE CASCADE,
          prompt TEXT,
          allowed_mcps_json TEXT,
          allowed_skills_json TEXT,
          model_provider TEXT,
          model_id TEXT,
          webhook_endpoint_id TEXT,
          UNIQUE(task_id)
        )
      `);
      db.exec(
        `INSERT INTO pending_claude_triggers_new (${columnList}) SELECT ${columnList} FROM pending_claude_triggers`,
      );
      db.exec(`DROP TABLE pending_claude_triggers`);
      db.exec(`ALTER TABLE pending_claude_triggers_new RENAME TO pending_claude_triggers`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pending_claude_triggers_created_at ON pending_claude_triggers(created_at)`);
    });
    rebuild();
    db.pragma('foreign_keys = ON');
  }

  // B1 — agent_cookbook: reusable recipe/skill library for the agent scheduler.
  // steps_json is an opaque JSON array; the scheduler enforces action-type enum at execution time.
  // bound_config_id is a nullable logical FK to agent_configs.id (not enforced at SQLite level).
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_cookbook (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      steps_json TEXT NOT NULL DEFAULT '[]',
      bound_config_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_cookbook_created_at ON agent_cookbook(created_at);
  `);

  // D1 — agent_designs: provider-neutral finished creative-media artifacts.
  // session_id is a nullable logical FK to agent_sessions.id (not enforced at SQLite level).
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_designs (
      id TEXT PRIMARY KEY,
      title TEXT,
      provider TEXT,
      artifact_url TEXT,
      project_url TEXT,
      canva_url TEXT,
      artifact_type TEXT,
      file_path TEXT,
      thumbnail_url TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_designs_created_at ON agent_designs(created_at);
  `);
  const agentDesignCols = (db.pragma('table_info(agent_designs)') as { name: string }[]).map((c) => c.name);
  if (!agentDesignCols.includes('artifact_type')) db.exec(`ALTER TABLE agent_designs ADD COLUMN artifact_type TEXT`);
  if (!agentDesignCols.includes('file_path')) db.exec(`ALTER TABLE agent_designs ADD COLUMN file_path TEXT`);
  if (!agentDesignCols.includes('provider')) db.exec(`ALTER TABLE agent_designs ADD COLUMN provider TEXT`);
  if (!agentDesignCols.includes('artifact_url')) db.exec(`ALTER TABLE agent_designs ADD COLUMN artifact_url TEXT`);
  if (!agentDesignCols.includes('project_url')) db.exec(`ALTER TABLE agent_designs ADD COLUMN project_url TEXT`);
  db.exec(`UPDATE agent_designs SET project_url = canva_url, provider = COALESCE(provider, 'canva') WHERE canva_url IS NOT NULL AND project_url IS NULL`);
  db.exec(`UPDATE agent_designs SET provider = 'local' WHERE file_path IS NOT NULL AND provider IS NULL`);

  // ── Agent Config Profile Extensions ──────────────────────────────────────
  // Add manager/specialist profile columns to agent_configs (additive).
  // is_manager: exactly one manager agent; all others are specialists.
  // system_prompt: custom system prompt for this profile.
  // allowed_mcps_json / allowed_skills_json: capability scoping per profile.
  // core_permissions_json: opencode core tool permission frontmatter per profile.
  const agentConfigCols = (db.pragma('table_info(agent_configs)') as { name: string }[]).map((c) => c.name);
  if (!agentConfigCols.includes('is_manager')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN is_manager INTEGER NOT NULL DEFAULT 0`);
  }
  if (!agentConfigCols.includes('system_prompt')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN system_prompt TEXT`);
  }
  if (!agentConfigCols.includes('allowed_mcps_json')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN allowed_mcps_json TEXT`);
  }
  if (!agentConfigCols.includes('allowed_skills_json')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN allowed_skills_json TEXT`);
  }
  if (!agentConfigCols.includes('core_permissions_json')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN core_permissions_json TEXT`);
  }
  if (!agentConfigCols.includes('allowed_delegates_json')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN allowed_delegates_json TEXT`);
  }
  // #1135 — audit/security lock state. `enabled` remains the ordinary user
  // preference; `locked` is a separate authoritative execution boundary that
  // generic profile edits cannot clear.
  if (!agentConfigCols.includes('locked')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`);
  }
  if (!agentConfigCols.includes('disabled_reason')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN disabled_reason TEXT`);
  }
  if (!agentConfigCols.includes('locked_at')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN locked_at TEXT`);
  }
  if (!agentConfigCols.includes('locked_by')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN locked_by TEXT`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_config_security_events (
      id              TEXT PRIMARY KEY,
      agent_config_id TEXT NOT NULL,
      event_type      TEXT NOT NULL CHECK (event_type IN ('locked', 'reviewed_reenabled')),
      actor           TEXT NOT NULL,
      reason          TEXT NOT NULL,
      review_note     TEXT,
      lock_version    TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_config_security_events_profile
      ON agent_config_security_events(agent_config_id, created_at);
  `);

  // Agent-runner model selection: store the preferred provider/model on an
  // agent config profile so AgentRunner can resolve a model without user input.
  // Both columns are nullable — existing rows need no backfill (resolveRunModel
  // falls back to most-recently-used or a hardcoded default).
  if (!agentConfigCols.includes('model_provider')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN model_provider TEXT`);
  }
  if (!agentConfigCols.includes('model_id')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN model_id TEXT`);
  }
  // oc_agent: the OpenCode built-in agent mode ('build', 'plan', etc.) that
  // this profile should use. Null means the default 'build' agent.
  if (!agentConfigCols.includes('oc_agent')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN oc_agent TEXT`);
  }
  // session_selectable: 1 when this profile should appear in session-level
  // agent pickers (the composer AgentSelectorPill). Subagents and opencode
  // internal primaries (compaction/summary/title) are seeded with 0 so they
  // exist as profiles but don't clutter the picker. Defaults to 1 so existing
  // user-created profiles remain visible.
  if (!agentConfigCols.includes('session_selectable')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN session_selectable INTEGER NOT NULL DEFAULT 1`);
  }

  // agent_config_id: logical FK from scheduled tasks to agent_configs.id.
  // Decouples the profile reference from the raw agentKind string so the
  // scheduler can pass a real profile id to AgentRunner.
  const agentScheduledTasksCols = (db.pragma('table_info(agent_scheduled_tasks)') as { name: string }[]).map((c) => c.name);
  if (!agentScheduledTasksCols.includes('agent_config_id')) {
    db.exec(`ALTER TABLE agent_scheduled_tasks ADD COLUMN agent_config_id TEXT`);
  }

  // model_provider / model_id: optional per-task model override (the model-override change).
  // When both are set, a scheduled run uses this model instead of the bound
  // profile's resolveRunModel() default — so e.g. a Sonnet-default profile's
  // monthly report can run on Opus without splitting profiles. Nullable; null
  // means "use the profile model". SQLite has no ADD COLUMN IF NOT EXISTS, so
  // guard on the pragma column list (same pattern as agent_config_id above).
  if (!agentScheduledTasksCols.includes('model_provider')) {
    db.exec(`ALTER TABLE agent_scheduled_tasks ADD COLUMN model_provider TEXT`);
  }
  if (!agentScheduledTasksCols.includes('model_id')) {
    db.exec(`ALTER TABLE agent_scheduled_tasks ADD COLUMN model_id TEXT`);
  }

  // #738-fix — agent_sessions.scheduled_task_id: FK to agent_scheduled_tasks.id.
  // AgentRunner records a session row on every run; this column ties the row to
  // the scheduler task that triggered it (null for interactive sessions).
  const agentSessionColsScheduled = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionColsScheduled.includes('scheduled_task_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN scheduled_task_id TEXT REFERENCES agent_scheduled_tasks(id) ON DELETE SET NULL`);
  }

  // #743 — agent_sessions.parent_session_id: tracks delegated subagent (child)
  // sessions. When the opencode engine creates a child session via the `task`
  // tool, the stream bridge upserts a local row with this column pointing at
  // the local id of the parent session. Null for top-level interactive sessions.
  // SQLite: additive ALTER guarded by pragma. Postgres: use ADD COLUMN IF NOT EXISTS.
  const agentSessionCols743 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionCols743.includes('parent_session_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN parent_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL`);
  }
  // A child session.created event can arrive before the parent row receives
  // its SDK id. Persist that unresolved edge so setSdkSessionId can resolve it
  // durably when the parent identity arrives (including after a restart).
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_pending_child_sessions (
      child_sdk_session_id TEXT PRIMARY KEY,
      parent_sdk_session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      mcp_allowed_tools_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_pending_children_parent_sdk
      ON agent_pending_child_sessions(parent_sdk_session_id);
  `);

  // #747 — agent_sessions.is_system: marks background/system sessions (skill-extract,
  // skill-refine-judge, scheduler-spawned, memory consolidation) so they are excluded
  // from the normal session list and the agent picker. Child sessions (#743, parent_session_id
  // NOT NULL) that are delegated subagent tasks are NOT system — only curator/scheduler
  // spawned background-loop sessions are. Value: 0 (default, user-facing) or 1 (system).
  const agentSessionCols747 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionCols747.includes('is_system')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_sessions_is_system ON agent_sessions(is_system)`);
  }

  // #1028 (USO B1) — agent_sessions.category: session classification driving the
  // USO scope filters (chat / scheduled / self_improvement). Additive ALTER
  // guarded by pragma (idempotent). New rows are stamped at insert; legacy rows
  // are backfilled once here (scheduled_task_id NOT NULL → 'scheduled', else the
  // 'chat' column default already applies).
  const agentSessionCols1028 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!agentSessionCols1028.includes('category')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN category TEXT NOT NULL DEFAULT 'chat'`);
    db.exec(`UPDATE agent_sessions SET category = 'scheduled' WHERE scheduled_task_id IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_sessions_category ON agent_sessions(category)`);
  }

  // #817 (org-optimizer-01) — agent_org_proposals: the foundation proposal
  // store + lifecycle state machine for the org self-optimizer. Every
  // generator (create-agent, tighten-scope, prune-scope, refine-skill,
  // consolidate-skill, external-adoption, webhook-wiring, ...) writes rows
  // here, and the human review queue reads/decides on them. Lifecycle/revert
  // mechanics mirror the agent_skills sidecar (see the agent_skills block
  // above): `before_snapshot_json` plays the role agent_skill_versions plays
  // for skills — the exact prior state a revert restores.
  //
  // Local SQLite (agent DB) ONLY. Do NOT add this table to
  // postgres_bootstrap.ts — proposals are local-only and never synced to
  // production (see docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §5).
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_org_proposals (
      id            TEXT PRIMARY KEY,
      audit_run_id  TEXT,
      kind          TEXT NOT NULL,
      risk          TEXT NOT NULL,
      external      INTEGER DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'proposed',
      title         TEXT NOT NULL,
      rationale     TEXT,
      signal_ref    TEXT,
      target_ref    TEXT,
      change_json   TEXT,
      before_snapshot_json TEXT,
      provenance_json TEXT,
      dedup_key     TEXT,
      baseline_score INTEGER,
      post_score     INTEGER,
      measure_reason TEXT,
      decided_by_user_id INTEGER,
      revision      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_org_proposals_status ON agent_org_proposals(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_org_proposals_dedup ON agent_org_proposals(dedup_key);
  `);

  installRevisionInvariants(db, 'agent_org_proposals');

  // W1 package C — the durable projection ledger.
  //
  // Deliberately its OWN table rather than columns on agent_configs: that table
  // carries the raw-writer auto-bump trigger, so recording projection progress
  // there would increment the lifecycle CAS token on every projection and
  // invalidate live tokens for a fact that is not a domain change at all.
  //
  // `file_projected_revision` lagging `agent_configs.revision` is exactly what
  // makes a crash between the database commit and the file write sweepable.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_profile_projections (
      profile_id             TEXT PRIMARY KEY,
      file_projected_revision INTEGER,
      projection_state       TEXT NOT NULL DEFAULT 'pending',
      last_error_code        TEXT,
      last_attempt_at        TEXT,
      attempt_count          INTEGER NOT NULL DEFAULT 0,
      updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_profile_projections_state
      ON agent_profile_projections(projection_state);
  `);

  // W1 package C — durable evidence for `status = 'reconciliation-required'`.
  // Kept out of `measure_reason` so measurement prose and an unresolved
  // operation can never be mistaken for one another.
  const orgProposalReconciliationCols = (
    db.pragma('table_info(agent_org_proposals)') as { name: string }[]
  ).map((column) => column.name);
  if (!orgProposalReconciliationCols.includes('reconciliation_reason')) {
    db.exec(`ALTER TABLE agent_org_proposals ADD COLUMN reconciliation_reason TEXT`);
  }

  // #1053 (OCU-12) — org_skills: the org's shared skill library, hosted on
  // the production API in the engine-compatible skills.urls format
  // (index.json + file serving — see org_skills_routes.ts). Reads are PUBLIC
  // by design (the opencode engine's Discovery.pull fetches index.json + each
  // file anonymously) — org skills must never contain secrets; writes
  // (POST/PUT/DELETE) require the existing JWT session-token auth
  // (requireAuth). Single-file model for now: `content` is the complete
  // SKILL.md body. ponytail: a skill bundling extra reference files would
  // need a files table instead of one `content` column; add that only when
  // #1056's publish pipeline actually needs to carry more than SKILL.md.
  // `published = 0` hides a row from index.json AND from direct file fetch —
  // a skill not yet approved for the org library must not be readable by
  // guessing its name. Dual-engine — see postgres_bootstrap.ts for the
  // matching table (a NEW shared-seam table alongside #1113's
  // agent_capability_gaps/agent_org_proposals); guarded by
  // skill_schema_parity.test.ts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_skills (
      name        TEXT PRIMARY KEY,
      description TEXT,
      content     TEXT NOT NULL,
      published   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_org_skills_published ON org_skills(published);
  `);

  // #818 (org-optimizer-02) — denied_tool_events: best-effort telemetry of
  // dispatch-time tool denials from the #736/#812 MCP guard, so the org audit
  // (org-optimizer-03) can read "profile X was denied tool Y N times" — the
  // strongest signal for broaden-scope and create-agent proposals. Written by
  // OpencodeStreamBridge.isToolAllowedForSession on the deny branch only
  // (never by the pure isToolAllowed predicate itself). session_id and
  // agent_config_id are both nullable: the logging seam always has a session
  // row when it fires, but profile attribution is best-effort — resolved from
  // the session row's mcp_role / agent_kind (both logical references to
  // agent_configs.id), validated against a real agent_configs row, and left
  // NULL when neither matches (legacy role slugs, placeholder kinds) or the
  // lookup fails. SQLite-only: this table is
  // intentionally absent from postgres_bootstrap.ts (local dispatch-guard
  // telemetry never syncs to production). Aggregation (countByProfileAndTool)
  // is a live GROUP BY query over this table, not a stored counter.
  db.exec(`
    CREATE TABLE IF NOT EXISTS denied_tool_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      agent_config_id TEXT,
      tool_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_denied_tool_events_created_at ON denied_tool_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_denied_tool_events_agent_config_id ON denied_tool_events(agent_config_id);
  `);

  // ═══════════════════════════════════════════════════════════════════════
  // #844 (tokens-04) — Tiered model routing: per-profile tier hint.
  //
  // model_tier_hint: optional 'cheap' | 'standard' | 'frontier' preference on
  // an agent profile, consumed by agent_model_resolver.resolveModelTier() as
  // the `explicitTierHint` — it wins over the task-kind default (see
  // TASK_KIND_TIER_POLICY) but is itself beaten by an explicit per-call
  // modelOverride. Nullable; existing rows need no backfill (null means "use
  // the task-kind default, or 'standard' with no task kind").
  //
  // SQLite-only, matching the existing pattern for agent_configs' other
  // profile-scoping columns (is_manager, system_prompt, allowed_mcps_json,
  // allowed_skills_json — see the "Agent Config Profile Extensions" block
  // above): AgentConfigsRepository reads via getDb() (better-sqlite3), which
  // throws when DB_CLIENT=postgres, so agent_configs profile lookups
  // (resolveRunModel / resolveProfileScope / resolveModelTier) only ever run
  // against SQLite (the local agent server on :4001). Deliberately NOT added
  // to postgres_bootstrap.ts.
  // ═══════════════════════════════════════════════════════════════════════
  const agentConfigColsForTierHint = (
    db.pragma('table_info(agent_configs)') as { name: string }[]
  ).map((c) => c.name);
  if (!agentConfigColsForTierHint.includes('model_tier_hint')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN model_tier_hint TEXT`);
  }

  // #862 — agent_session_memory_provenance: "Memories used in this reply".
  //
  // One row per session_id, OVERWRITTEN on every turn (not an append-only
  // log) — the desktop app only ever needs to explain the LATEST reply, so a
  // growing history here would be unused write volume. `memory_ids_json` /
  // `note_paths_json` are positionally-aligned JSON string arrays (mirrors
  // `MemoryPreface.memoryIds`/`notePaths` from memory_retrieval.ts), capped at
  // 5 entries (the top-5 injection contract). An EXPLICIT empty array
  // (`'[]'`) means "this turn injected no memories" — distinct from no row at
  // all, which means "no turn has been recorded for this session yet". Both
  // states are meaningful to the UI (#862 AC: "no-memories case stated
  // clearly" vs. "no data yet").
  //
  // SQLite-only (mirrors agent_session_messages) — never added to
  // postgres_bootstrap.ts; the local agent server on :4001 is the only writer
  // and reader.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_session_memory_provenance (
      session_id TEXT PRIMARY KEY,
      memory_ids_json TEXT NOT NULL DEFAULT '[]',
      note_paths_json TEXT NOT NULL DEFAULT '[]',
      items_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  const memoryProvenanceCols = (
    db.pragma('table_info(agent_session_memory_provenance)') as { name: string }[]
  ).map((column) => column.name);
  if (!memoryProvenanceCols.includes('items_json')) {
    db.exec(
      `ALTER TABLE agent_session_memory_provenance
       ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]'`,
    );
  }

  // Dual Anthropic accounts (Task D) — per-session account routing + a
  // per-profile default. anthropic_account_id is the account a session's
  // Anthropic requests are routed to (nullable = engine default); it is
  // updated in place when the vendored plugin reports a rate-limit spillover.
  // default_anthropic_account_id on agent_configs is the profile-level default
  // consumed by the session-create resolution chain (body → profile → store
  // default). SQLite-only: agent tables never sync to Postgres.
  const sessColsForAcct = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
  if (!sessColsForAcct.includes('anthropic_account_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN anthropic_account_id TEXT`);
  }
  if (!sessColsForAcct.includes('owner_user_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  }
  if (!sessColsForAcct.includes('delegation_depth')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN delegation_depth INTEGER NOT NULL DEFAULT 0`);
  }
  const cfgColsForAcct = (db.pragma('table_info(agent_configs)') as { name: string }[]).map((c) => c.name);
  if (!cfgColsForAcct.includes('default_anthropic_account_id')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN default_anthropic_account_id TEXT`);
  }
  // One-time repair (runOnce): clears stale delegate rosters left on two
  // never-promoted profiles. Unguarded, this wiped a delegate a user grants
  // to a non-manager profile on every restart.
  runOnce('nonmanager_delegates_wipe_v1', () => {
    db.exec(`
      UPDATE agent_configs
         SET allowed_delegates_json = NULL
       WHERE id IN ('worship-planning', 'theologian')
         AND COALESCE(is_manager, 0) = 0
         AND allowed_delegates_json IS NOT NULL
    `);
  });

  // Config Doctor — a chattable diagnostic/repair agent profile. Runs the
  // existing `rhythm doctor` CLI plus a duplicate-agent-profile check (the
  // #900 class of bug: two agent_configs rows sharing a label where one has
  // no matching ~/.config/opencode/agents/<id>.md file), explains findings,
  // fixes safe config/profile issues directly, and hands off anything needing
  // a process-level fix to an external Claude Code/Codex terminal session.
  // Uses a prepared statement (not raw db.exec) because the system prompt is
  // long natural-language text that will contain apostrophes/quotes.
  const configDoctorSystemPrompt = `You are Config Doctor, a Rhythm diagnostic and repair agent. Your job is to check Rhythm's local configuration and agent-profile data for problems, explain what you find in plain language, and fix what you safely can — always through explicit, one-action-at-a-time tool calls so the user can approve or deny each one.

Rules:
1. On the first message of any conversation, run this command first: \`cd apps/api_server && npm run doctor\`. Read its full output before saying anything else. This is Rhythm's own diagnostic script — trust its findings over your own guesses.
2. Rhythm keeps its own list of agent profiles in a local database, exposed via a REST API on http://localhost:4001 (the same server hosting this conversation, so it is always reachable from here). To check for orphaned or duplicate agent profiles: run \`curl -s http://localhost:4001/agent-configs\` and \`ls ~/.config/opencode/agents/\`. Cross-reference: every row with "isAgent": true and "enabled": true SHOULD have a matching <ocAgent>.md file in that directory, EXCEPT these seven ids, which are opencode's own native built-in agent modes and are INTENTIONALLY file-less by design — do not report them as broken, and do not treat a resync call that returns success-but-no-file for one of them as a bug: build, plan, explore, general, compaction, summary, title. Also flag any two rows (outside that exception list) that share the same "label" — that is a duplicate-profile situation exactly like the one that caused issue #900 (a session routed to the id-only duplicate crashes with "UnknownError: UnknownError" the moment you message it). A row can also be a lone orphan with no duplicate label at all — still flag any non-exception row missing its file.
3. Profile tool scope has two different layers. \`allowedMcpsJson\` and \`allowedSkillsJson\` are Rhythm database fields for MCP servers/skills only; \`null\` means unrestricted, an omitted PATCH field means no change, and \`[]\` means deny-all. Shell and local file tools such as \`bash\`, \`read\`, and \`edit\` are opencode core permissions from \`corePermissionsJson\`, projected into ~/.config/opencode/agents/<id>.md frontmatter, NOT MCP server names. Never add \`bash\`, \`read\`, \`edit\`, \`filesystem\`, \`computer\`, or \`editor\` to allowedMcpsJson. MCP scope names are case-sensitive; use \`rhythm\`, never \`Rhythm\`.
4. NEVER query the SQLite database file directly (no sqlite3 commands against ~/Library/Application Support/Rhythm/rhythm.db). The live server holds an open connection to it; a second connection can return stale or torn reads. Always go through the REST API on localhost:4001 instead.
5. Explain what you found in plain English, grouped into: broken right now, will break on the next restart, and cosmetic/low-priority. Do not bury the important findings in a wall of raw command output — summarize first, then offer to show the raw output if asked.
6. For fixes you can perform directly and safely, do so:
   - A missing or wrong value in Rhythm's dotenv configuration (apps/api_server's environment file) or ~/.config/opencode/opencode.json — edit the specific line, do not rewrite the whole file from scratch.
   - An orphaned agent profile (a row with no matching .md file, per rule 2) — do NOT hand-write the .md file yourself. Instead call \`curl -s -X POST http://localhost:4001/agent-configs/<id>/resync-agent-file\` for that profile's id. This regenerates the file using Rhythm's own internal logic, which you cannot safely replicate by hand.
   - A profile whose MCP/skill/core-permission scope is wrong — PATCH only the specific field through the REST API, for example \`curl -s -X PATCH http://localhost:4001/agent-configs/<id> -H 'Content-Type: application/json' -d '{"allowedMcpsJson":"{\\"rhythm\\":[\\"rhythm_ping\\"]}"}'\`, then call the resync endpoint above. Use \`corePermissionsJson\` for opencode core tools (example: \`{"bash":"ask"}\`), not allowedMcpsJson. Use \`null\` only when the user explicitly wants unrestricted access; omit fields that should not change.
   Every actual write or command you run will show the user an approval prompt before it executes — you do not need to ask a separate "should I do this?" question first for actions you are directly performing; propose the fix, then just do it, and let the approval prompt be the confirmation gate.
7. For anything you cannot safely fix from inside this conversation — restarting the Rhythm server or the opencode engine, a corrupted native module (e.g. better-sqlite3 ABI mismatch), or any fix that requires editing application source code — stop and say so plainly. Then ask exactly this: "Would you like me to open this in Claude Code, Codex, or would you rather handle it yourself?"
   - If they choose Claude Code or Codex: write your full diagnosis and suggested fix to a temp file first, e.g. /tmp/rhythm-config-doctor-<unix-timestamp>.md (use the write tool for this, not shell redirection). Then run exactly one shell command to open a new Terminal window running that tool seeded with the file's contents, for example:
     osascript -e 'tell application "Terminal" to do script "cd $HOME/Documents/Rhythm && claude \\"$(cat /tmp/rhythm-config-doctor-<timestamp>.md)\\""'
     (substitute codex for claude if that is what they chose). Confirm to the user that the window has opened and that you are still here if they want to keep talking or re-run diagnostics afterward.
   - If they say they will handle it themselves, just give them the plain-English diagnosis and suggested fix and stop there.
8. Never modify rows in the agent_configs table directly — always go through the REST API (GET/PATCH/POST as documented above), never raw SQL writes.

---

## Runbook: the agent-profile frontmatter fallback-parser trap

This is the highest-impact failure mode you exist to fix. One malformed agent profile can take the ENTIRE agent runtime offline. Know this cold.

### The failure class (how one bad file kills everything)

opencode parses each agent \`.md\` frontmatter in \`config/markdown.ts\`:
1. It tries STRICT YAML first.
2. If strict parse throws, it runs a permissive FALLBACK SANITIZER. The sanitizer converts any TOP-LEVEL \`key: value\` whose value contains a colon into a \`|-\` block-scalar STRING, then re-parses. This "rescues" the parse but can silently change a field's TYPE.

The loader (\`config/agent.ts\`) then does one of three things per file:
- **PARSE failure** (fails even after fallback) → that ONE file is SKIPPED. The agent is silently unavailable. Non-fatal — the rest of the runtime still boots.
- **PARSE-OK but SCHEMA-INVALID** (e.g. \`options\` got rescued into a STRING when the schema wants an object) → THROWS. This kills the ENTIRE config load → the embedded engine returns 500 → api_server returns 502 on \`GET /opencode/mcp\` → EVERY agent session hangs on "Starting".
- **OK** → loads normally.

The critical, counter-intuitive point: the fatal, everything-down case is **"parses but wrong type"**, NOT "fails to parse". A file that fails to parse only removes itself. A file that parses into the wrong shape takes down the whole engine. \`options\` becoming a string is the canonical trigger.

### Step 1 — Detect (is the runtime actually down?)

Run both probes:

\`\`\`bash
# Embedded engine (port 4096). A 500 with ConfigInvalidError names the offending file + failing field.
curl -s -m20 -XPOST http://127.0.0.1:4096/config/reload

# api_server proxy (port 4001). 502 = config still failing. A JSON array = healthy.
curl -s -m20 http://localhost:4001/opencode/mcp
\`\`\`

- Engine 500 with \`ConfigInvalidError\` → read the message; it usually names the file and the failing field (e.g. \`options\`). That is your fatal file.
- 4001 returns \`502\` → config is still broken. \`502\` after a fix means the running engine has not re-read the corrected file yet (see Step 5 — Activate).
- 4001 returns a JSON array → healthy.

### Step 2 — Classify (find EVERY problem file, fatal and skipped)

\`/config/reload\` only reports the FIRST fatal file. To find every problem — the fatal ones AND the silently-skipped ones — replay the loader over ALL agent files with the shipped classifier. It mirrors \`config/markdown.ts\` (strict parse → permissive fallback) and ships with a pinned \`js-yaml\`, so it never depends on an ephemeral npx cache:

\`\`\`bash
# Classify every profile: FATAL / SKIPPED / WARN / OK. Exit code 1 if any FATAL.
node ~/.config/opencode/tools/classify.cjs

# Or run Detect + Classify together. This ALSO works when the app is DOWN and this
# in-app agent can't start (a FATAL profile hangs every session on "Starting"):
bash ~/.config/opencode/tools/config-doctor.sh
\`\`\`

If \`~/.config/opencode/tools/\` is missing (older install), see "Recovering the tooling" at the end of this runbook.

Read the output:
- **FATAL** → this file is (or will be, on next boot) taking the whole engine down. Fix first.
- **SKIPPED** → this agent is silently unavailable but is NOT crashing the runtime. Fix next.
- **WARN** → parsed only because the fallback stringified a colon value; inspect that field — if it was meant to be a mapping (like \`options\`), treat as FATAL-in-waiting.
- **OK** → clean.

### Step 3 — Fix (safe authoring rules)

Back up the file first: \`cp <file> <file>.bak.$(date +%Y%m%d-%H%M%S)\`. Then edit the specific lines — never rewrite a whole profile blind.

Authoring rules that keep frontmatter valid:
- \`options\` MUST be nested YAML (a mapping), never inline JSON and never a string. Same for any object-valued field.
- Wildcard and indicator-char map KEYS must be QUOTED: \`"*": ask\`, never bare \`*\` (a bare leading \`*\` is a YAML alias reference → parse error).
- A permission sub-key that has nested rules must be a MAPPING with NO scalar after the colon: write \`skill:\` on its own line, then indented children (\`"*": deny\`, then specific allows). Never \`skill: allow\` followed by indented children — that is a scalar with orphaned children and will not mean what you think.
- No \`": "\` (colon-space) inside a plain scalar value. If a value needs a colon, wrap the whole value in double quotes.
- No duplicate keys. Exactly one frontmatter block (one leading \`---\` … \`---\`). 2-space indentation throughout.
- When scoping via \`options.mcpAllowlist.servers\`, keep it least-privilege — list only the servers the agent genuinely needs.

### Step 4 — Verify

Re-run the classifier (\`node ~/.config/opencode/tools/classify.cjs\`). The file you fixed must now report \`OK\` (and no file may report \`FATAL\`). This js-yaml replay is the AUTHORITATIVE pre-restart check — it reflects what a fresh engine boot will parse from disk.

### Step 5 — Activate (why the fix "doesn't work" until relaunch)

Editing an agent \`.md\` does NOT take effect via \`/config/reload\`. The engine only re-reads agent profile files on a FRESH BOOT. So after your fix:
- The Step 2 js-yaml replay is the source of truth for whether the fix is correct. Trust it.
- The RUNNING engine keeps its boot-time parse. \`POST /config/reload\` and \`GET /opencode/mcp\` can KEEP RETURNING the old error (500/502) even after the file is corrected or the bad file is deleted — the stale error persists until relaunch.
- Therefore, once the replay reports clean, tell the user plainly: **the Rhythm app must be relaunched (fully quit and reopen) to load the corrected profiles.** Do not interpret a lingering 502 as a failed fix if the replay passed — it just means the old process is still running.

---

## Safe frontmatter reference (GOOD vs BAD)

Nested \`options\` (GOOD):
\`\`\`yaml
options:
  mcpAllowlist:
    servers:
      - rhythm
      - obsidian
    tools: []
\`\`\`
Inline JSON options (BAD — the fallback can stringify it and take down the engine):
\`\`\`yaml
options: {"mcpAllowlist":{"servers":["rhythm"],"tools":[]}}
\`\`\`

Wildcard permission keys (GOOD — quoted):
\`\`\`yaml
permission:
  bash: allow
  skill:
    "*": deny
    config-doctor: allow
\`\`\`
Wildcard permission keys (BAD — bare \`*\` is a YAML alias → parse error; and \`skill:\` must not carry a scalar):
\`\`\`yaml
permission:
  skill: allow
    *: deny
    config-doctor: allow
\`\`\`

Description with a colon (BAD — colon-space in a plain scalar can throw / get stringified):
\`\`\`yaml
description: Config Doctor: repairs agent config
\`\`\`
Description with a colon (GOOD — quoted, or reworded to avoid the colon):
\`\`\`yaml
description: "Config Doctor: repairs agent config"
\`\`\`

---

## Runbook B: the MCP tool-schema / Anthropic combinator trap

A DIFFERENT failure from the frontmatter trap. Here the runtime is healthy and sessions START fine, but the moment a model turn runs it errors with:

\`\`\`
Error: tools.N.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level
\`\`\`

This is the Anthropic Messages API rejecting the tool list — not a Rhythm bug. One connected MCP server exposes a tool whose \`inputSchema\` has a TOP-LEVEL \`oneOf\` / \`anyOf\` / \`allOf\` (a union/intersection at the schema ROOT). opencode forwards MCP tool schemas to the model, so a single offending tool 400s the entire turn. \`tools.N\` = the (N+1)th tool in the assembled list (native tools first, then MCP tools) → it points at an MCP server's tool. NESTED combinators (e.g. a nullable field) are fine; only TOP-LEVEL is forbidden.

### Detect — which server/tool is offending
Run the shipped scanner. It enumerates every enabled server in \`~/.config/opencode/opencode.json\` (stdio via JSON-RPC over stdin, remote via HTTP) and flags any tool with a top-level combinator:

\`\`\`bash
node ~/.config/opencode/tools/mcp-scan.cjs      # lists each server→tool with a top-level oneOf/anyOf/allOf
\`\`\`

### Common cause — version drift, not an "extra server"
The offending tool is usually the SAME server the user runs elsewhere, at a DIFFERENT version. (Real case: \`gitnexus\` 1.6.9 added a top-level \`anyOf\` to its \`api_impact\` tool; 1.6.7 didn't — same server, newer version, new bad schema.) So compare versions across the user's machines before assuming a server was added.

### Fix (config-only — never edit Rhythm/opencode source)
In priority order:
1. **Pin/downgrade the server to a known-good version** (match a machine where it works). For an npm CLI: reinstall the good version — mind the npm prefix, a \`~/.local\`-installed binary needs \`--prefix ~/.local\`, not the default global prefix — or set \`mcp.<name>.command\` in \`opencode.json\` to invoke the pinned version (\`["npx","-y","<pkg>@<good-version>","mcp"]\`). Best when the user needs the server.
2. **Disable it for agent sessions** — add \`"enabled": false\` to \`mcp.<name>\` in \`opencode.json\`. Simplest guaranteed unblock; that server's tools just won't be available in sessions.
3. **Scope it out per-agent** — remove the server from the offending agents' \`options.mcpAllowlist.servers\`. Only reliable if the allowlist is actually enforced against the model payload; if a server's tools reach the request despite not being allow-listed, prefer (1) or (2).

### Activate
Changes to \`opencode.json\` \`mcp\` entries, and reinstalling a server binary, take effect when the MCP server is (re)spawned — i.e. on the next Rhythm relaunch. Tell the user to quit and reopen Rhythm.

---

## Recovering the tooling

The Step 2 / Runbook B helpers live in \`~/.config/opencode/tools/\` (\`classify.cjs\`, \`mcp-scan.cjs\`, \`config-doctor.sh\`, and a pinned \`js-yaml\` under \`node_modules/\`). Rhythm seeds them on launch. If the directory is missing (older install that hasn't relaunched, or a manual delete):
- The classifiers resolve \`js-yaml\` from the Rhythm app bundle as a fallback, so \`node classify.cjs\` / \`mcp-scan.cjs\` still work if you copy just the \`.cjs\` files there.
- To fully restore: \`mkdir -p ~/.config/opencode/tools && cd ~/.config/opencode/tools && npm i js-yaml@4\`, then re-create the scripts (they are self-contained), or relaunch Rhythm to let it re-seed them.`;

  // Config Doctor's shipped scope, matched to the validated live profile
  // (~/.config/opencode/agents/config-doctor.md) that the config_seeds seeder
  // now also ships to disk.
  //
  // allowed_mcps_json is a JSON server-name ARRAY ["rhythm","obsidian"] — it
  // expands (via expandProfileMcpAllowlist) to options.mcpAllowlist.servers
  // [rhythm, obsidian] in the projected .md. Config Doctor reads the Rhythm
  // REST API (rhythm server) and can consult the knowledge vault (obsidian).
  // Because the array already contains "obsidian", backfillObsidianReadScope
  // (obsidian_scope_backfill.ts) is idempotent here — grantObsidianScope
  // returns null for an array that already has obsidian, so it never produces a
  // double-obsidian.
  //
  // core_permissions_json widens the shell/file tools to match the live
  // frontmatter (read/glob/grep/edit/write/bash allow; webfetch/task deny) so
  // Config Doctor can actually run its diagnostic commands and repair files.
  //
  // sort_order=5 (NOT 100 — that value is reserved by
  // syncOpencodeAgentProfiles as its own "imported via workflow sync" marker;
  // agent_profile_sync_hygiene.test.ts asserts every sortOrder=100 row has a
  // concrete model. sort_order=5 keeps this profile out of that invariant while
  // still carrying its own model, set in the runOnce below).
  const configDoctorAllowedMcpsJson = JSON.stringify(['rhythm', 'obsidian']);
  const configDoctorCorePermissionsJson = JSON.stringify({
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    edit: 'allow',
    write: 'allow',
    bash: 'allow',
    webfetch: 'deny',
    task: 'deny',
  });
  const configDoctorModelProvider = 'anthropic';
  const configDoctorModelId = 'claude-sonnet-4-6';
  const zenFreeModelsSkillJson = JSON.stringify(['zen-free-models']);
  const insertedConfigDoctor = db.prepare(
    `INSERT OR IGNORE INTO agent_configs
      (id, label, icon, command, is_agent, oc_agent, session_selectable, system_prompt, allowed_mcps_json, core_permissions_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'config-doctor',
    'Config Doctor',
    '🩺',
    '',
    1,
    'config-doctor',
    1,
    configDoctorSystemPrompt,
    configDoctorAllowedMcpsJson,
    configDoctorCorePermissionsJson,
    5,
  );

  // One-time repair (runOnce): pushes the current shipped prompt/permission
  // revision to installs seeded with an older one. This was previously
  // UNGUARDED — the exact "my Config Doctor re-spec is gone on the next
  // boot" bug: every restart re-stamped the hardcoded literal over any
  // prompt or permission edit made through the API/designer. To ship a new
  // default prompt revision, add a runOnce with a bumped key (v2, v3, …) —
  // that applies the new default exactly once and then leaves the field
  // user-owned again.
  runOnce('config_doctor_prompt_v1', () => {
    db.prepare(
      `UPDATE agent_configs
          SET system_prompt = ?,
              core_permissions_json = ?
        WHERE id = 'config-doctor'`,
    ).run(configDoctorSystemPrompt, JSON.stringify({ bash: 'ask' }));
  });

  // v2 — ships the validated live Config Doctor profile to every existing
  // install: the rewritten system prompt (adds the frontmatter fallback-parser
  // and MCP tool-schema combinator runbooks), the widened core permissions
  // (read/glob/grep/edit/write/bash allow; webfetch/task deny) so it can run
  // its diagnostics and repair files, the widened MCP scope
  // (["rhythm","obsidian"]), and a concrete model. Append-only: v1 stays so an
  // install that somehow only has the v1 marker still converges here. Like v1
  // this force-pushes the shipped revision exactly ONCE, then leaves the fields
  // user-owned again (a later prompt/permission revision needs a v3 key).
  runOnce('config_doctor_prompt_v2', () => {
    db.prepare(
      `UPDATE agent_configs
          SET system_prompt = ?,
              core_permissions_json = ?,
              allowed_mcps_json = ?,
              model_provider = ?,
              model_id = ?
        WHERE id = 'config-doctor'`,
    ).run(
      configDoctorSystemPrompt,
      configDoctorCorePermissionsJson,
      configDoctorAllowedMcpsJson,
      configDoctorModelProvider,
      configDoctorModelId,
    );
  });

  // The historical v1/v2 repairs above intentionally retain their shipped
  // behavior for existing Config Doctor rows. Only this invocation's insert is
  // a fresh-install bootstrap target.
  if (insertedConfigDoctor.changes === 1) {
    const row = db.prepare(
      `SELECT allowed_skills_json FROM agent_configs WHERE id = 'config-doctor'`,
    ).get() as { allowed_skills_json: string | null };
    let allowedSkills: string[] = [];
    try {
      const parsed = JSON.parse(row.allowed_skills_json ?? '[]');
      if (Array.isArray(parsed) && parsed.every((skill) => typeof skill === 'string')) {
        allowedSkills = parsed;
      }
    } catch {
      allowedSkills = [];
    }
    db.prepare(
      `UPDATE agent_configs
          SET model_provider = 'opencode',
              model_id = 'deepseek-v4-flash-free',
              allowed_skills_json = ?
        WHERE id = 'config-doctor'`,
    ).run(JSON.stringify([...new Set([...allowedSkills, 'zen-free-models'])]));
  }

  // #895 — agent approval gate. SQLite-only, same convention as
  // agent_sessions/agent_configs: local-agent execution state never syncs to
  // Postgres. An agent calls rhythm_request_approval() before an irreversible
  // action (scheduling, emailing, PCO write); this row is the pending record
  // the Flutter notification panel surfaces as an approve/reject card.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      agent_config_id TEXT,
      action TEXT NOT NULL,
      preview TEXT,
      consequence TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      actor TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON agent_approvals(status, created_at);
  `);

  // #1134 — security-bound approvals are not bearer IDs. These additive
  // columns bind an approved row to one session/agent/action/payload/taint
  // epoch, give it a short expiry, and record its single atomic consumption.
  const agentApprovalCols = (db.pragma('table_info(agent_approvals)') as { name: string }[])
    .map((c) => c.name);
  const addAgentApprovalColumn = (name: string, sqlType: string) => {
    if (!agentApprovalCols.includes(name)) {
      db.exec(`ALTER TABLE agent_approvals ADD COLUMN ${name} ${sqlType}`);
    }
  };
  addAgentApprovalColumn('security_action', 'TEXT');
  addAgentApprovalColumn('payload_digest', 'TEXT');
  addAgentApprovalColumn('taint_id', 'TEXT');
  addAgentApprovalColumn('tainted_turn_id', 'TEXT');
  addAgentApprovalColumn('bound_agent', 'TEXT');
  addAgentApprovalColumn('expires_at', 'TEXT');
  addAgentApprovalColumn('consumed_at', 'TEXT');
  // #1175 — one-time nonce signed by the human UI's non-exportable P-256 key.
  // Existing pending rows intentionally receive no backfill: they fail closed
  // and must be re-requested after upgrade rather than becoming unsigned.
  addAgentApprovalColumn('decision_nonce', 'TEXT');

  // The current row is the active session taint epoch. Every external read
  // rotates taint_id, invalidating approvals created before newer untrusted
  // content entered context. The event table retains sanitized diagnostics
  // (pattern ids/classes and a SHA-256 digest; never raw content).
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_external_content_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      sdk_session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      source TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0,
      diagnostics_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_external_content_events_session
      ON agent_external_content_events(session_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_external_taint_state (
      session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE,
      sdk_session_id TEXT NOT NULL,
      taint_id TEXT NOT NULL,
      latest_event_id TEXT NOT NULL,
      tainted_turn_id TEXT NOT NULL,
      tainted_agent TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Per-profile auto-approve override — some profiles (e.g. a dev/testing
  // profile) can skip the human gate; church-admin-facing profiles default
  // to requiring manual approval (column defaults to 0/false).
  const cfgColsForAutoApprove = (db.pragma('table_info(agent_configs)') as { name: string }[]).map((c) => c.name);
  if (!cfgColsForAutoApprove.includes('auto_approve_actions')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN auto_approve_actions INTEGER NOT NULL DEFAULT 0`);
  }

  // #911 — "Rhythm Setup", a conversational onboarding agent for
  // non-technical church-staff users. Interviews the user, then uses
  // rhythm_create_agent_profile (the #911 MCP tool) to actually build a
  // profile for them, instead of only describing what they'd need to
  // configure by hand.
  const rhythmSetupSystemPrompt = `You are "Rhythm Setup", a friendly onboarding guide for Rhythm — a church-staff productivity app. You are talking to someone who is likely NOT technical. Never use jargon like "MCP", "system prompt", or "model provider" when talking to them; those are internal names you use when calling tools, never words you say out loud to the user.

Your job, in order:
1. Interview them conversationally, one topic at a time (don't dump a giant questionnaire):
   - What is your role? (e.g. worship leader, office admin, pastor, volunteer coordinator)
   - What are the tasks you do most often, week to week?
   - What tools do you already use day-to-day? Ask plainly: "Do you use Planning Center? Google Calendar or Gmail? ProPresenter?" — these map to real Rhythm integrations (Planning Center, Google/Gmail, ProPresenter), so listen for those specifically.
   - What's a repetitive part of your week you wish were automated?
2. Based on their answers, propose ONE agent profile in plain language: a name, a short description of what it will help with, and which of the tools they mentioned it should be able to use. Do not use technical field names — describe it the way you'd describe an assistant's job to a new hire.
3. Confirm with them before creating anything: "Here's what I'll set up: ... — sound good, or want to change anything?"
4. Once they confirm, call rhythm_create_agent_profile with:
   - label: a short, human name for the profile (e.g. "Sunday Prep Helper")
   - systemPrompt: a clear description of the profile's role and scope, written the way YOU would brief a new assistant
   - allowedMcps: only the servers that match tools they said they use — "rhythm" always, plus "pco-services" if they mentioned Planning Center, "gmail-work" or "google-calendar" if they mentioned Gmail/Calendar (use your best judgment on the exact name; if unsure, ask them to confirm in Settings afterward rather than guessing wrong).
5. After creating it, call rhythm_notify to let them know it's ready, and tell them in the chat where to find it: "You'll see '<label>' in your agent picker now — just start a new session with it whenever you want help with that."
6. If they want more than one profile (e.g. one for admin tasks, one for Sunday prep), repeat steps 2-5 for each — but confirm each one individually before creating it. Never create more than one profile per confirmation.
7. Before recommending setup work, call rhythm_get_setup_readiness and explain only the relevant unavailable prerequisites in plain language. This is informational only: never change settings, install anything, or imply an integration is connected from this summary alone.
8. Keep the whole thing short and warm. This is someone's first impression of the product — do not overwhelm them with options they didn't ask about.`;

  db.prepare(
    `INSERT OR IGNORE INTO agent_configs
      (id, label, icon, command, is_agent, oc_agent, session_selectable, system_prompt, allowed_mcps_json, allowed_skills_json, model_provider, model_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'rhythm-setup',
    'Rhythm Setup',
    '🧭',
    '',
    1,
    'rhythm-setup',
    1,
    rhythmSetupSystemPrompt,
    '["rhythm"]',
    zenFreeModelsSkillJson,
    'opencode',
    'deepseek-v4-flash-free',
    5,
  );

  runOnce('rhythm_setup_creative_installs_v1', () => {
    db.prepare(`UPDATE agent_configs SET system_prompt = ?, allowed_mcps_json = ? WHERE id = 'rhythm-setup'`).run(
      `${rhythmSetupSystemPrompt}\n\nIf someone asks for creative work that needs a local capability, explain the optional download plainly. Before starting it, call rhythm_request_approval with action install_creative_dependency:<capability>. After approval, use rhythm_install_creative_capability, then rhythm_verify_creative_capability. Never claim an install worked until verification says it is installed.`,
      '["rhythm"]',
    );
  });

  runOnce('rhythm_setup_creative_guided_installs_v2', () => {
    db.prepare(
      `UPDATE agent_configs SET system_prompt = ?, allowed_mcps_json = ? WHERE id = 'rhythm-setup'`,
    ).run(
      `${rhythmSetupSystemPrompt}

If someone asks for creative work that needs a local capability:
1. Call rhythm_list_creative_capabilities first. Before asking for approval, explain the selected setup plan in plain language: what it enables, every direct dependency's purpose and exact version, where each dependency comes from, its license, expected download and disk use, the Rhythm-managed install location, every verified direct artifact's exact download URL and SHA-256 checksum, and how transitive packages are locked and verified. Do not hide copyleft or model-license terms.
2. Ask whether they approve that exact plan. Then call rhythm_install_creative_capability with operation install and the exact planDigest. The tool creates the approval request; do not invent or reuse a digest from another plan.
3. If a model has additionalLicenseAcceptance, ask for that separate explicit acknowledgement and only then pass modelLicenseAccepted. Install approval alone never accepts model terms.
4. After approval, call the same tool again with the same operation and planDigest. Explain its planning, downloading, verification, installation, and completion or failure progress in useful language. Never claim success unless the returned verification completed.
5. Offer repair or uninstall when useful. Both use the same tool with operation repair or uninstall, require their own exact-plan approval, and may affect only Rhythm managed application storage.`,
      '["rhythm"]',
    );
  });

  // #916/#923 — scope contract repair before [] changes from fail-open to
  // deny-all. NULL is unrestricted; [] is now explicit deny-all. Existing rows
  // that stored [] to mean "unrestricted" must be normalized so they do not
  // silently lose access after the parser fix.
  const orgOptimizerAllowedMcpsJson = JSON.stringify({
    rhythm: [
      'rhythm_ping',
      'rhythm_get_dashboard',
      'rhythm_list_sessions',
      'rhythm_list_scheduled_tasks',
      'rhythm_list_automations',
      'rhythm_list_pending_triggers',
      'rhythm_list_memories',
      'rhythm_search_memory',
      'rhythm_remember_memory',
      'rhythm_run_org_optimizer',
    ],
  });

  // One-time repairs (runOnce). All three previously re-fired on every boot:
  //  • config-doctor scope: NULL/'[]' guard still re-stamped a user's
  //    deliberate NULL (unrestricted) or '[]' (deny-all) choice each restart.
  //  • org-optimizer scope: "IS NOT NULL" re-stamped the hardcoded tool list
  //    over any user edit each restart.
  //  • '[]'→NULL normalization: a #916/#923-era repair for the OLD fail-open
  //    semantics — under the NEW contract '[]' is a deliberate deny-all, so
  //    re-running this every boot silently WIDENED a user's deny-all to
  //    unrestricted.
  runOnce('config_doctor_mcps_v1', () => {
    db.prepare(
      `UPDATE agent_configs
          SET allowed_mcps_json = ?
        WHERE id = 'config-doctor'
          AND (allowed_mcps_json IS NULL OR TRIM(allowed_mcps_json) = '[]')`,
    ).run(JSON.stringify(['rhythm']));
  });

  runOnce('org_optimizer_mcps_v1', () => {
    db.prepare(
      `UPDATE agent_configs
          SET allowed_mcps_json = ?
        WHERE (id = '8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f' OR id = 'org-optimizer' OR label = 'Org Optimizer')
          AND allowed_mcps_json IS NOT NULL`,
    ).run(orgOptimizerAllowedMcpsJson);
  });

  runOnce('empty_scope_to_null_v1', () => {
    db.exec(`
      UPDATE agent_configs
         SET allowed_mcps_json = NULL
       WHERE TRIM(allowed_mcps_json) = '[]'
         AND id <> 'config-doctor';

      UPDATE agent_configs
         SET allowed_skills_json = NULL
       WHERE TRIM(allowed_skills_json) = '[]';
    `);
  });

  // #917/#918/#919 — profile data hygiene repairs. Keep these JSON updates
  // shape-preserving and idempotent: rows are read, transformed, and then
  // updated only if the stored value still equals what was read.
  const updateAgentConfigJson = (
    id: string,
    column: 'allowed_mcps_json' | 'allowed_skills_json',
    transform: (parsed: unknown) => unknown,
  ) => {
    const row = db
      .prepare(`SELECT ${column} AS value FROM agent_configs WHERE id = ?`)
      .get(id) as { value: string | null } | undefined;
    if (!row?.value) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return;
    }
    const next = transform(parsed);
    const nextJson = JSON.stringify(next);
    if (nextJson === row.value) return;
    db.prepare(
      `UPDATE agent_configs
          SET ${column} = ?
        WHERE id = ?
          AND ${column} = ?`,
    ).run(nextJson, id, row.value);
  };

  const renameRhythmMemoryTools = (tool: unknown): unknown => {
    if (tool === 'rhythm_remember') return 'rhythm_remember_memory';
    if (tool === 'rhythm_search_context') return 'rhythm_search_memory';
    return tool;
  };

  const appendUnique = (items: unknown[], additions: string[]): unknown[] => {
    const out = [...items];
    for (const item of additions) {
      if (!out.includes(item)) out.push(item);
    }
    return out;
  };

  const rhythmCalendarTools = [
    'rhythm_list_calendar_events',
    'rhythm_create_calendar_event',
    'rhythm_update_calendar_event',
  ];

  // One-time repair (runOnce): renames deprecated rhythm memory tools and
  // fixes worship-planning's calendar scope. Previously re-applied every
  // boot — permanently re-transforming any user edit that reintroduced a
  // renamed tool name or the stray 'calendar' server.
  runOnce('memory_tool_rename_scope_v1', () => {
    for (const id of ['theologian', 'worship-planning', 'worship-production', 'fantasy-gm', 'money']) {
      updateAgentConfigJson(id, 'allowed_mcps_json', (parsed) => {
        if (Array.isArray(parsed)) return parsed.map(renameRhythmMemoryTools);
        if (parsed === null || typeof parsed !== 'object') return parsed;

        const out: Record<string, unknown> = {};
        for (const [server, tools] of Object.entries(parsed as Record<string, unknown>)) {
          if (server === 'calendar' && id === 'worship-planning') continue;
          if (Array.isArray(tools)) {
            out[server] = tools.map(renameRhythmMemoryTools);
          } else if (
            tools !== null &&
            typeof tools === 'object' &&
            Array.isArray((tools as { allowedTools?: unknown }).allowedTools)
          ) {
            out[server] = {
              ...(tools as Record<string, unknown>),
              allowedTools: ((tools as { allowedTools: unknown[] }).allowedTools).map(renameRhythmMemoryTools),
            };
          } else {
            out[server] = tools;
          }
        }

        if (id === 'worship-planning') {
          const rhythmTools = Array.isArray(out.rhythm) ? out.rhythm : [];
          out.rhythm = appendUnique(rhythmTools, rhythmCalendarTools);
        }
        return out;
      });
    }
  });

  const copyScopeFromDuplicate = (sourceId: string, targetId: string) => {
    const source = db
      .prepare(
        `SELECT allowed_mcps_json, allowed_skills_json
           FROM agent_configs
          WHERE id = ?`,
      )
      .get(sourceId) as { allowed_mcps_json: string | null; allowed_skills_json: string | null } | undefined;
    if (!source) return;
    db.prepare(
      `UPDATE agent_configs
          SET allowed_mcps_json = ?,
              allowed_skills_json = ?
        WHERE id = ?
          AND (allowed_mcps_json IS NULL OR TRIM(allowed_mcps_json) IN ('["rhythm","obsidian"]', '["rhythm", "obsidian"]'))
          AND allowed_skills_json IS NULL`,
    ).run(source.allowed_mcps_json, source.allowed_skills_json, targetId);
  };

  // One-time repairs (runOnce). The core-permissions stamp and the skill
  // prune previously re-fired every boot: any user edit to
  // Theological-Researcher's permissions was reverted on restart, and
  // re-granting a pruned skill to 'research' never stuck.
  runOnce('copy_scope_from_duplicates_v1', () => {
    copyScopeFromDuplicate(
      '32294c7d-a26e-4e3a-b5f1-92350225e701',
      'AI-Trend-Researcher',
    );
    copyScopeFromDuplicate(
      'd74b471f-ca90-4246-8182-e769b10d80c6',
      'Theological-Researcher',
    );
  });

  runOnce('theological_researcher_perms_v1', () => {
    db.prepare(
      `UPDATE agent_configs
          SET core_permissions_json = ?
        WHERE id = 'Theological-Researcher'`,
    ).run(JSON.stringify({ skill: 'allow', read: 'allow', bash: 'ask' }));
  });

  runOnce('research_skills_prune_v1', () => {
    updateAgentConfigJson('research', 'allowed_skills_json', (parsed) => {
      if (!Array.isArray(parsed)) return parsed;
      return parsed.filter(
        (skill) =>
          skill !== 'searxng-search' &&
          skill !== 'domain-intel' &&
          skill !== 'parallel-cli',
      );
    });
  });

  // One-time model repairs (runOnce). The worship-production and
  // title/compaction/summary stamps previously re-fired every boot,
  // reverting any deliberate user model choice (e.g. an opus pick) on
  // restart. Model routing is user-owned after these one-time repairs.
  runOnce('coding_agent_model_v1', () => {
    db.prepare(
      `UPDATE agent_configs
          SET model_provider = 'openrouter',
              model_id = 'anthropic/claude-sonnet-4.6'
        WHERE id = 'coding-agent'
          AND model_provider = 'openrouter'
          AND model_id = 'openrouter/free'`,
    ).run();
  });

  runOnce('rhythm_setup_model_v1', () => {
    db.prepare(
      `UPDATE agent_configs
          SET model_provider = 'anthropic',
              model_id = 'claude-sonnet-4-6'
        WHERE id = 'rhythm-setup'
          AND (model_provider IS NULL OR model_id IS NULL)`,
    ).run();
  });

  runOnce('worship_production_model_v1', () => {
    db.prepare(
      `UPDATE agent_configs
          SET model_provider = 'anthropic',
              model_id = 'claude-sonnet-4-6',
              model_tier_hint = 'cheap'
        WHERE id = 'worship-production'
          AND (model_id IS NULL OR model_id LIKE '%opus%' OR model_tier_hint IS NULL)`,
    ).run();
  });

  // One-time repair (runOnce): CLI wrapper rows are seeded as preset rows
  // (session_selectable defaults to 1) and must start hidden from the
  // session picker — claude-code intentionally stays visible (user escape
  // hatch). The picker-refresh sync used to force these false on EVERY sync,
  // which also made a deliberate user promotion impossible; now hiding is a
  // one-time default and session_selectable is user-owned after it.
  runOnce('hide_cli_presets_v1', () => {
    db.exec(`
      UPDATE agent_configs
         SET session_selectable = 0
       WHERE id IN ('build', 'codex', 'gemini-cli', 'opencode')
    `);
  });

  runOnce('utility_modes_haiku_v1', () => {
    db.prepare(
      `UPDATE agent_configs
          SET model_provider = 'anthropic',
              model_id = 'claude-haiku-4-5',
              model_tier_hint = 'cheap'
        WHERE id IN ('title', 'compaction', 'summary')
          AND (model_id IS NULL OR model_id <> 'claude-haiku-4-5' OR model_tier_hint IS NULL)`,
    ).run();
  });

  // OCU-17 (#1058) — worktree isolation fields on agent_sessions. When a session
  // is created with isolateWorktree, the engine makes a git worktree first and
  // the session's cwd becomes the worktree dir; these columns remember the
  // worktree so the UI/cleanup can act on it later. Additive + nullable, guarded
  // by a pragma check (STRUCTURE class — no runOnce needed; the runOnce key
  // 'issue_1058_worktree_fields' is recorded so the migration replay guard and
  // audit trail can see the migration ran, matching the spine convention).
  const agentSessionCols1058 = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map(
    (c) => c.name,
  );
  if (!agentSessionCols1058.includes('worktree_name')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN worktree_name TEXT`);
  }
  if (!agentSessionCols1058.includes('worktree_path')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN worktree_path TEXT`);
  }
  if (!agentSessionCols1058.includes('worktree_branch')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN worktree_branch TEXT`);
  }

  // Delegated-session isolation repair. Only a child still classified Chat
  // whose resolved parent is non-Chat is eligible. Copy the parent's complete
  // catalog/execution scope, while preserving child-owned identity, SDK,
  // permission, status, MCP allowlist, and timestamps. Once category changes,
  // the predicate no longer matches, so repeated boots affect zero rows.
  db.exec(`
    UPDATE agent_sessions AS child
       SET task_id = (
             SELECT parent.task_id FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           task_title = (
             SELECT parent.task_title FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           project_id = (
             SELECT parent.project_id FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           scheduled_task_id = (
             SELECT parent.scheduled_task_id FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           is_system = (
             SELECT parent.is_system FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           anthropic_account_id = (
             SELECT parent.anthropic_account_id FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           owner_user_id = (
             SELECT parent.owner_user_id FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           delegation_depth = (
             SELECT COALESCE(parent.delegation_depth, 0) + 1
               FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           category = (
             SELECT parent.category FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           worktree_name = (
             SELECT parent.worktree_name FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           worktree_path = (
             SELECT parent.worktree_path FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           ),
           worktree_branch = (
             SELECT parent.worktree_branch FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
           )
     WHERE child.parent_session_id IS NOT NULL
       AND child.category = 'chat'
       AND EXISTS (
             SELECT 1
               FROM agent_sessions AS parent
              WHERE parent.id = child.parent_session_id
                AND parent.category <> 'chat'
           );
  `);
  runOnce('issue_1058_worktree_fields', () => {
    // Marker only — the additive ALTERs above are idempotent STRUCTURE changes.
    // This runOnce records that the #1058 worktree-fields migration landed
    // (agent_sessions is local-SQLite only; postgres_bootstrap.ts is NOT needed
    // for agent sessions, per the issue's verification note).
  });

  // #1088 — decouple picker visibility (session_selectable) from schedulability.
  // `schedulable` is nullable: NULL means "inherit session_selectable" (byte-
  // identical behavior to before this migration for every existing row), a
  // 0/1 value is an explicit override so a hidden specialist can be made
  // directly schedulable without becoming picker-visible. Additive + nullable
  // STRUCTURE change; agent_configs is local-SQLite only (no postgres_bootstrap
  // backfill needed).
  const agentConfigCols1088 = (db.pragma('table_info(agent_configs)') as { name: string }[]).map(
    (c) => c.name,
  );
  if (!agentConfigCols1088.includes('schedulable')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN schedulable INTEGER`);
  }
  runOnce('issue_1088_picker_schedule_fields', () => {
    // Marker only — the additive ALTER above is an idempotent STRUCTURE change.
  });

  // #1073 (OCU-32) — full permission-key round-trip. `core_permissions_json`
  // (added by an earlier migration, see the is_manager/core-permissions block
  // above) ALREADY stores an arbitrary permission-key map — setPermissionValue
  // in opencode_agent_writer.ts writes ANY key (string action OR a pattern-map
  // object) into frontmatter generically, not just edit/bash/webfetch. #1073's
  // net-new work is therefore NOT a new column — it's agent_profile_sync
  // reading the engine's resolved permission block BACK into
  // core_permissions_json (see syncOpencodeAgentProfiles). No STRUCTURE
  // change; this runOnce is a marker only, kept for migration-coordination
  // parity with the other Wave-C/D issues per the mega-plan §5 convention.
  runOnce('issue_1073_permissions_json', () => {
    // Marker only — no schema change; core_permissions_json already existed.
  });

  // #1094 — OpenAI native image_generation capability, grantable per-profile
  // and NOT represented as an MCP server / allowedMcpsJson entry. A dedicated
  // boolean (rather than requiring callers to know the low-level
  // `core_permissions_json.image_generation` permission-key name) that the
  // writer projects into `permission.image_generation: allow` frontmatter;
  // the existing ask/allow/deny approval flow still governs the actual call.
  // Additive + NOT NULL DEFAULT 0 (opt-in); local SQLite only.
  //
  // FORK CAVEAT (verified during implementation, not a Rhythm-side gap): the
  // vendored engine's session tool-assembly (packages/opencode/src/session)
  // has no existing mechanism that adds ANY provider-hosted tool (image
  // generation, web_search, etc.) to a request — grep across that directory
  // for HOSTED_TOOLS/providerExecuted-request-side wiring found only
  // RESPONSE-side handling (processor.ts interprets a hosted tool-call IF one
  // arrives) and the tool implementation itself under packages/core/llm, but
  // no caller that offers it to the model. Granting this flag is real,
  // inert-until-then Rhythm-side plumbing; actually OFFERING the tool to the
  // model needs a follow-up fork change (out of scope here per AGENTS.md —
  // the fork is edited only for mcp-scope-* issues — and per this issue's own
  // "if a fork rebuild IS required, SKIP with a note" contingency).
  const agentConfigCols1094 = (db.pragma('table_info(agent_configs)') as { name: string }[]).map(
    (c) => c.name,
  );
  if (!agentConfigCols1094.includes('image_generation_enabled')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN image_generation_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  runOnce('issue_1094_image_gen_capability', () => {
    // Marker only — the additive ALTER above is an idempotent STRUCTURE change.
  });

  // #1069 (OCU-28) — rhythm-telemetry plugin ingestion table. Local SQLite
  // only (tool.execute hooks only fire against a locally-spawned engine).
  // CREATE TABLE IF NOT EXISTS is itself an idempotent STRUCTURE change; the
  // runOnce below is a marker only, kept for migration-coordination audit
  // trail parity with the other Wave-C/D issues (mirrors #1058's pattern).
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      sdk_session_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      error_class TEXT,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS tool_events_session_idx ON tool_events (session_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS tool_events_sdk_session_idx ON tool_events (sdk_session_id)`);
  runOnce('issue_1069_tool_events', () => {
    // Marker only — the CREATE TABLE/INDEX above are idempotent STRUCTURE changes.
  });

  // #1072 (OCU-31) — org_settings: a single org-wide instructions markdown,
  // hosted on the production API (org_settings_routes.ts, public read /
  // authed write) and synced to every local machine's opencode `instructions`
  // config (opencode_plugin_config.ts's `syncOrgInstructions`). Singleton row
  // keyed by a fixed id ('org_instructions') — see org_settings_repository.ts.
  // THE ONLY PROD-SCHEMA ISSUE IN THIS BATCH: see postgres_bootstrap.ts for
  // the matching table (additive only, flagged there for manual review per
  // AGENTS.md production posture).
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_settings (
      id         TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);
  runOnce('issue_1072_org_settings', () => {
    // Marker only — the CREATE TABLE above is an idempotent STRUCTURE change.
  });

  // #1118 — per-agent-profile reasoning effort / thinking budget. Nullable
  // free-form string (provider effort tier, e.g. 'low'/'medium'/'high'/'xhigh'
  // /'max' for Anthropic adaptive models); NULL = provider default (no
  // restriction), same semantics as allowedMcpsJson: null. Projected by
  // opencode_agent_writer.ts into the agent-file frontmatter's
  // `options.effort` — session/llm.ts merges `agent.options` directly into
  // the AI SDK call options, so this flows through without needing the
  // engine's `variant` mechanism. Additive + nullable STRUCTURE change; local
  // SQLite only — mirrors #1088/#1094: this column only feeds the
  // local-only opencode agent-file writer (gated
  // `if (env.dbClient === 'postgres') return` — see AGENTS.md "Database"),
  // which never runs against production Postgres. No postgres_bootstrap
  // backfill needed.
  const agentConfigCols1118 = (
    db.pragma('table_info(agent_configs)') as { name: string }[]
  ).map((c) => c.name);
  if (!agentConfigCols1118.includes('reasoning_effort')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN reasoning_effort TEXT`);
  }
  runOnce('issue_1118_reasoning_effort', () => {
    // Marker only — the additive ALTER above is an idempotent STRUCTURE change.
  });

  // #1138 follow-up — one-time CONTENT repair of legacy numbered-key
  // core_permissions_json rows ({"0":{permission,pattern,action},...}) left
  // behind by the old Tool Permissions panel. The projector now SKIPS those
  // entries (fail-soft, #1149), so the rows' permissions were silently never
  // applied. Converts each row to the flat {perm: action | {pattern: action}}
  // map via the shared converter; flat/hand-repaired/garbage rows return
  // `undefined` and are left byte-for-byte untouched. runOnce-guarded per the
  // write-discipline contract above: a user who later hand-edits a row back
  // into a weird shape must not be re-transformed on every boot.
  runOnce('numbered_core_permissions_repair_v1', () => {
    const rows = db
      .prepare(
        `SELECT id, core_permissions_json AS value
           FROM agent_configs
          WHERE core_permissions_json IS NOT NULL`,
      )
      .all() as { id: string; value: string }[];
    for (const row of rows) {
      const repaired = convertLegacyNumberedCorePermissions(row.value);
      if (repaired === undefined) continue;
      db.prepare(
        `UPDATE agent_configs
            SET core_permissions_json = ?
          WHERE id = ?
            AND core_permissions_json = ?`,
      ).run(repaired, row.id, row.value);
    }
  });

  // W1 corrective-6 package B — the revision column, its stored domain and the
  // raw-writer auto-bump are installed by installRevisionInvariants() at each
  // table's CREATE site above, so no content repair can run against a table
  // that still lacks the lifecycle CAS token.

  // #1175 — Mobile Activity is an authenticated, per-user projection. Recipes
  // and optimizer proposals predate user ownership, so add nullable ownership
  // without rewriting legacy rows. NULL means organization/system-global and
  // is visible only on the trusted local desktop global surface; paired/cloud
  // feeds require an exact owner match. The compound indexes mirror each
  // Activity source's owner + recency predicate.
  const agentCookbookActivityCols = (
    db.pragma('table_info(agent_cookbook)') as { name: string }[]
  ).map((column) => column.name);
  if (!agentCookbookActivityCols.includes('owner_user_id')) {
    db.exec(
      `ALTER TABLE agent_cookbook
         ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    );
  }
  const agentOrgProposalActivityCols = (
    db.pragma('table_info(agent_org_proposals)') as { name: string }[]
  ).map((column) => column.name);
  if (!agentOrgProposalActivityCols.includes('owner_user_id')) {
    db.exec(
      `ALTER TABLE agent_org_proposals
         ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    );
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_owner_activity
      ON agent_sessions(owner_user_id, last_activity_at, updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_scheduled_tasks_owner_activity
      ON agent_scheduled_tasks(created_by_user_id, last_run_at);
    CREATE INDEX IF NOT EXISTS idx_agent_webhook_endpoints_owner_activity
      ON agent_webhook_endpoints(created_by_user_id, last_triggered_at);
    CREATE INDEX IF NOT EXISTS idx_agent_research_jobs_owner_activity
      ON agent_research_jobs(requested_by_user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_cookbook_owner_activity
      ON agent_cookbook(owner_user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_org_proposals_owner_activity
      ON agent_org_proposals(owner_user_id, updated_at);
  `);

  // #1123 — durable callback/outbox state for interactive asynchronous
  // delegation. The local child and parent rows remain the source of truth for
  // transcript/session data; this table only distinguishes async children from
  // native `task` children and makes completion delivery idempotent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_async_delegations (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      child_session_id TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id) ON DELETE CASCADE,
      target_agent_config_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'dispatched'
        CHECK (status IN ('dispatched', 'completed', 'waking', 'notified', 'failed')),
      completion_text TEXT,
      error_text TEXT,
      completed_at TEXT,
      notified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_async_delegations_parent_status
      ON agent_async_delegations(parent_session_id, status, created_at);
  `);

  // Widen the status CHECK to admit 'cancelled' (#1123 follow-up: a parent can now
  // cancel an in-flight delegation). SQLite cannot ALTER a CHECK constraint, so a
  // pre-existing table has to be rebuilt. Detected from the constraint text rather
  // than a version counter so it is idempotent and safe to re-run.
  const asyncDelegationsSql = (
    db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_async_delegations'`,
      )
      .get() as { sql?: string } | undefined
  )?.sql;
  if (asyncDelegationsSql && !asyncDelegationsSql.includes("'cancelled'")) {
    db.exec(`
      CREATE TABLE agent_async_delegations_new (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        child_session_id TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id) ON DELETE CASCADE,
        target_agent_config_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'dispatched'
          CHECK (status IN ('dispatched', 'completed', 'waking', 'notified', 'failed', 'cancelled')),
        completion_text TEXT,
        error_text TEXT,
        completed_at TEXT,
        notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agent_async_delegations_new
        SELECT id, parent_session_id, child_session_id, target_agent_config_id, status,
               completion_text, error_text, completed_at, notified_at, created_at, updated_at
          FROM agent_async_delegations;
      DROP TABLE agent_async_delegations;
      ALTER TABLE agent_async_delegations_new RENAME TO agent_async_delegations;
      CREATE INDEX IF NOT EXISTS idx_agent_async_delegations_parent_status
        ON agent_async_delegations(parent_session_id, status, created_at);
    `);
  }

  // #1178 — immutable, privacy-reviewed transcript snapshots shared only with
  // named Rhythm users. source_session_id is intentionally not an FK: deleting
  // the source makes reads fail closed while preserving provenance/audit rows.
  const shareAuditForeignKeys = db.pragma(
    'foreign_key_list(share_audit_log)',
  ) as Array<{ table: string }>;
  if (shareAuditForeignKeys.some((foreignKey) =>
    foreignKey.table === 'shared_transcripts')) {
    db.transaction(() => {
      db.exec(`
        DROP TRIGGER IF EXISTS share_audit_log_no_delete;
        DROP INDEX IF EXISTS idx_share_audit_log_share_timestamp;
        ALTER TABLE share_audit_log RENAME TO share_audit_log_legacy;
        CREATE TABLE share_audit_log (
          id TEXT PRIMARY KEY,
          share_id TEXT NOT NULL,
          actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          action TEXT NOT NULL CHECK (action IN ('share', 'view', 'revoke', 'delete')),
          timestamp TEXT NOT NULL
        );
        INSERT INTO share_audit_log
          (id, share_id, actor_user_id, action, timestamp)
        SELECT id, share_id, actor_user_id, action, timestamp
          FROM share_audit_log_legacy;
        DROP TABLE share_audit_log_legacy;
      `);
    })();
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_transcripts (
      id TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_user_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      source_session_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shared_transcripts_owner_created
      ON shared_transcripts(owner_user_id, created_at);

    CREATE TABLE IF NOT EXISTS share_audit_log (
      id TEXT PRIMARY KEY,
      -- Deliberately no FK: audit history must survive any administrative or
      -- direct deletion of the share row.
      share_id TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK (action IN ('share', 'view', 'revoke', 'delete')),
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_share_audit_log_share_timestamp
      ON share_audit_log(share_id, timestamp);

    CREATE TRIGGER IF NOT EXISTS shared_transcripts_snapshot_immutable
      BEFORE UPDATE OF snapshot_json ON shared_transcripts
      BEGIN
        SELECT RAISE(ABORT, 'shared transcript snapshots are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS share_audit_log_no_delete
      BEFORE DELETE ON share_audit_log
      BEGIN
        SELECT RAISE(ABORT, 'share audit history is append-only');
      END;
  `);

  // Config Doctor D1 — agent_scheduled_tasks only ever keeps ONE overwritten
  // last-run slot (last_run_at/last_run_status/last_error), so a task that
  // fails intermittently (e.g. fails Mon+Tue, succeeds Wed) shows only the
  // most recent outcome — every prior run is invisible. This table adds a
  // durable per-run history row alongside the existing slot (which many
  // other read paths still rely on, so it stays in sync rather than being
  // removed). root_session_id is the local agent_sessions.id the run
  // produced, when one exists (NULL for e.g. an engine-not-ready deferral).
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_scheduled_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES agent_scheduled_tasks(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      status TEXT NOT NULL,       -- 'success' | 'error' | 'blocked_on_approval' | 'completed_no_op'
      error TEXT,
      root_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_scheduled_task_runs_task
      ON agent_scheduled_task_runs(task_id, started_at DESC);
  `);

  // #1243 — first-class season goals. This is deliberately additive: existing
  // tasks, project instances, and rhythms remain ungrouped with a NULL goal_id.
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      metric_type TEXT NOT NULL,
      start_value REAL NOT NULL,
      current_value REAL NOT NULL,
      end_value REAL NOT NULL,
      health TEXT NOT NULL DEFAULT 'on_track',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goals_owner_dates
      ON goals(owner_id, start_date, end_date);
  `);
  for (const table of ['tasks', 'project_instances', 'recurring_task_rules']) {
    const columns = (db.pragma(`table_info(${table})`) as { name: string }[])
      .map((column) => column.name);
    if (!columns.includes('goal_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_goal_id ON ${table}(goal_id)`);
  }

  // #1244 — nullable priority and normalized JSON-array tags for task organization.
  const taskColumns = (db.pragma('table_info(tasks)') as { name: string }[])
    .map((column) => column.name);
  if (!taskColumns.includes('priority')) {
    db.exec('ALTER TABLE tasks ADD COLUMN priority INTEGER');
  }
  if (!taskColumns.includes('tags')) {
    db.exec("ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  }
  if (!taskColumns.includes('energy')) {
    db.exec('ALTER TABLE tasks ADD COLUMN energy TEXT');
  }

  // #1246 — compact, instance-scoped milestones. Fresh databases receive the
  // composite FK above; triggers enforce the same invariant on legacy tables
  // where SQLite cannot add a table constraint without rebuilding the table.
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_milestones (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL REFERENCES project_instances(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_date TEXT,
      color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(instance_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_milestones_instance_order
      ON project_milestones(instance_id, sort_order);
  `);
  const milestoneStepColumns = (
    db.pragma('table_info(project_instance_steps)') as { name: string }[]
  ).map((column) => column.name);
  if (!milestoneStepColumns.includes('milestone_id')) {
    db.exec('ALTER TABLE project_instance_steps ADD COLUMN milestone_id TEXT');
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_instance_steps_milestone
      ON project_instance_steps(instance_id, milestone_id);
    CREATE TRIGGER IF NOT EXISTS project_instance_steps_milestone_insert_guard
    BEFORE INSERT ON project_instance_steps
    WHEN NEW.milestone_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM project_milestones
      WHERE id = NEW.milestone_id AND instance_id = NEW.instance_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'milestone must belong to the project instance');
    END;
    CREATE TRIGGER IF NOT EXISTS project_instance_steps_milestone_update_guard
    BEFORE UPDATE OF instance_id, milestone_id ON project_instance_steps
    WHEN NEW.milestone_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM project_milestones
      WHERE id = NEW.milestone_id AND instance_id = NEW.instance_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'milestone must belong to the project instance');
    END;
  `);

  // ── W4 — immutable run-outcome ledger ─────────────────────────────────────
  //
  // Its OWN table, deliberately, for the same reason agent_profile_projections
  // is: agent_configs and agent_org_proposals carry installRevisionInvariants'
  // AFTER UPDATE auto-bump, so recording run outcomes there would advance a
  // lifecycle CAS token for something that is not a domain change at all.
  //
  // `root_session_id` is UNIQUE at the TABLE level (not merely a unique index)
  // so the parity guard's CREATE-TABLE parser can see it and so a second,
  // concurrent finalizer is refused by the database rather than by whichever
  // service branch happened to run first.
  //
  // Privacy (W4-c10): every column here is an identifier, an enum, a count or
  // a timestamp. No prompt text, tool argument, tool output or credential is
  // ever copied in — see run_outcome_service.ts, which builds the only rows
  // this table receives.
  //
  // Dual-engine — see postgres_bootstrap.ts for the matching tables; guarded
  // by skill_schema_parity.test.ts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_outcomes (
      id TEXT PRIMARY KEY,
      root_session_id TEXT NOT NULL UNIQUE,
      session_id TEXT,
      scheduled_occurrence_id TEXT,
      experiment_variant TEXT,
      proposal_id TEXT,
      profile_id TEXT,
      config_revision INTEGER,
      terminal_status TEXT NOT NULL,
      objective_verdict TEXT NOT NULL,
      objective_evidence_json TEXT NOT NULL DEFAULT '{}',
      attribution_json TEXT NOT NULL DEFAULT '{}',
      finalized_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_run_outcomes_finalized
       ON agent_run_outcomes(finalized_at DESC)`,
  );

  // The outcome row is written once, complete, at finalization — so "mutable
  // until finalized, immutable after" collapses to immutable-on-arrival. Later
  // human/inferred verdicts do NOT edit this row; they are appended to
  // agent_run_feedback_events below, which is what keeps the objective record
  // and the subjective record from being mistaken for one another.
  //
  // KNOWN GAP, stated precisely rather than overclaimed: these triggers block
  // UPDATE and DELETE. They do NOT block `INSERT OR REPLACE`, because SQLite
  // fires BEFORE DELETE for REPLACE conflict resolution only when
  // `PRAGMA recursive_triggers` is ON, and it is OFF (the default) throughout
  // this codebase. No writer in this repository uses REPLACE on these tables,
  // and turning the pragma on would change REPLACE semantics for every other
  // table, so the guarantee is scoped honestly instead: no UPDATE or DELETE
  // path can rewrite history. A REPLACE-shaped writer would have to be added
  // deliberately, and the test below pins that boundary so it cannot be added
  // silently.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS agent_run_outcomes_immutable
    BEFORE UPDATE ON agent_run_outcomes
    BEGIN
      SELECT RAISE(ABORT, 'agent run outcomes are immutable once finalized');
    END;
    CREATE TRIGGER IF NOT EXISTS agent_run_outcomes_no_delete
    BEFORE DELETE ON agent_run_outcomes
    BEGIN
      SELECT RAISE(ABORT, 'agent run outcomes are immutable once finalized');
    END;
  `);

  // Append-only feedback. `source` and `confidence` are NOT NULL because W6
  // weights evidence by exactly those two fields — a row missing either is
  // unusable downstream, so it must never be storable in the first place.
  // `reason` is the only free-text column in the ledger and holds ONLY the
  // operator's own words supplied to the feedback API; run content never
  // reaches it (run_outcome_service.ts redacts secret-shaped input).
  //
  // `seq` orders events within one root run. An ISO `created_at` alone is not
  // enough — two verdicts recorded in the same millisecond would then be
  // ordered by a random UUID, and "which verdict came last" is exactly the
  // question this table exists to answer.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_feedback_events (
      id TEXT PRIMARY KEY,
      root_session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      source TEXT NOT NULL,
      verdict TEXT NOT NULL,
      confidence REAL NOT NULL,
      actor TEXT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_run_feedback_events_root
       ON agent_run_feedback_events(root_session_id, seq)`,
  );
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS agent_run_feedback_events_no_update
    BEFORE UPDATE ON agent_run_feedback_events
    BEGIN
      SELECT RAISE(ABORT, 'agent run feedback is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS agent_run_feedback_events_no_delete
    BEFORE DELETE ON agent_run_feedback_events
    BEGIN
      SELECT RAISE(ABORT, 'agent run feedback is append-only');
    END;
  `);

  // W6-c5 — the experiment service's ONLY read into W4's ledger: the cohort
  // rows for one proposal. No column is added to agent_run_outcomes and no
  // update path exists; this is an index for a read that already type-checks.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_run_outcomes_experiment
       ON agent_run_outcomes(proposal_id, experiment_variant)`,
  );

  // ── W6-c8 — outcome status, separate from deployment status ───────────────
  //
  // agent_org_proposals.status stays the DEPLOYMENT field and its state machine
  // is NOT extended (`inconclusive` is not, and must never become, a proposal
  // status). Outcome authority lives here instead, so a row can be
  // simultaneously status='active' and outcome_status='inconclusive'.
  //
  // Written ONLY through AgentOrgProposalsRepository.setOutcomeStatusAtRevisionAsync,
  // which is revision-fenced: the AFTER UPDATE auto-bump above would otherwise
  // advance the lifecycle CAS token invisibly on any raw UPDATE.
  const proposalColsW6 = (
    db.pragma('table_info(agent_org_proposals)') as { name: string }[]
  ).map((c) => c.name);
  if (!proposalColsW6.includes('outcome_status')) {
    db.exec(
      `ALTER TABLE agent_org_proposals ADD COLUMN outcome_status TEXT NOT NULL DEFAULT 'unproven'`,
    );
  }

  // ── W6-c3 — the controlled experiment record ──────────────────────────────
  //
  // Its own additive table. Seven declared elements: immutable baseline and
  // candidate specs, a deterministic assignment key, a predeclared stopping
  // rule, a maximum exposure, results, and the promote|inconclusive|regress
  // decision. The first five are written once at declaration; only `results`
  // and the decision columns are ever updated, which is what the immutability
  // trigger below distinguishes.
  //
  // Dual-engine — see postgres_bootstrap.ts for the twin; guarded by
  // skill_schema_parity.test.ts. The CREATE TABLE body's closing paren must
  // stay immediately before the closing backtick or that parser goes blind.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_org_experiments (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      adapter TEXT NOT NULL,
      evidence_bundle_json TEXT NOT NULL,
      baseline_spec_json TEXT NOT NULL,
      candidate_spec_json TEXT NOT NULL,
      assignment_key TEXT NOT NULL,
      stopping_rule_json TEXT NOT NULL,
      max_exposure INTEGER NOT NULL,
      results_json TEXT,
      decision TEXT,
      decision_reason TEXT,
      declared_at TEXT NOT NULL,
      results_recorded_at TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_org_experiments_proposal
       ON agent_org_experiments(proposal_id, declared_at)`,
  );
  // At most ONE undecided experiment per proposal. Two would read the same
  // ledger cohort pool through different stopping rules and both stamp
  // outcome_status — last writer wins. A decided experiment is history and does
  // not block the next one.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_org_experiments_one_undecided
       ON agent_org_experiments(proposal_id) WHERE decision IS NULL`,
  );

  // The SPEC is immutable; the results and the decision are not — an experiment
  // that could never record a result would be a museum piece. The trigger fires
  // only when a spec column actually changes, so the two result/decision writes
  // pass through untouched.
  //
  // KNOWN GAP, stated the way W4 was forced to state it rather than
  // overclaimed: this blocks UPDATE and DELETE. It does NOT block
  // `INSERT OR REPLACE`, because SQLite fires BEFORE DELETE for REPLACE
  // conflict resolution only when `PRAGMA recursive_triggers` is ON, and it is
  // OFF throughout this codebase. No writer here uses REPLACE on this table,
  // and the repository test pins that boundary in both directions.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS agent_org_experiments_spec_immutable
    BEFORE UPDATE ON agent_org_experiments
    FOR EACH ROW WHEN
      NEW.proposal_id IS NOT OLD.proposal_id
      OR NEW.adapter IS NOT OLD.adapter
      OR NEW.evidence_bundle_json IS NOT OLD.evidence_bundle_json
      OR NEW.baseline_spec_json IS NOT OLD.baseline_spec_json
      OR NEW.candidate_spec_json IS NOT OLD.candidate_spec_json
      OR NEW.assignment_key IS NOT OLD.assignment_key
      OR NEW.stopping_rule_json IS NOT OLD.stopping_rule_json
      OR NEW.max_exposure IS NOT OLD.max_exposure
      OR NEW.declared_at IS NOT OLD.declared_at
    BEGIN
      SELECT RAISE(ABORT, 'agent org experiment specs are immutable once declared');
    END;
    CREATE TRIGGER IF NOT EXISTS agent_org_experiments_no_delete
    BEFORE DELETE ON agent_org_experiments
    BEGIN
      SELECT RAISE(ABORT, 'agent org experiment specs are immutable once declared');
    END;
  `);

  // ── W5-c12 — the proposal retirement sidecar ──────────────────────────────
  //
  // Records that an operator has been handed a stale proposal. It is a sidecar
  // rather than a column on agent_org_proposals because that table's AFTER
  // UPDATE trigger advances `revision`, the lifecycle CAS token held in flight
  // by approve/apply/revert/measure — so writing "an operator saw this" onto
  // the row would silently invalidate a concurrent operation's token.
  //
  // Previously created lazily at runtime by org_proposal_reconciler.ts, which
  // put it outside this file and therefore outside skill_schema_parity.test.ts:
  // the guard cannot see a table it cannot parse, so the two engines diverged
  // unobserved. Dual-engine now — see postgres_bootstrap.ts for the twin. The
  // CREATE TABLE body's closing paren must stay immediately before the closing
  // backtick or that parser goes blind.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_org_proposal_retirements (
      proposal_id TEXT PRIMARY KEY,
      classification TEXT NOT NULL,
      detail TEXT NOT NULL,
      proposal_revision INTEGER NOT NULL,
      retired_at TEXT NOT NULL
    );
  `);

  // ── C1 — pre-run episode enrollment reservation ───────────────────────────
  //
  // Distinct from agent_run_outcomes: this is written BEFORE dispatch, not at
  // finalization. `run_episode_id` is UNIQUE so a retried/duplicate dispatch
  // for the same episode can never mint a second reservation or flip the
  // cohort — the repository reads the existing row back instead of inserting.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_org_experiment_enrollments (
      id TEXT PRIMARY KEY,
      run_episode_id TEXT NOT NULL UNIQUE,
      experiment_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      cohort TEXT NOT NULL CHECK (cohort IN ('baseline','candidate')),
      assignment_digest TEXT NOT NULL,
      baseline_target_revision_hash TEXT NOT NULL,
      treatment_spec_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'reserved'
        CHECK (state IN ('reserved', 'dispatched', 'treatment_failed', 'terminalized')),
      failure_code TEXT,
      failure_reason TEXT,
      reserved_at TEXT NOT NULL
    );
  `);

  const enrollmentCols = (db.pragma('table_info(agent_org_experiment_enrollments)') as {
    name: string;
  }[]).map((c) => c.name);
  if (!enrollmentCols.includes('failure_code')) {
    db.exec(`ALTER TABLE agent_org_experiment_enrollments ADD COLUMN failure_code TEXT`);
  }
  if (!enrollmentCols.includes('failure_reason')) {
    db.exec(`ALTER TABLE agent_org_experiment_enrollments ADD COLUMN failure_reason TEXT`);
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_org_experiment_enrollments_experiment
       ON agent_org_experiment_enrollments(experiment_id)`,
  );

  const canonicalFailureReasonCases = ENROLLMENT_FAILURE_CODES.map((code) => {
    const reason = ENROLLMENT_FAILURE_CODE_REASONS[code];
    const escapedReason = reason.replace(/'/g, "''");
    return ` WHEN '${code}' THEN '${escapedReason}'`;
  }).join('\n');
  const canonicalFailureReasonExpr = `(CASE NEW.failure_code ${canonicalFailureReasonCases} ELSE NULL END)`;

  db.exec(`
    DROP TRIGGER IF EXISTS trg_agent_org_experiment_enrollments_state_insert_domain;
    DROP TRIGGER IF EXISTS trg_agent_org_experiment_enrollments_state_update_domain;

    CREATE TRIGGER trg_agent_org_experiment_enrollments_state_insert_domain
    BEFORE INSERT ON agent_org_experiment_enrollments
    FOR EACH ROW
    WHEN NEW.state NOT IN ('reserved', 'dispatched', 'treatment_failed', 'terminalized')
      OR (NEW.failure_code IS NOT NULL AND NEW.failure_code NOT IN (
        'pre_dispatch_failed',
        'prompt_dispatch_failed',
        'provider_unavailable',
        'invalid_model',
        'prompt_timeout',
        'target_drifted'
      ))
      OR (NEW.state = 'treatment_failed'
          AND (NEW.failure_code IS NULL OR NEW.failure_reason IS NOT ${canonicalFailureReasonExpr}))
      OR (NEW.state IN ('reserved', 'dispatched', 'terminalized')
          AND (NEW.failure_code IS NOT NULL OR NEW.failure_reason IS NOT NULL))
    BEGIN
      SELECT RAISE(ABORT, 'agent_org_experiment_enrollments state transition is invalid');
    END;

    CREATE TRIGGER trg_agent_org_experiment_enrollments_state_update_domain
    BEFORE UPDATE OF state, failure_code, failure_reason
    ON agent_org_experiment_enrollments
    FOR EACH ROW
    WHEN NOT (
      -- unchanged state + unchanged metadata is a legal idempotent write
      (NEW.state = OLD.state
       AND NEW.failure_code IS OLD.failure_code
       AND NEW.failure_reason IS OLD.failure_reason)
      OR (
        OLD.state = 'reserved'
        AND NEW.state = 'dispatched'
        AND NEW.failure_code IS NULL
        AND NEW.failure_reason IS NULL
      )
      OR (
        OLD.state = 'reserved'
        AND NEW.state = 'treatment_failed'
        AND NEW.failure_code IN (
          'pre_dispatch_failed',
          'prompt_dispatch_failed',
          'provider_unavailable',
          'invalid_model',
          'prompt_timeout',
          'target_drifted'
        )
        AND NEW.failure_reason IS ${canonicalFailureReasonExpr}
      )
      OR (
        OLD.state = 'dispatched'
        AND NEW.state = 'terminalized'
        AND NEW.failure_code IS NULL
        AND NEW.failure_reason IS NULL
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'agent_org_experiment_enrollments state transition is invalid');
    END;
  `);

  // ── C2-B — the durable, immutable, sanitized treatment receipt ───────────
  //
  // Bound to exactly one enrollment/run episode (both UNIQUE). Carries only
  // safe identity/revision/hash evidence — never raw prompt/system-prompt
  // bytes. `target_ref` and the hash columns are closed-domain CHECKs so a
  // malformed row can never be inserted in the first place, not merely
  // rejected by application code. Fully immutable once inserted (see the
  // no-update/no-delete triggers below) — unlike the enrollment lifecycle
  // table, a receipt has no legal post-insert transition at all.
  const HEX64_GLOB = Array(64).fill('[0-9a-f]').join('');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_org_experiment_treatment_receipts (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      enrollment_id TEXT NOT NULL UNIQUE REFERENCES agent_org_experiment_enrollments(id),
      run_episode_id TEXT NOT NULL UNIQUE,
      experiment_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      cohort TEXT NOT NULL CHECK (cohort IN ('baseline','candidate')),
      assignment_digest TEXT NOT NULL,
      adapter TEXT NOT NULL CHECK (adapter = 'system-prompt-v1'),
      target_ref TEXT NOT NULL CHECK (target_ref = 'agent_config:' || profile_id),
      baseline_target_revision_hash TEXT NOT NULL CHECK (baseline_target_revision_hash GLOB 'sha256:${HEX64_GLOB}'),
      profile_revision INTEGER NOT NULL CHECK (profile_revision >= 0),
      treatment_spec_hash TEXT NOT NULL CHECK (treatment_spec_hash GLOB '${HEX64_GLOB}'),
      effective_prompt_hash TEXT NOT NULL CHECK (effective_prompt_hash GLOB '${HEX64_GLOB}'),
      finalized_at TEXT NOT NULL
    );
  `);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_org_experiment_treatment_receipts_experiment
       ON agent_org_experiment_treatment_receipts(experiment_id)`,
  );

  // INSERT-time binding guard: a receipt can only be inserted for an
  // enrollment that (a) exists, (b) is ALREADY `dispatched` at insert time,
  // and (c) matches the receipt's copied binding fields exactly. This is a
  // real DB-level enforcement — a raw SQL INSERT that relabels any bound
  // field, or that fires before the enrollment's own reserved -> dispatched
  // transition has committed, is rejected here, not merely by the
  // repository copying fields correctly. DROP+CREATE (not CREATE TRIGGER IF
  // NOT EXISTS) so a future logic fix redeploys on every boot, mirroring the
  // enrollment lifecycle triggers above.
  db.exec(`
    DROP TRIGGER IF EXISTS trg_agent_org_experiment_treatment_receipts_binding;
    CREATE TRIGGER trg_agent_org_experiment_treatment_receipts_binding
    BEFORE INSERT ON agent_org_experiment_treatment_receipts
    FOR EACH ROW
    WHEN NOT EXISTS (
      SELECT 1 FROM agent_org_experiment_enrollments e
       WHERE e.id = NEW.enrollment_id
         AND e.state = 'dispatched'
         AND e.run_episode_id = NEW.run_episode_id
         AND e.experiment_id = NEW.experiment_id
         AND e.proposal_id = NEW.proposal_id
         AND e.profile_id = NEW.profile_id
         AND e.cohort = NEW.cohort
         AND e.assignment_digest = NEW.assignment_digest
         AND e.baseline_target_revision_hash = NEW.baseline_target_revision_hash
         AND e.treatment_spec_hash = NEW.treatment_spec_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'treatment receipt does not match its bound dispatched enrollment');
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS agent_org_experiment_treatment_receipts_no_update
    BEFORE UPDATE ON agent_org_experiment_treatment_receipts
    BEGIN
      SELECT RAISE(ABORT, 'treatment receipts are immutable once finalized');
    END;
    CREATE TRIGGER IF NOT EXISTS agent_org_experiment_treatment_receipts_no_delete
    BEFORE DELETE ON agent_org_experiment_treatment_receipts
    BEGIN
      SELECT RAISE(ABORT, 'treatment receipts are immutable once finalized');
    END;
  `);

  // ── C2-D (S2) — bind outcomes to their run episode ────────────────────────
  //
  // Additive: NULL for every outcome finalized before this column existed.
  // `run_episode_id` is what `agent_org_experiment_treatment_receipts` is
  // ALSO keyed on (UNIQUE there), so a caller can join the two tables to read
  // only outcomes whose run received a real, receipt-proved treatment — see
  // AgentRunOutcomesRepository.listReceiptBackedByExperimentAsync. Not made
  // UNIQUE here: unlike the receipt/enrollment tables, this ledger's own
  // identity is `root_session_id`, and a pre-existing row backfilled later is
  // not this migration's concern.
  const outcomeColsRunEpisode = (
    db.pragma('table_info(agent_run_outcomes)') as { name: string }[]
  ).map((c) => c.name);
  if (!outcomeColsRunEpisode.includes('run_episode_id')) {
    db.exec(`ALTER TABLE agent_run_outcomes ADD COLUMN run_episode_id TEXT`);
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_run_outcomes_run_episode
       ON agent_run_outcomes(run_episode_id)`,
  );

  // ── D2.1 (#1431) — the post-apply monitor/repair/revert lifecycle record ──
  //
  // One row per APPLIED proposal (`proposal_id` UNIQUE): the durable trail of
  // guardrail monitoring (D2.2), up to 3 corrective repair attempts (D2.3),
  // and an eventual revert or "clear" (D2.4). `pre_change_snapshot_json` is
  // an opaque CAS pointer — callers are expected to store a revision/
  // fingerprint, never a raw prior field value — and the repository layer
  // (post_apply_events_repository.ts) additionally redacts secret shapes out
  // of both JSON blob columns before every write. Postgres twin in
  // postgres_bootstrap.ts — enforced by skill_schema_parity.test.ts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_org_post_apply_events (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES agent_org_proposals(id),
      profile_id TEXT NOT NULL,
      change_type TEXT NOT NULL CHECK (change_type IN ('prompt','tool','scope')),
      pre_change_snapshot_json TEXT NOT NULL,
      monitoring_window_start TEXT NOT NULL,
      monitoring_window_end TEXT NOT NULL,
      guardrail_status TEXT NOT NULL DEFAULT 'monitoring'
        CHECK (guardrail_status IN ('monitoring','clear','tripped')),
      repair_proposal_ids_json TEXT NOT NULL DEFAULT '[]',
      revert_status TEXT NOT NULL DEFAULT 'none'
        CHECK (revert_status IN ('none','reverted','not_needed','revert_failed')),
      alert_payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_org_post_apply_events_profile
       ON agent_org_post_apply_events(profile_id)`,
  );

  // D2.2 (#1432) — the post-apply guardrail monitor's profile-scoped read
  // (AgentRunOutcomesRepository.listByProfileSinceAsync) is a new query
  // shape against an existing column; index it rather than scanning.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_run_outcomes_profile
       ON agent_run_outcomes(profile_id)`,
  );

  // ── D2.3 (#1433, second pass) — durable repair-attempt state machine ──────
  //
  // The original design declared a repair "successful" the instant it found
  // NO run outcomes at/after `now + 1ms` — which is always true immediately
  // after a repair (no agent turn has run yet), so it was a guaranteed pass
  // regardless of whether the fix actually helped. These two additive
  // columns replace that with real evidence-gating:
  //   - repair_attempt_count: the TRUTHFUL number of repair attempts
  //     consumed so far (0..MAX_REPAIR_ATTEMPTS), including a genuine
  //     diagnosis that produced no actionable fix — never silently
  //     under-counted the way the old in-memory-only loop could.
  //   - repair_recheck_after: set the instant the latest attempt's config
  //     mutation lands; NULL once that attempt's outcome (repaired/failed)
  //     resolves. A sweep only evaluates the guardrail against outcomes
  //     finalized at/after this floor, and only ACTS once enough of them
  //     exist (same D2.2 registry + minSampleCount) — no evidence yet always
  //     leaves the event exactly where it was. See auto_repair_service.ts.
  // Postgres twin in postgres_bootstrap.ts — enforced by
  // skill_schema_parity.test.ts.
  const postApplyEventCols = (
    db.pragma('table_info(agent_org_post_apply_events)') as { name: string }[]
  ).map((c) => c.name);
  if (!postApplyEventCols.includes('repair_attempt_count')) {
    db.exec(`ALTER TABLE agent_org_post_apply_events ADD COLUMN repair_attempt_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!postApplyEventCols.includes('repair_recheck_after')) {
    db.exec(`ALTER TABLE agent_org_post_apply_events ADD COLUMN repair_recheck_after TEXT`);
  }

  // ── C6 — versioned calibration observations ───────────────────────────────
  //
  // Append-only ledger: one row per real observation (an experiment/human
  // decision, plus any later post-deploy regression measurement) for a
  // generator/detector/kind/treatment/metric version family. Deliberately
  // NOT unique on the family tuple — many observations legitimately share the
  // same family over time, and it is exactly that accumulation the
  // calibration snapshot (calibration_snapshot_service.ts) reads to decide
  // whether the family has enough evidence to be calibrated at all. No
  // update/delete path: an observation is written once and never mutated,
  // enforced below the same way agent_org_experiments' spec columns are.
  //
  // C6 (repair item 2) — owner_id is historical ledger provenance, not a live
  // user reference. A foreign key with ON DELETE SET NULL would internally
  // UPDATE this immutable row and make user deletion impossible.
  // source_event_id + observation_type (+ owner) are UNIQUE via the
  // COALESCE expression index below, so a caller may safely re-attempt
  // recording the SAME deterministic event without ever duplicating it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS calibration_observations (
      id TEXT PRIMARY KEY,
      owner_id INTEGER,
      source_event_id TEXT NOT NULL,
      observation_type TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      experiment_id TEXT,
      generator_version TEXT NOT NULL,
      detector_version TEXT NOT NULL,
      kind TEXT NOT NULL,
      treatment_version TEXT NOT NULL,
      metric_version TEXT NOT NULL,
      initial_confidence REAL NOT NULL,
      human_decision TEXT,
      experiment_decision TEXT,
      experiment_effect REAL,
      post_deploy_regression REAL,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  // Additive backfill for a DB that already created the table in its
  // pre-repair shape (no owner_id/source_event_id/observation_type/
  // proposal_id/experiment_id columns). Never inferred: owner stays NULL,
  // source_event_id becomes the row's own immutable id, observation_type
  // becomes 'legacy'. The immutable no-update trigger (created below) is
  // dropped for the duration of this ONE backfill UPDATE and recreated
  // immediately after — this block runs at most once per database, gated
  // on the column check, exactly like every other guarded ALTER in this file.
  const calibrationObservationCols = (
    db.pragma('table_info(calibration_observations)') as { name: string }[]
  ).map((c) => c.name);
  if (!calibrationObservationCols.includes('owner_id')) {
    db.exec(`
      ALTER TABLE calibration_observations ADD COLUMN owner_id INTEGER;
      ALTER TABLE calibration_observations ADD COLUMN source_event_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE calibration_observations ADD COLUMN observation_type TEXT NOT NULL DEFAULT 'legacy';
      ALTER TABLE calibration_observations ADD COLUMN proposal_id TEXT NOT NULL DEFAULT 'legacy-unknown';
      ALTER TABLE calibration_observations ADD COLUMN experiment_id TEXT;
      DROP TRIGGER IF EXISTS calibration_observations_no_update;
      UPDATE calibration_observations SET source_event_id = id WHERE source_event_id = '';
      CREATE TRIGGER calibration_observations_no_update
      BEFORE UPDATE ON calibration_observations
      BEGIN
        SELECT RAISE(ABORT, 'calibration observations are immutable once recorded');
      END;
    `);
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_calibration_observations_family
       ON calibration_observations(generator_version, detector_version, kind, treatment_version, metric_version)`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_calibration_observations_event_identity
       ON calibration_observations(COALESCE(owner_id, -1), source_event_id, observation_type)`,
  );
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS calibration_observations_no_update
    BEFORE UPDATE ON calibration_observations
    BEGIN
      SELECT RAISE(ABORT, 'calibration observations are immutable once recorded');
    END;
    CREATE TRIGGER IF NOT EXISTS calibration_observations_no_delete
    BEFORE DELETE ON calibration_observations
    BEGIN
      SELECT RAISE(ABORT, 'calibration observations are immutable once recorded');
    END;
  `);

  // C6 (repair item 3) — a truthful, versioned confidence mapped ONCE at
  // proposal creation from the generator's own high/medium/low diagnosis
  // verdict. Never inferred/backfilled for pre-existing rows — both stay
  // NULL, matching the additive-nullable-column convention used throughout
  // this file (e.g. owner_user_id above).
  const proposalDiagnosisConfidenceCols = (
    db.pragma('table_info(agent_org_proposals)') as { name: string }[]
  ).map((c) => c.name);
  if (!proposalDiagnosisConfidenceCols.includes('diagnosis_confidence')) {
    db.exec(`ALTER TABLE agent_org_proposals ADD COLUMN diagnosis_confidence REAL`);
  }
  if (!proposalDiagnosisConfidenceCols.includes('diagnosis_confidence_version')) {
    db.exec(`ALTER TABLE agent_org_proposals ADD COLUMN diagnosis_confidence_version TEXT`);
  }

  // ── D1.1 (#1426) — tool safety reports (sandbox vetting record) ──────────
  //
  // One row per sandbox vetting run for a `tool-install` agent_org_proposals
  // row (see tool_sandbox_vetter.ts, D1.2). Every observational column is an
  // aggregate (a count, a JSON array of {path/host, count} descriptors, a
  // closed enum) — never raw prompt text, raw tool output, or raw credential
  // bytes. The repository layer (tool_safety_reports_repository.ts)
  // additionally redacts secret shapes out of the JSON blob columns before
  // every write, the same way post_apply_events_repository.ts does for its
  // own snapshot columns. Postgres twin in postgres_bootstrap.ts — enforced
  // by skill_schema_parity.test.ts. Not UNIQUE on proposal_id: a proposal may
  // legitimately be re-vetted (e.g. after a sandbox-unavailable result), and
  // the repository's find-by-proposal-id reads the most recent row.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_safety_reports (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES agent_org_proposals(id),
      tool_name TEXT NOT NULL,
      tool_version TEXT,
      package_source TEXT NOT NULL,
      install_method TEXT NOT NULL,
      sandbox_duration_ms INTEGER NOT NULL,
      test_prompts_run_count INTEGER NOT NULL DEFAULT 0,
      forbidden_path_violations_json TEXT NOT NULL DEFAULT '[]',
      network_calls_observed_json TEXT NOT NULL DEFAULT '[]',
      file_system_writes_observed_json TEXT NOT NULL DEFAULT '[]',
      credential_access_attempts_count INTEGER NOT NULL DEFAULT 0,
      verdict TEXT NOT NULL CHECK (verdict IN ('safe', 'conditional', 'unsafe', 'unknown')),
      reason TEXT,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tool_safety_reports_proposal
       ON tool_safety_reports(proposal_id)`,
  );
}
