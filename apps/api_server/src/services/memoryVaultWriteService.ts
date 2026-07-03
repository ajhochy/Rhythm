/**
 * Vault-first write path for agent memory (Issue #803, memory epic #801).
 *
 * Per docs/ai/decisions (memory-vault-as-source-of-truth), the Obsidian
 * Memory-Vault is the SOURCE OF TRUTH and the SQLite index is derived. So
 * `remember` (POST /agent-memory on the local agent server) must:
 *
 *   1. DEDUP against existing notes — by frontmatter `id` if one is supplied,
 *      else by a normalized content key — so a repeat of the same memory
 *      updates the existing note rather than creating a duplicate file.
 *   2. WRITE THE VAULT NOTE FIRST via a direct filesystem write (NOT the
 *      Obsidian MCP, so it works with Obsidian closed) at
 *      `<memoryDir>/<kind>/<slug>.md` with frontmatter
 *      `id, kind, tags, created, updated, source` and the full body.
 *   3. THEN hand the written note to {@link MemoryIndexService.upsertNote} so
 *      search reflects it synchronously.
 *
 * Ordering is mandatory: if the FS write fails, the index is NOT touched.
 *
 * `forget` (DELETE /agent-memory/:id) removes the vault file (confined to the
 * memory dir) and then removes the derived index row.
 *
 * PRIVACY: never log note bodies. Logs carry the note PATH and counts only.
 *
 * PATH SAFETY: every write/delete is confined to the resolved memory dir. A
 * note path that resolves outside it (via `..`, an absolute path, or path
 * separators in the slug source) is rejected — nothing is written.
 */

import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { resolveMemoryDirPath } from '../config/env';
import {
  MEMORY_VAULT_SOURCE,
  resolveVaultRootForMemoryDir,
  toVaultRelativeKey,
  vaultKeyToMemoryDirRelative,
} from './memoryVaultSyncService';
import { MemoryIndexService } from './memory_index_service';
import type { AgentMemory, AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { logger } from '../utils/logger';
import { MEMORY_MERGE_THRESHOLD, mergeMemoryContent, textSimilarity } from './memory_similarity';

/** Allowed memory kinds — must match memoryVaultSyncService's VALID_KINDS. */
export const VALID_MEMORY_KINDS = ['fact', 'person', 'project', 'preference', 'context'] as const;
export type MemoryKind = (typeof VALID_MEMORY_KINDS)[number];

/** Thrown for any caller-input problem (bad kind, path escape, empty content). */
export class MemoryWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryWriteError';
  }
}

export interface RememberInput {
  kind: string;
  content: string;
  /** Optional caller-supplied ULID — the primary dedup key when present. */
  id?: string;
  tags?: string[];
  /** Informational `source` frontmatter (defaults to 'agent'). */
  source?: string;
}

export interface RememberResult {
  /** The note's stable ULID (assigned if the caller did not supply one). */
  id: string;
  /**
   * Canonical VAULT-ROOT-relative note path — the index `source_id`, identical
   * to the key the scan/rebuild path stamps for the same note,
   * e.g. `memory/fact/abc.md`.
   */
  path: string;
  kind: MemoryKind;
}

const ULID_TIME_LEN = 10;
const ULID_RAND_LEN = 16;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a ULID (Crockford base32: 10 time chars + 16 random chars).
 * Dependency-free — the api_server has no `ulid` package and adding one for a
 * single id generator is unwarranted. Lexicographically sortable by time.
 */
export function generateUlid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = ULID_TIME_LEN - 1; i >= 0; i--) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(ULID_RAND_LEN);
  let rand = '';
  for (let i = 0; i < ULID_RAND_LEN; i++) {
    rand += CROCKFORD[bytes[i] % 32];
  }
  return time + rand;
}

/** True if `s` looks like a ULID we generated (26 Crockford base32 chars). */
function isUlid(s: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
}

/**
 * Normalize content into a deterministic dedup key: collapse whitespace,
 * lowercase, trim. Used when the caller does NOT supply an `id`, so two
 * `remember` calls with the same text resolve to the same note file.
 */
