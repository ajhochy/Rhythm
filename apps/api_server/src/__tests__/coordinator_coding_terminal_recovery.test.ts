import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

// UNIT: real SQLite lifecycle/journal, external READ transport boundary only.
// No approval signer, human decision, engine/model execution or real result.
const boundary = vi.hoisted(() => ({
  engine: { version: 'UNIT_NOT_NATIVE', pid: 12345, bootId: 'unit-boot' },
  pages: [] as Array<{ messages: unknown[]; nextCursor: string | null } | null>,
  permissions: [] as unknown[], questions: [] as unknown[],
  gatesKnown: true,
  prompts: vi.fn(async () => { throw new Error('UNIT must never start inference'); }),
}));
vi.mock('../services/opencode_engine', () => ({
  opencodeSessionMap: new Map(),
  opencodeClient: {
    promptAsync: boundary.prompts,
    getEngineIdentity: async () => boundary.engine,
    listMessagesPageStrict: async () => boundary.pages.shift() ?? null,
    listPermissions: async () => boundary.permissions,
    listQuestions: async () => boundary.questions,
    codingPendingGateState: async (sdk: string) => boundary.gatesKnown ? ({pending: [...boundary.permissions,...boundary.questions]
      .some(p => (p as {sessionID?:string}).sessionID === sdk)}) : null,
  },
}));
import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { CoordinatorCodingGrantJournal } from '../services/coordinator_coding_grant_journal';

let db: Database.Database;
const at = '2026-10-09T12:00:00.000Z';

