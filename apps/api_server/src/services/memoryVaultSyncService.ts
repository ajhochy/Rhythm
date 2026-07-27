/**
 * Memory-Vault → agent_memory mirror-sync service (Issue #770, Work Item 6).
 *
 * Reads every `.md` note from a dedicated Obsidian "Memory-Vault" (direct file
 * read — no Obsidian instance required), parses each note's YAML-ish
 * frontmatter per Work Item 3's canonical format, and mirrors the notes into
 * the `agent_memory` table so the Rhythm Brain panel (AgentMemoryView) can
 * display them.
 *
 * Sync semantics:
 *   • Upsert keyed on source='obsidian-memory' + source_id=<vault-relative path>
 *     → fully idempotent (re-running an unchanged vault is a no-op).
 *   • Tombstone cleanup: rows with source='obsidian-memory' whose source_id is
 *     no longer present in the vault are deleted.
 *   • Rows from OTHER sources (session/scheduler/manual consolidation) are never
 *     touched.
 *   • A missing vault path is a no-op (logged), not an error.
 *
 * Work Item 3 frontmatter schema (all fields optional):
 *   kind: fact | person | project | preference | context   (defaults to 'fact')
 *   tags: []
 *   source:                  (informational only; the mirror always stamps
 *                             source='obsidian-memory' as the storage source)
 *   source_id:               (informational only; the mirror keys on the note
 *                             path for stable idempotent sync)
 *   created: YYYY-MM-DD
 *   updated: YYYY-MM-DD
 * Body (everything after the frontmatter block) → agent_memory.content.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { resolveMemoryVaultPath } from '../config/env';
import { logger } from '../utils/logger';
import {
  parseMemoryNote,
  type GeneratedMetadata,
  type MemoryStatus,
  type VerificationEntry,
} from './memory_note_format';

/** The canonical storage source stamped on every mirrored row. */
export const MEMORY_VAULT_SOURCE = 'obsidian-memory';

/**
 * Canonical index identity for a memory note: its path RELATIVE TO THE VAULT
 * ROOT (e.g. `memory/fact/abc.md`).
 *
 * Both index writers MUST key on this one form or the same note gets indexed
 * twice (epic #801 / #808 follow-up): the scan/rebuild path
 * ({@link scanVaultNotes} → {@link MemoryIndexService.rebuildIndexFromVault})
 * already keys on `path.relative(vaultRoot, full)`, while the vault-first write
 * path ({@link rememberToVault}) writes under `<vaultRoot>/memory`. Routing both
 * through these helpers guarantees a write-then-rebuild produces the SAME
 * `source_id` (exactly one row), and that `forget`/`removeNote` keyed on one
 * form can't miss a row keyed on the other.
 *
 * `absNotePath` must be inside `vaultRoot`. The result uses the host path
 * separator (matching `scanVaultNotes`, which also uses `path.relative`).
 */
export function toVaultRelativeKey(vaultRoot: string, absNotePath: string): string {
  return path.relative(path.resolve(vaultRoot), path.resolve(absNotePath));
}

/**
 * The vault root that canonical `source_id` keys are relative to, derived
 * from a memory dir.
 *
 * #886 root cause: this used to be hardcoded `path.dirname(memoryDir)`, which
 * is only correct in the legacy layout (`MEMORY_VAULT_SUBDIR='memory'`, so
 * memoryDir = `<vaultRoot>/memory`). In the clean layout
 * (`MEMORY_VAULT_SUBDIR=''`, e.g. `…/Obsidian Vault/AGENT-MEMORY`), the
 * memory dir IS the vault root — `dirname()` then walks one level too high,
 * so the write path mints `AGENT-MEMORY/kind/…` keys while the sync mints
 * `kind/…` keys. The two id spaces diverge and `PATCH /agent-memory/:id`
 * (edit-in-place, #862) 404s on every synced row. This helper applies the
 * same subdir rule as `resolveMemoryDirPath` so both directions agree in
 * BOTH layouts.
 */
export function resolveVaultRootForMemoryDir(memoryDir: string): string {
  const sub = process.env.MEMORY_VAULT_SUBDIR ?? 'memory';
  const resolved = path.resolve(memoryDir);
  return sub ? path.dirname(resolved) : resolved;
}

/**
 * Inverse of {@link toVaultRelativeKey} for the memory-dir-confined write/delete
 * path: given the vault-root-relative canonical key and the memory dir,
 * return the key's path RELATIVE TO THE MEMORY DIR (legacy layout:
 * `memory/fact/abc.md` → `fact/abc.md`; clean layout: `fact/abc.md` is
 * already memory-dir-relative and passes through unchanged) so the existing
 * memory-dir path-traversal guard can resolve it.
 */
export function vaultKeyToMemoryDirRelative(memoryDir: string, vaultRelKey: string): string {
  const vaultRoot = resolveVaultRootForMemoryDir(memoryDir);
  const abs = path.resolve(vaultRoot, vaultRelKey);
  return path.relative(path.resolve(memoryDir), abs);
}

