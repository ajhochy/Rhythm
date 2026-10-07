/** Real receiving repository + SQLite. Engine frame and workflow authority are disclosed stand-ins. */
import Database from 'better-sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { AuthContext } from '../middleware/auth_middleware';
import { DayflowReceivingContextRepository } from '../repositories/dayflow_receiving_context_repository';
import { DayflowProviderAdmissionService } from '../services/dayflow_receiving_history_guard';

function fixture() {
  const db = new Database(':memory:');
  onTestFinished(() => { db.close(); });
  db.exec(`CREATE TABLE agent_sessions (id TEXT, owner_user_id INTEGER, project_id TEXT, parent_session_id TEXT,
    cwd TEXT, is_system INTEGER, category TEXT, archived_at TEXT, profile_id TEXT, sdk_session_id TEXT,
    scheduled_task_id TEXT, dayflow_context_nonreuse_code TEXT, dayflow_context_nonreuse_at TEXT);
    CREATE TABLE agent_turn_dispatches (id TEXT, dayflow_context_schema_version INTEGER,
    dayflow_context_sdk_session_id TEXT, sdk_session_id TEXT);
    INSERT INTO agent_sessions VALUES ('local-manager', 7, 'project-s4', 'root', '/safe/project', 0, 'chat', NULL,
    'workflow-orchestrator', 'sdk-manager', NULL, NULL, NULL);
    INSERT INTO agent_sessions VALUES ('root', 7, 'project-s4', NULL, '/safe/project', 0, 'chat', NULL,
    'secretary', 'sdk-root', NULL, NULL, NULL);`);
  const records = new DayflowReceivingContextRepository(db);
  const request = { schemaVersion: 1 as const, sdkSessionId: 'sdk-manager', userMessageId: 'msg-1', requestNonce: 'n'.repeat(32),
    engineGeneration: 'engine-g1', runnerGeneration: 'runner-g1', attempt: 0, purpose: 'answer' as const, inputDigest: 'a'.repeat(64) };
  const binding = { schemaVersion: 1 as const, jobId: 'job-1', rootSdkSessionId: 'sdk-root', managerSdkSessionId: 'sdk-manager', expiresAt: new Date().toISOString() };
  const scope = { kind: 'manager_lineage' as const };
  const body = { schemaVersion: 2, kind: 'coordinator_workflow_provider', request, binding, scope };
  const frame = { schemaVersion: 2, kind: 'coordinator_workflow_provider_frame', binding, scope,
    accounting: { kind: 'persisted_assistant', assistantMessageId: 'asst-1', parentMessageId: 'msg-1' },
    nativeLineageDigest: 'a'.repeat(64), frame: { schemaVersion: 1, status: 'pending', request } };
  const guard = new DayflowProviderAdmissionService({ records,
    engine: { getWorkflowProviderFrame: async () => frame, getSession: async () => ({ parentID: 'sdk-root' }) } as never,
    reader: {} as never, evidence: {} as never, authority: {} as never, enrollment: {} as never,
    workflow: { admit: async () => ({ status: 'allow', reason: 'none', authorityDigest: 'a'.repeat(64), current: () => true }) } as never,
    workflowMembership: { hasMember: () => true },
  });
  return { db, records, guard, body };
}

async function prepare(f: ReturnType<typeof fixture>) {
  const result = await f.guard.admit({ user: { id: 7 }, sessionToken: 'synthetic' } as AuthContext, f.body);
  if (!result.ok) throw new Error('Wire refused');
  return result;
}

describe('workflow provider receiving session classification', () => {
  it('allows a known clean manager in the owned root project with no Dayflow evidence', async () => {
    const f = fixture();
    expect(f.records.lookupProviderSession('sdk-manager').kind).toBe('found');
    expect(f.records.hasSdkHistory('sdk-manager')).toBe(false);
    expect((await prepare(f)).finalize()).toMatchObject({ workflow: { status: 'allow' },
      response: { decision: 'ordinary', reason: 'none', rawHistoryReusable: true, overlay: null, projection: null } });
  });

  it.each([
    ['retained evidence', "INSERT INTO agent_turn_dispatches VALUES ('d', 1, 'sdk-manager', 'sdk-manager')"],
    ['unsafe marker', "UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_receiving_context_changed' WHERE id='local-manager'"],
    ['foreign owner', "UPDATE agent_sessions SET owner_user_id=8 WHERE id='local-manager'"],
    ['foreign project', "UPDATE agent_sessions SET project_id='other-project' WHERE id='local-manager'"],
    ['foreground root', "UPDATE agent_sessions SET parent_session_id=NULL WHERE id='local-manager'"],
    ['missing root', "DELETE FROM agent_sessions WHERE id='root'"],
    ['foreign root owner', "UPDATE agent_sessions SET owner_user_id=8 WHERE id='root'"],
    ['archived root', "UPDATE agent_sessions SET archived_at='2026-10-06' WHERE id='root'"],
    ['unsafe root', "UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_receiving_context_changed' WHERE id='root'"],
    ['ambiguous SDK', "INSERT INTO agent_sessions SELECT 'duplicate', owner_user_id, project_id, parent_session_id, cwd, is_system, category, archived_at, profile_id, sdk_session_id, scheduled_task_id, dayflow_context_nonreuse_code, dayflow_context_nonreuse_at FROM agent_sessions WHERE id='local-manager'"],
  ])('holds %s without releasing history', async (_name, mutation) => {
    const f = fixture(); f.db.exec(mutation);
    expect((await prepare(f)).finalize()).toMatchObject({ response: {
      decision: 'hold', reason: 'receiver_changed', rawHistoryReusable: false, overlay: null, projection: null } });
  });

  it.each([
    ['retained evidence', "INSERT INTO agent_turn_dispatches VALUES ('d', 1, 'sdk-manager', 'sdk-manager')"],
    ['changed project', "UPDATE agent_sessions SET project_id='other-project' WHERE id='local-manager'"],
    ['changed root owner', "UPDATE agent_sessions SET owner_user_id=8 WHERE id='root'"],
    ['unsafe root', "UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_receiving_context_changed' WHERE id='root'"],
  ])('rechecks %s at final exposure without erasing rows', async (_name, mutation) => {
    const f = fixture(); const result = await prepare(f); f.db.exec(mutation);
    expect(result.finalize()).toMatchObject({ response: { decision: 'hold', reason: 'receiver_changed', rawHistoryReusable: false } });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM agent_sessions').get()).toEqual({ count: 2 });
  });
});
