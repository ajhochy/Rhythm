import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { initDb, getDb } = require('../../apps/api_server/dist/database/db.js');
const { AgentSessionsRepository } = require('../../apps/api_server/dist/repositories/agent_sessions_repository.js');
const { AgentCookbookRepository } = require('../../apps/api_server/dist/repositories/agent_cookbook_repository.js');
const { RecipeWorkflowRepository } = require('../../apps/api_server/dist/repositories/recipe_workflow_repository.js');
const { HermesNotifyService } = require('../../apps/api_server/dist/services/hermes_notify_service.js');
assert.match(process.env.DB_PATH, /^\/private\/tmp\/hermes-event-notify-20261012-sandbox\//);
await initDb();
const db=getDb(), sessions=new AgentSessionsRepository(), runs=new RecipeWorkflowRepository();
const service=new HermesNotifyService(); service.initialize();
const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:1000,maxStageExecutions:10},
  stages:[{id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic revocation',schemaVersion:1,definitionJson:JSON.stringify(definition)});
let serial=0;
function fixture() {
  const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{}});
  const session=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic revocation',ownerUserId:1});
  const stage=runs.listStageExecutions(run.id)[0], sdk=`sdk-revoke-${++serial}`;
  assert.equal(runs.bindProvisionalSession(stage.id,session.id),true);
  assert.equal(sessions.bindWorkflowSession(session.id,run.id,stage.id),true);
  db.prepare('UPDATE agent_sessions SET sdk_session_id=? WHERE id=?').run(sdk,session.id);
  service.bind(1,session.id,`hermes-revoke-${serial}`,run.id);
  return {run,session,stage,sdk};
}
const events=f=>service.list(1).filter(e=>e.sessionId===f.session.id);
const stored=f=>db.prepare('SELECT * FROM hermes_notify_events WHERE session_id=? ORDER BY cursor').all(f.session.id);
const emit=(f,type,properties={})=>service.ingest({payload:{type,properties:{sessionID:f.sdk,...properties}}});
test('F1 exact independent probe: cleared session binding refuses new terminal publication',()=>{
  const f=fixture(); events(f); const before=stored(f);
  db.prepare('UPDATE agent_sessions SET workflow_run_id=NULL,workflow_stage_execution_id=NULL WHERE id=?').run(f.session.id);
  assert.throws(()=>service.bind(1,f.session.id,`hermes-revoke-${serial}`,f.run.id),e=>e.statusCode===404);
  runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'pass'}); runs.updateRunStatus(f.run.id,'succeeded');
  assert.equal(events(f).filter(e=>e.kind==='completion').length,0);
  assert.deepEqual(stored(f),before);
});
for (const boundary of ['session-stage','session-run','stage-session','stage-run','run-owner','session-owner']) {
  test(`F1 revoked ${boundary} hides history and refuses ingest/append/ACK without reassignment`,()=>{
    const f=fixture(), prior=events(f), before=stored(f);
    if(boundary==='session-stage') db.prepare('UPDATE agent_sessions SET workflow_stage_execution_id=? WHERE id=?').run('wrong-stage',f.session.id);
    if(boundary==='session-run') db.prepare('UPDATE agent_sessions SET workflow_run_id=? WHERE id=?').run(fixture().run.id,f.session.id);
    if(boundary==='stage-session') db.prepare('UPDATE recipe_workflow_stage_executions SET provisional_session_id=NULL,committed_session_id=NULL WHERE id=?').run(f.stage.id);
    if(boundary==='stage-run') db.prepare("UPDATE recipe_workflow_stage_executions SET run_id=?,item_key='moved' WHERE id=?").run(fixture().run.id,f.stage.id);
    if(boundary==='run-owner') db.prepare('UPDATE recipe_workflow_runs SET owner_user_id=2 WHERE id=?').run(f.run.id);
    if(boundary==='session-owner') db.prepare('UPDATE agent_sessions SET owner_user_id=2 WHERE id=?').run(f.session.id);
    assert.deepEqual(events(f),[]);
    for(const event of prior) assert.throws(()=>service.ack(1,event.eventId,'visible'),e=>e.statusCode===404);
    emit(f,'question.asked',{id:'revoked-question'}); emit(f,'session.status',{status:{type:'busy'}});
    service.append(f.session.id,'revoked-direct','progress');
    assert.deepEqual(stored(f),before);
    assert.equal(db.prepare('SELECT workflow_id FROM hermes_notify_origins WHERE session_id=?').get(f.session.id).workflow_id,f.run.id);
  });
}
test('F1 revoked child cannot signal a still-valid distinct origin; valid replay unchanged',()=>{
  const f=fixture(), child=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic child',ownerUserId:1});
  const stage=runs.ensureStageExecution({runId:f.run.id,stageId:'work',itemKey:'child'});
  runs.bindProvisionalSession(stage.id,child.id); sessions.bindWorkflowSession(child.id,f.run.id,stage.id);
  db.prepare('UPDATE agent_sessions SET sdk_session_id=? WHERE id=?').run('sdk-revoked-child',child.id);
  const prior=events(f); service.ack(1,prior[0].eventId,'accepted');
  const reopened=new HermesNotifyService(); reopened.initialize(); assert.deepEqual(reopened.list(1),service.list(1));
  const before=stored(f); db.prepare('UPDATE recipe_workflow_stage_executions SET provisional_session_id=NULL WHERE id=?').run(stage.id);
  emit({sdk:'sdk-revoked-child'},'permission.asked',{id:'revoked-permission'});
  assert.deepEqual(stored(f),before);
});
test('F2 arbitrary and malformed durable run statuses omit publication before label/reference/source projection',()=>{
  for(const status of ['PRIVATE_ARBITRARY_STATUS','', ' succeeded ', 42]) for(const pendingApprovalId of [null,'PRIVATE_REFERENCE']) {
    const f=fixture(); events(f); const before=stored(f);
    runs.updateRunStatus(f.run.id,status,{pendingApprovalId});
    events(f); emit(f,'question.asked',{id:'PRIVATE_QUESTION'});
    assert.deepEqual(stored(f),before,String(status));
    assert.ok(!JSON.stringify(events(f)).includes('PRIVATE_'));
  }
});
test.after(()=>db.close());
