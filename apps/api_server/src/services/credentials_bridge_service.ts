import { execSync } from 'child_process';
import { createHash } from 'crypto';
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

/**
 * #856 (reopened, second attempt) — fingerprint a Claude refresh token for
 * change detection.
 *
 * Never log or expose the raw refresh token: this returns a one-way SHA-256
 * hash so the poll below can detect "the refresh token changed" (a genuine
 * re-auth / account switch) without ever holding onto — or printing — the
 * secret itself.
 */
export function refreshTokenFingerprint(refresh: string): string {
  return createHash('sha256').update(refresh).digest('hex');
}

/**
 * Default poll interval for {@link CredentialsBridgeService.startKeychainPoll}.
 * Env-overridable via `CLAUDE_KEYCHAIN_POLL_MS` (e.g. for faster manual-smoke
 * verification of a live `claude` re-auth without waiting a full minute).
 * Falls back to the 60s default on a missing/non-numeric/non-positive value.
 */
function resolveKeychainPollMs(): number {
  const raw = process.env.CLAUDE_KEYCHAIN_POLL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 1000;
}
const DEFAULT_KEYCHAIN_POLL_MS = resolveKeychainPollMs();

/** Injectable seam for the keychain poll (real impl reads via `readClaudeCreds`). */
export interface KeychainPollDeps {
  /** Reads current creds; null on transient failure (keychain denied/missing). */
  readCreds: () => ClaudeCreds | null;
  /** Performs the forced re-bridge once a refresh-token change is detected. */
  bridge: (client: OpencodeClientService) => Promise<BridgeResult>;
  setInterval: (fn: () => void, ms: number) => { unref?: () => void } & object;
  clearInterval: (handle: unknown) => void;
}

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

  /// Bridge Claude Code's OAuth tokens into the opencode SDK.
  ///
  /// When [options.force] is true (the Settings "Reconnect" button), the
  /// in-memory cache is invalidated first so the keychain is re-read fresh
  /// rather than riding a possibly-stale cached token. This makes "Reconnect"
  /// actually re-sync from Claude Code's current state instead of no-opping on
  /// a cached token that hasn't hit the 60s expiry buffer yet (#658).
  async bridgeAnthropic(
    client: OpencodeClientService,
    options?: { force?: boolean },
  ): Promise<BridgeResult> {
    if (!client.isReady) {
      return { success: false, reason: 'sdk_not_ready' };
    }
    if (options?.force) {
      this.invalidateCache();
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
      // Keep the keychain-poll's change-detection baseline in sync with
      // whatever refresh token was JUST successfully bridged, regardless of
      // which caller triggered this bridge (launch-time, "Reconnect", the
      // #658 refresh loop, or the poll itself) — otherwise the poll could
      // immediately re-fire on its next tick for a token it didn't cause.
      this.lastBridgedRefreshFingerprint = refreshTokenFingerprint(creds.refresh);
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

  /// #658: tick faster than the ~hourly Claude token lifetime so opencode's
  /// stored token never goes stale between ticks. 15 min leaves a comfortable
  /// margin against a ~40-60 min expiry.
  static readonly REFRESH_INTERVAL_MS = 15 * 60 * 1000;

  /// Idempotently starts the background refresh loop. No-op if already running.
  ///
  /// #658: each tick FORCES a keychain re-read + re-bridge so we mirror Claude
  /// Code's CURRENT token into opencode. Without force the loop rode a cached
  /// snapshot that went stale once Claude Code rotated its (single-use) OAuth
  /// refresh token — leaving opencode with a dead token and surfacing
  /// "Claude Code credentials are unavailable or expired" at inference time.
  startRefreshLoop(client: OpencodeClientService): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      this.bridgeAnthropic(client, { force: true }).catch((err) =>
        logger.error('[CredentialsBridge] background refresh failed:', err),
      );
    }, CredentialsBridgeService.REFRESH_INTERVAL_MS);
    if (typeof this.refreshTimer.unref === 'function') this.refreshTimer.unref();
  }

  stopRefreshLoop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private keychainPollTimer: { unref?: () => void } | null = null;
  private lastBridgedRefreshFingerprint: string | null = null;

  /**
   * #856 (reopened, second attempt) — change-gated Keychain poll.
   *
   * File-watching `~/.claude/.credentials.json` (the original reopen fix)
   * does not work: the current `claude` CLI stores credentials in the macOS
   * Keychain ONLY — `claude logout`/`login` never rewrites that file, so the
   * watch essentially never fires on a real re-auth. The Keychain itself
   * cannot be `fs.watch`ed, so this polls it on an interval instead, but only
   * acts when the refresh-token FINGERPRINT actually changes (a genuine
   * re-auth / account switch) — an unchanged fingerprint is a no-op, so
   * steady-state polling does not churn `setOAuthCredentials` or Anthropic
   * refresh calls every tick.
   *
   * On a transient read failure (e.g. `keychain_denied` during the split
   * second of a logout→login transition), the already-bridged good token is
   * left untouched — we simply skip this tick and retry on the next one.
   *
   * Idempotent: a second call while already running is a no-op, mirroring
   * {@link startRefreshLoop}.
   */
  startKeychainPoll(
    client: OpencodeClientService,
    intervalMs: number = DEFAULT_KEYCHAIN_POLL_MS,
    deps?: Partial<KeychainPollDeps>,
  ): void {
    if (this.keychainPollTimer) return;

    const readCreds = deps?.readCreds ?? (() => this.readClaudeCreds());
    const bridge = deps?.bridge ?? ((c: OpencodeClientService) => this.bridgeAnthropic(c, { force: true }));
    const setIntervalFn: KeychainPollDeps['setInterval'] = deps?.setInterval ?? setInterval;
    const clearIntervalFn: KeychainPollDeps['clearInterval'] =
      deps?.clearInterval ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));

    const tick = async () => {
      let creds: ClaudeCreds | null;
      try {
        creds = readCreds();
      } catch (err) {
        logger.info(
          `[CredentialsBridge] keychain poll: transient read error (non-fatal): ${String(err)}`,
        );
        return;
      }
      if (!creds) {
        // Transient (keychain_denied/missing) — do not disturb the existing
        // bridged token; just retry next tick.
        logger.info(
          `[CredentialsBridge] keychain poll: no creds available this tick (${this.lastReadReason()}) — skipping`,
        );
        return;
      }
      const fingerprint = refreshTokenFingerprint(creds.refresh);
      if (fingerprint === this.lastBridgedRefreshFingerprint) {
        return; // No change — do nothing.
      }
      try {
        const result = await bridge(client);
        if (result.success) {
          this.lastBridgedRefreshFingerprint = fingerprint;
          logger.info('[CredentialsBridge] keychain poll: refresh token changed — re-bridged ok');
        } else {
          logger.info(
            `[CredentialsBridge] keychain poll: re-bridge after refresh-token change failed (${result.reason}) — will retry next tick`,
          );
        }
      } catch (err) {
        logger.warn(`[CredentialsBridge] keychain poll: bridge threw: ${String(err)}`);
      }
    };

    this.keychainPollTimer = setIntervalFn(() => {
      void tick();
    }, intervalMs);
    if (typeof this.keychainPollTimer?.unref === 'function') this.keychainPollTimer.unref();
    // Expose a stop handle bound to the injected clearInterval.
    this.stopKeychainPollFn = () => {
      if (this.keychainPollTimer) {
        clearIntervalFn(this.keychainPollTimer);
        this.keychainPollTimer = null;
      }
    };
  }

  private stopKeychainPollFn: (() => void) | null = null;

  stopKeychainPoll(): void {
    if (this.stopKeychainPollFn) {
      this.stopKeychainPollFn();
      this.stopKeychainPollFn = null;
    }
  }

  /** Test-only accessor for the last-bridged refresh fingerprint. */
  getLastBridgedRefreshFingerprint(): string | null {
    return this.lastBridgedRefreshFingerprint;
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
