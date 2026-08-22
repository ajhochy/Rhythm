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

test('packaging copies every support module imported by main', async () => {
  const packageScript = await readFile(new URL('../scripts/package-mac.mjs', import.meta.url), 'utf8');
  for (const module of ['runtime-config', 'artifact-frame-protocol']) {
    assert.match(packageScript, new RegExp(`src\\/${module}\\.mjs`), `${module}.mjs is missing from the packaged app`);
  }
});

test('ordinary Electron tests exclude package-shaped contracts', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.doesNotMatch(packageJson.scripts.test, /electron-unsigned-package|issue-1402-packaged-api-server|post-m1-phase-1-packaged-host|test\/\*\.test/);
  assert.match(packageJson.scripts['test:package'], /electron-unsigned-package/);
  assert.match(packageJson.scripts['test:package'], /issue-1402-packaged-api-server/);
  assert.match(packageJson.scripts['test:package'], /post-m1-phase-1-packaged-host/);
});

test('web build declares Node types as a required root dependency', async () => {
  const webPackage = JSON.parse(await readFile(new URL('../../web/package.json', import.meta.url), 'utf8'));
  const webLock = JSON.parse(await readFile(new URL('../../web/package-lock.json', import.meta.url), 'utf8'));
  assert.match(webPackage.devDependencies['@types/node'], /^\^22\./);
  assert.equal(webLock.packages[''].devDependencies['@types/node'], webPackage.devDependencies['@types/node']);
  assert.equal(webLock.packages['node_modules/@types/node'].optional, undefined);
  assert.equal(webLock.packages['node_modules/@types/node'].peer, undefined);
});

test('Electron release installs every package dependency and builds assets before shell smoke', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/electron_release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node-version:\s*['"]22\.x['"]/);
  assert.doesNotMatch(workflow, /node-version:\s*['"](?:24|26)\.x['"]/);
  for (const workspace of ['apps/web', 'apps/api_server', 'apps/electron']) {
    assert.match(workflow, new RegExp(`npm --prefix ${workspace.replace('/', '\\/')} ci`));
    assert.doesNotMatch(workflow, new RegExp(`npm --prefix ${workspace.replace('/', '\\/')} install`));
  }
  assert.match(workflow, /npm run test:package/);
  assert.ok(
    workflow.indexOf('npm run test:package') < workflow.indexOf('npm run package:mac'),
    'Electron release must run unsigned package contracts before rebuilding the final artifact',
  );
  assert.ok(
    workflow.indexOf('npm run package:mac') < workflow.indexOf('npm test'),
    'Electron release must build web/API/package assets before tests that launch the shell',
  );
  assert.match(workflow, /Contents\/MacOS\/Rhythm" --smoke --security-smoke/);
});