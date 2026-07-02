/**
 * Vault-first write path for completed research jobs (Issue #847, life-02).
 *
 * On research-job completion (`status: 'done'`), the findings land as a
 * structured, linked note in the vault's `research/` folder so research
 * compounds in Obsidian instead of dying inside `agent_research_jobs.report`.
 *
 * Discipline mirrors `memoryVaultWriteService.ts` exactly (do not fork it):
 *   1. WRITE THE VAULT NOTE FIRST via a direct filesystem write (NOT the
 *      Obsidian MCP, so it works with Obsidian closed).
 *   2. The derived SQLite index is NOT touched directly here — the note lands
 *      under the vault root, which the EXISTING #805 refresh (the periodic
 *      `memory_vault_sync_job` cron + `MemoryIndexService.rebuildIndexFromVault`
 *      startup pass + the manual `POST /agent-memory/sync`) already scans
 *      recursively from `resolveMemoryVaultPath()`. No new indexer is added.
 *   3. Linking: a lightweight, best-effort "Related notes" section links to
 *      existing vault notes that share at least one tag with this research
 *      note (derived from a shallow frontmatter-tag scan — no new index).
 *
 * PRIVACY: never log note bodies (summary/findings/report text). Logs carry
 * only the note PATH, job id, and counts.
 *
 * PATH SAFETY: the write is confined to `<vaultRoot>/research/`. A filename
 * that would resolve outside it is rejected — nothing is written.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMemoryVaultPath } from '../config/env';
import {
  RESEARCH_VAULT_SUBDIR,
  RESEARCH_NOTE_SOURCE,
  researchNoteFilename,
} from '../config/researchVaultConfig';
import { slugForNote, generateUlid } from './memoryVaultWriteService';
import { logger } from '../utils/logger';

/** Thrown for any caller-input problem (empty topic, path escape). */
export class ResearchVaultWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchVaultWriteError';
  }
}

export interface ResearchNoteInput {
  /** The research job's id (agent_research_jobs.id) — stamped as `job_id`. */
  jobId: string;
  /** The original research query/topic (agent_research_jobs.query). */
  topic: string;
  /** Short summary (1-3 sentences) — required section in the note body. */
  summary: string;
  /** The full findings / synthesized report markdown. */
  findings: string;
  /** Source URLs gathered during the pipeline. */
  sources: string[];
  /** Optional extra tags beyond the topic-derived ones. */
  tags?: string[];
}

export interface ResearchNoteWriteResult {
  /** Vault-ROOT-relative note path, e.g. `research/2026-07-02-crm-options.md`. */
  path: string;
  /** The date stamped in frontmatter / filename (YYYY-MM-DD). */
  date: string;
  /** Number of related notes linked from this note. */
  relatedCount: number;
}

export interface ResearchVaultWriteOptions {
  /** Override the vault root (tests point this at a temp fixture). */
  vaultPath?: string;
}

/** Today's date as YYYY-MM-DD (matches the existing frontmatter convention). */
function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a vault-relative path to an absolute path and assert it stays
 * inside the research dir. Mirrors `resolveWithinMemoryDir` in
 * memoryVaultWriteService.ts (kept as a small local copy, scoped to the
 * research dir, so that file's existing memory-note behavior is untouched).
 */
function resolveWithinResearchDir(researchDir: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new ResearchVaultWriteError(`Note path must be relative: ${relPath}`);
  }
  const root = path.resolve(researchDir);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new ResearchVaultWriteError(`Note path escapes the research dir: ${relPath}`);
  }
  return abs;
}

/**
 * Stopwords dropped from topic-derived tags. Note the minimum token length is
 * 3 (not 4) so short, meaningful acronyms like "crm", "seo", "pco" survive —
 * an earlier length>3 cut silently dropped every 3-letter acronym, which
 * broke tag-based related-note linking for exactly the kind of short domain
 * terms research topics tend to use.
 */
const TOPIC_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'what', 'which', 'best', 'about', 'with',
  'from', 'that', 'this', 'have', 'does', 'can', 'how', 'why', 'when',
]);

/** Derive simple kebab tags from the topic (word tokens, lowercased, deduped). */
function deriveTagsFromTopic(topic: string): string[] {
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const w of words) {
    if (TOPIC_STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    tags.push(w);
    if (tags.length >= 5) break;
  }
  return tags;
}