export function normalizeContentKey(content: string): string {
  return content.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Filesystem-safe slug for a note basename. Maps everything outside
 * [a-z0-9-_] to '-', collapses repeats, trims, lowercases, and caps length.
 * The slug never contains a path separator or '..', so it cannot escape the
 * per-kind dir. Falls back to a ULID when the source has no usable chars.
 */
export function slugForNote(source: string, fallbackId: string): string {
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : fallbackId.toLowerCase();
}

function assertValidKind(kind: string): MemoryKind {
  if ((VALID_MEMORY_KINDS as readonly string[]).includes(kind)) {
    return kind as MemoryKind;
  }
  throw new MemoryWriteError(
    `Invalid memory kind "${kind}". Allowed: ${VALID_MEMORY_KINDS.join('|')}.`,
  );
}

/**
 * Resolve a vault-relative note path to an absolute path and assert it stays
 * inside the memory dir. Rejects `..`, absolute components, and any resolved
 * path that escapes the boundary. Returns the absolute path.
 */
export function resolveWithinMemoryDir(memoryDir: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new MemoryWriteError(`Note path must be relative: ${relPath}`);
  }
  const root = path.resolve(memoryDir);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new MemoryWriteError(`Note path escapes the memory dir: ${relPath}`);
  }
  return abs;
}

/** Today's date as YYYY-MM-DD (matches the existing frontmatter convention). */
export function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface NoteFrontmatter {
  id: string;
  kind: MemoryKind;
  tags: string[];
  created: string;
  updated: string;
  source: string;
}

/**
 * Render a note's frontmatter + body to markdown. The frontmatter is a flat
 * scalar block plus an inline `tags: [...]` array so the existing dependency-
 * free {@link parseNote} reads it back unchanged.
 */
export function renderMemoryNote(fm: NoteFrontmatter, body: string): string {
  const tagsInline = `[${fm.tags.map((t) => JSON.stringify(t)).join(', ')}]`;
  const lines = [
    '---',
    `id: ${fm.id}`,
    `kind: ${fm.kind}`,
    `tags: ${tagsInline}`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    `source: ${JSON.stringify(fm.source)}`,
    '---',
    '',
    body.trim(),
    '',
  ];
  return lines.join('\n');
}

/** Minimal frontmatter read for dedup: extract `id` + `created` from a note. */
async function readNoteMeta(abs: string): Promise<{ id?: string; created?: string }> {
  const full = await readNoteFull(abs);
  return { id: full.id, created: full.created };
}

/**
 * Full frontmatter + body read, used by merge-on-capture (#859a) and the
 * consolidation pass (#859b) to compare/merge note CONTENT, not just metadata.
 * Returns an empty body ('') alongside undefined metadata when the file is
 * missing or malformed — never throws.
 */
