/**
 * MCP remote-OAuth workaround — opencode `mcp-auth.json` reader/writer.
 *
 * Spec: docs/superpowers/specs/2026-06-17-mcp-remote-oauth-workaround.md
 *
 * opencode persists per-MCP-server OAuth state at
 * `~/.local/share/opencode/mcp-auth.json`. We bypass opencode's broken SDK
 * auth path by performing the OAuth flow ourselves and writing the resulting
 * tokens into this file via the EXACT reverse-engineered schema, then
 * reconnecting. opencode's `getForUrl(name, url)` returns an entry ONLY when
 * `entry.serverUrl === url`, so the serverUrl must match the configured server
 * URL exactly. `isTokenExpired` compares `tokens.expiresAt` (unix seconds)
 * against `now/1000`.
 *
 * Reads and writes merge per-server entries so other servers are never
 * clobbered. Writes are atomic-ish (write temp → rename).
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { logger } from '../utils/logger';

/** Client credentials opencode persists (and later uses to refresh). */
export interface McpAuthClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
}

/** Token bundle opencode reads via `tokens()`. */
export interface McpAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix SECONDS. `isTokenExpired` = `expiresAt < now/1000`. */
  expiresAt: number;
  scope: string;
}

/** A single per-server entry in mcp-auth.json. */
export interface McpAuthEntry {
  clientInfo: McpAuthClientInfo;
  /** Must equal the configured server URL exactly (opencode `getForUrl`). */
  serverUrl: string;
  tokens?: McpAuthTokens;
  /**
   * Private marker (NOT read by opencode): the redirect_uri our DCR client was
   * registered with. We reuse a cached `clientInfo` only when this matches the
   * current redirect_uri, so a callback-port change forces a fresh DCR.
   */
  redirectUri?: string;
}

export type McpAuthFile = Record<string, McpAuthEntry>;

/** Default on-disk location of opencode's MCP auth store. */
export function defaultMcpAuthFilePath(): string {
  return (
    process.env.MCP_AUTH_FILE ??
    join(homedir(), '.local', 'share', 'opencode', 'mcp-auth.json')
  );
}

/**
 * Reads/writes opencode's `mcp-auth.json`, merging per-server entries so
 * unrelated servers are preserved. Path is injectable for tests (or via the
 * `MCP_AUTH_FILE` env var).
 */
export class McpAuthStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultMcpAuthFilePath();
  }

  get path(): string {
    return this.filePath;
  }

  /** Read the whole file, or `{}` when absent/unparseable. */
  readAll(): McpAuthFile {
    if (!existsSync(this.filePath)) return {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed as McpAuthFile;
    } catch (err) {
      logger.error('[McpAuthStore] read failed:', err);
      return {};
    }
  }

  /** Read a single server's entry, or undefined. */
  get(name: string): McpAuthEntry | undefined {
    return this.readAll()[name];
  }

  /**
   * Merge `entry` for `name` into the file, preserving all other servers.
   * Atomic-ish: write a temp file then rename over the target.
   */
  set(name: string, entry: McpAuthEntry): void {
    const all = this.readAll();
    all[name] = entry;
    const json = JSON.stringify(all, null, 2) + '\n';
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, json, 'utf8');
    renameSync(tmp, this.filePath);
  }
}
