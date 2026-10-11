/**
 * Regression guard: a coordinator root chat must not be blocked forever by the
 * grant rows its earlier coding runs left behind.
 *
 * Live failure: one approved run's manager got no usable tools and its grant
 * was later revoked by the watchdog; a second run's approval was consumed and
 * then dispatch threw "coding delegation held", because the root lookup found
 * two grant rows and requires exactly one. A user has one primary root, so the
 * first coding run was effectively the last.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { codingGrantPermission } from '../services/coordinator_coding_grant_permission';

const ROOT = 'root-session';
let db: Database.Database;
let ordinal = 0;

const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
const past = () => new Date(Date.now() - 10 * 60_000).toISOString();

function grant(key: string, opts: { revoked?: boolean; approvalExpires: string; activeDelegation?: boolean; workerId?: string }) {
  const approvalId = `approval-${key}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_approvals(id,session_id,agent_config_id,action,status,actor,security_action,expires_at,created_at)
    VALUES(?,?, 'secretary','Approve bounded coding execution','approved','user:1','coordinator.workflow.start',?,?)`)
    .run(approvalId, ROOT, opts.approvalExpires, now);
  const state = { schemaVersion: 1, approvalId, proposalDigest: 'd'.repeat(64), manager: null,
    worker: opts.workerId ? { localId: opts.workerId, sdkId: `sdk-${opts.workerId}` } : null,
    workerReservedAt: null, taskStartedAt: null, workerStartedAt: null, revokedAt: opts.revoked ? now : null };
  db.prepare(`INSERT INTO coordinator_conversation_commands(root_session_id,command_key,owner_user_id,project_id,kind,
    intent_hash,replay_json,created_at,updated_at,journal_ordinal,role,coding_grant_json)
    VALUES(?,?,1,'project','delegate_goal',?,'{}',?,?,?,'manager',?)`)
    .run(ROOT, `coding-execution:${key}`, 'a'.repeat(64), now, now, ++ordinal, JSON.stringify(state));
  if (opts.activeDelegation) {
    db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,category,owner_user_id,parent_session_id)
      VALUES(?,'manager','workflow-orchestrator','working','/private/tmp/w','chat',1,?)`).run(`child-${key}`, ROOT);
    db.prepare(`INSERT INTO agent_async_delegations(id,parent_session_id,child_session_id,target_agent_config_id,status,
      coding_root_session_id,coding_operation_key,created_at,updated_at) VALUES(?,?,?,?,'dispatched',?,?,?,?)`)
      .run(`delegation-${key}`, ROOT, `child-${key}`, 'workflow-orchestrator', ROOT, `coding-execution:${key}`, now, now);
  }
}

const ask = (session = ROOT) => codingGrantPermission(session, `sdk-${session}`, { kind: 'edit' } as never);

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  db.prepare(`INSERT INTO users(id,name,email) VALUES(1,'Owner','owner@example.invalid')`).run();
  db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,category,owner_user_id)
    VALUES(?,'root','secretary','idle','/private/tmp/w','chat',1)`).run(ROOT);
});
afterEach(() => db.close());

describe('coordinator root grant liveness', () => {
  it('ignores a revoked grant alongside a live one instead of reporting ambiguity', () => {
    grant('old', { revoked: true, approvalExpires: past() });
    grant('new', { approvalExpires: future() });
    expect(ask()).not.toEqual({ reply: 'reject', reason: 'binding_ambiguous' });
  });

  it('ignores a never-revoked grant whose approval expired with nothing running', () => {
    grant('dispatch-failed', { approvalExpires: past() });
    grant('new', { approvalExpires: future() });
    expect(ask()).not.toEqual({ reply: 'reject', reason: 'binding_ambiguous' });
  });

  it('treats a root with only terminal grants as ordinary work', () => {
    grant('old', { revoked: true, approvalExpires: past() });
    grant('finished', { approvalExpires: past() });
    expect(ask()).toBeNull();
  });

  it('keeps a run that outlived its approval window live while its delegation is active', () => {
    grant('running', { approvalExpires: past(), activeDelegation: true });
    grant('new', { approvalExpires: future() });
    expect(ask()).toEqual({ reply: 'reject', reason: 'binding_ambiguous' });
  });

  it('still fails closed when two grants are genuinely live', () => {
    grant('a', { approvalExpires: future() });
    grant('b', { approvalExpires: future() });
    expect(ask()).toEqual({ reply: 'reject', reason: 'binding_ambiguous' });
  });

  it('lets a child of a revoked grant resolve that grant, so it is held rather than ordinary', () => {
    grant('old', { revoked: true, approvalExpires: past(), workerId: 'worker-1' });
    expect(ask('worker-1')).not.toBeNull();
  });
});
