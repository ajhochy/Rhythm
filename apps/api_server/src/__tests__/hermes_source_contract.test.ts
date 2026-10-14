import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { UsersRepository } from '../repositories/users_repository';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { AgentBridgeProjectionsRepository } from '../shared_agents/projections_repository';
import { HermesNotifyService } from '../services/hermes_notify_service';

// Unit contract over real repositories/outbox, not a substitute for engine/native E2E.
describe('Hermes authoritative source contract (no mocked system)', () => {
  let db: Database.Database;
  let notify: HermesNotifyService;
  let owner: number;
  let session: string;
  beforeEach(() => {
    db = new Database(':memory:'); runMigrations(db); setDb(db);
    owner = new UsersRepository().create({name:'Fixture owner',email:'source@example.invalid'}).id;
    session = randomUUID();
    db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,owner_user_id,sdk_session_id)
      VALUES (?,'Source fixture','manager','running','/private/tmp',?,?)`).run(session,owner,'sdk-fixture');
    notify = new HermesNotifyService(); notify.initialize();
  });
  afterEach(() => { notify.stop(); db.close(); });
  it('external engine permission ID is not published as a canonical approval card', () => {
    notify.bind(owner,session,'disposable-chat','opaque-correlation');
    notify.ingest({payload:{type:'permission.asked',properties:{sessionID:'sdk-fixture',id:'external-permission'}}} as any);
    expect(notify.list(owner).filter(e => e.kind === 'approval-request')).toEqual([]);
  });
  it('pending canonical card automatically journals exactly its card ID; restart/replay deduplicates', () => {
    notify.bind(owner,session,'disposable-chat','opaque-correlation'); notify.start();
    const card = new AgentApprovalsRepository().create({sessionId:session,action:'Synthetic approval',preview:'Must never cross notification'});
    const persisted = db.prepare("SELECT reference_id,text FROM hermes_notify_events WHERE kind='approval-request'").all();
    expect(persisted).toEqual([{reference_id:card.id,text:'Rhythm session needs approval. Open the Rhythm card.'}]);
    notify.stop(); notify.start();
    expect(notify.list(owner).filter(e => e.kind === 'approval-request').map(e => e.referenceId)).toEqual([card.id]);
    expect(notify.list(owner + 1)).toEqual([]);
  });
  it('trusted Hermes bridge registry supports V2 owner/immutable origin, terminal source and foreign ACK denial', () => {
    const jobs = new AgentBridgeJobsRepository(db);
    const projectionId = randomUUID(), chainId = randomUUID(), chat = randomUUID();
    new AgentBridgeProjectionsRepository(db).insert({projectionId,localUserId:owner,hermesProfile:'default',agentId:'manager',
      revision:1,launchKind:'interactive',sessionKey:chat,jobId:null,depth:0,chainId,cwd:null,
      snapshotJson:'{}',issuedGeneration:'fixture-generation',issuedAt:new Date().toISOString()});
    const {row} = jobs.createOrReplay({direction:'hermes_to_rhythm',idempotencyKey:randomUUID(),requestSha256:'fixture',
      localUserId:owner,hermesProfile:'default',parentRuntime:'hermes',parentRuntimeInstance:'fixture-generation',
      parentSessionId:chainId,parentAgentId:'manager',parentProjectionId:projectionId,targetAgentId:'worker',
      targetRevision:1,targetRuntime:'opencode',depth:1,chainId,prompt:'Disposable',context:null,cwd:null,now:new Date().toISOString()});
    jobs.setChild(row.id,session);
    notify.bindRun(owner,row.id,session,chat);
    expect(notify.listRun(owner,row.id).every(e => e.version === 2 && e.hermesSessionId === chat && e.runId === row.id)).toBe(true);
    expect(() => notify.bindRun(owner,row.id,session,'different-chat')).toThrow();
    notify.ingest({payload:{type:'session.status',properties:{sessionID:'sdk-fixture',status:{type:'idle'}}}} as any);
    expect(notify.listRun(owner,row.id).some(e => e.kind === 'completion')).toBe(false);
    jobs.completeFromRunner(row.id,{sessionId:session,status:'error',result:'',error:'Fixture peer error'});
    const events = notify.listRun(owner,row.id);
    expect(events.some(e => e.kind === 'error')).toBe(true);
    expect(events.some(e => e.kind === 'completion')).toBe(false);
    expect(() => notify.ackRun(owner + 1,row.id,events[0].eventId,'visible')).toThrow();
    notify.ackRun(owner,row.id,events[0].eventId,'visible');
    db.prepare('UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?').run(session);
    expect(() => notify.listRun(owner,row.id)).toThrow();
  });
});
