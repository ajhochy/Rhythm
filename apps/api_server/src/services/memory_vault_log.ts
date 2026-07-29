/**
 * Human-readable, append-only Memory-Vault mutation log (Issue #1196).
 *
 * Callers enqueue structured facts only: note paths, an OKF actor, and a
 * closed reason enum. Note bodies and caller-authored prose are deliberately
 * absent from the API so sensitive memory content cannot leak into history.
 *
 * Writes are serialized per vault and fail open. Mutation boundaries await the
 * returned promise so no derived writer outlives the mutation and races a
 * delete/shutdown. Tests may also use {@link flushMemoryVaultLog} to observe
 * work enqueued directly.
 */

import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { logger } from '../utils/logger';
import {
  formatActor,
  parseActor,
} from './memory_note_format';
import {
  isReservedVaultFilename,
  vaultKeyToMemoryDirRelative,
} from './memoryVaultSyncService';

export const MEMORY_VAULT_LOG_FILENAME = 'log.md';
export const MEMORY_VAULT_LOG_MAX_ENTRIES = 2_000;
export const MEMORY_VAULT_LOG_MAX_DAYS = 90;

export type MemoryVaultLogReason =
  | 'captured'
  | 'updated'
  | 'merge-on-capture'
  | 'verified'
  | 'deprecated'
  | 'forgotten'
  | 'consolidation-merge'
  | 'consolidation-retirement'
  | 'consolidation-revert';

export interface MemoryVaultLogEntry {
  reason: MemoryVaultLogReason;
  actor: string;
  /** Canonical vault-root-relative path used by the derived memory index. */
  noteSourceId: string;
  /** Merge counterpart paths. Ignored by reasons that do not use them. */
  relatedSourceIds?: string[];
  /** Calendar-date override for deterministic tests. Normal callers omit it. */
  date?: string;
}

export interface MemoryVaultLogOptions {
  /** Test-only bound override. Production defaults to 2,000 entries. */
  maxEntries?: number;
  /** Test-only age override. Production defaults to 90 days. */
  maxDays?: number;
  /** Test-only retention clock override. Defaults to the local calendar day. */
  today?: string;
}

interface LogSections {
  order: string[];
  entries: Map<string, string[]>;
}

interface RenderableLogEntry {
  date: string;
  line: string;
}

interface QueuedMemoryVaultLogEntry extends MemoryVaultLogEntry {
  eventId: string;
}

const DATE_HEADING = /^# (\d{4}-\d{2}-\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AUDIT_ACTOR_CHARS = 160;
const MAX_AUDIT_NOTE_PATH_CHARS = 512;
const MAX_RELATED_NOTE_LINKS = 12;
const CREDENTIAL_LIKE_PATH_PATTERNS = [
  /(?:^|[/_-])(?:sk|pk|rk)[_-][a-z0-9_-]{8,}/i,
  /(?:^|[/_-])gh[pousr]_[a-z0-9]{20,}/i,
  /(?:^|[/_-])xox[baprs]-[a-z0-9-]{10,}/i,
  /(?:^|[/_-])aiza[a-z0-9_-]{20,}/i,
  /(?:^|[/_-])akia[a-z0-9]{16}/i,
  /(?:^|[/_-])(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|bearer)[_=-]+[a-z0-9][a-z0-9_-]{5,}/i,
] as const;
const logWriteTails = new Map<string, Promise<void>>();

export function localCalendarDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validCalendarDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizedDate(value: string | undefined): string {
  return value && validCalendarDate(value) ? value : localCalendarDate();
}

function markdownText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/`/g, '\\`')
    .trim();
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function pseudonymousNoteLink(sourceId: string): string {
  const pseudonym = createHash('sha256')
    .update(sourceId)
    .digest('hex')
    .slice(0, 16);
  return `[Redacted memory ${pseudonym}](#redacted-memory-${pseudonym})`;
}

function isUnsafeAuditPath(value: string): boolean {
  return value.length > MAX_AUDIT_NOTE_PATH_CHARS ||
    CREDENTIAL_LIKE_PATH_PATTERNS.some((pattern) => pattern.test(value));
}

async function noteLink(
  memoryDir: string,
  sourceId: string,
): Promise<string | null> {
  const rel = vaultKeyToMemoryDirRelative(memoryDir, sourceId);
  try {
    // Dynamic import avoids a static cycle: canonical memory writes enqueue
    // audit work, while this derived writer reuses their confinement helper.
    const { resolveWithinMemoryDir } = await import('./memoryVaultWriteService');
    resolveWithinMemoryDir(memoryDir, rel);
  } catch {
    return null;
  }
  if (isUnsafeAuditPath(rel)) {
    return pseudonymousNoteLink(rel);
  }
  const label = markdownText(
    path.basename(rel, path.extname(rel))
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Memory',
  ).slice(0, 160);
  const target = `/${rel
    .split(path.sep)
    .map(encodePathSegment)
    .join('/')}`;
  return `[${label}](${target})`;
}

