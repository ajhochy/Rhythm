import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

/** @param {unknown} value */
const plain = (value) => JSON.parse(JSON.stringify(value));

async function loadBridge() {
  let shell;
  const invokes = [];
  const pending = [];
  const ipcRenderer = {
    invoke(channel, ...args) {
      invokes.push([channel, ...args]);
      if (channel === 'open-design:view:attach') { let settle; const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; }); pending.push(settle); return promise; }
      return Promise.resolve(true);
    },
    on() {},
    removeListener() {},
    send() {},
    sendSync: () => 'https://example.invalid',
  };
  runInNewContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'rhythmShell'); shell = value; } }, ipcRenderer };
    },
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener() {}, dispatchEvent() {} },
  });
  return { bridge: shell.openDesignView, invokes, pending, others: () => plain(invokes.filter(([channel]) => channel !== 'open-design:view:attach')) };
}

test('AT-PRE-01 bridge is frozen with exactly the allowlisted methods', async () => {
  const { bridge } = await loadBridge();
  assert.ok(Object.isFrozen(bridge));
  assert.deepEqual(Object.keys(bridge), ['getStatus', 'attach', 'setBounds', 'detach']);
});

test('AT-PRE-02 success returns { ok: true } only; the nonce stays private and is cleared on detach', async () => {
  const { bridge, pending, others } = await loadBridge();
  const result = bridge.attach();
  pending[0].resolve({ ok: true, attachment: 'nonce-1' });
  assert.deepEqual(plain(await result), { ok: true });
  await bridge.setBounds({ x: 1, y: 2, width: 3, height: 4 });
  assert.deepEqual(others().at(-1), ['open-design:view:bounds', { attachment: 'nonce-1', bounds: { x: 1, y: 2, width: 3, height: 4 } }]);
  await bridge.detach();
  assert.deepEqual(others().at(-1), ['open-design:view:detach', { attachment: 'nonce-1' }]);
  const count = others().length;
  assert.equal(await bridge.setBounds({ x: 0, y: 0, width: 1, height: 1 }), false);
  assert.equal(await bridge.detach(), false);
  assert.equal(others().length, count, 'no IPC without a nonce');
});

test('AT-PRE-03 a stale completion is discarded without detaching a newer attachment sharing the nonce', async () => {
  const { bridge, pending, others } = await loadBridge();
  const first = bridge.attach();
  const second = bridge.attach();
  pending[1].resolve({ ok: true, attachment: 'cached-nonce' });
  assert.deepEqual(plain(await second), { ok: true });
  pending[0].resolve({ ok: true, attachment: 'cached-nonce' });
  assert.deepEqual(plain(await first), { ok: false, reason: 'detached' });
  assert.ok(!others().some(([channel]) => channel === 'open-design:view:detach'), 'stale completion must not suspend the newer view');
  await bridge.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(others().at(-1)[1].attachment, 'cached-nonce');
});

test('AT-PRE-04 void, malformed, nonce-less, and rejected attach results fail without exposing anything', async () => {
  for (const [name, settle] of [
    ['void', (p) => p.resolve(undefined)],
    ['ok without nonce', (p) => p.resolve({ ok: true })],
    ['truthy non-boolean ok', (p) => p.resolve({ ok: 'yes', attachment: 'n' })],
    ['failure with reason', (p) => p.resolve({ ok: false, reason: 'fixed copy', attachment: 'n' })],
    ['rejected', (p) => p.reject(new Error('/private/main/path'))],
  ]) {
    const { bridge, pending, others } = await loadBridge();
    const result = bridge.attach();
    settle(pending[0]);
    const value = await result;
    assert.equal(value.ok, false, name);
    assert.ok(!('attachment' in value), name);
    assert.doesNotMatch(JSON.stringify(value), /private/, name);
    assert.equal(await bridge.setBounds({ x: 0, y: 0, width: 1, height: 1 }), false, name);
    assert.equal(others().length, 0, name);
  }
});
