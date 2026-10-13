import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(new URL('../../apps/api_server/package.json', import.meta.url));
const Database = require('better-sqlite3');
assert.equal(process.env.RHYTHM_LIVE_E2E, '1', 'explicit isolated live gate required');
assert.equal(process.env.RHYTHM_SANDBOX_API_PORT, '4898');
const db = new Database(`${process.env.RHYTHM_SANDBOX_DIR}/rhythm.db`, { readonly: true });
const token = db.prepare('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').get().token;
db.close();
const request = (path, body, auth = token) => fetch(`http://127.0.0.1:4898/hermes-notify${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
test('AC1/2: authenticated durable origin binding and cursor replay surface exists', async () => {
  const result = await request('/events');
  assert.equal(result.status, 200, 'owner event surface must exist');
  const body = await result.json();
  assert.ok(Array.isArray(body.events));
  assert.equal(body.version, 1);
});
test('AC4: unauthenticated event reads fail closed even in agent-local mode', async () => {
  assert.equal((await request('/events', undefined, '')).status, 401);
});
test('AC3/4: ACK cannot call enqueue delivered or accept arbitrary execution payload', async () => {
  assert.equal((await request('/ack', { eventId: 'unknown', state: 'delivered', tool: 'execute' })).status, 400);
});
