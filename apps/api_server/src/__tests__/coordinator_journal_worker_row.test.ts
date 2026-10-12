/**
 * Regression guard: a coding worker reservation must not freeze the coordinator journal.
 *
 * reserveWorker inserts a 'worker' row with kind 'delegate_goal' and
 * replay_json '{}' that nothing ever fills in. The journal reads select
 * delegate_goal rows, so journalCommand parsed that placeholder, threw
 * JournalIntegrityConflict, and the repository wrote a persistent
 * coordinator_command_hold. Live, one coding run reaching worker allocation
 * froze the user's only coordinator root ("integrity_hold") until repaired.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';

const scope = { sessionId: 'root', ownerUserId: 1, projectId: 'project' };
let db: Database.Database;

function insert(key: string, role: 'manager' | 'worker', replay: string) {
  db.prepare(`INSERT INTO coordinator_conversation_commands(root_session_id,command_key,owner_user_id,project_id,kind,
    intent_hash,replay_json,created_at,updated_at,journal_ordinal,goal_id,role,target_agent_config_id,parent_command_key,attempt_ordinal)
    VALUES('root',?,1,'project','delegate_goal',?,?,?,?,(SELECT COALESCE(MAX(journal_ordinal),0)+1 FROM coordinator_conversation_commands),
    'goal',?,?,?,?)`).run(key, 'c'.repeat(64), replay, 'now', 'now', role,
    role === 'worker' ? 'coding-agent' : 'workflow-orchestrator',
    role === 'worker' ? key.replace(/:worker$/, '') : null, role === 'worker' ? 1 : null);
}
const journalCommand = (key: string) =>
  (new CoordinatorConversationsRepository(db) as unknown as { journalCommand(s: typeof scope, k: string): unknown }).journalCommand(scope, key);

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  db.prepare(`INSERT INTO users(id,name,email) VALUES(1,'Owner','owner@example.invalid')`).run();
  db.prepare(`INSERT INTO projects(id,name,cwd,created_at) VALUES('project','P','/private/tmp/w','now')`).run();
  db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,category,owner_user_id,project_id)
    VALUES('root','root','secretary','idle','/private/tmp/w','chat',1,'project')`).run();
});
afterEach(() => db.close());

describe('coordinator journal and coding worker rows', () => {
  it('skips the worker reservation placeholder instead of raising an integrity conflict', () => {
    insert('coding-execution:op', 'manager', '{}');
    insert('coding-execution:op:worker', 'worker', '{}');
    expect(journalCommand('coding-execution:op:worker')).toBeNull();
  });

  it('still rejects a real command row whose replay does not match it', () => {
    insert('coding-execution:op', 'manager', '{}');
    expect(() => journalCommand('coding-execution:op')).toThrow();
  });
});
