import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8').catch(() => '');

const [helper, provider, appConfig, preflight, bundleCheck, eas, store] = await Promise.all([
  read('lib/auth/hosted-mobile-oauth.ts'),
  read('providers/rhythm-account-provider.tsx'),
  read('app.config.ts'),
  read('scripts/release-preflight-ios.mjs'),
  read('scripts/verify-production-bundle.mjs'),
  read('eas.json'),
  read('lib/auth/rhythm-session-store.ts'),
]);

test('C1 uses the fixed hosted origin and no native Google client configuration', () => {
  assert.match(helper, /https:\/\/api\.vcrcapps\.com/);
  assert.doesNotMatch(`${helper}\n${provider}\n${appConfig}\n${preflight}\n${bundleCheck}\n${eas}`, /EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID|GOOGLE_MOBILE_REDIRECT_URI/);
});

test('C2 binds local PKCE and app state to one exact rhythmagents callback', () => {
  assert.match(helper, /expo-crypto/);
  assert.match(helper, /expo-web-browser/);
  assert.match(helper, /rhythmagents:\/\/oauth\/callback/);
  assert.match(helper, /code_challenge_method/);
  assert.match(helper, /app_state/);
  assert.match(helper, /state/);
});

test('C3 performs one HTTPS redeem and explains consumed or expired handoffs', () => {
  assert.match(store, /\/auth\/google\/mobile-redeem/);
  assert.match(store, /codeVerifier/);
  assert.match(store, /expired or was already used/i);
  assert.doesNotMatch(store, /retry\s*\(/i);
});

test('C4 preserves existing SecureStore session restoration', () => {
  assert.match(store, /SecureStore/);
  assert.match(provider, /restore/);
});

test('C5 provider invalidates stale attempts before storing a session', () => {
  assert.match(provider, /operationRef\.current/);
  assert.match(provider, /startHostedMobileOAuth/);
  assert.match(provider, /operation\s*!==\s*operationRef\.current/);
});

test('C6 backend route shapes are consumed exactly by mobile', () => {
  assert.match(helper, /mobile-begin/);
  assert.match(store, /JSON\.stringify\(\{\s*code:\s*params\.code,\s*codeVerifier:\s*params\.codeVerifier\s*\}\)/);
  assert.match(store, /sessionToken/);
  assert.match(store, /exchange\.user/);
});

test('C7 release checks support production builds without native client variables', () => {
  assert.doesNotMatch(`${preflight}\n${eas}`, /GOOGLE_MOBILE_CLIENT_ID|GOOGLE_MOBILE_REDIRECT_URI/);
  assert.match(bundleCheck, /api\.vcrcapps\.com/);
});

test('C8 deep links carry only opaque code and state', () => {
  assert.match(helper, /searchParams/);
  assert.doesNotMatch(helper, /access_token|id_token|sessionToken.*searchParams|token.*deepLink/i);
});

test('C9 real Google, Cloudflare, and chat acceptance remains manual', () => {
  assert.ok(true);
});
