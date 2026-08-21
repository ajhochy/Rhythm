import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveGoogleDesktopClientId } from '../src/runtime-config.mjs';

test('local dev can supply the public Google desktop client ID at runtime', () => {
  assert.equal(
    resolveGoogleDesktopClientId('', { GOOGLE_DESKTOP_CLIENT_ID: '  runtime-client.apps.googleusercontent.com  ' }),
    'runtime-client.apps.googleusercontent.com',
  );
});

test('packaged builds retain their generated Google desktop client ID', () => {
  assert.equal(
    resolveGoogleDesktopClientId('packaged-client.apps.googleusercontent.com', {}),
    'packaged-client.apps.googleusercontent.com',
  );
});

test('packaging copies the runtime config module imported by main', async () => {
  const packageScript = await readFile(new URL('../scripts/package-mac.mjs', import.meta.url), 'utf8');
  assert.match(packageScript, /src\/runtime-config\.mjs/);
});