import assert from 'node:assert/strict';
import test from 'node:test';

import {
  localUserPreferencesKey,
  readLocalUserPreferences,
  shouldEscalatePermission,
  USER_PREFERENCES_CHANGED_EVENT,
  writeLocalUserPreferences,
} from '../src/gateway/user-preferences.ts';

const storageWith = (value) => ({
  value,
  getItem() { return this.value; },
  setItem(_key, next) { this.value = next; },
});

test('1550:behavior-device-pref-and-modal:1 destructive-modal preference defaults false, accepts only boolean true, and round-trips with an event', (t) => {
  // Regression: truthy legacy values silently enable a destructive-action modal or writes do not notify mounted consumers.
  for (const persisted of [undefined, 'true', 1]) {
    const storage = storageWith(persisted === undefined ? null : JSON.stringify({ requireDestructiveModal: persisted }));
    assert.equal(readLocalUserPreferences('user-1', storage).requireDestructiveModal, false);
  }
  assert.equal(readLocalUserPreferences('user-1', storageWith(JSON.stringify({ requireDestructiveModal: true }))).requireDestructiveModal, true);

  const events = [];
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: (event) => events.push(event.type) } });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  });
  const storage = storageWith(null);
  const next = writeLocalUserPreferences(42, { requireDestructiveModal: true }, storage);
  assert.equal(next.requireDestructiveModal, true);
  assert.equal(JSON.parse(storage.value).requireDestructiveModal, true);
  assert.equal(localUserPreferencesKey(42), 'rhythm.settings.42');
  assert.deepEqual(events, [USER_PREFERENCES_CHANGED_EVENT]);
});

test('1550:behavior-device-pref-and-modal:2 only enabled destructive tools escalate', () => {
  // Regression: a harmless read opens a blocking dialog, or a destructive write remains inline after the safety preference is enabled.
  for (const tool of ['bash', 'Write', 'edit', 'patch']) assert.equal(shouldEscalatePermission(true, tool), true, tool);
  for (const tool of ['read', 'webfetch', 'glob']) assert.equal(shouldEscalatePermission(true, tool), false, tool);
  assert.equal(shouldEscalatePermission(false, 'bash'), false);
});
