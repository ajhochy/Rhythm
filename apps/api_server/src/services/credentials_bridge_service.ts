import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';
import type { OpencodeClientService } from './opencode_client_service';

const ANTHROPIC_TOKEN_ENDPOINT = 'https://claude.ai/v1/oauth/token';
const CLAUDE_CODE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export type ClaudeCreds = {
  access: string;
  refresh: string;
  expires: number; // ms epoch
  subscriptionType?: string;
};

export type ReadReason =
  | 'ok'
  | 'keychain_denied'
  | 'missing'
  | 'parse_error'
  | 'not_attempted';

export type BridgeReason =
  | 'keychain_denied'
  | 'missing'
  | 'parse_error'
  | 'refresh_failed'
  | 'auth_set_rejected'
  | 'sdk_not_ready';

export type BridgeResult =
  | { success: true; provider: 'anthropic'; subscriptionType?: string }
  | { success: false; reason: BridgeReason; message?: string };

const KEYCHAIN_REFRESH_BUFFER_MS = 60 * 1000;

export class CredentialsBridgeService {
  private cached: ClaudeCreds | null = null;
  private cachedAt = 0;
  private lastReason: ReadReason = 'not_attempted';

  /** Returns parsed Claude creds or null. Caches until `expires - 60s`. */
  readClaudeCreds(): ClaudeCreds | null {
    const now = Date.now();
    if (this.cached && this.cached.expires - now > KEYCHAIN_REFRESH_BUFFER_MS) {
      return this.cached;
    }
    const fresh = this.loadFromKeychain() ?? this.loadFromFile();
    if (fresh) {
      this.cached = fresh;
      this.cachedAt = now;
      this.lastReason = 'ok';
    } else {
      this.cached = null;
    }
    return this.cached;
  }

  hasClaudeCode(): boolean {
    return this.readClaudeCreds() !== null;
  }

  invalidateCache(): void {
    this.cached = null;
    this.cachedAt = 0;
    this.lastReason = 'not_attempted';
  }

  lastReadReason(): ReadReason {
    return this.lastReason;
  }

  async bridgeAnthropic(client: OpencodeClientService): Promise<BridgeResult> {
    if (!client.isReady) {
      return { success: false, reason: 'sdk_not_ready' };
    }
    let creds = this.readClaudeCreds();
    if (!creds) {
      return { success: false, reason: this.mapReadReason() };
    }
    // Refresh if cached tokens are within the expiry buffer.
    if (creds.expires - Date.now() <= KEYCHAIN_REFRESH_BUFFER_MS) {
      this.invalidateCache();
      creds = this.readClaudeCreds();
      if (creds && creds.expires - Date.now() > KEYCHAIN_REFRESH_BUFFER_MS) {
        // Keychain had fresher tokens than we did. Ride along.
      } else if (creds) {
        // Both stale. Call Anthropic refresh ourselves.
        const refreshed = await this.refreshAnthropicTokens(creds.refresh);
        if (!refreshed) {
          return { success: false, reason: 'refresh_failed' };
        }
        creds = refreshed;
        // Store in cache, but NOT in the keychain (single-use refresh tokens).
        this.cached = creds;
        this.cachedAt = Date.now();
        this.lastReason = 'ok';
      } else {
        return { success: false, reason: this.mapReadReason() };
      }
    }
    const ok = await client.setOAuthCredentials('anthropic', {
      access: creds.access,
      refresh: creds.refresh,
      expires: creds.expires,
    });
    if (ok) {
      this.startRefreshLoop(client);
      return {
        success: true,
        provider: 'anthropic',
        subscriptionType: creds.subscriptionType,
      };
    }
    this.invalidateCache();
    return {
      success: false,
      reason: 'auth_set_rejected',
      message: 'SDK auth.set returned false',
    };
  }

  private refreshTimer: NodeJS.Timeout | null = null;

  /** Idempotently starts a 30-min refresh loop. No-op if already running. */
  startRefreshLoop(client: OpencodeClientService): void {
    if (this.refreshTimer) return;
    const intervalMs = 30 * 60 * 1000;
    this.refreshTimer = setInterval(() => {
      this.bridgeAnthropic(client).catch((err) =>
        logger.error('[CredentialsBridge] background refresh failed:', err),
      );
    }, intervalMs);
    if (typeof this.refreshTimer.unref === 'function') this.refreshTimer.unref();
  }

  stopRefreshLoop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Narrows lastReason to the subset that the bridge can surface. */
  private mapReadReason(): BridgeReason {
    switch (this.lastReason) {
      case 'keychain_denied':
      case 'missing':
      case 'parse_error':
        return this.lastReason;
      default:
        return 'keychain_denied';
    }
  }

  private loadFromKeychain(): ClaudeCreds | null {
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w',
        { stdio: ['ignore', 'pipe', 'ignore'] },
      ).toString().trim();
      return this.parse(raw);
    } catch {
      this.lastReason = 'keychain_denied';
      return null;
    }
  }

  private loadFromFile(): ClaudeCreds | null {
    const path = join(homedir(), '.claude', '.credentials.json');
    if (!existsSync(path)) {
      if (this.lastReason === 'not_attempted') this.lastReason = 'missing';
      return null;
    }
    try {
      return this.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      this.lastReason = 'parse_error';
      logger.error('[CredentialsBridge] file parse failed:', err);
      return null;
    }
  }

  private parse(raw: string): ClaudeCreds | null {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const oauth = (obj.claudeAiOauth ?? obj) as Record<string, unknown>;
      const access = (oauth.accessToken ?? oauth.access_token ?? oauth.access) as string | undefined;
      const refresh = (oauth.refreshToken ?? oauth.refresh_token ?? oauth.refresh) as string | undefined;
      const expiresRaw = (oauth.expiresAt ?? oauth.expires_at ?? oauth.expires ?? 0) as number;
      const expires = expiresRaw > 1e12 ? expiresRaw : expiresRaw * 1000;
      if (!access || !refresh || !expires) {
        this.lastReason = 'parse_error';
        return null;
      }
      return { access, refresh, expires, subscriptionType: oauth.subscriptionType as string | undefined };
    } catch (err) {
      this.lastReason = 'parse_error';
      logger.error('[CredentialsBridge] JSON parse failed:', err);
      return null;
    }
  }

  private async refreshAnthropicTokens(refreshToken: string): Promise<ClaudeCreds | null> {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
      });
      const res = await fetch(ANTHROPIC_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        logger.error(`[CredentialsBridge] refresh failed: ${res.status}`);
        return null;
      }
      const json = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      return {
        access: json.access_token,
        refresh: json.refresh_token,
        expires: Date.now() + (json.expires_in ?? 36_000) * 1000,
        subscriptionType: this.cached?.subscriptionType,
      };
    } catch (err) {
      logger.error('[CredentialsBridge] refresh threw:', err);
      return null;
    }
  }
}
