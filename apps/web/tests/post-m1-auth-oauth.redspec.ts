import { expect, test } from '@playwright/test';
import {
  GOOGLE_DESKTOP_SCOPES,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  buildGoogleAuthorizationUrl,
  exchangeDesktopAuthorizationCode,
  generatePkcePair,
  validateGoogleCallback,
  withOAuthTimeout,
} from '../../electron/src/google-oauth-core.mjs';
import { runDesktopGoogleOAuth } from '../../electron/src/desktop-google-oauth.mjs';

test('post-m1-auth-c1: PKCE generation matches the Flutter verifier and S256 challenge shape', async () => {
  // Regression caught: padding, weak randomness, or a non-S256 digest produces a verifier Google rejects.
  const pkce = await generatePkcePair();
  expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{86}$/);
  expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(pkce.challenge).not.toContain('=');
});

test('post-m1-auth-c2: authorization URL exactly matches the Flutter desktop contract', () => {
  // Regression caught: a scope or consent parameter drifts from Flutter and the URL equality fails.
  const url = new URL(buildGoogleAuthorizationUrl({
    clientId: 'flutter-desktop-client.apps.googleusercontent.com',
    redirectUri: 'http://127.0.0.1:54321/callback',
    codeChallenge: 'challenge_value',
    state: 'state_value',
  }));
  expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_OAUTH_AUTHORIZE_URL);
  expect([...url.searchParams.entries()]).toEqual([
    ['client_id', 'flutter-desktop-client.apps.googleusercontent.com'],
    ['redirect_uri', 'http://127.0.0.1:54321/callback'],
    ['response_type', 'code'],
    ['scope', GOOGLE_DESKTOP_SCOPES.join(' ')],
    ['code_challenge', 'challenge_value'],
    ['code_challenge_method', 'S256'],
    ['state', 'state_value'],
    ['access_type', 'offline'],
    ['prompt', 'consent'],
    ['include_granted_scopes', 'true'],
  ]);
});

test('post-m1-auth-c3: a state mismatch is rejected', () => {
  // Regression caught: accepting an attacker-controlled callback state no longer throws.
  expect(() => validateGoogleCallback(new URLSearchParams('code=ok&state=wrong'), 'expected'))
    .toThrow('Google OAuth state mismatch');
});

test('post-m1-auth-c4: an OAuth error parameter is rejected before other callback fields', () => {
  // Regression caught: an OAuth denial is treated as a missing-code or state error instead of the Google error.
  expect(() => validateGoogleCallback(new URLSearchParams('error=access_denied&state=wrong'), 'expected'))
    .toThrow('Google OAuth error: access_denied');
});

test('post-m1-auth-c5: missing and empty authorization codes are rejected', () => {
  // Regression caught: an empty code reaches the exchange endpoint and this assertion stops failing.
  for (const query of ['state=expected', 'code=&state=expected']) {
    expect(() => validateGoogleCallback(new URLSearchParams(query), 'expected'))
      .toThrow('Google OAuth did not return a code');
  }
});

test('post-m1-auth-c6: callback waiting uses the Flutter five-minute timeout', async () => {
  // Regression caught: a hung consent attempt never settles or uses a duration other than five minutes.
  let observedTimeout = 0;
  await expect(withOAuthTimeout(new Promise(() => undefined), 300_000, (callback, delay) => {
    observedTimeout = delay;
    callback();
    return 1;
  }, () => undefined)).rejects.toThrow('Google OAuth callback timed out');
  expect(observedTimeout).toBe(300_000);
});

test('post-m1-auth-c7: desktop exchange request body matches Flutter exactly', async () => {
  // Regression caught: camelCase request keys drift and the captured body no longer matches.
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const response = await exchangeDesktopAuthorizationCode({
    apiBase: 'https://api.vcrcapps.com',
    code: 'authorization-code',
    codeVerifier: 'pkce-verifier',
    redirectUri: 'http://127.0.0.1:54321/callback',
    fetcher: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({
        sessionToken: 'runtime-only-session',
        user: { id: 7, name: 'AJ', email: 'aj@example.test', role: 'admin' },
      }), { status: 200 });
    },
  });
  expect(requestUrl).toBe('https://api.vcrcapps.com/auth/google/desktop-exchange');
  expect(requestInit).toEqual({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'authorization-code',
      codeVerifier: 'pkce-verifier',
      redirectUri: 'http://127.0.0.1:54321/callback',
    }),
  });
  expect(response.sessionToken).toBe('runtime-only-session');
});

test('post-m1-auth-c8: Electron host owns loopback binding and external-browser launch', async () => {
  // Regression caught: the renderer opens Google or the host binds a public/fixed listener address.
  const calls: string[] = [];
  await runDesktopGoogleOAuth({
    clientId: 'flutter-desktop-client.apps.googleusercontent.com',
    apiBase: 'https://api.vcrcapps.com',
    timeoutMs: 25,
    openExternal: async (url) => { calls.push(url); },
    fetcher: async () => new Response('{}', { status: 500 }),
    onListening: ({ address, port, callbackUrl }) => {
      expect(address).toBe('127.0.0.1');
      expect(port).toBeGreaterThan(0);
      expect(callbackUrl).toBe(`http://127.0.0.1:${port}/callback`);
    },
  }).catch(() => undefined);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
});
