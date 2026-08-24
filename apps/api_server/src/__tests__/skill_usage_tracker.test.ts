/**
 * Tests for skill_usage_tracker.countSkillToolUses — the #929 real-usage
 * signal for file-only harvested skills (no #792 sidecar row to increment).
 * Mirrors org_exercised_tools_resolver.test.ts's tool-part insertion pattern
 * (agent_session_messages.parts_json is the same telemetry source).
 *
 * W3 late-review corrective package — countSkillToolUses now joins
 * agent_session_messages to their owning agent_sessions row and only counts a
 * completed skill-tool call when evaluateLearningSessionEligibility (the SAME
 * shared predicate learning_session_eligibility.ts uses for harvest gating)
 * says the session is eligible. These tests seed REAL rows through the actual
 * migrated SQLite schema (runMigrations + real INSERT statements), not mocks,
 * so a schema/column-name drift between this tracker and the eligibility
 * predicate would fail here.
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

interface SessionOverrides {
  isSystem?: 0 | 1;
  category?: string | null;
  mcpRole?: string | null;
}

/** Insert a parent agent_sessions row so message FK (ON DELETE CASCADE) holds. */
function seedSession(id: string, overrides: SessionOverrides = {}): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, is_system, category, mcp_role)
       VALUES (?, 'claude-code', 'idle', '/tmp', 'usage-test', ?, ?, ?)`,
    )
    .run(
      id,
      overrides.isSystem ?? 0,
      overrides.category === undefined ? 'chat' : overrides.category,
      overrides.mcpRole ?? null,
    );
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

  // ── W3 late-review corrective package: eligibility-gated counting ─────────
  // countSkillToolUses must not let internal optimizer/scheduled/system skill
  // invocations advance harvested-draft evaluation thresholds. Every case here
  // seeds a REAL agent_sessions row through the actual migrated schema.

  it('counts a completed skill call from an ordinary user chat session', () => {
    seedSession('sess-chat', { isSystem: 0, category: 'chat', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-chat',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBe(1);
  });

  it('does NOT count a completed skill call from an is_system=1 session', () => {
    seedSession('sess-system', { isSystem: 1, category: 'chat', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-system',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a category=self_improvement session', () => {
    seedSession('sess-self-improve', { isSystem: 0, category: 'self_improvement', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-self-improve',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a category=scheduled session', () => {
    seedSession('sess-scheduled', { isSystem: 0, category: 'scheduled', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-scheduled',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a curator mcp_role session', () => {
    seedSession('sess-curator', { isSystem: 0, category: 'chat', mcpRole: 'skill-extract' });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-curator',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a session with corrupt/unknown category metadata', () => {
    seedSession('sess-corrupt-category', { isSystem: 0, category: 'not_a_real_category', mcpRole: null });
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-corrupt-category',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBeUndefined();
  });

  it('does NOT count a completed skill call from a session with a corrupt (non-0/1) is_system value', () => {
    // Realistic corruption: a bad write/migration leaves is_system as neither
    // 0 nor 1. The shared predicate must fail closed rather than treat any
    // truthy/falsy-looking integer as a real boolean.
    seedSession('sess-corrupt-is-system', { isSystem: 0, category: 'chat', mcpRole: null });
    getDb().prepare(`UPDATE agent_sessions SET is_system = 2 WHERE id = ?`).run('sess-corrupt-is-system');
    new AgentSessionMessagesRepository().upsertStructured(
      'sess-corrupt-is-system',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBeUndefined();
  });

  it('does not count a pending/error skill-tool call from an otherwise-eligible session', () => {
    seedSession('sess-pending-error', { isSystem: 0, category: 'chat', mcpRole: null });
    const repo = new AgentSessionMessagesRepository();
    repo.upsertStructured(
      'sess-pending-error',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi', 'error')]),
      null,
      null,
    );
    repo.upsertStructured(
      'sess-pending-error',
      'msg-2',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi', 'pending')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBeUndefined();
  });

  it('counts only the eligible session out of a mix of eligible/ineligible sessions', () => {
    seedSession('sess-eligible', { isSystem: 0, category: 'chat', mcpRole: null });
    seedSession('sess-system-ineligible', { isSystem: 1, category: 'chat', mcpRole: null });
    seedSession('sess-scheduled-ineligible', { isSystem: 0, category: 'scheduled', mcpRole: null });

    const repo = new AgentSessionMessagesRepository();
    repo.upsertStructured('sess-eligible', 'msg-1', 'output', JSON.stringify([skillToolPart('rebuild-abi')]), null, null);
    repo.upsertStructured('sess-eligible', 'msg-2', 'output', JSON.stringify([skillToolPart('rebuild-abi')]), null, null);
    repo.upsertStructured(
      'sess-system-ineligible',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );
    repo.upsertStructured(
      'sess-scheduled-ineligible',
      'msg-1',
      'output',
      JSON.stringify([skillToolPart('rebuild-abi')]),
      null,
      null,
    );

    expect(countSkillToolUses().get('rebuild-abi')).toBe(2);
  });
});
