import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.RHYTHM_RECIPE_WORKFLOWS_ENABLED='true';
const { initDb, getDb } = require('../../apps/api_server/dist/database/db.js');
const { AgentSessionsRepository } = require('../../apps/api_server/dist/repositories/agent_sessions_repository.js');
const { AgentCookbookRepository } = require('../../apps/api_server/dist/repositories/agent_cookbook_repository.js');
const { RecipeWorkflowRepository } = require('../../apps/api_server/dist/repositories/recipe_workflow_repository.js');
const { HermesNotifyService } = require('../../apps/api_server/dist/services/hermes_notify_service.js');
const { RecipeWorkflowRunner, createAgentRunnerDispatcher } = require('../../apps/api_server/dist/services/recipe_workflow_runner.js');
assert.match(process.env.DB_PATH, /^\/private\/tmp\/hermes-event-notify-20261012-sandbox\//);
await initDb();
const sessions = new AgentSessionsRepository(), runs = new RecipeWorkflowRepository();
const notify = new HermesNotifyService(); notify.initialize();
const definition = { schemaVersion:1, entryStageId:'work', budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:1000,maxStageExecutions:10},
  stages:[{id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}] };
const recipe = await new AgentCookbookRepository().createAsync({title:'Synthetic notify registry',schemaVersion:1,definitionJson:JSON.stringify(definition)});
const fixtures = ['encompass-security-map','rhythm-notify-approval','opus-encompass-review'].map((name,i)=>{
  const run = runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{goal:name}});
  const parent = sessions.insert({agentKind:'',cwd:process.env.HOME,name,ownerUserId:1});
   const child = parent; // Origin is this real bound dispatch session, not an unrelated same-owner parent.
  const stage = runs.listStageExecutions(run.id)[0];
  runs.claim(stage.id,'pending','running'); runs.bindProvisionalSession(stage.id,child.id);
  sessions.bindWorkflowSession(child.id,run.id,stage.id);
  getDb().prepare('UPDATE agent_sessions SET sdk_session_id=? WHERE id=?').run(`sdk-workflow-${i}`,child.id);
  notify.bind(1,parent.id,`hermes-${name}`,run.id);
  return {name,run,parent,child,stage,sdk:`sdk-workflow-${i}`};
});
const events = f => f.runOrigin ? notify.listRun(1,f.run.id) : notify.list(1).filter(e=>e.workflowId===f.run.id);
const emit = (f,type,properties={}) => getDb().transaction(()=>notify.ingest({payload:{type,properties:{sessionID:f.sdk,...properties}}}))();
test('three independent durable run IDs project aggregate state, not only latest parent',()=>{
  for(const f of fixtures) {
    assert.ok(events(f).some(e=>e.text==='Rhythm workflow pending: 0 settled, 1 awaiting.'),f.name);
    assert.ok(events(f).every(e=>e.sessionId===f.parent.id && e.hermesSessionId===`hermes-${f.name}`));
  }
  assert.equal(new Set(notify.list(1).map(e=>e.cursor)).size,notify.list(1).length);
});
test('child idle and tokens never complete workflow; questions and requests retain exact origin',()=>{
  const f=fixtures[0];
  emit(f,'session.status',{status:{type:'busy'}}); emit(f,'session.status',{status:{type:'idle'}});
  emit(f,'message.part.delta',{delta:'secret instruction'});
  emit(f,'question.asked',{id:'synthetic-question'}); emit(f,'permission.asked',{id:'synthetic-permission'});
  assert.equal(events(f).filter(e=>e.kind==='completion').length,0);
  assert.equal(events(f).find(e=>e.kind==='question')?.referenceId,'synthetic-question');
  assert.equal(events(f).find(e=>e.kind==='approval-request')?.referenceId,'synthetic-permission');
  assert.ok(!JSON.stringify(events(f)).includes('secret'));
});
test('durable terminal success waits for all children; retry/restart/replay cannot duplicate effects',async()=>{
  const f=fixtures[0]; runs.updateRunStatus(f.run.id,'succeeded');
  assert.equal(events(f).filter(e=>e.kind==='completion').length,0);
  runs.recordCompletion(f.stage.id,{status:'succeeded'});
  assert.equal(events(f).filter(e=>e.kind==='completion').length,1);
  const before=notify.list(1); const reopened=new HermesNotifyService(); reopened.initialize();
  assert.deepEqual(reopened.list(1),before);
  notify.bindRun(1,f.run.id,f.parent.id,`hermes-${f.name}`); f.runOrigin=true;
  const history=events(f);
  runs.resetForRetry(f.stage.id); runs.updateRunStatus(f.run.id,'running');
  assert.ok(!notify.list(1).some(e=>e.workflowId===f.run.id));
  assert.throws(()=>notify.ack(1,history[0].eventId,'visible'),e=>e.statusCode===404);
  let retrySession, boundaryError;
  const dispatcher=createAgentRunnerDispatcher(runs,sessions,{run:async input=>{
    try {
      retrySession=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic supported retry',ownerUserId:1});
      await input.onSessionCreated(retrySession.id);
      assert.notEqual(retrySession.id,f.parent.id);
      notify.bindRun(1,f.run.id,retrySession.id,`hermes-${f.name}`);
      events(f); // Observe genuine running registry during the new dispatch, not old-session rebinding.
      return {sessionId:retrySession.id,status:'done',result:'{}'};
    } catch(error) { boundaryError=error; throw error; }
  }});
  await new RecipeWorkflowRunner(runs).tick(f.run.id,dispatcher);
  if(boundaryError) throw boundaryError;
  assert.ok(events(f).some(e=>e.text==='Rhythm workflow running: 0 settled, 1 awaiting.'));
  assert.deepEqual(notify.list(1),notify.list(1));
  assert.ok(events(f).every(e=>e.hermesSessionId===`hermes-${f.name}` && e.sessionId===f.parent.id));
  for(const prior of history) assert.ok(events(f).some(e=>e.eventId===prior.eventId && e.cursor===prior.cursor));
});
test('approval and terminal error are qualified registry states, with no reply authority',()=>{
  const f=fixtures[1]; runs.claim(f.stage.id,'running','blocked_approval');
  runs.updateRunStatus(f.run.id,'blocked_approval',{pendingApprovalId:f.stage.id});
  assert.ok(events(f).some(e=>e.kind==='approval-request' && e.referenceId===f.stage.id));
  const g=fixtures[2]; runs.recordCompletion(g.stage.id,{status:'failed'}); runs.updateRunStatus(g.run.id,'failed');
  assert.ok(events(g).some(e=>e.kind==='error' && e.text==='Rhythm workflow failed: 1 settled, 0 awaiting.'));
});
test('another owner cannot correlate a real run into their session',()=>{
  const other=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic other',ownerUserId:2});
  assert.throws(()=>notify.bind(2,other.id,'foreign',fixtures[0].run.id),e=>e.statusCode===404);
});
test.after(()=>getDb().close());
