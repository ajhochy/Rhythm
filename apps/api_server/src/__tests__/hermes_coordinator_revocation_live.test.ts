import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

// Real compiled HTTP API + engine metadata. Synthetic durable question delivery row
// is a retained-history fixture, NOT a claim of real question production/provider work.
it.skipIf(process.env.RHYTHM_LIVE_E2E !== '1')('compiled API denies all five revoked coordinator histories and ACKs without journal changes', async () => {
  const sb='/private/tmp/hermes-coordinator-notify-20261014-sandbox';
  expect(process.env.RHYTHM_SANDBOX_DIR).toBe(sb);
  expect(process.env.RHYTHM_APPROVED_FIXTURE_ROOT).toBe('/private/tmp/hermes-coordinator-notify-20261014-fixture');
  expect(process.env.RHYTHM_LIVE_DB_PATH).toBe('/private/tmp/hermes-coordinator-notify-20261014-fixture/rhythm.db');
  expect(process.env.RHYTHM_SANDBOX_OPENCODE_CONFIG).toBe('/private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json');
  expect(readFileSync(`${sb}/api_server.pid`,'utf8').trim()).toMatch(/^\d+$/);
  const engine=async (parentID?: string) => {
    const response=await fetch('http://127.0.0.1:4997/session',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Synthetic revocation',...(parentID?{parentID}:{})})});
    expect(response.status).toBe(200); return await response.json() as {id:string};
  };
  const db=new Database(`${sb}/rhythm.db`); setDb(db);
  try {
    for (const change of ['child-owner','child-project','child-parent','delegation-target','root-sdk']) {
      const owner=new UsersRepository().create({name:'Synthetic revocation',email:`${randomUUID()}@example.invalid`}).id;
      const token=new SessionsRepository().create(owner).token;
      const root=randomUUID(), child=randomUUID(), project=randomUUID(), chat=randomUUID(), chain=randomUUID(), projection=randomUUID(), now=new Date().toISOString();
      const rootEngine=await engine(), childEngine=await engine(rootEngine.id);
      db.prepare('INSERT INTO projects(id,name,cwd,created_at) VALUES (?,?,?,?)').run(project,'Synthetic revocation',sb,now);
      for (const [id,sdk,parent] of [[root,rootEngine.id,null],[child,childEngine.id,root]]) db.prepare(`INSERT INTO agent_sessions
        (id,name,agent_kind,status,cwd,owner_user_id,sdk_session_id,project_id,parent_session_id,profile_id)
        VALUES (?,?,'manager','idle',?,?,?,?,?,'secretary')`).run(id,'Synthetic revocation',sb,owner,sdk,project,parent);
      new AgentBridgeProjectionsRepository(db).insert({projectionId:projection,localUserId:owner,hermesProfile:'default',agentId:'manager',revision:1,
        launchKind:'interactive',sessionKey:chat,jobId:null,depth:0,chainId:chain,cwd:null,snapshotJson:'{}',issuedGeneration:'synthetic-revocation',issuedAt:now});
      const jobs=new AgentBridgeJobsRepository(db), {row}=jobs.createOrReplay({direction:'hermes_to_rhythm',idempotencyKey:randomUUID(),requestSha256:'synthetic',localUserId:owner,
        hermesProfile:'default',parentRuntime:'hermes',parentRuntimeInstance:'synthetic-revocation',parentSessionId:chain,parentAgentId:'manager',parentProjectionId:projection,
        targetAgentId:'secretary',targetRevision:1,targetRuntime:'opencode',depth:1,chainId:chain,prompt:'Synthetic',context:null,cwd:null,now});
      jobs.setChild(row.id,root);
      const http=async (path: string, method='GET', body?: object) => fetch(`http://127.0.0.1:4998/hermes-notify/${path}`,{
        method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        ...(body?{body:JSON.stringify(body)}:{})});
      expect((await http(`runs/${row.id}/origin`,'POST',{sessionId:root,hermesSessionId:chat})).status).toBe(201);
      expect((await http(`runs/${row.id}/events`)).status).toBe(200); // Ordinary no-goal origin remains authorized.
      const repo=new CoordinatorConversationsRepository(), scope={ownerUserId:owner,projectId:project,sessionId:root};
      const designated=repo.designatePrimaryOwnerRoot(scope); if(designated.kind!=='found')throw new Error(designated.kind);
      const added=repo.addGoal({...scope,expectedControlRevision:designated.conversation.controlRevision,commandKey:randomUUID(),objective:'Synthetic'});
      if(added.kind!=='created')throw new Error(added.kind);
      const expired=new AgentApprovalsRepository().create({sessionId:root,action:'Expired synthetic',expiresAt:'2000-01-01T00:00:00.000Z'});
      const pendingResponse=await http(`runs/${row.id}/events`); expect(pendingResponse.status).toBe(200);
      expect(await pendingResponse.text()).not.toContain(expired.id); // Captured/pending is not structural UNKNOWN.
      const commandKey=randomUUID(), reserved=repo.reserveGoalDelegation({...scope,expectedControlRevision:added.conversation.controlRevision,commandKey,goalId:added.goal.id,parentSdkSessionId:rootEngine.id});
      if(reserved.kind!=='reserved')throw new Error(reserved.kind);
      const delegation=new AgentAsyncDelegationsRepository().create({parentSessionId:root,childSessionId:child,targetAgentConfigId:'workflow-orchestrator'});
      expect(repo.settleGoalDelegation({...scope,expectedControlRevision:reserved.conversation.controlRevision,commandKey,goalId:added.goal.id,outcome:'dispatched',delegationId:delegation.id,childSessionId:child}).kind).toBe('dispatched');
      const card=new AgentApprovalsRepository().create({sessionId:child,action:'Synthetic',preview:'RAW_PRIVATE_MODEL_TOKEN'});
      const questionId=randomUUID();
      db.prepare(`INSERT INTO hermes_notify_events(event_id,session_id,source_key,kind,text,reference_id)
        VALUES (?,?,?,'question','Rhythm session has a question. Open the Rhythm session.','opaque-retained-question')`).run(questionId,root,randomUUID());
      const controlResponse=await http(`runs/${row.id}/events`); expect(controlResponse.status).toBe(200);
      const control=await controlResponse.json() as {events:Array<{kind:string;eventId:string;referenceId:string}>};
      expect(control.events.filter(e=>e.kind==='approval-request').map(e=>e.referenceId)).toEqual([card.id]);
      expect(control.events.find(e=>e.eventId===questionId)?.referenceId).toBe('opaque-retained-question');
      if(change==='child-owner')db.prepare('UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?').run(child);
      if(change==='child-project')db.prepare('UPDATE agent_sessions SET project_id=NULL WHERE id=?').run(child);
      if(change==='child-parent')db.prepare('UPDATE agent_sessions SET parent_session_id=NULL WHERE id=?').run(child);
      if(change==='delegation-target')db.prepare("UPDATE agent_async_delegations SET target_agent_config_id='foreign' WHERE id=?").run(delegation.id);
      if(change==='root-sdk')db.prepare("UPDATE agent_sessions SET sdk_session_id='sdk-replaced' WHERE id=?").run(root);
      expect(repo.listGoalDelegationOutcomes(scope).map(o=>o.outcome)).toEqual(['unknown']);
      const snapshot=()=>JSON.stringify(db.prepare('SELECT * FROM hermes_notify_events WHERE session_id=? ORDER BY cursor').all(root));
      const bytes=snapshot();
      const denied=await http(`runs/${row.id}/events`); expect(denied.status).toBe(404);
      const deniedBody=await denied.text(); expect(deniedBody).not.toContain(card.id); expect(deniedBody).not.toContain('opaque-retained-question');
      for(const event of control.events.filter(e=>['question','approval-request'].includes(e.kind))) {
        for(const state of ['accepted','visible'])expect((await http(`runs/${row.id}/ack`,'POST',{eventId:event.eventId,state})).status).toBe(404);
        expect((await http('ack','POST',{eventId:event.eventId,state:'visible'})).status).toBe(404);
      }
      expect((await http(`stream?runId=${row.id}`)).status).toBe(404);
      expect(JSON.stringify(await (await http('events')).json())).not.toContain(card.id);
      expect(snapshot()).toBe(bytes);
      console.log(`revocation ${change}: canonical UNKNOWN, HTTP list/SSE/ACK404, journal unchanged`);
    }
  } finally { db.close(); }
},60000);