export async function readNoteFull(
  abs: string,
): Promise<{ id?: string; created?: string; tags: string[]; body: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch {
    return { tags: [], body: '' };
  }
  const norm = raw.replace(/\r\n/g, '\n');
  if (!norm.startsWith('---\n')) return { tags: [], body: norm.trim() };
  const closeIdx = norm.slice(4).search(/\n---\s*(\n|$)/);
  if (closeIdx === -1) return { tags: [], body: norm.trim() };
  const fm = norm.slice(4, 4 + closeIdx);
  const rest = norm.slice(4 + closeIdx + 1);
  const nl = rest.indexOf('\n');
  const body = (nl === -1 ? '' : rest.slice(nl + 1)).trim();
  const out: { id?: string; created?: string } = {};
  let tags: string[] = [];
  for (const line of fm.split('\n')) {
    const idCreated = /^(id|created):\s*(.+)$/.exec(line.trim());
    if (idCreated) {
      out[idCreated[1] as 'id' | 'created'] = idCreated[2].trim().replace(/^["']|["']$/g, '');
      continue;
    }
    const tagsMatch = /^tags:\s*\[(.*)\]$/.exec(line.trim());
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(',')
        .map((t) => t.trim().replace(/^["']|["']$/g, ''))
        .filter((t) => t.length > 0);
    }
  }
  return { ...out, tags, body };
}

export interface MemoryVaultWriteOptions {
  /** Override the memory dir (tests point this at a temp fixture). */
  memoryDir?: string;
  /** Index service to keep the derived index in sync (defaults to a new one). */
  index?: MemoryIndexService;
}

/**
 * Vault-first `remember`: dedup, write the markdown note FIRST, then upsert the
 * derived index. Returns the note's id + vault-relative path.
 *
 * @throws {MemoryWriteError} on invalid kind, empty content, or a path that
 *   would escape the memory dir — in every such case NOTHING is written.
 */
export async function rememberToVault(
  input: RememberInput,
  options: MemoryVaultWriteOptions = {},
): Promise<RememberResult> {
  const content = typeof input.content === 'string' ? input.content : '';
  if (content.trim() === '') {
    throw new MemoryWriteError('content is required');
  }
  const kind = assertValidKind(input.kind);
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
  const source = typeof input.source === 'string' && input.source.trim() !== ''
    ? input.source
    : 'agent';

  const memoryDir = options.memoryDir ?? resolveMemoryDirPath();
  const index = options.index ?? new MemoryIndexService();
  const kindDir = path.join(memoryDir, kind);

  // --- DEDUP / MERGE-ON-CAPTURE -----------------------------------------------
  // 1) If the caller supplied an id, that is the dedup key: a note with that id
  //    in this kind's dir is updated in place. 2) Otherwise the normalized
  //    content key picks the basename, so identical content maps to one file.
  // 3) Issue #859a — if neither of those finds an exact match, scan this kind's
  //    notes for one that RESTATES/EXTENDS the same theme (high lexical
  //    similarity) and MERGE onto it instead of writing a near-duplicate. This
  //    is deliberately scoped to the no-explicit-id path only: an id-keyed
  //    remember (e.g. a scheduled task updating its own note) always means
  //    "update this exact note", never "find something similar".
  let id = typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim() : '';
  let relPath: string;
  let createdToPreserve: string | undefined;
  let contentToWrite = content;

  if (id) {
    // Find an existing note in this kind's dir carrying the same frontmatter id.
    const existingRel = await findNoteByIdInKind(kindDir, memoryDir, id);
    if (existingRel) {
      relPath = existingRel;
      const meta = await readNoteMeta(resolveWithinMemoryDir(memoryDir, existingRel));
      createdToPreserve = meta.created;
    } else {
      const slug = slugForNote(content.split('\n')[0] ?? content, id);
      relPath = path.join(kind, `${slug}.md`);
    }
  } else {
    // Content-keyed dedup: deterministic slug from normalized content. A second
    // POST with identical content resolves the same file (updates in place).
    const slug = slugForNote(normalizeContentKey(content), generateUlid());
    relPath = path.join(kind, `${slug}.md`);
    // Reuse the existing note's id + created if the slug file already exists.
    const abs = resolveWithinMemoryDir(memoryDir, relPath);
    const meta = await readNoteMeta(abs);
    if (meta.id) {
      id = meta.id;
      createdToPreserve = meta.created;
    } else {
      // No exact content-key match — look for a note that GENUINELY overlaps
      // in theme (same kind, high similarity) and merge onto it instead of
      // creating a near-duplicate file.
      const similar = await findBestSimilarNoteInKind(kindDir, memoryDir, content);
      if (similar) {
        relPath = similar.relPath;
        id = similar.id;
        const meta2 = await readNoteMeta(resolveWithinMemoryDir(memoryDir, similar.relPath));
        createdToPreserve = meta2.created;
        contentToWrite = mergeMemoryContent(similar.body, content);
      }
    }
  }

  if (!id || !isUlid(id)) {
    // Assign a fresh ULID when absent (or when the supplied id is non-ULID it
    // is still honored as the dedup key above, but we normalize to it as-is).
    id = id || generateUlid();
  }

  // Path-traversal guard: resolve + assert BEFORE any filesystem mutation.
  const abs = resolveWithinMemoryDir(memoryDir, relPath);

  const now = isoDate();
  const fm: NoteFrontmatter = {
    id,
    kind,
    tags,
    created: createdToPreserve ?? now,
    updated: now,
    source,
  };

  // --- VAULT-FIRST WRITE -----------------------------------------------------
  // If this throws, we return before touching the index (mandatory ordering).
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, renderMemoryNote(fm, contentToWrite), 'utf8');

  // --- DERIVED INDEX (only after the write succeeded) ------------------------
  // Canonical index key = path relative to the VAULT ROOT (e.g.
  // `memory/fact/abc.md`), the SAME form the scan/rebuild path stamps. Keying
  // on this one form means a write-then-rebuild yields exactly one row, not two.
  const vaultRelKey = toVaultRelativeKey(resolveVaultRootForMemoryDir(memoryDir), abs);
  await index.upsertNote({
    sourceId: vaultRelKey,
    parsed: { kind, tags, content: contentToWrite.trim() },
  });

  logger.info(`[MemoryWrite] remembered note (kind=${kind} path=${vaultRelKey})`);
  return { id, path: vaultRelKey, kind };
}

/**
 * Scan a kind's dir for a note whose frontmatter `id` equals `id`. Returns the
 * vault-relative path or null. Bounded to the one kind dir (cheap).
 */
async function findNoteByIdInKind(
  kindDir: string,
  memoryDir: string,
  id: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(kindDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const abs = path.join(kindDir, name);
    const meta = await readNoteMeta(abs);
    if (meta.id === id) {
      return path.relative(memoryDir, abs);
    }
  }
  return null;
}

/**
 * Issue #859a — merge-on-capture: scan a kind's dir for the note whose body
 * is MOST similar to `content` (Jaccard over tokens), returning it only if it
 * clears {@link MEMORY_MERGE_THRESHOLD}. Returns null when the dir has no
 * notes, or none clears the bar — the caller then falls through to writing a
 * new note, so genuinely distinct memories are never forced together.
 *
 * Bounded to the ONE kind dir: merging is intentionally scoped to same-kind
 * memories only (a `fact` and a `preference` that happen to share wording are
 * never merged into each other — different kinds are different themes by
 * construction).
 */
async function findBestSimilarNoteInKind(
  kindDir: string,
  memoryDir: string,
  content: string,
): Promise<{ relPath: string; id: string; body: string } | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(kindDir);
  } catch {
    return null;
  }
  let best: { relPath: string; id: string; body: string; score: number } | null = null;
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const abs = path.join(kindDir, name);
    const full = await readNoteFull(abs);
    if (!full.id) continue;
    const score = textSimilarity(content, full.body);
    if (score >= MEMORY_MERGE_THRESHOLD && (!best || score > best.score)) {
      best = { relPath: path.relative(memoryDir, abs), id: full.id, body: full.body, score };
    }
  }
  return best ? { relPath: best.relPath, id: best.id, body: best.body } : null;
}

