import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const store = await readFile(new URL('../src/store.tsx', import.meta.url), 'utf8');

test('notification.push frames are handed to the Electron native-notification bridge', () => {
  const handler = store.slice(store.indexOf("event.type === 'notification.push'"));
  assert.match(handler.slice(0, 1200), /emitAgentNotification\(\{ v: 1, type: 'push', id, title, body \}, live\)/);
});

test('load-failure toasts carry the gateway reason and the poll does not re-toast the same failure', () => {
  assert.doesNotMatch(store, /catch\(\(\) => \{ if \(active\) notify\('(Notifications|Pending approvals) could not be loaded'\)/);
  assert.match(store, /failureMessage\('Notifications could not be loaded', error\)/);
  assert.match(store, /failureMessage\('Pending approvals could not be loaded', error\)/);
  assert.match(store, /message !== lastFailure/);
});
