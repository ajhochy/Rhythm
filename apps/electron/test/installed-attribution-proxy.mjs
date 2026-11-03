// Isolated test-only loopback proxy. Forwards the installed native Hermes
// connection to a real pinned backend; records metadata, never auth or bodies.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_RESPONSE = 1_048_576;
const MAX_WS_BYTES = 1_048_576;
const HTTP_TIMEOUT_MS = 30_000;
const WS_LIFETIME_MS = 120_000;

export function routeFor(method, rawUrl, profile, jobId) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) return null;
  const url = new URL(rawUrl, 'http://127.0.0.1');
  const keys = [...url.searchParams.keys()];
  const only = (...allowed) => keys.every(key => allowed.includes(key));
  const scoped = url.searchParams.get('profile') === profile;
  if (method === 'GET' && url.pathname === '/api/health' && only('profile', 'rhythm_attribution') &&
      (!url.searchParams.has('profile') || scoped)) {
    const marker = url.searchParams.get('rhythm_attribution');
    if (marker && !/^[a-f0-9-]{36}$/.test(marker)) return null;
    return { route: 'health', marker: marker || null };
  }
  if (method === 'GET' && url.pathname === '/api/status' && only('profile') &&
      (!url.searchParams.has('profile') || scoped)) return { route: 'status' };
  if (method === 'GET' && url.pathname === '/api/cron/jobs' && only('profile') && scoped)
    return { route: 'job-inventory' };
  if (method === 'GET' && url.pathname === `/api/cron/jobs/${jobId}/runs` && only('profile', 'limit') &&
      scoped && url.searchParams.get('limit') === '20') return { route: 'job-runs', jobId };
  if (method === 'POST' && url.pathname === `/api/cron/jobs/${jobId}/trigger` && only('profile') && scoped)
    return { route: 'synthetic-trigger', jobId };
  return null;
}

function checkLoopback(base) {
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(!['4001', '4096', '4097', '4098'].includes(new URL(base).port));
}