/**
 * Vault-first `forget`: remove the note FILE (confined to the memory dir) and
 * then remove the derived index row. The index row's `sourceId` is the
 * canonical VAULT-ROOT-relative note path (e.g. `memory/fact/abc.md`); it is
 * mapped back to a memory-dir-relative path before the boundary guard. Returns
 * true when the index row existed.
 *
 * Path safety: the resulting relative path is asserted inside the memory dir
 * before any unlink; a path that escapes is rejected and nothing is deleted.
 */
export async function forgetFromVault(
  vaultRelKey: string,
  options: MemoryVaultWriteOptions = {},
): Promise<void> {
  const memoryDir = options.memoryDir ?? resolveMemoryDirPath();
  // Map the canonical vault-root-relative key back to a memory-dir-relative
  // path for the existing boundary guard. Absolute / traversal inputs survive
  // as still-escaping relatives, so resolveWithinMemoryDir rejects them.
  const relPath = path.isAbsolute(vaultRelKey)
    ? vaultRelKey
    : vaultKeyToMemoryDirRelative(memoryDir, vaultRelKey);
  const abs = resolveWithinMemoryDir(memoryDir, relPath);
  try {
    await fs.unlink(abs);
    logger.info(`[MemoryWrite] forgot note (path=${relPath})`);
  } catch (err: unknown) {
    // Missing file is fine — the index row removal is still attempted by the
    // caller. Any other error propagates.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}

/**
 * Issue #859d (forget-404 bug fix) — resolve a memory by the id `remember()`
 * RETURNS to its caller (the note's frontmatter `id`, a ULID), which is a
 * DIFFERENT id space from the derived index row's own `agent_memory.id` (a
 * randomUUID minted independently by `upsertBySourceAsync`). Scans every kind
 * dir under the memory dir for a note whose frontmatter `id` matches, then
 * looks up the corresponding index row via its canonical vault-relative path.
 *
 * Returns null when no note carries that frontmatter id (or the matching note
 * has no corresponding index row yet) — callers treat that as "not found".
 */
export async function findMemoryRowByRememberId(
  rememberId: string,
  repo: AgentMemoryRepository,
  options: MemoryVaultWriteOptions = {},
): Promise<AgentMemory | null> {
  const memoryDir = options.memoryDir ?? resolveMemoryDirPath();
  let kindDirs: string[];
  try {
    kindDirs = (await fs.readdir(memoryDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }

  for (const kind of kindDirs) {
    const kindDir = path.join(memoryDir, kind);
    const relPath = await findNoteByIdInKind(kindDir, memoryDir, rememberId);
    if (!relPath) continue;
    const abs = resolveWithinMemoryDir(memoryDir, relPath);
    const vaultRelKey = toVaultRelativeKey(resolveVaultRootForMemoryDir(memoryDir), abs);
    const rows = await repo.listAsync(undefined, undefined, 1000);
    const match = rows.find((r) => r.sourceId === vaultRelKey);
    if (match) return match;
  }
  return null;
}

/**
 * Locate a note anywhere under the memory dir by its frontmatter `id`.
 * Returns its current kind (the containing directory name), vault-relative
 * path, and full parsed content (including tags) — or null if no note
 * carries that id.
 */
async function findNoteAnywhereById(
  memoryDir: string,
  rememberId: string,
): Promise<
  { kind: MemoryKind; relPath: string; abs: string; id: string; created?: string; tags: string[]; body: string } | null
> {
  let kindDirs: string[];
  try {
    kindDirs = (await fs.readdir(memoryDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }
  for (const kind of kindDirs) {
    if (!(VALID_MEMORY_KINDS as readonly string[]).includes(kind)) continue;
    const kindDir = path.join(memoryDir, kind);
    const relPath = await findNoteByIdInKind(kindDir, memoryDir, rememberId);
    if (!relPath) continue;
    const abs = resolveWithinMemoryDir(memoryDir, relPath);
    const full = await readNoteFull(abs);
    if (!full.id) continue;
    return {
      kind: kind as MemoryKind,
      relPath,
      abs,
      id: full.id,
      created: full.created,
      tags: full.tags,
      body: full.body,
    };
  }
  return null;
}

/**
 * #886 — read a note directly at a known memory-dir-relative path (the form
 * `agent_memory.source_id` resolves to via `vaultKeyToMemoryDirRelative`).
 * Used as the fallback when frontmatter-`id` lookup misses: vault-synced
 * notes that predate the `id:` convention are still editable by path. Mints
 * a fresh ULID for id-less notes so the rewrite backfills one. Returns null
 * when the file doesn't exist or sits under an unknown kind dir.
 */
async function readNoteAtRelPath(
  memoryDir: string,
  relPath: string,
): Promise<{
  kind: MemoryKind;
  relPath: string;
  abs: string;
  id: string;
  created?: string;
  tags: string[];
  body: string;
} | null> {
  const kind = relPath.split(path.sep)[0] ?? '';
  if (!(VALID_MEMORY_KINDS as readonly string[]).includes(kind)) return null;
  let abs: string;
  try {
    abs = resolveWithinMemoryDir(memoryDir, relPath);
    await fs.access(abs);
  } catch {
    return null;
  }
  const full = await readNoteFull(abs);
  return {
    kind: kind as MemoryKind,
    relPath,
    abs,
    id: full.id ?? generateUlid(),
    created: full.created,
    tags: full.tags,
    body: full.body,
  };
}

export interface UpdateMemoryPatch {
  content?: string;
  kind?: string;
  tags?: string[];
}

/**
 * Issue #862 — edit-in-place: update an existing memory's content/kind/tags,
 * writing through to BOTH the vault note file AND the derived index (no
 * divergence — mirrors the vault-first discipline of `rememberToVault`).
 *
 * `rememberId` is resolved by scanning every kind dir for a note whose
 * frontmatter `id` matches — the SAME id space `remember()` returns to its
 * caller (mirrors the #859d forget fix). Fields omitted from `patch` are left
 * unchanged (content/tags carry over from the existing note; kind carries
 * over unless explicitly patched).
 *
 * Changing `kind` MOVES the note to the new kind's directory (a note's home
 * in the vault reflects its kind) — the old file is removed, a new one
 * written, and the index is re-keyed under the new vault-relative path.
 *
 * Returns null when no note carries `rememberId` — a safe no-op, nothing
 * written. Throws {@link MemoryWriteError} for an invalid `kind` or content
 * that would end up empty — nothing is written in either case.
 */
export async function updateMemoryInVault(
  rememberId: string,
  patch: UpdateMemoryPatch,
  options: MemoryVaultWriteOptions & {
    /**
     * #886 — memory-dir-relative note path to fall back to when no note
     * carries `rememberId` in its frontmatter. Lets the DB-row-id edit path
     * (agentMemoryService.update) reach vault-synced notes that predate the
     * frontmatter-`id` convention (several #801-era notes have none); the
     * rewrite then backfills a fresh ULID into the note.
     */
    relPathFallback?: string;
  } = {},
): Promise<RememberResult | null> {
  const memoryDir = options.memoryDir ?? resolveMemoryDirPath();
  const index = options.index ?? new MemoryIndexService();

  let found = await findNoteAnywhereById(memoryDir, rememberId);
  if (!found && options.relPathFallback) {
    found = await readNoteAtRelPath(memoryDir, options.relPathFallback);
  }
  if (!found) return null;

  const newKind = patch.kind !== undefined ? assertValidKind(patch.kind) : found.kind;
  const newContent = patch.content !== undefined ? patch.content : found.body;
  if (typeof newContent !== 'string' || newContent.trim() === '') {
    throw new MemoryWriteError('content is required');
  }
  const newTags = patch.tags !== undefined ? patch.tags.map(String) : found.tags;

  const oldVaultRelKey = toVaultRelativeKey(resolveVaultRootForMemoryDir(memoryDir), found.abs);

  let newRelPath = found.relPath;
  let newAbs = found.abs;
  const kindChanged = newKind !== found.kind;
  if (kindChanged) {
    const slugSource = patch.content !== undefined ? newContent.split('\n')[0] ?? newContent : path.basename(found.relPath, '.md');
    const slug = slugForNote(slugSource, found.id);
    newRelPath = path.join(newKind, `${slug}.md`);
    newAbs = resolveWithinMemoryDir(memoryDir, newRelPath);
  }

  const fm: NoteFrontmatter = {
    id: found.id,
    kind: newKind,
    tags: newTags,
    created: found.created ?? isoDate(),
    updated: isoDate(),
    source: 'agent',
  };

  await fs.mkdir(path.dirname(newAbs), { recursive: true });
  await fs.writeFile(newAbs, renderMemoryNote(fm, newContent), 'utf8');

  if (kindChanged) {
    try {
      await fs.unlink(found.abs);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
    await index.removeNote(oldVaultRelKey);
  }

  const newVaultRelKey = toVaultRelativeKey(resolveVaultRootForMemoryDir(memoryDir), newAbs);
  await index.upsertNote({
    sourceId: newVaultRelKey,
    parsed: { kind: newKind, tags: newTags, content: newContent.trim() },
  });

  logger.info(`[MemoryWrite] updated note (kind=${newKind} path=${newVaultRelKey})`);
  return { id: found.id, path: newVaultRelKey, kind: newKind };
}
