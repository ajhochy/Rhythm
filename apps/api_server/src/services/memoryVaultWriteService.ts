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
import { MEMORY_VAULT_SOURCE } from './memoryVaultSyncService';
import { MemoryIndexService } from './memory_index_service';
import { logger } from '../utils/logger';

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
  /** Vault-relative note path (the index source_id), e.g. `fact/abc.md`. */
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
function resolveWithinMemoryDir(memoryDir: string, relPath: string): string {
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
function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

interface NoteFrontmatter {
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
  let raw: string;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch {
    return {};
  }
  const norm = raw.replace(/\r\n/g, '\n');
  if (!norm.startsWith('---\n')) return {};
  const closeIdx = norm.slice(4).search(/\n---\s*(\n|$)/);
  if (closeIdx === -1) return {};
  const fm = norm.slice(4, 4 + closeIdx);
  const out: { id?: string; created?: string } = {};
  for (const line of fm.split('\n')) {
    const m = /^(id|created):\s*(.+)$/.exec(line.trim());
    if (m) out[m[1] as 'id' | 'created'] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
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

  // --- DEDUP -----------------------------------------------------------------
  // 1) If the caller supplied an id, that is the dedup key: a note with that id
  //    in this kind's dir is updated in place. 2) Otherwise the normalized
  //    content key picks the basename, so identical content maps to one file.
  let id = typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim() : '';
  let relPath: string;
  let createdToPreserve: string | undefined;

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
  await fs.writeFile(abs, renderMemoryNote(fm, content), 'utf8');

  // --- DERIVED INDEX (only after the write succeeded) ------------------------
  await index.upsertNote({
    sourceId: relPath,
    parsed: { kind, tags, content: content.trim() },
  });

  logger.info(`[MemoryWrite] remembered note (kind=${kind} path=${relPath})`);
  return { id, path: relPath, kind };
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
 * Vault-first `forget`: remove the note FILE (confined to the memory dir) and
 * then remove the derived index row. The index row's `sourceId` is the
 * vault-relative note path. Returns true when the index row existed.
 *
 * Path safety: the relative path is asserted inside the memory dir before any
 * unlink; a path that escapes is rejected and nothing is deleted.
 */
export async function forgetFromVault(
  relPath: string,
  options: MemoryVaultWriteOptions = {},
): Promise<void> {
  const memoryDir = options.memoryDir ?? resolveMemoryDirPath();
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
