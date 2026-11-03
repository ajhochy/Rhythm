import {
  AnthropicAccountsStore,
  AnthropicAccount,
  OAuthAccount,
  OAuthAccountsStore,
} from './anthropic_accounts_store';
import { logger } from '../utils/logger';

export const ANTHROPIC_TOKEN_ENDPOINT = 'https://claude.ai/v1/oauth/token';
export const CLAUDE_CODE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
/** Refresh anything expiring within 20 minutes (refresh loop runs every 15). */
const REFRESH_BUFFER_MS = 20 * 60 * 1000;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export interface RedactedAccount {
  id: string;
  label: string;
  status: string;
  subscriptionType?: string;
  expires: number;
}

export interface OAuthAccountsServiceOptions {
  tokenEndpoint: string;
  clientId: string;
  /** Log prefix, e.g. 'AnthropicAccounts'. */
  tag: string;
  /** Fallback when the token response omits expires_in. */
  defaultExpiresInSec: number;
}

export interface RefreshedTokens {
  access: string;
  refresh: string;
  expires: number;
  /** Raw token response, for provider-specific claims (e.g. OpenAI id_token). */
  raw: Record<string, unknown>;
}

/**
 * Provider-agnostic N-account OAuth service: redacted listing, default
 * selection, per-account refresh with needs_relogin on failure. Anthropic and
 * OpenAI (ChatGPT) accounts both run on this; subclasses add provider bits.
 */
export class OAuthAccountsService<A extends OAuthAccount = AnthropicAccount> {
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    protected readonly store: OAuthAccountsStore<A>,
    protected readonly fetchImpl: typeof fetch,
    protected readonly opts: OAuthAccountsServiceOptions,
  ) {}

  get storePath(): string {
    return this.store.path;
  }

  hasAccounts(): boolean {
    return this.store.read().accounts.length > 0;
  }

  listRedacted(): { accounts: Array<Omit<A, 'access' | 'refresh'>>; defaultAccountId: string | null } {
    const f = this.store.read();
    return {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      accounts: f.accounts.map(({ access, refresh, ...rest }) => rest),
      defaultAccountId: f.defaultAccountId,
    };
  }

  getAccount(id: string): A | undefined {
    return this.store.read().accounts.find((a) => a.id === id);
  }

  defaultAccount(): A | undefined {
    const f = this.store.read();
    return f.accounts.find((a) => a.id === f.defaultAccountId) ?? f.accounts[0];
  }

  upsertAccount(account: A): void {
    this.store.upsertAccount(account);
  }

  removeAccount(id: string): void {
    this.store.removeAccount(id);
  }

  setDefault(id: string): void {
    this.store.setDefault(id);
  }

  renameAccount(id: string, label: string): boolean {
    return this.store.rename(id, label);
  }

  setRouting(sdkSessionId: string, accountId: string, opts?: { pinned?: boolean }): void {
    this.store.setRouting(sdkSessionId, accountId, opts);
  }

  /** Hook: skip accounts some other component refreshes (see OpenAI). */
  protected shouldRefresh(_account: A): boolean {
    return true;
  }

  /** Hook: merge provider-specific fields from a refresh response. */
  protected applyRefresh(account: A, refreshed: RefreshedTokens): A {
    return { ...account, access: refreshed.access, refresh: refreshed.refresh, expires: refreshed.expires, status: 'ok' };
  }

  async refreshAll(): Promise<void> {
    for (const account of this.store.read().accounts) {
      if (account.status !== 'ok') continue;
      if (account.expires - Date.now() > REFRESH_BUFFER_MS) continue;
      if (!this.shouldRefresh(account)) continue;
      await this.refreshAccount(account);
    }
  }

  /** Refresh one account now; persists rotation or marks needs_relogin. */
  protected async refreshAccount(account: A): Promise<A | null> {
    const refreshed = await this.refreshTokens(account.refresh);
    if (refreshed) {
      const next = this.applyRefresh(account, refreshed);
      this.store.upsertAccount(next);
      logger.info(`[${this.opts.tag}] refreshed tokens for account ${account.id}`);
      return next;
    }
    this.store.setStatus(account.id, 'needs_relogin');
    logger.error(`[${this.opts.tag}] refresh failed for account ${account.id} — marked needs_relogin`);
    return null;
  }

  startRefreshLoop(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      this.refreshAll().catch((err) => logger.error(`[${this.opts.tag}] refresh loop failed:`, err));
    }, REFRESH_INTERVAL_MS);
    if (typeof this.refreshTimer.unref === 'function') this.refreshTimer.unref();
  }

  stopRefreshLoop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private async refreshTokens(refreshToken: string): Promise<RefreshedTokens | null> {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.opts.clientId,
      });
      const res = await this.fetchImpl(this.opts.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        logger.error(`[${this.opts.tag}] refresh failed: ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
      return {
        access: json.access_token,
        // Some issuers omit refresh_token when it does not rotate.
        refresh: json.refresh_token ?? refreshToken,
        expires: Date.now() + (json.expires_in ?? this.opts.defaultExpiresInSec) * 1000,
        raw: json as unknown as Record<string, unknown>,
      };
    } catch (err) {
      logger.error(`[${this.opts.tag}] refresh threw:`, err);
      return null;
    }
  }
}

export class AnthropicAccountsService extends OAuthAccountsService<AnthropicAccount> {
  constructor(store: AnthropicAccountsStore, fetchImpl: typeof fetch = fetch) {
    super(store, fetchImpl, {
      tokenEndpoint: ANTHROPIC_TOKEN_ENDPOINT,
      clientId: CLAUDE_CODE_OAUTH_CLIENT_ID,
      tag: 'AnthropicAccounts',
      defaultExpiresInSec: 36_000,
    });
  }

  /** Import Claude Code creds as account #1 exactly once (empty store only). */
  migrateFromClaudeCode(creds: { access: string; refresh: string; expires: number; subscriptionType?: string }): boolean {
    if (this.hasAccounts()) return false;
    this.store.upsertAccount({
      id: 'default',
      label: 'Default (from Claude Code)',
      access: creds.access,
      refresh: creds.refresh,
      expires: creds.expires,
      status: 'ok',
      subscriptionType: creds.subscriptionType,
    });
    logger.info('[AnthropicAccounts] migrated Claude Code credentials into account store');
    return true;
  }
}

/** Singleton, mirroring opencode_engine.ts style. */
export const anthropicAccountsService = new AnthropicAccountsService(new AnthropicAccountsStore());
