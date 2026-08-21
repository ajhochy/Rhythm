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

test('ordinary Electron tests exclude package-shaped contracts', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.doesNotMatch(packageJson.scripts.test, /electron-unsigned-package|issue-1402-packaged-api-server|post-m1-phase-1-packaged-host|test\/\*\.test/);
  assert.match(packageJson.scripts['test:package'], /electron-unsigned-package/);
  assert.match(packageJson.scripts['test:package'], /issue-1402-packaged-api-server/);
  assert.match(packageJson.scripts['test:package'], /post-m1-phase-1-packaged-host/);
});