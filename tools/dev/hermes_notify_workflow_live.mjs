import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require=createRequire(import.meta.url);
assert.equal(process.env.RHYTHM_LIVE_E2E,'1');
assert.equal(process.env.DB_PATH,'/private/tmp/hermes-event-notify-20261012-sandbox/rhythm.db');
const {initDb,getDb}=require('../../apps/api_server/dist/database/db.js');
const {AgentCookbookRepository}=require('../../apps/api_server/dist/repositories/agent_cookbook_repository.js');
const {RecipeWorkflowRepository}=require('../../apps/api_server/dist/repositories/recipe_workflow_repository.js');
const {AgentSessionsRepository}=require('../../apps/api_server/dist/repositories/agent_sessions_repository.js');
await initDb();
const token=getDb().prepare('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').get().token;
const api=(path,body)=>fetch(`http://127.0.0.1:4898${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:1000,maxStageExecutions:10},stages:[{id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
test('LIVE: three registry runs -> authenticated HTTP/SSE with independent origins and replay cursors',async()=>{
  const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic live multiworkflow',schemaVersion:1,definitionJson:JSON.stringify(definition)});
  const runs=new RecipeWorkflowRepository(); const fixtures=[];
  for(const name of ['encompass-security-map','rhythm-notify-approval','opus-encompass-review']) {
    const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{goal:name}});
    const response=await api('/agent-sessions',{name:`Synthetic ${name}`,cwd:process.env.HOME});
    assert.equal(response.status,201); const parent=await response.json();
    const stage=runs.listStageExecutions(run.id)[0];
    assert.equal(runs.bindProvisionalSession(stage.id,parent.id),true);
    assert.equal(new AgentSessionsRepository().bindWorkflowSession(parent.id,run.id,stage.id),true);
    const origin={sessionId:parent.id,workflowId:run.id,hermesSessionId:`synthetic-${name}`};
    assert.equal((await api('/hermes-notify/origins',origin)).status,201);
    fixtures.push({run,origin,stage:runs.listStageExecutions(run.id)[0]});
  }
  const before=(await (await api('/hermes-notify/events')).json()).events;
  for(const f of fixtures) assert.ok(before.some(e=>e.workflowId===f.run.id && e.hermesSessionId===f.origin.hermesSessionId && e.text==='Rhythm workflow pending: 0 settled, 1 awaiting.'));
  const stream=await api('/hermes-notify/stream'); assert.equal(stream.status,200);
  const reader=stream.body.getReader(); const frame=new TextDecoder().decode((await reader.read()).value);
  assert.match(frame,/event: notification/); await reader.cancel();
  runs.recordCompletion(fixtures[0].stage.id,{status:'succeeded'}); runs.updateRunStatus(fixtures[0].run.id,'succeeded');
  runs.claim(fixtures[1].stage.id,'pending','blocked_approval'); runs.updateRunStatus(fixtures[1].run.id,'blocked_approval',{pendingApprovalId:fixtures[1].stage.id});
  runs.recordCompletion(fixtures[2].stage.id,{status:'failed'}); runs.updateRunStatus(fixtures[2].run.id,'failed');
  const after=(await (await api('/hermes-notify/events')).json()).events;
  for(const [i,kind] of ['completion','approval-request','error'].entries()) {
    const e=after.find(e=>e.workflowId===fixtures[i].run.id && e.kind===kind);
    assert.ok(e); assert.equal(e.hermesSessionId,fixtures[i].origin.hermesSessionId);
    assert.equal((await api('/hermes-notify/ack',{eventId:e.eventId,state:'accepted'})).status,200);
    const replay=(await (await api(`/hermes-notify/events?after=${e.cursor-1}`)).json()).events;
    assert.ok(replay.some(r=>r.eventId===e.eventId && r.cursor===e.cursor));
  }
  console.log('PASS: authoritative registry -> real HTTP/SSE/replay for three synthetic workflows; no Pi/native wake claim');
});
test.after(()=>getDb().close());
