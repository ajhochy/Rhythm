import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANCEL_TURN_KEY_OPTIONS,
  DEFAULT_LOCAL_USER_PREFERENCES,
  matchesCancelTurnKey,
  matchesNewSessionKey,
  matchesSendMessageKey,
  matchSwitchSessionKey,
  NEW_SESSION_KEY_OPTIONS,
  readLocalUserPreferences,
  SWITCH_SESSION_KEY_OPTIONS,
} from '../src/gateway/user-preferences.ts';

test('issue-1521: invalid persisted composer shortcuts fall back to Enter', () => {
  const storage = {
    getItem: () => JSON.stringify({ theme: 'solarized', sendKey: 'Shift+Enter' }),
  };

  assert.deepEqual(readLocalUserPreferences('user-1', storage), DEFAULT_LOCAL_USER_PREFERENCES);
});

test('issue-1521: the selected composer shortcut matches only its advertised chord', () => {
  const key = (overrides = {}) => ({
    key: 'Enter', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides,
  });

  assert.equal(matchesSendMessageKey(key(), 'Enter'), true);
  assert.equal(matchesSendMessageKey(key({ shiftKey: true }), 'Enter'), false);
  assert.equal(matchesSendMessageKey(key(), 'Meta+Enter'), false);
  assert.equal(matchesSendMessageKey(key({ metaKey: true }), 'Meta+Enter'), true);
  assert.equal(matchesSendMessageKey(key({ ctrlKey: true }), 'Meta+Enter'), true);
  assert.equal(matchesSendMessageKey(key({ altKey: true, metaKey: true }), 'Meta+Enter'), false);
});

test('issue-1521: sandboxed storage access falls back before preferences are read', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('Storage is unavailable in this sandbox', 'SecurityError'); },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  assert.deepEqual(readLocalUserPreferences('sandbox'), DEFAULT_LOCAL_USER_PREFERENCES);
});

test('issue-1551: unknown session shortcuts fall back to the advertised defaults', () => {
  const storage = { getItem: () => JSON.stringify({
    newSessionKey: 'N', cancelTurnKey: 'Backspace', switchSessionKey: 'Meta+ArrowLeft/Right',
  }) };
  const preferences = readLocalUserPreferences('user-1', storage);
  assert.equal(preferences.newSessionKey, 'Meta+N');
  assert.equal(preferences.cancelTurnKey, 'Escape');
  assert.equal(preferences.switchSessionKey, 'Meta+BracketLeft/Right');
  assert.equal(NEW_SESSION_KEY_OPTIONS[0].value, preferences.newSessionKey);
  assert.equal(CANCEL_TURN_KEY_OPTIONS[0].value, preferences.cancelTurnKey);
  assert.equal(SWITCH_SESSION_KEY_OPTIONS[0].value, preferences.switchSessionKey);
});

test('issue-1551: new-session and cancel-turn matchers accept only the configured chord', () => {
  const key = (key, overrides = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides });
  assert.equal(matchesNewSessionKey(key('n', { metaKey: true }), 'Meta+N'), true);
  assert.equal(matchesNewSessionKey(key('N', { ctrlKey: true }), 'Meta+N'), true);
  assert.equal(matchesNewSessionKey(key('n'), 'Meta+N'), false);
  assert.equal(matchesNewSessionKey(key('n', { metaKey: true, shiftKey: true }), 'Meta+N'), false);
  assert.equal(matchesNewSessionKey(key('n', { metaKey: true, altKey: true }), 'Meta+N'), false);
  assert.equal(matchesNewSessionKey(key('n', { ctrlKey: true, shiftKey: true }), 'Meta+Shift+N'), true);
  assert.equal(matchesCancelTurnKey(key('Escape'), 'Escape'), true);
  assert.equal(matchesCancelTurnKey(key('Escape', { shiftKey: true }), 'Escape'), false);
  assert.equal(matchesCancelTurnKey(key('.', { ctrlKey: true }), 'Meta+Period'), true);
  assert.equal(matchesCancelTurnKey(key('.', { ctrlKey: true, shiftKey: true }), 'Meta+Period'), false);
});

test('issue-1551: switch-session matcher reports only the configured direction', () => {
  const key = (key, overrides = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides });
  assert.equal(matchSwitchSessionKey(key('[', { metaKey: true }), 'Meta+BracketLeft/Right'), 'previous');
  assert.equal(matchSwitchSessionKey(key(']', { ctrlKey: true }), 'Meta+BracketLeft/Right'), 'next');
  assert.equal(matchSwitchSessionKey(key('[', { metaKey: true, shiftKey: true }), 'Meta+BracketLeft/Right'), null);
  assert.equal(matchSwitchSessionKey(key('ArrowUp', { altKey: true }), 'Alt+ArrowUp/Down'), 'previous');
  assert.equal(matchSwitchSessionKey(key('ArrowDown', { altKey: true }), 'Alt+ArrowUp/Down'), 'next');
  assert.equal(matchSwitchSessionKey(key('ArrowDown'), 'Alt+ArrowUp/Down'), null);
});
