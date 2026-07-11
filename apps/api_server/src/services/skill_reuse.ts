/**
 * skill_reuse.ts — Stage A "reuse before reinvent".
 *
 * Two library-only rungs the harvester's ladder gains (skill_extractor):
 *   - build an in-process index of the OWNED library (managedSkillsRoot() only —
 *     never a machine scan of ~/.claude etc.);
 *   - given a distilled intent, find an adequate library match and, if the
 *     extracting agent isn't wired to it, auto-wire it (reversibly).
 *
 * Everything here is best-effort + never-throws: it augments a fire-and-forget
 * harvester path and must never break the turn that triggered it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { managedSkillsRoot } from './rhythm_managed_skills';
import { parseSkillFrontmatter } from './skill_frontmatter';

/** Subfolders under the managed root that are NOT library skills. */
const RESERVED_SUBFOLDERS = new Set(['drafts', 'disabled']);

/** One owned-library skill as indexed from disk. */
export interface LibraryIndexEntry {
  /** Frontmatter `name` — the fork's join key and the allowlist entry to add. */
  name: string;
  /** Frontmatter `description` (may be empty). Carries the matching signal. */
  description: string;
}

/**
 * Build an in-process index of the owned library from managedSkillsRoot() ONLY.
 * Scans each immediate subdirectory (except the reserved drafts/ + disabled/)
 * for a SKILL.md and reads its frontmatter name/description. NEVER throws — a
 * missing dir or unreadable file yields an empty/partial index.
 */
export function buildLibraryIndex(): LibraryIndexEntry[] {
  const root = managedSkillsRoot();
  const out: LibraryIndexEntry[] = [];
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) return out;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (RESERVED_SUBFOLDERS.has(entry.name)) continue;
      const skillMd = join(root, entry.name, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      let content: string;
      try {
        content = readFileSync(skillMd, 'utf8');
      } catch {
        continue;
      }
      const fm = parseSkillFrontmatter(content);
      const name = (fm.name ?? '').trim();
      if (!name) continue;
      out.push({ name, description: (fm.description ?? '').trim() });
    }
  } catch (err) {
    logger.warn(`[skill-reuse] library index scan failed (non-fatal): ${String(err)}`);
  }
  return out;
}
