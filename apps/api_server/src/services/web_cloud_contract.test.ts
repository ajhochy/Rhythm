import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { startTestServer } from '../__tests__/helpers/real_server';
vi.mock('../config/web_host', () => ({ webHostConfig: { hosts: ['rhythm-cloud.test:4198'], origins: ['http://rhythm-cloud.test:4198'], ownerUserId: 1, distDir: '' } }));
import { webHostConfig } from '../config/web_host';
import { env } from '../config/env';
import { createApp } from '../app';
import { initializeWebHost } from './web_host';

const token = 'synthetic-cloud-contract-secret';
const base = 'http://127.0.0.1:7097';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cloud-contract-'));
const credential = path.join(root, 'private', 'cloud.json');
const db = new Database(':memory:');
const requests: { url?: string; headers: http.IncomingHttpHeaders; method?: string; body: string }[] = [];
let upstreamStatus = 200;
let reflectToken = false;
let identity = { id: 99, name: 'Synthetic Owner', email: 'owner@example.invalid', googleSub: 'synthetic-sub' };
let server: Awaited<ReturnType<typeof startTestServer>>;
const upstream = http.createServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    requests.push({ url: req.url, headers: req.headers, method: req.method, body });
    if (req.url === '/hang') return;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/me') return res.end(JSON.stringify({ user: identity }));
    res.statusCode = upstreamStatus;
    res.setHeader('set-cookie', 'must-not-reach-browser=1');
    if (upstreamStatus === 302) res.setHeader('location', `${base}/redirect-target`);
    res.end(JSON.stringify(reflectToken ? { echo: token } : { ok: true }));
  });
});
async function call(route: string, method = 'GET', headers: http.OutgoingHttpHeaders = {}, body?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(`${server.baseUrl}`, { path: route, method, headers: { host: 'rhythm-cloud.test:4198', origin: 'http://rhythm-cloud.test:4198', ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text }));
    }); req.on('error', reject); req.end(body);
  });
}
function writeCredential(overrides = {}) {
  fs.writeFileSync(credential, JSON.stringify({ productionApiBase: base, userId: 99, sessionToken: token, ...overrides }), { mode: 0o600 });
}
beforeAll(async () => {
  fs.mkdirSync(path.dirname(credential), { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html>');
  webHostConfig!.distDir = path.join(root, 'dist');
  db.exec("CREATE TABLE users (id INTEGER, name TEXT, email TEXT, google_sub TEXT); INSERT INTO users VALUES (1, 'Synthetic Owner', 'owner@example.invalid', 'synthetic-sub')");
  setDb(db);
  env.agentLocal = true; env.agentOriginGuardEnabled = true;
  await new Promise<void>(resolve => upstream.listen(7097, '127.0.0.1', resolve));
  await initializeWebHost();
  server = await startTestServer(createApp());
});
beforeEach(() => {
  fs.rmSync(credential, { force: true }); fs.chmodSync(path.dirname(credential), 0o700);
  writeCredential(); upstreamStatus = 200; reflectToken = false; requests.length = 0;
  identity = { id: 99, name: 'Synthetic Owner', email: 'owner@example.invalid', googleSub: 'synthetic-sub' };
  vi.stubEnv('RHYTHM_WEB_CLOUD_CREDENTIAL_PATH', credential); vi.stubEnv('PROD_API_URL', base);
});
afterAll(async () => { await server?.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); db.close(); fs.rmSync(root, { recursive: true }); vi.unstubAllEnvs(); });

it('C1 valid protected credential advertises cloud without exposing the token', async () => {
  await initializeWebHost(); const result = await call('/web/bootstrap');
  expect(JSON.parse(result.body).capabilities.cloud).toBe(true);
  expect(JSON.stringify(result)).not.toContain(token);
});
it.each(['missing', 'relative', 'symlink', 'mode', 'parent-mode', 'base', 'user-id', 'identity', 'dist', 'repo', 'malformed'])('C1 refuses %s while local bootstrap stays up', async refusal => {
  if (refusal === 'missing') fs.unlinkSync(credential);
  if (refusal === 'relative') vi.stubEnv('RHYTHM_WEB_CLOUD_CREDENTIAL_PATH', 'cloud.json');
  if (refusal === 'symlink') { fs.unlinkSync(credential); fs.symlinkSync(path.join(root, 'dist', 'index.html'), credential); }
  if (refusal === 'mode') fs.chmodSync(credential, 0o640);
  if (refusal === 'parent-mode') fs.chmodSync(path.dirname(credential), 0o720);
  if (refusal === 'base') writeCredential({ productionApiBase: 'https://wrong.example.invalid' });
  if (refusal === 'user-id') writeCredential({ userId: 100 });
  if (refusal === 'identity') identity = { ...identity, googleSub: 'foreign-sub' };
  if (refusal === 'dist') vi.stubEnv('RHYTHM_WEB_CLOUD_CREDENTIAL_PATH', path.join(root, 'dist', 'index.html'));
  if (refusal === 'repo') vi.stubEnv('RHYTHM_WEB_CLOUD_CREDENTIAL_PATH', path.resolve('package.json'));
  if (refusal === 'malformed') fs.writeFileSync(credential, '{');
  await initializeWebHost(); const result = await call('/web/bootstrap');
  expect(result.status).toBe(200); expect(JSON.parse(result.body).capabilities.cloud).toBe(false);
  expect(JSON.stringify(result)).not.toContain(token);
});
it('C2 forwards JSON path/query/method with only the host credential, strips cookies', async () => {
  await initializeWebHost(); requests.length = 0;
  const result = await call('/cloud/tasks?q=test', 'POST', { authorization: 'Bearer client-secret', cookie: 'client-cookie=1', 'content-type': 'application/json' }, '{"title":"test"}');
  expect(result.status).toBe(200); expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ url: '/tasks?q=test', method: 'POST', body: '{"title":"test"}', headers: { authorization: `Bearer ${token}`, host: '127.0.0.1:7097' } });
  expect(requests[0].headers.cookie).toBeUndefined(); expect(requests[0].headers.origin).toBeUndefined();
  expect(result.headers['set-cookie']).toBeUndefined(); expect(JSON.stringify(result)).not.toContain(token);
});
it('C2 rejects foreign Origin before forwarding', async () => {
  await initializeWebHost(); requests.length = 0;
  expect((await call('/cloud/tasks', 'POST', { origin: 'https://evil.invalid' })).status).toBe(403); expect(requests).toHaveLength(0);
});
it.each(['/cloud/../auth/me', '/cloud/%2e%2e/auth/me', '/cloud/%252e%252e/auth/me', '/cloud/http://evil.invalid', '/cloud//evil.invalid', '/cloud/%2f%2fevil.invalid'])('C2 rejects raw traversal/absolute URL %s', async route => {
  await initializeWebHost(); requests.length = 0;
  expect((await call(route)).status).toBe(400); expect(requests).toHaveLength(0);
});
it('C2 never follows 3xx', async () => {
  await initializeWebHost(); requests.length = 0; upstreamStatus = 302;
  const result = await call('/cloud/tasks'); expect(result.status).toBe(502); expect(requests).toHaveLength(1); expect(result.headers.location).toBeUndefined();
});
it.each([401, 403])('C2 maps upstream %i to disconnected without disabling local routes', async status => {
  await initializeWebHost(); upstreamStatus = status;
  const result = await call('/cloud/tasks'); expect(JSON.parse(result.body)).toEqual({ error: { code: 'CLOUD_ACCOUNT_DISCONNECTED' } });
  expect(JSON.stringify(result)).not.toContain(token); expect((await call('/web/bootstrap')).status).toBe(200);
});
it('C2 caps JSON request size', async () => {
  await initializeWebHost(); requests.length = 0;
  expect((await call('/cloud/tasks', 'POST', { 'content-type': 'application/json' }, JSON.stringify({ data: 'x'.repeat(1024 * 1024) }))).status).toBe(413);
  expect(requests).toHaveLength(0);
});

