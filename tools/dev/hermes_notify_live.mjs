import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(new URL('../../apps/api_server/package.json', import.meta.url));
const Database = require('better-sqlite3');
assert.equal(process.env.RHYTHM_LIVE_E2E, '1');
assert.equal(process.env.RHYTHM_SANDBOX_API_PORT, '4898');
const db = new Database(`${process.env.RHYTHM_SANDBOX_DIR}/rhythm.db`);
const token = db.prepare('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').get().token;
// Synthetic cross-owner identity, never production auth fallback.
const foreign = 'notify-synthetic-owner-two';
db.prepare('INSERT OR IGNORE INTO sessions(token,user_id) VALUES (?,2)').run(foreign);
db.close();
const api = (path, body, auth = token) => fetch(`http://127.0.0.1:4898${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
test('AC1/3/4/5: real engine lifecycle -> durable owner stream -> replay -> honest ACK', async () => {
  const created = await api('/agent-sessions', { name: 'Synthetic notification lifecycle', cwd: `${process.env.RHYTHM_SANDBOX_DIR}/tmp` });
  assert.equal(created.status, 201);
  const session = await created.json();
  const sessionId = session.id;
  assert.ok(sessionId);
  const origin = { sessionId, hermesSessionId: 'synthetic-hermes-parent', workflowId: 'synthetic-workflow' };
  assert.equal((await api('/hermes-notify/origins', origin, foreign)).status, 404);
  const bound = await api('/hermes-notify/origins', origin);
  assert.equal(bound.status, 201, 'origin is durably bound before dispatch/prompt');
  assert.equal((await api('/hermes-notify/origins', { ...origin, hermesSessionId: 'forged-other-parent' })).status, 409);
  const stream = await api('/hermes-notify/stream');
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const first = await reader.read();
  const frames = new TextDecoder().decode(first.value);
  assert.match(frames, /event: notification/);
  const events = (await (await api('/hermes-notify/events')).json()).events;
  const event = events.find(e => e.sessionId === sessionId);
  assert.ok(event.eventId);
  assert.equal(event.hermesSessionId, origin.hermesSessionId);
  assert.equal(event.workflowId, origin.workflowId);
  assert.equal(event.kind, 'progress');
  assert.equal(event.text, 'Rhythm session linked.');
  assert.deepEqual((await (await api('/hermes-notify/events', undefined, foreign)).json()).events, []);
  assert.equal((await api('/hermes-notify/ack', { eventId: event.eventId, state: 'accepted' }, foreign)).status, 404);
  assert.equal((await api('/hermes-notify/ack', { eventId: event.eventId, state: 'accepted' })).status, 200);
  assert.ok((await (await api('/hermes-notify/events')).json()).events.some(e => e.eventId === event.eventId), 'accepted is still pending visibility');
  assert.equal((await api('/hermes-notify/ack', { eventId: event.eventId, state: 'visible' })).status, 200);
  assert.equal((await api('/hermes-notify/ack', { eventId: event.eventId, state: 'visible' })).status, 200);
  assert.ok(!(await (await api('/hermes-notify/events')).json()).events.some(e => e.eventId === event.eventId));
  await reader.cancel();
  const store = new Database(`${process.env.RHYTHM_SANDBOX_DIR}/rhythm.db`, { readonly: true });
  const sdkId = store.prepare('SELECT sdk_session_id FROM agent_sessions WHERE id=?').get(sessionId).sdk_session_id;
  store.close();
  assert.ok(sdkId);
  const changed = await fetch(`http://127.0.0.1:4897/session/${sdkId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Synthetic lifecycle changed' }) });
  assert.equal(changed.status, 200);
  let observed;
  for (let i=0; i<50; i++) {
    observed = (await (await api('/hermes-notify/events')).json()).events.find(e => e.sessionId === sessionId && e.kind === 'progress');
    if (observed) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(observed, 'actual engine SSE must produce a durable notification without LLM tokens');
  assert.equal(observed.text, 'Rhythm session updated.');
  const reopened = await api(`/hermes-notify/events?after=${event.cursor}`);
  assert.ok((await reopened.json()).events.some(e => e.eventId === observed.eventId));
  console.log('LIVE: actual fork session.updated -> durable notification; no Hermes wakeup claimed');
});
