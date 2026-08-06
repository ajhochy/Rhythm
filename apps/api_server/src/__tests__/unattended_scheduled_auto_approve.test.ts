/**
 * CONTRACT — auto-approve for UNATTENDED SCHEDULED runs (decision 2026-08-04).
 *
 * A deliberate, user-authorized narrowing of #1134 ("security-bound approvals
 * always require a human"). Without it autonomy was structurally impossible: a
 * scheduled job reads data → the read arms the taint gate → the write that
 * follows demands a human who by definition is not there. Memory Consolidation
 * ran nightly at 02:30 and reported success having captured 0.
 *
 * The security surface of this bypass is the three-condition guard. These tests
 * exist to keep it exactly three conditions — most importantly that an
 * INTERACTIVE session can never reach it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { ExternalContentSecurityService } from '../services/external_content_security_service';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AppError } from '../errors/app_error';

const SDK = 'sdk-sched-1';
const AGENT = 'librarian';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function profile(id: string, autoApprove: boolean) {
  new AgentConfigsRepository().insert({
    id,
    label: id,
    icon: '🧠',
    allowedSkillsJson: null,
    allowedMcpsJson: null,
    autoApproveActions: autoApprove,
  });
}

/** agent_sessions.scheduled_task_id is a real FK — the task row must exist. */
function scheduledTask(id: string) {
  getDb()
    .prepare(
      `INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)`,
    )
    .run(id, `task ${id}`, 'do the thing');
}

function session(opts: {
  id: string;
  isSystem: boolean;
  scheduledTaskId: string | null;
  agentKind?: string;
}) {
  if (opts.scheduledTaskId) scheduledTask(opts.scheduledTaskId);
  getDb()
    .prepare(
      `INSERT INTO agent_sessions
         (id, name, agent_kind, status, cwd, sdk_session_id, is_system, scheduled_task_id)
       VALUES (?, ?, ?, 'idle', '/tmp', ?, ?, ?)`,
    )
    .run(
      opts.id,
      opts.id,
      opts.agentKind ?? AGENT,
      SDK,
      opts.isSystem ? 1 : 0,
      opts.scheduledTaskId,
    );
}

/** Arm the gate exactly as a real external read would. */
function taint(sessionId: string, source = 'gmail.search') {
  getDb()
    .prepare(
      `INSERT INTO agent_external_taint_state
         (session_id, sdk_session_id, taint_id, latest_event_id, tainted_turn_id,
          tainted_agent, source, updated_at)
       VALUES (?, ?, 'taint-1', 'event-1', 'turn-1', 'manager', ?, datetime('now'))`,
    )
    .run(sessionId, SDK, source);
}

const CONTEXT = {
  sdkSessionId: SDK,
  turnId: 'turn-1',
  agentName: 'manager',
  toolCallId: 'call-1',
} as never;

function consume() {
  return new ExternalContentSecurityService().consumeApproval({
    context: CONTEXT,
    action: 'memory.remember',
    payload: { text: 'a fact' },
  });
}

function approvalRows() {
  return getDb()
    .prepare(`SELECT * FROM agent_approvals`)
    .all() as Record<string, unknown>[];
}

describe('unattended scheduled auto-approve', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('allows the write when all three conditions hold', () => {
    profile(AGENT, true);
    session({ id: 's1', isSystem: true, scheduledTaskId: 'task-1' });
    taint('s1');
    expect(consume()).toEqual({ allowed: true, consumed: true });
  });

  it('writes an audit row recording action, payload digest, taint id and taint SOURCE', () => {
    profile(AGENT, true);
    session({ id: 's1', isSystem: true, scheduledTaskId: 'task-1' });
    taint('s1', 'gmail.search');
    consume();

    const rows = approvalRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe('approved');
    expect(row.actor).toBe('auto-approved:scheduled-task:task-1');
    expect(row.security_action).toBe('memory.remember');
    expect(row.payload_digest).toBeTruthy();
    expect(row.taint_id).toBe('taint-1');
    expect(row.consumed_at).toBeTruthy();
    // The taint SOURCE must be recoverable — this is what makes the bypass
    // reviewable after the fact ("which read influenced this write?").
    expect(String(row.consequence)).toContain('gmail.search');
    expect(String(row.consequence)).toContain('task-1');
    // Auto-approved rows carry no human decision nonce.
    expect(row.decision_nonce).toBeNull();
  });

  // ── the guard: each condition alone must block ────────────────────────────

  it('REFUSES when the profile has not opted in (auto_approve_actions = 0)', () => {
    profile(AGENT, false);
    session({ id: 's1', isSystem: true, scheduledTaskId: 'task-1' });
    taint('s1');
    expect(() => consume()).toThrow(/human approval is required/);
    expect(approvalRows()).toHaveLength(0);
  });

  it('REFUSES an INTERACTIVE session even with an auto-approve profile', () => {
    // The critical guard: a human at the keyboard keeps the full #1134 gate.
    profile(AGENT, true);
    session({ id: 's1', isSystem: false, scheduledTaskId: null });
    taint('s1');
    expect(() => consume()).toThrow(/human approval is required/);
    expect(approvalRows()).toHaveLength(0);
  });

  it('REFUSES a system session that did NOT come from the scheduler', () => {
    profile(AGENT, true);
    session({ id: 's1', isSystem: true, scheduledTaskId: null });
    taint('s1');
    expect(() => consume()).toThrow(/human approval is required/);
    expect(approvalRows()).toHaveLength(0);
  });

  it('REFUSES when is_system is false but a scheduled task id is somehow set', () => {
    profile(AGENT, true);
    session({ id: 's1', isSystem: false, scheduledTaskId: 'task-1' });
    taint('s1');
    expect(() => consume()).toThrow(/human approval is required/);
    expect(approvalRows()).toHaveLength(0);
  });

  it('REFUSES when the profile row does not exist at all', () => {
    session({ id: 's1', isSystem: true, scheduledTaskId: 'task-1', agentKind: 'ghost' });
    taint('s1');
    expect(() => consume()).toThrow(/human approval is required/);
  });

  // ── unchanged behavior ────────────────────────────────────────────────────

  it('an untainted session still needs no approval at all', () => {
    profile(AGENT, false);
    session({ id: 's1', isSystem: false, scheduledTaskId: null });
    expect(consume()).toEqual({ allowed: true, consumed: false });
    expect(approvalRows()).toHaveLength(0);
  });

  it('still rejects a stray approval token on a clean session', () => {
    profile(AGENT, true);
    session({ id: 's1', isSystem: true, scheduledTaskId: 'task-1' });
    expect(() =>
      new ExternalContentSecurityService().consumeApproval({
        context: CONTEXT,
        approvalId: 'someone-elses-token',
        action: 'memory.remember',
        payload: { text: 'a fact' },
      }),
    ).toThrow(AppError);
  });

  it('auto-approves for a first-party taint source as well', () => {
    // The exemption work means first-party reads mostly stop arming the gate,
    // but if a session is tainted by anything at all the scheduled run must
    // still complete rather than stall.
    profile(AGENT, true);
    session({ id: 's1', isSystem: true, scheduledTaskId: 'task-1' });
    taint('s1', 'memory.list');
    expect(consume()).toEqual({ allowed: true, consumed: true });
    expect(String(approvalRows()[0]!.consequence)).toContain('memory.list');
  });
});
