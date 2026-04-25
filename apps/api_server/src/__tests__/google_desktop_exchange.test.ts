import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { env } from '../config/env';
import { GoogleOAuthService } from '../services/google_oauth_service';
import { AuthService } from '../services/auth_service';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';

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

  it('stores google_calendar and gmail integration accounts after exchange', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-456',
            refresh_token: 'refresh-456',
            expires_in: 3600,
            scope:
              'openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.metadata',
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
    expect(gmail?.accessToken).toBe('access-456');
    expect(cal?.refreshToken).toBe('refresh-456');
    expect(session.user.photoUrl).toBe('https://example.com/alice.png');
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
