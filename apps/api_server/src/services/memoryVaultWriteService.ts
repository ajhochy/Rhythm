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
  isReservedVaultFilename,
  parseNote,
  resolveVaultRootForMemoryDir,
  toVaultRelativeKey,
  vaultKeyToMemoryDirRelative,
} from './memoryVaultSyncService';
import { MemoryIndexService } from './memory_index_service';
import { regenerateMemoryVaultNavigation } from './memory_vault_index_writer';
import {
  enqueueMemoryVaultLog,
  localCalendarDate as auditLocalCalendarDate,
} from './memory_vault_log';
import {
  AgentMemoryRepository,
  type AgentMemory,
} from '../repositories/agent_memory_repository';
import { logger } from '../utils/logger';
import {
  MEMORY_MERGE_THRESHOLD,
  MemoryAttributionMergeError,
  mergeAttributedMemoryContent,
  textSimilarity,
  type AttributedMemoryMergeResult,
} from './memory_similarity';
import {
  DEFAULT_MEMORY_ACTOR,
  MEMORY_SOURCE_ID_PATTERN,
  VALID_MEMORY_KINDS,
  VALID_MEMORY_STATUSES,
  extractMemoryBodyLinks,
  frontmatterString,
  generatedMetadata,
  isReversedMemoryUsageWindow,
  memorySources,
  memoryUsageWindow,
  mergeLifecycleMetadata,
  parseActor,
  parseMemoryNote,
  renderMemoryNote,
  staleAfter,
  verificationEntries,
  type MemoryKind,
  type MemorySource,
  type MemoryStatus,
  type MemoryUsageWindow,
  type NoteFrontmatter,
  type VerificationEntry,
} from './memory_note_format';

/** Allowed memory kinds — must match memoryVaultSyncService's VALID_KINDS. */
export { VALID_MEMORY_KINDS, renderMemoryNote };
export type { MemoryKind, NoteFrontmatter };

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
  /** Optional source-object id paired with `source` (for example a session id). */
  sourceId?: string;
  /** Explicit agent-session context; automatically stamps an OKF source. */
  sessionId?: string;
  /** Service-resolved ambient Rhythm session; never accepted directly from HTTP. */
  contextSessionId?: string;
  /** Optional OKF per-claim source records. Invalid/missing ids are ignored. */
  sources?: MemorySource[];
  /** Optional OKF usage window, retained for round-trip fidelity. */
  usageWindow?: MemoryUsageWindow;
  /** Optional portable links to existing memory notes. */
  links?: MemoryLinkInput[];
  /** OKF lifecycle state. New notes default to stable. */
  status?: MemoryStatus;
  /** Optional YYYY-MM-DD shelf-life boundary. */
  staleAfter?: string;
  /** Optional machine/human confirmations with UTC timestamps. */
  verified?: VerificationEntry[];
}

export interface MemoryLinkInput {
  target: string;
  label?: string;
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

function assertValidStatus(status: unknown): MemoryStatus | undefined {
  if (status === undefined) return undefined;
  if (
    typeof status === 'string' &&
    (VALID_MEMORY_STATUSES as readonly string[]).includes(status)
  ) {
    return status as MemoryStatus;
  }
  throw new MemoryWriteError(
    `Invalid memory status "${String(status)}". Allowed: ${VALID_MEMORY_STATUSES.join('|')}.`,
  );
}

function assertValidStaleAfter(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = staleAfter({ stale_after: value });
  if (typeof value !== 'string' || normalized === undefined) {
    throw new MemoryWriteError('staleAfter must be a valid YYYY-MM-DD date.');
  }
  return normalized;
}

function assertValidVerified(
  value: unknown,
): VerificationEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new MemoryWriteError('verified must be an array.');
  }
  const normalized = verificationEntries({ verified: value });
  if (normalized.length !== value.length) {
    throw new MemoryWriteError(
      'Each verified entry requires a valid OKF actor and ISO-8601 UTC timestamp.',
    );
  }
  return normalized;
}

function sessionFootnoteId(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stable = safe || Buffer.from(sessionId).toString('base64url');
  return stable.startsWith('sess-') ? stable : `sess-${stable}`;
}