it('C1 refuses foreign uid and missing pre-existing owner subject without changing DB', async () => {
  const uid = vi.spyOn(process, 'getuid').mockReturnValue(process.getuid!() + 1);
  try { await initializeWebHost(); } finally { uid.mockRestore(); }
  expect(JSON.parse((await call('/web/bootstrap')).body).capabilities.cloud).toBe(false);
  db.prepare('UPDATE users SET google_sub = NULL WHERE id = 1').run();
  try {
    await initializeWebHost();
    expect(JSON.parse((await call('/web/bootstrap')).body).capabilities.cloud).toBe(false);
    expect(db.prepare('SELECT google_sub FROM users WHERE id = 1').get()).toEqual({ google_sub: null });
  } finally { db.prepare("UPDATE users SET google_sub = 'synthetic-sub' WHERE id = 1").run(); }
});
it('C1 snapshot is not re-read or re-authenticated by browser bootstrap', async () => {
  await initializeWebHost(); requests.length = 0; fs.unlinkSync(credential);
  expect(JSON.parse((await call('/web/bootstrap')).body).capabilities.cloud).toBe(true);
  expect(JSON.parse((await call('/web/bootstrap')).body).capabilities.cloud).toBe(true);
  expect(requests).toHaveLength(0);
});
it('C2 suppresses reflected upstream secrets and never logs the stored token', async () => {
  const lines: unknown[] = [];
  const spies = ['log', 'warn', 'error', 'info'].map(method => vi.spyOn(console, method as 'log').mockImplementation((...args) => { lines.push(args); }));
  try {
    await initializeWebHost(); reflectToken = true;
    const result = await call('/cloud/tasks');
    expect(result.status).toBe(502);
    expect(JSON.stringify([result, lines])).not.toContain(token);
    expect(result.headers['set-cookie']).toBeUndefined();
  } finally { spies.forEach(spy => spy.mockRestore()); }
});
it('C2 rejects non-JSON payloads and malformed JSON without logging client input', async () => {
  await initializeWebHost(); requests.length = 0;
  expect((await call('/cloud/tasks', 'POST', { 'content-type': 'text/plain' }, 'no')).status).toBe(415);
  const result = await call('/cloud/tasks', 'POST', { 'content-type': 'application/json' }, '{invalid');
  expect(result.status).toBe(400); expect(requests).toHaveLength(0); expect(result.body).not.toContain('invalid');
});
it('C2 upstream timeout is bounded and does not leak the attached credential', async () => {
  await initializeWebHost();
  const started = Date.now(); const result = await call('/cloud/hang');
  expect(result.status).toBe(502); expect(Date.now() - started).toBeLessThan(17_000);
  expect(JSON.stringify(result)).not.toContain(token);
}, 20_000);
it('C2 preserves bodyless DELETE rather than manufacturing a JSON payload', async () => {
  await initializeWebHost(); requests.length = 0;
  expect((await call('/cloud/tasks/synthetic', 'DELETE')).status).toBe(200);
  expect(requests[0].body).toBe('');
});
