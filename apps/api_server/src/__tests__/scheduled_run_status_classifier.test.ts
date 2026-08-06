/**
 * CONTRACT TESTS — classifyDoneRunStatus (the D2 terminal-status classifier).
 *
 * Regression origin (2026-08-04): MUTATION_TOOL_PATTERN was anchored `^`, so it
 * matched none of the 40 distinct tool names a real day of scheduled runs
 * emits — engine tool names are server-namespaced (`obsidian_obsidian_put_file`)
 * and builtins are bare (`write`). Every genuinely successful run was therefore
 * stamped `completed_no_op`. Separately, both signals only looked at the ROOT
 * session, so a manager profile that delegated all its real work also read as a
 * no-op (theological-research wrote 23 vault files through its `librarian`
 * child and still classified as `completed_no_op`).
 *
 * The tool names below are verbatim from that day's transcripts — they are the
 * point of the test, not illustrative filler.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { classifyDoneRunStatus } from '../services/agentSchedulerService';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function insertSession(id: string, parentSessionId: string | null = null) {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, parent_session_id)
       VALUES (?, ?, 'librarian', 'idle', '/tmp', ?)`,
    )
    .run(id, `session ${id}`, parentSessionId);
}

function insertToolEvent(sessionId: string, tool: string, status = 'success') {
  getDb()
    .prepare(
      `INSERT INTO tool_events (id, session_id, sdk_session_id, call_id, tool, started_at, duration_ms, status, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), 10, ?, datetime('now'))`,
    )
    .run(`ev-${sessionId}-${tool}-${Math.random()}`, sessionId, `sdk-${sessionId}`, `call-${tool}`, tool, status);
}

function insertPendingApproval(sessionId: string) {
  getDb()
    .prepare(
      `INSERT INTO agent_approvals (id, session_id, action, status, created_at)
       VALUES (?, ?, 'Do a thing', 'pending', datetime('now'))`,
    )
    .run(`appr-${sessionId}-${Math.random()}`, sessionId);
}

describe('classifyDoneRunStatus', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  // The exact bug: these are real mutating tool names from 2026-08-04 that the
  // `^`-anchored pattern missed entirely.
  it.each([
    'obsidian_obsidian_put_file',
    'obsidian_obsidian_patch_file',
    'obsidian_obsidian_post_file',
    'obsidian_obsidian_append_content',
    'rhythm_rhythm_create_task',
    'rhythm_rhythm_update_task',
    'rhythm_rhythm_remember_memory',
    'rhythm_rhythm_complete_task',
    'write',
    'edit',
    'apply_patch',
  ])('counts %s as a mutation → success', (tool) => {
    insertSession('root');
    insertToolEvent('root', tool);
    expect(classifyDoneRunStatus('root')).toBe('success');
  });

  // Guard the other direction: segment-boundary matching must not turn
  // read-only tools into false successes.
  it.each([
    'read',
    'glob',
    'grep',
    'webfetch',
    'todowrite', // NOT a `write`
    'rhythm_rhythm_preview_automation', // NOT a `view`
    'rhythm_rhythm_request_approval', // asking != doing
    'rhythm_rhythm_list_memories',
    'rhythm_rhythm_search_memory',
    'obsidian_obsidian_simple_search',
    'obsidian_obsidian_get_file',
    'gmail-personal_search_emails',
  ])('treats %s as non-mutating → completed_no_op', (tool) => {
    insertSession('root');
    insertToolEvent('root', tool);
    expect(classifyDoneRunStatus('root')).toBe('completed_no_op');
  });

  it('credits a mutation performed by a delegated child to the root run', () => {
    insertSession('root');
    insertSession('child', 'root');
    insertToolEvent('root', 'read');
    insertToolEvent('child', 'obsidian_obsidian_put_file');
    expect(classifyDoneRunStatus('root')).toBe('success');
  });

  it('credits a mutation from a grandchild (depth 2 delegation)', () => {
    insertSession('root');
    insertSession('child', 'root');
    insertSession('grandchild', 'child');
    insertToolEvent('grandchild', 'rhythm_rhythm_create_task');
    expect(classifyDoneRunStatus('root')).toBe('success');
  });

  it('reports blocked_on_approval when a CHILD holds the pending approval', () => {
    // The live shape: theological-research's `secretary` child left 3 approvals
    // pending while the root looked clean.
    insertSession('root');
    insertSession('child', 'root');
    insertToolEvent('child', 'rhythm_rhythm_create_task');
    insertPendingApproval('child');
    expect(classifyDoneRunStatus('root')).toBe('blocked_on_approval');
  });

  it('prefers blocked_on_approval over success when both signals are present', () => {
    insertSession('root');
    insertToolEvent('root', 'write');
    insertPendingApproval('root');
    expect(classifyDoneRunStatus('root')).toBe('blocked_on_approval');
  });

  it('ignores failed tool calls', () => {
    insertSession('root');
    insertToolEvent('root', 'write', 'error');
    expect(classifyDoneRunStatus('root')).toBe('completed_no_op');
  });

  it('does not credit a sibling run that shares no ancestry', () => {
    insertSession('root');
    insertSession('unrelated');
    insertToolEvent('unrelated', 'obsidian_obsidian_put_file');
    expect(classifyDoneRunStatus('root')).toBe('completed_no_op');
  });

  it('terminates on a cyclic parent chain instead of hanging', () => {
    insertSession('a');
    insertSession('b', 'a');
    getDb().prepare(`UPDATE agent_sessions SET parent_session_id = 'b' WHERE id = 'a'`).run();
    expect(classifyDoneRunStatus('a')).toBe('completed_no_op');
  });

  it('returns completed_no_op for an unknown session id', () => {
    expect(classifyDoneRunStatus('nope')).toBe('completed_no_op');
  });
});
