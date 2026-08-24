import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveKeychainEnvironment } from '../src/human-approval-main-signer.mjs';

test('isolated Electron HOME is overridden only for the macOS Keychain subprocess', () => {
  const env = resolveKeychainEnvironment(
    { HOME: '/tmp/rhythm-isolated-home', PATH: '/usr/bin', RHYTHM_LOCAL_SMOKE: '1' },
    '/Users/rhythm-user',
  );

  assert.deepEqual(env, {
    HOME: '/Users/rhythm-user',
    PATH: '/usr/bin',
    RHYTHM_LOCAL_SMOKE: '1',
  });
});
