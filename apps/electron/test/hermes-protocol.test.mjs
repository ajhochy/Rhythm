import assert from 'node:assert/strict';
import test from 'node:test';
import { hermesReadyOrigin, MAX_HERMES_INTENT_BYTES, parseHermesBounds, parseHermesIntent } from '../src/hermes-protocol.mjs';

test('Hermes protocol accepts exactly the two version-one DTOs', () => {
  for (const intent of [{ v: 1, type: 'navigate-session', sessionId: 'abc-123_DEF' }, { v: 1, type: 'new-chat', context: 'Rhythm dashboard\nTasks: 3\nReview before sending.' }]) {
    assert.deepEqual(parseHermesIntent(intent), intent);
    assert.notEqual(parseHermesIntent(intent), intent, 'forward a fresh DTO, not arbitrary properties');
  }
});

test('Hermes protocol rejects unknown versions/types, malformed DTOs and URL injection', () => {
  for (const value of [null, [], 'hello', 1, {}, { v: 2, type: 'new-chat', context: 'x' },
    { v: 1, type: 'eval', context: 'x' }, { v: 1, type: 'new-chat', context: '' },
    { v: 1, type: 'new-chat', context: ' \n' }, { v: 1, type: 'new-chat', context: 'a\u0000b' },
    { v: 1, type: 'new-chat', context: 'x', auth: 'forbidden' }, { v: 1, type: 'new-chat', context: 12 },
    ...['', '../config', 'a/b', 'a?learn=send', 'a#b', 'https://evil.test', '%2f', 'a'.repeat(257)]
      .map(sessionId => ({ v: 1, type: 'navigate-session', sessionId }))]) {
    assert.equal(parseHermesIntent(value), null, JSON.stringify(value));
  }
  const cycle = { v: 1, type: 'new-chat' }; cycle.context = cycle;
  assert.equal(parseHermesIntent(cycle), null);
  assert.equal(parseHermesIntent({ get v() { throw new Error('hostile getter'); } }), null);
});

test('Hermes protocol bounds the complete UTF-8 JSON encoding at 64 KiB', () => {
  const empty = { v: 1, type: 'new-chat', context: '' };
  const overhead = Buffer.byteLength(JSON.stringify(empty));
  const exact = { ...empty, context: 'a'.repeat(MAX_HERMES_INTENT_BYTES - overhead) };
  assert.deepEqual(parseHermesIntent(exact), exact);
  assert.equal(parseHermesIntent({ ...exact, context: `${exact.context}x` }), null);
  assert.equal(parseHermesIntent({ ...empty, context: '🌏'.repeat(20_000) }), null);
  assert.equal(parseHermesIntent({ ...empty, context: '\n'.repeat(33_000) }), null, 'JSON escaping counts');
});

test('Hermes supervisor origin must be ready, loopback, root-only, and match the declared port', () => {
  const ready = { state: 'ready', url: 'http://127.0.0.1:9121', port: 9121 };
  assert.equal(hermesReadyOrigin(ready), ready.url);
  for (const override of [{ state: 'starting' }, { port: '9121' }, { port: 4001 }, { port: -1 },
    ...['https://127.0.0.1:9121', 'http://localhost:9121', 'http://evil.test:9121', 'file:///tmp/index.html',
      'http://a:b@127.0.0.1:9121', `${ready.url}/api`, `${ready.url}/?token=x`, `${ready.url}/#x`, 'invalid']
      .map(url => ({ url }))]) assert.equal(hermesReadyOrigin({ ...ready, ...override }), null);
});

test('Hermes bounds reject non-finite, excessive, negative dimensions and extra keys', () => {
  const bounds = { x: -10.5, y: 20, width: 300, height: 200 };
  assert.deepEqual(parseHermesBounds(bounds), bounds);
  for (const override of [{ width: -1 }, { height: Infinity }, { x: NaN }, { x: 1_000_001 }, { y: '2' }, { auth: 'x' }]) {
    assert.equal(parseHermesBounds({ ...bounds, ...override }), null);
  }
  assert.equal(parseHermesBounds([]), null);
});
