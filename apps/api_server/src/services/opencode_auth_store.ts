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

  constructor(authPath?: string) {
    this.authPath =
      authPath ?? join(homedir(), '.local', 'share', 'opencode', 'auth.json');
  }

  /** Returns the provider IDs that have entries in auth.json. */
  listAuthedProviders(): string[] {
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

  has(providerId: string): boolean {
    return this.listAuthedProviders().includes(providerId);
  }
}
