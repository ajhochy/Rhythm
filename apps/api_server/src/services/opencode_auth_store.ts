import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';

/**
 * Reads the Opencode SDK's auth file (`~/.local/share/opencode/auth.json`)
 * which `client.auth.set` writes to. This is the only place that records
 * "what providers are authed" — the SDK's other listing endpoints return
 * model catalogs, not auth state.
 */
export class OpencodeAuthStore {
  private readonly authPath: string;
  /**
   * The `opencode-gemini-auth` plugin authenticates Google via the gemini-cli
   * Code Assist OAuth flow and stores its tokens in gemini-cli's own credential
   * file (`~/.gemini/oauth_creds.json`) — NOT opencode's auth.json. So a
   * successfully-linked Google account never appears in auth.json. We detect
   * that plugin auth here and report `google` as authed, which (a) lets the
   * sign-in dialog's poll complete and (b) lights up the gemini-cli capability.
   */
  private readonly geminiCredsPath: string;

  constructor(authPath?: string, geminiCredsPath?: string) {
    this.authPath =
      authPath ?? join(homedir(), '.local', 'share', 'opencode', 'auth.json');
    this.geminiCredsPath =
      geminiCredsPath ?? join(homedir(), '.gemini', 'oauth_creds.json');
  }

  /** Returns the provider IDs that have entries in auth.json. */
  listAuthedProviders(): string[] {
    const providers = this.readAuthJsonProviders();
    // opencode-gemini-auth stores Google creds outside auth.json (see field doc).
    if (!providers.includes('google') && this.hasGeminiPluginAuth()) {
      providers.push('google');
    }
    return providers;
  }

  private readAuthJsonProviders(): string[] {
    if (!existsSync(this.authPath)) return [];
    try {
      const raw = readFileSync(this.authPath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => v && typeof v === 'object')
        .map(([k]) => k);
    } catch (err) {
      logger.error('[OpencodeAuthStore] read failed:', err);
      return [];
    }
  }

  /**
   * True when the gemini-cli plugin has a valid Google credential on disk
   * (a parseable creds file carrying a non-empty refresh or access token).
   */
  private hasGeminiPluginAuth(): boolean {
    if (!existsSync(this.geminiCredsPath)) return false;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.geminiCredsPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return false;
      const creds = parsed as Record<string, unknown>;
      const refresh = creds.refresh_token;
      const access = creds.access_token;
      return (
        (typeof refresh === 'string' && refresh.length > 0) ||
        (typeof access === 'string' && access.length > 0)
      );
    } catch (err) {
      logger.error('[OpencodeAuthStore] gemini creds read failed:', err);
      return false;
    }
  }

  has(providerId: string): boolean {
    return this.listAuthedProviders().includes(providerId);
  }
}
