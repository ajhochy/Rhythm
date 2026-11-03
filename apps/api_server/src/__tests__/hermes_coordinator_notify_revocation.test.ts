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

// Frozen acceptance: real repositories/SQLite, no mocked system under test.
describe('current coordinator bridge authority revocation', () => {
  let db: Database.Database, notify: HermesNotifyService, owner: number, file: string;
  const now = '2026-10-14T12:00:00.000Z';
  beforeEach(() => {
    file=join(tmpdir(),`hermes-revocation-${randomUUID()}.db`);
    db=new Database(file); runMigrations(db); setDb(db);
    owner=new UsersRepository().create({name:'Synthetic',email:'revocation@example.invalid'}).id;
    notify=new HermesNotifyService(); notify.initialize();
  });
  afterEach(() => { notify.stop(); db.close(); });
  function fixture() {
    const root=randomUUID(), child=randomUUID(), project=randomUUID(), chat=randomUUID(), chain=randomUUID(), projection=randomUUID();
    db.prepare('INSERT INTO projects(id,name,cwd,created_at) VALUES (?,?,?,?)').run(project,'Synthetic','/private/tmp',now);
    for (const [id,parent] of [[root,null],[child,root]]) db.prepare(`INSERT INTO agent_sessions
      (id,name,agent_kind,status,cwd,owner_user_id,sdk_session_id,project_id,parent_session_id,profile_id)
      VALUES (?,?,'manager','idle','/private/tmp',?,?,?,?,'secretary')`).run(id,id,owner,`sdk-${id}`,project,parent);
    new AgentBridgeProjectionsRepository(db).insert({projectionId:projection,localUserId:owner,hermesProfile:'default',agentId:'manager',revision:1,
      launchKind:'interactive',sessionKey:chat,jobId:null,depth:0,chainId:chain,cwd:null,snapshotJson:'{}',issuedGeneration:'synthetic-generation',issuedAt:now});
    const jobs=new AgentBridgeJobsRepository(db);
    const {row}=jobs.createOrReplay({direction:'hermes_to_rhythm',idempotencyKey:randomUUID(),requestSha256:'fixture',localUserId:owner,
      hermesProfile:'default',parentRuntime:'hermes',parentRuntimeInstance:'synthetic-generation',parentSessionId:chain,parentAgentId:'manager',
      parentProjectionId:projection,targetAgentId:'secretary',targetRevision:1,targetRuntime:'opencode',depth:1,chainId:chain,prompt:'Synthetic',context:null,cwd:null,now});
    jobs.setChild(row.id,root); notify.bindBridge(row.id);
    const repository=new CoordinatorConversationsRepository(), scope={ownerUserId:owner,projectId:project,sessionId:root};
    const designated=repository.designatePrimaryOwnerRoot(scope);
    if (designated.kind!=='found') throw new Error(designated.kind);
    const added=repository.addGoal({...scope,expectedControlRevision:designated.conversation.controlRevision,commandKey:randomUUID(),objective:'Synthetic'});
    if (added.kind!=='created') throw new Error(added.kind);
    const commandKey=randomUUID();
    const reserved=repository.reserveGoalDelegation({...scope,expectedControlRevision:added.conversation.controlRevision,commandKey,goalId:added.goal.id,parentSdkSessionId:`sdk-${root}`});
    if (reserved.kind!=='reserved') throw new Error(reserved.kind);
    const delegation=new AgentAsyncDelegationsRepository().create({parentSessionId:root,childSessionId:child,targetAgentConfigId:'workflow-orchestrator'});
    expect(repository.settleGoalDelegation({...scope,expectedControlRevision:reserved.conversation.controlRevision,commandKey,goalId:added.goal.id,
      outcome:'dispatched',delegationId:delegation.id,childSessionId:child}).kind).toBe('dispatched');
    const card=new AgentApprovalsRepository().create({sessionId:child,action:'Synthetic',preview:'RAW_MODEL_TOKEN'});
    const envelope={payload:{type:'question.asked',properties:{sessionID:`sdk-${child}`,id:'opaque-question',question:'RAW_MODEL_TOKEN'}}};
    notify.ingest(envelope as never);
    const before=notify.listRun(owner,row.id);
    expect(before.filter(e=>e.kind==='approval-request').map(e=>e.referenceId)).toEqual([card.id]);
    expect(before.filter(e=>e.kind==='question').map(e=>e.referenceId)).toEqual(['opaque-question']);
    expect(JSON.stringify(before)).not.toContain('RAW_MODEL_TOKEN');
    expect(repository.listGoalDelegationOutcomes(scope).map(o=>o.outcome)).toEqual(['running']);
    return {root,child,project,run:row.id,scope,repository,delegation:delegation.id,envelope,before,jobs};
  }
  const snapshot=()=>JSON.stringify({events:db.prepare('SELECT * FROM hermes_notify_events ORDER BY cursor').all(),
    origins:db.prepare('SELECT * FROM hermes_notify_origins ORDER BY session_id').all()});
  function denied(input: ReturnType<typeof fixture>) {
    const bytes=snapshot();
    expect.soft(()=>notify.listRun(owner,input.run)).toThrow();
    for (const event of input.before.filter(e=>['question','approval-request'].includes(e.kind))) {
      expect.soft(()=>notify.ackRun(owner,input.run,event.eventId,'accepted')).toThrow();
      expect.soft(()=>notify.ackRun(owner,input.run,event.eventId,'visible')).toThrow();
      expect.soft(()=>notify.ack(owner,event.eventId,'visible')).toThrow();
    }
    notify.ingest(input.envelope as never);
    notify.ingest({payload:{type:'session.error',properties:{sessionID:`sdk-${input.root}`,error:'RAW_MODEL_TOKEN'}}} as never);
    notify.append(input.root,'new-invalid','error');
    new AgentApprovalsRepository().create({sessionId:input.child,action:'New synthetic'});
    expect.soft(notify.list(owner)).toEqual([]);
    expect.soft(snapshot()).toBe(bytes);
    notify.stop(); db.close(); db=new Database(file); setDb(db); notify=new HermesNotifyService(); notify.initialize();
    expect.soft(()=>notify.listRun(owner,input.run)).toThrow();
    expect.soft(snapshot()).toBe(bytes);
  }
  it.each(['child-owner','child-project','child-parent','delegation-target','root-sdk'] as const)('denies retained card/question list and ACK after %s revocation', change => {
    const input=fixture();
    if (change==='child-owner') db.prepare('UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?').run(input.child);
    if (change==='child-project') db.prepare('UPDATE agent_sessions SET project_id=NULL WHERE id=?').run(input.child);
    if (change==='child-parent') db.prepare('UPDATE agent_sessions SET parent_session_id=NULL WHERE id=?').run(input.child);
    if (change==='delegation-target') db.prepare("UPDATE agent_async_delegations SET target_agent_config_id='foreign' WHERE id=?").run(input.delegation);
    if (change==='root-sdk') db.prepare("UPDATE agent_sessions SET sdk_session_id='sdk-replaced' WHERE id=?").run(input.root);
    expect(input.repository.listGoalDelegationOutcomes(input.scope).map(o=>o.outcome)).toEqual(['unknown']);
    denied(input);
  });
  it.each(['root-project','root-parent','root-owner','runtime-generation'] as const)('denies invalid root authority without a Recipe/V1 fallback: %s', change => {
    const input=fixture();
    if (change==='root-project') db.prepare('UPDATE agent_sessions SET project_id=NULL WHERE id=?').run(input.root);
    if (change==='root-parent') db.prepare('UPDATE agent_sessions SET parent_session_id=? WHERE id=?').run(input.child,input.root);
    if (change==='root-owner') db.prepare('UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?').run(input.root);
    if (change==='runtime-generation') db.prepare("UPDATE agent_bridge_jobs SET parent_runtime_instance='foreign' WHERE id=?").run(input.run);
    denied(input);
  });
  it('retains authorized dispatched and unverified history and ACK authority', () => {
    const input=fixture();
    new AgentAsyncDelegationsRepository().markCompleted(input.child,'RAW_MODEL_TOKEN');
    expect(input.repository.listGoalDelegationOutcomes(input.scope).map(o=>o.outcome)).toEqual(['returned_result_unverified']);
    const events=notify.listRun(owner,input.run);
    expect(events.filter(e=>e.kind==='completion')).toEqual([]);
    expect(events.filter(e=>e.kind==='question').map(e=>e.eventId)).toEqual(input.before.filter(e=>e.kind==='question').map(e=>e.eventId));
    notify.ackRun(owner,input.run,events.find(e=>e.kind==='question')!.eventId,'accepted');
    expect(notify.listRun(owner,input.run).find(e=>e.kind==='question')?.state).toBe('accepted');
  });
});
