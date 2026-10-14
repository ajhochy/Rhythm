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
const sessions=new AgentSessionsRepository(), runs=new RecipeWorkflowRepository();
const notify=new HermesNotifyService(); notify.initialize();
const agent=id=>({id,kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true});
async function fixture(extra=[]) {
  const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:1000,maxStageExecutions:10},stages:[agent('work'),...extra]};
  const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic guard',schemaVersion:1,definitionJson:JSON.stringify(definition)});
  const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{}});
  const stage=runs.listStageExecutions(run.id)[0];
  const session=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic bound guard',ownerUserId:1});
  assert.equal(runs.bindProvisionalSession(stage.id,session.id),true);
  assert.equal(sessions.bindWorkflowSession(session.id,run.id,stage.id),true);
  return {run,stage,session};
}
const events=f=>notify.list(1).filter(e=>e.workflowId===f.run.id);
test('existing run refuses unbound same-owner adoption and other-run binding',async()=>{
  const f=await fixture(), g=await fixture();
  const unbound=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic unbound guard',ownerUserId:1});
  assert.throws(()=>notify.bind(1,unbound.id,'hermes-unbound',f.run.id),e=>e.statusCode===404);
  assert.throws(()=>notify.bind(1,g.session.id,'hermes-other-run',f.run.id),e=>e.statusCode===404);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM hermes_notify_origins WHERE session_id=?').get(unbound.id).n,0);
  notify.bind(1,f.session.id,'hermes-bound',f.run.id);
  assert.ok(events(f).every(e=>e.sessionId===f.session.id));
});
test('same-attempt fail to repair publishes distinct sanitized event and replays identical IDs',async()=>{
  const f=await fixture(); notify.bind(1,f.session.id,'hermes-verdict',f.run.id);
  runs.claim(f.stage.id,'pending','running');
  runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'fail',outputFields:{text:'secret model text'}});
  runs.updateRunStatus(f.run.id,'succeeded');
  const before=events(f);
  runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'repair',outputFields:{text:'different secret model text'}});
  const after=events(f);
  assert.equal(after.length,before.length+1);
  assert.ok(after.at(-1).cursor>before.at(-1).cursor);
  assert.notEqual(after.at(-1).eventId,before.at(-1).eventId);
  assert.equal(after.filter(e=>e.kind==='completion').length,0);
  assert.ok(!JSON.stringify(after).includes('secret'));
  assert.deepEqual(events(f),after);
  const reopened=new HermesNotifyService(); reopened.initialize();
  assert.deepEqual(reopened.list(1).filter(e=>e.workflowId===f.run.id),after);
});
test('unknown durable verdict withholds completion through actual JS repository',async()=>{
  const f=await fixture(); notify.bind(1,f.session.id,'hermes-unknown',f.run.id);
  runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'invalid-unknown'});
  runs.updateRunStatus(f.run.id,'succeeded');
  assert.equal(events(f).filter(e=>e.kind==='completion').length,0);
});
test('gate missing verdict and unknown stage/status refuse success; legitimate null children qualify once',async()=>{
  for(const [kind,outcome] of [['gate',undefined],['gate','pass'],['fanOut',null],['approval',null],['unknown-kind',null]]) {
    const f=await fixture([{id:'decision',kind}]);
    const decision=runs.ensureStageExecution({runId:f.run.id,stageId:'decision'});
    notify.bind(1,f.session.id,`hermes-${kind}-${outcome??'null'}`,f.run.id);
    runs.recordCompletion(f.stage.id,{status:'succeeded'});
    runs.recordCompletion(decision.id,{status:'succeeded',outcome});
    runs.updateRunStatus(f.run.id,'succeeded');
    const expected=kind==='unknown-kind'||(kind==='gate'&&outcome!=='pass')?0:1;
    assert.equal(events(f).filter(e=>e.kind==='completion').length,expected,`${kind}/${outcome}`);
    assert.deepEqual(events(f),events(f));
  }
  const f=await fixture(); notify.bind(1,f.session.id,'hermes-status',f.run.id);
  runs.recordCompletion(f.stage.id,{status:'unknown-status',outcome:'pass'});
  runs.updateRunStatus(f.run.id,'succeeded');
  assert.equal(events(f).filter(e=>e.kind==='completion').length,0);
});
test('cancellation marker changes publication identity even when qualified status is unchanged',async()=>{
  const f=await fixture(); notify.bind(1,f.session.id,'hermes-cancel-key',f.run.id);
  runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'fail'}); runs.updateRunStatus(f.run.id,'succeeded');
  const before=events(f);
  runs.cancelRun(f.run.id); runs.updateRunStatus(f.run.id,'succeeded');
  assert.equal(events(f).length,before.length+1);
  assert.deepEqual(events(f),events(f));
});
test.after(()=>getDb().close());
