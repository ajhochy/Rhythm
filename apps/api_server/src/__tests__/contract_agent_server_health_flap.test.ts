/**
 * CONTRACT TEST — agent-server-health-flap-c1.
 *
 * Bug this catches: `countSkillToolUses` walked the entire
 * `agent_session_messages` history in ONE synchronous `.iterate()` loop. On a
 * 4 GB production database that is a 14–30 s pread-bound stall of the Node
 * event loop, during which `/health` cannot answer, the Flutter HealthPoller
 * declares the local agent server lost, and the user sees "Agent server
 * unavailable" (2026-09-17 disconnect triage; residual of #1494).
 *
 * The assertion that fails on the synchronous implementation: a macrotask
 * queued with `setImmediate` BEFORE the count starts must run BEFORE the count
 * resolves. A synchronous scan returns without ever draining the macrotask
 * queue, so `ticked` is still false when the (non-)promise settles.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { countSkillToolUses } from '../services/skill_usage_tracker';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function skillToolPart(name: string) {
  return { type: 'tool', id: `part-${name}-${Math.random()}`, tool: 'skill', state: { status: 'completed', input: { name } } };
}

beforeEach(() => {
  setDb(makeDb());
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, is_system, category, mcp_role)
       VALUES ('sess-1', 'claude-code', 'idle', '/tmp', 'contract', 0, 'chat', NULL)`,
    )
    .run();
  const repo = new AgentSessionMessagesRepository();
  for (let i = 0; i < 1200; i++) {
    repo.upsertStructured(
      'sess-1',
      `msg-${i}`,
      'output',
      JSON.stringify([skillToolPart(i % 2 === 0 ? 'alpha' : 'beta'), { type: 'text', text: 'x'.repeat(200) }]),
      null,
      null,
    );
  }
});

describe('agent-server-health-flap-c1: usage scan yields to the event loop', () => {
  it('lets a queued macrotask run before the count resolves, and still counts correctly', async () => {
    let ticked = false;
    setImmediate(() => {
      ticked = true;
    });
    const counts = await countSkillToolUses();
    expect(ticked).toBe(true);
    expect(counts.get('alpha')).toBe(600);
    expect(counts.get('beta')).toBe(600);
  });
});
