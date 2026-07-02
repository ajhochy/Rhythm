/**
 * Vault-first write path for completed research jobs (Issue #847, life-02).
 *
 * On research-job completion (`status: 'done'`), the findings land as
 * Research Database ENTRIES in the maintainer's theological-study vault
 * structure (see `researchVaultConfig.ts` for the locked format and its
 * provenance — the vault's own intake workflow + template).
 *
 * Discipline mirrors `memoryVaultWriteService.ts` exactly (do not fork it):
 *   1. WRITE THE VAULT NOTE(S) FIRST via a direct filesystem write (NOT the
 *      Obsidian MCP, so it works with Obsidian closed).
 *   2. The derived SQLite index is NOT touched directly here — entries land
 *      under the vault root, which the EXISTING #805 refresh (the periodic
 *      `memory_vault_sync_job` cron + `MemoryIndexService.rebuildIndexFromVault`
 *      startup pass + the manual `POST /agent-memory/sync`) already scans
 *      recursively from `resolveMemoryVaultPath()`. No new indexer is added.
 *   3. Entry granularity: one entry per distinct source/finding when the
 *      caller supplies structured `entries`; otherwise one entry per job
 *      (the flat report becomes a single entry titled by the topic).
 *
 * PRIVACY: never log note bodies (summary/findings/quote text). Logs carry
 * only note PATHS, the job id, and counts.
 *
 * PATH SAFETY: every write is confined to `<vaultRoot>/<RESEARCH_ENTRIES_ROOT>/`.
 * A filename that would resolve outside it is rejected — nothing is written.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMemoryVaultPath } from '../config/env';
import {
  RESEARCH_ENTRIES_ROOT,
  RESEARCH_ENTRY_TYPE,
  RESEARCH_ENTRY_STATUS,
  RESEARCH_ENTRY_TAGS,
  researchEntryFilename,
  matchEntrySubfolder,
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

/** One structured finding — becomes exactly one Research Database entry. */
export interface ResearchEntryInput {
  /** Entry title (drives the filename slug and the `# title` heading). */
  title: string;
  /** The quote / note body for the entry's "## Quote / Note" section. */
  note: string;
  /** Optional per-entry summary for "## Summary". */
  summary?: string;
  /** Source (URL or work name) for the `source` frontmatter field. */
  source?: string;
  /** Author for the `author` frontmatter field. */
  author?: string;
  /** Page or other source locator for the `page` frontmatter field. */
  page?: string;
}

export interface ResearchNoteInput {
  /** The research job's id (agent_research_jobs.id) — stamped as `job_id`. */
  jobId: string;
  /** The original research query/topic (agent_research_jobs.query). */
  topic: string;
  /** Short summary (1-3 sentences) for the single-entry (per-job) case. */
  summary: string;
  /** The full findings / synthesized report markdown (per-job case). */
  findings: string;
  /** Source URLs gathered during the pipeline. */
  sources: string[];
  /**
   * Structured findings: when present and non-empty, ONE entry is written
   * PER item (per distinct source/finding). When absent, one entry is
   * written for the whole job with `topic` as its title.
   */
  entries?: ResearchEntryInput[];
}

export interface ResearchNoteWriteResult {
  /** Vault-ROOT-relative entry paths (one per entry written). */
  paths: string[];
  /** The topical subfolder(s) chosen, parallel to `paths`. */
  subfolders: string[];
}

export interface ResearchVaultWriteOptions {
  /** Override the vault root (tests point this at a temp fixture). */
  vaultPath?: string;
}

/**
 * Resolve an entries-root-relative path to an absolute path and assert it
 * stays inside the entries root. Mirrors `resolveWithinMemoryDir` in
 * memoryVaultWriteService.ts (kept as a small local copy, scoped to the
 * entries root, so that file's existing memory-note behavior is untouched).
 */
function resolveWithinEntriesRoot(entriesRoot: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new ResearchVaultWriteError(`Entry path must be relative: ${relPath}`);
  }
  const root = path.resolve(entriesRoot);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new ResearchVaultWriteError(`Entry path escapes the entries root: ${relPath}`);
  }
  return abs;
}

interface EntryFrontmatter {
  topic: string;
  source: string;
  author: string;
  page: string;
  jobId: string;
}

