import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '../database/postgres_bootstrap.ts'), 'utf8');
const pos = (needle: string) => { const n = source.indexOf(needle); expect(n, needle).toBeGreaterThan(-1); return n; };

describe('Free tables in Postgres bootstrap', () => {
  it('fresh execution schema creates agent_sessions before the held-turn foreign key', () => {
    expect(pos('CREATE TABLE IF NOT EXISTS agent_sessions (')).toBeLessThan(pos('CREATE TABLE IF NOT EXISTS agent_held_turns ('));
  });
  it('cloud role returns before every agent-execution Free table', () => {
    const guard = pos('if (!env.agentExecutionEnabled)');
    expect(guard).toBeLessThan(pos('CREATE TABLE IF NOT EXISTS agent_held_turns ('));
    expect(guard).toBeLessThan(pos('CREATE TABLE IF NOT EXISTS agent_free_opt_ins ('));
  });
  it('held-turn FK and indexes stay in one post-session query', () => {
    const start = pos('CREATE TABLE IF NOT EXISTS agent_held_turns (');
    const end = source.indexOf('`);', start);
    const sql = source.slice(start, end);
    expect(sql).toContain('REFERENCES agent_sessions(id) ON DELETE CASCADE');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_agent_held_turns_session_status');
  });
});
