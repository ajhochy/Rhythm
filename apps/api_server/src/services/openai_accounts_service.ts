import { randomBytes, createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { OAuthAccount, OAuthAccountsStore } from './anthropic_accounts_store';
import { OAuthAccountsService, RefreshedTokens } from './anthropic_accounts_service';
import { logger } from '../utils/logger';

/**
 * Multi-account OpenAI (ChatGPT / Codex OAuth) — the OpenAI sibling of the
 * dual-Anthropic-accounts store, built on the same OAuthAccountsStore/Service.
 *
 * Same model as Anthropic: the engine's codex plugin
 * (apps/opencode_fork/packages/opencode/src/plugin/codex.ts +
 * codex-accounts.ts) reads THIS file per request and picks the account by
 * session routing (sdkSessionId → accountId; written from the session's
 * openaiAccountId, which folds in the profile default) → defaultAccountId,
 * and fails over to another `ok` account on 429 (reported to
 * POST /opencode/spillover with providerID 'openai').
 *
 * Refresh ownership (OpenAI refresh tokens rotate and are single-use): this
 * service refreshes EVERY account; the plugin is read-only while the file
 * has accounts. auth.json only needs *an* openai oauth entry so the engine
 * loads the codex loader at all — it is seeded once (first account) and never
 * rewritten on a switch/refresh, so the auth.json watcher never bounces the
 * engine. With the file absent the plugin keeps its legacy auth.json path.
 *
 * NOTE: requires an engine built with the codex-accounts plugin change. An
 * older engine would keep using (and refreshing) the seeded auth.json token.
 */

export const OPENAI_ISSUER = 'https://auth.openai.com';
export const OPENAI_TOKEN_ENDPOINT = `${OPENAI_ISSUER}/oauth/token`;
/** Codex CLI public client id — same one the engine's codex plugin uses. */
export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
/** The only redirect registered for the Codex client. Nothing needs to listen:
 *  the user pastes the (failed-to-load) callback URL back into Rhythm. */
export const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPES = 'openid profile email offline_access';

export interface OpenAIAccount extends OAuthAccount {
  /** ChatGPT workspace id → ChatGPT-Account-Id header. */
  chatgptAccountId?: string;
  email?: string;
}

export interface OpenAIEngine {
  readonly isReady: boolean;
  setOAuthCredentials(
    providerId: string,
    creds: { access: string; refresh: string; expires: number; accountId?: string },
  ): Promise<boolean>;
  removeAuth(providerId: string): Promise<boolean>;
}

interface EngineCred {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export function defaultOpenAIAccountsFilePath(): string {
  return (
    process.env.RHYTHM_OPENAI_ACCOUNTS_FILE ??
    join(homedir(), 'Library', 'Application Support', 'Rhythm', 'openai-accounts.json')
  );
}

function defaultEngineAuthPath(): string {
  return join(homedir(), '.local', 'share', 'opencode', 'auth.json');
}

type Claims = Record<string, unknown> & {
  chatgpt_account_id?: string;
  email?: string;
  organizations?: Array<{ id: string }>;
  'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
  'https://api.openai.com/profile'?: { email?: string };
};

function parseJwt(token: unknown): Claims | undefined {
  if (typeof token !== 'string') return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Claims;
  } catch {
    return undefined;
  }
}

/** Same claim precedence as the engine's extractAccountId, plus email. */
export function identityFromTokens(tokens: { id_token?: unknown; access_token?: unknown }): {
  chatgptAccountId?: string;
  email?: string;
} {
  let chatgptAccountId: string | undefined;
  let email: string | undefined;
  for (const claims of [parseJwt(tokens.id_token), parseJwt(tokens.access_token)]) {
    if (!claims) continue;
    chatgptAccountId ??=
      claims.chatgpt_account_id ||
      claims['https://api.openai.com/auth']?.chatgpt_account_id ||
      claims.organizations?.[0]?.id;
    email ??= claims.email || claims['https://api.openai.com/profile']?.email;
  }
  return { chatgptAccountId, email };
}

export class OpenAIAccountsService extends OAuthAccountsService<OpenAIAccount> {
  private readonly engineAuthPath: () => string;

  constructor(
    store: OAuthAccountsStore<OpenAIAccount>,
    fetchImpl: typeof fetch = fetch,
    engineAuthPath?: string,
  ) {
    super(store, fetchImpl, {
      tokenEndpoint: OPENAI_TOKEN_ENDPOINT,
      clientId: CODEX_OAUTH_CLIENT_ID,
      tag: 'OpenAIAccounts',
      defaultExpiresInSec: 3600,
    });
    this.engineAuthPath = () => engineAuthPath ?? defaultEngineAuthPath();
  }

  /** The `openai` oauth entry the engine currently holds, if any. */
  readEngineCredential(): EngineCred | null {
    const p = this.engineAuthPath();
    if (!existsSync(p)) return null;
    try {
      const entry = (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>)?.openai as
        | Record<string, unknown>
        | undefined;
      if (!entry || entry.type !== 'oauth') return null;
      const { access, refresh, expires, accountId } = entry;
      if (typeof access !== 'string' || typeof refresh !== 'string' || typeof expires !== 'number') return null;
      return { access, refresh, expires, ...(typeof accountId === 'string' ? { accountId } : {}) };
    } catch (err) {
      logger.error('[OpenAIAccounts] engine auth read failed:', err);
      return null;
    }
  }

  /** Import the existing single engine OpenAI login as account #1 (empty store only). */
  migrateFromEngine(): boolean {
    if (this.hasAccounts()) return false;
    const cred = this.readEngineCredential();
    if (!cred) return false;
    const { email, chatgptAccountId } = identityFromTokens({ access_token: cred.access });
    this.store.upsertAccount({
      id: 'default',
      label: email ?? 'Default (from OpenCode)',
      access: cred.access,
      refresh: cred.refresh,
      expires: cred.expires,
      status: 'ok',
      chatgptAccountId: cred.accountId ?? chatgptAccountId,
      ...(email ? { email } : {}),
    });
    logger.info('[OpenAIAccounts] migrated existing engine OpenAI login into account store');
    return true;
  }

  /**
   * Upgrade path: adopt tokens an OLDER engine (legacy codex plugin, which
   * refreshed auth.json itself) rotated for the current default. Only when the
   * engine entry is the same ChatGPT workspace (and same email when known) and
   * not older — auth.json is no longer rewritten on a switch, so it may hold a
   * different account's stale seed; that is never adopted.
   */
  syncFromEngine(): void {
    const def = this.defaultAccount();
    const cred = this.readEngineCredential();
    if (!def || !cred || cred.refresh === def.refresh) return;
    if (def.chatgptAccountId && cred.accountId && def.chatgptAccountId !== cred.accountId) return;
    const engineEmail = identityFromTokens({ access_token: cred.access }).email;
    if (def.email && engineEmail !== def.email) return;
    if (cred.expires < def.expires) return;
    this.store.upsertAccount({ ...def, access: cred.access, refresh: cred.refresh, expires: cred.expires, status: 'ok' });
    logger.info(`[OpenAIAccounts] adopted engine-rotated tokens for default account ${def.id}`);
  }

  protected override applyRefresh(account: OpenAIAccount, refreshed: RefreshedTokens): OpenAIAccount {
    const id = identityFromTokens(refreshed.raw);
    return {
      ...super.applyRefresh(account, refreshed),
      chatgptAccountId: id.chatgptAccountId ?? account.chatgptAccountId,
    };
  }

  override async refreshAll(): Promise<void> {
    this.syncFromEngine();
    await super.refreshAll();
  }

  /**
   * Seed auth.json with the default when the engine has no openai oauth entry
   * (so the codex loader runs). Never rewrites an existing entry: account
   * choice is per request from the accounts file, so a switch or a token
   * rotation needs no engine write — and therefore no engine restart.
   */
  async pushDefaultToEngine(engine: OpenAIEngine): Promise<boolean> {
    const acct = this.defaultAccount();
    if (!acct || acct.status !== 'ok' || !engine.isReady) return false;
    if (this.readEngineCredential()) return true;
    return engine.setOAuthCredentials('openai', {
      access: acct.access,
      refresh: acct.refresh,
      expires: acct.expires,
      ...(acct.chatgptAccountId ? { accountId: acct.chatgptAccountId } : {}),
    });
  }

  /** Switch the global default. Takes effect on the next request — no engine write. */
  async activate(engine: OpenAIEngine, id: string): Promise<boolean> {
    this.store.setDefault(id);
    return this.pushDefaultToEngine(engine);
  }

  /** Remove an account; log the engine out when none remain. */
  async removeAndReconcile(engine: OpenAIEngine, id: string): Promise<void> {
    this.store.removeAccount(id);
    if (!this.hasAccounts() && engine.isReady) await engine.removeAuth('openai');
  }
}

interface PendingLogin {
  verifier: string;
  state: string;
  label: string;
}

/** Paste-back PKCE login run by api_server (not the engine), so adding a
 *  second account never touches the engine's current credential. */
export class OpenAIOauthService {
  private pending = new Map<string, PendingLogin>();

  constructor(
    private readonly accounts: OpenAIAccountsService,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  startLogin(accountId: string, label: string): { authorizeUrl: string } {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending.set(accountId, { verifier, state, label });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CODEX_OAUTH_CLIENT_ID,
      redirect_uri: CODEX_REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: 'opencode',
    });
    return { authorizeUrl: `${OPENAI_ISSUER}/oauth/authorize?${params.toString()}` };
  }

  hasPending(accountId: string): boolean {
    return this.pending.has(accountId);
  }

  /** Accepts the full callback URL, a "?code=..&state=.." query, "code#state", or a bare code. */
  static parsePasted(pasted: string): { code?: string; state?: string } {
    const text = pasted.trim();
    if (text.includes('code=')) {
      const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text;
      const params = new URLSearchParams(query.split('#')[0]);
      return { code: params.get('code') ?? undefined, state: params.get('state') ?? undefined };
    }
    const [code, state] = text.split('#');
    return { code: code || undefined, state: state || undefined };
  }

  async completeLogin(accountId: string, pasted: string): Promise<{ ok: boolean; reason?: string }> {
    const flow = this.pending.get(accountId);
    if (!flow) return { ok: false, reason: 'no_pending_login' };
    const { code, state } = OpenAIOauthService.parsePasted(pasted);
    if (!code) return { ok: false, reason: 'bad_code' };
    if (state && state !== flow.state) return { ok: false, reason: 'state_mismatch' };
    const res = await (this.fetchImpl ?? fetch)(OPENAI_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CODEX_REDIRECT_URI,
        client_id: CODEX_OAUTH_CLIENT_ID,
        code_verifier: flow.verifier,
      }).toString(),
    });
    if (!res.ok) {
      logger.error(`[OpenAIOauth] token exchange failed: ${res.status}`);
      return { ok: false, reason: `exchange_failed_${res.status}` };
    }
    const json = (await res.json()) as {
      id_token?: string;
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };
    const { chatgptAccountId, email } = identityFromTokens(json);
    this.accounts.upsertAccount({
      id: accountId,
      label: flow.label || email || accountId,
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + (json.expires_in ?? 3600) * 1000,
      status: 'ok',
      ...(chatgptAccountId ? { chatgptAccountId } : {}),
      ...(email ? { email } : {}),
    });
    this.pending.delete(accountId);
    return { ok: true };
  }
}

export const openaiAccountsService = new OpenAIAccountsService(
  new OAuthAccountsStore<OpenAIAccount>(defaultOpenAIAccountsFilePath()),
);
