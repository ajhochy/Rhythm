import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
assert.equal(process.env.RHYTHM_LIVE_E2E,'1');
assert.equal(process.env.DB_PATH,'/private/tmp/hermes-event-notify-20261012-sandbox/rhythm.db');
const {initDb,getDb}=require('../../apps/api_server/dist/database/db.js');
const {AgentCookbookRepository}=require('../../apps/api_server/dist/repositories/agent_cookbook_repository.js');
const {AgentSessionsRepository}=require('../../apps/api_server/dist/repositories/agent_sessions_repository.js');
const {RecipeWorkflowRepository}=require('../../apps/api_server/dist/repositories/recipe_workflow_repository.js');
await initDb();
const db=getDb(), runs=new RecipeWorkflowRepository(), sessions=new AgentSessionsRepository();
const token=db.prepare('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').get().token;
const api=(path,body,auth=token)=>fetch(`http://127.0.0.1:4898${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const receipt=`${process.env.RHYTHM_SANDBOX_DIR}/run-origin-restart.json`;
if(process.argv[2]==='after') {
  const before=JSON.parse(readFileSync(receipt,'utf8'));
  const response=await api(`/hermes-notify/runs/${before.runId}/events`); assert.equal(response.status,200);
  const after=(await response.json()).events;
  for(const event of before.events) assert.deepEqual(after.find(e=>e.eventId===event.eventId),event);
  console.log(`PASS V2 sandbox restart: ${before.events.length} identical pending IDs/cursors/ACK states/original conversation recovered`);
} else {
  test('real fork event after retry projects to V2 original run inbox, stale fork session cannot signal; concurrent refbind fenced',async()=>{
    const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:60000,maxStageExecutions:10},stages:[{id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
    const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic real fork run event',schemaVersion:1,definitionJson:JSON.stringify(definition)});
    const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{}}), stage=runs.listStageExecutions(run.id)[0];
    const hermesSessionId='synthetic-real-fork-original';
    async function createAttempt() {
      const created=await api('/agent-sessions',{name:'Synthetic real fork attempt',cwd:process.env.HOME}); assert.equal(created.status,201);
      const session=await created.json(); assert.ok(session.id);
      assert.ok(runs.claim(stage.id,'pending','running')); assert.ok(runs.bindProvisionalSession(stage.id,session.id)); assert.ok(sessions.bindWorkflowSession(session.id,run.id,stage.id));
      assert.ok(sessions.findById(session.id).sdkSessionId); return session;
    }
    const first=await createAttempt();
    const conflicting=await Promise.all([hermesSessionId,'conflicting-chat'].map(chat=>api(`/hermes-notify/runs/${run.id}/origin`,{sessionId:first.id,hermesSessionId:chat})));
    assert.deepEqual(conflicting.map(r=>r.status).sort(),[201,409]);
    // Establish the winner from authoritative persisted metadata, not request arrival order.
    const actualHermes=db.prepare('SELECT hermes_session_id FROM hermes_notify_run_origins WHERE run_id=?').get(run.id).hermes_session_id;
    const initial=(await (await api(`/hermes-notify/runs/${run.id}/events`)).json()).events;
    assert.equal((await api(`/hermes-notify/runs/${run.id}/ack`,{eventId:initial[0].eventId,state:'accepted'})).status,200);
    runs.resetForRetry(stage.id); const fresh=await createAttempt(); assert.notEqual(fresh.id,first.id);
    assert.equal((await api(`/hermes-notify/runs/${run.id}/origin`,{sessionId:fresh.id,hermesSessionId:actualHermes})).status,201);
    // Freeze initial pending state before the next source transition. Query storage directly:
    // GET would itself project current state and could falsely credit the real engine event.
    await api(`/hermes-notify/runs/${run.id}/events`);
    runs.updateRunStatus(run.id,'running');
    const count=()=>db.prepare('SELECT COUNT(*) AS n FROM hermes_notify_events WHERE session_id=?').get(first.id).n;
    const before=count();
    const patch=session=>fetch(`http://127.0.0.1:4897/session/${sessions.findById(session.id).sdkSessionId}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({title:`Synthetic changed ${session.id}`})});
    assert.equal((await patch(first)).status,200); await new Promise(resolve=>setTimeout(resolve,500)); assert.equal(count(),before,'revoked actual fork session must not project');
    assert.equal((await patch(fresh)).status,200);
    for(let i=0;i<50 && count()===before;i++) await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(count()>before,'real fork SSE must project before any GET');
    const response=await api(`/hermes-notify/runs/${run.id}/events`); assert.equal(response.status,200); const events=(await response.json()).events;
    assert.ok(events.every(e=>e.version===2 && e.runId===run.id && e.hermesSessionId===actualHermes && e.sessionId===first.id));
    assert.ok(!events.some(e=>e.kind==='completion'));
    assert.ok(events.some(e=>e.text==='Rhythm workflow running: 0 settled, 1 awaiting.'));
    const stream=await api(`/hermes-notify/stream?runId=${run.id}`); assert.equal(stream.status,200);
    const reader=stream.body.getReader(); const frame=new TextDecoder().decode((await reader.read()).value); assert.match(frame,/"version":2/); assert.ok(frame.includes(run.id)); await reader.cancel();
    db.prepare('INSERT OR IGNORE INTO sessions(token,user_id) VALUES (?,2)').run('synthetic-v2-other-owner');
    for(const path of [`/hermes-notify/runs/${run.id}/events`,`/hermes-notify/stream?runId=${run.id}`]) assert.equal((await api(path,undefined,'synthetic-v2-other-owner')).status,404);
    assert.equal((await api(`/hermes-notify/runs/${run.id}/ack`,{eventId:events[0].eventId,state:'visible'},'synthetic-v2-other-owner')).status,404);
    assert.equal((await api(`/hermes-notify/runs/${run.id}/ack`,{eventId:events[0].eventId,state:'visible',sessionId:first.id})).status,400);
    writeFileSync(receipt,JSON.stringify({runId:run.id,events}),{mode:0o600,flag:'wx'});
    console.log('PASS real fork SSE -> V2 immutable run inbox after retry; revoked fork session refused; NOT Hermes/provider completion');
  });
}
test.after(()=>db.close());
