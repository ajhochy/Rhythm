import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require=createRequire(import.meta.url);
assert.match(process.env.DB_PATH,/^\/private\/tmp\/hermes-event-notify-20261012-sandbox\//);
const {initDb,getDb}=require('../../apps/api_server/dist/database/db.js');
const {AgentSessionsRepository}=require('../../apps/api_server/dist/repositories/agent_sessions_repository.js');
const {RecipeWorkflowRepository}=require('../../apps/api_server/dist/repositories/recipe_workflow_repository.js');
const {AgentCookbookRepository}=require('../../apps/api_server/dist/repositories/agent_cookbook_repository.js');
const {HermesNotifyService}=require('../../apps/api_server/dist/services/hermes_notify_service.js');
await initDb();
test('terminal success with an unresolved durable approval reference is withheld',async()=>{
  const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:1000,maxStageExecutions:10},stages:[{id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
  const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic pending approval',schemaVersion:1,definitionJson:JSON.stringify(definition)});
  const runs=new RecipeWorkflowRepository();
  const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{}});
  const parent=new AgentSessionsRepository().insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic held terminal',ownerUserId:1});
  const stage=runs.listStageExecutions(run.id)[0];
  runs.bindProvisionalSession(stage.id,parent.id);
  new AgentSessionsRepository().bindWorkflowSession(parent.id,run.id,stage.id);
  runs.recordCompletion(stage.id,{status:'succeeded'});
  runs.updateRunStatus(run.id,'succeeded',{pendingApprovalId:stage.id});
  const notify=new HermesNotifyService(); notify.initialize(); notify.bind(1,parent.id,'hermes-held-terminal',run.id);
  const events=notify.list(1).filter(e=>e.workflowId===run.id);
  assert.equal(events.filter(e=>e.kind==='completion').length,0);
  assert.ok(events.some(e=>e.kind==='approval-request' && e.referenceId===stage.id));
});
test('opaque workflow correlation and error then idle never qualify success',()=>{
  const sessions=new AgentSessionsRepository();
  const parent=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic opaque idle',ownerUserId:1});
  getDb().prepare('UPDATE agent_sessions SET sdk_session_id=? WHERE id=?').run('sdk-opaque-idle',parent.id);
  const notify=new HermesNotifyService(); notify.initialize(); notify.bind(1,parent.id,'hermes-opaque-idle','opaque-no-registry');
  for(const [type,properties] of [['session.status',{status:{type:'busy'}}],['session.error',{error:{message:'synthetic'}}],['session.status',{status:{type:'idle'}}]]) {
    getDb().transaction(()=>notify.ingest({payload:{type,properties:{sessionID:'sdk-opaque-idle',...properties}}}))();
  }
  const events=notify.list(1).filter(e=>e.sessionId===parent.id);
  assert.ok(events.some(e=>e.kind==='error'));
  assert.equal(events.filter(e=>e.kind==='completion').length,0);
});
test('settled mixed children, fail gate, and cancellation tombstone cannot become success',async()=>{
  const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:1000,maxStageExecutions:10},stages:[{id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
  const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic terminal safety',schemaVersion:1,definitionJson:JSON.stringify(definition)});
  const runs=new RecipeWorkflowRepository();
  for(const scenario of ['mixed','gate-fail','cancelled']) {
    const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{}});
    const parent=new AgentSessionsRepository().insert({agentKind:'',cwd:process.env.HOME,name:`Synthetic ${scenario}`,ownerUserId:1});
    const stage=runs.listStageExecutions(run.id)[0];
    runs.bindProvisionalSession(stage.id,parent.id);
    new AgentSessionsRepository().bindWorkflowSession(parent.id,run.id,stage.id);
    runs.recordCompletion(stage.id,{status:'succeeded',outcome:scenario==='gate-fail'?'fail':null});
    if(scenario==='mixed') {
      const child=runs.ensureStageExecution({runId:run.id,stageId:'failed-child'});
      runs.recordCompletion(child.id,{status:'failed'});
    }
    if(scenario==='cancelled') runs.cancelRun(run.id);
    // Contradictory durable state is a qualification refusal, not a runner repair.
    runs.updateRunStatus(run.id,'succeeded');
    const notify=new HermesNotifyService(); notify.initialize(); notify.bind(1,parent.id,`hermes-${scenario}`,run.id);
    assert.equal(notify.list(1).filter(e=>e.workflowId===run.id && e.kind==='completion').length,0,scenario);
  }
});
test.after(()=>getDb().close());
