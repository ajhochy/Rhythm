/**
 * #1096 WP1 — persisted, device-local configuration for the Engraph backend
 * manager. Mirrors `anthropic_accounts_store.ts`'s atomic-write JSON file
 * pattern: a single file under Rhythm's own Application Support directory,
 * written atomically (tmp file + rename) with mode 0600.
 *
 * NEVER stores secrets or memory contents. The generated Engraph API key and
 * indexed memory content never appear here — see engraph_manager.ts, which
 * regenerates the API key in memory on every (re)start and writes it only to
 * the Rhythm-only Engraph HOME's own config.toml (also mode 0600), never to
 * this file, a log, or an API response.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

export type EngraphDiscoverySource = 'path' | 'homebrew' | 'user-selected';

export type EngraphLifecycleState =
  | 'disabled'
  | 'discovering'
  | 'indexing'
  | 'starting'
  | 'ready'
  | 'error';

export type EngraphFailureCategory =
  | 'binary_not_found'
  | 'binary_invalid'
  | 'spawn_failed'
  | 'index_failed'
  | 'health_check_failed'
  | 'timeout'
  | 'permission_denied'
  | 'unknown';

export interface EngraphManagerConfigFile {
  version: 1;
  /** User preference — the feature is OFF by default (mirrors every other
   *  optional-capability flag in this codebase). */
  enabled: boolean;
  executablePath: string | null;
  discoverySource: EngraphDiscoverySource | null;
  /** The canonical, symlink-resolved agent-memory root approved for indexing
   *  as of the last successful (re)start. Recorded for diagnostics only —
   *  the manager always RE-resolves the live approved root at runtime rather
   *  than trusting this stored value (see `resolveApprovedMemoryRoot`). */
  approvedMemoryRoot: string | null;
  lastHealthyAt: string | null;
  lastFailureCategory: EngraphFailureCategory | null;
  /** Sanitized (no paths/secrets/query text) human-readable failure detail. */
  lastFailureMessage: string | null;
  state: EngraphLifecycleState;
}

const EMPTY: EngraphManagerConfigFile = {
  version: 1,
  enabled: false,
  executablePath: null,
  discoverySource: null,
  approvedMemoryRoot: null,
  lastHealthyAt: null,
  lastFailureCategory: null,
  lastFailureMessage: null,
  state: 'disabled',
};

const DISCOVERY_SOURCES: EngraphDiscoverySource[] = ['path', 'homebrew', 'user-selected'];
const FAILURE_CATEGORIES: EngraphFailureCategory[] = [
  'binary_not_found', 'binary_invalid', 'spawn_failed', 'index_failed',
  'health_check_failed', 'timeout', 'permission_denied', 'unknown',
];
const LIFECYCLE_STATES: EngraphLifecycleState[] = [
  'disabled', 'discovering', 'indexing', 'starting', 'ready', 'error',
];

export function defaultEngraphManagerConfigPath(): string {
  return (
    process.env.RHYTHM_ENGRAPH_MANAGER_CONFIG_FILE ??
    join(homedir(), 'Library', 'Application Support', 'Rhythm', 'engraph-manager-config.json')
  );
}

export class EngraphManagerConfigStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultEngraphManagerConfigPath();
  }

  get path(): string {
    return this.filePath;
  }

  read(): EngraphManagerConfigFile {
    if (!existsSync(this.filePath)) return structuredClone(EMPTY);
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return structuredClone(EMPTY);
      const f = parsed as Partial<EngraphManagerConfigFile>;
      return {
        version: 1,
        enabled: f.enabled === true,
        executablePath: typeof f.executablePath === 'string' ? f.executablePath : null,
        discoverySource: DISCOVERY_SOURCES.includes(f.discoverySource as EngraphDiscoverySource)
          ? (f.discoverySource as EngraphDiscoverySource)
          : null,
        approvedMemoryRoot: typeof f.approvedMemoryRoot === 'string' ? f.approvedMemoryRoot : null,
        lastHealthyAt: typeof f.lastHealthyAt === 'string' ? f.lastHealthyAt : null,
        lastFailureCategory: FAILURE_CATEGORIES.includes(f.lastFailureCategory as EngraphFailureCategory)
          ? (f.lastFailureCategory as EngraphFailureCategory)
          : null,
        lastFailureMessage: typeof f.lastFailureMessage === 'string' ? f.lastFailureMessage : null,
        state: LIFECYCLE_STATES.includes(f.state as EngraphLifecycleState)
          ? (f.state as EngraphLifecycleState)
          : 'disabled',
      };
    } catch (err) {
      logger.error('[EngraphManagerConfigStore] read failed:', err);
      return structuredClone(EMPTY);
    }
  }

  write(patch: Partial<EngraphManagerConfigFile>): EngraphManagerConfigFile {
    const next = { ...this.read(), ...patch, version: 1 as const };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.filePath);
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      /* best-effort on non-posix */
    }
    return next;
  }
}
