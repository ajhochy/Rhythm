import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
assert.equal(process.env.RHYTHM_LIVE_E2E,'1');
assert.equal(process.env.DB_PATH,'/private/tmp/hermes-event-notify-20261012-sandbox/rhythm.db');
process.env.RHYTHM_RECIPE_WORKFLOWS_ENABLED='true';
const {initDb,getDb}=require('../../apps/api_server/dist/database/db.js');
const {AgentSessionsRepository}=require('../../apps/api_server/dist/repositories/agent_sessions_repository.js');
const {AgentCookbookRepository}=require('../../apps/api_server/dist/repositories/agent_cookbook_repository.js');
const {RecipeWorkflowRepository}=require('../../apps/api_server/dist/repositories/recipe_workflow_repository.js');
const {RecipeWorkflowRunner,createAgentRunnerDispatcher}=require('../../apps/api_server/dist/services/recipe_workflow_runner.js');
await initDb();
const db=getDb(), sessions=new AgentSessionsRepository(), runs=new RecipeWorkflowRepository();
const token=db.prepare('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').get().token;
const api=(path,body,auth=token)=>fetch('http://127.0.0.1:4898/hermes-notify'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:60000,maxStageExecutions:20},stages:[
  {id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{outcome:'string'}},next:'gate'},
  {id:'gate',kind:'gate',producerStageId:'work',branches:{pass:'done',fail:'done',repair:'work'},onInvalid:'done',loop:{loopId:'repair',maxIterations:2,maxCostUsd:1,maxTokens:100,maxWallTimeMs:60000,exhaustedTarget:'done'}},
  {id:'done',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic actual runner retry',schemaVersion:1,definitionJson:JSON.stringify(definition)});
for(const [index,name] of ['encompass-security-map','rhythm-notify-approval','opus-encompass-review'].entries()) {
  test(`actual runner retry preserves immutable run origin: ${name}`,async()=>{
    const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{goal:name}});
    const hermesSessionId=`synthetic-run-${name}`, created=[]; let firstHistory, boundaryError;
    const dispatcher=createAgentRunnerDispatcher(runs,sessions,{run:async input=>{
      try {
      // Only the engine boundary is injected. Real dispatcher writes both bindings;
      // real RecipeWorkflowRunner evaluates repair gate, resets and dispatches anew.
      const session=sessions.insert({agentKind:'',cwd:process.env.HOME,name:`Synthetic ${name}`,ownerUserId:1});
      created.push(session.id); await input.onSessionCreated(session.id);
      const binding=sessions.getWorkflowBinding(session.id), stage=runs.listStageExecutions(run.id).find(s=>s.id===binding.workflowStageExecutionId);
      assert.equal(binding.workflowRunId,run.id); assert.equal(stage.provisionalSessionId,session.id); assert.ok(stage.attemptId);
      if(created.length===1) {
        assert.equal((await api('/origins',{sessionId:session.id,workflowId:run.id,hermesSessionId})).status,201);
        firstHistory=(await (await api('/events')).json()).events.filter(e=>e.workflowId===run.id);
        assert.ok(firstHistory.length);
      } else if(created.length===2) {
        assert.notEqual(session.id,created[0]);
        assert.equal(stage.committedSessionId,null);
        assert.ok(!(await (await api('/events')).json()).events.some(e=>e.workflowId===run.id));
        assert.equal((await api('/ack',{eventId:firstHistory[0].eventId,state:'visible'})).status,404);
        assert.equal((await api(`/runs/${run.id}/origin`,{sessionId:session.id,hermesSessionId})).status,201);
        const history=(await (await api(`/runs/${run.id}/events`)).json()).events;
        for(const old of firstHistory) {
          const retained=history.find(e=>e.eventId===old.eventId);
          assert.ok(retained); assert.equal(retained.cursor,old.cursor); assert.equal(retained.state,old.state);
        }
        assert.ok(history.every(e=>e.version===2 && e.runId===run.id && e.hermesSessionId===hermesSessionId));
        assert.equal((await api(`/runs/${run.id}/ack`,{eventId:firstHistory[0].eventId,state:'accepted'})).status,200);
        assert.equal((await api(`/runs/${run.id}/origin`,{sessionId:created[0],hermesSessionId})).status,404);
        assert.equal((await api(`/runs/${run.id}/origin`,{sessionId:session.id,hermesSessionId:'replacement-chat'})).status,409);
        const arbitrary=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic unbound',ownerUserId:1});
        assert.equal((await api(`/runs/${run.id}/origin`,{sessionId:arbitrary.id,hermesSessionId})).status,404);
        assert.equal((await api(`/runs/${run.id}/events`,undefined,'invalid-token')).status,401);
        assert.equal((await api(`/runs/${run.id}/ack`,{eventId:'unmatched',state:'visible'})).status,404);
      }
      return {sessionId:session.id,status:'done',result:JSON.stringify({outcome:created.length===1?'repair':'pass'})};
      } catch(error) { boundaryError=error; throw error; }
    }});
    await new RecipeWorkflowRunner(runs).tick(run.id,dispatcher);
    if(boundaryError) throw boundaryError; // Dispatcher intentionally catches engine errors; preserve contract diagnostics.
    assert.equal(created.length,3); assert.equal(runs.getRun(run.id).status,'succeeded');
    const response=await api(`/runs/${run.id}/events`); assert.equal(response.status,200);
    const events=(await response.json()).events;
    assert.equal(events.filter(e=>e.kind==='completion').length,1);
    assert.ok(events.every(e=>e.hermesSessionId===hermesSessionId && e.sessionId===created[0]));
    const replay=(await (await api(`/runs/${run.id}/events`)).json()).events; assert.deepEqual(replay,events);
    const completion=events.find(e=>e.kind==='completion');
    assert.equal((await api(`/runs/${run.id}/ack`,{eventId:completion.eventId,state:'visible'})).status,200);
    assert.equal((await api('/ack',{eventId:completion.eventId,state:'visible'})).status,404);
    db.prepare('UPDATE recipe_workflow_runs SET owner_user_id=2 WHERE id=?').run(run.id);
    assert.equal((await api(`/runs/${run.id}/events`)).status,404);
    assert.equal((await api(`/runs/${run.id}/ack`,{eventId:firstHistory[0].eventId,state:'visible'})).status,404);
    console.log(`PASS actual runner retry ${index+1}: new attempt, revoked v1 history/ACK, immutable v2 run recovery; injected engine only, NOT Hermes`);
  });
}
test.after(()=>db.close());
