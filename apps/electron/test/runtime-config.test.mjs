import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

import { resolveGoogleDesktopClientId } from '../src/runtime-config.mjs';

const run = promisify(execFile);

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
  // The whole src/ tree is copied and the build fails if any module main/preload reach is missing.
  assert.match(packageScript, /cp\(resolve\(electronRoot, 'src'\), resolve\(packagedApp, 'src'\), \{\s*recursive: true/);
  assert.match(packageScript, /assertPackagedModuleGraph\(resolve\(packagedApp, 'src'\), \['main\.mjs', 'preload\.cjs'/);
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
  assert.match(workflow, /node-version:\s*['"]22\.22\.0['"]/);
  assert.doesNotMatch(workflow, /node-version:\s*['"](?:24|26)\.x['"]/);
  for (const workspace of ['apps/web', 'apps/api_server', 'apps/electron']) {
    assert.match(workflow, new RegExp(`npm --prefix ${workspace.replace('/', '\\/')} ci`));
    assert.doesNotMatch(workflow, new RegExp(`npm --prefix ${workspace.replace('/', '\\/')} install`));
  }
  assert.match(workflow, /npm run test:package/);
  assert.match(workflow, /actions\/setup-python@[a-f0-9]{40}/);
  assert.match(workflow, /python-version:\s*['"]3\.11['"]/);
  assert.match(workflow, /https:\/\/github\.com\/ajhochy\/hermes-rhythm-plugin\.git/);
  assert.match(workflow, /PINNED_HERMES_DESKTOP_SOURCE_COMMIT/);
  const sourceCommitValidation = workflow.split(/\r?\n/).find((line) => line.includes('HERMES_DESKTOP_SOURCE_COMMIT') && line.includes('=~'))?.trim();
  assert.ok(sourceCommitValidation, 'Electron release must validate the extracted Hermes source commit before fetching it');
  await run('bash', ['-c', sourceCommitValidation], {
    env: { ...process.env, HERMES_DESKTOP_SOURCE_COMMIT: 'a'.repeat(40) },
  });
  await assert.rejects(
    run('bash', ['-c', sourceCommitValidation], { env: { ...process.env, HERMES_DESKTOP_SOURCE_COMMIT: 'not-a-full-sha' } }),
    /Command failed/,
  );
  assert.match(workflow, /git(?: -C "\$\{HERMES_DESKTOP_ROOT\}")? fetch --depth=1 origin "\$\{HERMES_DESKTOP_SOURCE_COMMIT\}"/);
  assert.match(workflow, /git(?: -C "\$\{HERMES_DESKTOP_ROOT\}")? checkout --detach FETCH_HEAD/);
  assert.match(workflow, /npm ci\s+--prefix "\$\{HERMES_DESKTOP_ROOT\}"/);
  assert.match(workflow, /test "\$\(node -p 'process\.arch'\)" = "\$\{RHYTHM_PACKAGE_ARCH\}"/);
  assert.match(workflow, /GITHUB_SHA= GITHUB_REF_NAME= GITHUB_HEAD_REF= npm --prefix "\$\{HERMES_DESKTOP_ROOT\}\/apps\/desktop" run build:rhythm-embedded/);
  assert.match(workflow, /npm --prefix "\$\{HERMES_DESKTOP_ROOT\}\/apps\/desktop" run build:rhythm-embedded/);
  assert.match(workflow, /RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR=.*GITHUB_ENV/);
  assert.ok(
    workflow.indexOf('RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR=') < workflow.indexOf('npm run test:package'),
    'Electron release must export the verified embedded Desktop artifact before package contracts run',
  );
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
