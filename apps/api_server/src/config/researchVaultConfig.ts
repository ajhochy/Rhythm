/**
 * Research → Vault note defaults (Issue #847, life-02).
 *
 * MAINTAINER DEFAULT LOCKED for this run (per the issue): folder `research/`,
 * filename `YYYY-MM-DD-<topic-slug>.md`, frontmatter keys
 * `date, topic, tags, source: research-job, job_id`.
 *
 * This module exists so a later change to the folder name or the frontmatter
 * schema is a ONE-LINE change here, not a hunt through
 * `researchVaultWriteService.ts`. Nothing outside this file should hard-code
 * the folder name, filename shape, or frontmatter key names.
 */

/** Subfolder of the vault root that research notes are written into. */
export const RESEARCH_VAULT_SUBDIR = 'research';

/** Informational `source` frontmatter value stamped on every research note. */
export const RESEARCH_NOTE_SOURCE = 'research-job' as const;

/** Ordered frontmatter keys for a research note (documents the locked schema). */
export const RESEARCH_NOTE_FRONTMATTER_KEYS = [
  'date',
  'topic',
  'tags',
  'source',
  'job_id',
] as const;

/**
 * Build the research note filename: `YYYY-MM-DD-<topic-slug>.md`.
 * `date` must already be `YYYY-MM-DD`; `topicSlug` must already be a
 * filesystem-safe slug (see {@link slugForNote} in memoryVaultWriteService,
 * reused as-is by the write service — no second slugger is introduced here).
 */
export function researchNoteFilename(date: string, topicSlug: string): string {
  return `${date}-${topicSlug}.md`;
}
