import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const WebSocket = require('../api_server/node_modules/ws');
const base = 'http://127.0.0.1:4098';

// Catches accidental bearer/credential disclosure and unconfigured owner setup.
test('A3 bootstrap has exactly non-secret owner and capability metadata', async () => {
  const response = await fetch(`${base}/web/bootstrap`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['capabilities', 'mode', 'owner']);
  assert.deepEqual(body.owner, { id: 1, displayName: 'Synthetic Admin' });
  assert.equal(body.mode, 'web');
  assert.doesNotMatch(JSON.stringify(body), /token|credential|secret|password/i);
});
// Catches disabling the guard to make browser writes work.
test('A3 refuses foreign writes and unexpected Host', async () => {
  assert.equal((await fetch(`${base}/agent-sessions`, {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}',
  })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/web/bootstrap`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(status, 403);
});
// Catches HTTP-only allowlisting that leaves WebSocket upgrades exposed.
test('A3 refuses foreign WebSocket upgrades', async () => {
  const status = await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:4098/ws/agents', { origin: 'https://evil.example' });
    ws.once('open', () => { ws.close(); reject(new Error('foreign upgrade accepted')); });
    ws.once('unexpected-response', (_, response) => { response.resume(); resolve(response.statusCode); });
    ws.once('error', reject);
  });
  assert.equal(status, 403);
});
// Catches a broad SPA fallback exposing files or swallowing unknown API routes.
test('A3 static traversal cannot expose repository files; API misses are JSON', async () => {
  for (const path of ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/%2e%2e%2fpackage.json']) {
    const result = await new Promise((resolve, reject) => {
      const req = http.get(`${base}`, { path }, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
      }); req.on('error', reject);
    });
    assert.notEqual(result.status, 200);
    assert.doesNotMatch(result.body, /"dependencies"|"scripts"|"rhythm"/);
  }
  const response = await fetch(`${base}/agent-sessions-nonexistent`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.ok(await response.json());
});
