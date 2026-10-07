import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  canonicalOpenDesignOrigin, discoverOpenDesignRuntime, parseOpenDesignUrl, readBoundedFile, readHtmlHealth, sameOpenDesignRuntime, trustedOpenDesignExecutables,
} from '../src/open-design-runtime.mjs';

// Deterministic injected OS seams: no process, socket, or service is touched.
// Shapes mirror the installed production metadata: no trailing slash on the
// web URL, equal paired pids, and a `next-server` listener child.
const EXE = '/Applications/Open Design.app/Contents/MacOS/Open Design';
const LISTENER = 'next-server (v16.2.6)';
const URL_LITERAL = 'http://127.0.0.1:49545';
const dir = (name) => ({ name, isDirectory: () => true, isSymbolicLink: () => false });
const runtimeOf = (ns) => `/home/Library/Application Support/Open Design/namespaces/${ns}/runtime`;

function world(overrides = {}) {
  const namespaces = overrides.namespaces ?? ['release-stable'];
  const files = new Map();
  for (const ns of overrides.identityNamespaces ?? namespaces) {
    files.set(`${runtimeOf(ns)}/headless-root.json`, JSON.stringify({ pid: 100, executablePath: overrides.executable ?? EXE }));
    files.set(`${runtimeOf(ns)}/web-root.json`, JSON.stringify({ pid: 100, url: overrides.url ?? URL_LITERAL }));
  }
  for (const [file, value] of overrides.files ?? []) files.set(file, value);
  const ps = new Map([[100, `100 1 ${overrides.executable ?? EXE}`], [102, `102 100 ${LISTENER}`], ...(overrides.ps ?? [])]);
  const calls = { reads: [], exec: [], health: 0 };
  const options = {
    homeDir: '/home',
    now: overrides.now,
    deadlineMs: overrides.deadlineMs,
    readdir: async (directory) => directory === '/home/Library/Application Support' ? [dir('Open Design')]
      : directory === '/home/Library/Application Support/Open Design/namespaces' ? namespaces.map(dir) : [],
    realpath: async (value) => overrides.realpath?.(value) ?? value,
    stat: async (value) => ({ mtimeMs: overrides.mtime?.(value) ?? 1 }),
    readBounded: async (file, limit) => {
      calls.reads.push(file);
      const value = overrides.read?.(file, calls) ?? files.get(file);
      if (value === undefined) throw new Error('ENOENT');
      assert.equal(limit, 32 * 1024);
      return value;
    },
    execFile: async (file, args) => {
      calls.exec.push([file, ...args]);
      if (file === '/bin/ps') return { stdout: (overrides.psAt?.(Number(args[1]), calls) ?? ps.get(Number(args[1]))) ?? '' };
      if (file === '/usr/sbin/lsof') return { stdout: overrides.lsof?.(calls) ?? 'p102\n' };
      throw new Error('unexpected OS command');
    },
    readHealth: async (origin, init) => {
      calls.health += 1;
      calls.healthInit = init;
      return overrides.health ? overrides.health(origin) : { statusCode: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>OpenDesign</title>' };
    },
  };
  return { options, calls };
}

const READY = { state: 'ready', origin: URL_LITERAL, identityPid: 100, listenerPid: 102 };
const UNAVAILABLE = { state: 'unavailable', code: 'unavailable' };

test('AT-RT-01 the production literal URL has no trailing slash; every normalised variant is rejected', () => {
  assert.equal(canonicalOpenDesignOrigin(URL_LITERAL), URL_LITERAL);
  assert.deepEqual(parseOpenDesignUrl(URL_LITERAL), { origin: URL_LITERAL, port: 49545 });
  // Port 80: URL elides the default port in .origin, so the explicit port is kept separately.
  assert.deepEqual(parseOpenDesignUrl('http://127.0.0.1:80'), { origin: 'http://127.0.0.1', port: 80 });
  assert.deepEqual(parseOpenDesignUrl('http://127.0.0.1:65535'), { origin: 'http://127.0.0.1:65535', port: 65535 });
  for (const value of [
    'http://127.0.0.1:49545/', 'http://127.0.0.1:49545/path', 'http://127.0.0.1:49545?x', 'http://127.0.0.1:49545#x',
    'http://localhost:49545', 'https://127.0.0.1:49545', 'ws://127.0.0.1:49545', 'http://127.0.0.1:0', 'http://127.0.0.1:65536',
    'http://127.0.0.1', 'http://127.1:49545', 'http://0x7f.0.0.1:49545', 'http://2130706433:49545', 'http://127.000.000.001:49545',
    'http://127.0.0.1:049545', 'HTTP://127.0.0.1:49545', 'http://u@127.0.0.1:49545', ' http://127.0.0.1:49545', 'http://127.0.0.1:49545 ',
    'http://[::1]:49545', 49545, null, undefined,
  ]) assert.equal(canonicalOpenDesignOrigin(value), null, String(value));
});

test('AT-RT-02 production-shaped metadata is ready via exact loopback lsof and read-only commands', async () => {
  const { options, calls } = world();
  assert.deepEqual(await discoverOpenDesignRuntime(options), READY);
  assert.ok(calls.exec.some((call) => JSON.stringify(call) === JSON.stringify(['/usr/sbin/lsof', '-nP', '-a', '-iTCP@127.0.0.1:49545', '-sTCP:LISTEN', '-Fp'])));
  assert.ok(calls.exec.every(([file]) => file === '/bin/ps' || file === '/usr/sbin/lsof'));
  assert.ok(calls.healthInit.timeoutMs > 0 && calls.healthInit.timeoutMs <= 3000);
});

test('AT-RT-03 only /Applications and the current user\'s ~/Applications canonical executables are trusted', async () => {
  assert.deepEqual(trustedOpenDesignExecutables('/home'), [EXE, '/home/Applications/Open Design.app/Contents/MacOS/Open Design']);
  const user = world({ executable: '/home/Applications/Open Design.app/Contents/MacOS/Open Design' });
  assert.deepEqual(await discoverOpenDesignRuntime(user.options), READY);
  for (const [name, overrides] of [
    ['arbitrary path even if the process matches', { executable: '/tmp/Open Design.app/Contents/MacOS/Open Design' }],
    ['other user', { executable: '/Users/other/Applications/Open Design.app/Contents/MacOS/Open Design' }],
    ['symlinked install', { realpath: (value) => value === EXE ? '/tmp/evil' : undefined }],
    ['running process is a different binary', { ps: [[100, '100 1 /tmp/Open Design']] }],
  ]) assert.deepEqual(await discoverOpenDesignRuntime(world(overrides).options), UNAVAILABLE, name);
});

test('AT-RT-04 port 80 keeps the explicit port for lsof and returns the normalised origin', async () => {
  const { options, calls } = world({ url: 'http://127.0.0.1:80' });
  assert.deepEqual(await discoverOpenDesignRuntime(options), { ...READY, origin: 'http://127.0.0.1' });
  assert.ok(calls.exec.some((call) => call.includes('-iTCP@127.0.0.1:80')));
});

test('AT-RT-05 paired identities must share the canonical pid; alternate fields and slash URLs are rejected', async () => {
  const web = `${runtimeOf('release-stable')}/web-root.json`;
  for (const [name, value] of [
    ['different pid', { pid: 101, url: URL_LITERAL }],
    ['alternate pid field', { processId: 100, url: URL_LITERAL }],
    ['alternate origin field', { pid: 100, origin: URL_LITERAL }],
    ['trailing slash', { pid: 100, url: `${URL_LITERAL}/` }],
    ['string pid', { pid: '100', url: URL_LITERAL }],
  ]) assert.deepEqual(await discoverOpenDesignRuntime(world({ files: [[web, JSON.stringify(value)]] }).options), UNAVAILABLE, name);
});

test('AT-RT-06 identity reads stay inside the runtime directory and are byte-bounded', async () => {
  const escape = world({ realpath: (value) => value.endsWith('web-root.json') ? '/elsewhere/web-root.json' : undefined });
  assert.deepEqual(await discoverOpenDesignRuntime(escape.options), UNAVAILABLE);
  assert.ok(!escape.calls.reads.some((file) => file.startsWith('/elsewhere')));
  // Even a misbehaving bounded reader cannot smuggle an oversized document.
  const huge = world({ read: (file) => file.endsWith('web-root.json') ? JSON.stringify({ pid: 100, url: URL_LITERAL, pad: 'x'.repeat(33 * 1024) }) : undefined });
  assert.deepEqual(await discoverOpenDesignRuntime(huge.options), UNAVAILABLE);
});

test('AT-RT-07 readBoundedFile reads limit+1 bytes, rejects oversize files and symlinks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-bounded-'));
  try {
    await writeFile(path.join(root, 'ok.json'), 'x'.repeat(16));
    await writeFile(path.join(root, 'big.json'), 'x'.repeat(17));
    await symlink(path.join(root, 'ok.json'), path.join(root, 'link.json'));
    assert.equal(await readBoundedFile(path.join(root, 'ok.json'), 16), 'x'.repeat(16));
    assert.equal(await readBoundedFile(path.join(root, 'big.json'), 16), null);
    await assert.rejects(readBoundedFile(path.join(root, 'link.json'), 16));
    assert.equal(await readBoundedFile(root, 16).catch(() => null), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('AT-RT-08 ancestry and listener mismatches are unavailable', async () => {
  for (const [name, overrides] of [
    ['listener not descendant', { ps: [[102, `102 1 ${LISTENER}`]] }],
    ['two listeners', { lsof: () => 'p102\np103\n' }],
    ['no listener', { lsof: () => '' }],
  ]) assert.deepEqual(await discoverOpenDesignRuntime(world(overrides).options), UNAVAILABLE, name);
});

test('AT-RT-09 health must be bounded 200 text/html with the OpenDesign title', async () => {
  for (const [name, health] of [
    ['redirect', { statusCode: 302, contentType: 'text/html', body: '<title>OpenDesign</title>' }],
    ['json', { statusCode: 200, contentType: 'application/json', body: '<title>OpenDesign</title>' }],
    ['missing type', { statusCode: 200, body: '<title>OpenDesign</title>' }],
    ['other title', { statusCode: 200, contentType: 'text/html', body: '<title>Not OpenDesign</title>' }],
    ['oversized injected body', { statusCode: 200, contentType: 'text/html', body: `<title>OpenDesign</title>${'x'.repeat(64 * 1024)}` }],
  ]) assert.deepEqual(await discoverOpenDesignRuntime(world({ health: () => health }).options), UNAVAILABLE, name);
  const thrown = world({ health: () => { throw new Error('ECONNREFUSED /secret/path'); } });
  assert.deepEqual(await discoverOpenDesignRuntime(thrown.options), UNAVAILABLE);
});

test('AT-RT-10 a hanging health request is cut off by the absolute deadline', async () => {
  const started = Date.now();
  const { options } = world({ deadlineMs: 50, health: () => new Promise(() => {}) });
  assert.deepEqual(await discoverOpenDesignRuntime(options), UNAVAILABLE);
  assert.ok(Date.now() - started < 2000);
});

test('AT-RT-11 discovery stops once its absolute deadline has passed', async () => {
  let clock = 0;
  const { options, calls } = world({ now: () => clock, deadlineMs: 100, mtime: () => { clock = 1000; return 1; } });
  assert.deepEqual(await discoverOpenDesignRuntime(options), UNAVAILABLE);
  assert.equal(calls.health, 0);
});

test('AT-RT-12 identity owner, executable, and listener are re-verified after health', async () => {
  const swappedListener = world({ lsof: (calls) => calls.health ? 'p999\n' : 'p102\n', ps: [[999, `999 100 ${LISTENER}`]] });
  assert.deepEqual(await discoverOpenDesignRuntime(swappedListener.options), UNAVAILABLE);
  const replacedProcess = world({ psAt: (pid, calls) => pid === 100 && calls.health ? '100 1 /tmp/impostor' : undefined });
  assert.deepEqual(await discoverOpenDesignRuntime(replacedProcess.options), UNAVAILABLE);
  const rewritten = world({ read: (file, calls) => calls.health && file.endsWith('web-root.json') ? JSON.stringify({ pid: 100, url: 'http://127.0.0.1:49546' }) : undefined });
  assert.deepEqual(await discoverOpenDesignRuntime(rewritten.options), UNAVAILABLE);
});

test('AT-RT-13 at most 25 runtimes are verified, most recently modified first', async () => {
  const namespaces = Array.from({ length: 30 }, (_, index) => `ns${index}`);
  const mtime = (value) => Number(/ns(\d+)/.exec(value)?.[1] ?? 0);
  const oldestOnly = world({ namespaces, identityNamespaces: ['ns0'], mtime });
  assert.deepEqual(await discoverOpenDesignRuntime(oldestOnly.options), UNAVAILABLE, 'beyond the 25 newest');
  assert.equal(new Set(oldestOnly.calls.reads.map((file) => path.dirname(file))).size, 25);
  const newest = world({ namespaces, identityNamespaces: ['ns29', 'ns5'], mtime });
  assert.deepEqual(await discoverOpenDesignRuntime(newest.options), READY);
  assert.ok(newest.calls.reads[0].includes('/ns29/'));
});

test('AT-RT-14 same-runtime identity requires origin and both pids to match', () => {
  assert.equal(sameOpenDesignRuntime(READY, { ...READY }), true);
  assert.equal(sameOpenDesignRuntime(READY, { ...READY, listenerPid: 103 }), false);
  assert.equal(sameOpenDesignRuntime(READY, { ...READY, identityPid: 101 }), false);
  assert.equal(sameOpenDesignRuntime(READY, { ...READY, origin: 'http://127.0.0.1:49546' }), false);
  assert.equal(sameOpenDesignRuntime(READY, UNAVAILABLE), false);
});

// Injected http.request-shaped seam: no socket or listener exists.
function fakeHttp(scenario) {
  const requests = [];
  const request = (url, init, onResponse) => {
    const req = Object.assign(new EventEmitter(), {
      url, init, destroyed: false,
      destroy(error) { if (req.destroyed) return; req.destroyed = true; if (error) req.emit('error', error); req.emit('close'); },
      end() { setImmediate(() => scenario(req, onResponse)); },
    });
    requests.push(req);
    return req;
  };
  return { request, requests };
}
const fakeResponse = (statusCode, headers = {}) => Object.assign(new EventEmitter(), { statusCode, headers, setEncoding() {} });

test('AT-RT-16 the default health reader destroys a trickling request at its absolute deadline', async () => {
  let interval;
  const http = fakeHttp((req, onResponse) => {
    const response = fakeResponse(200, { 'content-type': 'text/html' });
    onResponse(response);
    interval = setInterval(() => { if (!req.destroyed) response.emit('data', 'x'); }, 5); // never ends
  });
  try {
    await assert.rejects(readHtmlHealth(URL_LITERAL, { timeoutMs: 40, request: http.request }), /deadline/);
    assert.equal(http.requests.length, 1);
    assert.equal(http.requests[0].destroyed, true, 'the native request itself is destroyed');
    assert.equal(http.requests[0].url, `${URL_LITERAL}/`);
  } finally { clearInterval(interval); }
});

test('AT-RT-17 the default health reader does not follow redirects and returns them for rejection', async () => {
  const http = fakeHttp((req, onResponse) => {
    const response = fakeResponse(302, { location: 'http://example.invalid/', 'content-type': 'text/html' });
    onResponse(response);
    response.emit('end');
  });
  const result = await readHtmlHealth(URL_LITERAL, { timeoutMs: 1000, request: http.request });
  assert.equal(result.statusCode, 302);
  assert.equal(http.requests.length, 1, 'no second request to the redirect target');
});

test('AT-RT-18 the default health reader destroys the request when the body exceeds its bound', async () => {
  const http = fakeHttp((req, onResponse) => {
    const response = fakeResponse(200, { 'content-type': 'text/html' });
    onResponse(response);
    response.emit('data', 'x'.repeat(64 * 1024 + 1));
    if (!req.destroyed) response.emit('end');
  });
  await assert.rejects(readHtmlHealth(URL_LITERAL, { timeoutMs: 1000, request: http.request }), /bound/);
  assert.equal(http.requests[0].destroyed, true);
  const ok = fakeHttp((req, onResponse) => {
    const response = fakeResponse(200, { 'content-type': 'text/html; charset=utf-8' });
    onResponse(response);
    response.emit('data', '<title>OpenDesign</title>');
    response.emit('end');
  });
  assert.deepEqual(await readHtmlHealth(URL_LITERAL, { timeoutMs: 1000, request: ok.request }), { statusCode: 200, contentType: 'text/html; charset=utf-8', body: '<title>OpenDesign</title>' });
});

test('AT-RT-15 unreadable support root is unavailable without exposing paths or errors', async () => {
  const result = await discoverOpenDesignRuntime({ homeDir: '/home', readdir: async () => { throw new Error('EACCES /home'); } });
  assert.deepEqual(result, UNAVAILABLE);
});
