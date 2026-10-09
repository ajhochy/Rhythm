/** Real SQLite/repository/guard; only native frames and workflow authority are stand-ins. No server. */
import Database from 'better-sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { AuthContext } from '../middleware/auth_middleware';
import { DayflowReceivingContextRepository } from '../repositories/dayflow_receiving_context_repository';
import { DayflowProviderAdmissionService } from '../services/dayflow_receiving_history_guard';
import { FrameEngine, OWNER, PROJECT, ROOT, SDK, request } from './helpers/dayflow_provider_harness';

const auth = { user: { id: OWNER }, sessionToken: 'synthetic' } as AuthContext;
const ordinary = { decision: 'ordinary', rawHistoryReusable: true, overlay: null, projection: null, reason: 'none' };

function fixture() {
  const db = new Database(':memory:');
  onTestFinished(() => { db.close(); });
  db.exec(`CREATE TABLE agent_sessions (id TEXT, sdk_session_id TEXT, owner_user_id INTEGER, project_id TEXT,
    parent_session_id TEXT, cwd TEXT, is_system INTEGER, category TEXT, archived_at TEXT, profile_id TEXT,
    scheduled_task_id TEXT, dayflow_context_nonreuse_code TEXT, dayflow_context_nonreuse_at TEXT);
    CREATE TABLE agent_turn_dispatches (id TEXT, session_id TEXT, sdk_session_id TEXT, sdk_user_message_id TEXT,
    route_authed INTEGER, outcome TEXT, dayflow_context_schema_version INTEGER, dayflow_context_owner_user_id INTEGER,
    dayflow_context_project_id TEXT, dayflow_context_sdk_session_id TEXT, dayflow_context_sdk_turn_id TEXT,
    dayflow_context_manifest_json TEXT, dayflow_context_manifest_revision INTEGER, dayflow_context_recorded_at TEXT);`);
  db.prepare(`INSERT INTO agent_sessions (id, sdk_session_id, cwd, is_system, category, scheduled_task_id)
    VALUES (?, ?, '/safe/project', 1, 'scheduled', 'task-1')`).run(ROOT, SDK);
  const records = new DayflowReceivingContextRepository(db);
  const req = request();
  const engine = new FrameEngine();
  engine.install(req);
  const guard = new DayflowProviderAdmissionService({ records, engine: engine as never,
    reader: {} as never, evidence: {} as never, enrollment: {} as never,
    authority: { activeScope: () => null } as never });
  return { db, records, req, guard };
}

async function prepare(f: ReturnType<typeof fixture>) {
  const result = await f.guard.admit(auth, f.req);
  if (!result.ok) throw new Error('wire refused');
  if (result.response.schemaVersion !== 1) throw new Error('unexpected workflow response');
  return { ...result, response: result.response };
}

