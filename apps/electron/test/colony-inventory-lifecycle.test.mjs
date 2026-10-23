import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { registerColonyHost } from '../src/colony-host.mjs';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/rhythm-colony-lifecycle-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const handlers = new Map();
  const frame = { url: 'rhythm://app/index.html#/colony' };
  const contents = { mainFrame: frame };
  const win = { webContents: contents, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: frame };
  let response = { ok: false, error: { code: 'oversize', message: 'private worker details' } };
  let reads = 0;
  const host = registerColonyHost({
    ipcMain: { handle(name, fn) { handlers.set(name, fn); }, removeHandler() {} },
    getWindow: () => win, userDataPath: path.join(root, 'user-data'), home: path.join(root, 'home'),
    resourcesPath: path.join(root, 'Resources'), isPackaged: false,
    environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    fs: { lstat: async () => { throw new Error('missing'); } },
    registerView: () => ({ currentAttachment: () => 'attachment', disposeCurrent: async () => {}, dispose: async () => {},
      requestHost: async () => { reads++; return response; } }),
  });
  t.after(() => host.dispose());
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'synthetic' });
  await handlers.get('colony:host:set-enabled')(event, true);
  const page = () => handlers.get('colony:inventory:page')(event, { attachment: 'attachment', page: { collection: 'threads', limit: 5 } });
  return { handlers, event, frame, page, reads: () => reads, setResponse(value) { response = value; } };
}

test('late inventory read from the owned main document is revoked without authorizing a worker request', async (t) => {
  const f = await fixture(t);
  f.frame.url = 'rhythm://app/index.html#/tools/agent-tools';
  assert.deepEqual(await f.page(), { kind: 'inventory-error', code: 'revoked' });
  assert.equal(f.reads(), 0);
  await assert.rejects(() => f.handlers.get('colony:inventory:page')({ ...f.event, senderFrame: { url: f.frame.url } },
    { attachment: 'attachment', page: { collection: 'threads' } }), /IPC denied/);
  await assert.rejects(() => f.handlers.get('colony:action:run')(f.event, { attachment: 'attachment', kind: 'open', id: 'unobserved' }), /IPC denied/);
});

test('bounded worker capacity becomes a coded read failure while unexpected failures still reject', async (t) => {
  const f = await fixture(t);
  for (const code of ['oversize', 'busy', 'revoked']) {
    f.setResponse({ ok: false, error: { code, message: 'private worker details' } });
    assert.deepEqual(await f.page(), { kind: 'inventory-error', code });
  }
  f.setResponse({ ok: false, error: { code: 'unavailable', message: 'private worker details' } });
  await assert.rejects(f.page, /inventory unavailable/);
});
