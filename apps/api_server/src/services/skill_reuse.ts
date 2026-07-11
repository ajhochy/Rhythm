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
import type { AgentSkill } from '../models/agent_skill';
import { scoreSkill } from './skill_retrieval';
import { isSameSkill, type RefineCandidate } from './skill_refiner';

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

/**
 * Slug a distill title the same way skill_extractor.skillNameFromTitle does, so
 * a library skill whose frontmatter `name` is that slug is matched exactly.
 * ponytail: replicated (3 lines) rather than exported from skill_extractor to
 * avoid a skill_extractor <-> skill_reuse import cycle.
 */
function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** De-slug a library `name` into space-separated tokens for lexical matching. */
function deslug(name: string): string {
  return name.replace(/[_-]+/g, ' ').trim();
}

/**
 * Adapt a library index entry into the minimal AgentSkill shape scoreSkill /
 * isSameSkill read (title, description; the rest unused by those two functions).
 * ponytail: partial cast — scoreSkill only touches title/description/whenToUse/
 * tags/steps/confidence/uses, all covered here.
 */
function entryToSkill(entry: LibraryIndexEntry): AgentSkill {
  return {
    id: entry.name,
    title: deslug(entry.name),
    whenToUse: null,
    description: entry.description || null,
    steps: null,
    tags: null,
    stepsJson: null,
    tagsJson: null,
    body: null,
    confidence: 1,
    status: 'published',
    source: null,
    uses: 0,
    version: 1,
    appliedForName: null,
    baseVersion: null,
    originLocation: null,
    isExternal: 0,
    baselineScore: null,
    postScore: null,
    measureReason: null,
    createdAt: '',
    updatedAt: '',
  } as AgentSkill;
}

/**
 * Find a library skill that adequately covers the distilled intent, mirroring
 * skill_refiner.findRevisionTarget's precedence over the file library:
 *   1. exact slug join: an entry whose `name` equals the intent title's slug.
 *   2. else the top scoreSkill() relevance hit, gated by isSameSkill so a fuzzy
 *      title collision is not mistaken for the same skill.
 * Returns the matched entry, or null when nothing in the library is adequate.
 * NEVER throws.
 */
export function findAdequateLibraryMatch(
  intent: RefineCandidate,
  index: LibraryIndexEntry[] = buildLibraryIndex(),
): LibraryIndexEntry | null {
  try {
    if (index.length === 0) return null;

    const wantSlug = slugFromTitle(intent.title);
    if (wantSlug) {
      const exact = index.find((e) => e.name.trim().toLowerCase() === wantSlug);
      if (exact) return exact;
    }

    const query = [intent.title, intent.whenToUse ?? '', intent.description ?? '']
      .filter((s) => s && s.length > 0)
      .join(' ');
    if (!query.trim()) return null;

    const scored = index
      .map((e) => ({ entry: e, score: scoreSkill(query, entryToSkill(e)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) return null;

    const top = scored[0].entry;
    return isSameSkill(intent, entryToSkill(top)) ? top : null;
  } catch (err) {
    logger.warn(`[skill-reuse] library match failed (non-fatal): ${String(err)}`);
    return null;
  }
}
