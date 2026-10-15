import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
const { finishFixture } = require('./helpers/preserved_fixture.cjs');
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMigrations } from '../database/migrations';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { COORDINATOR_COMMAND_JOURNAL_SQL } from '../database/coordinator_conversation_schema';
import { coordinatorConversationCommands, parseStoredCoordinatorConversation } from '../contracts/coordinator_conversation_contract';
import { DayflowReceivingContextRepository } from '../repositories/dayflow_receiving_context_repository';

// Real SQLite and repository; no SDK, HTTP, model, default DB or lifecycle calls.
const scope = { ownerUserId: 7, projectId: 'journal-project', sessionId: 'journal-root' };
const sdk = 'ses_journal_root';
const clock = () => new Date('2026-10-09T12:00:00.000Z');

describe('R1 normalized Coordinator command journal', () => {
  let db: Database.Database;
  let repo: CoordinatorConversationsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO agent_sessions
      (id, agent_kind, cwd, name, owner_user_id, project_id, sdk_session_id, profile_id, permission_mode)
      VALUES (?, 'librarian', '/private/tmp', 'Synthetic journal root', ?, ?, ?, 'librarian', 'plan')`)
      .run(scope.sessionId, scope.ownerUserId, scope.projectId, sdk);
    repo = new CoordinatorConversationsRepository(db, clock);
  });
  afterEach(() => db.close());

  function conversation() {
    const read = repo.get(scope);
    expect(read.kind).toBe('found');
    if (read.kind !== 'found') throw new Error('expected synthetic journal root');
    return read.conversation;
  }

  function hasJournal() {
    // Assertion rather than a missing-table SQL error is the baseline RED.
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
      AND name='coordinator_conversation_commands'`).get()).toEqual({ name: 'coordinator_conversation_commands' });
  }

  function keys() {
    hasJournal();
    return db.prepare(`SELECT command_key FROM coordinator_conversation_commands
      WHERE root_session_id=? ORDER BY command_key`).all(scope.sessionId);
  }

  function goal() {
    const result = repo.addGoal({ ...scope, expectedControlRevision: conversation().controlRevision,
      commandKey: 'original-goal', objective: 'Synthetic journal task' });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') throw new Error('expected goal');
    return result.goal;
  }

  it('R1-c1 creates replay-safe SQLite rows unique by root/key, without a duplicate lifecycle owner', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    hasJournal();
    runMigrations(db);
    const indexes = db.prepare('PRAGMA index_list(coordinator_conversation_commands)').all() as
      Array<{ name: string; unique: number }>;
    const uniqueColumns = indexes.filter((index) => index.unique === 1).map((index) =>
      (db.prepare(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`).all() as Array<{ name: string }>)
        .map((column) => column.name));
    expect(uniqueColumns).toContainEqual(['root_session_id', 'command_key']);
    const columns = (db.prepare('PRAGMA table_info(coordinator_conversation_commands)').all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(['root_session_id', 'command_key', 'owner_user_id',
      'project_id', 'intent_hash', 'created_at', 'updated_at']));
    expect(columns).not.toContain('runtime_status');
    expect(columns).not.toContain('delivered_at');
    const input = { ...scope, expectedControlRevision: conversation().controlRevision,
      commandKey: 'normal-message', message: 'Synthetic ordinary message' };
    expect(repo.reserveForegroundMessage(input).kind).toBe('reserved');
    expect(repo.settleForegroundMessage({ ...input, outcome: 'accepted' }).kind).toBe('accepted');
    expect(keys()).toEqual([{ command_key: input.commandKey }]);
    const hash = createHash('sha256').update(JSON.stringify({ kind: 'foreground', message: input.message })).digest('hex');
    expect(db.prepare(`SELECT root_session_id,owner_user_id,project_id,command_key,kind,intent_hash,created_at,updated_at,replay_json
      FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key=?`)
      .get(scope.sessionId, input.commandKey)).toEqual({ root_session_id: scope.sessionId, owner_user_id: 7,
        project_id: scope.projectId, command_key: input.commandKey, kind: 'foreground', intent_hash: hash,
        created_at: clock().toISOString(), updated_at: clock().toISOString(), replay_json: JSON.stringify({
          key: input.commandKey, intentHash: hash, kind: 'foreground', state: 'accepted' }) });
    repo = new CoordinatorConversationsRepository(db, clock);
    expect(repo.reserveForegroundMessage(input).kind).toBe('accepted_replay');
    expect(repo.reserveForegroundMessage({ ...input, message: 'Changed intent' }).kind).toBe('command_conflict');
    expect(keys()).toEqual([{ command_key: input.commandKey }]);
  });

  it('R1-c2 imports legacy evidence idempotently and stops writing its historical command blob', () => {
    // Only this migration fixture seeds a blob. Capacity tests below never seed commands/messages.
    // Root has never been read/written by the normalized repository, so no
    // migration marker can incorrectly treat this legacy blob as switched.
    const base = { schemaVersion: 4, id: 'legacy-conversation', sessionId: scope.sessionId,
      ownerUserId: scope.ownerUserId, projectId: scope.projectId, controlRevision: 1,
      primaryOwnerRoot: true, goals: [], continuations: [], createdAt: clock().toISOString(), updatedAt: clock().toISOString() };
    const command = { key: 'legacy-foreground', intentHash: 'a'.repeat(64), kind: 'foreground', state: 'uncertain' };
    db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=? WHERE id=?')
      .run(JSON.stringify({ ...base, commandDedupe: [command] }), scope.sessionId);
    runMigrations(db);
    repo = new CoordinatorConversationsRepository(db, clock);
    expect(conversation().commandDedupe).toContainEqual(command);
    expect(keys()).toEqual([{ command_key: command.key }]);
    runMigrations(db);
    repo = new CoordinatorConversationsRepository(db, clock);
    expect(conversation().commandDedupe).toContainEqual(command);
    expect(keys()).toEqual([{ command_key: command.key }]);
    const historicalCommands = () => JSON.parse((db.prepare(`SELECT coordinator_conversation_json AS value
      FROM agent_sessions WHERE id=?`).get(scope.sessionId) as { value: string }).value).commandDedupe;
    const before = historicalCommands();
    expect(repo.recordStatusMessage({ ...scope, expectedControlRevision: conversation().controlRevision,
      commandKey: 'after-switch', message: 'What is the status?' }).kind).toBe('stored');
    expect(historicalCommands()).toEqual(before);
    expect(keys()).toEqual([{ command_key: 'after-switch' }, { command_key: command.key }]);
    expect(repo.get({ ...scope, ownerUserId: 8 }).kind).toBe('not_found');
    expect(repo.get({ ...scope, projectId: 'foreign-project' }).kind).toBe('not_found');
  });

  it('R1-c3 holds contradictory duplicate legacy hashes without trimming or losing the source', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const base = conversation();
    const command = { key: 'duplicate', intentHash: 'a'.repeat(64), kind: 'foreground', state: 'uncertain' };
    const raw = JSON.stringify({ ...base, commandDedupe: [command, { ...command, intentHash: 'b'.repeat(64) }] });
    db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=? WHERE id=?').run(raw, scope.sessionId);
    repo = new CoordinatorConversationsRepository(db, clock);
    expect(repo.get(scope).kind).toBe('integrity_hold');
    expect(repo.recordStatusMessage({ ...scope, expectedControlRevision: base.controlRevision,
      commandKey: 'must-not-write', message: 'Status?' }).kind).toBe('integrity_hold');
    expect(db.prepare('SELECT coordinator_conversation_json AS value FROM agent_sessions WHERE id=?')
      .get(scope.sessionId)).toEqual({ value: raw });
  });

  it('R1-c4 rolls authorization and reservation back together and replays without a second consumption', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const captured = goal();
    // Authorization is outside this repository. A real SQL boundary mutation proves rollback;
    // this is NOT a genuine signed-human approval test or R2 grant qualification.
    db.exec('CREATE TABLE synthetic_authorization (consumed INTEGER NOT NULL); INSERT INTO synthetic_authorization VALUES (0)');
    const input = { ...scope, expectedControlRevision: conversation().controlRevision,
      commandKey: 'manager', goalId: captured.id, parentSdkSessionId: sdk };
    const refusal = new Error('synthetic refusal after partial consumption');
    const refused = repo.reserveGoalDelegationAuthorized({ ...input, authorize: () => {
      expect(db.inTransaction).toBe(true);
      db.prepare('UPDATE synthetic_authorization SET consumed=consumed+1').run();
      throw refusal;
    } });
    expect(refused).toMatchObject({ kind: 'authorization_refused', refusal });
    expect(db.prepare('SELECT consumed FROM synthetic_authorization').get()).toEqual({ consumed: 0 });
    expect(conversation().controlRevision).toBe(input.expectedControlRevision);
    expect(conversation().commandDedupe.some((command) => command.key === input.commandKey)).toBe(false);
    expect(repo.reserveGoalDelegationAuthorized({ ...input, authorize: () => {
      expect(db.inTransaction).toBe(true);
      db.prepare('UPDATE synthetic_authorization SET consumed=consumed+1').run();
    } }).kind).toBe('reserved');
    repo = new CoordinatorConversationsRepository(db, clock);
    const replay = repo.reserveGoalDelegationAuthorized({ ...input, authorize: () => {
      db.prepare('UPDATE synthetic_authorization SET consumed=consumed+1').run();
    } });
    expect(replay.kind).toBe('uncertain');
    expect(db.prepare('SELECT consumed FROM synthetic_authorization').get()).toEqual({ consumed: 1 });
    expect(db.prepare(`SELECT goal_id,goal_revision,role,attempt_ordinal,target_agent_config_id
      FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key='manager'`).get(scope.sessionId))
      .toEqual({ goal_id: captured.id, goal_revision: 1, role: 'manager', attempt_ordinal: 1,
        target_agent_config_id: 'workflow-orchestrator' });
    expect(repo.reserveGoalDelegation({ ...input, parentSdkSessionId: 'ses_substituted' }).kind).toBe('command_conflict');
    expect(keys()).toEqual([{ command_key: 'manager' }, { command_key: 'original-goal' }]);
  });

  it('R1-c5 accepts 120 supported command operations plus next input and retains old replay/callback lookup beyond the page', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const captured = goal(); // operation 1
    const reservation = { ...scope, expectedControlRevision: conversation().controlRevision,
      commandKey: 'old-delegation', goalId: captured.id, parentSdkSessionId: sdk };
    expect(repo.reserveGoalDelegation(reservation).kind).toBe('reserved'); // operation 2
    expect(repo.settleGoalDelegation({ ...reservation, expectedControlRevision: conversation().controlRevision,
      outcome: 'dispatched', delegationId: 'old-delegation-id', childSessionId: 'old-child-id' }).kind).toBe('dispatched');
    const revision = conversation().controlRevision;
    let originalMessageId: number | undefined;
    for (let i = 0; i < 118; i += 1) {
      const result = repo.recordStatusMessage({ ...scope, expectedControlRevision: revision,
        commandKey: `status-${i}`, message: `Synthetic status ${i}` });
      expect(result.kind, `supported operation ${i + 3}`).toBe('stored');
      if (result.kind === 'stored' && i === 0) originalMessageId = result.messageId;
    }
    expect(keys()).toHaveLength(120);
    expect(conversation().controlRevision).toBe(revision); // Status is not admission.
    const next = { ...scope, expectedControlRevision: revision, commandKey: 'next-input', message: 'Hello again' };
    expect(repo.reserveForegroundMessage(next).kind).toBe('reserved');
    expect(repo.settleForegroundMessage({ ...next, outcome: 'accepted' }).kind).toBe('accepted');
    expect(keys()).toHaveLength(121);
    repo = new CoordinatorConversationsRepository(db, clock);
    expect(conversation().commandDedupe.length).toBeLessThanOrEqual(100); // Existing client/output ceiling remains bounded.
    expect(conversation().commandDedupe.some((command) => command.key === 'status-0')).toBe(false);
    expect(conversation().commandDedupe).toContainEqual(expect.objectContaining({ key: 'next-input', state: 'accepted' }));
    expect(repo.reserveForegroundMessage(next).kind).toBe('accepted_replay');
    const replay = repo.reserveForegroundMessage(next);
    expect('conversation' in replay && replay.conversation.commandDedupe.length).toBeLessThanOrEqual(100);
    const resolved = repo.findPrimaryOwnerRoot(scope.ownerUserId);
    expect(resolved.kind === 'found' && resolved.conversation.commandDedupe.length).toBeLessThanOrEqual(100);
    const opened = repo.open(scope);
    expect('conversation' in opened && opened.conversation.commandDedupe.length).toBeLessThanOrEqual(100);
    expect(repo.reserveGoalDelegation(reservation)).toMatchObject({ kind: 'dispatched_replay',
      delegationId: 'old-delegation-id', childSessionId: 'old-child-id', goal: { id: captured.id } });
    expect(repo.coordinatorDelegationCallbackReason({ parentSessionId: scope.sessionId, parentSdkSessionId: sdk,
      delegationId: 'old-delegation-id', childSessionId: 'old-child-id', targetAgentConfigId: 'workflow-orchestrator' }))
      .toBe('c2_goal_callback:old-delegation-id');
    expect(repo.recordStatusMessage({ ...scope, expectedControlRevision: revision,
      commandKey: 'status-0', message: 'Synthetic status 0' })).toMatchObject({ kind: 'replay', messageId: originalMessageId });
    expect(db.prepare('SELECT count(*) AS n FROM agent_session_messages WHERE session_id=?').get(scope.sessionId))
      .toEqual({ n: 118 });
    expect(keys()).toHaveLength(121);
  });

  it('R1-c4 writer failure cannot leave consumed authorization or a reserved operation', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    hasJournal();
    const captured = goal();
    db.exec(`CREATE TABLE synthetic_authorization (consumed INTEGER NOT NULL);
      INSERT INTO synthetic_authorization VALUES (0);
      CREATE TRIGGER fail_journal BEFORE INSERT ON coordinator_conversation_commands
      WHEN NEW.command_key='writer-failure' BEGIN SELECT RAISE(ABORT, 'writer failure'); END;`);
    const revision = conversation().controlRevision;
    const result = repo.reserveGoalDelegationAuthorized({ ...scope, expectedControlRevision: revision,
      commandKey: 'writer-failure', goalId: captured.id, parentSdkSessionId: sdk,
      authorize: () => { db.prepare('UPDATE synthetic_authorization SET consumed=consumed+1').run(); } });
    expect(result.kind).not.toBe('reserved');
    expect(db.prepare('SELECT consumed FROM synthetic_authorization').get()).toEqual({ consumed: 0 });
    expect(conversation().controlRevision).toBe(revision);
    expect(keys()).toEqual([{ command_key: 'original-goal' }]);
  });

  it('R1-c3 persists a non-disclosing hold on foreign legacy binding, preserving all source bytes', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    hasJournal();
    const raw = JSON.stringify({ ...conversation(), ownerUserId: 8 });
    db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=? WHERE id=?').run(raw, scope.sessionId);
    expect(repo.get(scope).kind).toBe('integrity_hold');
    expect(db.prepare('SELECT coordinator_command_hold AS hold FROM agent_sessions WHERE id=?')
      .get(scope.sessionId)).toEqual({ hold: 'journal_integrity_conflict' });
    repo = new CoordinatorConversationsRepository(db, clock);
    expect(repo.get(scope).kind).toBe('integrity_hold');
    expect(repo.get({ ...scope, ownerUserId: 8 }).kind).toBe('not_found');
    expect(db.prepare('SELECT coordinator_conversation_json AS value FROM agent_sessions WHERE id=?')
      .get(scope.sessionId)).toEqual({ value: raw });
  });

  it('R1-c2 rolls back the entire import if switching the single writer fails', () => {
    const raw = JSON.stringify({ schemaVersion: 4, id: 'legacy', sessionId: scope.sessionId,
      ownerUserId: 7, projectId: scope.projectId, controlRevision: 1, primaryOwnerRoot: true,
      goals: [], continuations: [], createdAt: clock().toISOString(), updatedAt: clock().toISOString(),
      commandDedupe: [{ key: 'old', kind: 'foreground', intentHash: 'a'.repeat(64), state: 'uncertain' }] });
    db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=? WHERE id=?').run(raw, scope.sessionId);
    db.exec(`CREATE TRIGGER fail_switch BEFORE UPDATE ON agent_sessions
      WHEN NEW.coordinator_command_storage='rows_v1' BEGIN SELECT RAISE(ABORT, 'switch failed'); END;`);
    expect(repo.get(scope).kind).toBe('schema_unavailable');
    expect(keys()).toEqual([]);
    expect(db.prepare('SELECT coordinator_command_storage AS storage FROM agent_sessions WHERE id=?')
      .get(scope.sessionId)).toEqual({ storage: null });
    db.exec('DROP TRIGGER fail_switch');
    expect(conversation().commandDedupe).toHaveLength(1);
    expect(keys()).toEqual([{ command_key: 'old' }]);
  });

  it('R1-c2 refuses a legacy dispatch whose exact child/outbox reference cannot be proved', () => {
    const goalId = 'legacy-goal';
    const intentHash = createHash('sha256').update(JSON.stringify({ kind: 'delegate_goal', goalId,
      parentSdkSessionId: sdk, targetAgentConfigId: 'workflow-orchestrator' })).digest('hex');
    const raw = JSON.stringify({ schemaVersion: 4, id: 'legacy', sessionId: scope.sessionId,
      ownerUserId: 7, projectId: scope.projectId, controlRevision: 2, primaryOwnerRoot: true,
      goals: [{ id: goalId, commandKey: 'capture', intentHash: 'a'.repeat(64), objective: 'Synthetic',
        state: 'captured', linkedWorkstreamId: null, revision: 1, createdAt: clock().toISOString() }],
      continuations: [], createdAt: clock().toISOString(), updatedAt: clock().toISOString(),
      commandDedupe: [{ key: 'capture', kind: 'add_goal', goalId, intentHash: 'a'.repeat(64), messageId: null },
        { key: 'legacy-manager', kind: 'delegate_goal', goalId, intentHash, parentSdkSessionId: sdk,
          targetAgentConfigId: 'workflow-orchestrator', state: 'dispatched', delegationId: 'missing-outbox',
          childSessionId: 'missing-child' }] });
    db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=? WHERE id=?').run(raw, scope.sessionId);
    expect(repo.get(scope).kind).toBe('integrity_hold');
    expect(keys()).toEqual([]);
    expect(db.prepare('SELECT coordinator_command_storage AS storage,coordinator_conversation_json AS value FROM agent_sessions WHERE id=?')
      .get(scope.sessionId)).toEqual({ storage: null, value: raw });
  });

  it('R1-c7 reserves distinct write-once initial and callback provenance, including unknown callback acceptance', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const captured = goal();
    const reservation = { ...scope, expectedControlRevision: conversation().controlRevision,
      commandKey: 'anchors', goalId: captured.id, parentSdkSessionId: sdk };
    expect(repo.reserveGoalDelegation(reservation).kind).toBe('reserved');
    db.prepare(`INSERT INTO agent_sessions
      (id,agent_kind,cwd,name,owner_user_id,project_id,sdk_session_id,parent_session_id)
      VALUES ('manager-child','workflow-orchestrator','/private/tmp','Synthetic child',7,?,'ses_manager',?)`)
      .run(scope.projectId, scope.sessionId);
    expect(repo.settleGoalDelegation({ ...reservation, expectedControlRevision: conversation().controlRevision,
      outcome: 'dispatched', childSessionId: 'manager-child', delegationId: 'anchors-delegation' }).kind).toBe('dispatched');
    for (const [id, origin, outcome] of [['initial', 'delegation', 'accepted'],
      ['callback', 'delegation_completion', 'unknown'], ['extra', 'delegation_completion', 'pending']]) {
      db.prepare(`INSERT INTO agent_turn_dispatches
        (id,session_id,sdk_session_id,sdk_user_message_id,origin,requested_source,outcome,created_at,updated_at)
        VALUES (?,'manager-child','ses_manager',?,?,'agent_config',?,?,?)`)
        .run(id, `msg_${id}`, origin, outcome, clock().toISOString(), clock().toISOString());
    }
    expect(typeof repo.bindCommandPromptAnchor).toBe('function');
    const input = { ...scope, commandKey: 'anchors' };
    expect(repo.bindCommandPromptAnchor({ ...input, slot: 'callback', dispatchId: 'callback' }).kind).toBe('anchor_conflict');
    expect(repo.bindCommandPromptAnchor({ ...input, slot: 'initial', dispatchId: 'initial' }).kind).toBe('bound');
    expect(repo.bindCommandPromptAnchor({ ...input, slot: 'callback', dispatchId: 'callback' }).kind).toBe('bound');
    repo = new CoordinatorConversationsRepository(db, clock);
    expect(repo.bindCommandPromptAnchor({ ...input, slot: 'callback', dispatchId: 'callback' }).kind).toBe('replay');
    expect(repo.bindCommandPromptAnchor({ ...input, slot: 'callback', dispatchId: 'extra' }).kind).toBe('anchor_conflict');
    expect(repo.bindCommandPromptAnchor({ ...input, slot: 'initial', dispatchId: 'extra' }).kind).toBe('anchor_conflict');
    expect(repo.bindCommandPromptAnchor({ ...input, ownerUserId: 8, slot: 'initial', dispatchId: 'initial' }).kind).toBe('not_found');
    expect(db.prepare(`SELECT initial_dispatch_id,initial_sdk_user_message_id,callback_dispatch_id,callback_sdk_user_message_id
      FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key='anchors'`).get(scope.sessionId))
      .toEqual({ initial_dispatch_id: 'initial', initial_sdk_user_message_id: 'msg_initial',
        callback_dispatch_id: 'callback', callback_sdk_user_message_id: 'msg_callback' });
    expect(() => db.prepare(`UPDATE coordinator_conversation_commands SET initial_dispatch_id='extra'
      WHERE root_session_id=? AND command_key='anchors'`).run(scope.sessionId)).toThrow('immutable binding');
  });

  it('R1-c6 normal-message idempotency survives 120 operations, restart, bounded projection and indexed lookup', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    for (let i = 0; i < 120; i += 1) {
      const input = { ...scope, expectedControlRevision: 1, commandKey: `foreground-${i}`, message: `Input ${i}` };
      expect(repo.reserveForegroundMessage(input).kind).toBe('reserved');
      expect(repo.settleForegroundMessage({ ...input, outcome: 'accepted' }).kind).toBe('accepted');
    }
    expect(conversation().commandDedupe).toHaveLength(100);
    expect(conversation().commandJournal?.paginated).toBe(true);
    expect(conversation().commandDedupe.some((command) => command.key === 'foreground-0')).toBe(false);
    repo = new CoordinatorConversationsRepository(db, clock);
    const old = { ...scope, expectedControlRevision: 1, commandKey: 'foreground-0', message: 'Input 0' };
    expect(repo.reserveForegroundMessage(old).kind).toBe('accepted_replay');
    expect(repo.reserveForegroundMessage({ ...old, message: 'Changed input' }).kind).toBe('command_conflict');
    expect(repo.recordStatusMessage({ ...scope, expectedControlRevision: 1, commandKey: 'next-status', message: 'Status?' }).kind).toBe('stored');
    expect(keys()).toHaveLength(121);
    const plans = db.prepare(`EXPLAIN QUERY PLAN SELECT replay_json FROM coordinator_conversation_commands
      WHERE root_session_id=? AND command_key=?`).all(scope.sessionId, old.commandKey) as Array<{ detail: string }>;
    expect(plans.some((plan) => plan.detail.includes('SEARCH') && plan.detail.includes('INDEX'))).toBe(true);
    const callbacks = db.prepare(`EXPLAIN QUERY PLAN SELECT command_key FROM coordinator_conversation_commands
      WHERE root_session_id=? AND delegation_id=?`).all(scope.sessionId, 'old') as Array<{ detail: string }>;
    expect(callbacks.some((plan) => plan.detail.includes('idx_coordinator_commands_delegation'))).toBe(true);
  });

  it('R1-c2 count/reference comparison refuses extra normalized evidence before switching without dropping it', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const input = { ...scope, expectedControlRevision: 1, commandKey: 'retained', message: 'Original' };
    expect(repo.reserveForegroundMessage(input).kind).toBe('reserved');
    expect(repo.settleForegroundMessage({ ...input, outcome: 'accepted' }).kind).toBe('accepted');
    // Simulates an interrupted/contradictory pre-switch inventory, not capacity evidence.
    db.prepare('UPDATE agent_sessions SET coordinator_command_storage=NULL,coordinator_command_legacy_hash=NULL WHERE id=?')
      .run(scope.sessionId);
    expect(repo.get(scope).kind).toBe('integrity_hold');
    expect(keys()).toEqual([{ command_key: 'retained' }]);
    expect(db.prepare('SELECT replay_json FROM coordinator_conversation_commands WHERE root_session_id=?')
      .get(scope.sessionId)).toEqual({ replay_json: JSON.stringify({ key: 'retained',
        intentHash: createHash('sha256').update(JSON.stringify({ kind: 'foreground', message: 'Original' })).digest('hex'),
        kind: 'foreground', state: 'accepted' }) });
  });

  it('R1-c8 replays additive schema and uses identical portable table/index DDL in the inert Postgres bootstrap', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const before = db.prepare('SELECT coordinator_conversation_json AS value FROM agent_sessions WHERE id=?').get(scope.sessionId);
    runMigrations(db);
    db.exec(COORDINATOR_COMMAND_JOURNAL_SQL);
    expect(db.prepare('SELECT coordinator_conversation_json AS value FROM agent_sessions WHERE id=?').get(scope.sessionId)).toEqual(before);
    const bootstrap = readFileSync(join(process.cwd(), 'src/database/postgres_bootstrap.ts'), 'utf8');
    expect(bootstrap).toContain('await pool.query(COORDINATOR_COMMAND_JOURNAL_SQL)');
    for (const column of ['coordinator_command_storage', 'coordinator_command_legacy_hash', 'coordinator_command_hold']) {
      expect(bootstrap).toContain(`ADD COLUMN IF NOT EXISTS ${column} TEXT NULL`);
    }
    // Static parity only; no fake Pool and no hosted connection/execution claim.
    expect(bootstrap).not.toContain("coordinator_command_storage='rows_v1'");
  });

  it('R1-c4 two real connections cannot consume twice while one approval/reservation transaction is uncommitted', async () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const captured = goal();
    db.exec('CREATE TABLE synthetic_authorization (consumed INTEGER NOT NULL); INSERT INTO synthetic_authorization VALUES (0)');
    const directory = mkdtempSync(join(tmpdir(), 'r1-journal-race-'));
    const file = join(directory, 'test.db');
    await db.backup(file); // This test's synthetic DB only, never the active API DB.
    const first = new Database(file);
    const second = new Database(file);
    second.pragma('busy_timeout = 0');
    try {
      const primary = new CoordinatorConversationsRepository(first, clock);
      const contender = new CoordinatorConversationsRepository(second, clock);
      const input = { ...scope, expectedControlRevision: conversation().controlRevision,
        commandKey: 'racing-manager', goalId: captured.id, parentSdkSessionId: sdk };
      let competingKind: string | undefined;
      const reserved = primary.reserveGoalDelegationAuthorized({ ...input, authorize: () => {
        expect(first.inTransaction).toBe(true);
        first.prepare('UPDATE synthetic_authorization SET consumed=consumed+1').run();
        const competing = contender.reserveGoalDelegationAuthorized({ ...input, authorize: () => {
          second.prepare('UPDATE synthetic_authorization SET consumed=consumed+1').run();
        } });
        competingKind = competing.kind;
      } });
      expect(reserved.kind).toBe('reserved');
      expect(competingKind).toBe('revision_conflict');
      expect(contender.reserveGoalDelegationAuthorized({ ...input, authorize: () => {
        second.prepare('UPDATE synthetic_authorization SET consumed=consumed+1').run();
      } }).kind).toBe('uncertain');
      expect(second.prepare('SELECT consumed FROM synthetic_authorization').get()).toEqual({ consumed: 1 });
      expect(second.prepare(`SELECT count(*) AS n FROM coordinator_conversation_commands
        WHERE root_session_id=? AND command_key=?`).get(scope.sessionId, input.commandKey)).toEqual({ n: 1 });
    } finally {
      first.close(); second.close(); finishFixture(directory, () => rmSync(directory, { recursive: true, force: true }));
    }
  });

  it('R1-c6 keeps existing finite-authority validation usable after ordinary status history exceeds 100', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const captured = goal();
    for (let index = 0; index < 120; index += 1) {
      expect(repo.recordStatusMessage({ ...scope, expectedControlRevision: 2,
        commandKey: `finite-status-${index}`, message: 'Status?' }).kind).toBe('stored');
    }
    expect(repo.linkGoal({ ...scope, expectedControlRevision: 2,
      goalId: captured.id, workstreamId: 'synthetic-workstream' }).kind).toBe('updated');
    // Same synthetic legacy read-only authority shape as the preserved repository
    // suite, not a signed human approval/coding grant or any engine exposure.
    const authority = { schemaVersion: 5 as const, authorizationId: 'synthetic-finite',
      authorizationCommandKey: 'synthetic-finite-key', goalId: captured.id, projectId: scope.projectId,
      workstreamId: 'synthetic-workstream', goalRevision: 2, parentSessionId: scope.sessionId,
      profileId: 'librarian', profileRevision: 1, workstreamRevision: 1, issuedFromControlRevision: 3,
      issuedAt: clock().toISOString(), expiresAt: '2026-10-09T12:15:00.000Z',
      requestedModel: { providerId: 'synthetic', modelId: 'synthetic', mode: 'fixed' as const },
      permissionAuthority: { schemaVersion: 1 as const,
        parent: { sessionId: scope.sessionId, permissionMode: 'plan' as const, approvalBypassExplicit: false },
        worker: { parentSessionId: scope.sessionId, permissionMode: 'default' as const, managedReadOnly: true } },
      maxTurns: 1 as const, consumedTurns: 0, totalTokenAuthorization: 512, maxWallTimeSeconds: 300,
      acknowledgement: { schemaVersion: 1 as const, actorUserId: 7, acknowledgedAt: clock().toISOString(),
        kind: 'soft_total_tokens' as const, includes: ['input', 'output', 'reasoning', 'cache'] as ['input','output','reasoning','cache'],
        outputCapEnforced: false as const }, purpose: 'decompose' as const, executionScope: null,
      dayflowDependency: null, status: 'authorized' as const };
    expect(repo.setContinuationAuthority({ ...scope, expectedControlRevision: 3, authority }).kind).toBe('updated');
    expect(conversation().continuations).toEqual([authority]);
  });

  it('R1-c2 primary designation after an existing normalized open leaves historical commands inert', () => {
    expect(repo.open(scope).kind).toBe('created');
    expect(repo.recordStatusMessage({ ...scope, expectedControlRevision: 1,
      commandKey: 'before-primary', message: 'Status?' }).kind).toBe('stored');
    const historical = JSON.parse((db.prepare('SELECT coordinator_conversation_json AS value FROM agent_sessions WHERE id=?')
      .get(scope.sessionId) as { value: string }).value).commandDedupe;
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    expect(JSON.parse((db.prepare('SELECT coordinator_conversation_json AS value FROM agent_sessions WHERE id=?')
      .get(scope.sessionId) as { value: string }).value).commandDedupe).toEqual(historical);
    expect(conversation().primaryOwnerRoot).toBe(true);
    expect(keys()).toEqual([{ command_key: 'before-primary' }]);
  });

  it('R1 repair preserves a parser-valid bounded projection for 51 captures + 51 reservations and the next status key', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    const reservations = [];
    for (let index = 0; index < 51; index++) {
      const captured = repo.addGoal({ ...scope, expectedControlRevision: conversation().controlRevision,
        commandKey: `capture-${index}`, objective: `Task ${index}` });
      expect(captured.kind).toBe('created');
      if (captured.kind !== 'created') throw new Error('capture refused');
      const input = { ...scope, expectedControlRevision: captured.conversation.controlRevision,
        commandKey: `manager-${index}`, goalId: captured.goal.id, parentSdkSessionId: sdk };
      expect(repo.reserveGoalDelegation(input).kind).toBe('reserved');
      reservations.push(input);
    }
    expect(keys()).toHaveLength(102);
    const projected = conversation();
    expect(projected.goals).toHaveLength(51);
    expect(projected.commandDedupe).toHaveLength(100);
    expect(() => parseStoredCoordinatorConversation(projected)).not.toThrow();
    expect(coordinatorConversationCommands(projected).filter(command => command.kind === 'add_goal')).toHaveLength(51);
    expect(coordinatorConversationCommands(projected).filter(command => command.kind === 'delegate_goal')).toHaveLength(51);
    const next = repo.recordStatusMessage({ ...scope, expectedControlRevision: projected.controlRevision,
      commandKey: 'current-status', message: 'Status?' });
    expect(next.kind).toBe('stored');
    if (next.kind !== 'stored') throw new Error('status refused');
    expect(next.conversation.commandDedupe).toContainEqual(expect.objectContaining({ key: 'current-status', messageId: next.messageId }));
    expect(() => parseStoredCoordinatorConversation(next.conversation)).not.toThrow();
    const before = db.prepare('SELECT replay_json,updated_at FROM coordinator_conversation_commands ORDER BY command_key').all();
    expect(repo.reserveGoalDelegation(reservations[0]).kind).toBe('uncertain');
    expect(db.prepare('SELECT replay_json,updated_at FROM coordinator_conversation_commands ORDER BY command_key').all()).toEqual(before);
    expect(keys()).toHaveLength(103);
  });

  it('R1 all readers retain the exact off-page callback at the supported 100-goal bound', () => {
    expect(repo.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    let lastGoal = '';
    for (let index = 0; index < 100; index++) {
      const captured = repo.addGoal({ ...scope, expectedControlRevision: conversation().controlRevision,
        commandKey: `bound-capture-${index}`, objective: `Task ${index}` });
      if (captured.kind !== 'created') throw new Error('capture refused');
      lastGoal = captured.goal.id;
      expect(repo.reserveGoalDelegation({ ...scope, expectedControlRevision: captured.conversation.controlRevision,
        commandKey: `bound-manager-${index}`, goalId: lastGoal, parentSdkSessionId: sdk }).kind).toBe('reserved');
    }
    // Child/outbox/dispatch are synthetic boundary inputs, not seeded command
    // history: all 200 journal operations above use production APIs.
    db.prepare(`INSERT INTO agent_sessions (id,agent_kind,cwd,name,owner_user_id,project_id,parent_session_id)
      VALUES ('bound-child','workflow-orchestrator','/private/tmp','Synthetic child',7,?,?)`).run(scope.projectId, scope.sessionId);
    db.prepare(`INSERT INTO agent_async_delegations
      (id,parent_session_id,child_session_id,target_agent_config_id,status,created_at,updated_at)
      VALUES ('bound-delegation',?,'bound-child','workflow-orchestrator','waking',?,?)`)
      .run(scope.sessionId, clock().toISOString(), clock().toISOString());
    expect(repo.settleGoalDelegation({ ...scope, expectedControlRevision: conversation().controlRevision,
      commandKey: 'bound-manager-99', goalId: lastGoal, outcome: 'dispatched',
      childSessionId: 'bound-child', delegationId: 'bound-delegation' }).kind).toBe('dispatched');
    db.prepare(`INSERT INTO agent_turn_dispatches
      (id,session_id,sdk_session_id,sdk_user_message_id,origin,requested_source,route_authed,reason_code,outcome,created_at,updated_at)
      VALUES ('bound-callback',?,?,'msg_bound_callback','delegation_completion','agent_config',NULL,
        'c2_goal_callback:bound-delegation','accepted',?,?)`).run(scope.sessionId, sdk, clock().toISOString(), clock().toISOString());
    expect(repo.recordStatusMessage({ ...scope, expectedControlRevision: conversation().controlRevision,
      commandKey: 'bound-next', message: 'Status?' }).kind).toBe('stored');
    const publicPage = conversation();
    expect(publicPage.commandDedupe).toHaveLength(100);
    expect(publicPage.commandDedupe.some(command => command.key === 'bound-manager-99')).toBe(false);
    expect(publicPage.commandDedupe.some(command => command.key === 'bound-next')).toBe(true);
    expect(publicPage.commandJournal?.goalCommands).toHaveLength(200);
    expect(coordinatorConversationCommands(publicPage).filter(command => command.kind === 'delegate_goal')).toHaveLength(100);
    expect(() => parseStoredCoordinatorConversation(publicPage)).not.toThrow();
    const bad = structuredClone(publicPage);
    bad.commandJournal!.goalCommands.find(command => command.key === 'bound-capture-99')!.intentHash = '0'.repeat(64);
    expect(() => parseStoredCoordinatorConversation(bad)).toThrow();
    expect(keys()).toHaveLength(201);
    expect(new DayflowReceivingContextRepository(db).findProviderReceiver({ ...scope, sdkSessionId: sdk,
      directory: '/private/tmp', profileId: 'librarian', rootChat: true, unsafeCode: null }, 'msg_bound_callback'))
      .toEqual({ kind: 'delegation_callback', dispatchId: 'bound-callback', sdkUserMessageId: 'msg_bound_callback',
        goalId: lastGoal, delegationId: 'bound-delegation', childSessionId: 'bound-child' });
  });

  it('R1 public page metadata cannot self-validate a stored legacy control', () => {
    const raw = JSON.stringify({ schemaVersion: 4, id: 'legacy-public-page', sessionId: scope.sessionId,
      ownerUserId: 7, projectId: scope.projectId, controlRevision: 1, primaryOwnerRoot: true,
      goals: [], commandDedupe: [], commandJournal: { paginated: true, goalCommands: [] },
      continuations: [], createdAt: clock().toISOString(), updatedAt: clock().toISOString() });
    db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=? WHERE id=?').run(raw, scope.sessionId);
    expect(repo.get(scope).kind).toBe('integrity_hold');
    expect(db.prepare('SELECT coordinator_command_storage AS storage,coordinator_conversation_json AS value FROM agent_sessions WHERE id=?')
      .get(scope.sessionId)).toEqual({ storage: null, value: raw });
    expect(keys()).toEqual([]);
  });
});
