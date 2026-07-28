import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const VALID_PRODUCTION_ENV = {
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
      EXPO_PUBLIC_E2E_MODE: '',
      EXPO_PUBLIC_E2E_SERVER_URL: '',
      ...envOverrides,
    },
  });
  return JSON.parse(output);
}

function localHttpCapable(config) {
  const ats = config.ios?.infoPlist?.NSAppTransportSecurity ?? {};
  return (
    ats.NSAllowsArbitraryLoads === true ||
    ats.NSAllowsLocalNetworking === true ||
    Object.keys(ats.NSExceptionDomains ?? {}).some((domain) =>
      ['localhost', '127.0.0.1'].includes(domain))
  );
}

test('issue-1175-c12: paired reload and inspection stay on Device auth plus opaque project scope', async () => {
  // Regression caught: reloadOpenCodeSkills/reloadOpenCodeConfig rebuild a
  // direct settings client, sending Basic auth and a filesystem directory
  // even while every ordinary SDK call is using the paired Device transport.
  const [providerSource, inspectionSource] = await Promise.all([
    readFile(
      new URL('../providers/opencode-provider.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL(
        '../providers/services/opencode-inspection-service.ts',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  const reloadBlock = providerSource.slice(
    providerSource.indexOf('const reloadOpenCodeSkills'),
    providerSource.indexOf('const refreshTerminals'),
  );

  assert.match(
    reloadBlock,
    /svcReloadOpenCodeSkills\(\s*client\s*\)/,
    'skill reload must use the already scoped paired SDK client',
  );
  assert.match(
    reloadBlock,
    /svcReloadOpenCodeConfig\(\s*client\s*\)/,
    'config reload must use the already scoped paired SDK client',
  );
  assert.doesNotMatch(
    reloadBlock,
    /\.\.\.settings|settings\.directory|requestOpenCodeRoute/,
    'paired reload may not reconstruct a Basic/direct settings request',
  );
  assert.match(
    inspectionSource,
    /reloadOpenCodeSkills\(\s*client\s*:\s*(?:Scoped)?OpencodeClient/,
    'inspection service must accept the authenticated scoped client',
  );
  assert.match(
    inspectionSource,
    /reloadOpenCodeConfig\(\s*client\s*:\s*(?:Scoped)?OpencodeClient/,
    'config reload service must accept the authenticated scoped client',
  );
});

test('issue-1175-c13: production iOS ATS denies arbitrary HTTP while explicit dev and E2E remain local-capable', () => {
  // Regression caught: NSAllowsArbitraryLoads is emitted for the production
  // App Store build, disabling ATS globally instead of limiting localhost HTTP
  // capability to deliberate development and E2E variants.
  const production = resolvedConfig('production');
  const development = resolvedConfig('development');
  const e2e = resolvedConfig('development', {
    EXPO_PUBLIC_E2E_MODE: '1',
    EXPO_PUBLIC_E2E_SERVER_URL: 'http://127.0.0.1:4096',
  });
  const productionAts =
    production.ios?.infoPlist?.NSAppTransportSecurity ?? {};

  assert.notEqual(
    productionAts.NSAllowsArbitraryLoads,
    true,
    'production/TestFlight iOS config must not allow arbitrary HTTP',
  );
  assert.equal(
    productionAts.NSAllowsLocalNetworking,
    undefined,
    'production config must not carry an unnecessary local-network ATS bypass',
  );
  assert.deepEqual(
    productionAts.NSExceptionDomains ?? {},
    {},
    'production config must not contain localhost or broad HTTP exceptions',
  );
  assert.equal(
    localHttpCapable(development),
    true,
    'the explicit development variant must remain capable of local HTTP',
  );
  assert.equal(
    localHttpCapable(e2e),
    true,
    'explicit E2E mode must remain capable of its local sandbox URL',
  );
});
