import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { scanContextContent } from '../security/context_scanner';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('agent_configs migration', () => {
  it('creates the agent_configs table', () => {
    const db = makeDb();
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_configs'`)
      .get() as { name: string } | undefined;
    expect(table).toBeDefined();
    expect(table?.name).toBe('agent_configs');
  });

  it('seeds exactly four preset rows plus the Config Doctor and Rhythm Setup profiles', () => {
    const db = makeDb();
    const count = (
      db.prepare(`SELECT COUNT(*) as cnt FROM agent_configs`).get() as { cnt: number }
    ).cnt;
    // 4 presets + config-doctor (#900) + rhythm-setup (#911)
    expect(count).toBe(6);
  });

  it('Config Doctor system prompt passes the context scanner (never silently orphaned)', () => {
    // Regression guard: writeAgentProfileFile() silently skips writing the
    // ~/.config/opencode/agents/config-doctor.md file (never throws — just
    // logs a warning) if the stored systemPrompt trips the prompt-injection
    // scanner. A skipped write means every session routed to this profile
    // crashes with "UnknownError: UnknownError" the moment you message it —
    // this exact bug happened once already (a ".env" file reference tripped
    // the secrets-dotenv pattern). This test catches a future edit to the
    // seeded prompt reintroducing a trigger phrase before it ships.
    const db = makeDb();
    const row = db
      .prepare(`SELECT system_prompt FROM agent_configs WHERE id = 'config-doctor'`)
      .get() as { system_prompt: string } | undefined;
    expect(row).toBeDefined();
    const scan = scanContextContent(row!.system_prompt, 'agent profile "config-doctor"');
    expect(scan.blocked).toBe(false);
    expect(row!.system_prompt).toContain('opencode core permissions');
    expect(row!.system_prompt).toContain('Never add `bash`, `read`, `edit`');
    expect(row!.system_prompt).toContain('use `rhythm`, never `Rhythm`');
  });

  it('repairs known fail-open scope rows for the #916/#923 contract flip', () => {
    const db = makeDb();

    const configDoctor = db
      .prepare(`SELECT allowed_mcps_json, core_permissions_json FROM agent_configs WHERE id = 'config-doctor'`)
      .get() as { allowed_mcps_json: string | null; core_permissions_json: string | null };
    expect(configDoctor.allowed_mcps_json).toBe(JSON.stringify(['rhythm']));
    expect(JSON.parse(configDoctor.core_permissions_json!)).toEqual({ bash: 'ask' });

    const oldOrgOptimizerMcp = JSON.stringify({
      rhythm: {
        inherit: true,
        allowedTools: ['rhythm_ping', 'rhythm_get_dashboard'],
      },
    });
    const expectedOrgOptimizerMcp = {
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
    };
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, is_agent, allowed_mcps_json, allowed_skills_json)
       VALUES (?, ?, '', '', 1, ?, ?)`,
    ).run('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f', 'Org Optimizer', oldOrgOptimizerMcp, '[]');
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, is_agent, allowed_mcps_json, allowed_skills_json)
       VALUES (?, ?, '', '', 1, ?, ?)`,
    ).run('money', 'Money', '[]', '[]');
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, is_agent, allowed_mcps_json, allowed_skills_json)
       VALUES (?, ?, '', '', 1, ?, ?)`,
    ).run('legacy-empty', 'Legacy Empty', '[]', '[]');

    runMigrations(db);

    const rows = db
      .prepare(
        `SELECT id, allowed_mcps_json, allowed_skills_json
           FROM agent_configs
          WHERE id IN ('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f', 'money', 'legacy-empty')`,
      )
      .all() as Array<{
        id: string;
        allowed_mcps_json: string | null;
        allowed_skills_json: string | null;
      }>;
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(
      JSON.parse(
        byId.get('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f')!.allowed_mcps_json!,
      ),
    ).toEqual(expectedOrgOptimizerMcp);
    expect(byId.get('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f')!.allowed_skills_json).toBeNull();
    expect(byId.get('money')!.allowed_mcps_json).toBeNull();
    expect(byId.get('money')!.allowed_skills_json).toBeNull();
    expect(byId.get('legacy-empty')!.allowed_mcps_json).toBeNull();
    expect(byId.get('legacy-empty')!.allowed_skills_json).toBeNull();
  });

  it('repairs profile allowlist and model hygiene for #917/#918/#919', () => {
    const db = makeDb();

    const theologianMcp = {
      rhythm: ['rhythm_ping', 'rhythm_remember', 'rhythm_search_context'],
    };
    const worshipPlanningMcp = {
      rhythm: ['rhythm_ping', 'rhythm_remember', 'rhythm_search_context'],
      calendar: ['list_events', 'get_event', 'list_calendars'],
    };
    const aiTrendMcp = [
      'memory',
      'obsidian',
      'pdf-tools',
      'duckduckgo',
      'scrapling',
      'minutes',
      'youtube-transcript',
      'github-readonly',
      'rhythm',
    ];
    const aiTrendSkills = [
      'research-synthesis',
      'obsidian-markdown',
      'obsidian-cli',
      'obsidian-bases',
    ];
    const theologicalMcp = [
      'memory',
      'obsidian',
      'rhythm',
      'pdf-tools',
      'scrapling',
      'minutes',
      'youtube-transcript',
      'github-readonly',
    ];
    const theologicalSkills = ['research-synthesis', 'obsidian-cli', 'obsidian-markdown'];

    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, allowed_mcps_json)
       VALUES (?, ?, '', '', 1, 1, 1, ?)`,
    ).run('theologian', 'Theologian', JSON.stringify(theologianMcp));
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, allowed_mcps_json)
       VALUES (?, ?, '', '', 1, 1, 1, ?)`,
    ).run('worship-planning', 'Worship Planning', JSON.stringify(worshipPlanningMcp));
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, model_provider, model_id)
       VALUES (?, ?, '', '', 1, 1, 0, 'openrouter', 'openrouter/free')`,
    ).run('coding-agent', 'Coding Agent');
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, model_provider, model_id)
       VALUES (?, ?, '', '', 1, 1, 1, 'anthropic', 'claude-opus-4-7')`,
    ).run('worship-production', 'Worship Production');
    for (const id of ['title', 'compaction', 'summary']) {
      db.prepare(
        `INSERT INTO agent_configs
          (id, label, icon, command, enabled, is_agent, session_selectable, model_provider, model_id)
         VALUES (?, ?, '', '', 1, 1, 0, 'anthropic', 'claude-sonnet-4-6')`,
      ).run(id, id);
    }
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, allowed_mcps_json, allowed_skills_json)
       VALUES (?, ?, '', '', 0, 1, 0, ?, ?)`,
    ).run(
      '32294c7d-a26e-4e3a-b5f1-92350225e701',
      'AI Trend Researcher',
      JSON.stringify(aiTrendMcp),
      JSON.stringify(aiTrendSkills),
    );
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, allowed_mcps_json, allowed_skills_json)
       VALUES (?, ?, '', '', 1, 1, 1, ?, NULL)`,
    ).run('AI-Trend-Researcher', 'AI Trend Researcher', '["rhythm", "obsidian"]');
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, allowed_mcps_json, allowed_skills_json)
       VALUES (?, ?, '', '', 0, 1, 0, ?, ?)`,
    ).run(
      'd74b471f-ca90-4246-8182-e769b10d80c6',
      'Theological Researcher',
      JSON.stringify(theologicalMcp),
      JSON.stringify(theologicalSkills),
    );
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, allowed_mcps_json, allowed_skills_json)
       VALUES (?, ?, '', '', 1, 1, 1, ?, NULL)`,
    ).run('Theological-Researcher', 'Theological Researcher', '["rhythm","obsidian"]');
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, enabled, is_agent, session_selectable, allowed_skills_json)
       VALUES (?, ?, '', '', 0, 1, 0, ?)`,
    ).run(
      'research',
      'Research',
      JSON.stringify([
        'research-synthesis',
        'study-passage',
        'searxng-search',
        'duckduckgo-search',
        'scrapling',
        'domain-intel',
        'parallel-cli',
      ]),
    );

    runMigrations(db);

    const rows = db
      .prepare(
        `SELECT id, model_provider, model_id, model_tier_hint, allowed_mcps_json, allowed_skills_json, core_permissions_json
           FROM agent_configs
          WHERE id IN (
            'theologian',
            'worship-planning',
            'coding-agent',
            'worship-production',
            'title',
            'compaction',
            'summary',
            'AI-Trend-Researcher',
            'Theological-Researcher',
            'research'
          )`,
      )
      .all() as Array<{
        id: string;
        model_provider: string | null;
        model_id: string | null;
        model_tier_hint: string | null;
        allowed_mcps_json: string | null;
        allowed_skills_json: string | null;
        core_permissions_json: string | null;
      }>;
    const byId = new Map(rows.map((row) => [row.id, row]));

    const theologian = JSON.parse(byId.get('theologian')!.allowed_mcps_json!) as Record<string, string[]>;
    expect(theologian.rhythm).toEqual([
      'rhythm_ping',
      'rhythm_remember_memory',
      'rhythm_search_memory',
    ]);

    const worshipPlanning = JSON.parse(
      byId.get('worship-planning')!.allowed_mcps_json!,
    ) as Record<string, string[]>;
    expect(worshipPlanning.calendar).toBeUndefined();
    expect(worshipPlanning.rhythm).toEqual([
      'rhythm_ping',
      'rhythm_remember_memory',
      'rhythm_search_memory',
      'rhythm_list_calendar_events',
      'rhythm_create_calendar_event',
      'rhythm_update_calendar_event',
    ]);

    expect(byId.get('coding-agent')!.model_provider).toBe('openrouter');
    expect(byId.get('coding-agent')!.model_id).toBe('anthropic/claude-sonnet-4.6');
    expect(byId.get('worship-production')!.model_id).toBe('claude-sonnet-4-6');
    expect(byId.get('worship-production')!.model_tier_hint).toBe('cheap');
    for (const id of ['title', 'compaction', 'summary']) {
      expect(byId.get(id)!.model_id).toBe('claude-haiku-4-5');
      expect(byId.get(id)!.model_tier_hint).toBe('cheap');
    }

    expect(JSON.parse(byId.get('AI-Trend-Researcher')!.allowed_mcps_json!)).toEqual(aiTrendMcp);
    expect(JSON.parse(byId.get('AI-Trend-Researcher')!.allowed_skills_json!)).toEqual(aiTrendSkills);
    expect(JSON.parse(byId.get('Theological-Researcher')!.allowed_mcps_json!)).toEqual(theologicalMcp);
    expect(JSON.parse(byId.get('Theological-Researcher')!.allowed_skills_json!)).toEqual(theologicalSkills);
    expect(JSON.parse(byId.get('Theological-Researcher')!.core_permissions_json!)).toEqual({
      skill: 'allow',
      read: 'allow',
      bash: 'ask',
    });
    expect(JSON.parse(byId.get('research')!.allowed_skills_json!)).toEqual([
      'research-synthesis',
      'study-passage',
      'duckduckgo-search',
      'scrapling',
    ]);

    const allAllowedMcps = rows.map((row) => row.allowed_mcps_json ?? '').join('\n');
    expect(allAllowedMcps).not.toContain('"rhythm_remember"');
    expect(allAllowedMcps).not.toContain('"rhythm_search_context"');
    expect(allAllowedMcps).not.toContain('"calendar"');
  });

  it('has correct column shape', () => {
    const db = makeDb();
    const cols = (db.pragma('table_info(agent_configs)') as { name: string }[]).map(
      (c) => c.name,
    );
    const expected = [
      'id',
      'label',
      'icon',
      'command',
      'enabled',
      'is_agent',
      'can_resume',
      'resume_command',
      'session_id_pattern',
      'output_marker',
      'preset_id',
      'sort_order',
      'created_at',
      'updated_at',
      'allowed_delegates_json',
      'core_permissions_json',
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  it('clears misleading non-manager delegation rosters for worship-planning and theologian', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, is_agent, is_manager, allowed_delegates_json)
       VALUES (?, ?, '', '', 1, ?, ?)`,
    ).run('worship-planning', 'Worship Planning', 0, JSON.stringify(['someone']));
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, is_agent, is_manager, allowed_delegates_json)
       VALUES (?, ?, '', '', 1, ?, ?)`,
    ).run('theologian', 'Theologian', 0, JSON.stringify(['someone']));
    db.prepare(
      `INSERT INTO agent_configs
        (id, label, icon, command, is_agent, is_manager, allowed_delegates_json)
       VALUES (?, ?, '', '', 1, ?, ?)`,
    ).run('secretary', 'Secretary', 1, JSON.stringify(['worship-planning']));

    runMigrations(db);

    const rows = db
      .prepare(`SELECT id, allowed_delegates_json FROM agent_configs WHERE id IN ('worship-planning', 'theologian', 'secretary')`)
      .all() as Array<{ id: string; allowed_delegates_json: string | null }>;
    const byId = new Map(rows.map((row) => [row.id, row.allowed_delegates_json]));
    expect(byId.get('worship-planning')).toBeNull();
    expect(byId.get('theologian')).toBeNull();
    expect(byId.get('secretary')).toBe(JSON.stringify(['worship-planning']));
  });

  it('seeds correct values for claude-code row', () => {
    const db = makeDb();
    const row = db
      .prepare(`SELECT * FROM agent_configs WHERE id = 'claude-code'`)
      .get() as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.label).toBe('Claude Code');
    expect(row?.icon).toBe('assets/agents/claude-code.png');
    expect(row?.command).toBe('claude');
    expect(row?.is_agent).toBe(1);
    expect(row?.can_resume).toBe(1);
    expect(row?.resume_command).toBe('claude --resume {{sessionId}}');
    expect(row?.session_id_pattern).toBe(
      'Session ID:\\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
    );
    expect(row?.output_marker).toBe('⏺');
    expect(row?.preset_id).toBe('claude-code');
  });

  it('seeds correct values for codex row', () => {
    const db = makeDb();
    const row = db
      .prepare(`SELECT * FROM agent_configs WHERE id = 'codex'`)
      .get() as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.label).toBe('Codex');
    expect(row?.command).toBe('codex');
    expect(row?.can_resume).toBe(0);
    expect(row?.resume_command).toBeNull();
    expect(row?.session_id_pattern).toBeNull();
    expect(row?.output_marker).toBe('•');
    expect(row?.preset_id).toBe('codex');
  });

  it('seeds correct values for gemini-cli row', () => {
    const db = makeDb();
    const row = db
      .prepare(`SELECT * FROM agent_configs WHERE id = 'gemini-cli'`)
      .get() as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.label).toBe('Gemini CLI');
    expect(row?.command).toBe('gemini');
    expect(row?.can_resume).toBe(0);
    // Interactive PTY mode does not emit a parseable session ID — see migration comment
    // in migrations.ts (issue #497) for full rationale.
    expect(row?.session_id_pattern).toBeNull();
    expect(row?.resume_command).toBeNull();
    expect(row?.output_marker).toBe('✦');
    expect(row?.preset_id).toBe('gemini-cli');
  });

  it('seeds correct values for opencode row', () => {
    const db = makeDb();
    const row = db
      .prepare(`SELECT * FROM agent_configs WHERE id = 'opencode'`)
      .get() as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.label).toBe('OpenRouter');
    expect(row?.command).toBe('opencode');
    // Issue #498: can_resume is 1 — opencode --session <id> successfully resumes sessions.
    expect(row?.can_resume).toBe(1);
    expect(row?.resume_command).toBe('opencode --session {{sessionId}}');
    // session_id_pattern captures the ses_* ID emitted in every JSON event line.
    expect(row?.session_id_pattern).toBe('(ses_[a-zA-Z0-9]{10,})');
    expect(row?.output_marker).toBe('│');
    expect(row?.preset_id).toBe('opencode');
  });

  it('is idempotent — re-running migrations does not error or create duplicate rows', () => {
    const db = makeDb();
    // Run migrations a second time on the same DB — should not throw
    expect(() => runMigrations(db)).not.toThrow();
    const count = (
      db.prepare(`SELECT COUNT(*) as cnt FROM agent_configs`).get() as { cnt: number }
    ).cnt;
    expect(count).toBe(6);
  });
});