export interface MemoryVaultSyncSummary {
  /** Number of `.md` notes found and processed in the vault. */
  scanned: number;
  /** Number of notes upserted (inserted or updated) into agent_memory. */
  upserted: number;
  /** Number of tombstoned rows deleted (note removed from vault). */
  deleted: number;
}

export interface ParsedNote {
  kind: string;
  tags: string[];
  content: string;
  status?: MemoryStatus;
  staleAfter?: string;
  generated?: GeneratedMetadata;
  verified?: VerificationEntry[];
}

/**
 * Parse a markdown note's frontmatter + body.
 *
 * Intentionally a small, dependency-free parser: the api_server has no YAML
 * library and the canonical schema is flat (scalars + a one-line `tags` array),
 * so a hand-rolled line parser is more robust and testable than pulling in a
 * full YAML engine. Supports:
 *   • `---`-delimited frontmatter at the very top of the file
 *   • `key: value` scalar pairs
 *   • `tags: [a, b, c]` inline arrays and `tags:`-then-`- a` block arrays
 *   • files with no frontmatter (the whole file becomes the body)
 */
export function parseNote(raw: string): ParsedNote {
  const document = parseMemoryNote(raw);
  return {
    kind: document.kind,
    tags: document.tags,
    content: document.body,
    status: document.status,
    staleAfter: document.staleAfter,
    generated: document.generated,
    verified: document.verified,
  };
}

/** A parsed vault note paired with its stable identity key (vault-relative path). */
export interface ScannedNote {
  /** Vault-relative note path — the stable idempotency key (source_id). */
  sourceId: string;
  /** Parsed frontmatter + body. */
  parsed: ParsedNote;
}

/**
 * Recursively scan a Memory-Vault directory and return every `.md` note parsed
 * via {@link parseNote}, keyed by its vault-relative path.
 *
 * A missing / non-directory vault path yields an empty array (never throws) so
 * callers can treat "no vault" as a no-op. Unreadable individual notes are
 * skipped with a warning (the rest of the scan still proceeds).
 *
 * Shared by both the mirror-sync pass ({@link syncMemoryVault}) and the
 * derived-index rebuild (MemoryIndexService) so the recursive walk + parse
 * lives in exactly one place.
 */
export async function scanVaultNotes(vaultPath: string): Promise<ScannedNote[]> {
  try {
    const stat = await fs.stat(vaultPath);
    if (!stat.isDirectory()) {
      logger.info(`[MemoryVaultScan] Vault path is not a directory, skipping: ${vaultPath}`);
      return [];
    }
  } catch {
    logger.info(`[MemoryVaultScan] Vault path not found, skipping (no-op): ${vaultPath}`);
    return [];
  }

  const relativePaths = await collectMarkdownFiles(vaultPath, vaultPath);
  const notes: ScannedNote[] = [];
  for (const rel of relativePaths) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(vaultPath, rel), 'utf8');
    } catch (err) {
      logger.warn(`[MemoryVaultScan] Could not read note "${rel}": ${String(err)}`);
      continue;
    }
    notes.push({ sourceId: rel, parsed: parseNote(raw) });
  }
  return notes;
}

/** Recursively collect all `.md` files under `dir`, returning vault-relative paths. */
async function collectMarkdownFiles(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    // Skip Obsidian config / hidden dirs (e.g. .obsidian, .trash).
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdownFiles(root, full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(path.relative(root, full));
    }
  }
  return out;
}

export interface SyncMemoryVaultOptions {
  /** Override the vault path (tests point this at a temp fixture). */
  vaultPath?: string;
  /** Owner user id to stamp on mirrored rows (default null = instance-global). */
  ownerUserId?: number | null;
}

const repo = new AgentMemoryRepository();

/**
 * Run one mirror-sync pass. Idempotent. Never throws on a missing vault path.
 */
export async function syncMemoryVault(
  options: SyncMemoryVaultOptions = {},
): Promise<MemoryVaultSyncSummary> {
  const vaultPath = options.vaultPath ?? resolveMemoryVaultPath();
  const ownerUserId = options.ownerUserId ?? null;

  // A missing / non-directory vault path yields no notes (never an error).
  const notes = await scanVaultNotes(vaultPath);
  const presentSourceIds = new Set<string>();
  let upserted = 0;

  for (const { sourceId, parsed } of notes) {
    presentSourceIds.add(sourceId);
    await repo.upsertBySourceAsync({
      kind: parsed.kind,
      content: parsed.content,
      source: MEMORY_VAULT_SOURCE,
      sourceId,
      tagsJson: JSON.stringify(parsed.tags),
      ownerUserId,
    });
    upserted += 1;
  }

  // Tombstone cleanup: delete vault-sourced rows whose note no longer exists.
  const storedSourceIds = await repo.listSourceIdsBySourceAsync(MEMORY_VAULT_SOURCE);
  const stale = storedSourceIds.filter((id) => !presentSourceIds.has(id));
  const deleted = await repo.deleteBySourceAndSourceIdsAsync(MEMORY_VAULT_SOURCE, stale);

  logger.info(
    `[MemoryVaultSync] scanned=${notes.length} upserted=${upserted} deleted=${deleted} (vault=${vaultPath})`,
  );

  return { scanned: notes.length, upserted, deleted };
}
