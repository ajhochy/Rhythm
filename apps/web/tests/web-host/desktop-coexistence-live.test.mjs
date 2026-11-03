import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../package.json', import.meta.url));
const WebSocket = require('../api_server/node_modules/ws');
const live = process.env.RHYTHM_LIVE_E2E === '1';
const port = Number(process.env.RHYTHM_SANDBOX_API_PORT ?? 4098);
const base = `http://127.0.0.1:${port}`;
const webHost = `rhythm-web.test:${port}`;
function request(headers, method = 'GET', path = '/opencode/runtime') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers }, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
    req.once('error', reject);
    req.end();
  });
}

test('desktop-web-c1: overlapping loopback browser hosts retain actual native API/engine readiness and preflight', { skip: !live }, async () => {
  const origins = (process.env.RHYTHM_WEB_PUBLIC_ORIGIN ?? '').split(',');
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    assert(origins.includes(`http://${host}`), 'Run with both loopback browser origins to exercise the collision');
    const headers = { Host: host, Origin: 'rhythm://app', 'sec-fetch-site': 'cross-site' };
    const runtime = await request(headers);
    assert.equal(runtime.status, 200);
    assert.equal(JSON.parse(runtime.body).engine.status, 'ready');
    assert.equal(runtime.headers['access-control-allow-origin'], 'rhythm://app');
    const preflight = await request({ ...headers, 'Access-Control-Request-Method': 'GET' }, 'OPTIONS', '/agent-sessions');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'rhythm://app');
    const browser = await request({ Host: host, Origin: `http://${host}`, 'sec-fetch-site': 'same-origin' });
    assert.equal(browser.status, 200);
    assert.equal(JSON.parse(browser.body).engine.status, 'ready');
  }
});

test('desktop-web-c2: actual native and browser WebSocket upgrades both work with overlapping hosts', { skip: !live }, async () => {
  for (const headers of [
    { Host: `127.0.0.1:${port}`, Origin: 'rhythm://app' },
    { Host: `localhost:${port}`, Origin: 'rhythm://app' },
    { Host: webHost, Origin: `http://${webHost}` },
  ]) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agents`, { headers, handshakeTimeout: 5000 });
      ws.once('open', () => { ws.close(); resolve(); });
      ws.once('unexpected-response', (_, response) => {
        response.resume(); reject(new Error(`Upgrade refused: ${response.statusCode}`));
      });
      ws.once('error', reject);
    });
  }
});

test('desktop-web-c3: foreign/null origins and native origins on remote hosts remain rejected', { skip: !live }, async () => {
  for (const headers of [
    { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example' },
    { Host: `localhost:${port}`, Origin: 'null' },
    { Host: webHost, Origin: 'rhythm://app' },
    { Host: webHost, Origin: `http://${webHost}`, 'sec-fetch-site': 'cross-site' },
    { Host: 'evil.example', Origin: 'rhythm://app' },
  ]) assert.equal((await request(headers)).status, 403);
});
