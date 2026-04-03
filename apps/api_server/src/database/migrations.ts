import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      source_type TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recurring_task_rules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      frequency TEXT NOT NULL,
      day_of_week INTEGER,
      day_of_month INTEGER,
      month INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      anchor_type TEXT NOT NULL DEFAULT 'date',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_instance_steps (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL REFERENCES project_instances(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES project_template_steps(id),
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS weekly_plans (
      id TEXT PRIMARY KEY,
      week_label TEXT NOT NULL UNIQUE,
      week_start_date TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      google_sub TEXT UNIQUE,
      photo_url TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS message_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      sender_id INTEGER REFERENCES users(id),
      sender_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      capacity INTEGER,
      location TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      reserved_by TEXT NOT NULL,
      reserved_by_user_id INTEGER REFERENCES users(id),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  const stepCols = (db.pragma('table_info(project_instance_steps)') as { name: string }[]).map((c) => c.name);
  if (!stepCols.includes('notes')) {
    db.exec(`ALTER TABLE project_instance_steps ADD COLUMN notes TEXT`);
  }

  const instanceCols = (db.pragma('table_info(project_instances)') as { name: string }[]).map((c) => c.name);
  if (!instanceCols.includes('name')) {
    db.exec(`ALTER TABLE project_instances ADD COLUMN name TEXT`);
  }

  const recurringRuleCols = (db.pragma('table_info(recurring_task_rules)') as { name: string }[]).map((c) => c.name);
  if (!recurringRuleCols.includes('enabled')) {
    db.exec(`ALTER TABLE recurring_task_rules ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`);
  }
  if (!recurringRuleCols.includes('owner_id')) {
    db.exec(`ALTER TABLE recurring_task_rules ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
  }

  const userCols = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
  if (!userCols.includes('google_sub')) {
    db.exec(`ALTER TABLE users ADD COLUMN google_sub TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL`);
  }
  if (!userCols.includes('photo_url')) {
    db.exec(`ALTER TABLE users ADD COLUMN photo_url TEXT`);
  }

  const reservationCols = (db.pragma('table_info(reservations)') as { name: string }[]).map((c) => c.name);
  if (!reservationCols.includes('reserved_by_user_id')) {
    db.exec(`ALTER TABLE reservations ADD COLUMN reserved_by_user_id INTEGER REFERENCES users(id)`);
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
}
