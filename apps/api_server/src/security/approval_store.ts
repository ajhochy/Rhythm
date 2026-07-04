/**
 * approval_store.ts — Issue #878
 *
 * Persistent "always allow" command-pattern allowlist. Populated when the
 * user chooses "always" at a manual-mode approval prompt; consulted on every
 * subsequent classification so a previously-approved command pattern never
 * prompts again — across process restarts (issue: "saved to config file...
 * honored on future sessions").
 *
 * Stores COMMAND PATTERNS, never secrets (data-safety section of the issue).
 * Mirrors mcp_auth_store.ts / advisory_acks.ts's atomic write pattern
 * (write temp → rename).
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { logger } from '../utils/logger';

interface ApprovalStoreFile {
  /** Exact command strings the user has permanently approved. */
  alwaysAllowed: string[];
}

export function defaultApprovalStoreFilePath(): string {
  return process.env.RHYTHM_APPROVAL_STORE_FILE ?? join(homedir(), '.rhythm_command_approvals.json');
}

/**
 * Reads/writes the local "always allow" command-approval file. Never throws:
 * a missing or malformed file is treated as "nothing approved" and self-heals
 * on the next `alwaysAllow()` call — mirrors AdvisoryAckStore.
 */
export class ApprovalStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultApprovalStoreFilePath();
  }

  get path(): string {
    return this.filePath;
  }

  private readAll(): ApprovalStoreFile {
    if (!existsSync(this.filePath)) return { alwaysAllowed: [] };
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as ApprovalStoreFile).alwaysAllowed)
      ) {
        return {
          alwaysAllowed: (parsed as ApprovalStoreFile).alwaysAllowed.filter(
            (x) => typeof x === 'string',
          ),
        };
      }
      return { alwaysAllowed: [] };
    } catch (err) {
      logger.warn('[ApprovalStore] approval file unreadable — treating as empty:', err);
      return { alwaysAllowed: [] };
    }
  }

  /** True when `command` has been permanently approved via "always". */
  isAlwaysAllowed(command: string): boolean {
    return this.readAll().alwaysAllowed.includes(command);
  }

  /** Permanently approve `command`. Idempotent. */
  alwaysAllow(command: string): void {
    const current = this.readAll();
    if (!current.alwaysAllowed.includes(command)) {
      current.alwaysAllowed.push(command);
    }
    const json = JSON.stringify(current, null, 2) + '\n';
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, json, 'utf8');
    renameSync(tmp, this.filePath);
  }
}
