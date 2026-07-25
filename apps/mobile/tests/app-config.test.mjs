import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

function resolvedConfig(variant, envOverrides = {}) {
  const output = execFileSync('npx', ['expo', 'config', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, EXPO_APP_VARIANT: variant, ...envOverrides },
  });
  return JSON.parse(output);
}

const production = resolvedConfig('production');
assert.equal(production.name, 'Rhythm Agents');
assert.equal(production.slug, 'rhythm-mobile');
assert.equal(production.scheme, 'rhythmagents');
assert.equal(production.owner, 'ajhochys-team');
assert.equal(production.ios.bundleIdentifier, 'org.visaliacrc.rhythm.agents');
assert.equal(production.extra.eas.projectId, 'bd873c89-2fe2-45db-805c-ab819e582e5c');

const development = resolvedConfig('development');
assert.equal(development.name, 'Rhythm Agents Dev');
assert.equal(development.ios.bundleIdentifier, 'org.visaliacrc.rhythm.agents.dev');

const oauthConfigured = resolvedConfig('development', {
  EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI:
    'com.googleusercontent.apps.example:/oauth-callback',
});
assert.deepEqual(
  oauthConfigured.scheme,
  ['rhythmagents', 'com.googleusercontent.apps.example'],
  'native config must register the Google redirect scheme',
);

const eas = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'));
assert.equal(eas.build.development.developmentClient, true);
assert.equal(eas.build.development.distribution, 'internal');
assert.equal(eas.build['development-simulator'].extends, 'development');
assert.equal(eas.build['development-simulator'].ios.simulator, true);
assert.equal(eas.build.preview.distribution, 'internal');
assert.equal(eas.build.production.autoIncrement, true);

// verify:foundation gate — must exist and run the full suite in order
const pkgForFoundation = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const expectedFoundation =
  'npm run contract:check && ' +
  'npm run test:contract && ' +
  'npm run test:app-config && ' +
  'npm run lint && ' +
  'npm run typecheck && ' +
  'npm run test:transport-clients && ' +
  'npm run test:rhythm-account && ' +
  'npm run test:google-mobile-oauth && ' +
  'npm run test:paired-host && ' +
  'npm run test:connection-persistence && ' +
  'npm run test:notification-persistence && ' +
  'npm run test:fake-server:self && ' +
  'npm run test:acceptance:1167 && ' +
  'npm run test:e2e:web';
assert.equal(
  pkgForFoundation.scripts['verify:foundation'],
  expectedFoundation,
  'verify:foundation script must exist in package.json and run all required checks',
);
assert.match(
  pkgForFoundation.scripts['test:ci:static'],
  /npm run test:rhythm-account/,
  'static gate must execute the Rhythm account contract tests',
);
assert.match(
  pkgForFoundation.scripts['test:ci:static'],
  /npm run test:google-mobile-oauth/,
  'static gate must execute the mobile OAuth contract tests',
);
assert.match(
  pkgForFoundation.scripts['test:ci:static'],
  /npm run test:paired-host/,
  'static gate must execute the paired-host security and state tests',
);
assert.match(
  pkgForFoundation.scripts['test:ci:static'],
  /npm run test:app-config/,
  'static gate must execute the app configuration contract tests',
);

console.log('app config tests passed');
