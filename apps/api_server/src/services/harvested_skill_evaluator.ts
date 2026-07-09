/**
 * harvested_skill_evaluator.ts — #929 (skill self-regulation loop, Units 3+4).
 *
 * #949 made a harvested skill immediately usable as a draft SKILL.md file
 * (no DB row — see docs/ai/decisions/2026-07-08-harvest-to-file-autobind.md).
 * This module closes the loop the issue actually asks for: after a draft has
 * been exercised a few times, decide whether it earned its keep.
 *
 * ── Unit 3 — per-draft keep / disable / rewrite-needed ─────────────────────
 * For every draft with `status: draft` whose real usage count (from
 * skill_usage_tracker.countSkillToolUses — actual `skill` tool invocations,
 * not the legacy DB-preface hint proxy) reaches {@link EVAL_THRESHOLD}, score
 * its body against its stated purpose with the SAME absolute judge
 * skill_refiner.ts already uses for measurement (`scoreSkillBody`). There is
 * no PRIOR body to beat for a fresh harvest (unlike skill_measurement.ts's
 * revision-vs-revision comparison) — this is deliberately an ABSOLUTE-score
 * decision, reusing scoreSkillBody's own documented rubric bands as the tier
 * boundaries so nothing is invented ad hoc:
 *   - score >= 61 ("accurate/complete" tier and up)      -> KEEP   (status: active)
 *   - score <= 20 ("missing/off-topic/contradicts" tier) -> DISABLE (archived, removed from the live picker)
 *   - otherwise ("loosely related" / "basic... gaps")    -> REWRITE-NEEDED (left live, flagged)
 * Keep/rewrite-needed update the draft's frontmatter in place (still under
 * drafts/ — promotion out of drafts/ stays human-gated per the #949 decision
 * doc). Disable moves the file to the disabled/ archive (rhythm_managed_
 * skills.moveDraftToDisabled) so it stops being discovered by the engine
 * while leaving a durable record for Unit 4.
 *
 * ── Unit 4 — harvester-quality signal on repeated bad harvests ─────────────
 * After any disable/rewrite-needed outcome, check the recent evaluated-draft
 * history (newest first, drafts + disabled archive combined): the issue's own
 * worked example — "3 bad in a row OR 5 bad of last 10" — is implemented
 * literally. A trip creates exactly ONE `agent_org_proposals` row (kind
 * 'harvester-quality', reusing the existing org-optimizer proposal store /
 * review queue rather than a new panel) with a dedupKey over the tripping
 * window's skill names, so the SAME streak never re-signals, but a NEW bad
 * skill entering the window can.
 *
 * Never throws. isTestEnv() short-circuits the real scorer to zero side
 * effects (mirrors skill_measurement.ts / skill_refiner.ts); a test injects
 * `deps.scorer` to exercise the real branch. No-op under Postgres (agent
 * execution + drafts are local-only, same posture as the rest of the loop).
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import {
  listDraftSkillNames,
  listDisabledSkillNames,
  readDraftSkill,
  readDisabledSkill,
  moveDraftToDisabled,
  writeDraftManagedSkill,
} from './rhythm_managed_skills';
import { countSkillToolUses } from './skill_usage_tracker';
import { scoreSkillBody, type ScoreCall, type SkillPurpose } from './skill_refiner';
import { classifyProposalRisk } from './org_risk_classifier';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { opencodeClient } from './opencode_engine';

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/**
 * ponytail: issue text says "track... for 2-3 real uses" — picked the upper
 * bound (more evidence before judging) rather than adding a config surface
 * for a number nobody asked to tune. Lower to 2 here if the loop reacts too
 * slowly in practice.
 */
const EVAL_THRESHOLD = 3;

/** Reuses skill_refiner.ts's OWN rubric bands (buildScoreSystemPrompt) verbatim
 *  as the keep/disable tier boundaries — no separately-invented bar. */
const KEEP_SCORE_BAR = 61;
const DISABLE_SCORE_BAR = 20;

