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
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { writeAgentProfileFile } from './opencode_agent_writer';
import type { AgentConfig } from '../repositories/agent_configs_repository';

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

/** Snapshot returned by a successful auto-wire, sufficient to revert it. */
export interface AutoWireResult {
  agentConfigId: string;
  /** Library skill `name` that was added to the agent's allowlist. */
  skillName: string;
  /** The agent's allowedSkillsJson BEFORE the wire (the rollback target). */
  priorAllowlistJson: string;
}

/**
 * Resolve the agent config id that produced a session, mirroring
 * skill_extractor.resolveExtractingAgentConfigId: check mcpRole then agentKind,
 * validating each against a real agent_configs row. Returns null on no match.
 */
function resolveExtractingAgentConfigId(sessionId: string): string | null {
  try {
    const session = new AgentSessionsRepository().findById(sessionId);
    if (!session) return null;
    const configs = new AgentConfigsRepository();
    for (const candidate of [session.mcpRole, session.agentKind]) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (configs.getById(trimmed)) return trimmed;
    }
  } catch (err) {
    logger.warn(`[skill-reuse] agent config resolution failed for ${sessionId} (non-fatal): ${String(err)}`);
  }
  return null;
}

/**
 * Stage A ladder step 2 — if the distilled intent is adequately covered by a
 * library skill the extracting agent is NOT wired to, add that skill to the
 * agent's allowedSkillsJson (snapshotting the prior value for rollback) and
 * re-project the agent file. Returns the {@link AutoWireResult} on a wire, or
 * null when: no agent attributable, agent unrestricted (allowlist null → skill
 * already loadable), no adequate library match, or already wired. NEVER throws.
 *
 * Mirrors autoBindDraftToExtractingAgent's allowlist-write precedent: an
 * unrestricted (null) allowlist is left alone (writing a single-element array
 * would WRONGLY lock the agent down to only this skill).
 */
export async function tryAutoWireLibrarySkill(
  sessionId: string,
  intent: RefineCandidate,
): Promise<AutoWireResult | null> {
  try {
    const agentConfigId = resolveExtractingAgentConfigId(sessionId);
    if (!agentConfigId) return null;

    const configs = new AgentConfigsRepository();
    const config = configs.getById(agentConfigId);
    if (!config) return null;

    // null = unrestricted → any library skill is already loadable; do NOT lock down.
    if (config.allowedSkillsJson === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(config.allowedSkillsJson);
    } catch {
      // Malformed value — leave it alone (the sync normalize path will deny-all).
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    const current = parsed.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);

    const match = findAdequateLibraryMatch(intent);
    if (!match) return null;

    const skillName = match.name.trim();
    if (!skillName) return null;
    if (current.includes(skillName)) return null; // already wired

    const priorAllowlistJson = config.allowedSkillsJson;
    const next = [...current, skillName];
    configs.update(agentConfigId, { allowedSkillsJson: JSON.stringify(next) });

    // Best-effort file refresh (the DB allowlist is the load-bearing gate).
    const updated = configs.getById(agentConfigId);
    if (updated) writeAgentProfileFile(updated);

    logger.info(
      `[skill-reuse] auto-wired library skill '${skillName}' to agent '${agentConfigId}' ` +
        `for intent '${intent.title}' (prior allowlist snapshotted for rollback)`,
    );
    return { agentConfigId, skillName, priorAllowlistJson };
  } catch (err) {
    logger.warn(`[skill-reuse] auto-wire failed (non-fatal): ${String(err)}`);
    return null;
  }
}

/**
 * Reverse a previous auto-wire using its snapshot: restore the exact prior
 * allowedSkillsJson and re-project the agent file. NEVER throws. Provided so the
 * Stage A wire is genuinely reversible (invariant 5); no automatic trigger in
 * Plan A calls it — a human tool or Plan B's revert path can.
 */
export function revertAutoWire(result: AutoWireResult): void {
  try {
    const configs = new AgentConfigsRepository();
    if (!configs.getById(result.agentConfigId)) return;
    configs.update(result.agentConfigId, { allowedSkillsJson: result.priorAllowlistJson });
    const restored = configs.getById(result.agentConfigId);
    if (restored) writeAgentProfileFile(restored);
    logger.info(
      `[skill-reuse] reverted auto-wire of '${result.skillName}' on agent '${result.agentConfigId}'`,
    );
  } catch (err) {
    logger.warn(`[skill-reuse] revert auto-wire failed (non-fatal): ${String(err)}`);
  }
}
