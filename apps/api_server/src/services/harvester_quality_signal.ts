/**
 * harvester_quality_signal.ts — #929 Unit 4 (repeated bad harvests → harvester-fix signal)
 *
 * The #929 decision doc: "if harvester produces repeated bad skills (3-in-a-row
 * OR 5-of-last-10), treat that as a harvester-quality bug" and surface it via
 * the SAME channel the org self-optimizer already writes proposals to
 * (`agent_org_proposals` / `AgentOrgProposalsRepository`) — no new dashboard.
 *
 * `recordHarvestOutcome` is called by harvested_skill_evaluator.ts once per
 * terminal evaluation ('kept' → good, 'rewrite-needed'/'disabled' → bad). It
 * keeps a tiny rolling ledger of the last 10 outcomes (in the SAME
 * agent_skills table — no new table: every evaluated auto-extract skill's
 * `status`/`measureReason` already records its own outcome, so the "last 10"
 * is simply queried back from there) and, when the trip condition fires,
 * writes ONE deduped proposal so a tripping sequence does not spam the queue.
 *
 * Never-throws / best-effort, matching the rest of the harvest loop.
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

export type HarvestOutcome = 'good' | 'bad';

/** 3-in-a-row bad OR 5-of-last-10 bad trips the harvester-quality signal (#929 decision). */
const STREAK_TRIP = 3;
const WINDOW_SIZE = 10;
const WINDOW_TRIP = 5;

export interface RecordOutcomeDeps {
  repo?: AgentSkillsRepository;
  proposalsRepo?: AgentOrgProposalsRepository;
}

/**
 * Derive the last N terminal harvest outcomes (newest first) from the
 * agent_skills table itself: every evaluated auto-extract row's status is
 * 'active' (good) or 'rewrite-needed'/'disabled' (bad). Rows still 'draft'
 * (not yet evaluated) are excluded — they carry no verdict yet.
 */
function recentOutcomes(repo: AgentSkillsRepository, limit: number): HarvestOutcome[] {
  return repo
    .list()
    .filter((s) => s.source === 'auto-extract' && s.status !== 'draft')
    .slice(0, limit)
    .map((s): HarvestOutcome => (s.status === 'active' ? 'good' : 'bad'));
}

function tripReason(outcomes: HarvestOutcome[]): string | null {
  const streak = outcomes.findIndex((o) => o === 'good');
  const streakLen = streak === -1 ? outcomes.length : streak;
  if (streakLen >= STREAK_TRIP) {
    return `${streakLen} bad harvested skills in a row`;
  }
  const windowed = outcomes.slice(0, WINDOW_SIZE);
  const badInWindow = windowed.filter((o) => o === 'bad').length;
  if (windowed.length >= WINDOW_SIZE && badInWindow >= WINDOW_TRIP) {
    return `${badInWindow} of the last ${windowed.length} harvested skills were bad`;
  }
  return null;
}

/**
 * Record one harvest outcome and, if the bad-rate trips, write ONE deduped
 * `harvester-quality` org-optimizer proposal flagging the extractor itself
 * for review/fix. NEVER throws.
 */
export async function recordHarvestOutcome(
  outcome: HarvestOutcome,
  deps: RecordOutcomeDeps = {},
): Promise<void> {
  try {
    if (isTestEnv() && !deps.repo) return;
    if (env.dbClient === 'postgres') return;
    void outcome; // the ledger itself is the agent_skills rows already written by the caller

    const repo = deps.repo ?? new AgentSkillsRepository();
    const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();

    const outcomes = recentOutcomes(repo, WINDOW_SIZE);
    const reason = tripReason(outcomes);
    if (!reason) return;

    // Dedup key rolls daily so a sustained bad streak writes ONE signal per
    // day rather than one per bad harvest — de-dupe, not spam, per #929.
    const day = new Date().toISOString().slice(0, 10);
    const dedupKey = `harvester-quality:${day}`;

    await proposalsRepo.createAsync({
      kind: 'harvester-quality',
      risk: 'high', // never auto-applied — flags the harvester itself for human review
      status: 'proposed',
      title: 'Skill harvester is producing repeated bad skills',
      rationale: `${reason}. Review services/skill_extractor.ts (auto-extract quality) — this may need a stricter confidence floor, a better distill prompt, or to be paused.`,
      signalRef: JSON.stringify({ outcomes }),
      targetRef: 'skill_extractor.ts',
      dedupKey,
    });
    logger.info(`[harvest-eval] harvester-quality signal recorded: ${reason}`);
  } catch (err) {
    logger.warn(`[harvest-eval] recordHarvestOutcome FAILED (non-fatal): ${String(err)}`);
  }
}
