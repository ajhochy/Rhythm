import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { AgentBridgeProjectionsRepository } from '../shared_agents/projections_repository';

// Real HTTP notifier + real engine metadata/lifecycle; seeded execution outcomes are fixtures,
// not evidence that a provider executed coding or verification. No notifier import/mocking.
it.skipIf(process.env.RHYTHM_LIVE_E2E !== '1')('owned live API withholds coding completion and returns exact child card after real engine idle', async () => {
  const sb='/private/tmp/hermes-coordinator-notify-20261014-sandbox';
  expect(process.env.RHYTHM_SANDBOX_DIR).toBe(sb);
  expect(process.env.RHYTHM_APPROVED_FIXTURE_ROOT).toBe('/private/tmp/hermes-coordinator-notify-20261014-fixture');
  expect(process.env.RHYTHM_LIVE_DB_PATH).toBe('/private/tmp/hermes-coordinator-notify-20261014-fixture/rhythm.db');
  expect(process.env.RHYTHM_SANDBOX_OPENCODE_CONFIG).toBe('/private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json');
  expect(readFileSync(`${sb}/api_server.pid`,'utf8').trim()).toMatch(/^\d+$/);
  const request=async <T = unknown>(url: string, method='GET', body?: object, token?: string): Promise<T> => {
    const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    expect(response.status).toBe(200);
    return response.json() as Promise<T>;
  };
  await request('http://127.0.0.1:4998/health');
  await request('http://127.0.0.1:4998/opencode/health');
  const engine=await request<{id:string}>('http://127.0.0.1:4997/session','POST',{title:'Synthetic coordinator notification'});
  const db=new Database(`${sb}/rhythm.db`); setDb(db);
  try {
    const owner=new UsersRepository().create({name:'Synthetic live notifier',email:`${randomUUID()}@example.invalid`}).id;
    const token=new SessionsRepository().create(owner).token; // New sandbox-only synthetic auth, never operator credentials.
    const root=randomUUID(), project=randomUUID(), chat=randomUUID(), chain=randomUUID(), projection=randomUUID(), now=new Date().toISOString();
    db.prepare('INSERT INTO projects(id,name,cwd,created_at) VALUES (?,?,?,?)').run(project,'Synthetic live',sb,now);
    const session=(id: string,sdk: string,parent: string|null) => db.prepare(`INSERT INTO agent_sessions
      (id,name,agent_kind,status,cwd,owner_user_id,sdk_session_id,project_id,parent_session_id,profile_id)
      VALUES (?,?,'manager','idle',?,?,?,?,?,'secretary')`).run(id,'Synthetic live',sb,owner,sdk,project,parent);
    session(root,engine.id,null);
    const conversations=new CoordinatorConversationsRepository(), scope={ownerUserId:owner,projectId:project,sessionId:root};
    expect(conversations.designatePrimaryOwnerRoot(scope).kind).toBe('found');
    new AgentBridgeProjectionsRepository(db).insert({projectionId:projection,localUserId:owner,hermesProfile:'default',agentId:'manager',
      revision:1,launchKind:'interactive',sessionKey:chat,jobId:null,depth:0,chainId:chain,cwd:null,snapshotJson:'{}',
      issuedGeneration:'synthetic-live',issuedAt:now});
    const jobs=new AgentBridgeJobsRepository(db);
    const {row}=jobs.createOrReplay({direction:'hermes_to_rhythm',idempotencyKey:randomUUID(),requestSha256:'synthetic-live',localUserId:owner,
      hermesProfile:'default',parentRuntime:'hermes',parentRuntimeInstance:'synthetic-live',parentSessionId:chain,parentAgentId:'manager',
      parentProjectionId:projection,targetAgentId:'secretary',targetRevision:1,targetRuntime:'opencode',depth:1,chainId:chain,
      prompt:'Synthetic',context:null,cwd:null,now});
    jobs.setChild(row.id,root);
    const bound=await fetch(`http://127.0.0.1:4998/hermes-notify/runs/${row.id}/origin`,{method:'POST',redirect:'error',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({sessionId:root,hermesSessionId:chat})});
    expect(bound.status).toBe(201);
    for (let i=0;i<2;i++) {
      const read=conversations.get(scope); if(read.kind!=='found')throw new Error(read.kind);
      const added=conversations.addGoal({...scope,expectedControlRevision:read.conversation.controlRevision,commandKey:randomUUID(),objective:'Synthetic goal'});
      if(added.kind!=='created')throw new Error(added.kind);
      const commandKey=randomUUID(), reserved=conversations.reserveGoalDelegation({...scope,expectedControlRevision:added.conversation.controlRevision,
        commandKey,goalId:added.goal.id,parentSdkSessionId:engine.id});
      if(reserved.kind!=='reserved')throw new Error(reserved.kind);
      const childEngine=await request<{id:string}>('http://127.0.0.1:4997/session','POST',{parentID:engine.id,title:'Synthetic child'});
      const child=randomUUID(); session(child,childEngine.id,root);
      const delegation=new AgentAsyncDelegationsRepository().create({parentSessionId:root,childSessionId:child,targetAgentConfigId:'workflow-orchestrator'});
      expect(conversations.settleGoalDelegation({...scope,expectedControlRevision:reserved.conversation.controlRevision,commandKey,
        goalId:added.goal.id,outcome:'dispatched',delegationId:delegation.id,childSessionId:child}).kind).toBe('dispatched');
    }
    jobs.completeFromRunner(row.id,{status:'done',result:'RAW_ALL_PASS'});
    await request(`http://127.0.0.1:4997/session/${engine.id}/abort`,'POST',{});
    const list=async () => {
      const page=await request<{version:number;runId:string;events:Array<{kind:string;text:string;referenceId:string;eventId:string}>}>(`http://127.0.0.1:4998/hermes-notify/runs/${row.id}/events`,'GET',undefined,token);
      expect(Object.keys(page).sort()).toEqual(['events','runId','version']);
      expect(page.version).toBe(2); expect(page.runId).toBe(row.id);
      for (const event of page.events) {
        expect(Object.keys(event).sort()).toEqual(['cursor','eventId','hermesSessionId','kind','referenceId','runId','sessionId','state','text','version','workflowId']);
        expect(event).toMatchObject({version:2,runId:row.id,workflowId:row.id,sessionId:root,hermesSessionId:chat});
      }
      expect(JSON.stringify(page.events)).not.toContain('Rhythm returned output; verification pending.');
      expect(JSON.stringify(page.events)).not.toContain('engineRequestID');
      const validated=spawnSync('python3',['-B',resolve(__dirname,'../../../../tools/dev/hermes_v2_pinned_validator.py')],
        {input:JSON.stringify(page.events),encoding:'utf8',timeout:15000});
      expect(validated.error).toBeUndefined();
      expect(validated.status,validated.stderr || validated.stdout).toBe(0);
      expect(JSON.parse(validated.stdout)).toEqual({validated:page.events.length,errors:[]});
      return page.events;
    };
    const pending=await list();
    expect(pending.filter(e=>e.kind==='completion')).toEqual([]);
    const unverified=db.prepare(`SELECT event_id AS eventId,kind,text,state FROM hermes_notify_events
      WHERE session_id=? AND text=? ORDER BY cursor`).all(root,'Rhythm returned output; verification pending.') as
      Array<{eventId:string;kind:string;text:string;state:string}>;
    expect(unverified.length).toBeGreaterThan(0);
    for (const event of unverified) {
      expect(event).toEqual({eventId:event.eventId,kind:'progress',text:'Rhythm returned output; verification pending.',state:'pending'});
      expect(pending.find(e=>e.eventId===event.eventId)).toMatchObject({kind:'progress',text:'Rhythm session updated.'});
    }
    const children=new AgentAsyncDelegationsRepository().listForParent(root);
    new AgentAsyncDelegationsRepository().markCompleted(children[0].childSessionId,'RAW_ALL_PASS');
    new AgentAsyncDelegationsRepository().markFailed(children[1].childSessionId,'RAW_ERROR');
    const card=new AgentApprovalsRepository().create({sessionId:children[0].childSessionId,action:'Synthetic',preview:'RAW_PRIVATE'});
    const settled=await list();
    expect(settled.filter(e=>e.kind==='completion')).toEqual([]);
    expect(settled.some(e=>e.kind==='error')).toBe(true);
    expect(settled.filter(e=>e.kind==='approval-request').map(e=>e.referenceId)).toEqual([card.id]);
    expect(JSON.stringify(settled)).not.toContain('RAW_');
    expect((await list()).map(e=>e.eventId)).toEqual(settled.map(e=>e.eventId));
  } finally { db.close(); }
},60000);
