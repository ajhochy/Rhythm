import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOOGLE_DESKTOP_SCOPES,
  buildGoogleAuthorizationUrl,
  exchangeDesktopAuthorizationCode,
  generatePkcePair,
  validateGoogleCallback,
  withOAuthTimeout,
} from '../src/google-oauth-core.mjs';
import { runDesktopGoogleOAuth } from '../src/desktop-google-oauth.mjs';

test('post-m1-auth-c1/c2: PKCE and authorization URL match Flutter', async () => {
  const pkce = await generatePkcePair();
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]{86}$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(buildGoogleAuthorizationUrl({
    clientId: 'desktop-client', redirectUri: 'http://127.0.0.1:54321/callback', codeChallenge: pkce.challenge, state: 'state',
  }));
  assert.deepEqual([...url.searchParams.entries()].map(([key, value]) => [key, key === 'scope' ? value.split(' ') : value]), [
    ['client_id', 'desktop-client'],
    ['redirect_uri', 'http://127.0.0.1:54321/callback'],
    ['response_type', 'code'],
    ['scope', [...GOOGLE_DESKTOP_SCOPES]],
    ['code_challenge', pkce.challenge],
    ['code_challenge_method', 'S256'],
    ['state', 'state'],
    ['access_type', 'offline'],
    ['prompt', 'consent'],
    ['include_granted_scopes', 'true'],
  ]);
});

test('post-m1-auth-c3/c4/c5: callback validation fails closed', () => {
  assert.throws(() => validateGoogleCallback(new URLSearchParams('code=ok&state=wrong'), 'expected'), /state mismatch/);
  assert.throws(() => validateGoogleCallback(new URLSearchParams('error=access_denied&state=wrong'), 'expected'), /OAuth error: access_denied/);
  assert.throws(() => validateGoogleCallback(new URLSearchParams('state=expected'), 'expected'), /did not return a code/);
  assert.throws(() => validateGoogleCallback(new URLSearchParams('code=&state=expected'), 'expected'), /did not return a code/);
});

test('post-m1-auth-c6: callback timeout is exactly five minutes', async () => {
  let delay;
  await assert.rejects(withOAuthTimeout(new Promise(() => undefined), 300_000, (callback, timeout) => {
    delay = timeout;
    callback();
    return 1;
  }, () => undefined), /callback timed out/);
  assert.equal(delay, 300_000);
});

test('post-m1-auth-c7: desktop exchange body and response shape match Flutter', async () => {
  let captured;
  const login = await exchangeDesktopAuthorizationCode({
    apiBase: 'https://api.vcrcapps.com', code: 'code', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:1/callback',
    fetcher: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ sessionToken: 'runtime-token', user: { id: 1, name: 'AJ', email: 'aj@example.test', role: 'admin' } }), { status: 200 });
    },
  });
  assert.equal(captured.url, 'https://api.vcrcapps.com/auth/google/desktop-exchange');
  assert.deepEqual(JSON.parse(captured.init.body), { code: 'code', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:1/callback' });
  assert.equal(login.sessionToken, 'runtime-token');
});

test('post-m1-auth-c8: host binds loopback, opens externally, exchanges, and closes', async () => {
  let callbackUrl = '';
  let openedUrl = '';
  const login = await runDesktopGoogleOAuth({
    clientId: 'desktop-client',
    apiBase: 'https://api.vcrcapps.com',
    onListening: (details) => {
      assert.equal(details.address, '127.0.0.1');
      assert.ok(details.port > 0);
      callbackUrl = details.callbackUrl;
    },
    openExternal: async (authorizationUrl) => {
      openedUrl = authorizationUrl;
      const url = new URL(authorizationUrl);
      const redirectUri = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      const response = await fetch(`${redirectUri}?code=authorization-code&state=${encodeURIComponent(state)}`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /You can close this window and return to Rhythm/);
    },
    fetcher: async (_url, init) => {
      assert.equal(JSON.parse(init.body).code, 'authorization-code');
      return new Response(JSON.stringify({ sessionToken: 'runtime-token', user: { id: 1, name: 'AJ', email: 'aj@example.test', role: 'admin' } }), { status: 200 });
    },
  });
  assert.match(openedUrl, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.equal(login.sessionToken, 'runtime-token');
  await assert.rejects(fetch(callbackUrl), /fetch failed/);
});