describe('Slice A: structurally unbound Dayflow sessions', () => {
  it.each([
    ['scheduled root', "UPDATE agent_sessions SET parent_session_id=NULL"],
    ['scheduled child', "UPDATE agent_sessions SET parent_session_id='parent-1'"],
    ['self_improvement', "UPDATE agent_sessions SET category='self_improvement', scheduled_task_id=NULL"],
    ['owned without project', `UPDATE agent_sessions SET owner_user_id=${OWNER}`],
    ['project without owner', `UPDATE agent_sessions SET project_id='${PROJECT}'`],
    // The app allows chats left unassigned to a project; they cannot receive Dayflow either.
    ['owned unassigned interactive chat', `UPDATE agent_sessions SET owner_user_id=${OWNER}, is_system=0, category='chat', scheduled_task_id=NULL`],
    ['owned unassigned interactive child', `UPDATE agent_sessions SET owner_user_id=${OWNER}, is_system=0, category='chat', scheduled_task_id=NULL, parent_session_id='parent-1'`],
  ])('admits clean %s as ordinary, not history_ambiguous', async (_name, mutation) => {
    const f = fixture(); f.db.exec(mutation);
    const row = f.db.prepare('SELECT owner_user_id, project_id FROM agent_sessions').get() as any;
    expect(row.owner_user_id === null || row.project_id === null).toBe(true);
    const task = (f.db.prepare('SELECT scheduled_task_id AS t FROM agent_sessions').get() as any).t;
    expect(f.records.lookupProviderSession(SDK)).toEqual({ kind: 'unbound', session: {
      sessionId: ROOT, scheduledTaskId: task, ownerUserId: row.owner_user_id, projectId: row.project_id, directory: '/safe/project',
    } });
    expect(f.records.providerSessionScope(SDK)).toBeNull();
    const result = await prepare(f);
    expect(result.response).toMatchObject(ordinary);
    expect(result.finalize()).toMatchObject(ordinary);
    // The zero-history no-row basis is identical: no fabricated Dayflow receiver.
    f.db.exec('DELETE FROM agent_sessions');
    const absent = await prepare(f);
    expect(result.response.basisDigest).toBe(absent.response.basisDigest);
  });

  it.each([
    ['system run', 'UPDATE agent_sessions SET owner_user_id=8'],
    ['unassigned interactive chat', "UPDATE agent_sessions SET owner_user_id=8, is_system=0, category='chat', scheduled_task_id=NULL"],
  ])('holds a foreign owner without project as receiver_changed (%s)', async (_name, mutation) => {
    const f = fixture(); f.db.exec(mutation);
    expect((await prepare(f)).response).toMatchObject({ decision: 'hold', reason: 'receiver_changed', rawHistoryReusable: false });
  });

  const columns = ['schema_version', 'owner_user_id', 'project_id', 'sdk_session_id', 'sdk_turn_id',
    'manifest_json', 'manifest_revision', 'recorded_at'];
  it.each(columns.flatMap(column => ['session_id', 'sdk_session_id', 'dayflow_context_sdk_session_id'].map(link => [column, link])))
    ('holds partial retained %s via %s without clearing corrupt evidence', async (column, link) => {
      const f = fixture();
      const evidenceColumn = `dayflow_context_${column}`;
      f.db.prepare(`INSERT INTO agent_turn_dispatches (id, ${link}) VALUES ('d-1', ?)`).run(link === 'session_id' ? ROOT : SDK);
      f.db.prepare(`UPDATE agent_turn_dispatches SET ${evidenceColumn}=?`).run(column === 'schema_version' ? 1 : column === 'sdk_session_id' ? SDK : 'evidence');
      expect(f.records.lookupProviderSession(SDK)).toEqual({ kind: 'ambiguous' });
      expect((await prepare(f)).response).toMatchObject({ decision: 'hold', reason: 'history_ambiguous', rawHistoryReusable: false });
      expect(f.db.prepare(`SELECT ${evidenceColumn} AS evidence FROM agent_turn_dispatches`).get()).toEqual({ evidence: column === 'schema_version' ? 1 : column === 'sdk_session_id' ? SDK : 'evidence' });
    });

  it.each(['dayflow_context_nonreuse_code', 'dayflow_context_nonreuse_at'])('holds marker %s even without dispatch history', async column => {
    const f = fixture(); f.db.exec(`UPDATE agent_sessions SET ${column}='corrupt'`);
    expect(f.records.lookupProviderSession(SDK)).toEqual({ kind: 'ambiguous' });
    expect((await prepare(f)).response).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });
    expect(f.db.prepare(`SELECT ${column} AS marker FROM agent_sessions`).get()).toEqual({ marker: 'corrupt' });
  });

  it.each([
    ['zero owner', 'UPDATE agent_sessions SET owner_user_id=0'],
    ['negative owner', 'UPDATE agent_sessions SET owner_user_id=-1'],
    ['fractional owner', 'UPDATE agent_sessions SET owner_user_id=1.5'],
    ['unsafe owner', 'UPDATE agent_sessions SET owner_user_id=9007199254740992'],
    ['bad project', "UPDATE agent_sessions SET project_id='bad/id'"],
    ['empty project', "UPDATE agent_sessions SET project_id=''"],
    ['empty cwd', "UPDATE agent_sessions SET cwd=''"],
    ['null cwd', 'UPDATE agent_sessions SET cwd=NULL'],
    ['oversized cwd', "UPDATE agent_sessions SET cwd=replace(hex(zeroblob(2049)), '0', 'a')"],
    ['bad id', "UPDATE agent_sessions SET id='bad/id'"],
    ['null id', 'UPDATE agent_sessions SET id=NULL'],
    ['duplicate SDK rows', 'INSERT INTO agent_sessions SELECT * FROM agent_sessions'],
    // Only system AgentRunner sessions may run unbound; anything else without a binding stays held.
    ['ownerless interactive row', "UPDATE agent_sessions SET is_system=0, category='chat', scheduled_task_id=NULL"],
    ['interactive row naming a scheduled task', `UPDATE agent_sessions SET owner_user_id=${OWNER}, is_system=0, category='chat'`],
    ['other system category', "UPDATE agent_sessions SET category='research'"],
    ['archived system row', "UPDATE agent_sessions SET archived_at='2026-10-08T00:00:00Z'"],
    ['malformed scheduled task id', "UPDATE agent_sessions SET scheduled_task_id='bad task!'"],
    ['DB exception', 'DROP TABLE agent_turn_dispatches'],
  ])('keeps malformed %s ambiguous', async (_name, mutation) => {
    const f = fixture(); f.db.exec(mutation);
    expect(f.records.lookupProviderSession(SDK)).toEqual({ kind: 'ambiguous' });
    expect((await prepare(f)).response).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });
  });

  it('rejects a malformed SDK id even for an otherwise unbound row', () => {
    const f = fixture(); f.db.exec("UPDATE agent_sessions SET sdk_session_id='bad/id'");
    expect(f.records.lookupProviderSession('bad/id')).toEqual({ kind: 'ambiguous' });
  });

  it.each([
    ['retained dispatch', "INSERT INTO agent_turn_dispatches (id, session_id, dayflow_context_manifest_json) VALUES ('d-1', 'session:root', '{}')"],
    ['foreign owner', 'UPDATE agent_sessions SET owner_user_id=8'],
    ['directory', "UPDATE agent_sessions SET cwd='/other'"],
    ['session id', "UPDATE agent_sessions SET id='other-session'"],
    ['project', "UPDATE agent_sessions SET project_id='other-project'"],
    ['binding completed', `UPDATE agent_sessions SET owner_user_id=${OWNER}, project_id='${PROJECT}'`],
    ['deleted row', 'DELETE FROM agent_sessions'],
  ])('rechecks %s at final exposure and holds receiver_changed', async (_name, mutation) => {
    const f = fixture(); const prepared = await prepare(f);
    expect(prepared.response).toMatchObject(ordinary);
    f.db.exec(mutation);
    expect(prepared.finalize()).toMatchObject({ decision: 'hold', reason: 'receiver_changed', rawHistoryReusable: false });
  });

  it.each([null, 'parent-1'])('preserves owned zero-history root/non-root (%s) admission', async parent => {
    const f = fixture();
    f.db.prepare("UPDATE agent_sessions SET owner_user_id=?, project_id=?, is_system=0, category='chat', parent_session_id=?").run(OWNER, PROJECT, parent);
    expect(f.records.lookupProviderSession(SDK)).toMatchObject({ kind: 'found', scope: { rootChat: parent === null } });
    expect((await prepare(f)).response).toMatchObject(ordinary);
  });

  it('keeps Coordinator workflow unbound admission closed as receiver_changed', async () => {
    const f = fixture();
    expect(f.records.lookupProviderSession(SDK)).toMatchObject({ kind: 'unbound' });
    const binding = { schemaVersion: 1, jobId: 'job-1', rootSdkSessionId: 'sdk-root', managerSdkSessionId: SDK, expiresAt: new Date().toISOString() };
    const scope = { kind: 'manager_lineage' };
    const frame = { schemaVersion: 2, kind: 'coordinator_workflow_provider_frame', binding, scope,
      accounting: { kind: 'persisted_assistant', assistantMessageId: 'asst-1', parentMessageId: f.req.userMessageId },
      nativeLineageDigest: 'a'.repeat(64), frame: { schemaVersion: 1, status: 'pending', request: f.req } };
    const guard = new DayflowProviderAdmissionService({ records: f.records,
      engine: { getWorkflowProviderFrame: async () => frame, getSession: async () => ({ parentID: 'sdk-root' }) } as never,
      reader: {} as never, evidence: {} as never, authority: {} as never, enrollment: {} as never,
      workflow: { admit: async () => ({ status: 'allow', reason: 'none', authorityDigest: 'a'.repeat(64), current: () => true }) } as never,
      workflowMembership: { hasMember: () => true },
    });
    const result = await guard.admit(auth, { schemaVersion: 2, kind: 'coordinator_workflow_provider', request: f.req, binding, scope });
    if (!result.ok) throw new Error('wire refused');
    expect(result.finalize()).toMatchObject({ response: { decision: 'hold', reason: 'receiver_changed', rawHistoryReusable: false } });
  });
});
