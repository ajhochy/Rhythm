import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LOCAL_USER_PREFERENCES,
  matchesSendMessageKey,
  readLocalUserPreferences,
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
