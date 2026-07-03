/**
 * advisory_acks.ts — Issue #877
 *
 * Local acknowledgment store for security advisories (`security_advisories.ts`).
 * `rhythm doctor --ack <id>` writes here; the startup banner and `doctor`
 * report both consult it to suppress warnings for advisories the user has
 * already actioned.
 *
 * Data-safety (per the issue): the ack file contains ONLY advisory IDs — never
 * package names, versions, or secrets. Mirrors the atomic write pattern used
 * by `mcp_auth_store.ts` (write temp → rename) so a crash mid-write can never
 * corrupt the file.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { logger } from '../utils/logger';

interface AckFile {
  acked: string[];
}

/** Default on-disk location, overridable for tests via the constructor arg. */
export function defaultAckFilePath(): string {
  return process.env.RHYTHM_ADVISORY_ACKS_FILE ?? join(homedir(), '.rhythm_acks');
}

/**
 * Reads/writes the local advisory-ack file. Never throws: a missing or
 * malformed file is treated as "nothing acknowledged" and self-heals on the
 * next `ack()` call.
 */
export class AdvisoryAckStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultAckFilePath();
  }

  get path(): string {
    return this.filePath;
  }

  /** Read the ack file, or `{ acked: [] }` when absent/unparseable. */
  private readAll(): AckFile {
    if (!existsSync(this.filePath)) return { acked: [] };
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as AckFile).acked)
      ) {
        return { acked: (parsed as AckFile).acked.filter((x) => typeof x === 'string') };
      }
      return { acked: [] };
    } catch (err) {
      logger.warn('[AdvisoryAckStore] ack file unreadable — treating as empty:', err);
      return { acked: [] };
    }
  }

  /** True when `advisoryId` has been acknowledged. */
  isAcked(advisoryId: string): boolean {
    return this.readAll().acked.includes(advisoryId);
  }

  /** Acknowledge `advisoryId`. Idempotent — acking twice does not duplicate. */
  ack(advisoryId: string): void {
    const current = this.readAll();
    if (!current.acked.includes(advisoryId)) {
      current.acked.push(advisoryId);
    }
    const json = JSON.stringify(current, null, 2) + '\n';
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, json, 'utf8');
    renameSync(tmp, this.filePath);
  }
}
