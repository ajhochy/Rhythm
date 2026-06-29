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
      email_notifications_enabled INTEGER NOT NULL DEFAULT 1,
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

  // Claude collaborator trigger queue
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_claude_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      triggered_by_user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pending_claude_triggers_created_at ON pending_claude_triggers(created_at)`);

  // Agent Sessions (SQLite-only — intentionally local-device, no Postgres path)
  //
  // agent_kind TEXT — logical foreign key to agent_configs.id (not enforced at the SQLite level).
  // Valid values are the id column of the agent_configs table (e.g. 'claude-code', 'codex',
  // 'gemini-cli', 'opencode'). The migration block below normalises any historical variant
  // spellings so that every row references a valid agent_configs.id after migrations run.
  // Do NOT add a SQLite FOREIGN KEY constraint here — this repo does not enable FK enforcement
  // globally, and doing so would cascade-affect unrelated tables.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      -- agent_kind references agent_configs.id (logical FK, not enforced at the DB level)
      agent_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting',
      session_token TEXT,
      cwd TEXT NOT NULL,
      name TEXT NOT NULL,
      last_preview TEXT,
      last_activity_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_task_id ON agent_sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);

    CREATE TABLE IF NOT EXISTS agent_session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      stripped_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_agent_configs_enabled ON agent_configs(enabled);
  `);

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
  // This UPDATE is idempotent — it re-asserts the same values that the seed INSERT set,
  // ensuring any existing dev DB that ran the original seed is aligned with the verified
  // values after this migration block executes.
  db.exec(`
    UPDATE agent_configs
    SET
      command        = 'gemini',
      can_resume     = 0,
      resume_command = NULL,
      session_id_pattern = NULL,
      output_marker  = '✦',
      updated_at     = datetime('now')
    WHERE id = 'gemini-cli';
  `);

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
  // This UPDATE is idempotent — it re-asserts the same values that the seed INSERT set
  // (with can_resume now corrected to 1), ensuring any existing dev DB is aligned with
  // the verified values after this migration block executes.
  db.exec(`
    UPDATE agent_configs
    SET
      command            = 'opencode',
      can_resume         = 1,
      resume_command     = 'opencode --session {{sessionId}}',
      session_id_pattern = '(ses_[a-zA-Z0-9]{10,})',
      output_marker      = '│',
      updated_at         = datetime('now')
    WHERE id = 'opencode';
  `);

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
      updated_at = datetime('now')
    WHERE id = 'opencode' AND label = 'OpenCode';
  `);

  // agent_notifications — local delivery store for MCP-initiated push notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_scheduled_tasks_next_run
      ON agent_scheduled_tasks(next_run_at)
      WHERE enabled = 1 AND next_run_at IS NOT NULL;
  `);

  // agent_memory — persistent facts extracted by the memory consolidation loop.
  // SQLite FTS5 virtual table enables full-text search over content.
  // The base row stores metadata; the FTS index stores the searchable text.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'fact',  -- 'fact' | 'preference' | 'context'
      content TEXT NOT NULL,
      source TEXT,                        -- 'session' | 'scheduler' | 'manual'
      source_id TEXT,                     -- e.g. session_id or scheduled_task_id
      tags_json TEXT NOT NULL DEFAULT '[]',
      owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_owner ON agent_memory(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_kind ON agent_memory(kind);
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_skill_versions_skill_id
      ON agent_skill_versions(skill_id);
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_webhook_endpoints_enabled
      ON agent_webhook_endpoints(enabled);
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
      requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_research_jobs_status
      ON agent_research_jobs(status);
  `);

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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_cookbook_created_at ON agent_cookbook(created_at);
  `);

  // D1 — agent_designs: records of Canva designs produced by Gallery agent sessions.
  // session_id is a nullable logical FK to agent_sessions.id (not enforced at SQLite level).
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_designs (
      id TEXT PRIMARY KEY,
      title TEXT,
      canva_url TEXT,
      thumbnail_url TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_designs_created_at ON agent_designs(created_at);
  `);

  // ── Agent Config Profile Extensions ──────────────────────────────────────
  // Add manager/specialist profile columns to agent_configs (additive).
  // is_manager: exactly one manager agent; all others are specialists.
  // system_prompt: custom system prompt for this profile.
  // allowed_mcps_json / allowed_skills_json: capability scoping per profile.
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
  if (!agentConfigCols.includes('allowed_delegates_json')) {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN allowed_delegates_json TEXT`);
  }

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
}
