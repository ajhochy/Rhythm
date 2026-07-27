/**
 * OKF navigation index generator (Issue #1194).
 *
 * These markdown files are human/agent navigation aids derived entirely from
 * the canonical memory notes. They are deliberately excluded from vault
 * scanning and may always be regenerated. Generation is deterministic,
 * write-if-changed, and fail-open so a navigation problem can never block
 * memory capture or an SQLite derived-index rebuild.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { logger } from '../utils/logger';
import {
  scanVaultNotes,
  type ParsedNote,
  type ScannedNote,
} from './memoryVaultSyncService';
import {
  VALID_MEMORY_KINDS,
  type MemoryKind,
} from './memory_note_format';

const KIND_TITLES: Record<MemoryKind, string> = {
  fact: 'Facts',
  person: 'People',
  project: 'Projects',
  preference: 'Preferences',
  context: 'Context',
};

export interface MemoryVaultNavigationSummary {
  written: number;
  unchanged: number;
  failed: number;
}

export interface MemoryVaultNavigationOptions {
  /** Stable calendar-date override for tests. Defaults to the service-local day. */
  today?: string;
  /** Sync/rebuild use false so a missing canonical vault remains a no-op. */
  createIfMissing?: boolean;
}

/** Apply the configured legacy/clean memory-subdirectory convention to a vault root. */
export function navigationMemoryDirForVaultRoot(vaultRoot: string): string {
  const subdir = process.env.MEMORY_VAULT_SUBDIR ?? 'memory';
  return subdir ? path.join(vaultRoot, subdir) : vaultRoot;
}

interface NavigationEntry {
  kind: MemoryKind;
  sourceId: string;
  title: string;
  description: string;
  deprecated: boolean;
  stale: boolean;
}

const navigationGenerationTails = new Map<string, Promise<void>>();

async function withNavigationGenerationLock<T>(
  memoryDir: string,
  generation: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(memoryDir);
  const previous = navigationGenerationTails.get(key) ?? Promise.resolve();
  const ready = previous.catch(() => undefined);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = ready.then(() => gate);
  navigationGenerationTails.set(key, tail);

  await ready;
  try {
    return await generation();
  } finally {
    release();
    if (navigationGenerationTails.get(key) === tail) {
      navigationGenerationTails.delete(key);
    }
  }
}

function localCalendarDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function markdownText(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim();
}

