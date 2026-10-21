import assert from 'node:assert/strict';
import { existsSync, linkSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import test from 'node:test';
import { createQualificationFixture } from './qualification_fixture.mjs';
import { captureCreatedFixture, cleanupCreatedFixture } from './qualification_fixture_cleanup.mjs';

const revision = 'a'.repeat(40);
function fixture(t) {
  const manifestPath = createQualificationFixture(revision, { hermesRuntimeRoot: null, hermesBackendArtifactRoot: null });
  const root = dirname(manifestPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, manifestPath, authority: captureCreatedFixture(manifestPath, revision) };
}

test('deletes only a successful, invocation-created fixture after ports are free', async (t) => {
  const { root, authority } = fixture(t);
  await cleanupCreatedFixture(authority, { synthetic: true, status: 0, signal: null, ports: [], checkPorts: async () => true });
  assert.equal(existsSync(root), false);
});

test('retains caller-owned, failed, signaled and busy fixtures', async (t) => {
  const { root, authority } = fixture(t);
  for (const outcome of [
    { synthetic: false, status: 0, signal: null },
    { synthetic: true, status: 1, signal: null },
    { synthetic: true, status: null, signal: 'SIGTERM' },
  ]) {
    assert.equal(await cleanupCreatedFixture(authority, { ...outcome, ports: [], checkPorts: async () => true }), false);
    assert.equal(existsSync(root), true);
  }
  await assert.rejects(cleanupCreatedFixture(authority, { synthetic: true, status: 0, signal: null,
    ports: [4001], checkPorts: async () => false, drainMs: 50, pollMs: 10 }), /port/i);
  assert.equal(existsSync(root), true);
});

test('a child runtime port that drains shortly after Playwright exits permits cleanup', async (t) => {
  const { root, authority } = fixture(t);
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { if (server.listening) server.close(); });
  const port = server.address().port;
  setTimeout(() => server.close(), 80);
  await cleanupCreatedFixture(authority, { synthetic: true, status: 0, signal: null,
    ports: [port], drainMs: 1000, pollMs: 25 });
  assert.equal(existsSync(root), false);
});

test('a port still busy at the drain deadline fails closed and retains evidence', async (t) => {
  const { root, authority } = fixture(t);
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { if (server.listening) server.close(); });
  const port = server.address().port;
  await assert.rejects(cleanupCreatedFixture(authority, { synthetic: true, status: 0, signal: null,
    ports: [port], drainMs: 120, pollMs: 25 }), /port.*busy|port.*unknown/i);
  assert.equal(existsSync(root), true);
});

test('an unrelated network address does not block cleanup of the loopback runtime', { timeout: 5000 }, async (t) => {
  const address = Object.values(networkInterfaces()).flat().find(row => row?.family === 'IPv4' && !row.internal)?.address;
  if (!address) { t.skip('no separate local IPv4 interface available'); return; }
  const { root, authority } = fixture(t);
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, address, resolve);
  });
  t.after(() => server.close());
  await cleanupCreatedFixture(authority, { synthetic: true, status: 0, signal: null,
    ports: [server.address().port], drainMs: 120, pollMs: 25 });
  assert.equal(existsSync(root), false);
  assert.equal(server.listening, true);
});

test('refuses changed manifest and replaced root', async (t) => {
  const { root, manifestPath, authority } = fixture(t);
  const run = () => cleanupCreatedFixture(authority, { synthetic: true, status: 0, signal: null,
    ports: [], checkPorts: async () => true });
  const bytes = readFileSync(manifestPath);
  writeFileSync(manifestPath, Buffer.concat([bytes, Buffer.from(' ')]));
  await assert.rejects(run(), /manifest|changed/i);
  writeFileSync(manifestPath, bytes);
  const moved = `${root}-moved`;
  renameSync(root, moved);
  t.after(() => rmSync(moved, { recursive: true, force: true }));
  symlinkSync(moved, root);
  await assert.rejects(run(), /root|canonical|symlink/i);
  rmSync(root);
});

test('unlinks child cache links without following or deleting their external targets', async (t) => {
  const { root, authority } = fixture(t);
  const outside = `${root}-outside`;
  writeFileSync(outside, 'keep', { mode: 0o600 });
  t.after(() => rmSync(outside, { force: true }));
  symlinkSync(outside, join(root, 'cache-link'));
  linkSync(outside, join(root, 'cache-hardlink'));
  await cleanupCreatedFixture(authority, { synthetic: true, status: 0, signal: null,
    ports: [], checkPorts: async () => true });
  assert.equal(existsSync(root), false);
  assert.equal(readFileSync(outside, 'utf8'), 'keep');
});