/** Issue's own worked example, implemented literally. */
const BAD_STREAK_LEN = 3;
const BAD_WINDOW_LEN = 10;
const BAD_WINDOW_TRIP = 5;

export type HarvestStatus = 'active' | 'disabled' | 'rewrite-needed';
const BAD_OUTCOMES = new Set<HarvestStatus>(['disabled', 'rewrite-needed']);

export interface EvaluateDeps {
  /** Injectable judge (defaults to the real opencode-backed impl). Tests inject a fake to lift the isTestEnv guard. */
  scorer?: ScoreCall;
  /** Injectable usage counter (defaults to countSkillToolUses). */
  countUses?: () => Map<string, number>;
  /** Injectable engine re-scan (defaults to opencodeClient.reloadSkills). */
  reload?: () => Promise<unknown>;
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: AgentOrgProposalsRepository;
  /** Injectable clock, for deterministic tests. */
  now?: () => string;
}

export interface EvaluateSummary {
  evaluated: number;
  kept: number;
  disabled: number;
  rewriteNeeded: number;
  harvesterSignalCreated: boolean;
}

const EMPTY_SUMMARY: EvaluateSummary = {
  evaluated: 0,
  kept: 0,
  disabled: 0,
  rewriteNeeded: 0,
  harvesterSignalCreated: false,
};

interface HarvestOutcomeRecord {
  name: string;
  outcome: HarvestStatus;
  evaluatedAt: string;
}

/** Newest-first history of every draft/disabled skill that has been evaluated at least once. */
function collectRecentHarvestOutcomes(): HarvestOutcomeRecord[] {
  const records: HarvestOutcomeRecord[] = [];

  for (const name of listDraftSkillNames()) {
    const draft = readDraftSkill(name);
    const status = draft?.frontmatter.status;
    const evaluatedAt = draft?.frontmatter.evaluatedAt;
    if (!evaluatedAt || (status !== 'active' && status !== 'rewrite-needed')) continue;
    records.push({ name, outcome: status, evaluatedAt });
  }

  for (const name of listDisabledSkillNames()) {
    const disabled = readDisabledSkill(name);
    const evaluatedAt = disabled?.frontmatter.evaluatedAt;
    if (!evaluatedAt) continue;
    records.push({ name, outcome: 'disabled', evaluatedAt });
  }

  records.sort((a, b) => (a.evaluatedAt < b.evaluatedAt ? 1 : a.evaluatedAt > b.evaluatedAt ? -1 : 0));
  return records;
}

/**
 * Unit 4 — trip a harvester-quality signal when the recent evaluated history
 * matches the issue's own bad-rate example. Returns true iff a proposal was
 * (newly or previously) recorded for this exact tripping window. NEVER throws.
 */
async function maybeSignalHarvesterQuality(repoOverride?: AgentOrgProposalsRepository): Promise<boolean> {
  try {
    const history = collectRecentHarvestOutcomes();
    const last3 = history.slice(0, BAD_STREAK_LEN);
    const last10 = history.slice(0, BAD_WINDOW_LEN);

    const streakTrip = last3.length === BAD_STREAK_LEN && last3.every((r) => BAD_OUTCOMES.has(r.outcome));
    const windowTrip = last10.filter((r) => BAD_OUTCOMES.has(r.outcome)).length >= BAD_WINDOW_TRIP;
    if (!streakTrip && !windowTrip) return false;

    const window = windowTrip ? last10 : last3;
    const badNames = Array.from(new Set(window.filter((r) => BAD_OUTCOMES.has(r.outcome)).map((r) => r.name))).sort();
    if (badNames.length === 0) return false;

    const repo = repoOverride ?? new AgentOrgProposalsRepository();
    const risk = classifyProposalRisk({ kind: 'harvester-quality' });
    await repo.createAsync({
      kind: 'harvester-quality',
      risk,
      title: 'Skill harvester producing repeated low-quality drafts',
      rationale:
        `${badNames.length} of the last ${window.length} evaluated harvested skills were disabled or ` +
        `flagged rewrite-needed: ${badNames.join(', ')}. Likely a harvester-quality bug — review ` +
        `skill_extractor.ts's distill prompt / confidence gate rather than any single skill.`,
      targetRef: 'services/skill_extractor.ts',
      signalRef: JSON.stringify({ badNames, streakTrip, windowTrip }),
      dedupKey: `harvester-quality:${badNames.join(',')}`,
    });
    return true;
  } catch (err) {
    logger.warn(`[harvest-eval] harvester-quality signal FAILED (non-fatal): ${String(err)}`);
    return false;
  }
}

