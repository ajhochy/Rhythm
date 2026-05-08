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