export async function startOwnedProxy(fixture) {
  assert.equal(process.env.RHYTHM_INSTALLED_ATTRIBUTION_PROXY, 'owned-synthetic-only');
  assert.equal(fixture.kind, 'synthetic-installed-attribution-v1');
  assert.equal(fixture.managerReady, true);
  assert.equal(fixture.syntheticOnly, true);
  const config = fixture.nativeCron;
  assert.ok(config && typeof config === 'object');
  assert.match(config.profile, /^attribution-20261001-[a-f0-9-]{36}$/);
  assert.equal(config.connectionId, config.profile.replace(/^attribution-/, 'native-attribution-'));
  assert.match(config.jobId, /^[a-f0-9]{12}$/);
  assert.equal(config.jobName, config.profile.replace(/^attribution-/, 'rhythm-native-attribution-'));
  checkLoopback(config.backendBase);
  checkLoopback(config.proxyBase);
  assert.notEqual(config.backendBase, config.proxyBase);
  assert.ok(Number.isSafeInteger(config.backendPid) && config.backendPid > 1);
  execFileSync('/usr/sbin/lsof', ['-a', '-p', String(config.backendPid),
    `-iTCP:${new URL(config.backendBase).port}`, '-sTCP:LISTEN'], { stdio: 'pipe' });
  assert.ok(isAbsolute(config.proxyReceiptLog));
  const logPath = await realpath(config.proxyReceiptLog);
  assert.ok(logPath.startsWith('/private/tmp/') || logPath.startsWith('/var/folders/'));
  const logInfo = await stat(logPath);
  assert.equal(logInfo.isFile(), true);
  assert.equal(logInfo.size, 0, 'proxy receipt log must be fresh');
  const artifacts = await realpath(fixture.artifactsDir);
  const rel = relative(artifacts, logPath);
  assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    'proxy receipt log must belong to owned artifacts directory');
  const home = await realpath(config.profileHome);
  assert.ok(home.startsWith('/private/tmp/') || home.startsWith('/var/folders/'));
  const script = await realpath(resolve(home, 'scripts/native-cron-silent.sh'));
  const scriptRel = relative(resolve(home, 'scripts'), script);
  assert.ok(scriptRel && scriptRel !== '..' && !scriptRel.startsWith(`..${sep}`));
  const hash = data => createHash('sha256').update(data).digest('hex');
  assert.equal(hash(await readFile(script)), hash(await readFile(resolve(import.meta.dirname, 'fixtures/native-cron-silent.sh'))),
    'owned cron script differs from reviewed harmless fixture');
  const upstream = new URL(config.backendBase);
  const record = value => appendFileSync(logPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  const server = http.createServer(async (request, response) => {
    const route = routeFor(request.method, request.url, config.profile, config.jobId);
    if (!route || request.headers['content-length'] && Number(request.headers['content-length']) > 0 ||
        request.headers['transfer-encoding']) {
      response.writeHead(403).end();
      return;
    }
    const target = new URL(request.url, upstream);
    const headers = { 'x-hermes-session-token': request.headers['x-hermes-session-token'] ?? '',
      authorization: request.headers.authorization ?? '', 'content-type': request.headers['content-type'] ?? 'application/json' };
    const peer = http.request(target, { method: request.method, headers, timeout: HTTP_TIMEOUT_MS }, result => {
      let bytes = 0;
      const chunks = [];
      result.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE) { peer.destroy(new Error('upstream response exceeds proof bound')); return; }
        chunks.push(chunk);
      });
      result.on('end', () => {
        record({ method: request.method, ...route, upstreamStatus: result.statusCode });
        response.writeHead(result.statusCode || 502, { 'content-type': result.headers['content-type'] || 'application/json' });
        response.end(Buffer.concat(chunks));
      });
    });
    peer.on('timeout', () => peer.destroy(new Error('upstream timeout')));
    peer.on('error', () => {
      record({ method: request.method, ...route, upstreamStatus: null, category: 'upstream-error' });
      if (!response.writableEnded) response.writeHead(502).end();
    });
    peer.end();
  });
  server.maxConnections = 8;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/api/ws' || [...url.searchParams.keys()].some(key => !['token', 'ticket', 'profile'].includes(key)) ||
        url.searchParams.has('profile') && url.searchParams.get('profile') !== config.profile) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const target = new URL(request.url, upstream);
    const peer = http.request(target, { method: 'GET', headers: { ...request.headers, host: upstream.host }, timeout: 10_000 });
    peer.on('upgrade', (reply, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers)
        .map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      let sent = 0;
      let received = 0;
      const stop = () => { socket.destroy(); upstreamSocket.destroy(); };
      const timer = setTimeout(stop, WS_LIFETIME_MS);
      socket.on('data', chunk => { sent += chunk.length; if (sent > MAX_WS_BYTES) stop(); });
      upstreamSocket.on('data', chunk => { received += chunk.length; if (received > MAX_WS_BYTES) stop(); });
      socket.on('close', () => { clearTimeout(timer); upstreamSocket.destroy(); });
      upstreamSocket.on('close', () => { clearTimeout(timer); socket.destroy(); });
      socket.pipe(upstreamSocket);
      upstreamSocket.pipe(socket);
    });
    peer.on('response', reply => { socket.end(`HTTP/1.1 ${reply.statusCode || 502} Bad Gateway\r\n\r\n`); });
    peer.on('error', () => socket.destroy());
    peer.end();
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(Number(new URL(config.proxyBase).port), '127.0.0.1', resolveListen);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const fixturePath = process.argv[2];
  assert.ok(fixturePath && isAbsolute(fixturePath));
  const actual = await realpath(fixturePath);
  assert.ok(actual.startsWith('/private/tmp/') || actual.startsWith('/var/folders/'));
  const fixture = JSON.parse(await readFile(actual, 'utf8'));
  await startOwnedProxy(fixture);
  console.log(JSON.stringify({ pid: process.pid, proxyBase: fixture.nativeCron.proxyBase }));
}