/**
 * Unit 3 — evaluate every eligible draft and decide keep/disable/rewrite-
 * needed; Unit 4 — fires the harvester-quality check when this pass produced
 * any bad outcome. NEVER throws; each draft's evaluation is individually
 * guarded so one bad draft can't block the rest.
 */
export async function evaluateHarvestedDrafts(deps: EvaluateDeps = {}): Promise<EvaluateSummary> {
  try {
    // Hard guard: the real judge must never run under test. A test that wants
    // to exercise this path injects deps.scorer AND clears VITEST/NODE_ENV.
    if (isTestEnv() && !deps.scorer) return { ...EMPTY_SUMMARY };
    if (env.dbClient === 'postgres') return { ...EMPTY_SUMMARY };

    const countUses = deps.countUses ?? countSkillToolUses;
    const now = deps.now ?? (() => new Date().toISOString());
    const reload = deps.reload ?? (() => opencodeClient.reloadSkills());

    const uses = countUses();
    const summary: EvaluateSummary = { ...EMPTY_SUMMARY };

    for (const name of listDraftSkillNames()) {
      try {
        const draft = readDraftSkill(name);
        if (!draft || draft.frontmatter.status !== 'draft') continue; // already evaluated or unknown shape

        const count = uses.get(name) ?? 0;
        if (count < EVAL_THRESHOLD) continue;

        const purpose: SkillPurpose = {
          name,
          description: draft.frontmatter.description ?? null,
        };
        const result = await scoreSkillBody(purpose, draft.body, deps.scorer);
        summary.evaluated++;
        const evaluatedAt = now();

        const baseInput = {
          name,
          description: draft.frontmatter.description,
          body: draft.body,
          sourceSessionId: draft.frontmatter.sourceSession ?? '',
          confidence: draft.frontmatter.confidence ?? 0,
          provenance: draft.frontmatter.provenance,
          extractedAt: draft.frontmatter.extractedAt,
          evaluatedAt,
          postScore: result.score,
          measureReason: result.reason,
        };

        if (result.score >= KEEP_SCORE_BAR) {
          writeDraftManagedSkill({ ...baseInput, status: 'active' });
          summary.kept++;
        } else if (result.score <= DISABLE_SCORE_BAR) {
          moveDraftToDisabled(name, { evaluatedAt, postScore: result.score, measureReason: result.reason });
          try {
            await reload();
          } catch (err) {
            logger.warn(`[harvest-eval] reload after disabling '${name}' failed (non-fatal): ${String(err)}`);
          }
          summary.disabled++;
        } else {
          writeDraftManagedSkill({ ...baseInput, status: 'rewrite-needed' });
          summary.rewriteNeeded++;
        }
      } catch (err) {
        logger.warn(`[harvest-eval] evaluating '${name}' failed (non-fatal): ${String(err)}`);
      }
    }

    if (summary.disabled > 0 || summary.rewriteNeeded > 0) {
      summary.harvesterSignalCreated = await maybeSignalHarvesterQuality(deps.proposalsRepo);
    }
    return summary;
  } catch (err) {
    logger.warn(`[harvest-eval] FAILED (non-fatal): ${String(err)}`);
    return { ...EMPTY_SUMMARY };
  }
}
