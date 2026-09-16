import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe : describe.skip;
const apiUrl = process.env.RHYTHM_LIVE_API_URL ?? '';
const fakeGoogleUrl = process.env.RHYTHM_GOOGLE_OAUTH_TEST_BASE_URL ?? '';

describeLive('iOS hosted OAuth sandbox HTTP contract', () => {
  let expectedNonce = '';
  let closeFakeGoogle: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
    expect(apiUrl).toMatch(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
    const fakeUrl = new URL(fakeGoogleUrl);
    expect(fakeUrl.hostname).toMatch(/^(?:127\.0\.0\.1|localhost)$/);
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token' && req.method === 'POST') {
        res.end(JSON.stringify({ access_token: 'fake-access', id_token: 'fake-signed-id-token', token_type: 'Bearer' }));
        return;
      }
      if (req.url?.startsWith('/tokeninfo?')) {
        res.end(JSON.stringify({
          aud: '123456789-hosted.apps.googleusercontent.com',
          azp: '123456789-hosted.apps.googleusercontent.com',
          email: 'ios-oauth-live@example.invalid',
          email_verified: true,
          exp: Math.floor(Date.now() / 1000) + 300,
          iss: 'https://accounts.google.com',
          nonce: expectedNonce,
          sub: 'ios-oauth-live-sub',
        }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(Number(fakeUrl.port), fakeUrl.hostname, resolve));
    closeFakeGoogle = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  afterAll(async () => closeFakeGoogle?.());

  it('C10 completes begin, bound callback, deep link, and one-time redeem through the sandbox API', async () => {
    // Regression: route wiring or process-local handoff gaps cannot be hidden by controller-only tests.
    const verifier = 'v'.repeat(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const appState = 'live_state_abcdefghijklmnopqrstuvwxyz123456';
    const begun = await fetch(`${apiUrl}/auth/google/mobile-begin?${new URLSearchParams({
      app_state: appState,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })}`, { redirect: 'manual' });
    expect(begun.status).toBe(302);
    const cookie = begun.headers.get('set-cookie')!.split(';', 1)[0];
    const authorization = new URL(begun.headers.get('location')!);
    expectedNonce = authorization.searchParams.get('nonce')!;

    const callback = await fetch(
      `${apiUrl}/auth/google/callback?code=fake-approved-code&state=${encodeURIComponent(authorization.searchParams.get('state')!)}`,
      { headers: { cookie }, redirect: 'manual' },
    );
    expect(callback.status).toBe(302);
    const deepLink = new URL(callback.headers.get('location')!);
    expect(deepLink.origin + deepLink.pathname).toBe('null/callback');
    expect(deepLink.protocol).toBe('rhythmagents:');
    expect(deepLink.hostname).toBe('oauth');
    expect(deepLink.searchParams.get('state')).toBe(appState);

    const redeem = () => fetch(`${apiUrl}/auth/google/mobile-redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: deepLink.searchParams.get('code'), codeVerifier: verifier }),
    });
    const first = await redeem();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ user: { email: 'ios-oauth-live@example.invalid' } });
    const replay = await redeem();
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'mobile_login_expired', retry: 'begin_fresh_login' });
  });
});
