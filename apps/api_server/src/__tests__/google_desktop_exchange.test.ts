import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { env } from '../config/env';
import { GoogleOAuthService } from '../services/google_oauth_service';
import { AuthService } from '../services/auth_service';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { UsersRepository } from '../repositories/users_repository';
import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';

const nativeFetch = globalThis.fetch;

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('Google desktop PKCE exchange', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalClientId: string;
  let originalClientSecret: string;

  beforeEach(() => {
    setDb(makeDb());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    originalClientId = env.googleAuthClientId;
    originalClientSecret = env.googleAuthClientSecret;
    (env as { googleAuthClientId: string }).googleAuthClientId =
      'desktop-client.apps.googleusercontent.com';
    (env as { googleAuthClientSecret: string }).googleAuthClientSecret =
      'desktop-client-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (env as { googleAuthClientId: string }).googleAuthClientId = originalClientId;
    (env as { googleAuthClientSecret: string }).googleAuthClientSecret = originalClientSecret;
  });

  it('exchanges code with PKCE and returns tokens + profile', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-123',
            refresh_token: 'refresh-123',
            expires_in: 3600,
            scope: 'openid email profile',
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'google-sub-xyz',
            email: 'user@example.com',
            name: 'Test User',
            picture: 'https://example.com/user.png',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const service = new GoogleOAuthService();
    const result = await service.exchangeDesktopCode({
      code: 'auth-code',
      codeVerifier: 'verifier-abc',
      redirectUri: 'http://127.0.0.1:54321/callback',
    });

    expect(result.tokens.access_token).toBe('access-123');
    expect(result.profile.email).toBe('user@example.com');
    expect(result.profile.picture).toBe('https://example.com/user.png');
    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token');
    const body = (tokenCall[1].body as URLSearchParams).toString();
    expect(body).toContain('code=auth-code');
    expect(body).toContain('code_verifier=verifier-abc');
    expect(body).toContain(
      'client_id=desktop-client.apps.googleusercontent.com',
    );
    expect(body).toContain('client_secret=desktop-client-secret');
  });

  it('initializes only authorized calendar integration after desktop exchange', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-456',
            refresh_token: 'refresh-456',
            expires_in: 3600,
            scope:
              'openid email profile https://www.googleapis.com/auth/calendar.readonly',
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'google-sub-1',
            email: 'alice@example.com',
            name: 'Alice',
            picture: 'https://example.com/alice.png',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const oauth = new GoogleOAuthService();
    new UsersRepository().create({
      name: 'Preprovisioned Alice',
      email: 'alice@example.com',
    });
    const authService = new AuthService();
    const { tokens, profile } = await oauth.exchangeDesktopCode({
      code: 'c',
      codeVerifier: 'v',
      redirectUri: 'http://127.0.0.1:1/callback',
    });
    const session = await authService.loginWithGoogleProfile({
      googleSub: profile.sub,
      email: profile.email!,
      name: profile.name!,
      photoUrl: profile.picture ?? null,
    });
    await oauth.storeDesktopIntegration(session.user.id, tokens, profile);

    const accounts = new IntegrationAccountsRepository();
    const cal = await accounts.findByProviderAsync(
      'google_calendar',
      session.user.id,
    );
    const gmail = await accounts.findByProviderAsync('gmail', session.user.id);
    expect(cal?.accessToken).toBe('access-456');
    expect(gmail).toBeNull();
    expect(cal?.refreshToken).toBe('refresh-456');
    expect(session.user.photoUrl).toBe('https://example.com/alice.png');
  });

  it('does not replace existing broad integrations with a desktop sign-in token', async () => {
    const owner = new UsersRepository().create({
      name: 'Existing User',
      email: 'existing@example.com',
    });
    const accounts = new IntegrationAccountsRepository();
    const broadScope = [
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ].join(' ');
    await accounts.upsertGoogleAccountAsync({
      ownerId: owner.id,
      externalAccountId: 'google-sub-existing',
      email: 'existing@example.com',
      displayName: 'Existing User',
      accessToken: 'broad-access',
      refreshToken: 'broad-refresh',
      scope: broadScope,
      tokenType: 'Bearer',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });

    const oauth = new GoogleOAuthService();
    await oauth.storeDesktopIntegration(
      owner.id,
      { access_token: 'login-only-access', scope: 'openid email profile', expires_in: 3600, token_type: 'Bearer' },
      { sub: 'google-sub-existing', email: 'existing@example.com' },
    );

    for (const provider of ['google_calendar', 'gmail'] as const) {
      const account = await accounts.findByProviderAsync(provider, owner.id);
      expect(account).toMatchObject({
        status: 'connected',
        accessToken: 'broad-access',
        refreshToken: 'broad-refresh',
        scope: broadScope,
        expiresAt: '2030-01-01T00:00:00.000Z',
      });
    }
  });

  it('does not create integration accounts for an identity-only desktop sign-in token', async () => {
    const owner = new UsersRepository().create({ name: 'New User', email: 'new@example.com' });
    const oauth = new GoogleOAuthService();
    await oauth.storeDesktopIntegration(
      owner.id,
      { access_token: 'identity-access', scope: 'openid email profile', expires_in: 3600, token_type: 'Bearer' },
      { sub: 'google-sub-new', email: 'new@example.com' },
    );
    const accounts = new IntegrationAccountsRepository();
    expect(await accounts.findByProviderAsync('google_calendar', owner.id)).toBeNull();
    expect(await accounts.findByProviderAsync('gmail', owner.id)).toBeNull();
  });

  it('exposes a login-only capability and exchange without mutating existing integrations', async () => {
    const owner = new UsersRepository().create({ name: 'Route User', email: 'route@example.com' });
    const accounts = new IntegrationAccountsRepository();
    const broadScope = 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
    await accounts.upsertGoogleAccountAsync({
      ownerId: owner.id, externalAccountId: 'google-sub-route', email: 'route@example.com', displayName: 'Route User',
      accessToken: 'broad-route-access', refreshToken: 'broad-route-refresh', scope: broadScope,
      tokenType: 'Bearer', expiresAt: '2030-01-01T00:00:00.000Z',
    });
    const server = await startTestServer(createApp());
    try {
      const capability = await nativeFetch(`${server.baseUrl}/auth/google/desktop-login-capability`);
      expect(capability.status).toBe(200);
      expect(await capability.json()).toEqual({ loginOnlyDesktopExchange: true });

      fetchMock
        .mockResolvedValueOnce(Response.json({ access_token: 'identity-route-access', scope: 'openid email profile', token_type: 'Bearer' }))
        .mockResolvedValueOnce(Response.json({ sub: 'google-sub-route', email: 'route@example.com', name: 'Route User' }));
      const exchange = await nativeFetch(`${server.baseUrl}/auth/google/desktop-login-exchange`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'auth-code', codeVerifier: 'verifier-abc', redirectUri: 'http://127.0.0.1:54321/callback' }),
      });
      expect(exchange.status).toBe(200);
      expect(await exchange.json()).toMatchObject({ user: { id: owner.id }, sessionToken: expect.any(String) });
      for (const provider of ['google_calendar', 'gmail'] as const) {
        expect(await accounts.findByProviderAsync(provider, owner.id)).toMatchObject({
          accessToken: 'broad-route-access', refreshToken: 'broad-route-refresh', scope: broadScope,
        });
      }
    } finally {
      await server.close();
    }
  });

  it('login-only exchange never creates integrations even when Google returns broad scopes', async () => {
    const owner = new UsersRepository().create({ name: 'Fresh Route User', email: 'fresh-route@example.com' });
    const server = await startTestServer(createApp());
    try {
      const invalid = await nativeFetch(`${server.baseUrl}/auth/google/desktop-login-exchange`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      expect(invalid.status).toBe(400);
      const missingBody = await nativeFetch(`${server.baseUrl}/auth/google/desktop-login-exchange`, { method: 'POST' });
      expect(missingBody.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock
        .mockResolvedValueOnce(Response.json({
          access_token: 'broad-login-access', refresh_token: 'broad-login-refresh',
          scope: 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send',
          token_type: 'Bearer',
        }))
        .mockResolvedValueOnce(Response.json({ sub: 'google-sub-fresh-route', email: 'fresh-route@example.com', name: 'Fresh Route User' }));
      const exchange = await nativeFetch(`${server.baseUrl}/auth/google/desktop-login-exchange`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'auth-code', codeVerifier: 'verifier-abc', redirectUri: 'http://127.0.0.1:54321/callback' }),
      });
      expect(exchange.status).toBe(200);
      expect(await exchange.json()).toMatchObject({ user: { id: owner.id }, sessionToken: expect.any(String) });
      const accounts = new IntegrationAccountsRepository();
      expect(await accounts.findByProviderAsync('google_calendar', owner.id)).toBeNull();
      expect(await accounts.findByProviderAsync('gmail', owner.id)).toBeNull();
    } finally {
      await server.close();
    }
  });

  it('surfaces Google token errors as AppError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    );

    const service = new GoogleOAuthService();
    await expect(
      service.exchangeDesktopCode({
        code: 'bad',
        codeVerifier: 'v',
        redirectUri: 'http://127.0.0.1:1/callback',
      }),
    ).rejects.toThrow(/Google token exchange failed/);
  });

  it('rejects when desktop client id is not configured', async () => {
    (env as { googleAuthClientId: string }).googleAuthClientId = '';
    const service = new GoogleOAuthService();
    await expect(
      service.exchangeDesktopCode({
        code: 'c',
        codeVerifier: 'v',
        redirectUri: 'http://127.0.0.1:1/callback',
      }),
    ).rejects.toThrow(/not configured/);
  });

  it('rejects when desktop client secret is not configured', async () => {
    (env as { googleAuthClientSecret: string }).googleAuthClientSecret = '';
    const service = new GoogleOAuthService();
    await expect(
      service.exchangeDesktopCode({
        code: 'c',
        codeVerifier: 'v',
        redirectUri: 'http://127.0.0.1:1/callback',
      }),
    ).rejects.toThrow(/not configured/);
  });
});
