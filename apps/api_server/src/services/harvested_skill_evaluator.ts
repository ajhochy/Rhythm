/**
 * harvested_skill_evaluator.ts — #929 (simple self-regulating harvested skill loop)
 *
 * Unit 3: once a harvested (`source === 'auto-extract'`) skill has been used
 * {@link EVAL_AFTER_USES} times, score it against its own stated purpose (the
 * SAME purpose-anchored judge skill_measurement.ts already uses for the
 * refiner's apply/measure loop — reuses `scoreSkillBody`, no new scorer) and
 * transition it:
 *
 *   - score >= DRAFT_CONFIDENCE_GATE*100  → 'active'   (keep)
 *   - score >= REWRITE_FLOOR*100          → 'rewrite-needed' (sound idea, weak
 *     execution — flagged for a rewrite pass / human review; no in-place LLM
 *     rewrite is attempted here because no existing primitive regenerates a
 *     skill body from scratch — only skill_refiner's candidate-vs-existing
 *     judge exists, which does not fit a self-evaluation with no new candidate)
 *   - otherwise                            → 'disabled' (dematerialized — pulled
 *     from the picker/engine; useless, duplicate, or error-prone)
 *
 * `measure_reason` / `post_score` / `status` are the ONLY columns touched (per
 * the #929 decision doc — no new migration). A skill is evaluated AT MOST
 * ONCE: the trigger site only calls this when status is still 'draft' (the
 * harvest default), so a transitioned row is never re-evaluated.
 *
 * Never-throw / best-effort — this runs inline after incrementUses() on the
 * live retrieval/injection path (agent_runner.ts / ws_gateway.ts) and must
 * never break a user's turn.
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { dematerializeSkill } from './skill_materializer';
import { scoreSkillBody, type ScoreCall, type SkillPurpose } from './skill_refiner';
import { DRAFT_CONFIDENCE_GATE } from './skill_retrieval';
import { recordHarvestOutcome, type HarvestOutcome } from './harvester_quality_signal';
import type { AgentSkill } from '../models/agent_skill';

/** Mirrors skill_extractor.ts isTestEnv() VERBATIM. */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/** Evaluate a harvested skill once it has been used this many times (#929 decision). */
export const EVAL_AFTER_USES = 3;

/** Below this score (0-100), a harvested skill is genuinely useless/bad → disable. */
const REWRITE_FLOOR = 0.4 * 100;

export type EvaluationOutcome = 'kept' | 'rewrite-needed' | 'disabled' | 'skipped';

export interface EvaluateDeps {
  repo?: AgentSkillsRepository;
  scorer?: ScoreCall;
  dematerialize?: (skill: Pick<AgentSkill, 'title'>) => Promise<void>;
  /** Injectable harvester-quality signal recorder (defaults to the real one). */
  recordOutcome?: (outcome: HarvestOutcome) => Promise<void>;
}

/**
 * Evaluate ONE harvested skill row that has just crossed {@link EVAL_AFTER_USES}.
 * NEVER throws. No-ops (returns 'skipped') under test/Postgres, when the skill
 * is not an auto-extract draft, or when uses is still below the threshold.
 */
export async function evaluateHarvestedSkillIfDue(
  skillId: string,
  deps: EvaluateDeps = {},
): Promise<EvaluationOutcome> {
  try {
    if (isTestEnv() && !deps.scorer) return 'skipped';
    if (env.dbClient === 'postgres') return 'skipped';

    const repo = deps.repo ?? new AgentSkillsRepository();
    const skill = repo.getById(skillId);
    if (!skill) return 'skipped';

    // Only harvested drafts that have never been evaluated. A row already
    // transitioned (active/rewrite-needed/disabled/measuring/reverted/etc) is
    // never re-evaluated — 'draft' is the harvest-time default and the ONLY
    // status this evaluator acts on.
    if (skill.source !== 'auto-extract' || skill.status !== 'draft') return 'skipped';
    if ((skill.uses ?? 0) < EVAL_AFTER_USES) return 'skipped';

    const dematerialize = deps.dematerialize ?? dematerializeSkill;
    const recordOutcome = deps.recordOutcome ?? recordHarvestOutcome;

    const purpose: SkillPurpose = {
      name: skill.title,
      description: skill.description ?? null,
      whenToUse: skill.whenToUse ?? null,
    };
    const body = skill.body ?? [skill.description ?? '', ...(skill.steps ?? [])].join('\n');
    const score = await scoreSkillBody(purpose, body, deps.scorer);

    const keepFloor = DRAFT_CONFIDENCE_GATE * 100;

    if (score.score >= keepFloor) {
      repo.update(skill.id, {
        status: 'active',
        postScore: score.score,
        measureReason: `harvest-eval: keep (score=${score.score} >= ${keepFloor}); ${score.reason}`,
      });
      logger.info(`[harvest-eval] KEEP '${skill.title}' (score ${score.score} >= ${keepFloor})`);
      await recordOutcome('good');
      return 'kept';
    }

    if (score.score >= REWRITE_FLOOR) {
      repo.update(skill.id, {
        status: 'rewrite-needed',
        postScore: score.score,
        measureReason: `harvest-eval: rewrite-needed (score=${score.score} in [${REWRITE_FLOOR}, ${keepFloor})); ${score.reason}`,
      });
      logger.info(`[harvest-eval] REWRITE-NEEDED '${skill.title}' (score ${score.score})`);
      await recordOutcome('bad');
      return 'rewrite-needed';
    }

    // Genuinely useless/duplicate/error-prone → disable (dematerialize + terminal status).
    await dematerialize(skill);
    repo.update(skill.id, {
      status: 'disabled',
      postScore: score.score,
      measureReason: `harvest-eval: disabled (score=${score.score} < ${REWRITE_FLOOR}); ${score.reason}`,
    });
    logger.info(`[harvest-eval] DISABLED '${skill.title}' (score ${score.score} < ${REWRITE_FLOOR})`);
    await recordOutcome('bad');
    return 'disabled';
  } catch (err) {
    logger.warn(`[harvest-eval] FAILED (non-fatal): ${String(err)}`);
    return 'skipped';
  }
}