function safeActor(actor: string): string | null {
  const parsed = parseActor(actor);
  return parsed
    ? markdownText(formatActor(parsed)).slice(0, MAX_AUDIT_ACTOR_CHARS)
    : null;
}

async function renderEntryLine(
  memoryDir: string,
  entry: QueuedMemoryVaultLogEntry,
): Promise<RenderableLogEntry | null> {
  const actor = safeActor(entry.actor);
  const note = await noteLink(memoryDir, entry.noteSourceId);
  if (!actor || !note) return null;

  const relatedSourceIds = entry.relatedSourceIds ?? [];
  const related: string[] = [];
  for (const sourceId of relatedSourceIds.slice(0, MAX_RELATED_NOTE_LINKS)) {
    const link = await noteLink(memoryDir, sourceId);
    if (link && !related.includes(link)) related.push(link);
  }
  const omittedRelatedCount = Math.max(
    0,
    relatedSourceIds.length - MAX_RELATED_NOTE_LINKS,
  );

  let line: string;
  switch (entry.reason) {
    case 'captured':
      line = `**Creation** ${note} - captured by ${actor}.`;
      break;
    case 'updated':
      line = `**Update** ${note} - updated by ${actor}.`;
      break;
    case 'merge-on-capture':
      line = `**Update** ${note} - merged an incoming capture into this memory by ${actor}.`;
      break;
    case 'verified':
      line = `**Update** ${note} - verified by ${actor}.`;
      break;
    case 'deprecated':
      line = `**Deprecation** ${note} - deprecated by ${actor}.`;
      break;
    case 'forgotten':
      line = `**Deprecation** ${note} - forgotten by ${actor}.`;
      break;
    case 'consolidation-merge':
      line = related.length > 0
        ? `**Update** ${note} - merged ${related.join(', ')}${omittedRelatedCount > 0 ? ` and ${omittedRelatedCount} more` : ''} into this memory by ${actor}.`
        : `**Update** ${note} - consolidated by ${actor}.`;
      break;
    case 'consolidation-retirement':
      line = related.length > 0
        ? `**Deprecation** ${note} - superseded and merged into ${related[0]} by ${actor}.`
        : `**Deprecation** ${note} - retired by ${actor}.`;
      break;
    case 'consolidation-revert':
      line = `**Update** ${note} - reverted to its pre-consolidation state by ${actor}.`;
      break;
  }
  return {
    date: normalizedDate(entry.date),
    line: `${line} <!-- memory-audit:${entry.eventId} -->`,
  };
}

function emptySections(): LogSections {
  return { order: [], entries: new Map() };
}

function parseSections(raw: string): LogSections {
  const sections = emptySections();
  let activeDate: string | null = null;
  for (const rawLine of raw.split(/\r?\n/)) {
    const heading = DATE_HEADING.exec(rawLine.trim());
    if (heading && validCalendarDate(heading[1])) {
      activeDate = heading[1];
      if (!sections.entries.has(activeDate)) {
        sections.order.push(activeDate);
        sections.entries.set(activeDate, []);
      }
      continue;
    }
    const line = rawLine.trim();
    if (activeDate && line) {
      sections.entries.get(activeDate)!.push(line);
    }
  }
  sections.order.sort((a, b) => b.localeCompare(a));
  return sections;
}

function addNewest(
  sections: LogSections,
  entry: RenderableLogEntry,
): void {
  const existing = sections.entries.get(entry.date);
  if (existing) {
    existing.unshift(entry.line);
  } else {
    sections.entries.set(entry.date, [entry.line]);
    sections.order.push(entry.date);
    sections.order.sort((a, b) => b.localeCompare(a));
  }
}

function flattenSections(sections: LogSections): RenderableLogEntry[] {
  const entries: RenderableLogEntry[] = [];
  for (const date of sections.order) {
    for (const line of sections.entries.get(date) ?? []) {
      entries.push({ date, line });
    }
  }
  return entries;
}

function sectionsFromEntries(entries: RenderableLogEntry[]): LogSections {
  const sections = emptySections();
  for (const entry of entries) {
    if (!sections.entries.has(entry.date)) {
      sections.order.push(entry.date);
      sections.entries.set(entry.date, []);
    }
    sections.entries.get(entry.date)!.push(entry.line);
  }
  sections.order.sort((a, b) => b.localeCompare(a));
  return sections;
}

function renderSections(sections: LogSections): string {
  const chunks = sections.order
    .filter((date) => (sections.entries.get(date)?.length ?? 0) > 0)
    .map((date) => (
      [`# ${date}`, '', ...(sections.entries.get(date) ?? [])].join('\n')
    ));
  return chunks.length > 0 ? `${chunks.join('\n\n')}\n` : '';
}

async function readSections(filename: string): Promise<LogSections> {
  try {
    return parseSections(await fs.readFile(filename, 'utf8'));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return emptySections();
    }
    throw err;
  }
}

