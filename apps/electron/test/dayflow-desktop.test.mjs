import assert from 'node:assert/strict';
import test from 'node:test';
import { createDayflowDesktopHost, DAYFLOW_DESKTOP_CHANNELS, registerDayflowDesktopIpc } from '../src/dayflow-desktop.mjs';

const artifact = (root) => ({ root, version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow' });
const host = ({ candidates: suppliedCandidates = {}, invalid, ...options } = {}) => {
  const calls = [];
  const controller = createDayflowDesktopHost({
    candidates: { installedAppPath: '/Applications/Dayflow.app', bundledAppPath: '/bundle/Dayflow.app', arch: 'arm64', ...suppliedCandidates },
    execute: async (...args) => { calls.push(args); return { stdout: '' }; },
    validateArtifact: async ({ appRoot }) => { if (invalid?.includes(appRoot)) throw new Error('bad signature'); return artifact(appRoot); },
    ...options,
  });
  return { controller, calls };
};

test('prefers a validated installed app and revalidates before launch without exposing a path', async () => {
  const { controller, calls } = host();
  assert.deepEqual(await controller.getStatus(), { status: 'ready', version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow' });
  assert.deepEqual(await controller.open(), { status: 'ready', version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow' });
  assert.deepEqual(calls, [['open', ['-a', '/Applications/Dayflow.app']]]);
});

test('uses bundled only when installed is absent, never when an installed signature fails', async () => {
  const missingInstalled = host({ candidates: { installedAppPath: undefined } });
  assert.equal((await missingInstalled.controller.getStatus()).status, 'ready');
  assert.deepEqual(missingInstalled.calls, []);
  const invalidInstalled = host({ invalid: ['/Applications/Dayflow.app'] });
  assert.deepEqual(await invalidInstalled.controller.getStatus(), { status: 'unavailable', code: 'ARTIFACT_INVALID' });
});

test('does not run on unsupported platforms and returns bounded launch errors', async () => {
  const unsupported = host({ platform: 'win32' });
  assert.deepEqual(await unsupported.controller.getStatus(), { status: 'unsupported', code: 'UNSUPPORTED_PLATFORM' });
  const failing = createDayflowDesktopHost({ candidates: { installedAppPath: '/Applications/Dayflow.app', arch: 'arm64' }, execute: async () => { throw new Error('private path'); }, validateArtifact: async ({ appRoot }) => artifact(appRoot) });
  assert.deepEqual(await failing.open(), { status: 'unavailable', code: 'LAUNCH_FAILED' });
});

test('IPC denies untrusted senders and payloads and exposes only two empty-payload calls', async () => {
  const handlers = new Map();
  registerDayflowDesktopIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, isTrustedSender: (event) => event.sender === 'main-frame', host: { getStatus: async () => ({ status: 'ready', version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow' }), open: async () => ({ status: 'ready', version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow' }) } });
  assert.deepEqual([...handlers.keys()].sort(), Object.values(DAYFLOW_DESKTOP_CHANNELS).sort());
  assert.deepEqual(await handlers.get(DAYFLOW_DESKTOP_CHANNELS.status)({ sender: 'child-frame' }), { status: 'unavailable', code: 'UNAUTHORIZED' });
  assert.deepEqual(await handlers.get(DAYFLOW_DESKTOP_CHANNELS.open)({ sender: 'main-frame' }, { path: '/etc/passwd' }), { status: 'unavailable', code: 'UNAUTHORIZED' });
  assert.equal((await handlers.get(DAYFLOW_DESKTOP_CHANNELS.open)({ sender: 'main-frame' })).status, 'ready');
});
