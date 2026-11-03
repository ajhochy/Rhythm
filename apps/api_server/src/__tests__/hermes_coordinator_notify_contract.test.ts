import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { UsersRepository } from '../repositories/users_repository';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { AgentBridgeProjectionsRepository } from '../shared_agents/projections_repository';
import { HermesNotifyService } from '../services/hermes_notify_service';

// Real C74 repositories and outbox, no mocked notifier/observer or engine execution.
describe('Hermes coordinator durable qualification contract', () => {
  let db: Database.Database;
  let notify: HermesNotifyService;
  let owner: number;
  let jobs: AgentBridgeJobsRepository;
  let delegations: AgentAsyncDelegationsRepository;
  const now = '2026-10-14T12:00:00.000Z';

  function session(id: string, project: string, parent: string | null) {
    db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,owner_user_id,
      sdk_session_id,project_id,parent_session_id,profile_id)
      VALUES (?,?,'manager','idle','/private/tmp',?,?,?,?, 'secretary')`)
      .run(id,id,owner,`sdk-${id}`,project,parent);
  }

  function origin(label: string) {
    const root = randomUUID(), project = randomUUID(), chat = randomUUID(), chain = randomUUID();
    db.prepare('INSERT INTO projects(id,name,cwd,created_at) VALUES (?,?,?,?)')
      .run(project,label,'/private/tmp',now);
    session(root,project,null);
    const conversations = new CoordinatorConversationsRepository(db, () => new Date(now));
    const scope = { ownerUserId:owner, projectId:project, sessionId:root };
    const designated = conversations.designatePrimaryOwnerRoot(scope);
    if (designated.kind !== 'found') throw new Error(`root ${designated.kind}`);
    const projection = randomUUID();
    new AgentBridgeProjectionsRepository(db).insert({projectionId:projection,localUserId:owner,
      hermesProfile:'default',agentId:'manager',revision:1,launchKind:'interactive',sessionKey:chat,
      jobId:null,depth:0,chainId:chain,cwd:null,snapshotJson:'{}',issuedGeneration:'fixture-generation',issuedAt:now});
    const {row} = jobs.createOrReplay({direction:'hermes_to_rhythm',idempotencyKey:randomUUID(),
      requestSha256:'fixture',localUserId:owner,hermesProfile:'default',parentRuntime:'hermes',
      parentRuntimeInstance:'fixture-generation',parentSessionId:chain,parentAgentId:'manager',
      parentProjectionId:projection,targetAgentId:'secretary',targetRevision:1,targetRuntime:'opencode',
      depth:1,chainId:chain,prompt:'Synthetic only',context:null,cwd:null,now});
    jobs.setChild(row.id,root);
    notify.bindBridge(row.id);
    return {root,project,chat,run:row.id,conversations,scope};
  }

  function goal(input: ReturnType<typeof origin>, key: string) {
    const read = input.conversations.get(input.scope);
    if (read.kind !== 'found') throw new Error('conversation');
    const added = input.conversations.addGoal({...input.scope,
      expectedControlRevision:read.conversation.controlRevision,commandKey:`goal-${key}`,objective:`Review ${key}`});
    if (added.kind !== 'created') throw new Error(`goal ${added.kind}`);
    const reserved = input.conversations.reserveGoalDelegation({...input.scope,
      expectedControlRevision:added.conversation.controlRevision,commandKey:`run-${key}`,
      goalId:added.goal.id,parentSdkSessionId:`sdk-${input.root}`});
    if (reserved.kind !== 'reserved') throw new Error(`reserve ${reserved.kind}`);
    const child = randomUUID();
    session(child,input.project,input.root);
    const delegation = delegations.create({parentSessionId:input.root,childSessionId:child,
      targetAgentConfigId:'workflow-orchestrator'});
    const settled = input.conversations.settleGoalDelegation({...input.scope,
      expectedControlRevision:reserved.conversation.controlRevision,commandKey:`run-${key}`,
      goalId:added.goal.id,outcome:'dispatched',delegationId:delegation.id,childSessionId:child});
    expect(settled.kind).toBe('dispatched');
    return {child,delegation:delegation.id};
  }

  function terminal(input: ReturnType<typeof origin>) {
    jobs.completeFromRunner(input.run,{status:'done',result:'Untrusted prose is not all-pass evidence'});
    notify.ingest({payload:{type:'session.status',properties:{sessionID:`sdk-${input.root}`,status:{type:'idle'}}}} as never);
  }

  beforeEach(() => {
    db = new Database(':memory:'); runMigrations(db); setDb(db);
    owner = new UsersRepository().create({name:'Synthetic coordinator owner',email:'coordinator@example.invalid'}).id;
    jobs = new AgentBridgeJobsRepository(db); delegations = new AgentAsyncDelegationsRepository();
    notify = new HermesNotifyService(); notify.initialize();
  });
  afterEach(() => { notify.stop(); db.close(); });

  it('terminal bridge and idle parent cannot complete two pending coordinator children', () => {
    const input = origin('Encompass security map'); goal(input,'security'); goal(input,'map'); terminal(input);
    expect(db.prepare('SELECT count(*) AS n FROM agent_async_delegations').get()).toEqual({n:2});
    expect(notify.listRun(owner,input.run).filter(e => e.kind === 'completion')).toEqual([]);
  });

  it('settled fanout containing a child error cannot publish success', () => {
    const input = origin('Opus review'); const good = goal(input,'review'), bad = goal(input,'repair');
    delegations.markCompleted(good.child,'Returned result, not verification');
    delegations.markFailed(bad.child,'Synthetic raw error must not cross notification'); terminal(input);
    const events = notify.listRun(owner,input.run);
    expect(events.filter(e => e.kind === 'completion')).toEqual([]);
    expect(events.some(e => e.kind === 'error')).toBe(true);
  });

  it('canonical child approval blocks completion and publishes only the existing card ID', () => {
    const input = origin('Rhythm notify approval'); const child = goal(input,'notify');
    const card = new AgentApprovalsRepository().create({sessionId:child.child,action:'Synthetic review',preview:'Private fixture preview'});
    terminal(input);
    const events = notify.listRun(owner,input.run);
    expect(events.filter(e => e.kind === 'completion')).toEqual([]);
    expect(events.filter(e => e.kind === 'approval-request').map(e => e.referenceId)).toEqual([card.id]);
    expect(events.some(e => e.text.includes('Private fixture preview'))).toBe(false);
  });

  it('returned_result_unverified remains manual verification, including notifier reopen and replay', () => {
    const input = origin('Opus review'); const child = goal(input,'review');
    delegations.markCompleted(child.child,'All pass claimed by model'); terminal(input);
    expect(input.conversations.listGoalDelegationOutcomes(input.scope)[0]?.outcome).toBe('returned_result_unverified');
    notify.stop(); notify = new HermesNotifyService(); notify.initialize();
    const first = notify.listRun(owner,input.run), second = notify.listRun(owner,input.run);
    expect(first.filter(e => e.kind === 'completion')).toEqual([]);
    expect(second.map(e => e.eventId)).toEqual(first.map(e => e.eventId));
  });
});