/** Minimal frontmatter tag read, reusing the same tolerant line-parser shape as memoryVaultWriteService. */
async function readNoteTags(abs: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch {
    return [];
  }
  const norm = raw.replace(/\r\n/g, '\n');
  if (!norm.startsWith('---\n')) return [];
  const closeIdx = norm.slice(4).search(/\n---\s*(\n|$)/);
  if (closeIdx === -1) return [];
  const fm = norm.slice(4, 4 + closeIdx);
  const m = /^tags:\s*\[(.*)\]\s*$/m.exec(fm);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0);
}

/**
 * Best-effort "related notes" discovery: scan every `.md` file under the
 * vault root (excluding this note itself and dot-dirs) for a shared tag.
 * Bounded and best-effort — any scan error yields zero related notes rather
 * than failing the write (linking is additive, not load-bearing).
 */
async function findRelatedNotes(
  vaultRoot: string,
  ownAbsPath: string,
  tags: string[],
): Promise<string[]> {
  if (tags.length === 0) return [];
  const tagSet = new Set(tags);
  const related: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        if (path.resolve(full) === path.resolve(ownAbsPath)) continue;
        const noteTags = await readNoteTags(full);
        if (noteTags.some((t) => tagSet.has(t))) {
          related.push(path.relative(vaultRoot, full));
        }
      }
    }
  }

  try {
    await walk(vaultRoot);
  } catch {
    return [];
  }
  return related;
}

/** Render the research note's frontmatter + body to markdown. */
function renderResearchNote(fm: {
  date: string;
  topic: string;
  tags: string[];
  jobId: string;
}, body: string): string {
  const tagsInline = `[${fm.tags.map((t) => JSON.stringify(t)).join(', ')}]`;
  const lines = [
    '---',
    `date: ${fm.date}`,
    `topic: ${JSON.stringify(fm.topic)}`,
    `tags: ${tagsInline}`,
    `source: ${RESEARCH_NOTE_SOURCE}`,
    `job_id: ${fm.jobId}`,
    '---',
    '',
    body.trim(),
    '',
  ];
  return lines.join('\n');
}

/**
 * Write a completed research job's findings as a structured vault note.
 * Vault-first: the note is written via a direct FS write; the derived index
 * is left to the existing #805 refresh (cron / rebuild / manual sync), which
 * already scans the whole vault root recursively — no index call happens here.
 *
 * @throws {ResearchVaultWriteError} on empty topic or a path that would
 *   escape the research dir — in either case nothing is written.
 */
export async function writeResearchNoteToVault(
  input: ResearchNoteInput,
  options: ResearchVaultWriteOptions = {},
): Promise<ResearchNoteWriteResult> {
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (topic === '') {
    throw new ResearchVaultWriteError('topic is required');
  }
  if (!input.jobId || typeof input.jobId !== 'string') {
    throw new ResearchVaultWriteError('jobId is required');
  }

  const vaultRoot = options.vaultPath ?? resolveMemoryVaultPath();
  const researchDir = path.join(vaultRoot, RESEARCH_VAULT_SUBDIR);

  const date = isoDate();
  const topicSlug = slugForNote(topic, generateUlid());
  const filename = researchNoteFilename(date, topicSlug);
  const relPath = path.join(RESEARCH_VAULT_SUBDIR, filename);

  // Path-traversal guard: resolve + assert BEFORE any filesystem mutation.
  const abs = resolveWithinResearchDir(researchDir, filename);

  const tags = Array.from(
    new Set([...(Array.isArray(input.tags) ? input.tags.map(String) : []), ...deriveTagsFromTopic(topic)]),
  );

  const related = await findRelatedNotes(vaultRoot, abs, tags);

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const bodyParts = [
    `# ${topic}`,
    '',
    '## Summary',
    '',
    (input.summary ?? '').trim() || '_No summary provided._',
    '',
    '## Findings',
    '',
    (input.findings ?? '').trim() || '_No findings provided._',
    '',
    '## Sources',
    '',
    sources.length > 0 ? sources.map((s) => `- ${s}`).join('\n') : '_No sources recorded._',
  ];

  if (related.length > 0) {
    bodyParts.push('', '## Related notes', '');
    for (const rel of related) {
      // Obsidian wikilink using the note's basename (without extension).
      const base = path.basename(rel, '.md');
      bodyParts.push(`- [[${base}]]`);
    }
  }

  const body = bodyParts.join('\n');

  // --- VAULT-FIRST WRITE -----------------------------------------------------
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, renderResearchNote({ date, topic, tags, jobId: input.jobId }, body), 'utf8');

  // PRIVACY: never log note bodies — path, job id, and counts only.
  logger.info(
    `[ResearchVault] wrote research note (job=${input.jobId} path=${relPath} related=${related.length})`,
  );

  return { path: relPath, date, relatedCount: related.length };
}
