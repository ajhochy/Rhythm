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
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      anchor_type TEXT NOT NULL DEFAULT 'date',
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
      is_facilities_manager INTEGER NOT NULL DEFAULT 0,
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
      building TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      `ALTER TABLE reservations ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
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
        `ALTER TABLE reservation_series ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
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

  // Phase 7: workspaces, collaborators, messaging identity
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'staff',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS task_collaborators (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS project_collaborators (
      project_instance_id TEXT NOT NULL REFERENCES project_instances(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_instance_id, user_id)
    );
  `);

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
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient
      ON notifications(recipient_user_id, read_at);
  `);
}
