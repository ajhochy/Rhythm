/**
 * Unify-6 — materialize published DB skills into the engine's canonical store.
 *
 * System B (the api_server DB skill library + extractor/refiner/retrieval) stays
 * as the AUTHORING / metadata layer. It is NOT what the model loads — only the
 * opencode fork's filesystem skills are. `buildSkillsPreface` (skill_retrieval.ts)
 * injects DB skills as an inert prompt HINT, not the capability gate.
 *
 * To reach one source of truth, a DB skill that becomes `published` is written
 * out as a SKILL.md into the Rhythm-managed dir (unify-2), where the fork
 * discovers it like any other skill — so it appears in the picker (GET
 * /opencode/skills) and can be scoped via allowed_skills_json (#775).
 *
 * Best-effort: a materialize/dematerialize failure must never fail the skill
 * CRUD request that triggered it. Callers fire-and-forget with .catch().
 */

import type { AgentSkill } from '../models/agent_skill';
import { opencodeClient } from './opencode_engine';
import { writeManagedSkill, deleteManagedSkill } from './rhythm_managed_skills';
import { logger } from '../utils/logger';

/** The fork frontmatter `name` for a materialized DB skill — its title. */
export function skillToManagedName(skill: Pick<AgentSkill, 'title'>): string {
  return skill.title.trim();
}

/**
 * Render a DB skill to a SKILL.md body. Prefers the full prose `body`; falls
 * back to composing one from whenToUse + steps for extracted/step skills.
 */
export function renderSkillBody(skill: AgentSkill): string {
  if (skill.body && skill.body.trim() !== '') return skill.body;

  const parts: string[] = [`# ${skill.title}`, ''];
  if (skill.whenToUse && skill.whenToUse.trim() !== '') {
    parts.push(`## When to use`, '', skill.whenToUse.trim(), '');
  }
  const steps = skill.steps ?? null;
  if (Array.isArray(steps) && steps.length > 0) {
    parts.push(`## Steps`, '');
    steps.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * Write a published DB skill into the managed dir and re-scan the fork so it is
 * immediately discoverable. Idempotent by name — re-publishing overwrites the
 * same SKILL.md rather than creating a duplicate. Never throws.
 */
export async function materializeSkill(skill: AgentSkill): Promise<void> {
  try {
    const name = skillToManagedName(skill);
    writeManagedSkill({
      name,
      description: skill.description ?? skill.whenToUse ?? undefined,
      body: renderSkillBody(skill),
    });
    await opencodeClient.reloadSkills();
    logger.info('[skill-materializer] materialized published skill "%s"', name);
  } catch (err) {
    logger.warn('[skill-materializer] materialize failed (non-fatal):', err);
  }
}

/**
 * Remove a previously-materialized skill from the managed dir (on unpublish or
 * delete) and re-scan. Never throws.
 */
export async function dematerializeSkill(skill: Pick<AgentSkill, 'title'>): Promise<void> {
  try {
    const removed = deleteManagedSkill(skillToManagedName(skill));
    if (removed) {
      await opencodeClient.reloadSkills();
      logger.info('[skill-materializer] dematerialized skill "%s"', skillToManagedName(skill));
    }
  } catch (err) {
    logger.warn('[skill-materializer] dematerialize failed (non-fatal):', err);
  }
}
