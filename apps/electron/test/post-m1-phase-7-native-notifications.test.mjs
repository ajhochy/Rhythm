import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = await readFile(resolve(here, '../src/main.mjs'), 'utf8');
const preloadSource = await readFile(resolve(here, '../src/preload.cjs'), 'utf8');

test('post-m1-p7-c4e: Electron owns permission presentation deduplication cancellation and a narrow preload', () => {
  // Regression caught: the packaged host has no Notification import or lifecycle while the renderer
  // can gain an arbitrary notification/signing primitive. The host-wiring assertions fail.
  assert.ok(
    /import\s*\{[^}]*\bNotification\b[^}]*\}\s*from\s*['"]electron['"]/.test(mainSource),
    'Electron main must own the native Notification primitive',
  );
  assert.ok(
    /setPermissionRequestHandler\([\s\S]*?callback\(allowed\)/.test(mainSource)
      && /setPermissionCheckHandler\?\.\([\s\S]*?allowOwnedClipboardWrite/.test(mainSource)
      && !/globalThis\.Notification\.requestPermission\(\)/.test(mainSource),
    'the host must keep renderer web notifications denied',
  );
  assert.ok(
    mainSource.includes("item.type === 'arm'")
      && mainSource.includes('primeAgentNotificationPermission')
      && mainSource.includes("'granted'")
      && mainSource.includes("'denied'")
      && mainSource.includes("'unknown'")
      && mainSource.includes("'unsupported'")
      && mainSource.includes("rhythm:agent-notifications:permission")
      && preloadSource.includes("rhythm:agent-notifications:permission"),
    'the first arm must invoke a main-owned permission probe and report its observed outcome',
  );
  assert.ok(/new Notification\s*\(/.test(mainSource), 'the host must present native notifications');
  assert.ok(
    /(?:Map|Set)\s*\(|notification[^\n]*(?:dedup|seen|presented)/i.test(mainSource),
    'the host must keep a native-notification deduplication registry',
  );
  assert.ok(
    /\.close\(\)|\.destroy\(\)|cancelNotification/i.test(mainSource),
    'resolved asks must cancel their native presentation',
  );
  assert.ok(
    !/showNotification|newNotification|sign\s*:\s*|signPayload|privateKey/i.test(preloadSource),
    'the preload must not expose arbitrary renderer-controlled notification or signing primitives',
  );
});

test('rhythm_notify push: preload forwards a closed-schema push frame to main and nothing wider', () => {
  const sent = []; const listeners = new Map();
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  runInContext(preloadSource, createContext({
    CustomEvent,
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener: (type, fn) => listeners.set(type, fn), dispatchEvent() {} },
    require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { send: (...args) => sent.push(args), sendSync() {}, invoke() {}, on() {}, removeListener() {} } }),
  }));
  const emit = (detail) => listeners.get('rhythm:agent-notifications')(new CustomEvent('rhythm:agent-notifications', { detail }));
  const push = { v: 1, type: 'push', id: 3, title: 'Done', body: 'Report ready' };
  emit(push);
  emit({ ...push, id: 0 });
  emit({ ...push, onclick: 'x' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'rhythm:agent-notifications:sync');
  assert.deepEqual({ ...sent[0][1] }, push);
});
