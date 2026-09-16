import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { GoogleMobileLoginBroker, GoogleMobileLoginMissing, googleMobileLoginBroker } from '../services/google_mobile_login_broker';
import { startTestServer } from './helpers/real_server';

const nativeFetch = globalThis.fetch;
const verifier = 'v'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const appState = 'a'.repeat(48);

describe('iOS hosted Google OAuth broker contract', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let claims: Record<string, unknown>;
  let googleRequests: Array<{ url: string; body: URLSearchParams | null }>;
  const original = {
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: env.googleRedirectUri,
  };

  beforeEach(async () => {
    env.googleClientId = '123456789-hosted.apps.googleusercontent.com';
    env.googleClientSecret = 'unit-test-client-secret';
    env.googleRedirectUri = 'https://api.rhythm.example/auth/google/callback';
    process.env.RHYTHM_GOOGLE_ALLOWED_EMAILS = 'verified@example.com';
    claims = {
      aud: env.googleClientId,
      azp: env.googleClientId,
      email: 'verified@example.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://accounts.google.com',
      name: 'Verified User',
      picture: 'https://example.com/photo.png',
      sub: 'verified-sub',
    };
    googleRequests = [];
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(String(init?.body ?? ''));
        googleRequests.push({ url, body });
        return Response.json({ access_token: 'secret-access', id_token: 'signed-id-token', token_type: 'Bearer' });
      }
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
        googleRequests.push({ url, body: null });
        return Response.json(claims);
      }
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        googleRequests.push({ url, body: null });
        return Response.json({ sub: 'legacy-sub', email: 'verified@example.com', name: 'Legacy User' });
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    googleMobileLoginBroker.resetForTests();
    new UsersRepository().create({ name: 'Preprovisioned', email: 'verified@example.com' });
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    globalThis.fetch = nativeFetch;
    env.googleClientId = original.clientId;
    env.googleClientSecret = original.clientSecret;
    env.googleRedirectUri = original.redirectUri;
    delete process.env.RHYTHM_GOOGLE_ALLOWED_EMAILS;
    await closeServer();
    db.close();
  });

  async function begin(patch: Record<string, string> = {}) {
    const query = new URLSearchParams({
      code_challenge: challenge,
      code_challenge_method: 'S256',
      app_state: appState,
      ...patch,
    });
    return nativeFetch(`${baseUrl}/auth/google/mobile-begin?${query}`, { redirect: 'manual' });
  }

  async function complete() {
    const begun = await begin();
    const cookie = begun.headers.get('set-cookie')!.split(';', 1)[0];
    const authorization = new URL(begun.headers.get('location')!);
    const state = authorization.searchParams.get('state')!;
    claims.nonce = authorization.searchParams.get('nonce');
    const callback = await nativeFetch(
      `${baseUrl}/auth/google/callback?code=approved-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: 'manual' },
    );
    const deepLink = new URL(callback.headers.get('location')!);
    return { begun, authorization, callback, deepLink };
  }

  it('C1 creates a bound short-lived transaction and sends only login scopes to the existing web client', async () => {
    // Regression: a mobile login must not inherit offline integration scopes or a caller return URL.
    const response = await begin({ return_url: 'https://attacker.example/callback' });
    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('set-cookie')).toMatch(/Secure; HttpOnly; SameSite=Lax; Path=\/auth\/google\/callback/i);
    const url = new URL(response.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(env.googleClientId);
    expect(url.searchParams.get('redirect_uri')).toBe(env.googleRedirectUri);
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
    expect(url.searchParams.get('access_type')).toBeNull();
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.toString()).not.toContain('attacker.example');
  });

  it.each([
    ['wrong challenge method', { code_challenge_method: 'plain' }],
    ['short challenge', { code_challenge: 'short' }],
    ['malformed app state', { app_state: 'spaces are invalid' }],
    ['oversized app state', { app_state: 'a'.repeat(129) }],
  ])('C2 rejects %s without redirecting', async (_label, patch) => {
    const response = await begin(patch);
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('C3 validates cookie, state, and nonce before exchange and never falls through to legacy login', async () => {
    const begun = await begin();
    const authorization = new URL(begun.headers.get('location')!);
    const state = authorization.searchParams.get('state')!;
    const missingCookie = await nativeFetch(
      `${baseUrl}/auth/google/callback?code=secret-code&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    expect(missingCookie.status).toBe(401);
    expect(googleRequests).toHaveLength(0);
    expect(await new SessionsRepository().findByTokenAsync(state)).toBeNull();

    const malformed = await nativeFetch(
      `${baseUrl}/auth/google/callback?code=secret-code&state=mobile_login_missing&state=legacy-looking`,
      { redirect: 'manual' },
    );
    expect(malformed.status).toBe(409);
    expect(googleRequests).toHaveLength(0);
  });

  it.each([
    ['aud', { aud: 'foreign.apps.googleusercontent.com' }],
    ['azp', { azp: 'foreign.apps.googleusercontent.com' }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['issuer', { iss: 'https://attacker.example' }],
    ['expiry', { exp: 1 }],
    ['verified email', { email_verified: false }],
    ['subject', { sub: '' }],
    ['email', { email: '' }],
  ])('C4 rejects invalid ID-token %s and creates no session or integration', async (_label, patch) => {
    const begun = await begin();
    const cookie = begun.headers.get('set-cookie')!.split(';', 1)[0];
    const authorization = new URL(begun.headers.get('location')!);
    const state = authorization.searchParams.get('state')!;
    claims = { ...claims, nonce: authorization.searchParams.get('nonce'), ...patch };
    const response = await nativeFetch(
      `${baseUrl}/auth/google/callback?code=approved-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: 'manual' },
    );
    expect(response.status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM integration_accounts').get()).toEqual({ n: 0 });
  });

  it('C5 redirects only an opaque handoff and original app state, then redeems to the exact auth response', async () => {
    const { authorization, callback, deepLink } = await complete();
    expect(callback.status).toBe(302);
    expect({ protocol: deepLink.protocol, host: deepLink.hostname, path: deepLink.pathname }).toEqual({
      protocol: 'rhythmagents:',
      host: 'oauth',
      path: '/callback',
    });
    expect(callback.headers.get('location')).toMatch(/^rhythmagents:\/\/oauth\/callback\?/);
    expect(deepLink.searchParams.get('state')).toBe(appState);
    expect(deepLink.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(callback.headers.get('location')).not.toMatch(/secret-access|signed-id-token|verified@example\.com|verified-sub|nonce/i);
    expect(authorization.searchParams.get('scope')).toBe('openid email profile');

    const response = await nativeFetch(`${baseUrl}/auth/google/mobile-redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: deepLink.searchParams.get('code'), codeVerifier: verifier }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await response.json() as { sessionToken: string; user: { email: string } };
    expect(Object.keys(body).sort()).toEqual(['sessionToken', 'user']);
    expect(body.user.email).toBe('verified@example.com');
    expect(await new SessionsRepository().findUserByTokenAsync(body.sessionToken)).toMatchObject({ email: 'verified@example.com' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM integration_accounts').get()).toEqual({ n: 0 });
  });

  it('C6 binds redeem to PKCE and atomically allows only one concurrent session', async () => {
    const { deepLink } = await complete();
    const code = deepLink.searchParams.get('code');
    const redeem = (codeVerifier: string) => nativeFetch(`${baseUrl}/auth/google/mobile-redeem`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, codeVerifier }),
    });
    expect((await redeem('x'.repeat(64))).status).toBe(401);
    const [first, second] = await Promise.all([redeem(verifier), redeem(verifier)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  });

  it('C8 fails closed with a retryable fresh-login error when process-local state is missing', async () => {
    // Regression: a restart must never turn an orphaned mobile state into a legacy integration callback.
    const response = await nativeFetch(
      `${baseUrl}/auth/google/callback?code=secret-code&state=mobile_login_missing_process_state`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'mobile_login_expired', retry: 'begin_fresh_login' });
    expect(googleRequests).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('C7 preserves the legacy session-bound integration callback unchanged', async () => {
    const user = (await new UsersRepository().findByEmailAsync('verified@example.com'))!;
    const session = new SessionsRepository().create(user.id);
    const response = await nativeFetch(
      `${baseUrl}/auth/google/callback?code=legacy-code&state=${encodeURIComponent(session.token)}`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Google connected');
    expect(await new IntegrationAccountsRepository().findByProviderAsync('google_calendar', user.id)).not.toBeNull();
  });

  it('C9 rate limits transaction creation without reflecting oversized or secret inputs', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 12; index += 1) statuses.push((await begin({ app_state: `${appState}${index}` })).status);
    expect(statuses).toContain(429);
    const response = await begin({ app_state: 'secret-marker'.repeat(20) });
    expect(await response.text()).not.toContain('secret-marker');
  });
});

describe('GoogleMobileLoginBroker process-local lifecycle', () => {
  it('C8 uses injected clock/random and expires login and handoff state without persistence', () => {
    // Regression: stale process memory must not remain redeemable beyond either fixed TTL.
    let now = 1_000;
    let sequence = 0;
    const broker = new GoogleMobileLoginBroker({
      now: () => now,
      randomId: () => `${String(sequence++).padStart(43, 'a')}`,
    });
    const begun = broker.begin({ appState, codeChallenge: challenge, rateKey: 'test' });
    now += 5 * 60 * 1000 + 1;
    expect(() => broker.consumeLogin(begun.state, begun.browserBinding)).toThrow(GoogleMobileLoginMissing);

    const code = broker.issueHandoff({
      googleSub: 'sub', email: 'verified@example.com', name: 'Verified', photoUrl: null, hostedDomain: null,
    }, challenge);
    now += 60 * 1000 + 1;
    expect(() => broker.consumeHandoff(code, verifier)).toThrow(GoogleMobileLoginMissing);
  });
});
