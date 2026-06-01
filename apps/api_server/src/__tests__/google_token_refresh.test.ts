import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { env } from '../config/env';
import { GoogleOAuthService } from '../services/google_oauth_service';
import { AuthService } from '../services/auth_service';
import type { IntegrationAccount } from '../models/integration_account';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

function expiredAccount(ownerId: number): IntegrationAccount {
  return {
    id: 'acct-1',
    ownerId,
    provider: 'google_calendar',
    externalAccountId: 'google-sub-1',
    email: 'user@example.com',
    displayName: 'User',
    status: 'connected',
    accessToken: 'old-access',
    refreshToken: 'refresh-abc',
    scope: 'openid email profile',
    tokenType: 'Bearer',
    expiresAt: new Date(Date.now() - 60_000).toISOString(), // expired
    lastSyncedAt: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('Google token refresh uses the desktop (issuing) client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let ownerId: number;
  const original = { authId: '', authSecret: '', webId: '', webSecret: '' };

  beforeEach(async () => {
    setDb(makeDb());
    // Create the owning user so the integration_accounts FK is satisfiable.
    const session = await new AuthService().loginWithGoogleProfile({
      googleSub: 'google-sub-1',
      email: 'user@example.com',
      name: 'User',
      photoUrl: null,
    });
    ownerId = session.user.id;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    original.authId = env.googleAuthClientId;
    original.authSecret = env.googleAuthClientSecret;
    original.webId = env.googleClientId;
    original.webSecret = env.googleClientSecret;
    (env as { googleAuthClientId: string }).googleAuthClientId =
      'desktop-client.apps.googleusercontent.com';
    (env as { googleAuthClientSecret: string }).googleAuthClientSecret =
      'desktop-secret';
    (env as { googleClientId: string }).googleClientId =
      'web-client.apps.googleusercontent.com';
    (env as { googleClientSecret: string }).googleClientSecret = 'web-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (env as { googleAuthClientId: string }).googleAuthClientId = original.authId;
    (env as { googleAuthClientSecret: string }).googleAuthClientSecret =
      original.authSecret;
    (env as { googleClientId: string }).googleClientId = original.webId;
    (env as { googleClientSecret: string }).googleClientSecret =
      original.webSecret;
  });

  // issue-c2 (the contract): refresh MUST present the desktop client that minted the token.
  it('refreshes with the desktop client_id/secret, not the web client', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-access',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await new GoogleOAuthService().refreshAccessToken(expiredAccount(ownerId));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = (init.body as URLSearchParams).toString();
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain(
      'client_id=desktop-client.apps.googleusercontent.com',
    );
    expect(body).toContain('client_secret=desktop-secret');
    // Guard against regression to the web client:
    expect(body).not.toContain('web-client.apps.googleusercontent.com');
    expect(body).not.toContain('web-secret');
  });

  it('preserves the existing refresh token when Google omits a new one', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'new-access', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const updated = await new GoogleOAuthService().refreshAccessToken(
      expiredAccount(ownerId),
    );
    expect(updated.refreshToken).toBe('refresh-abc');
    expect(updated.accessToken).toBe('new-access');
  });

  it('surfaces a Google unauthorized_client error as an AppError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        '{"error":"unauthorized_client","error_description":"Unauthorized"}',
        { status: 401 },
      ),
    );

    await expect(
      new GoogleOAuthService().refreshAccessToken(expiredAccount(ownerId)),
    ).rejects.toThrow(/Google token refresh failed/);
  });
});
