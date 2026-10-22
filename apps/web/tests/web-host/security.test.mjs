import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const WebSocket = require('../api_server/node_modules/ws');
const base = 'http://127.0.0.1:4098';
const origin = 'http://rhythm-web.test:4098';
const webHeaders = { Host: 'rhythm-web.test:4098', Origin: origin };
function request(path, headers = webHeaders, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}

test('A3 F1 preserves desktop loopback route and Electron preflight with web hosting', async () => {
  assert.equal((await request('/opencode/health', { Host: '127.0.0.1:4098' })).status, 200);
  const electron = await request('/agent-sessions', {
    Host: '127.0.0.1:4098', Origin: 'rhythm://app', 'Access-Control-Request-Method': 'GET',
  }, 'OPTIONS');
  assert.equal(electron.status, 204);
  assert.equal(electron.headers['access-control-allow-origin'], 'rhythm://app');
});

test('A3 web Host never borrows a loopback Origin or cross-site metadata', async () => {
  assert.equal((await request('/web/bootstrap', { ...webHeaders, Origin: base })).status, 403);
  assert.equal((await request('/web/bootstrap', { ...webHeaders, 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request('/web/bootstrap', { Host: webHeaders.Host, 'sec-fetch-site': 'same-origin' })).status, 200);
});

// Catches a CORS union that grants Electron but accidentally drops the web origin.
test('A3 F2 web preflight retains its exact allowed Origin', async () => {
  const response = await request('/agent-sessions', {
    ...webHeaders, 'Access-Control-Request-Method': 'POST',
  }, 'OPTIONS');
  assert.equal(response.status, 204);
  assert.equal(response.headers['access-control-allow-origin'], origin);
});

// Catches HTTP/WS guard divergence or loss of desktop callbacks in web mode.
test('A3 F1 accepts both loopback desktop and exact web WebSocket upgrades', async () => {
  for (const headers of [{ Host: '127.0.0.1:4098' }, { Host: '127.0.0.1:4098', Origin: 'rhythm://app' }, webHeaders]) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:4098/ws/agents', { headers, handshakeTimeout: 5000 });
      ws.once('open', () => { ws.close(); resolve(); });
      ws.once('unexpected-response', (_, response) => {
        response.resume(); ws.terminate(); reject(new Error(`allowed upgrade refused: ${response.statusCode}`));
      });
      ws.once('error', reject);
    });
  }
});

// Catches accidental bearer/credential disclosure and unconfigured owner setup.
test('A3 bootstrap has exactly non-secret owner and capability metadata', async () => {
  const response = await request('/web/bootstrap');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(Object.keys(body).sort(), ['capabilities', 'mode', 'owner']);
  assert.deepEqual(body.owner, { id: 1, displayName: 'Synthetic Admin' });
  assert.equal(body.mode, 'web');
  assert.doesNotMatch(JSON.stringify(body), /token|credential|secret|password/i);
});
// Catches disabling the guard to make browser writes work.
test('A3 refuses foreign writes and unexpected Host', async () => {
   assert.equal((await request('/agent-sessions', { ...webHeaders, Origin: 'https://evil.example' }, 'POST')).status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/web/bootstrap`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(status, 403);
});
// Catches HTTP-only allowlisting that leaves WebSocket upgrades exposed.
test('A3 refuses foreign WebSocket upgrades', async () => {
  const status = await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:4098/ws/agents', { headers: { Host: webHeaders.Host }, origin: 'https://evil.example' });
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
      const req = http.get(`${base}`, { path, headers: webHeaders }, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
      }); req.on('error', reject);
    });
    assert.notEqual(result.status, 200);
    assert.doesNotMatch(result.body, /"dependencies"|"scripts"|"rhythm"/);
  }
  const response = await request('/agent-sessions-nonexistent');
  assert.equal(response.status, 404);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.ok(JSON.parse(response.body));
});
