import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { env } from '../config/env';
import { GoogleOAuthService } from '../services/google_oauth_service';
import { AuthService } from '../services/auth_service';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { UsersRepository } from '../repositories/users_repository';
import { IntegrationsService } from '../services/integrations_service';

// Keep the HTTP client outside vi.stubGlobal('fetch'), which fakes only Google.
const loopbackFetch = globalThis.fetch;

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
  let originalWebClientId: string;
  let originalWebClientSecret: string;
  let originalRedirectUri: string;

  beforeEach(() => {
    setDb(makeDb());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    originalClientId = env.googleAuthClientId;
    originalClientSecret = env.googleAuthClientSecret;
    originalWebClientId = env.googleClientId;
    originalWebClientSecret = env.googleClientSecret;
    originalRedirectUri = env.googleRedirectUri;
    (env as { googleAuthClientId: string }).googleAuthClientId =
      'desktop-client.apps.googleusercontent.com';
    (env as { googleAuthClientSecret: string }).googleAuthClientSecret =
      'desktop-client-secret';
    (env as { googleClientId: string }).googleClientId = 'web-client';
    (env as { googleClientSecret: string }).googleClientSecret = 'web-secret';
    (env as { googleRedirectUri: string }).googleRedirectUri = 'http://127.0.0.1:1/callback';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (env as { googleAuthClientId: string }).googleAuthClientId = originalClientId;
    (env as { googleAuthClientSecret: string }).googleAuthClientSecret = originalClientSecret;
    (env as { googleClientId: string }).googleClientId = originalWebClientId;
    (env as { googleClientSecret: string }).googleClientSecret = originalWebClientSecret;
    (env as { googleRedirectUri: string }).googleRedirectUri = originalRedirectUri;
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
    expect(gmail?.accessToken).toBe('access-456');
    expect(cal?.refreshToken).toBe('refresh-456');
    expect(session.user.photoUrl).toBe('https://example.com/alice.png');
  });

  const calendar = 'https://www.googleapis.com/auth/calendar.readonly';
  const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';
  const profile = { sub: 'google-sub-alice', email: 'alice@example.com', name: 'Alice' };
  const grant = (scope?: string, refresh_token?: string) => ({
    access_token: 'new-access', scope, refresh_token, token_type: 'Bearer', expires_in: 3600,
  });

  function owners() {
    const users = new UsersRepository();
    return {
      alice: users.create({ name: 'Alice', email: 'alice@example.com' }).id,
      bob: users.create({ name: 'Bob', email: 'bob@example.com' }).id,
    };
  }

  async function seededAccounts(ownerId: number) {
    const accounts = new IntegrationAccountsRepository();
    await accounts.upsertGoogleAccountAsync({
      ownerId, externalAccountId: profile.sub, email: profile.email,
      displayName: profile.name, accessToken: 'old-access', refreshToken: 'old-refresh',
      scope: `openid ${calendar} ${gmailScope}`, tokenType: 'Bearer', expiresAt: '2020-01-01T00:00:00.000Z',
    });
    return accounts;
  }

  it('issue-1547-c1: missing refresh token cannot erase persisted Calendar or Gmail refresh credentials', async () => {
    owners();
    const accounts = await seededAccounts(1);
    const before = await Promise.all((['google_calendar', 'gmail'] as const).map(p => accounts.findByProviderAsync(p, 1)));
    expect(before[0]?.expiresAt).toBe('2020-01-01T00:00:00.000Z');
    await new GoogleOAuthService().storeDesktopIntegration(1, grant('openid email'), profile);
    for (const [index, provider] of (['google_calendar', 'gmail'] as const).entries()) {
      const stored = await accounts.findByProviderAsync(provider, 1);
      expect(stored).toEqual(before[index]); // Regression: a narrow access token paired with old refresh/scope.
    }
  });

  it('issue-1547-c2: narrower identity-only scope cannot remove Calendar or Gmail grants', async () => {
    owners();
    const accounts = await seededAccounts(1);
    const before = await Promise.all((['google_calendar', 'gmail'] as const).map(p => accounts.findByProviderAsync(p, 1)));
    await new GoogleOAuthService().storeDesktopIntegration(1, grant('email openid profile', 'replacement-refresh'), profile);
    for (const [index, provider] of (['google_calendar', 'gmail'] as const).entries()) {
      const stored = await accounts.findByProviderAsync(provider, 1);
      expect(stored).toEqual(before[index]); // A fresh narrow refresh token cannot represent retained scopes.
    }
  });

  it('issue-1547-c2: missing scope cannot manufacture an ungranted Calendar permission', async () => {
    owners();
    const accounts = new IntegrationAccountsRepository();
    await new GoogleOAuthService().storeDesktopIntegration(1, grant(undefined, 'identity-refresh'), profile);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      expect((await accounts.findByProviderAsync(provider, 1))?.scope).toBeNull();
    }
  });

  it('issue-1547-c2: distinct prior provider grants merge separately without cross-contaminating tokens', async () => {
    owners();
    const accounts = await seededAccounts(1);
    getDb().prepare('UPDATE integration_accounts SET scope = ?, refresh_token = ? WHERE owner_id = 1 AND provider = ?')
      .run(`openid ${calendar}`, 'calendar-refresh', 'google_calendar');
    getDb().prepare('UPDATE integration_accounts SET scope = ?, refresh_token = ? WHERE owner_id = 1 AND provider = ?')
      .run(`openid ${gmailScope}`, 'gmail-refresh', 'gmail');
    expect((await accounts.findByProviderAsync('google_calendar', 1))?.refreshToken).toBe('calendar-refresh');
    expect((await accounts.findByProviderAsync('gmail', 1))?.refreshToken).toBe('gmail-refresh');
    await new GoogleOAuthService().storeDesktopIntegration(1, grant('email'), profile);
    expect((await accounts.findByProviderAsync('google_calendar', 1))?.scope).toBe(`openid ${calendar}`);
    expect((await accounts.findByProviderAsync('gmail', 1))?.scope).toBe(`openid ${gmailScope}`);
    expect((await accounts.findByProviderAsync('google_calendar', 1))?.refreshToken).toBe('calendar-refresh');
    expect((await accounts.findByProviderAsync('gmail', 1))?.refreshToken).toBe('gmail-refresh');
  });

  it('issue-1547-c3: wider scope and a new refresh credential persist for both providers', async () => {
    owners();
    const accounts = await seededAccounts(1);
    const wider = 'https://www.googleapis.com/auth/gmail.send';
    const started = Date.now();
    await new GoogleOAuthService().storeDesktopIntegration(1, grant(`openid ${calendar} ${gmailScope} ${wider}`, 'new-refresh'), profile);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      const stored = await accounts.findByProviderAsync(provider, 1);
      expect(stored?.scope?.split(' ')).toEqual([calendar, gmailScope, 'openid', wider].sort());
      expect(stored?.refreshToken).toBe('new-refresh');
      expect(stored?.accessToken).toBe('new-access');
      expect(Date.parse(stored?.expiresAt ?? '')).toBeGreaterThanOrEqual(started + 3600_000);
      expect(Date.parse(stored?.expiresAt ?? '')).toBeLessThanOrEqual(Date.now() + 3600_000);
    }
  });

  it('issue-1547-c3: covering same-identity grant without refresh retains old refresh and uses incoming access and scope', async () => {
    owners();
    const accounts = await seededAccounts(1);
    await new GoogleOAuthService().storeDesktopIntegration(1, grant(`openid ${calendar} ${gmailScope} email`), profile);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      expect(await accounts.findByProviderAsync(provider, 1)).toMatchObject({
        accessToken: 'new-access', refreshToken: 'old-refresh',
        scope: [calendar, gmailScope, 'email', 'openid'].sort().join(' '),
      });
    }
  });

  it('issue-1547-c4: first grant inserts both providers with its new scope and refresh token', async () => {
    owners();
    const accounts = new IntegrationAccountsRepository();
    await new GoogleOAuthService().storeDesktopIntegration(1, grant(`openid ${calendar}`, 'first-refresh'), profile);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      const stored = await accounts.findByProviderAsync(provider, 1);
      expect(stored?.scope).toBe(`${calendar} openid`);
      expect(stored?.refreshToken).toBe('first-refresh');
      expect(stored?.externalAccountId).toBe(profile.sub);
    }
  });

  it('issue-1547-c5: duplicate and reordered grants normalize to the same stable scope string', async () => {
    owners();
    const accounts = new IntegrationAccountsRepository();
    const oauth = new GoogleOAuthService();
    await oauth.storeDesktopIntegration(1, grant(`  openid   ${calendar} openid  email `), profile);
    const first = (await accounts.findByProviderAsync('google_calendar', 1))?.scope;
    await oauth.storeDesktopIntegration(1, grant(`email ${calendar} openid email`), profile);
    expect((await accounts.findByProviderAsync('google_calendar', 1))?.scope).toBe(first);
    expect(first).toBe([calendar, 'email', 'openid'].sort().join(' '));
    expect((await accounts.findByProviderAsync('gmail', 1))?.scope).toBe(first);
  });

  it('issue-1547-c6: a different owner never contributes scope or refresh token to this account', async () => {
    owners();
    const accounts = await seededAccounts(1);
    const other = { sub: 'google-sub-bob', email: 'bob@example.com', name: 'Bob' };
    await new GoogleOAuthService().storeDesktopIntegration(2, grant('openid', 'bob-refresh'), other);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      const alice = await accounts.findByProviderAsync(provider, 1);
      const bob = await accounts.findByProviderAsync(provider, 2);
      expect(alice?.refreshToken).toBe('old-refresh');
      expect(alice?.scope).toBe(`openid ${calendar} ${gmailScope}`);
      expect(alice?.externalAccountId).toBe(profile.sub);
      expect(bob?.scope).toBe('openid');
      expect(bob?.refreshToken).toBe('bob-refresh');
      expect(bob?.externalAccountId).toBe(other.sub);
      expect(bob?.ownerId).toBe(2);
    }
  });

  it('issue-1547-c6: switching Google profiles for one owner cannot inherit the prior identity grants', async () => {
    owners();
    const accounts = await seededAccounts(1);
    const other = { sub: 'google-sub-bob', email: 'bob@example.com', name: 'Bob' };
    const prior = await accounts.findByProviderAsync('google_calendar', 1);
    await new GoogleOAuthService().storeDesktopIntegration(1, grant('openid'), other);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      const stored = await accounts.findByProviderAsync(provider, 1);
      expect(stored?.externalAccountId).toBe(prior?.externalAccountId);
      expect(stored?.email).toBe(prior?.email);
      expect(stored?.scope).toBe(prior?.scope);
      expect(stored?.refreshToken).toBe(prior?.refreshToken);
      expect(stored?.accessToken).toBe(prior?.accessToken);
    }
    await new GoogleOAuthService().storeDesktopIntegration(1, grant(`openid ${calendar} ${gmailScope}`, 'bob-refresh'), other);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      const stored = await accounts.findByProviderAsync(provider, 1);
      expect(stored?.externalAccountId).toBe(other.sub);
      expect(stored?.email).toBe(other.email);
      expect(stored?.scope).toBe([calendar, gmailScope, 'openid'].sort().join(' '));
      expect(stored?.refreshToken).toBe('bob-refresh');
      expect(stored?.accessToken).toBe('new-access');
      expect(Date.parse(stored?.expiresAt ?? '')).toBeGreaterThan(Date.now());
    }
    await new GoogleOAuthService().storeDesktopIntegration(1, grant(`openid ${calendar} ${gmailScope} email`), profile);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      expect(await accounts.findByProviderAsync(provider, 1)).toMatchObject({
        externalAccountId: profile.sub, accessToken: 'new-access', refreshToken: null,
        scope: [calendar, gmailScope, 'email', 'openid'].sort().join(' '),
      }); // A covering identity switch without refresh must never borrow Bob's token.
    }
  });

  it('issue-1547-c2: error-status narrow grant recovers with exactly the incoming credentials and expiry', async () => {
    const { alice } = owners();
    const accounts = await seededAccounts(alice);
    for (const provider of ['google_calendar', 'gmail'] as const) await accounts.markErrorAsync(provider, alice, 'expired grant');
    const started = Date.now();
    await new GoogleOAuthService().storeDesktopIntegration(alice, grant('openid', 'recovered-refresh'), profile);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      const row = await accounts.findByProviderAsync(provider, alice);
      expect(row).toMatchObject({ status: 'connected', errorMessage: null, accessToken: 'new-access',
        refreshToken: 'recovered-refresh', scope: 'openid', externalAccountId: profile.sub });
      expect(Date.parse(row?.expiresAt ?? '')).toBeGreaterThanOrEqual(started + 3600_000);
      expect(Date.parse(row?.expiresAt ?? '')).toBeLessThanOrEqual(Date.now() + 3600_000);
    }
  });

  it('issue-1547-c2: HTTP desktop exchange leaves narrow credentials intact and refreshes Calendar with old grant', async () => {
    const { alice } = owners();
    const accounts = await seededAccounts(alice);
    const before = await accounts.findByProviderAsync('google_calendar', alice);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(grant('openid email')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(profile), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'refreshed-calendar', expires_in: 3600 }), { status: 200 }));
    const server = createApp().listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected loopback TCP port');
      const response = await loopbackFetch(`http://127.0.0.1:${address.port}/auth/google/desktop-exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'narrow-code', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:1/callback',
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { sessionToken?: string; user?: { id?: number; email?: string }; [key: string]: unknown };
      expect(Object.keys(body).sort()).toEqual(['sessionToken', 'user']);
      expect(typeof body.sessionToken).toBe('string');
      expect(body.sessionToken?.length).toBeGreaterThan(0);
      expect(body.user?.id).toBe(alice);
      expect(body.user?.email).toBe(profile.email);
      expect((await new AuthService().getUserForSessionToken(body.sessionToken!))?.id).toBe(alice);
      const publicJson = JSON.stringify(body);
      for (const secret of ['old-access', 'old-refresh', 'new-access', 'desktop-client-secret']) {
        expect(publicJson).not.toContain(secret);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    expect((await accounts.findByProviderAsync('google_calendar', alice))).toEqual(before);
    expect((await accounts.findByProviderAsync('gmail', alice))?.accessToken).toBe('old-access');
    const refreshed = await new IntegrationsService().ensureFreshGoogleAccount(alice);
    expect((fetchMock.mock.calls[2][1].body as URLSearchParams).get('refresh_token')).toBe('old-refresh');
    expect(refreshed.accessToken).toBe('refreshed-calendar');
    expect(refreshed.scope).toContain(calendar);
    expect(refreshed.refreshToken).toBe('old-refresh');
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