function seed(role: 'worker' | 'manager' = 'worker', acceptance = 'accepted', prepared = true) {
  db.prepare(`INSERT INTO users(id,name,email) VALUES(7,'UNIT identity only','unit-core@example.invalid')`).run();
  db.prepare(`INSERT INTO projects(id,name,cwd,created_at) VALUES('project-unit','UNIT project','/private/tmp/unit-not-runtime',?)`).run(at);
  // Existing persisted mechanics reference, NOT a seeded approved human/coding
  // action. Never calls admission/permission/execution or a live database.
  for (const [id, parent, sdk] of [['root-unit', null, 'ses_root'],
    ['manager-unit', 'root-unit', 'ses_manager'], ['worker-unit', 'manager-unit', 'ses_worker']]) {
    db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,sdk_session_id,parent_session_id,category)
      VALUES(?,?,'librarian','working','/private/tmp/unit-not-runtime',?,?,'chat')`).run(id, 'UNIT inspector', sdk, parent);
  }
  db.prepare(`UPDATE agent_sessions SET owner_user_id=7,project_id='project-unit',permission_mode='plan'`).run();
  db.prepare(`UPDATE agent_sessions SET permission_mode='default' WHERE id='worker-unit'`).run();
  const state = { schemaVersion: 1, approvalId: 'UNIT_UNRESOLVED_REFERENCE_NOT_HUMAN', proposalDigest: 'a'.repeat(64),
    manager: { localId: 'manager-unit', sdkId: 'ses_manager' },
    worker: { localId: 'worker-unit', sdkId: 'ses_worker' }, workerReservedAt: at,
    taskStartedAt: at, workerStartedAt: at, revokedAt: null };
  db.prepare(`INSERT INTO coordinator_conversation_commands(root_session_id,command_key,owner_user_id,project_id,
    kind,intent_hash,replay_json,created_at,updated_at,journal_ordinal,goal_id,role,coding_grant_json)
    VALUES('root-unit','operation-unit',7,'project-unit','delegate_goal',?,'{}',?,?,1,'goal-unit','manager',?)`)
    .run('b'.repeat(64), at, at, JSON.stringify(state));
  const child = role === 'worker' ? 'worker-unit' : 'manager-unit';
  const sdk = role === 'worker' ? 'ses_worker' : 'ses_manager';
  if (role === 'worker') {
    db.prepare(`INSERT INTO coordinator_conversation_commands(root_session_id,command_key,owner_user_id,project_id,
      kind,intent_hash,replay_json,created_at,updated_at,journal_ordinal,goal_id,role,parent_command_key,attempt_ordinal)
      VALUES('root-unit','operation-unit:worker',7,'project-unit','delegate_goal',?,'{}',?,?,2,'goal-unit','worker','operation-unit',1)`)
      .run('b'.repeat(64), at, at);
  }
  const parent = role === 'worker' ? 'manager-unit' : 'root-unit';
  const async = new AgentAsyncDelegationsRepository().create({ parentSessionId: parent, childSessionId: child,
    targetAgentConfigId: role === 'worker' ? 'coding-agent' : 'workflow-orchestrator' });
  db.prepare(`UPDATE coordinator_conversation_commands SET child_session_id=?,child_sdk_session_id=?,delegation_id=?,
    initial_dispatch_id=?,initial_sdk_user_message_id=?,allocation_intent_at='2026-10-09T12:00:00.000Z',engine_identity=?,canonical_cwd=?,acceptance=?
    WHERE root_session_id='root-unit' AND command_key=?`).run(child, sdk, async.id, prepared ? 'dispatch-unit' : null,
      prepared ? 'msg_anchor_unit' : null, JSON.stringify(boundary.engine),
      '/private/tmp/unit-not-runtime', acceptance, role === 'worker' ? 'operation-unit:worker' : 'operation-unit');
  const columns = db.pragma('table_info(agent_async_delegations)') as Array<{ name: string }>;
  if (columns.some(c => c.name === 'coding_delivery_mode')) {
    db.prepare(`UPDATE agent_async_delegations SET coding_delivery_mode=?,coding_root_session_id='root-unit',
      coding_operation_key='operation-unit' WHERE id=?`).run(role === 'worker' ? 'coding_worker_v1' : 'coding_root_v1', async.id);
  }
  return { child, sdk, id: async.id, service: new AsyncDelegationCompletionService() };
}

function page(sdk: string, parentID = 'msg_anchor_unit', finish = 'stop') {
  return { messages: [
    { info: { id: 'msg_anchor_unit', role: 'user', sessionID: sdk, time: { created: Date.parse(at)+1 } }, parts: [] },
    { info: { id: 'msg_terminal_unit', role: 'assistant', sessionID: sdk, parentID,
      finish, time: { created: Date.parse(at)+10, completed: Date.parse(at)+20 } }, parts: [] },
  ], nextCursor: null };
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  boundary.pages = []; boundary.permissions = []; boundary.questions = []; boundary.prompts.mockClear();
  boundary.gatesKnown = true;
});
afterEach(() => db.close());

describe('C1/C2 coding terminal and durable eligibility UNIT, not genuine model proof', () => {
  it.each(['idle-only', 'wrong-anchor', 'tool-intermediate', 'incomplete-page', 'permission', 'question', 'unknown-acceptance', 'gate-unavailable'])
  ('%s does not complete on idle or lose exact operation state', async reason => {
    // Regression: generic idle/last prose marks a coding turn complete.
    const item = seed('worker', reason === 'unknown-acceptance' ? 'unknown' : 'accepted');
    if (reason === 'wrong-anchor') boundary.pages = [page(item.sdk, 'msg_other_turn')];
    else if (reason === 'tool-intermediate') boundary.pages = [page(item.sdk, 'msg_anchor_unit', 'tool-calls')];
    else if (reason === 'incomplete-page') boundary.pages = [{ messages: [], nextCursor: 'older' }, null];
    else if (reason !== 'idle-only') boundary.pages = [page(item.sdk)];
    if (reason === 'permission') boundary.permissions = [{ sessionID: item.sdk, id: 'permission-unit' }];
    if (reason === 'question') boundary.questions = [{ sessionID: item.sdk, id: 'question-unit' }];
    if (reason === 'gate-unavailable') boundary.gatesKnown = false;
    await item.service.onChildIdle(item.child);
    expect(new AgentAsyncDelegationsRepository().findById(item.id)?.status).toBe('dispatched');
    expect(boundary.prompts).not.toHaveBeenCalled();
  });

  it('exact accepted terminal persists one immutable fact; absent usage stays unknown', async () => {
    const item = seed();
    boundary.pages = [page(item.sdk), page(item.sdk)];
    await item.service.onChildIdle(item.child);
    const first = db.prepare('SELECT * FROM agent_async_delegations WHERE id=?').get(item.id) as Record<string, unknown>;
    expect(typeof first.coding_terminal_json).toBe('string');
    const fact = JSON.parse(String(first.coding_terminal_json));
    expect(fact.sdkUserMessageId).toBe('msg_anchor_unit');
    expect(fact.sdkAssistantMessageId).toBe('msg_terminal_unit');
    expect(fact.execution).toBe('completed');
    expect(fact.usage).toBeNull();
    await item.service.onChildIdle(item.child);
    const again = db.prepare('SELECT coding_terminal_json FROM agent_async_delegations WHERE id=?').get(item.id) as Record<string, unknown>;
    expect(again.coding_terminal_json).toBe(first.coding_terminal_json);
    expect(boundary.prompts).not.toHaveBeenCalled();
  });

  it('manager initial delegation turn remains pending while its worker slot exists', async () => {
    const item = seed('manager');
    boundary.pages = [page(item.sdk)];
    await item.service.onChildIdle(item.child);
    expect(new AgentAsyncDelegationsRepository().findById(item.id)?.status).toBe('dispatched');
    expect(boundary.prompts).not.toHaveBeenCalled();
  });

  it('coding-root completed before any callback claim is restart-eligible, not a billable batch', () => {
    const item = seed('manager');
    new AgentAsyncDelegationsRepository().markCompleted(item.child, 'UNIT mechanics only, not a model result');
    const repo = new AgentAsyncDelegationsRepository();
    expect(repo.listWakingParentIds(1)).toEqual(['root-unit']);
    expect(repo.claimCompletedForParent('root-unit')).toEqual([]);
    expect(repo.findById(item.id)?.status).toBe('completed');
  });

  it('existing restart maintenance consumes old paged accepted terminal without dispatch/create', async () => {
    const item = seed();
    boundary.pages = [{ messages: [{info:{id:'newer-unrelated',role:'user',sessionID:item.sdk},parts:[]}], nextCursor:'older-page' }, page(item.sdk)];
    const result = await new AsyncDelegationCompletionService().recoverAfterRestart(1);
    expect(result.parentsExamined).toBe(1);
    const row = db.prepare('SELECT coding_terminal_json FROM agent_async_delegations WHERE id=?').get(item.id) as {coding_terminal_json:string};
    expect(JSON.parse(row.coding_terminal_json).sdkUserMessageId).toBe('msg_anchor_unit');
    expect(boundary.prompts).not.toHaveBeenCalled();
  });

  it('cancelled late exact terminal updates fact without reopening or notifying', async () => {
    const item = seed();
    new AgentAsyncDelegationsRepository().markCancelled(item.id);
    boundary.pages = [page(item.sdk)];
    await item.service.onChildIdle(item.child);
    const row = db.prepare('SELECT status,coding_terminal_json,notified_at FROM agent_async_delegations WHERE id=?').get(item.id) as Record<string,unknown>;
    expect(row.status).toBe('cancelled');
    expect(JSON.parse(String(row.coding_terminal_json)).sdkAssistantMessageId).toBe('msg_terminal_unit');
    expect(row.notified_at).toBeNull();
    expect(boundary.prompts).not.toHaveBeenCalled();
  });

  it('actual producer journal prepares one exact anchor before outcome; substituted replay refuses', () => {
    seed('worker','pending',false);
    const scope={sessionId:'root-unit',ownerUserId:7,projectId:'project-unit',commandKey:'operation-unit'};
    const journal=new CoordinatorCodingGrantJournal(db);
    expect(journal.recordPrepared({...scope,commandKey:'wrong-operation'},'worker',
      {dispatchId:'prepared-unit',sdkUserMessageId:'msg_prepared_unit'},boundary.engine)).toBe(false);
    expect(journal.recordPrepared(scope,'worker',{dispatchId:'prepared-unit',sdkUserMessageId:'msg_prepared_unit'},boundary.engine)).toBe(true);
    journal.recordOutcome(scope,'worker','unknown');
    const read=()=>db.prepare(`SELECT initial_dispatch_id,initial_sdk_user_message_id,acceptance FROM coordinator_conversation_commands
      WHERE root_session_id='root-unit' AND command_key='operation-unit:worker'`).get() as Record<string,unknown>;
    expect(read()).toEqual({initial_dispatch_id:'prepared-unit',initial_sdk_user_message_id:'msg_prepared_unit',acceptance:'unknown'});
    expect(journal.recordPrepared(scope,'worker',{dispatchId:'substitute',sdkUserMessageId:'msg_other'},boundary.engine)).toBe(false);
    journal.recordOutcome(scope,'worker','accepted'); journal.recordOutcome(scope,'worker','rejected');
    expect(read().acceptance).toBe('accepted');
  });

  it('actual callback journal allows one prepared callback, unknown holds and immutable acceptance consumes no second slot', () => {
    seed('manager');
    const scope={sessionId:'root-unit',ownerUserId:7,projectId:'project-unit',commandKey:'operation-unit'};
    const journal=new CoordinatorCodingGrantJournal(db);
    expect(journal.recordCallbackPrepared(scope,{dispatchId:'callback-unit',sdkUserMessageId:'msg_callback_unit'})).toBe(true);
    journal.recordCallbackOutcome(scope,'unknown');
    expect(journal.recordCallbackPrepared(scope,{dispatchId:'retry-unit',sdkUserMessageId:'msg_retry_unit'})).toBe(false);
    journal.recordCallbackOutcome(scope,'accepted');
    const row=db.prepare(`SELECT callback_dispatch_id,callback_sdk_user_message_id,callback_acceptance FROM coordinator_conversation_commands
      WHERE root_session_id='root-unit' AND command_key='operation-unit'`).get() as Record<string,unknown>;
    expect(row).toEqual({callback_dispatch_id:'callback-unit',callback_sdk_user_message_id:'msg_callback_unit',callback_acceptance:'accepted'});
    expect(boundary.prompts).not.toHaveBeenCalled(); // metadata proof, no real approval/inference claim
  });
});
