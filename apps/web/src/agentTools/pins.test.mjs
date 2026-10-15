import test from 'node:test';
import assert from 'node:assert/strict';
import { agentToolPinsKey, readAgentToolPins, resetAgentToolPins, subscribeAgentToolPins, toggleAgentToolPin, writeAgentToolPins } from './pins.ts';

// Deterministic browser seams: an in-memory Storage and an EventTarget window.
function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { map, getItem: (key) => map.has(key) ? map.get(key) : null, setItem: (key, value) => { map.set(key, String(value)); }, removeItem: (key) => { map.delete(key); } };
}
class FakeStorageEvent extends Event { constructor(type, init = {}) { super(type); this.key = init.key ?? null; } }
function installWindow(storageGetter) {
  const win = new EventTarget();
  Object.defineProperty(win, 'localStorage', { configurable: true, get: storageGetter });
  globalThis.window = win;
  globalThis.StorageEvent = FakeStorageEvent;
  return win;
}

const DEFAULTS = ['hermes', 'bot-crossing', 'open-design'];

test('AT-PIN-01 defaults keep existing tabs and leave Dayflow unpinned', () => {
  assert.deepEqual(readAgentToolPins('u1', memoryStorage()), { scope: 'u1', ids: DEFAULTS, error: false });
});

test('AT-PIN-02 a throwing localStorage getter falls back to defaults with an error, never throws', () => {
  installWindow(() => { throw new DOMException('blocked', 'SecurityError'); });
  assert.deepEqual(readAgentToolPins('u1'), { scope: 'u1', ids: DEFAULTS, error: true });
  assert.deepEqual(writeAgentToolPins('u1', ['hermes']), { ok: false });
  assert.deepEqual(toggleAgentToolPin('u1', 'dayflow'), { scope: 'u1', ids: DEFAULTS, error: true });
  assert.deepEqual(resetAgentToolPins('u1'), { ok: false });
  const throwingGet = { getItem() { throw new Error('quota'); } };
  assert.equal(readAgentToolPins('u1', throwingGet).error, true);
});

test('AT-PIN-03 malformed, unknown, duplicate, or coordinator entries never become pins', () => {
  for (const raw of ['{', '"hermes"', '["hermes","hermes"]', '["coordinator"]', '[1]']) {
    const result = readAgentToolPins('u1', memoryStorage({ [agentToolPinsKey('u1')]: raw }));
    assert.deepEqual(result.ids, DEFAULTS, raw);
  }
  assert.deepEqual(writeAgentToolPins('u1', ['coordinator'], memoryStorage()), { ok: false });
});

test('AT-PIN-04 toggles read fresh state so another window\'s change is not overwritten', () => {
  const storage = memoryStorage();
  installWindow(() => storage);
  assert.deepEqual(toggleAgentToolPin('u1', 'dayflow', storage).ids, [...DEFAULTS, 'dayflow']);
  storage.setItem(agentToolPinsKey('u1'), JSON.stringify(['open-design'])); // another window
  assert.deepEqual(toggleAgentToolPin('u1', 'hermes', storage).ids, ['open-design', 'hermes']);
  assert.deepEqual(toggleAgentToolPin('u1', 'not-a-tool', storage).ids, ['open-design', 'hermes']);
});

test('AT-PIN-05 scopes are isolated per owner and events only reach the matching scope', () => {
  const storage = memoryStorage({ 'rhythm.settings.u1': '{"theme":"light"}' });
  const win = installWindow(() => storage);
  const seen = { u1: 0, u2: 0 };
  const stop1 = subscribeAgentToolPins('u1', () => { seen.u1 += 1; });
  const stop2 = subscribeAgentToolPins('u2', () => { seen.u2 += 1; });
  toggleAgentToolPin('u1', 'hermes', storage);
  assert.deepEqual(seen, { u1: 1, u2: 0 });
  assert.deepEqual(readAgentToolPins('u2', storage).ids, DEFAULTS);
  win.dispatchEvent(new FakeStorageEvent('storage', { key: agentToolPinsKey('u2') }));
  win.dispatchEvent(new FakeStorageEvent('storage', { key: null })); // clear() elsewhere
  assert.deepEqual(seen, { u1: 2, u2: 2 });
  stop1(); stop2();
  toggleAgentToolPin('u1', 'hermes', storage);
  assert.deepEqual(seen, { u1: 2, u2: 2 });
  // Numeric and string forms of one user id share one key.
  assert.equal(agentToolPinsKey(7), agentToolPinsKey('7'));
  assert.equal(storage.getItem('rhythm.settings.u1'), '{"theme":"light"}');
});

test('AT-PIN-06 reset removes only this scope\'s pin key and restores defaults', () => {
  const storage = memoryStorage({ 'rhythm.settings.u1': '{"theme":"light"}', [agentToolPinsKey('u2')]: '["dayflow"]' });
  installWindow(() => storage);
  writeAgentToolPins('u1', ['dayflow'], storage);
  assert.deepEqual(resetAgentToolPins('u1', storage), { ok: true });
  assert.deepEqual(readAgentToolPins('u1', storage).ids, DEFAULTS);
  assert.equal(storage.getItem(agentToolPinsKey('u2')), '["dayflow"]');
  assert.equal(storage.getItem('rhythm.settings.u1'), '{"theme":"light"}');
});
