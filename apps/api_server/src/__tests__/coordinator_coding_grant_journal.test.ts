import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { COORDINATOR_COMMAND_JOURNAL_SQL } from '../database/coordinator_conversation_schema';
import { CoordinatorCodingGrantJournal } from '../services/coordinator_coding_grant_journal';

// Real SQLite CAS; no cleanup files, fabricated signatures, engine or model.
describe('coding grant exact worker binding', () => {
  it('never overwrites an already-reserved worker or adopts a substituted SDK child', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE agent_sessions(id TEXT PRIMARY KEY, owner_user_id INTEGER, project_id TEXT, parent_session_id TEXT, sdk_session_id TEXT, permission_mode TEXT, cwd TEXT)');
    db.pragma('foreign_keys=ON');
    db.prepare('INSERT INTO agent_sessions VALUES(?,?,?,?,?,?,?)').run('root-unit',7,'project-unit',null,'ses_root_unit','plan','/private/tmp/fixture-unit');
    db.prepare('INSERT INTO agent_sessions VALUES(?,?,?,?,?,?,?)').run('manager-unit',7,'project-unit','root-unit','ses_manager_unit','plan','/private/tmp/fixture-unit');
    db.exec(COORDINATOR_COMMAND_JOURNAL_SQL);
    const state = { schemaVersion: 1, approvalId: 'approval-unit', proposalDigest: 'a'.repeat(64),
      manager: { localId: 'manager-unit', sdkId: 'ses_manager_unit' }, worker: null,
      workerReservedAt: null, taskStartedAt: '2026-10-09T12:00:00.000Z', workerStartedAt: null, revokedAt: null };
    db.prepare(`INSERT INTO coordinator_conversation_commands(root_session_id,command_key,owner_user_id,project_id,
      kind,intent_hash,replay_json,created_at,updated_at,journal_ordinal,goal_id,role,coding_grant_json)
      VALUES('root-unit','operation-unit',7,'project-unit','delegate_goal',?,'{}',?,?,1,'goal-unit','manager',?)`)
      .run('b'.repeat(64), state.taskStartedAt, state.taskStartedAt, JSON.stringify(state));
    db.prepare(`INSERT INTO agent_sessions VALUES(?,?,?,?,?,?,?)`).run('worker-unit',7,'project-unit','manager-unit','ses_worker_unit','default','/private/tmp/fixture-unit');
    const journal = new CoordinatorCodingGrantJournal(db);
    const scope = { sessionId: 'root-unit', ownerUserId: 7, projectId: 'project-unit', commandKey: 'operation-unit' };
    expect(journal.reserveWorker(scope, 'manager-unit', 'ses_manager_unit', () => true)).toBe(true);
    expect(journal.reserveWorker(scope, 'manager-unit', 'ses_manager_unit', () => true)).toBe(false);
    expect(journal.bindChild(scope, 'worker', 'worker-unit', 'ses_wrong_unit', '/private/tmp/fixture-unit')).toBe(false);
    expect(journal.bindChild(scope, 'worker', 'worker-unit', 'ses_worker_unit', '/private/tmp/fixture-unit')).toBe(true);
    expect(journal.bindChild(scope, 'worker', 'worker-unit', 'ses_worker_unit', '/private/tmp/fixture-unit')).toBe(true);
    expect(journal.bindChild(scope, 'worker', 'other-worker', 'ses_other_worker', '/private/tmp/fixture-unit')).toBe(false);
    const persisted = JSON.parse((db.prepare('SELECT coding_grant_json AS value FROM coordinator_conversation_commands').get() as {value:string}).value);
    expect(persisted.worker).toEqual({ localId: 'worker-unit', sdkId: 'ses_worker_unit' });
    db.close();
  });
});
