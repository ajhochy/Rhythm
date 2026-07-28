import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const VALID_PRODUCTION_ENV = {
  EXPO_APP_VARIANT: 'production',
  EXPO_PUBLIC_E2E_MODE: '',
  EXPO_PUBLIC_E2E_SERVER_URL: '',
  EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID:
    '123456789-example.apps.googleusercontent.com',
  EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI:
    'com.googleusercontent.apps.123456789-example:/oauthredirect',
  EXPO_PUBLIC_RHYTHM_CLOUD_URL: 'https://api.vcrcapps.com',
};

function expoConfig(overrides = {}) {
  return spawnSync('npx', ['expo', 'config', '--json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...VALID_PRODUCTION_ENV,
      ...overrides,
    },
  });
}

test('issue-1175-c18: hostile QR origins never receive cloud credentials and cannot choose pairing identity', async () => {
  // Regression caught: pair() constructed RhythmCloudClient with the Cloud
  // session token and sent Bearer requests to an arbitrary *.ts.net QR host.
  const [store, routes, controller, service] = await Promise.all([
    readFile(
      new URL('../lib/pairing/paired-host-store.ts', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL(
        '../../api_server/src/routes/mobile_gateway_routes.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../../api_server/src/controllers/mobile_gateway_controller.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../../api_server/src/services/mobile_pairing_service.ts',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  const pairBlock = store.slice(
    store.indexOf('async pair('),
    store.indexOf('\n  async forget', store.indexOf('async pair(')),
  );
  const controllerPair = controller.slice(
    controller.indexOf('pair(req:'),
    controller.indexOf('listDevices(', controller.indexOf('pair(req:')),
  );
  const servicePair = service.slice(
    service.indexOf('pair(input:'),
    service.indexOf('\n  health(', service.indexOf('pair(input:')),
  );

  assert.ok(pairBlock.length > 0, 'paired-host store must expose pair()');
  assert.doesNotMatch(pairBlock, /RHYTHM_SESSION_SECURE_KEY/);
  assert.doesNotMatch(pairBlock, /RhythmCloudClient/);
  assert.doesNotMatch(pairBlock, /Authorization\s*:\s*`?Bearer/i);
  assert.match(
    pairBlock,
    /requestPublic|PublicGateway|UnauthenticatedGateway/i,
    'QR preflight/pair must use an explicitly unauthenticated transport',
  );
  assert.match(
    pairBlock,
    /PairedMacClient[\s\S]*(?:response\.deviceToken|newDeviceToken)/,
    'new-device rollback must use the newly issued Device credential',
  );
  assert.match(
    pairBlock,
    /existing[\s\S]*(?:deviceToken|credential)[\s\S]*PairedMacClient|PairedMacClient[\s\S]*existing[\s\S]*(?:deviceToken|credential)/,
    'old-host replacement must use the stored old Device credential',
  );

  const pairRoute = routes.match(
    /router\.post\(\s*['"]\/pair['"][\s\S]*?\n\s*\);/,
  )?.[0] ?? '';
  const healthRoute = routes.match(
    /router\.get\(\s*['"]\/health['"][\s\S]*?\n\s*\);/,
  )?.[0] ?? '';
  assert.doesNotMatch(pairRoute, /requireCloudUser|requireMobileCloudUser/);
  assert.doesNotMatch(
    healthRoute,
    /requireCloudUser|requireSessionOrMobileDevice|requireMobileDevice/,
  );
  assert.doesNotMatch(controllerPair, /authenticatedUserId|body\?*\.userId/);
  assert.doesNotMatch(servicePair, /input\.userId/);
  assert.match(servicePair, /pairingCode\.userId/);
  assert.match(servicePair, /\buserId\s*:\s*pairingCode\.userId/);
  assert.match(
    servicePair,
    /return\s*\{[\s\S]*\buserId\s*:\s*pairingCode\.userId/,
    'pair response must let the signed-in app verify the code-bound account',
  );
});

test('issue-1175-c22: a production app cannot compile in test mode or with unusable authentication', async () => {
  // Regression caught: EXPO_PUBLIC_E2E_MODE could silently win in a production
  // build, while missing OAuth variables still produced a signed app whose
  // only sign-in action failed at runtime.
  const good = expoConfig();
  assert.equal(good.status, 0, good.stderr || good.stdout);
  const resolved = JSON.parse(good.stdout);
  assert.equal(resolved.extra?.e2eMode, false);
  assert.equal(resolved.extra?.e2eServerUrl, undefined);
  assert.equal(
    resolved.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads,
    undefined,
  );

  for (const [label, overrides] of [
    ['production E2E', { EXPO_PUBLIC_E2E_MODE: '1' }],
    ['missing client id', { EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID: '' }],
    ['missing redirect', { EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI: '' }],
    ['mismatched redirect', {
      EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI:
        'com.googleusercontent.apps.someone-else:/oauthredirect',
    }],
    ['missing Cloud origin', { EXPO_PUBLIC_RHYTHM_CLOUD_URL: '' }],
    ['insecure Cloud origin', {
      EXPO_PUBLIC_RHYTHM_CLOUD_URL: 'http://api.vcrcapps.com',
    }],
    ['unapproved Cloud origin', {
      EXPO_PUBLIC_RHYTHM_CLOUD_URL: 'https://attacker.example',
    }],
  ]) {
    const failed = expoConfig(overrides);
    assert.notEqual(
      failed.status,
      0,
      `${label} must stop production config resolution`,
    );
  }

  const [packageJson, verifier] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(
      JSON.parse,
    ),
    readFile(
      new URL('../scripts/verify-production-bundle.mjs', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(verifier, /e2e-cloud-session/);
  assert.match(verifier, /__control/);
  assert.match(verifier, /fake[-_ ]?user/i);
  assert.match(verifier, /test gateway|E2E_SERVER_URL|e2eServerUrl/i);
  assert.match(verifier, /GOOGLE_MOBILE_CLIENT_ID|oauth/i);
  assert.match(
    packageJson.scripts['release:preflight:ios'] ?? '',
    /verify-production-bundle/,
  );
});

test('issue-1175-c24: clean-shell production build command is pinned and unattended', async () => {
  // Regression caught: the committed command named one developer's private
  // launcher and omitted --non-interactive, so it failed or prompted anywhere
  // else.
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const command = pkg.scripts['eas:production:ios'] ?? '';
  assert.ok(command, 'production iOS command must exist');
  assert.doesNotMatch(command, /\/Users\/|~\//);
  assert.match(command, /eas-cli@\d+\.\d+\.\d+|npm exec[\s\S]*eas-cli/);
  assert.match(command, /--non-interactive/);
  assert.match(command, /release:preflight:ios|release-preflight-ios/);
  assert.match(command, /--profile\s+production/);
  assert.match(command, /--platform\s+ios/);

  const preflight = await readFile(
    new URL('../scripts/release-preflight-ios.mjs', import.meta.url),
    'utf8',
  );
  assert.match(preflight, /projectId|bd873c89-2fe2-45db-805c-ab819e582e5c/);
  assert.match(preflight, /whoami|EXPO_TOKEN|authenticated/i);
  assert.match(preflight, /credential|Apple|ASC|EAS/i);
  assert.match(preflight, /non-interactive/i);
});

test('issue-1175-c25: mobile cannot create or expose public OpenCode transcript links', async () => {
  const [
    classificationsText,
    manifest,
    workspace,
    providerTypes,
    provider,
    sessionService,
  ] = await Promise.all([
    readFile(
      new URL(
        '../contracts/rhythm-opencode-classifications.json',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../../api_server/src/services/mobile_opencode_operations.generated.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(new URL('../app/agents/workspace.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../providers/opencode-provider-types.ts', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../providers/opencode-provider.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../providers/services/session-service.ts', import.meta.url),
      'utf8',
    ),
  ]);
  const classifications = JSON.parse(classificationsText);
  for (const operationId of ['session.share', 'session.unshare']) {
    const entry = classifications.operations.find(
      (candidate) => candidate.operationId === operationId,
    );
    assert.ok(entry, `${operationId} classification must be explicit`);
    assert.equal(entry.gatewayAllowed, false);
    assert.match(
      entry.gatewayReason ?? entry.reason ?? '',
      /private|privacy|public transcript|unsupported/i,
    );
    assert.match(
      manifest,
      new RegExp(
        `"operationId":"${operationId.replace('.', '\\.')}"[^\\n]*"allowed":false`,
      ),
    );
  }
  for (const source of [
    workspace,
    providerTypes,
    provider,
    sessionService,
  ]) {
    assert.doesNotMatch(source, /\b(?:shareSession|unshareSession)\b/);
  }
  assert.doesNotMatch(workspace, /Share session publicly|share-variant/);
});
