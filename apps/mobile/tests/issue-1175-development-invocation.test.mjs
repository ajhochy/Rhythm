import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mobileRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

test('issue-1175-c31: ordinary prototype commands force development config without production OAuth', () => {
  // Regression caught: `npm run ios` inherited the production app-config
  // default, so a normal local Debug build failed on production-only OAuth
  // validation before Xcode could compile the development client.
  const expectedPrototypeScripts = {
    start:
      'EXPO_APP_VARIANT=development NODE_ENV=development expo start',
    'start:dev-client':
      'EXPO_APP_VARIANT=development NODE_ENV=development expo start --dev-client',
    'config:development':
      'EXPO_APP_VARIANT=development NODE_ENV=development expo config --json',
    'build:web:ci':
      'EXPO_APP_VARIANT=development NODE_ENV=development expo export --clear --platform web --output-dir dist-e2e',
    android:
      'EXPO_APP_VARIANT=development NODE_ENV=development expo run:android',
    web:
      'EXPO_APP_VARIANT=development NODE_ENV=development expo start --web',
    ios:
      'EXPO_APP_VARIANT=development NODE_ENV=development expo run:ios',
  };
  for (const [name, expected] of Object.entries(expectedPrototypeScripts)) {
    assert.equal(
      pkg.scripts[name],
      expected,
      `${name} must force the development Expo variant and NODE_ENV`,
    );
  }
  assert.match(
    pkg.scripts['test:ci:static'],
    /npm run test:development-invocation/,
    'the mobile static gate must execute this development invocation contract',
  );

  assert.deepEqual(
    {
      'build:android': pkg.scripts['build:android'],
      'build:development:android': pkg.scripts['build:development:android'],
      'verify:production-bundle': pkg.scripts['verify:production-bundle'],
      'release:preflight:ios': pkg.scripts['release:preflight:ios'],
      'eas:development:ios': pkg.scripts['eas:development:ios'],
      'eas:development:ios-simulator':
        pkg.scripts['eas:development:ios-simulator'],
      'eas:production:ios': pkg.scripts['eas:production:ios'],
      'eas:submit:ios': pkg.scripts['eas:submit:ios'],
    },
    {
      'build:android': 'node ./scripts/build-android-release.mjs',
      'build:development:android':
        'node ./scripts/build-android-development.mjs',
      'verify:production-bundle':
        'node ./scripts/verify-production-bundle.mjs',
      'release:preflight:ios':
        'node ./scripts/release-preflight-ios.mjs && node ./scripts/verify-production-bundle.mjs',
      'eas:development:ios':
        'npm exec --yes --package=eas-cli@21.2.0 -- eas build --profile development --platform ios --non-interactive',
      'eas:development:ios-simulator':
        'npm exec --yes --package=eas-cli@21.2.0 -- eas build --profile development-simulator --platform ios --non-interactive',
      'eas:production:ios':
        'npm run release:preflight:ios && npm exec --yes --package=eas-cli@21.2.0 -- eas build --profile production --platform ios --non-interactive --freeze-credentials --auto-submit-with-profile production',
      'eas:submit:ios':
        'npm run release:preflight:ios && npm exec --yes --package=eas-cli@21.2.0 -- eas submit --profile production --platform ios --latest --non-interactive --wait',
    },
    'prototype script hardening must not alter EAS or release commands',
  );

  const env = {
    ...process.env,
    EXPO_APP_VARIANT: 'production',
    NODE_ENV: 'production',
  };
  for (const name of [
    'EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI',
    'EXPO_PUBLIC_RHYTHM_CLOUD_URL',
  ]) {
    delete env[name];
  }
  const output = execFileSync(
    'npm',
    ['run', '--silent', 'config:development'],
    {
      cwd: mobileRoot,
      encoding: 'utf8',
      env,
    },
  );
  const config = JSON.parse(output);
  assert.equal(config.name, 'Rhythm Agents Dev');
  assert.equal(
    config.ios.bundleIdentifier,
    'org.visaliacrc.rhythm.agents.dev',
  );
  assert.equal(
    config.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads,
    true,
  );
});
