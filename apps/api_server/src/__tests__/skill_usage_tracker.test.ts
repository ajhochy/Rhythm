/**
 * Tests for skill_usage_tracker.countSkillToolUses — the #929 real-usage
 * signal for file-only harvested skills (no #792 sidecar row to increment).
 * Mirrors org_exercised_tools_resolver.test.ts's tool-part insertion pattern
 * (agent_session_messages.parts_json is the same telemetry source).
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

function skillToolPart(name: string, status = 'completed') {
  return { type: 'tool', id: `part-${name}-${Math.random()}`, tool: 'skill', state: { status, input: { name } } };
}

beforeEach(() => {
  setDb(makeDb());
});

/** Insert a parent agent_sessions row so message FK (ON DELETE CASCADE) holds. */
function seedSession(id: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name)
       VALUES (?, 'claude-code', 'idle', '/tmp', 'usage-test')`,
    )
    .run(id);
}

describe('countSkillToolUses', () => {
  it('counts a completed skill-tool invocation, keyed by the invoked skill name', () => {
    seedSession('sess-1');
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-1',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi'), { type: 'text', text: 'done' }]),
      null,
      null,
    );

    const counts = countSkillToolUses();
    expect(counts.get('rebuild-abi')).toBe(1);
  });

  it('sums invocations of the same skill across multiple sessions/messages', () => {
    seedSession('sess-1');
    seedSession('sess-2');
    const repo = new AgentSessionMessagesRepository();
    repo.upsertStructured('sess-1', 'msg-1', 'output', JSON.stringify([skillToolPart('rebuild-abi')]), null, null);
    repo.upsertStructured('sess-2', 'msg-1', 'output', JSON.stringify([skillToolPart('rebuild-abi')]), null, null);
    repo.upsertStructured('sess-2', 'msg-2', 'output', JSON.stringify([skillToolPart('other-skill')]), null, null);

    const counts = countSkillToolUses();
    expect(counts.get('rebuild-abi')).toBe(2);
    expect(counts.get('other-skill')).toBe(1);
  });

  it('does not count a pending/error skill-tool call (only completed)', () => {
    seedSession('sess-1');
    const repo = new AgentSessionMessagesRepository();
    repo.upsertStructured('sess-1', 'msg-1', 'output', JSON.stringify([skillToolPart('rebuild-abi', 'error')]), null, null);
    repo.upsertStructured('sess-1', 'msg-2', 'output', JSON.stringify([skillToolPart('rebuild-abi', 'pending')]), null, null);

    expect(countSkillToolUses().get('rebuild-abi')).toBeUndefined();
  });

  it('ignores non-skill tool parts', () => {
    seedSession('sess-1');
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-1',
      'msg-1',
      'output',
      JSON.stringify([{ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' } } }]),
      null,
      null,
    );

    expect(countSkillToolUses().size).toBe(0);
  });

  it('returns an empty map when there are no messages at all', () => {
    expect(countSkillToolUses().size).toBe(0);
  });
});
