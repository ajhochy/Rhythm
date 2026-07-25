import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/auth/google-mobile-oauth.ts', import.meta.url),
  'utf8',
);

const prepared = source.replace(
  /^import\b[\s\S]*?from\s+['"][^'"]+['"]\s*;?\n?/gm,
  '',
);
const transpiled = ts.transpileModule(
  `const Prompt = { SelectAccount: 'select_account' };\n${prepared}`,
  {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  },
).outputText;
const mod = await import(`data:text/javascript,${encodeURIComponent(transpiled)}`);

const { startGoogleMobileOAuth, GOOGLE_DISCOVERY } = mod;

const [providerSource, settingsSource, accountSectionSource] = await Promise.all([
  readFile(new URL('../providers/rhythm-account-provider.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/(tabs)/settings.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/settings/rhythm-account-section.tsx', import.meta.url), 'utf8'),
]);

{
  let config;
  let discovery;
  const result = await startGoogleMobileOAuth({
    clientId: 'mobile-client-id',
    redirectUri: 'com.googleusercontent.apps.mobile:/oauth-callback',
    createNonce: () => 'nonce_abcdefghijklmnopqrstuvwxyz123456',
    createRequest: (value) => {
      config = value;
      return {
        codeVerifier: 'pkce-verifier',
        promptAsync: async (valueDiscovery) => {
          discovery = valueDiscovery;
          return { type: 'success', params: { code: 'google-code' } };
        },
      };
    },
  });

  assert.deepEqual(result, {
    code: 'google-code',
    codeVerifier: 'pkce-verifier',
    nonce: 'nonce_abcdefghijklmnopqrstuvwxyz123456',
  });
  assert.equal(config.responseType, 'code');
  assert.equal(config.usePKCE, true);
  assert.deepEqual(config.scopes, ['openid', 'email', 'profile']);
  assert.deepEqual(config.extraParams, {
    nonce: 'nonce_abcdefghijklmnopqrstuvwxyz123456',
  });
  assert.equal(discovery, GOOGLE_DISCOVERY);
  console.log('  ✓ Google OAuth starts PKCE authorization and returns exchange parameters');
}

{
  assert.match(providerSource, /startGoogleMobileOAuth\(/);
  assert.match(providerSource, /https:\/\/api\.vcrcapps\.com/);
  assert.match(providerSource, /await store\.signIn\(oauthParams\)/);
  assert.match(providerSource, /operationRef\.current/);
  assert.match(
    providerSource,
    /await startGoogleMobileOAuth[\s\S]*?if \(operation !== operationRef\.current\) return;[\s\S]*?await store\.signIn\(oauthParams\)/,
    'a stale OAuth completion must be discarded before credentials are exchanged',
  );
  assert.match(
    providerSource,
    /return \(\) => \{[\s\S]*?operationRef\.current \+= 1;/,
    'unmount must invalidate an in-flight OAuth completion',
  );
  assert.match(providerSource, /error: RhythmAccountError \| undefined/);
  assert.match(settingsSource, /rhythmAccount\.signIn\(\)\.catch/);
  console.log('  ✓ Settings sign-in action starts OAuth and exchanges through the provider');
}

{
  assert.match(accountSectionSource, /error\?: RhythmAccountError/);
  assert.match(accountSectionSource, /flexWrap: 'wrap'/);
  assert.match(accountSectionSource, /alignItems: 'flex-start'/);
  assert.match(
    accountSectionSource,
    /const canSignOut = \['signedIn', 'offline', 'error'\]\.includes\(state\)/,
    'offline and error account states must retain local-first sign-out',
  );
  console.log('  ✓ Account section exposes failures and wraps under large Dynamic Type');
}

{
  await assert.rejects(
    startGoogleMobileOAuth({
      clientId: '',
      redirectUri: 'rhythmagents://oauth-callback',
      createRequest: () => { throw new Error('must not open browser'); },
    }),
    /client ID is not configured/i,
  );
  console.log('  ✓ Missing mobile client ID fails before browser launch');
}

{
  await assert.rejects(
    startGoogleMobileOAuth({
      clientId: 'mobile-client-id',
      redirectUri: 'rhythmagents://oauth-callback',
      createNonce: () => 'nonce_abcdefghijklmnopqrstuvwxyz123456',
      createRequest: () => ({
        codeVerifier: 'pkce-verifier',
        promptAsync: async () => ({ type: 'cancel' }),
      }),
    }),
    /cancelled/i,
  );
  console.log('  ✓ Cancelled Google OAuth returns a bounded actionable error');
}

console.log('\nAll google-mobile-oauth tests passed ✓');