function captureSources(
  input: RememberInput,
  source: string,
): {
  sources: MemorySource[];
  supplied: boolean;
} {
  for (const candidate of input.sources ?? []) {
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    if (id && !MEMORY_SOURCE_ID_PATTERN.test(id)) {
      throw new MemoryWriteError(
        'Each source id must match [A-Za-z0-9_-]+.',
      );
    }
  }
  const sources = memorySources({ sources: input.sources });
  const sourceKind = source.trim().toLowerCase();
  const sourceSessionId = typeof input.sourceId === 'string' &&
      ['agent-session', 'session', 'conversation'].includes(sourceKind)
    ? input.sourceId.trim()
    : '';
  const explicitSessionId = typeof input.sessionId === 'string' &&
      input.sessionId.trim() !== ''
    ? input.sessionId.trim()
    : sourceSessionId;
  const ambientSessionId = typeof input.contextSessionId === 'string' &&
      input.contextSessionId.trim() !== ''
    ? input.contextSessionId.trim()
    : '';
  const sessionIds = Array.from(
    new Set([ambientSessionId, explicitSessionId].filter(Boolean)),
  );
  const canonicalIds = new Set<string>();
  for (const sessionId of sessionIds) {
    let automatic: MemorySource = {
      id: sessionFootnoteId(sessionId),
      resource: `rhythm://agent-session/${encodeURIComponent(sessionId)}`,
    };
    const existingIndex = sources.findIndex(({ id }) => id === automatic.id);
    if (existingIndex >= 0) {
      if (canonicalIds.has(automatic.id) &&
          sources[existingIndex].resource !== automatic.resource) {
        let suffix = 2;
        while (sources.some(({ id }) => id === `${automatic.id}-${suffix}`)) {
          suffix += 1;
        }
        automatic = { ...automatic, id: `${automatic.id}-${suffix}` };
        sources.push(automatic);
        canonicalIds.add(automatic.id);
      } else {
        // The runtime-derived session resource is canonical. A caller may add
        // descriptive metadata, but cannot spoof or suppress provenance by
        // reusing the automatic id with a different resource.
        sources[existingIndex] = {
          ...sources[existingIndex],
          resource: automatic.resource,
        };
        canonicalIds.add(automatic.id);
      }
    } else {
      sources.push(automatic);
      canonicalIds.add(automatic.id);
    }
  }
  return {
    sources,
    supplied: input.sources !== undefined || sessionIds.length > 0,
  };
}

