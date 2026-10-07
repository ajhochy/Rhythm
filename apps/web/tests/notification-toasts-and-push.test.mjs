import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const store = await readFile(new URL('../src/store.tsx', import.meta.url), 'utf8');

test('notification.push frames are handed to the Electron native-notification bridge', () => {
  const handler = store.slice(store.indexOf("event.type === 'notification.push'"));
  assert.match(handler.slice(0, 1200), /emitAgentNotification\(\{ v: 1, type: 'push', id, title, body \}, live\)/);
});

test('notification toasts and inline approval errors preserve the gateway reason without repeat toasts', () => {
  assert.doesNotMatch(store, /catch\(\(\) => \{ if \(active\) notify\('(Notifications|Pending approvals) could not be loaded'\)/);
  assert.match(store, /failureMessage\('Notifications could not be loaded', error\)/);
  assert.match(store, /if \(current\(\)\) setApprovalState\(\(state\) => \(\{ \.\.\.state, error: failureMessage\('Pending approvals could not be refreshed', error\), loading: false \}\)\)/);
  assert.match(store, /message !== lastFailure/);
});
