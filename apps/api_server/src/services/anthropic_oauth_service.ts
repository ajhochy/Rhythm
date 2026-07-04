import { randomBytes, createHash } from 'crypto';
import {
  AnthropicAccountsService,
  CLAUDE_CODE_OAUTH_CLIENT_ID,
  ANTHROPIC_TOKEN_ENDPOINT,
} from './anthropic_accounts_service';
import { logger } from '../utils/logger';

const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const SCOPES = 'org:create_api_key user:profile user:inference';

interface PendingLogin {
  verifier: string;
  label: string;
}

export class AnthropicOauthService {
  private pending = new Map<string, PendingLogin>();

  constructor(
    private readonly accounts: AnthropicAccountsService,
    // Resolved at call time (not captured at construction) so tests can
    // vi.stubGlobal('fetch', ...) after the routes module is imported.
    private readonly fetchImpl?: typeof fetch,
  ) {}

  startLogin(accountId: string, label: string): { authorizeUrl: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending.set(accountId, { verifier, label });
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('code', 'true');
    url.searchParams.set('client_id', CLAUDE_CODE_OAUTH_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', verifier);
    return { authorizeUrl: url.toString() };
  }

  hasPending(accountId: string): boolean {
    return this.pending.has(accountId);
  }

  /** Exchange the pasted "<code>#<state>" for tokens and persist the account. */
  async completeLogin(
    accountId: string,
    pasted: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const flow = this.pending.get(accountId);
    if (!flow) return { ok: false, reason: 'no_pending_login' };
    const [code, state] = pasted.trim().split('#');
    if (!code) return { ok: false, reason: 'bad_code' };
    const doFetch = this.fetchImpl ?? fetch;
    const params = {
      grant_type: 'authorization_code',
      code,
      state: state ?? flow.verifier,
      client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: flow.verifier,
    };
    let res = await doFetch(ANTHROPIC_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok && res.status < 500) {
      logger.warn(`[AnthropicOauth] JSON exchange got ${res.status}; retrying form-encoded`);
      res = await doFetch(ANTHROPIC_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
    }
    if (!res.ok) {
      logger.error(`[AnthropicOauth] token exchange failed: ${res.status}`);
      return { ok: false, reason: `exchange_failed_${res.status}` };
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    this.accounts.upsertAccount({
      id: accountId,
      label: flow.label,
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + (json.expires_in ?? 36_000) * 1000,
      status: 'ok',
    });
    this.pending.delete(accountId);
    return { ok: true };
  }
}