function appendVerificationHistory(
  frontmatter: Record<string, unknown>,
  incoming: VerificationEntry[],
): VerificationEntry[] | undefined {
  const combined: VerificationEntry[] = [];
  const seen = new Set<string>();
  const existing = Array.isArray(frontmatter.verified)
    ? frontmatter.verified
    : [];
  for (const rawEntry of existing) {
    const normalized = verificationEntries({ verified: [rawEntry] })[0];
    if (!normalized) {
      // Unknown entries are retained structurally for forward
      // compatibility even though this version cannot interpret them.
      combined.push(rawEntry as VerificationEntry);
      continue;
    }
    const key = `${normalized.by}\u0000${normalized.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(normalized);
  }
  for (const entry of incoming) {
    const key = `${entry.by}\u0000${entry.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(entry);
  }
  return combined.length > 0 ? combined : undefined;
}

function appendSourceHistory(
  frontmatter: Record<string, unknown>,
  incoming: MemorySource[],
): MemorySource[] | undefined {
  const combined = memorySources({
    sources: [
      ...(Array.isArray(frontmatter.sources) ? frontmatter.sources : []),
      ...incoming,
    ],
  });
  return combined.length > 0 ? combined : undefined;
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

async function validatedVaultDestination(
  memoryDir: string,
  destination: string,
): Promise<{
  destination: string;
  parent: string;
  parentDevice: number;
  parentInode: number;
}> {
  await fs.mkdir(memoryDir, { recursive: true });
  const lexicalRoot = path.resolve(memoryDir);
  const lexicalDestination = path.resolve(destination);
  const rel = path.relative(lexicalRoot, lexicalDestination);
  if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new MemoryWriteError(`Note path escapes the memory dir: ${destination}`);
  }

  const realRoot = await fs.realpath(lexicalRoot);
  const parentSegments = path.dirname(rel) === '.'
    ? []
    : path.dirname(rel).split(path.sep);
  let current = realRoot;
  for (const segment of parentSegments) {
    const candidate = path.join(current, segment);
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) {
        throw new MemoryWriteError(
          `Memory-vault destination contains a symlink: ${destination}`,
        );
      }
      if (!stat.isDirectory()) {
        throw new MemoryWriteError(
          `Memory-vault destination parent is not a directory: ${destination}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.mkdir(candidate);
      const created = await fs.lstat(candidate);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new MemoryWriteError(
          `Memory-vault destination parent is unsafe: ${destination}`,
        );
      }
    }
    current = candidate;
  }

  const realParent = await fs.realpath(current);
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) {
    throw new MemoryWriteError(
      `Memory-vault destination parent escapes the vault: ${destination}`,
    );
  }
  const parentStat = await fs.lstat(realParent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new MemoryWriteError(
      `Memory-vault destination parent is unsafe: ${destination}`,
    );
  }
  const realDestination = path.join(realParent, path.basename(rel));
  try {
    const destinationStat = await fs.lstat(realDestination);
    if (destinationStat.isSymbolicLink()) {
      throw new MemoryWriteError(
        `Memory-vault destination is a symlink: ${destination}`,
      );
    }
    if (!destinationStat.isFile()) {
      throw new MemoryWriteError(
        `Memory-vault destination is not a regular file: ${destination}`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    destination: realDestination,
    parent: realParent,
    parentDevice: parentStat.dev,
    parentInode: parentStat.ino,
  };
}

async function writeVaultNoteAtomic(
  memoryDir: string,
  destination: string,
  rendered: string,
  beforePromotion?: (parent: string, destination: string) => Promise<void>,
  afterPromotion?: (parent: string, destination: string) => Promise<void>,
): Promise<void> {
  const validated = await validatedVaultDestination(memoryDir, destination);
  const temporary = path.join(
    validated.parent,
    `.${path.basename(destination)}.rhythm-${randomBytes(12).toString('hex')}.tmp`,
  );
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(rendered, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await beforePromotion?.(validated.parent, validated.destination);
    const revalidated = await validatedVaultDestination(memoryDir, destination);
    if (
      revalidated.parent !== validated.parent ||
      revalidated.destination !== validated.destination ||
      revalidated.parentDevice !== validated.parentDevice ||
      revalidated.parentInode !== validated.parentInode
    ) {
      throw new MemoryWriteError(
        `Memory-vault destination changed during write: ${destination}`,
      );
    }
    await fs.rename(temporary, validated.destination);
    await afterPromotion?.(validated.parent, validated.destination);
    const promoted = await validatedVaultDestination(memoryDir, destination);
    if (
      promoted.parentDevice !== validated.parentDevice ||
      promoted.parentInode !== validated.parentInode
    ) {
      throw new MemoryWriteError(
        `Memory-vault destination changed during promotion: ${destination}`,
      );
    }
    const destinationStat = await fs.lstat(promoted.destination);
    if (destinationStat.isSymbolicLink() || !destinationStat.isFile()) {
      throw new MemoryWriteError(
        `Memory-vault promoted note is unsafe: ${destination}`,
      );
    }
  } catch (error) {
    try {
      const parentStat = await fs.lstat(validated.parent);
      if (
        !parentStat.isSymbolicLink() &&
        parentStat.isDirectory() &&
        parentStat.dev === validated.parentDevice &&
        parentStat.ino === validated.parentInode
      ) {
        await fs.rm(temporary, { force: true });
      }
    } catch {
      // If the anchored parent moved, do not follow a replacement path merely
      // to clean up. The closed, randomly named temp may remain in the moved
      // directory, which is safer than unlinking through attacker-controlled
      // path state.
    }
    throw error;
  }
}

function decodeMemoryLinkTarget(target: string): string | null {
  try {
    let encoded = target.trim().replace(/\\/g, '/');
    const hash = encoded.indexOf('#');
    if (hash >= 0) encoded = encoded.slice(0, hash);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(encoded)) return null;
    const decoded = encoded
      .split('/')
      .map((segment) => {
        const value = decodeURIComponent(segment);
        if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
          throw new Error('encoded path separator');
        }
        return value;
      })
      .join('/');
    if (
      !decoded.toLowerCase().endsWith('.md') ||
      isReservedVaultFilename(path.basename(decoded))
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Canonicalize a memory-body link target to the same vault-root-relative
 * sourceId used by the derived index. This is lexical only: dangling links can
 * still be represented. Escapes resolve to null through the established
 * memory-dir boundary guard.
 */
export function canonicalMemoryLinkSourceId(
  memoryDir: string,
  fromSourceId: string,
  target: string,
): string | null {
  const decoded = decodeMemoryLinkTarget(target);
  if (!decoded) return null;
  const fromRel = vaultKeyToMemoryDirRelative(memoryDir, fromSourceId);
  try {
    resolveWithinMemoryDir(memoryDir, fromRel);
    const targetRel = decoded.startsWith('/')
      ? decoded.slice(1)
      : path.join(path.dirname(fromRel), decoded);
    const abs = resolveWithinMemoryDir(memoryDir, targetRel);
    return toVaultRelativeKey(resolveVaultRootForMemoryDir(memoryDir), abs);
  } catch {
    return null;
  }
}

/**
 * Resolve only real, regular, non-symlink note files. Broken or escaping links
 * return null and are never opened/read.
 */
export async function resolveMemoryLinkTarget(
  memoryDir: string,
  fromSourceId: string,
  target: string,
): Promise<string | null> {
  const sourceId = canonicalMemoryLinkSourceId(memoryDir, fromSourceId, target);
  if (!sourceId) return null;
  const rel = vaultKeyToMemoryDirRelative(memoryDir, sourceId);
  let abs: string;
  try {
    abs = resolveWithinMemoryDir(memoryDir, rel);
    const [rootReal, targetStat, targetReal] = await Promise.all([
      fs.realpath(memoryDir),
      fs.lstat(abs),
      fs.realpath(abs),
    ]);
    if (
      targetStat.isSymbolicLink() ||
      !targetStat.isFile() ||
      (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return sourceId;
}

function encodeMemoryLinkPathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Render a canonical sourceId as an absolute path from the memory root. */
export function absoluteMemoryLinkTarget(
  memoryDir: string,
  sourceId: string,
): string | null {
  const rel = vaultKeyToMemoryDirRelative(memoryDir, sourceId);
  try {
    resolveWithinMemoryDir(memoryDir, rel);
  } catch {
    return null;
  }
  return `/${rel
    .split(path.sep)
    .map(encodeMemoryLinkPathSegment)
    .join('/')}`;
}

function escapeMemoryLinkLabel(label: string): string {
  return label
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

async function appendResolvedMemoryLinks(
  body: string,
  links: MemoryLinkInput[] | undefined,
  memoryDir: string,
  fromSourceId: string,
): Promise<string> {
  if (!links || links.length === 0) return body;
  const existing = new Set(
    extractMemoryBodyLinks(body)
      .map((link) =>
        canonicalMemoryLinkSourceId(memoryDir, fromSourceId, link.target),
      )
      .filter((sourceId): sourceId is string => sourceId !== null),
  );
  const additions: string[] = [];
  let unresolved = 0;
  for (const link of links) {
    if (!link || typeof link.target !== 'string' || link.target.trim() === '') {
      unresolved += 1;
      continue;
    }
    const sourceId = await resolveMemoryLinkTarget(
      memoryDir,
      fromSourceId,
      link.target,
    );
    if (!sourceId) {
      unresolved += 1;
      continue;
    }
    if (existing.has(sourceId)) continue;
    const target = absoluteMemoryLinkTarget(memoryDir, sourceId);
    if (!target) {
      unresolved += 1;
      continue;
    }
    existing.add(sourceId);
    const fallback = path.basename(
      vaultKeyToMemoryDirRelative(memoryDir, sourceId),
      '.md',
    );
    const label = typeof link.label === 'string' && link.label.trim() !== ''
      ? link.label.trim()
      : fallback;
    additions.push(`[${escapeMemoryLinkLabel(label)}](${target})`);
  }
  if (unresolved > 0) {
    logger.warn(
      `[MemoryWrite] skipped ${unresolved} unresolved memory link${unresolved === 1 ? '' : 's'}`,
    );
  }
  return additions.length === 0
    ? body
    : `${body.trimEnd()}\n\n${additions.join('\n')}`;
}

/** Today's date as YYYY-MM-DD (matches the existing frontmatter convention). */
export function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
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
export interface ReadMemoryNote {
  id?: string;
  created?: string;
  tags: string[];
  body: string;
  /** Full arbitrary YAML mapping, retained for safe read-modify-write. */
  frontmatter: Record<string, unknown>;
}

export async function readNoteFull(abs: string): Promise<ReadMemoryNote> {
  let raw: string;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch {
    return { tags: [], body: '', frontmatter: {} };
  }
  const document = parseMemoryNote(raw);
  return {
    id: frontmatterString(document.frontmatter, 'id'),
    created: frontmatterString(document.frontmatter, 'created'),
    tags: document.tags,
    body: document.body,
    frontmatter: document.frontmatter,
  };
}

export interface MemoryVaultWriteOptions {
  /** Override the memory dir (tests point this at a temp fixture). */
  memoryDir?: string;
  /** Index service to keep the derived index in sync (defaults to a new one). */
  index?: MemoryIndexService;
  /** Test-only race barrier immediately before atomic note promotion. */
  beforeNotePromotion?: (
    parent: string,
    destination: string,
  ) => Promise<void>;
  /** Test-only race barrier immediately after atomic note promotion. */
  afterNotePromotion?: (
    parent: string,
    destination: string,
  ) => Promise<void>;
}

export interface VerifyMemoryOptions extends MemoryVaultWriteOptions {
  /** Optional replacement shelf-life boundary. Omission preserves the current value. */
  staleAfter?: string;
  /** Deterministic UTC instant for retries/tests; normal callers omit this. */
  at?: string;
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
  const requestedStatus = assertValidStatus(input.status);
  const requestedStaleAfter = assertValidStaleAfter(input.staleAfter);
  const requestedVerified = assertValidVerified(input.verified);
  const requestedSources = captureSources(input, source);
  const requestedUsageWindow = input.usageWindow !== undefined
    ? memoryUsageWindow({ usage_window: input.usageWindow })
    : undefined;
  if (isReversedMemoryUsageWindow(requestedUsageWindow)) {
    throw new MemoryWriteError(
      'usageWindow.from must not be later than usageWindow.to.',
    );
  }
  const generated = {
    by: DEFAULT_MEMORY_ACTOR,
    at: new Date().toISOString(),
  };

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
  let frontmatterToPreserve: Record<string, unknown> = {};
  let foundExisting = false;
  let semanticMerge = false;
  let contentToWrite = content;
  let attributionMerge: AttributedMemoryMergeResult | undefined;

  if (id) {
    // Find an existing note in this kind's dir carrying the same frontmatter id.
    const existingRel = await findNoteByIdInKind(kindDir, memoryDir, id);
    if (existingRel) {
      relPath = existingRel;
      const full = await readNoteFull(resolveWithinMemoryDir(memoryDir, existingRel));
      createdToPreserve = full.created;
      frontmatterToPreserve = full.frontmatter;
      foundExisting = true;
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
    const exact = await readNoteFull(abs);
    if (exact.id) {
      id = exact.id;
      createdToPreserve = exact.created;
      frontmatterToPreserve = exact.frontmatter;
      foundExisting = true;
      try {
        attributionMerge = mergeAttributedMemoryContent(
          {
            body: exact.body,
            sources: memorySources(exact.frontmatter),
            usageWindow: memoryUsageWindow(exact.frontmatter),
          },
          {
            body: content,
            sources: requestedSources.sources,
            usageWindow: requestedUsageWindow,
          },
        );
        contentToWrite = attributionMerge.body;
      } catch (err) {
        if (!(err instanceof MemoryAttributionMergeError)) throw err;
        logger.warn(
          `[MemoryWrite] rejected unsafe exact replay for ${relPath}: ${err.message}`,
        );
        throw new MemoryWriteError(
          'Exact replay could not be merged without invalid attribution.',
        );
      }
    } else {
      // No exact content-key match — look for a note that GENUINELY overlaps
      // in theme (same kind, high similarity) and merge onto it instead of
      // creating a near-duplicate file.
      const similar = await findBestSimilarNoteInKind(kindDir, memoryDir, content);
      if (similar) {
        try {
          attributionMerge = mergeAttributedMemoryContent(
            {
              body: similar.body,
              sources: memorySources(similar.frontmatter),
              usageWindow: memoryUsageWindow(similar.frontmatter),
            },
            {
              body: content,
              sources: requestedSources.sources,
              usageWindow: requestedUsageWindow,
            },
          );
          relPath = similar.relPath;
          id = similar.id;
          const meta2 = await readNoteMeta(
            resolveWithinMemoryDir(memoryDir, similar.relPath),
          );
          createdToPreserve = meta2.created;
          frontmatterToPreserve = similar.frontmatter;
          foundExisting = true;
          semanticMerge = true;
          contentToWrite = attributionMerge.body;
        } catch (err) {
          if (!(err instanceof MemoryAttributionMergeError)) throw err;
          logger.warn(
            `[MemoryWrite] skipped unsafe candidate ${similar.relPath}: ${err.message}`,
          );
        }
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
  const vaultRelKey = toVaultRelativeKey(
    resolveVaultRootForMemoryDir(memoryDir),
    abs,
  );
  contentToWrite = await appendResolvedMemoryLinks(
    contentToWrite,
    input.links,
    memoryDir,
    vaultRelKey,
  );

  const now = isoDate();
  const incomingLifecycle: Record<string, unknown> = {
    status: requestedStatus ?? 'stable',
    stale_after: requestedStaleAfter,
    verified: requestedVerified,
  };
  const mergedLifecycle = semanticMerge
    ? mergeLifecycleMetadata([frontmatterToPreserve, incomingLifecycle])
    : undefined;
  const fm: NoteFrontmatter = {
    ...frontmatterToPreserve,
    id,
    kind,
    tags,
    created: createdToPreserve ?? now,
    updated: now,
    source,
    ...(!foundExisting
      ? {
          status: requestedStatus ?? 'stable',
          stale_after: requestedStaleAfter,
          generated,
          verified: requestedVerified && requestedVerified.length > 0
            ? requestedVerified
            : undefined,
        }
      : {}),
    ...(foundExisting && !semanticMerge && requestedStatus !== undefined
      ? { status: requestedStatus }
      : {}),
    ...(foundExisting && !semanticMerge && requestedStaleAfter !== undefined
      ? { stale_after: requestedStaleAfter }
      : {}),
    ...(foundExisting && !semanticMerge && input.verified !== undefined
      ? {
          verified: appendVerificationHistory(
            frontmatterToPreserve,
            requestedVerified ?? [],
          ),
        }
      : {}),
    ...(semanticMerge
      ? {
          ...mergedLifecycle,
          generated: generatedMetadata(frontmatterToPreserve) ?? generated,
        }
      : {}),
    ...(attributionMerge
      ? {
          sources: attributionMerge.sources.length > 0
            ? attributionMerge.sources
            : undefined,
          usage_window: attributionMerge.usageWindow,
        }
      : {}),
    ...(!attributionMerge && requestedSources.supplied
      ? {
          sources: appendSourceHistory(
            frontmatterToPreserve,
            requestedSources.sources,
          ),
        }
      : {}),
    ...(!attributionMerge && input.usageWindow !== undefined
      ? { usage_window: requestedUsageWindow }
      : {}),
  };

  // --- VAULT-FIRST WRITE -----------------------------------------------------
  // If this throws, we return before touching the index (mandatory ordering).
  const rendered = renderMemoryNote(fm, contentToWrite);
  await writeVaultNoteAtomic(
    memoryDir,
    abs,
    rendered,
    options.beforeNotePromotion,
    options.afterNotePromotion,
  );
  await enqueueMemoryVaultLog(memoryDir, {
    reason: semanticMerge
      ? 'merge-on-capture'
      : foundExisting
        ? 'updated'
        : 'captured',
    actor: DEFAULT_MEMORY_ACTOR,
    noteSourceId: vaultRelKey,
  });

  // --- DERIVED INDEX (only after the write succeeded) ------------------------
  // Canonical index key = path relative to the VAULT ROOT (e.g.
  // `memory/fact/abc.md`), the SAME form the scan/rebuild path stamps. Keying
  // on this one form means a write-then-rebuild yields exactly one row, not two.
  await index.upsertNote({
    sourceId: vaultRelKey,
    parsed: parseNote(rendered),
  });
  await regenerateMemoryVaultNavigation(memoryDir);

  logger.info(`[MemoryWrite] remembered note (kind=${kind} path=${vaultRelKey})`);
  return { id, path: vaultRelKey, kind };
}

const lifecycleMutationTails = new Map<string, Promise<void>>();

/**
 * Serialize read-modify-write lifecycle changes per canonical vault note.
 *
 * A note is the durable source of truth, so the lock spans both its write and
 * the subsequent index refresh. Failures still release the queue, and unrelated
 * notes remain fully concurrent.
 */
async function withLifecycleMutationLock<T>(
  notePath: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const previous = lifecycleMutationTails.get(notePath) ?? Promise.resolve();
  const ready = previous.catch(() => undefined);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = ready.then(() => gate);
  lifecycleMutationTails.set(notePath, tail);

  await ready;
  try {
    return await mutation();
  } finally {
    release();
    if (lifecycleMutationTails.get(notePath) === tail) {
      lifecycleMutationTails.delete(notePath);
    }
  }
}

async function mutateMemoryLifecycle(
  sourceId: string,
  actor: string,
  options: VerifyMemoryOptions,
  status?: MemoryStatus,
): Promise<RememberResult | null> {
  if (!parseActor(actor)) {
    throw new MemoryWriteError('actor must follow the OKF actor convention.');
  }
  const at = options.at ?? new Date().toISOString();
  const replacementStaleAfter = assertValidStaleAfter(options.staleAfter);

  const memoryDir = options.memoryDir ?? resolveMemoryDirPath();
  const index = options.index ?? new MemoryIndexService();
  const relPath = vaultKeyToMemoryDirRelative(memoryDir, sourceId);
  const abs = resolveWithinMemoryDir(memoryDir, relPath);
  return withLifecycleMutationLock(abs, async () => {
    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw err;
    }

    const document = parseMemoryNote(raw);
    const auditRepo = new AgentMemoryRepository();
    const indexed = (await auditRepo.findBySourceIdsAsync(
      MEMORY_VAULT_SOURCE,
      [sourceId],
    ))[0];
    if (!indexed) return null;
    const previousChange = await auditRepo.findLatestChangeBySourceIdAsync(
      sourceId,
    );
    const rollbackTarget = previousChange?.id ?? null;
    const lastVerification = document.verified.length > 0
      ? document.verified[document.verified.length - 1]
      : null;
    const priorState = {
      status: document.status,
      staleAfter: document.staleAfter ?? null,
      verificationCount: document.verified.length,
      lastVerification: lastVerification
        ? {
            by: lastVerification.by,
            at: lastVerification.at,
            action: lastVerification.action ?? 'verified',
          }
        : null,
      sources: document.sources,
      generated: document.generated ?? null,
    };
    const sourceContext = {
      source: MEMORY_VAULT_SOURCE,
      sourceId,
      sources: document.sources,
    };
    const [entry] = verificationEntries({
      verified: [{
        by: actor,
        at,
        action: status === 'deprecated' ? 'deprecated' : 'verified',
        priorState,
        rollbackTarget,
        sourceContext,
      }],
    });
    if (!entry) {
      throw new MemoryWriteError('verification time must be an ISO-8601 UTC timestamp.');
    }
    const existingRaw = Array.isArray(document.frontmatter.verified)
      ? [...document.frontmatter.verified]
      : [];
    const duplicate = verificationEntries(document.frontmatter)
      .some((candidate) => (
        candidate.by === entry.by && candidate.at === entry.at
      ));
    const lifecycleChanged =
      !duplicate ||
      (status !== undefined && document.status !== status) ||
      (
        options.staleAfter !== undefined &&
        document.staleAfter !== replacementStaleAfter
      );
    if (!duplicate) existingRaw.push(entry);

    const id = frontmatterString(document.frontmatter, 'id') ?? generateUlid();
    const created = frontmatterString(document.frontmatter, 'created') ?? isoDate();
    const source = frontmatterString(document.frontmatter, 'source') ?? 'agent';
    const frontmatter: Record<string, unknown> = {
      ...document.frontmatter,
      id,
      kind: document.kind,
      tags: document.tags,
      created,
      updated: isoDate(),
      source,
      verified: existingRaw,
      ...(status !== undefined ? { status } : {}),
      ...(options.staleAfter !== undefined
        ? { stale_after: replacementStaleAfter }
        : {}),
    };
    const rendered = renderMemoryNote(frontmatter, document.body);

    // Vault-first by construction: an index error is allowed to propagate only
    // after the canonical note contains the completed mutation.
    await writeVaultNoteAtomic(
      memoryDir,
      abs,
      rendered,
      options.beforeNotePromotion,
      options.afterNotePromotion,
    );
    if (lifecycleChanged) {
      await enqueueMemoryVaultLog(memoryDir, {
        reason: status === 'deprecated' ? 'deprecated' : 'verified',
        actor,
        noteSourceId: sourceId,
        date: auditLocalCalendarDate(new Date(at)),
      });
    }
    await index.upsertNote({
      sourceId,
      parsed: parseNote(rendered),
    });
    if (lifecycleChanged) {
      await auditRepo.appendChangeAsync({
        memoryId: indexed.id,
        memorySourceId: sourceId,
        action: status === 'deprecated' ? 'deprecated' : 'verified',
        actor,
        changedAt: at,
        priorState,
        sourceContext,
      });
    }
    await regenerateMemoryVaultNavigation(memoryDir);

    return { id, path: sourceId, kind: document.kind };
  });
}

/**
 * Append one OKF verification event to a vault note and then refresh its
 * derived index row. Exact `(by, at)` retries are idempotent.
 */
export async function verifyMemory(
  sourceId: string,
  actor: string,
  options: VerifyMemoryOptions = {},
): Promise<RememberResult | null> {
  return mutateMemoryLifecycle(sourceId, actor, options);
}

/**
 * Non-destructively retire a vault note while preserving both the note and its
 * index row. The actor/time is recorded in the same append-only verification
 * history as an explicit confirmation.
 */
export async function deprecateMemory(
  sourceId: string,
  actor: string,
  options: Omit<VerifyMemoryOptions, 'staleAfter'> = {},
): Promise<RememberResult | null> {
  return mutateMemoryLifecycle(sourceId, actor, options, 'deprecated');
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
): Promise<{
  relPath: string;
  id: string;
  body: string;
  frontmatter: Record<string, unknown>;
} | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(kindDir);
  } catch {
    return null;
  }
  let best: {
    relPath: string;
    id: string;
    body: string;
    frontmatter: Record<string, unknown>;
    score: number;
  } | null = null;
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const abs = path.join(kindDir, name);
    const full = await readNoteFull(abs);
    if (!full.id) continue;
    const score = textSimilarity(content, full.body);
    if (score >= MEMORY_MERGE_THRESHOLD && (!best || score > best.score)) {
      best = {
        relPath: path.relative(memoryDir, abs),
        id: full.id,
        body: full.body,
        frontmatter: full.frontmatter,
        score,
      };
    }
  }
  return best
    ? {
        relPath: best.relPath,
        id: best.id,
        body: best.body,
        frontmatter: best.frontmatter,
      }
    : null;
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
  let removed = false;
  try {
    await fs.unlink(abs);
    removed = true;
    logger.info(`[MemoryWrite] forgot note (path=${relPath})`);
  } catch (err: unknown) {
    // Missing file is fine — the index row removal is still attempted by the
    // caller. Any other error propagates.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  if (removed) {
    await enqueueMemoryVaultLog(memoryDir, {
      reason: 'forgotten',
      actor: DEFAULT_MEMORY_ACTOR,
      noteSourceId: vaultRelKey,
    });
  }
  await regenerateMemoryVaultNavigation(memoryDir);
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
  {
    kind: MemoryKind;
    relPath: string;
    abs: string;
    id: string;
    created?: string;
    tags: string[];
    body: string;
    frontmatter: Record<string, unknown>;
  } | null
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
      frontmatter: full.frontmatter,
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
  frontmatter: Record<string, unknown>;
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
    frontmatter: full.frontmatter,
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
    ...found.frontmatter,
    id: found.id,
    kind: newKind,
    tags: newTags,
    created: found.created ?? isoDate(),
    updated: isoDate(),
    source: 'agent',
  };

  const rendered = renderMemoryNote(fm, newContent);
  await writeVaultNoteAtomic(
    memoryDir,
    newAbs,
    rendered,
    options.beforeNotePromotion,
    options.afterNotePromotion,
  );
  const newVaultRelKey = toVaultRelativeKey(resolveVaultRootForMemoryDir(memoryDir), newAbs);
  await enqueueMemoryVaultLog(memoryDir, {
    reason: 'updated',
    actor: DEFAULT_MEMORY_ACTOR,
    noteSourceId: newVaultRelKey,
  });

  if (kindChanged) {
    try {
      await fs.unlink(found.abs);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
    await index.removeNote(oldVaultRelKey);
  }

  await index.upsertNote({
    sourceId: newVaultRelKey,
    parsed: parseNote(rendered),
  });
  await regenerateMemoryVaultNavigation(memoryDir);

  logger.info(`[MemoryWrite] updated note (kind=${newKind} path=${newVaultRelKey})`);
  return { id: found.id, path: newVaultRelKey, kind: newKind };
}
