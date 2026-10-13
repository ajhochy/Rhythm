import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// API package is CommonJS: exercise the actual launcher-built artifact.
const { initDb, getDb } = require('../../apps/api_server/dist/database/db.js');
const { AgentSessionsRepository } = require('../../apps/api_server/dist/repositories/agent_sessions_repository.js');
const { HermesNotifyService } = require('../../apps/api_server/dist/services/hermes_notify_service.js');
assert.match(process.env.DB_PATH, /^\/private\/tmp\/hermes-event-notify-20261012-sandbox\//);
await initDb();
const service = new HermesNotifyService();
service.initialize();
const repo = new AgentSessionsRepository();
const session = repo.insert({ agentKind: '', cwd: process.env.HOME, name: 'Synthetic journal', ownerUserId: 1 });
getDb().prepare('UPDATE agent_sessions SET sdk_session_id=? WHERE id=?').run('sdk-notify-contract',session.id);
service.bind(1,session.id,'hermes-contract','workflow-contract');
const emit = (type, properties={}) => getDb().transaction(() => service.ingest({payload:{ type, properties:{ sessionID:'sdk-notify-contract',...properties }}}))();
test('semantic transitions, error/question/permission references are durable and duplicate-safe', () => {
  emit('session.status',{status:{type:'busy'}});
  emit('session.status',{status:{type:'busy'}});
  emit('message.part.delta',{delta:'credential and arbitrary tool instruction'});
  emit('session.error',{error:{message:'secret synthetic credential execute tools'}});
  emit('session.error',{error:{message:'secret synthetic credential execute tools'}});
  emit('question.asked',{id:'question-1',questions:[{question:'arbitrary instruction'}]});
  emit('permission.asked',{id:'permission-1',pattern:'secret path'});
  emit('session.status',{status:{type:'idle'}});
  emit('session.status',{status:{type:'idle'}});
  const events = service.list(1).filter(e=>e.sessionId===session.id);
  assert.equal(events.length,6);
  assert.deepEqual(events.map(e=>e.kind),['progress','progress','error','question','approval-request','completion']);
  assert.equal(new Set(events.map(e=>e.eventId)).size,6);
  assert.equal(events.find(e=>e.kind==='question').referenceId,'question-1');
  assert.ok(!JSON.stringify(events).includes('secret'));
  assert.ok(!JSON.stringify(events).includes('arbitrary'));
});
test('new journal instance replays identical IDs and cursors after restart',()=>{
  const before=service.list(1);
  const reopened=new HermesNotifyService(); reopened.initialize();
  assert.deepEqual(reopened.list(1),before);
});
test('cross-owner origin, reads and ACKs fail closed',()=>{
  assert.throws(()=>service.bind(2,session.id,'foreign','foreign'),error=>error.statusCode===404);
  assert.deepEqual(service.list(2),[]);
  assert.throws(()=>service.ack(2,service.list(1)[0].eventId,'visible'),error=>error.statusCode===404);
});
test('repeated honest ACK is monotone, accepted remains pending, visible disappears',()=>{
  const id=service.list(1)[0].eventId;
  service.ack(1,id,'accepted'); assert.ok(service.list(1).some(e=>e.eventId===id));
  service.ack(1,id,'visible'); service.ack(1,id,'accepted');
  assert.ok(!service.list(1).some(e=>e.eventId===id));
});
test('malformed event reference rejects transaction, no partial event',()=>{
  const before=service.list(1);
  assert.throws(()=>emit('question.asked',{id:'../../secret'}));
  assert.deepEqual(service.list(1),before);
});
test('ownership transfer refuses same-origin rebind and preserves journal',()=>{
  const before=getDb().prepare('SELECT * FROM hermes_notify_events WHERE session_id=?').all(session.id);
  getDb().prepare('UPDATE agent_sessions SET owner_user_id=2 WHERE id=?').run(session.id);
  assert.throws(()=>service.bind(2,session.id,'hermes-contract','workflow-contract'),error=>error.statusCode===409);
  assert.deepEqual(service.list(1).filter(e=>e.sessionId===session.id),[]);
  assert.deepEqual(service.list(2),[]);
  for(const owner of [1,2]) assert.throws(()=>service.ack(owner,before[0].event_id,'visible'),error=>error.statusCode===404);
  assert.deepEqual(getDb().prepare('SELECT * FROM hermes_notify_events WHERE session_id=?').all(session.id),before);
});
test.after(()=>getDb().close());