/**
 * Render a research entry's frontmatter + body to markdown, matching the
 * vault's `Templates/Theology - Research Entry.md` shape (block-style tags,
 * quoted scalars) minus the Intake Checklist section, plus Rhythm's `job_id`.
 * `type: "entry"` is CRITICAL — it drives the Research Entries base.
 */
function renderResearchEntry(fm: EntryFrontmatter, title: string, note: string, summary: string): string {
  const lines = [
    '---',
    `type: ${JSON.stringify(RESEARCH_ENTRY_TYPE)}`,
    `topic: ${JSON.stringify(fm.topic)}`,
    'parent: ""',
    `page: ${JSON.stringify(fm.page)}`,
    `source: ${JSON.stringify(fm.source)}`,
    `author: ${JSON.stringify(fm.author)}`,
    'citation: ""',
    'scripture_references: []',
    'themes: []',
    'doctrine_tags: []',
    `status: ${JSON.stringify(RESEARCH_ENTRY_STATUS)}`,
    'tags:',
    ...RESEARCH_ENTRY_TAGS.map((t) => `  - ${t}`),
    `job_id: ${fm.jobId}`,
    '---',
    `# ${title}`,
    '',
    '## Quote / Note',
    '',
    note.trim(),
    '',
    '## Summary',
    '',
    summary.trim(),
    '',
    '## Theological Anchors',
    '',
    '',
    '## Questions / Uses',
    '',
    '',
  ];
  return lines.join('\n');
}

/**
 * Write a completed research job's findings as Research Database entries.
 * Vault-first: entries are written via direct FS writes; the derived index
 * is left to the existing #805 refresh (cron / rebuild / manual sync), which
 * already scans the whole vault root recursively — no index call happens here.
 *
 * Granularity: one entry per item of `input.entries` when supplied (one per
 * distinct source/finding); otherwise ONE entry for the whole job, titled by
 * the topic, with the flat report as its Quote / Note.
 *
 * @throws {ResearchVaultWriteError} on empty topic, an empty structured
 *   entry title, or a path that would escape the entries root — the input is
 *   validated in full BEFORE the first write (all-or-nothing input check).
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
  const entriesRoot = path.join(vaultRoot, RESEARCH_ENTRIES_ROOT);
  const sources = Array.isArray(input.sources) ? input.sources.map(String) : [];

  // Structured → one entry per finding; flat → one entry for the whole job.
  const structured = Array.isArray(input.entries) && input.entries.length > 0;
  const entryInputs: ResearchEntryInput[] = structured
    ? (input.entries as ResearchEntryInput[])
    : [
        {
          title: topic,
          note: (input.findings ?? '').trim() || '_No findings provided._',
          summary: input.summary,
          // Per-job entry: preserve every gathered source URL in `source`.
          source: sources.join('; '),
        },
      ];

  // Validate ALL entries before writing ANY (all-or-nothing input check).
  for (const e of entryInputs) {
    if (!e || typeof e.title !== 'string' || e.title.trim() === '') {
      throw new ResearchVaultWriteError('every entry requires a non-empty title');
    }
  }

  const paths: string[] = [];
  const subfolders: string[] = [];

  for (const entry of entryInputs) {
    const title = entry.title.trim();
    const subfolder = matchEntrySubfolder(`${topic} ${title}`);
    const filename = researchEntryFilename(slugForNote(title, generateUlid()));
    const relWithinEntries = path.join(subfolder, filename);

    // Path-traversal guard: resolve + assert BEFORE any filesystem mutation.
    const abs = resolveWithinEntriesRoot(entriesRoot, relWithinEntries);
    const vaultRelPath = path.join(RESEARCH_ENTRIES_ROOT, relWithinEntries);

    const content = renderResearchEntry(
      {
        topic,
        source: (entry.source ?? '').trim(),
        author: (entry.author ?? '').trim(),
        page: (entry.page ?? '').trim(),
        jobId: input.jobId,
      },
      title,
      (entry.note ?? '').trim() || '_No note provided._',
      (entry.summary ?? '').trim(),
    );

    // --- VAULT-FIRST WRITE ---------------------------------------------------
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');

    paths.push(vaultRelPath);
    subfolders.push(subfolder);
  }

  // PRIVACY: never log note bodies — paths, job id, and counts only.
  logger.info(
    `[ResearchVault] wrote ${paths.length} research entr${paths.length === 1 ? 'y' : 'ies'} ` +
      `(job=${input.jobId} paths=${paths.join(', ')})`,
  );

  return { paths, subfolders };
}
