import { logger } from '../utils/logger';
import type { IntegrationAccount } from '../models/integration_account';
import { GEMINI_CLOUD_PLATFORM_SCOPE } from './google_oauth_service';
import { IntegrationsService } from './integrations_service';
import type { OpencodeClientService } from './opencode_client_service';

/**
 * Option C — bridge the user's Google OAuth token into opencode's provider
 * auth store so the `gemini-cli` agent (opencode provider `google`) can run
 * Gemini authenticated from the user's own Google account.
 *
 * opencode's google provider uses the generic google-auth-library OAuth flow
 * (scope `cloud-platform`) and CANNOT refresh a token minted by OUR OAuth
 * client. So, exactly like the Anthropic bridge (credentials_bridge_service.ts),
 * api_server keeps the bridged token fresh ITSELF via a 15-min refresh loop:
 * each tick re-runs `ensureFreshGoogleAccount` (which refreshes the stored
 * Google token with the client that minted it) and re-pushes the access token
 * into opencode. Without this loop opencode's stored token would silently go
 * stale (~1h Google access-token lifetime) and Gemini calls would 401.
 */

/** Reason a bridge attempt did not push credentials. */
export type GoogleBridgeReason =
  | 'sdk_not_ready'
  | 'not_connected'
  | 'missing_token'
  | 'missing_gemini_scope'
  | 'auth_set_rejected';

export type GoogleBridgeResult =
  | { success: true; provider: 'google' }
  | { success: false; reason: GoogleBridgeReason; message?: string };

/**
 * Injectable seam: the bridge only needs a fresh Google {@link IntegrationAccount}.
 * Production wires this to {@link IntegrationsService.ensureFreshGoogleAccount}.
 */
export interface GoogleAgentBridgeDeps {
  ensureFreshGoogleAccount(userId: number): Promise<IntegrationAccount>;
}

function defaultDeps(): GoogleAgentBridgeDeps {
  const integrations = new IntegrationsService();
  return {
    ensureFreshGoogleAccount: (userId) =>
      integrations.ensureFreshGoogleAccount(userId),
  };
}

export class GoogleAgentBridgeService {
  private readonly deps: GoogleAgentBridgeDeps;

  constructor(deps?: GoogleAgentBridgeDeps) {
    this.deps = deps ?? defaultDeps();
  }

  /**
   * Mirror the (refreshed) stored Google token into opencode's `google`
   * provider — but ONLY when the account carries the cloud-platform scope, so
   * we never push a token Gemini will reject. The `expires` UNIT is **ms-epoch**,
   * matching the Anthropic / GitHub-Copilot bridges (opencode's auth.json stores
   * `expires` as a ms-epoch number — see OpencodeClientService.restoreAuth).
   */
  async bridgeGoogle(
    userId: number,
    client: OpencodeClientService,
  ): Promise<GoogleBridgeResult> {
    if (!client.isReady) {
      return { success: false, reason: 'sdk_not_ready' };
    }

    let account: IntegrationAccount;
    try {
      account = await this.deps.ensureFreshGoogleAccount(userId);
    } catch {
      // ensureFreshGoogleAccount throws AppError(400) when Google is not
      // connected. Treat any failure to obtain an account as "not connected"
      // so boot/callback callers skip cleanly.
      return { success: false, reason: 'not_connected' };
    }

    if (!account.accessToken || !account.refreshToken) {
      return { success: false, reason: 'missing_token' };
    }

    // Guard: only bridge when the user actually granted the Gemini scope. The
    // step-up consent stores Google's granted scope string on the account; if
    // cloud-platform is absent, pushing the token would let opencode hand
    // Gemini a token it will reject — so we skip with a clear reason instead.
    if (!(account.scope ?? '').includes(GEMINI_CLOUD_PLATFORM_SCOPE)) {
      return { success: false, reason: 'missing_gemini_scope' };
    }

    // ms-epoch. IntegrationAccount.expiresAt is an ISO string; parse it. When
    // absent/unparseable, fall back to ~55 min out (Google access tokens last
    // ~1h) so opencode doesn't treat the token as already expired.
    const parsed = account.expiresAt ? Date.parse(account.expiresAt) : NaN;
    const expires = Number.isNaN(parsed) ? Date.now() + 55 * 60 * 1000 : parsed;

    const ok = await client.setOAuthCredentials('google', {
      access: account.accessToken,
      refresh: account.refreshToken,
      expires,
    });
    if (!ok) {
      return {
        success: false,
        reason: 'auth_set_rejected',
        message: 'opencode auth.set returned false for google',
      };
    }
    return { success: true, provider: 'google' };
  }

  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshUserId: number | null = null;

  /**
   * Tick faster than the ~1h Google access-token lifetime so opencode's stored
   * token never goes stale between ticks (opencode can't refresh it itself).
   * Mirrors CredentialsBridgeService.REFRESH_INTERVAL_MS.
   */
  static readonly REFRESH_INTERVAL_MS = 15 * 60 * 1000;

  /**
   * Idempotently start the background refresh loop for `userId`. No-op if a
   * loop is already running (the first successful bridge starts it). Each tick
   * re-runs {@link bridgeGoogle}, which refreshes the stored Google token and
   * re-pushes it to opencode.
   */
  startRefreshLoop(userId: number, client: OpencodeClientService): void {
    if (this.refreshTimer) return;
    this.refreshUserId = userId;
    this.refreshTimer = setInterval(() => {
      const id = this.refreshUserId;
      if (id == null) return;
      this.bridgeGoogle(id, client).catch((err) =>
        logger.error('[GoogleAgentBridge] background refresh failed:', err),
      );
    }, GoogleAgentBridgeService.REFRESH_INTERVAL_MS);
    if (typeof this.refreshTimer.unref === 'function') this.refreshTimer.unref();
  }

  stopRefreshLoop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshUserId = null;
  }
}
