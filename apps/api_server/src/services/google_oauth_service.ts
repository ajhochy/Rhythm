import { AppError } from '../errors/app_error';
import { env } from '../config/env';
import type { IntegrationAccount } from '../models/integration_account';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.metadata',
];

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  name?: string;
}

export class GoogleOAuthService {
  private readonly accountsRepo = new IntegrationAccountsRepository();

  getAuthorizationUrl(options: {
    sessionToken: string;
    loginHint?: string | null;
    forceConsent?: boolean;
  }): string {
    this.assertConfigured();

    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleRedirectUri,
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      scope: GOOGLE_SCOPES.join(' '),
      state: options.sessionToken,
      ...(options.loginHint ? { login_hint: options.loginHint } : {}),
      ...(options.forceConsent ? { prompt: 'consent' } : {}),
    });

    return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
  }

  async handleCallback(code: string, ownerId: number): Promise<void> {
    this.assertConfigured();

    const tokens = await this.exchangeCode(code);
    const profile = await this.fetchUserInfo(tokens.access_token);
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    await this.accountsRepo.upsertGoogleAccountAsync({
      ownerId,
      externalAccountId: profile.sub,
      email: profile.email ?? null,
      displayName: profile.name ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      scope: tokens.scope ?? GOOGLE_SCOPES.join(' '),
      tokenType: tokens.token_type ?? null,
      expiresAt,
    });
  }

  async refreshAccessToken(account: IntegrationAccount): Promise<IntegrationAccount> {
    this.assertConfigured();
    if (!account.refreshToken) {
      throw AppError.badRequest(
        'Google reconnect required: no refresh token is stored.',
      );
    }

    const tokens = await this.refreshTokens(account.refreshToken);
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : account.expiresAt;

    await this.accountsRepo.upsertGoogleAccountAsync({
      ownerId: account.ownerId!,
      externalAccountId: account.externalAccountId,
      email: account.email,
      displayName: account.displayName,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? account.refreshToken,
      scope: tokens.scope ?? account.scope,
      tokenType: tokens.token_type ?? account.tokenType,
      expiresAt,
    });

    return (await this.accountsRepo.findByProviderAsync(
      account.provider,
      account.ownerId ?? undefined,
    )) ?? account;
  }

  private assertConfigured(): void {
    if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
      throw AppError.badRequest(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.',
      );
    }
  }

  private async exchangeCode(code: string): Promise<GoogleTokenResponse> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: env.googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Google token exchange failed: ${text}`);
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  private async refreshTokens(refreshToken: string): Promise<GoogleTokenResponse> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Google token refresh failed: ${text}`);
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Google user info lookup failed: ${text}`);
    }

    return (await response.json()) as GoogleUserInfo;
  }
}
