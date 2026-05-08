import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';

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

  it('seeds exactly four preset rows', () => {
    const db = makeDb();
    const count = (
      db.prepare(`SELECT COUNT(*) as cnt FROM agent_configs`).get() as { cnt: number }
    ).cnt;
    expect(count).toBe(4);
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
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
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
    expect(row?.output_marker).toBe('✦');
    expect(row?.preset_id).toBe('gemini-cli');
  });

  it('seeds correct values for opencode row', () => {
    const db = makeDb();
    const row = db
      .prepare(`SELECT * FROM agent_configs WHERE id = 'opencode'`)
      .get() as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.label).toBe('OpenCode');
    expect(row?.command).toBe('opencode');
    expect(row?.can_resume).toBe(0);
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
    expect(count).toBe(4);
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
