import { AppError } from '../errors/app_error';
import { env } from '../config/env';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';

const PCO_AUTH_BASE = 'https://api.planningcenteronline.com/oauth/authorize';
const PCO_TOKEN_URL = 'https://api.planningcenteronline.com/oauth/token';
const PCO_USERINFO_URL = 'https://api.planningcenteronline.com/oauth/userinfo';

interface PlanningCenterTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface PlanningCenterUserInfo {
  sub: string;
  email?: string;
  name?: string;
}

export class PlanningCenterOAuthService {
  private readonly accountsRepo = new IntegrationAccountsRepository();

  getAuthorizationUrl(): string {
    this.assertConfigured();

    const params = new URLSearchParams({
      client_id: env.pcoApplicationId,
      redirect_uri: env.pcoRedirectUri,
      response_type: 'code',
      scope: env.pcoScopes,
    });

    return `${PCO_AUTH_BASE}?${params.toString()}`;
  }

  async handleCallback(code: string): Promise<void> {
    this.assertConfigured();

    const tokens = await this.exchangeCode(code);
    const profile = await this.fetchUserInfo(tokens.access_token);
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    this.accountsRepo.upsertPlanningCenterAccount({
      externalAccountId: profile.sub,
      email: profile.email ?? null,
      displayName: profile.name ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      scope: tokens.scope ?? env.pcoScopes,
      tokenType: tokens.token_type ?? null,
      expiresAt,
    });
  }

  private assertConfigured(): void {
    if (!env.pcoApplicationId || !env.pcoSecret || !env.pcoRedirectUri) {
      throw AppError.badRequest(
        'Planning Center OAuth is not configured. Set PCO_APPLICATION_ID, PCO_SECRET, and PCO_REDIRECT_URI.',
      );
    }
  }

  private async exchangeCode(
    code: string,
  ): Promise<PlanningCenterTokenResponse> {
    const response = await fetch(PCO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.pcoApplicationId,
        client_secret: env.pcoSecret,
        redirect_uri: env.pcoRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Planning Center token exchange failed: ${text}`);
    }

    return (await response.json()) as PlanningCenterTokenResponse;
  }

  private async fetchUserInfo(accessToken: string): Promise<PlanningCenterUserInfo> {
    const response = await fetch(PCO_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw AppError.badRequest(`Planning Center user info lookup failed: ${text}`);
    }

    return (await response.json()) as PlanningCenterUserInfo;
  }
}
