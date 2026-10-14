import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
assert.equal(process.env.RHYTHM_LIVE_E2E,'1');
assert.equal(process.env.DB_PATH,'/private/tmp/hermes-event-notify-20261012-sandbox/rhythm.db');
process.env.RHYTHM_RECIPE_WORKFLOWS_ENABLED='true';
const {initDb,getDb}=require('../../../apps/api_server/dist/database/db.js');
const {AgentSessionsRepository}=require('../../../apps/api_server/dist/repositories/agent_sessions_repository.js');
const {AgentCookbookRepository}=require('../../../apps/api_server/dist/repositories/agent_cookbook_repository.js');
const {RecipeWorkflowRepository}=require('../../../apps/api_server/dist/repositories/recipe_workflow_repository.js');
const {RecipeWorkflowRunner,createAgentRunnerDispatcher}=require('../../../apps/api_server/dist/services/recipe_workflow_runner.js');
await initDb();
const db=getDb(), sessions=new AgentSessionsRepository(), runs=new RecipeWorkflowRepository();
const token=db.prepare('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').get().token;
const api=(path,body)=>fetch('http://127.0.0.1:4898/hermes-notify'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:60000,maxStageExecutions:20},stages:[
 {id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{outcome:'string'}},next:'gate'},
 {id:'gate',kind:'gate',producerStageId:'work',branches:{pass:'done',fail:'done',repair:'work'},onInvalid:'done',loop:{loopId:'repair',maxIterations:2,maxCostUsd:1,maxTokens:100,maxWallTimeMs:60000,exhaustedTarget:'done'}},
 {id:'done',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
const recipe=await new AgentCookbookRepository().createAsync({title:'Offline native ACK contract',schemaVersion:1,definitionJson:JSON.stringify(definition)});
const fixtures=[];
for(const name of ['native','foreign-a','foreign-b']) {
 const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{goal:name}});
 const chat=name==='native'?'fixture-chat':name, created=[]; let failure;
 const dispatcher=createAgentRunnerDispatcher(runs,sessions,{run:async input=>{
  try {
   const session=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Offline ACK '+name,ownerUserId:1});
   created.push(session.id); await input.onSessionCreated(session.id);
   const binding=sessions.getWorkflowBinding(session.id), stage=runs.listStageExecutions(run.id).find(s=>s.id===binding.workflowStageExecutionId);
   assert.ok(stage.attemptId); assert.equal(stage.provisionalSessionId,session.id);
   if(created.length===1) assert.equal((await api('/origins',{sessionId:session.id,workflowId:run.id,hermesSessionId:chat})).status,201);
   if(created.length===2) {
    assert.notEqual(session.id,created[0]);
    assert.equal((await api(`/runs/${run.id}/origin`,{sessionId:session.id,hermesSessionId:chat})).status,201);
    assert.equal((await api(`/runs/${run.id}/origin`,{sessionId:created[0],hermesSessionId:chat})).status,404);
   }
   return {sessionId:session.id,status:'done',result:JSON.stringify({outcome:created.length===1?'repair':'pass'})};
  } catch(error) {failure=error; throw error;}
 }});
 await new RecipeWorkflowRunner(runs).tick(run.id,dispatcher);
 if(failure) throw failure;
 assert.equal(created.length,3); assert.equal(runs.getRun(run.id).status,'succeeded');
 const response=await api(`/runs/${run.id}/events`); assert.equal(response.status,200);
 const events=(await response.json()).events;
 assert.ok(events.every(e=>e.sessionId===created[0] && e.hermesSessionId===chat && e.runId===run.id));
 const event=events.find(e=>e.kind==='completion'); assert.ok(event);
 fixtures.push({runId:run.id,anchor:created[0],current:created[1],event});
}
console.log('ACK_FIXTURES '+JSON.stringify(fixtures));
db.close();
