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

/** The canonical storage source stamped on every mirrored row. */
export const MEMORY_VAULT_SOURCE = 'obsidian-memory';

const VALID_KINDS = new Set(['fact', 'person', 'project', 'preference', 'context']);

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
  const normalized = raw.replace(/\r\n/g, '\n');
  let frontmatter = '';
  let body = normalized;

  if (normalized.startsWith('---\n') || normalized === '---') {
    // Find the closing delimiter line after the opening one.
    const afterOpen = normalized.slice(4); // skip leading "---\n"
    const closeIdx = afterOpen.search(/\n---\s*(\n|$)/);
    if (closeIdx !== -1) {
      frontmatter = afterOpen.slice(0, closeIdx);
      // Advance past the closing delimiter line.
      const rest = afterOpen.slice(closeIdx + 1); // at "---..."
      const nl = rest.indexOf('\n');
      body = nl === -1 ? '' : rest.slice(nl + 1);
    }
  }

  const fm = parseFrontmatter(frontmatter);

  const rawKind = typeof fm.kind === 'string' ? fm.kind.trim().toLowerCase() : '';
  const kind = VALID_KINDS.has(rawKind) ? rawKind : 'fact';

  let tags: string[] = [];
  if (Array.isArray(fm.tags)) tags = fm.tags;

  return { kind, tags, content: body.trim() };
}

type FrontmatterValue = string | string[];

function parseFrontmatter(text: string): Record<string, FrontmatterValue> {
  const out: Record<string, FrontmatterValue> = {};
  if (!text.trim()) return out;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (!key) continue;

    // Inline array: tags: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = splitInlineArray(value.slice(1, -1));
      continue;
    }

    // Block array: key: (empty) followed by "- item" lines.
    if (value === '') {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(stripQuotes(lines[j].replace(/^\s*-\s+/, '').trim()));
        j++;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j - 1;
        continue;
      }
      out[key] = '';
      continue;
    }

    out[key] = stripQuotes(value);
  }
  return out;
}

function splitInlineArray(inner: string): string[] {
  return inner
    .split(',')
    .map((s) => stripQuotes(s.trim()))
    .filter((s) => s.length > 0);
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
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

  // No-op when the vault path is absent (never an error).
  try {
    const stat = await fs.stat(vaultPath);
    if (!stat.isDirectory()) {
      logger.info(`[MemoryVaultSync] Vault path is not a directory, skipping: ${vaultPath}`);
      return { scanned: 0, upserted: 0, deleted: 0 };
    }
  } catch {
    logger.info(`[MemoryVaultSync] Vault path not found, skipping (no-op): ${vaultPath}`);
    return { scanned: 0, upserted: 0, deleted: 0 };
  }

  const relativePaths = await collectMarkdownFiles(vaultPath, vaultPath);
  const presentSourceIds = new Set<string>();
  let upserted = 0;

  for (const rel of relativePaths) {
    presentSourceIds.add(rel);
    let raw: string;
    try {
      raw = await fs.readFile(path.join(vaultPath, rel), 'utf8');
    } catch (err) {
      logger.warn(`[MemoryVaultSync] Could not read note "${rel}": ${String(err)}`);
      continue;
    }
    const parsed = parseNote(raw);
    await repo.upsertBySourceAsync({
      kind: parsed.kind,
      content: parsed.content,
      source: MEMORY_VAULT_SOURCE,
      sourceId: rel,
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
    `[MemoryVaultSync] scanned=${relativePaths.length} upserted=${upserted} deleted=${deleted} (vault=${vaultPath})`,
  );

  return { scanned: relativePaths.length, upserted, deleted };
}