function slugTitle(sourceId: string): string {
  const slug = path.basename(sourceId, path.extname(sourceId));
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function firstBodyLine(parsed: ParsedNote): string {
  const line = parsed.content
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find(Boolean);
  return line?.replace(/^#{1,6}\s+/, '').trim() ?? 'No description.';
}

function toNavigationEntry(
  note: ScannedNote,
  today: string,
): NavigationEntry {
  const kind = note.parsed.kind as MemoryKind;
  const title = note.parsed.title?.trim() || slugTitle(note.sourceId);
  const description =
    note.parsed.description?.trim() || firstBodyLine(note.parsed);
  return {
    kind,
    sourceId: note.sourceId,
    title: markdownText(title),
    description: markdownText(description),
    deprecated: note.parsed.status === 'deprecated',
    stale: note.parsed.staleAfter !== undefined && note.parsed.staleAfter <= today,
  };
}

function markdownPath(value: string): string {
  return value
    .split(path.sep)
    .map((segment) => {
      if (segment === '.' || segment === '..') return segment;
      return encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) =>
          `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    })
    .join('/');
}

function isConfinedToRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function assertSafeNavigationOutput(
  canonicalRoot: string,
  abs: string,
): Promise<void> {
  const canonicalParent = await fs.realpath(path.dirname(abs));
  if (!isConfinedToRoot(canonicalRoot, canonicalParent)) {
    throw new Error(`Navigation parent escapes the memory dir: ${abs}`);
  }
  try {
    const target = await fs.lstat(abs);
    if (target.isSymbolicLink()) {
      throw new Error(`Navigation output cannot be a symbolic link: ${abs}`);
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}

function renderKindIndex(kind: MemoryKind, entries: NavigationEntry[]): string {
  const lines = [`# ${KIND_TITLES[kind]}`, ''];
  if (entries.length === 0) {
    lines.push('_No memories._');
  } else {
    for (const entry of entries) {
      const rel = markdownPath(path.relative(kind, entry.sourceId));
      const markers = [
        entry.deprecated ? 'deprecated' : null,
        entry.stale ? 'stale' : null,
      ].filter((marker): marker is string => marker !== null);
      const markerText = markers.length > 0 ? ` [${markers.join(', ')}]` : '';
      lines.push(
        `* [${entry.title}](${rel})${markerText} - ${entry.description}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderRootIndex(grouped: Map<MemoryKind, NavigationEntry[]>): string {
  const lines = [
    '---',
    'okf_version: "0.2"',
    '---',
    '# Memory',
    '',
  ];
  for (const kind of VALID_MEMORY_KINDS) {
    const count = grouped.get(kind)?.length ?? 0;
    lines.push(
      `* [${KIND_TITLES[kind]}](${kind}/index.md) - ${count} ${count === 1 ? 'memory' : 'memories'}.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Regenerate the root and per-kind OKF navigation files under `memoryDir`.
 *
 * The function always resolves with a summary. Individual path failures are
 * logged without note bodies and do not prevent the remaining indexes from
 * being generated.
 */
export async function regenerateMemoryVaultNavigation(
  memoryDir: string,
  options: MemoryVaultNavigationOptions = {},
): Promise<MemoryVaultNavigationSummary> {
  return withNavigationGenerationLock(memoryDir, () =>
    regenerateMemoryVaultNavigationUnlocked(memoryDir, options),
  );
}

async function regenerateMemoryVaultNavigationUnlocked(
  memoryDir: string,
  options: MemoryVaultNavigationOptions,
): Promise<MemoryVaultNavigationSummary> {
  const summary: MemoryVaultNavigationSummary = {
    written: 0,
    unchanged: 0,
    failed: 0,
  };

  try {
    // Dynamic import avoids a static cycle: memoryVaultWriteService invokes
    // this generator after canonical writes, while also owning the established
    // path-confinement helper required for derived index writes.
    const { resolveWithinMemoryDir } = await import('./memoryVaultWriteService');
    const root = resolveWithinMemoryDir(memoryDir, '.');
    if (options.createIfMissing === false) {
      try {
        const stat = await fs.stat(root);
        if (!stat.isDirectory()) return summary;
      } catch {
        return summary;
      }
    } else {
      await fs.mkdir(root, { recursive: true });
    }
    const canonicalRoot = await fs.realpath(root);

    const notes = await scanVaultNotes(root);
    const today = options.today ?? localCalendarDate();
    const grouped = new Map<MemoryKind, NavigationEntry[]>(
      VALID_MEMORY_KINDS.map((kind) => [kind, []]),
    );
    for (const note of notes) {
      if (!(VALID_MEMORY_KINDS as readonly string[]).includes(note.parsed.kind)) {
        continue;
      }
      const entry = toNavigationEntry(note, today);
      grouped.get(entry.kind)!.push(entry);
    }
    for (const entries of grouped.values()) {
      entries.sort(
        (a, b) =>
          (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) ||
          (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0),
      );
    }

    const outputs: Array<{ relPath: string; content: string }> = [
      { relPath: 'index.md', content: renderRootIndex(grouped) },
      ...VALID_MEMORY_KINDS.map((kind) => ({
        relPath: path.join(kind, 'index.md'),
        content: renderKindIndex(kind, grouped.get(kind)!),
      })),
    ];

    for (const output of outputs) {
      let abs: string;
      try {
        abs = resolveWithinMemoryDir(root, output.relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await assertSafeNavigationOutput(canonicalRoot, abs);
        let existing: string | undefined;
        try {
          existing = await fs.readFile(abs, 'utf8');
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
        }
        if (existing === output.content) {
          summary.unchanged += 1;
          continue;
        }
        await fs.writeFile(abs, output.content, 'utf8');
        summary.written += 1;
      } catch (err) {
        summary.failed += 1;
        logger.warn(
          `[MemoryVaultNavigation] Could not write ${output.relPath}: ${String(err)}`,
        );
      }
    }
  } catch (err) {
    summary.failed += 1;
    logger.warn(
      `[MemoryVaultNavigation] Generation skipped for ${memoryDir}: ${String(err)}`,
    );
  }

  logger.info(
    `[MemoryVaultNavigation] written=${summary.written} unchanged=${summary.unchanged} failed=${summary.failed} (memoryDir=${memoryDir})`,
  );
  return summary;
}
