import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { AppError } from '../errors/app_error';

// Real durable sources/outbox. Engine envelopes here are inputs, not engine-execution proof.
describe('conservative coordinator notification boundaries', () => {
  let db: Database.Database, notify: HermesNotifyService, owner: number, file: string;
  const now = '2026-10-14T12:00:00.000Z';
  const session = (id: string, project: string, parent: string | null) => db.prepare(`INSERT INTO agent_sessions
    (id,name,agent_kind,status,cwd,owner_user_id,sdk_session_id,project_id,parent_session_id,profile_id)
    VALUES (?,?,'manager','idle','/private/tmp',?,?,?,?, 'secretary')`).run(id,id,owner,`sdk-${id}`,project,parent);
  function origin() {
    const root = randomUUID(), project = randomUUID(), chat = randomUUID(), chain = randomUUID(), projection = randomUUID();
    db.prepare('INSERT INTO projects(id,name,cwd,created_at) VALUES (?,?,?,?)').run(project,'Synthetic','/private/tmp',now);
    session(root,project,null);
    new AgentBridgeProjectionsRepository(db).insert({projectionId:projection,localUserId:owner,hermesProfile:'default',
      agentId:'manager',revision:1,launchKind:'interactive',sessionKey:chat,jobId:null,depth:0,chainId:chain,cwd:null,
      snapshotJson:'{}',issuedGeneration:'synthetic-generation',issuedAt:now});
    const jobs = new AgentBridgeJobsRepository(db);
    const {row} = jobs.createOrReplay({direction:'hermes_to_rhythm',idempotencyKey:randomUUID(),requestSha256:'fixture',
      localUserId:owner,hermesProfile:'default',parentRuntime:'hermes',parentRuntimeInstance:'synthetic-generation',
      parentSessionId:chain,parentAgentId:'manager',parentProjectionId:projection,targetAgentId:'secretary',targetRevision:1,
      targetRuntime:'opencode',depth:1,chainId:chain,prompt:'Synthetic',context:null,cwd:null,now});
    jobs.setChild(row.id,root); notify.bindBridge(row.id);
    return {root,project,chat,run:row.id,jobs,owner};
  }
  function goal(input: ReturnType<typeof origin>) {
    owner = input.owner;
    const repository = new CoordinatorConversationsRepository();
    const scope = {ownerUserId:owner,projectId:input.project,sessionId:input.root};
    const root = repository.designatePrimaryOwnerRoot(scope);
    if (root.kind !== 'found') throw new Error(root.kind);
    const added = repository.addGoal({...scope,expectedControlRevision:root.conversation.controlRevision,commandKey:randomUUID(),objective:'Synthetic review'});
    if (added.kind !== 'created') throw new Error(added.kind);
    const commandKey = randomUUID();
    const reserved = repository.reserveGoalDelegation({...scope,expectedControlRevision:added.conversation.controlRevision,
      commandKey,goalId:added.goal.id,parentSdkSessionId:`sdk-${input.root}`});
    if (reserved.kind !== 'reserved') throw new Error(reserved.kind);
    const child = randomUUID(); session(child,input.project,input.root);
    const delegation = new AgentAsyncDelegationsRepository().create({parentSessionId:input.root,childSessionId:child,targetAgentConfigId:'workflow-orchestrator'});
    expect(repository.settleGoalDelegation({...scope,expectedControlRevision:reserved.conversation.controlRevision,commandKey,
      goalId:added.goal.id,outcome:'dispatched',delegationId:delegation.id,childSessionId:child}).kind).toBe('dispatched');
    return {child,delegation:delegation.id};
  }
  const terminal = (input: ReturnType<typeof origin>) => input.jobs.completeFromRunner(input.run,{status:'done',result:'RAW_UNTRUSTED'});
  const events = (input: ReturnType<typeof origin>) => notify.listRun(input.owner,input.run);
  beforeEach(() => {
    file = join(tmpdir(),`hermes-coordinator-boundary-${randomUUID()}.db`);
    db = new Database(file); runMigrations(db); setDb(db);
    owner = new UsersRepository().create({name:'Synthetic',email:'boundary@example.invalid'}).id;
    notify = new HermesNotifyService(); notify.initialize();
  });
  afterEach(() => { notify.stop(); db.close(); }); // Retain isolated temporary evidence; no destructive cleanup.

  it.each(['owner','project','delegation','undeclared'] as const)('rejects foreign card lineage: %s', mismatch => {
    const input = origin(), linked = goal(input);
    const approvals = new AgentApprovalsRepository();
    const existingCard = mismatch === 'undeclared' ? null : approvals.create({sessionId:linked.child,action:'Synthetic',preview:'RAW_PRIVATE'});
    const before = events(input);
    const progress = before.find(e => e.kind === 'progress')!;
    expect(progress.state).toBe('pending');
    if (existingCard) expect(before.filter(e => e.kind === 'approval-request').map(e => e.referenceId)).toEqual([existingCard.id]);
    expect(JSON.stringify(before)).not.toContain('RAW_');
    const journal = () => JSON.stringify({events:db.prepare('SELECT * FROM hermes_notify_events ORDER BY cursor').all(),
      origins:db.prepare('SELECT * FROM hermes_notify_origins ORDER BY session_id').all()});
    const retained = journal();
    let child = linked.child;
    if (mismatch === 'owner') db.prepare('UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?').run(child);
    if (mismatch === 'project') db.prepare('UPDATE agent_sessions SET project_id=NULL WHERE id=?').run(child);
    if (mismatch === 'delegation') db.prepare("UPDATE agent_async_delegations SET target_agent_config_id='foreign' WHERE id=?").run(linked.delegation);
    if (mismatch === 'undeclared') { child=randomUUID(); session(child,input.project,input.root); }
    const foreignCard = approvals.create({sessionId:child,action:'FOREIGN',preview:'RAW_PRIVATE'});
    terminal(input);
    if (mismatch === 'undeclared') {
      expect(events(input).filter(e => ['completion','approval-request'].includes(e.kind))).toEqual([]);
      expect(events(input).some(e => e.kind === 'progress' && e.text.includes('verification pending'))).toBe(true);
      expect(JSON.stringify(events(input))).not.toContain('RAW_PRIVATE');
      expect(JSON.stringify(events(input))).not.toContain(foreignCard.id);
    } else {
      expect(new CoordinatorConversationsRepository().listGoalDelegationOutcomes({ownerUserId:input.owner,projectId:input.project,sessionId:input.root})
        .map(o => o.outcome)).toEqual(['unknown']);
      const bytes = db.serialize(); // Source job/card fixture mutations above are legitimate; denial must not mutate anything.
      for (const probe of [
        () => events(input),
        () => notify.listRun(input.owner,input.run,progress.cursor),
        ...before.flatMap(event => [
          () => notify.ackRun(input.owner,input.run,event.eventId,'accepted'),
          () => notify.ackRun(input.owner,input.run,event.eventId,'visible'),
          () => notify.ack(input.owner,event.eventId,'visible'),
        ]),
        () => notify.ackRun(input.owner,input.run,foreignCard.id,'visible'),
      ]) {
        let error: unknown;
        try { probe(); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({statusCode:404,code:'NOT_FOUND'});
        expect((error as AppError).message).toMatch(/^(Workflow|Notification) not found$/);
        for (const reference of [existingCard!.id,foreignCard.id,'RAW_PRIVATE','RAW_UNTRUSTED']) expect(JSON.stringify(error)).not.toContain(reference);
      }
      notify.append(input.root,'invalid-lineage','progress',foreignCard.id);
      notify.ingest({payload:{type:'session.error',properties:{sessionID:`sdk-${input.root}`,error:'RAW_PRIVATE'}}} as never);
      expect(notify.list(input.owner)).toEqual([]); // No V1 history fallback or publication of the late foreign card.
      expect(journal()).toBe(retained);
      expect(db.serialize().equals(bytes)).toBe(true);
      for (const card of [existingCard!,foreignCard]) expect(approvals.getById(card.id)).toMatchObject({status:'pending',consumedAt:null});
    }
  });

  it('projects only declared async descendants, not parent-only spoofed siblings', () => {
    const input=origin(), linked=goal(input), child=randomUUID(), spoof=randomUUID();
    session(child,input.project,linked.child); session(spoof,input.project,linked.child);
    new AgentAsyncDelegationsRepository().create({parentSessionId:linked.child,childSessionId:child,targetAgentConfigId:'coding-agent'});
    const approvals = new AgentApprovalsRepository();
    const card=approvals.create({sessionId:child,action:'Synthetic',preview:'RAW_PRIVATE'});
    approvals.create({sessionId:spoof,action:'Synthetic'});
    expect(events(input).filter(e => e.kind === 'approval-request').map(e => e.referenceId)).toEqual([card.id]);
  });

  it('ordinary completion is explicitly execution-only, and known questions withhold it', () => {
    const input=origin(); terminal(input);
    notify.ingest({payload:{type:'question.asked',properties:{sessionID:`sdk-${input.root}`,id:'engine-q',questions:[{question:'RAW_PROMPT'}]}}} as never);
    const pending=events(input);
    expect(pending.filter(e => e.kind === 'completion')).toEqual([]);
    expect(pending.filter(e => e.kind === 'question')).toMatchObject([{referenceId:'engine-q',engineRequestID:'engine-q',text:'Rhythm session has a question. Open the Rhythm session.'}]);
    expect(JSON.stringify(pending)).not.toContain('RAW_PROMPT');
    notify.ingest({payload:{type:'question.replied',properties:{sessionID:`sdk-${input.root}`,requestID:'engine-q'}}} as never);
    expect(events(input).filter(e => e.kind === 'completion').map(e => e.text)).toEqual(['Rhythm agent execution completed.']);
    expect(() => notify.ackRun(owner,input.run,'engine-q','visible')).toThrow();
  });

  it('three independent origins retain sanitized progress/error/cards and stable replay after SQLite reopen', () => {
    // The canonical repository permits one designated primary root per owner.
    const inputs=[0,1,2].map(i => {
      owner=new UsersRepository().create({name:`Synthetic ${i}`,email:`origin-${i}@example.invalid`}).id;
      return origin();
    }), children=inputs.map(goal), delegations=new AgentAsyncDelegationsRepository();
    delegations.markCompleted(children[0].child,'RAW_ALL_PASS');
    delegations.markFailed(children[1].child,'RAW_ERROR');
    const card=new AgentApprovalsRepository().create({sessionId:children[2].child,action:'Synthetic',preview:'RAW_PREVIEW'});
    inputs.forEach(terminal);
    const first=inputs.map(events);
    expect(first[0].some(e => e.text === 'Rhythm returned output; verification pending.')).toBe(true);
    expect(first[1].some(e => e.kind === 'error')).toBe(true);
    expect(first[2].filter(e => e.kind === 'approval-request').map(e => e.referenceId)).toEqual([card.id]);
    for (let i=0;i<3;i++) {
      expect(first[i].every(e => e.hermesSessionId===inputs[i].chat && e.sessionId===inputs[i].root && e.runId===inputs[i].run)).toBe(true);
      expect(first[i].filter(e => e.kind === 'completion')).toEqual([]);
    }
    expect(JSON.stringify(first)).not.toContain('RAW_');
    notify.stop(); db.close(); db=new Database(file); setDb(db); notify=new HermesNotifyService(); notify.initialize();
    expect(inputs.map(events).map(es => es.map(e => e.eventId))).toEqual(first.map(es => es.map(e => e.eventId)));
    expect(inputs.map(events).map(es => es.map(e => e.eventId))).toEqual(first.map(es => es.map(e => e.eventId)));
  });

  it('child engine question delivery deduplicates across reopen without granting card or action authority', () => {
    const input=origin(), linked=goal(input);
    const envelope={payload:{type:'question.asked',properties:{sessionID:`sdk-${linked.child}`,id:'opaque-engine-request',question:'RAW_PROMPT'}}};
    notify.ingest(envelope as never); notify.ingest(envelope as never);
    const first=events(input).filter(e=>e.kind==='question');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({referenceId:'opaque-engine-request',engineRequestID:'opaque-engine-request'});
    expect(events(input).filter(e=>e.kind==='approval-request')).toEqual([]);
    notify.stop(); db.close(); db=new Database(file); setDb(db); notify=new HermesNotifyService(); notify.initialize();
    notify.ingest(envelope as never);
    expect(events(input).filter(e=>e.kind==='question').map(e=>e.eventId)).toEqual(first.map(e=>e.eventId));
    expect(JSON.stringify(events(input))).not.toContain('RAW_PROMPT');
    expect(()=>notify.ackRun(input.owner,input.run,'opaque-engine-request','visible')).toThrow();
  });
});