describe('agent_sessions.agent_kind normalisation (issue #483)', () => {
  it('normalises claudeCode to claude-code after migrations run', () => {
    // Insert a legacy row BEFORE running migrations so we can verify the UPDATE fires.
    // We use a raw DB without migrations first, insert the row, then run migrations.
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF'); // skip FK enforcement so we can insert without full schema

    // Create a minimal agent_sessions table with the legacy agent_kind value
    db.exec(`
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        agent_kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting',
        session_token TEXT,
        cwd TEXT NOT NULL,
        name TEXT NOT NULL,
        last_preview TEXT,
        last_activity_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`
      INSERT INTO agent_sessions (id, agent_kind, cwd, name)
      VALUES ('test-session-1', 'claudeCode', '/tmp', 'Legacy session')
    `);

    // Now run full migrations — the normalisation UPDATE should fire
    runMigrations(db);

    const row = db
      .prepare(`SELECT agent_kind FROM agent_sessions WHERE id = 'test-session-1'`)
      .get() as { agent_kind: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.agent_kind).toBe('claude-code');
  });

  it('normalises codexCli to codex after migrations run', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');

    db.exec(`
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        agent_kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting',
        session_token TEXT,
        cwd TEXT NOT NULL,
        name TEXT NOT NULL,
        last_preview TEXT,
        last_activity_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`
      INSERT INTO agent_sessions (id, agent_kind, cwd, name)
      VALUES ('test-session-2', 'codexCli', '/tmp', 'Legacy codex session')
    `);

    runMigrations(db);

    const row = db
      .prepare(`SELECT agent_kind FROM agent_sessions WHERE id = 'test-session-2'`)
      .get() as { agent_kind: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.agent_kind).toBe('codex');
  });

  it('normalises legacy claude spelling to claude-code', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');

    db.exec(`
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        agent_kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting',
        session_token TEXT,
        cwd TEXT NOT NULL,
        name TEXT NOT NULL,
        last_preview TEXT,
        last_activity_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`
      INSERT INTO agent_sessions (id, agent_kind, cwd, name)
      VALUES ('test-session-3', 'claude', '/tmp', 'Legacy claude session')
    `);

    runMigrations(db);

    const row = db
      .prepare(`SELECT agent_kind FROM agent_sessions WHERE id = 'test-session-3'`)
      .get() as { agent_kind: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.agent_kind).toBe('claude-code');
  });

  it('already-normalised values are unchanged', () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO agent_sessions (id, agent_kind, cwd, name)
      VALUES ('test-session-4', 'claude-code', '/tmp', 'Normal session')
    `);
    // Re-run migrations — idempotency check
    runMigrations(db);

    const row = db
      .prepare(`SELECT agent_kind FROM agent_sessions WHERE id = 'test-session-4'`)
      .get() as { agent_kind: string } | undefined;
    expect(row?.agent_kind).toBe('claude-code');
  });
});
