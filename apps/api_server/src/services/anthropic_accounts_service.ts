import { AnthropicAccountsStore, AnthropicAccount } from './anthropic_accounts_store';
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

export class AnthropicAccountsService {
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: AnthropicAccountsStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get storePath(): string {
    return this.store.path;
  }

  hasAccounts(): boolean {
    return this.store.read().accounts.length > 0;
  }

  listRedacted(): { accounts: RedactedAccount[]; defaultAccountId: string | null } {
    const f = this.store.read();
    return {
      accounts: f.accounts.map(({ id, label, status, subscriptionType, expires }) => ({
        id,
        label,
        status,
        subscriptionType,
        expires,
      })),
      defaultAccountId: f.defaultAccountId,
    };
  }

  getAccount(id: string): AnthropicAccount | undefined {
    return this.store.read().accounts.find((a) => a.id === id);
  }

  defaultAccount(): AnthropicAccount | undefined {
    const f = this.store.read();
    return f.accounts.find((a) => a.id === f.defaultAccountId) ?? f.accounts[0];
  }

  upsertAccount(account: AnthropicAccount): void {
    this.store.upsertAccount(account);
  }

  removeAccount(id: string): void {
    this.store.removeAccount(id);
  }

  setDefault(id: string): void {
    this.store.setDefault(id);
  }

  setRouting(sdkSessionId: string, accountId: string): void {
    this.store.setRouting(sdkSessionId, accountId);
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

  async refreshAll(): Promise<void> {
    for (const account of this.store.read().accounts) {
      if (account.status !== 'ok') continue;
      if (account.expires - Date.now() > REFRESH_BUFFER_MS) continue;
      const refreshed = await this.refreshTokens(account.refresh);
      if (refreshed) {
        this.store.upsertAccount({ ...account, ...refreshed, status: 'ok' });
        logger.info(`[AnthropicAccounts] refreshed tokens for account ${account.id}`);
      } else {
        this.store.setStatus(account.id, 'needs_relogin');
        logger.error(`[AnthropicAccounts] refresh failed for account ${account.id} — marked needs_relogin`);
      }
    }
  }

  startRefreshLoop(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      this.refreshAll().catch((err) => logger.error('[AnthropicAccounts] refresh loop failed:', err));
    }, REFRESH_INTERVAL_MS);
    if (typeof this.refreshTimer.unref === 'function') this.refreshTimer.unref();
  }

  stopRefreshLoop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private async refreshTokens(refreshToken: string): Promise<{ access: string; refresh: string; expires: number } | null> {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
      });
      const res = await this.fetchImpl(ANTHROPIC_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        logger.error(`[AnthropicAccounts] refresh failed: ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
      return {
        access: json.access_token,
        refresh: json.refresh_token,
        expires: Date.now() + (json.expires_in ?? 36_000) * 1000,
      };
    } catch (err) {
      logger.error('[AnthropicAccounts] refresh threw:', err);
      return null;
    }
  }
}

/** Singleton, mirroring opencode_engine.ts style. */
export const anthropicAccountsService = new AnthropicAccountsService(new AnthropicAccountsStore());
