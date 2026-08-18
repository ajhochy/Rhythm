import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const VALID_PRODUCTION_ENV = {
  EXPO_PUBLIC_E2E_MODE: '',
  EXPO_PUBLIC_E2E_SERVER_URL: '',
  EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID:
    '123456789-example.apps.googleusercontent.com',
  EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI:
    'com.googleusercontent.apps.123456789-example:/oauthredirect',
  EXPO_PUBLIC_RHYTHM_CLOUD_URL: 'https://api.vcrcapps.com',
};

function resolvedConfig(variant, envOverrides = {}) {
  const output = execFileSync('npx', ['expo', 'config', '--json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...VALID_PRODUCTION_ENV,
      EXPO_APP_VARIANT: variant,
      ...envOverrides,
    },
  });
  return JSON.parse(output);
}

const production = resolvedConfig('production');
assert.equal(production.name, 'Rhythm Agents');
assert.equal(production.slug, 'rhythm-mobile');
assert.deepEqual(production.scheme, [
  'rhythmagents',
  'com.googleusercontent.apps.123456789-example',
]);
assert.equal(production.owner, 'ajhochys-team');
assert.equal(production.ios.bundleIdentifier, 'org.visaliacrc.rhythm.agents');
assert.equal(production.extra.eas.projectId, 'bd873c89-2fe2-45db-805c-ab819e582e5c');
assert.equal(
  production.ios.infoPlist?.NSPhotoLibraryUsageDescription,
  'Allow Rhythm Agents to access photos you choose to attach to a conversation.',
  'production must explain why a user-selected photo may be attached',
);
assert.equal(
  production.ios.infoPlist?.NSAppTransportSecurity,
  undefined,
  'production must not emit an ATS bypass',
);

const development = resolvedConfig('development');
assert.equal(development.name, 'Rhythm Agents Dev');
assert.equal(development.ios.bundleIdentifier, 'org.visaliacrc.rhythm.agents.dev');
assert.equal(
  development.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads,
  true,
  'development must allow HTTP pairing to a Mac LAN/Tailscale IP',
);

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
assert.equal(
  eas.submit.production.ios.ascAppId,
  '6796011479',
  'production submission must target the existing Rhythm Agents App Store record',
);

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
  'npm run test:corrective:1224 && ' +
  'npm run test:corrective:1225 && ' +
  'npm run test:fake-server:self && ' +
  'npm run test:acceptance:1167 && ' +
  'npm run test:security:1174 && ' +
  'npm run test:security:1175 && ' +
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
assert.match(
  pkgForFoundation.scripts['test:ci:static'],
  /npm run test:security:1175/,
  'static gate must execute the paired gateway security review tests',
);
const appConfigSource = await readFile(
  new URL('../app.config.ts', import.meta.url),
  'utf8',
);
assert.match(
  appConfigSource,
  /android:usesCleartextTraffic'\]\s*=\s*allowLocalHttp\s*\?\s*'true'\s*:\s*'false'/,
  'Android cleartext traffic must be explicit and limited to development/E2E variants',
);

console.log('app config tests passed');
