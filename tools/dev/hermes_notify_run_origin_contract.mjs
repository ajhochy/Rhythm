import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {initDb,getDb}=require('../../apps/api_server/dist/database/db.js');
const {AgentSessionsRepository}=require('../../apps/api_server/dist/repositories/agent_sessions_repository.js');
const {AgentCookbookRepository}=require('../../apps/api_server/dist/repositories/agent_cookbook_repository.js');
const {RecipeWorkflowRepository}=require('../../apps/api_server/dist/repositories/recipe_workflow_repository.js');
const {HermesNotifyService}=require('../../apps/api_server/dist/services/hermes_notify_service.js');
assert.match(process.env.DB_PATH,/^\/private\/tmp\/hermes-event-notify-20261012-sandbox\//);
await initDb();
const db=getDb(), sessions=new AgentSessionsRepository(), runs=new RecipeWorkflowRepository(), notify=new HermesNotifyService();
notify.initialize();
const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:60000,maxStageExecutions:20},stages:[{id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic run origin safety',schemaVersion:1,definitionJson:JSON.stringify(definition)});
let serial=0;
function fixture(legacy=false) {
  const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{}}), stage=runs.listStageExecutions(run.id)[0];
  const session=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic run safety',ownerUserId:1});
  runs.claim(stage.id,'pending','running'); runs.bindProvisionalSession(stage.id,session.id); sessions.bindWorkflowSession(session.id,run.id,stage.id);
  const hermes=`synthetic-run-safety-${++serial}`, sdk=`sdk-run-safety-${serial}`;
  db.prepare('UPDATE agent_sessions SET sdk_session_id=? WHERE id=?').run(sdk,session.id);
  if(legacy) notify.bind(1,session.id,hermes,run.id); else notify.bindRun(1,run.id,session.id,hermes);
  return {run,stage,session,hermes,sdk};
}
const rows=f=>db.prepare('SELECT * FROM hermes_notify_events WHERE session_id=? ORDER BY cursor').all(f.session.id);
const notFound=fn=>assert.throws(fn,e=>e.statusCode===404);
test('additive quarantine migration preserves legacy IDs/cursors/ACK and requires explicit owner activation',()=>{
  const f=fixture(true), history=notify.list(1).filter(e=>e.workflowId===f.run.id);
  notify.ack(1,history[0].eventId,'accepted'); const before=rows(f);
  const reopened=new HermesNotifyService(); reopened.initialize(); reopened.initialize();
  assert.equal(db.prepare('SELECT state FROM hermes_notify_run_origins WHERE run_id=?').get(f.run.id).state,'quarantined');
  notFound(()=>reopened.listRun(1,f.run.id)); assert.deepEqual(rows(f),before);
  reopened.bindRun(1,f.run.id,f.session.id,f.hermes);
  const upgraded=reopened.listRun(1,f.run.id);
  for(const old of before) { const event=upgraded.find(e=>e.eventId===old.event_id); assert.equal(event.cursor,old.cursor); assert.equal(event.state,old.state); }
  assert.ok(!reopened.list(1).some(e=>e.workflowId===f.run.id)); notFound(()=>reopened.ack(1,history[0].eventId,'visible'));
  const again=new HermesNotifyService(); again.initialize(); assert.deepEqual(again.listRun(1,f.run.id),upgraded);
});
test('ambiguous or inconsistent legacy origin is quarantined, never guessed or reassigned',()=>{
  for(const ambiguous of [true,false]) {
    const f=fixture(true);
    if(ambiguous) {
      const other=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic ambiguous legacy',ownerUserId:1});
      db.prepare('INSERT INTO hermes_notify_origins(session_id,owner_user_id,hermes_session_id,workflow_id) VALUES (?,1,?,?)').run(other.id,'other-chat',f.run.id);
    } else db.prepare('UPDATE agent_sessions SET workflow_stage_execution_id=? WHERE id=?').run('unmatched',f.session.id);
    const before=rows(f); notify.initialize();
    assert.throws(()=>notify.bindRun(1,f.run.id,f.session.id,f.hermes),e=>[404,409].includes(e.statusCode));
    notFound(()=>notify.listRun(1,f.run.id)); assert.deepEqual(rows(f),before);
    assert.equal(db.prepare('SELECT state FROM hermes_notify_run_origins WHERE run_id=?').get(f.run.id).state,'quarantined');
  }
});
test('owner/run/event mismatch and arbitrary session adoption/refbind do not grant delivery authority',()=>{
  const f=fixture(), g=fixture(), prior=notify.listRun(1,f.run.id), arbitrary=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic arbitrary',ownerUserId:1});
  notFound(()=>notify.bindRun(1,f.run.id,arbitrary.id,f.hermes)); notFound(()=>notify.bindRun(1,f.run.id,g.session.id,f.hermes));
  notFound(()=>notify.bindRun(2,f.run.id,f.session.id,f.hermes)); notFound(()=>notify.listRun(2,f.run.id));
  notFound(()=>notify.ackRun(1,g.run.id,prior[0].eventId,'visible'));
  assert.throws(()=>notify.bindRun(1,f.run.id,f.session.id,'other-hermes'),e=>e.statusCode===409);
  db.prepare('UPDATE recipe_workflow_runs SET owner_user_id=2 WHERE id=?').run(f.run.id);
  notFound(()=>notify.listRun(1,f.run.id)); notFound(()=>notify.listRun(2,f.run.id)); notFound(()=>notify.ackRun(2,f.run.id,prior[0].eventId,'visible'));
});
test('reset revokes old session signals/append/v1 ACK but run owner recovers historical pending events',()=>{
  const f=fixture(), prior=notify.listRun(1,f.run.id); runs.resetForRetry(f.stage.id);
  const before=rows(f);
  for(const type of ['session.updated','question.asked','permission.asked','session.error']) notify.ingest({payload:{type,properties:{sessionID:f.sdk,id:'revoked-ref'}}});
  notify.append(f.session.id,'revoked-append','error'); assert.deepEqual(rows(f),before);
  assert.deepEqual(notify.list(1).filter(e=>e.workflowId===f.run.id),[]); notFound(()=>notify.ack(1,prior[0].eventId,'visible'));
  assert.ok(notify.listRun(1,f.run.id).some(e=>e.eventId===prior[0].eventId));
  notify.ackRun(1,f.run.id,prior[0].eventId,'accepted'); assert.equal(notify.listRun(1,f.run.id).find(e=>e.eventId===prior[0].eventId).state,'accepted');
});
test('malformed current two-sided membership denies projection/read/ACK without altering retained journal',()=>{
  for(const boundary of ['session-run','session-stage','session-owner','stage-session','stage-run']) {
    const f=fixture(), prior=notify.listRun(1,f.run.id), before=rows(f);
    if(boundary==='session-run') db.prepare('UPDATE agent_sessions SET workflow_run_id=? WHERE id=?').run(fixture().run.id,f.session.id);
    if(boundary==='session-stage') db.prepare('UPDATE agent_sessions SET workflow_stage_execution_id=? WHERE id=?').run('wrong-stage',f.session.id);
    if(boundary==='session-owner') db.prepare('UPDATE agent_sessions SET owner_user_id=2 WHERE id=?').run(f.session.id);
    if(boundary==='stage-session') db.prepare('UPDATE recipe_workflow_stage_executions SET committed_session_id=? WHERE id=?').run(fixture().session.id,f.stage.id);
    if(boundary==='stage-run') db.prepare("UPDATE recipe_workflow_stage_executions SET run_id=?,item_key='moved' WHERE id=?").run(fixture().run.id,f.stage.id);
    notFound(()=>notify.listRun(1,f.run.id)); notFound(()=>notify.ackRun(1,f.run.id,prior[0].eventId,'visible'));
    notify.ingest({payload:{type:'permission.asked',properties:{sessionID:f.sdk,id:'PRIVATE_REF'}}}); assert.deepEqual(rows(f),before,boundary);
  }
});
test('run projection verdict/status sanitation and changed-verdict dedup preserve safety',()=>{
  const f=fixture(); runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'fail'}); runs.updateRunStatus(f.run.id,'succeeded');
  const failed=notify.listRun(1,f.run.id); assert.equal(failed.filter(e=>e.kind==='completion').length,0);
  runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'repair'});
  const repair=notify.listRun(1,f.run.id); assert.equal(repair.length,failed.length+1);
  runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'UNKNOWN'}); assert.equal(notify.listRun(1,f.run.id).filter(e=>e.kind==='completion').length,0);
  runs.recordCompletion(f.stage.id,{status:'succeeded',outcome:'pass'}); assert.equal(notify.listRun(1,f.run.id).filter(e=>e.kind==='completion').length,1);
  const before=rows(f); runs.updateRunStatus(f.run.id,'PRIVATE_STATUS',{pendingApprovalId:'PRIVATE_REFERENCE'});
  notFound(()=>notify.listRun(1,f.run.id)); assert.deepEqual(rows(f),before);
});
test('legacy opaque sessions remain V1/nonterminal and cannot masquerade as V2 runs',()=>{
  const session=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic opaque',ownerUserId:1});
  notify.bind(1,session.id,'opaque-hermes','opaque-not-a-run');
  assert.ok(notify.list(1).some(e=>e.sessionId===session.id && e.version===1));
  notFound(()=>notify.bindRun(1,'opaque-not-a-run',session.id,'opaque-hermes'));
  notFound(()=>notify.listRun(1,'opaque-not-a-run'));
});
test('same-run sibling session cannot impersonate the exact origin stage attempt',()=>{
  const f=fixture(), prior=notify.listRun(1,f.run.id), sibling=runs.ensureStageExecution({runId:f.run.id,stageId:'work',itemKey:'sibling'});
  const session=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic same-run sibling',ownerUserId:1});
  runs.claim(sibling.id,'pending','running'); runs.bindProvisionalSession(sibling.id,session.id); sessions.bindWorkflowSession(session.id,f.run.id,sibling.id);
  db.prepare('UPDATE recipe_workflow_stage_executions SET provisional_session_id=? WHERE id=?').run(session.id,f.stage.id);
  const before=rows(f);
  notFound(()=>notify.listRun(1,f.run.id)); notFound(()=>notify.ackRun(1,f.run.id,prior[0].eventId,'visible'));
  assert.deepEqual(rows(f),before);
});
test.after(()=>db.close());