function isConfined(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function assertSafeOutput(
  canonicalRoot: string,
  filename: string,
): Promise<void> {
  const canonicalParent = await fs.realpath(path.dirname(filename));
  if (!isConfined(canonicalRoot, canonicalParent)) {
    throw new Error(`Audit-log parent escapes the memory dir: ${filename}`);
  }
  try {
    const target = await fs.lstat(filename);
    if (target.isSymbolicLink() || !target.isFile()) {
      throw new Error(`Audit-log output is not a regular file: ${filename}`);
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}

async function writeSections(
  canonicalRoot: string,
  filename: string,
  sections: LogSections,
): Promise<void> {
  await assertSafeOutput(canonicalRoot, filename);
  const rendered = renderSections(sections);
  try {
    if (await fs.readFile(filename, 'utf8') === rendered) return;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, rendered, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, filename);
  } catch (err) {
    try {
      await fs.unlink(temporary);
    } catch {
      // The temp file may not have been created or may already be renamed.
    }
    throw err;
  }
}

function cutoffDate(today: string, maxDays: number): string {
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - maxDays);
  return cutoff.toISOString().slice(0, 10);
}

async function appendEntry(
  memoryDir: string,
  entry: QueuedMemoryVaultLogEntry,
  options: MemoryVaultLogOptions,
): Promise<void> {
  try {
    const renderedEntry = await renderEntryLine(memoryDir, entry);
    if (!renderedEntry) {
      logger.warn('[MemoryVaultLog] skipped invalid structured audit entry');
      return;
    }
    const canonicalRoot = await fs.realpath(memoryDir);
    const mainPath = path.join(memoryDir, MEMORY_VAULT_LOG_FILENAME);
    await assertSafeOutput(canonicalRoot, mainPath);
    const allSections = await readSections(mainPath);
    addNewest(allSections, renderedEntry);

    const maxEntries = Math.max(
      1,
      Math.floor(options.maxEntries ?? MEMORY_VAULT_LOG_MAX_ENTRIES),
    );
    const maxDays = Math.max(
      1,
      Math.floor(options.maxDays ?? MEMORY_VAULT_LOG_MAX_DAYS),
    );
    const today = options.today && validCalendarDate(options.today)
      ? options.today
      : localCalendarDate();
    const ageCutoff = cutoffDate(today, maxDays - 1);
    const allEntries = flattenSections(allSections);
    const retained: RenderableLogEntry[] = [];
    const overflow: RenderableLogEntry[] = [];
    for (const candidate of allEntries) {
      if (candidate.date >= ageCutoff && retained.length < maxEntries) {
        retained.push(candidate);
      } else {
        overflow.push(candidate);
      }
    }

    // Archives are durable before the bounded main log is pruned. If any
    // archive fails, preserve every entry in main instead of dropping history.
    const overflowByYear = new Map<string, RenderableLogEntry[]>();
    for (const candidate of overflow) {
      const year = candidate.date.slice(0, 4);
      const yearEntries = overflowByYear.get(year) ?? [];
      yearEntries.push(candidate);
      overflowByYear.set(year, yearEntries);
    }
    try {
      for (const [year, yearEntries] of overflowByYear) {
        const archivePath = path.join(memoryDir, `log-archive-${year}.md`);
        if (!isReservedVaultFilename(path.basename(archivePath))) {
          throw new Error(`Invalid audit archive filename: ${archivePath}`);
        }
        await assertSafeOutput(canonicalRoot, archivePath);
        const archive = await readSections(archivePath);
        const existing = flattenSections(archive);
        const existingLines = new Set(existing.map(({ line }) => line));
        const merged = sectionsFromEntries([
          ...yearEntries.filter(({ line }) => !existingLines.has(line)),
          ...existing,
        ]);
        await writeSections(canonicalRoot, archivePath, merged);
      }
    } catch (err) {
      logger.warn(
        `[MemoryVaultLog] archive rotation failed; retaining main log: ${String(err)}`,
      );
      await writeSections(canonicalRoot, mainPath, allSections);
      return;
    }
    await writeSections(
      canonicalRoot,
      mainPath,
      sectionsFromEntries(retained),
    );
  } catch (err) {
    logger.warn(`[MemoryVaultLog] append failed: ${String(err)}`);
  }
}

/**
 * Queue one fail-open audit append and return the serialized work. Product
 * mutation boundaries await this promise so the vault has no hidden writer
 * after they resolve; direct callers may batch and await/flush explicitly.
 */
export function enqueueMemoryVaultLog(
  memoryDir: string,
  entry: MemoryVaultLogEntry,
  options: MemoryVaultLogOptions = {},
): Promise<void> {
  const key = path.resolve(memoryDir);
  const previous = logWriteTails.get(key) ?? Promise.resolve();
  const work = previous
    .catch(() => undefined)
    .then(() => appendEntry(
      memoryDir,
      { ...entry, eventId: randomUUID() },
      options,
    ));
  logWriteTails.set(key, work);
  void work.finally(() => {
    if (logWriteTails.get(key) === work) logWriteTails.delete(key);
  });
  return work;
}

/** Wait for all currently queued writes for one vault (tests/controlled shutdown). */
export async function flushMemoryVaultLog(memoryDir: string): Promise<void> {
  const key = path.resolve(memoryDir);
  while (logWriteTails.has(key)) {
    await logWriteTails.get(key);
  }
}
