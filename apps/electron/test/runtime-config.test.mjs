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

test('1535:release-ci-producer:1 the Colony source commit is validated with an executed bash =~ line', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/electron_release.yml', import.meta.url), 'utf8');
  const validation = workflow.split(/\r?\n/).find((line) => line.includes('COLONY_SOURCE_COMMIT') && line.includes('=~'))?.trim();
  assert.ok(validation, 'Electron release must validate the extracted Colony source commit before fetching it');
  assert.match(validation, /\[\[.*=~.*\]\]/, 'the validation must be a real bash [[ =~ ]] test, not `test ... =~`');
  await run('bash', ['-c', validation], { env: { ...process.env, COLONY_SOURCE_COMMIT: 'a'.repeat(40) } });
  await assert.rejects(
    run('bash', ['-c', validation], { env: { ...process.env, COLONY_SOURCE_COMMIT: 'not-a-full-sha' } }),
    /Command failed/,
  );
  await assert.rejects(
    run('bash', ['-c', validation], { env: { ...process.env, COLONY_SOURCE_COMMIT: 'a'.repeat(39) } }),
    /Command failed/,
    '39 hex characters is one short of a full SHA and must be rejected',
  );
});

test('1535:release-ci-producer:2 the workflow fetches, checks out and pins the exact Colony revision, and asserts native arch and cleared CI env before building', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/electron_release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /https:\/\/github\.com\/ajhochy\/bot-crossing\.git/);
  assert.match(workflow, /PINNED_COLONY_SOURCE_COMMIT/);
  assert.match(workflow, /git(?: -C "\$\{COLONY_ROOT\}")? fetch --depth=1 origin "\$\{COLONY_SOURCE_COMMIT\}"/);
  assert.match(workflow, /git(?: -C "\$\{COLONY_ROOT\}")? checkout --detach FETCH_HEAD/);
  assert.match(workflow, /test "\$\(git -C "\$\{COLONY_ROOT\}" rev-parse HEAD\)" = "\$\{COLONY_SOURCE_COMMIT\}"/);
  assert.match(workflow, /test "\$\(node -p 'process\.arch'\)" = "\$\{RHYTHM_PACKAGE_ARCH\}"/);
  assert.match(workflow, /npm ci --prefix "\$\{COLONY_ROOT\}"/);
  assert.match(workflow, /GITHUB_SHA= GITHUB_REF_NAME= GITHUB_HEAD_REF= npm --prefix "\$\{COLONY_ROOT\}" run build:rhythm-embedded/);
  assert.match(workflow, /RHYTHM_COLONY_ARTIFACT_DIR=.*GITHUB_ENV/);
});

test('1535:release-ci-producer:3 RHYTHM_COLONY_ARTIFACT_DIR is exported before test:package, which runs before package:mac', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/electron_release.yml', import.meta.url), 'utf8');
  assert.ok(
    workflow.indexOf('RHYTHM_COLONY_ARTIFACT_DIR=') < workflow.indexOf('npm run test:package'),
    'the verified Colony artifact must be exported before package contracts run',
  );
  assert.ok(
    workflow.indexOf('npm run test:package') < workflow.indexOf('npm run package:mac'),
    'package contracts must run before the final artifact assembly',
  );
});

test('1535:release-ci-producer:4 a signed-bundle --colony-smoke step follows security smoke, and manifest/SHA-256 receipts are uploaded', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/electron_release.yml', import.meta.url), 'utf8');
  const securitySmoke = workflow.indexOf('--smoke --security-smoke\n');
  const colonySmoke = workflow.indexOf('--colony-smoke');
  assert.ok(securitySmoke >= 0 && colonySmoke >= 0);
  assert.ok(securitySmoke < colonySmoke, 'Colony smoke runs after the plain security smoke step');
  assert.match(workflow, /colony-manifest-\$\{\{ matrix\.arch \}\}\.json/);
  assert.match(workflow, /Rhythm-\$\{\{ matrix\.arch \}\}\.zip\.sha256/);
  // Regression: --colony-smoke used to be accepted on the command line and do nothing. It must
  // actually gate a real runtime path in main.mjs, not just appear in the YAML.
  const mainSource = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(mainSource, /process\.argv\.includes\('--colony-smoke'\)/, 'main.mjs must read the --colony-smoke flag');
  assert.match(mainSource, /runColonySmoke/, 'main.mjs must invoke a real Colony smoke behind that flag');
});

test('1535:release-ci-producer:5 no new Colony step echoes a secret, and the YAML parses', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/electron_release.yml', import.meta.url), 'utf8');
  // Scope to just the Colony producer/smoke/receipt steps this slice adds (steps are delimited by
  // `      - name:` at two-space step indent); the unrelated pre-existing certificate-import step
  // legitimately pipes a secret into `base64 --decode`, never printing it, and must not be flagged.
  const steps = workflow.split(/\n(?=      - name:)/);
  const colonySteps = steps.filter((step) => /- name:.*Colony/.test(step));
  assert.ok(colonySteps.length >= 4, 'expected the Colony checkout/build/smoke/receipt steps');
  for (const step of colonySteps) for (const line of step.split(/\r?\n/)) {
    if (/\becho\b/.test(line)) assert.doesNotMatch(line, /secrets\.|APPLE_[A-Z_]*(?:PASSWORD|BASE64|IDENTITY)/, `echo step must not print a secret: ${line}`);
  }
  const { load } = await import('js-yaml').catch(() => ({ load: null }));
  if (load) assert.ok(load(workflow), 'the workflow YAML must parse');
});
