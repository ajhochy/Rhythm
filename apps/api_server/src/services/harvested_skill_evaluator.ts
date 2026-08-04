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
 * ── 2026-07-11 incident — UNKNOWN IS NOT ZERO (data-loss regression guard) ───────────────
 * The tier boundaries above only apply to a score the judge actually RETURNED.
 * An unparseable/absent/errored score (`ScoreResult.unknown`) is a FOURTH
 * outcome: do nothing. No status change, no file write, no disable, no rewrite
 * flag — the draft stays `status: draft` and the next pass retries it. Before
 * this, `scoreSkillBody` coerced unknown to 0, which is the BOTTOM of the
 * rubric, so a judge outage was indistinguishable from "this skill is garbage"
 * and took the destructive branch. On 2026-07-11 that emptied four of the
 * user's hand-written skills inside eight minutes, recording the reason
 * verbatim as `harvest-eval: disabled (score=0 < 40); unparseable score —
 * treated as 0`.
 *
 * Never throws. isTestEnv() short-circuits the real scorer to zero side
 * effects (mirrors skill_measurement.ts / skill_refiner.ts); a test injects
 * `deps.scorer` to exercise the real branch. No-op under Postgres (agent
 * execution + drafts are local-only, same posture as the rest of the loop).
 *
 * ── #959 — dependency guard on the disable path ────────────────────────────
 * A draft scoring <= DISABLE_SCORE_BAR is normally archived to disabled/ and
 * dropped from the live picker. But #929 shipped this without checking
 * whether any agent actually depends on that skill — an evaluator pass could
 * (and did, for the "AI Trend Research" workflow skill) silently disable a
 * skill an agent's `allowed_skills_json` allowlist still references, breaking
 * that agent with no warning. `collectDependedOnSkillNames` reads every
 * `agent_configs` row's `allowedSkillsJson` (the SAME allowlist the opencode
 * fork's `skill_allowlist.ts` matches against SKILL.md frontmatter `name` —
 * see docs on `filterSkillsByAllowlist`) once per evaluation pass. A draft
 * whose frontmatter `name` appears in that set is NEVER moved to disabled/,
 * even at a disable-tier score — it is routed to the SAME rewrite-needed path
 * as a mediocre score instead (still flagged, still live, still counted
 * toward the Unit 4 harvester-quality streak/window since rewrite-needed is
 * already a BAD_OUTCOMES member — no separate signal path needed).
 *
 * ---- #969 -- Unit 5: rewrite-needed -> refiner wiring --------------------
 * #929 could FLAG a draft rewrite-needed but nothing ever consumed the flag —
 * it sat there forever (dead weight on the Unit 4 streak, never improved).
 * `rewriteFlaggedDrafts` closes that loop: every pass, after Unit 3's per-
 * draft evaluation, it sweeps every LIVE `rewrite-needed` draft and gives each
 * ONE candidate-rewrite attempt (skill_refiner.rewriteSkillBody generates the
 * candidate; skill_refiner.scoreSkillBody — the SAME scorer/tier boundary
 * Unit 3 uses — judges it). Applies (status -> active, non-destructive
 * rewrite in place, still under drafts/) only if the candidate BOTH beats the
 * draft's own recorded baseline score AND clears KEEP_SCORE_BAR; otherwise the
 * body is left byte-for-byte untouched.
 *
 * LOOP SAFETY: a rewrite attempt stamps `rewriteAttemptedAt` on the draft's
 * frontmatter regardless of outcome. A draft with that marker already set (at
 * or after its own evaluatedAt) is skipped on every later pass — a ONE-SHOT
 * cap, not a cooldown timer. Since evaluateHarvestedDrafts fires after EVERY
 * completed turn (agent_runner.ts / opencode_stream_bridge.ts), an uncapped
 * sweep would re-run the generate+score LLM pair on the SAME stubborn skill
 * on every single turn in the app, forever. The cap bounds the cost to AT MOST
 * one generate+score pair per draft, ever, for as long as nothing re-opens it
 * (nothing does today — Unit 3 only re-evaluates `status: draft` rows, never
 * `rewrite-needed` ones — so "until it changes" has no live trigger yet; the
 * evaluatedAt comparison exists so a future change that DOES re-evaluate a
 * rewrite-needed draft gets a fresh attempt for free, without new plumbing).
 *
 * Never disables/removes a rewrite-needed draft, on success OR failure — a
 * depended-on skill (#959) stays live and discoverable throughout, whether or
 * not the rewrite lands. Same guards as the rest of the loop: isTestEnv()
 * (gated on an injected `deps.rewriter`, independent of Unit 3's `deps.scorer`
 * guard — see rewriteFlaggedDrafts), Postgres no-op (inherited from the outer
 * evaluateHarvestedDrafts guard), never throws, and honors the EXISTING
 * `isSkillRefinementEnabled()` toggle (skill_refiner.ts) so turning off
 * in-place refinement also turns off this sweep.
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
import {
  scoreSkillBody,
  rewriteSkillBody,
  isSkillRefinementEnabled,
  type ScoreCall,
  type RewriteCall,
  type SkillPurpose,
} from './skill_refiner';
import { classifyProposalRisk } from './org_risk_classifier';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { opencodeClient } from './opencode_engine';

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/**
 * ponytail: issue text says "track... for 2-3 real uses" — picked the upper
 * bound (more evidence before judging). Default 3; production is unchanged.
 *
 * The `RHYTHM_HARVEST_EVAL_THRESHOLD` override exists SOLELY for the #959 live
 * gate: set it to 0 so ONE completing turn evaluates every draft (a count of 0
 * is never `< 0`), removing the gate's dependence on a weak model choosing to
 * invoke specific skills. Resolved per-call so the launch env applies without a
 * module-load race; non-numeric/negative falls back to 3.
 */
function evalThreshold(): number {
  const raw = process.env.RHYTHM_HARVEST_EVAL_THRESHOLD;
  if (raw === undefined) return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

function harvestJudgeTimeoutMs(): number {
  const raw = process.env.RHYTHM_HARVEST_JUDGE_TIMEOUT_MS;
  if (raw === undefined) return 60_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

// ── #1109 — idle sweep (replaces the per-turn call sites) ──────────────────
// evaluateHarvestedDrafts() used to fire after EVERY completed turn
// (opencode_stream_bridge.ts / agent_runner.ts), fanning out further because
// Unit 3's scorer loop + Unit 5's rewrite sweep can each launch their own
// self_improvement session per draft. `scheduleIdleEvaluation` replaces those
// direct per-turn calls: many turns completing in quick succession coalesce
// into ONE evaluation pass after the loop has been idle for the debounce
// window, instead of one sweep per turn.

/**
 * Idle-debounce window before a coalesced sweep fires. Default 60s; override
 * via RHYTHM_HARVEST_EVAL_IDLE_MS (ms) for tests/tuning — same parsing style
 * as evalThreshold()/harvestJudgeTimeoutMs() above.
 */
function idleEvalDebounceMs(): number {
  const raw = process.env.RHYTHM_HARVEST_EVAL_IDLE_MS;
  if (raw === undefined) return 60_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

let _idleEvalTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget scheduling replacement for the old per-turn
 * `evaluateHarvestedDrafts()` call. If a sweep is already pending, this is a
 * no-op — the pending sweep will run once the idle window elapses regardless
 * of how many more turns complete before then, so a burst of turns collapses
 * into exactly one evaluation pass. Never throws; the eventual sweep's own
 * rejection is caught here (mirrors evaluateHarvestedDrafts's own posture, and
 * the old call sites' `.catch(...)` handling this same way).
 *
 * `runFn` is an injectable seam for tests (defaults to the real
 * {@link evaluateHarvestedDrafts}) — production callers (agent_runner.ts,
 * opencode_stream_bridge.ts) call this with no arguments.
 */
export function scheduleIdleEvaluation(
  runFn: () => Promise<unknown> = evaluateHarvestedDrafts,
): void {
  if (_idleEvalTimer) return; // already pending — coalesce
  const timer = setTimeout(() => {
    _idleEvalTimer = null;
    Promise.resolve(runFn()).catch((err) =>
      logger.warn(`[harvest-eval] scheduled evaluation failed (non-fatal): ${String(err)}`),
    );
  }, idleEvalDebounceMs());
  // Don't hold the process open for this alone (mirrors other background
  // timers in this codebase, e.g. agent_runner.ts's deadline races).
  timer.unref?.();
  _idleEvalTimer = timer;
}

/** Test-only: cancel any pending idle-evaluation timer + reset state. */
export function _resetIdleEvaluationForTests(): void {
  if (_idleEvalTimer) clearTimeout(_idleEvalTimer);
  _idleEvalTimer = null;
}

class HarvestJudgeTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'HarvestJudgeTimeoutError';
  }
}

async function withHarvestJudgeTimeout<T>(
  label: string,
  timeoutMs: number,
  run: () => Promise<T>,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HarvestJudgeTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } catch (err) {
    if (err instanceof HarvestJudgeTimeoutError) {
      logger.warn(`[harvest-eval] ${err.message} (non-fatal; skipping this draft)`);
      return null;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  /**
   * #969 — injectable rewrite-candidate generator for the rewrite-needed
   * sweep (defaults to the real opencode-backed impl). Gated INDEPENDENTLY of
   * `scorer` under isTestEnv (see rewriteFlaggedDrafts) so existing tests that
   * inject only `scorer` never trigger a real rewrite LLM call.
   */
  rewriter?: RewriteCall;
  /** Injectable usage counter (defaults to countSkillToolUses). */
  countUses?: () => Map<string, number>;
  /** Injectable engine re-scan (defaults to opencodeClient.reloadSkills). */
  reload?: () => Promise<unknown>;
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: AgentOrgProposalsRepository;
  /** Injectable agent-configs repo, for the #959 dependency guard (defaults to a fresh AgentConfigsRepository). */
  agentConfigsRepo?: AgentConfigsRepository;
  /** Injectable clock, for deterministic tests. */
  now?: () => string;
  /** Per-judge-call timeout in ms. Defaults to RHYTHM_HARVEST_JUDGE_TIMEOUT_MS or 60000. */
  judgeTimeoutMs?: number;
}

export interface EvaluateSummary {
  evaluated: number;
  kept: number;
  disabled: number;
  rewriteNeeded: number;
  /**
   * 2026-07-11 incident — drafts whose score could NOT be read this pass. These are NOT
   * evaluated, NOT counted in kept/disabled/rewriteNeeded, and were left
   * byte-for-byte untouched for a later pass to retry.
   */
  scoreUnknown: number;
  /** #969 — rewrite-needed drafts given a candidate-rewrite attempt this pass. */
  rewriteAttempted: number;
  /** #969 — of those attempts, how many measurably improved and moved to active. */
  rewritten: number;
  harvesterSignalCreated: boolean;
}

const EMPTY_SUMMARY: EvaluateSummary = {
  evaluated: 0,
  kept: 0,
  disabled: 0,
  rewriteNeeded: 0,
  scoreUnknown: 0,
  rewriteAttempted: 0,
  rewritten: 0,
  harvesterSignalCreated: false,
};

interface HarvestOutcomeRecord {
  name: string;
  outcome: HarvestStatus;
  evaluatedAt: string;
}

/** Parse an `allowed_skills_json` string into a plain string array. Mirrors the
 *  same local parse the org-optimizer audit uses — null/malformed/non-array
 *  input all degrade to []. */
function parseAllowedSkillNames(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * #959 — every skill name referenced by ANY agent_configs row's allowlist
 * (enabled or not — a disabled profile can be re-enabled later, so its
 * allowlist still counts). Built once per evaluation pass. Never throws: a
 * repo read failure logs and degrades to "no known dependents", i.e. the
 * pre-#959 disable behavior, since this is a rare/catastrophic DB failure
 * mode the rest of the evaluator can't work around either.
 */
function collectDependedOnSkillNames(repo: AgentConfigsRepository): Set<string> {
  try {
    const names = new Set<string>();
    for (const config of repo.list()) {
      for (const name of parseAllowedSkillNames(config.allowedSkillsJson)) names.add(name);
    }
    return names;
  } catch (err) {
    logger.warn(`[harvest-eval] could not read agent_configs for the dependency guard (non-fatal): ${String(err)}`);
    return new Set();
  }
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
 * #969 (Unit 5) — give every LIVE `rewrite-needed` draft ONE candidate-rewrite
 * attempt, ever, unless its own evaluatedAt moves past the last attempt (see
 * module docstring). NEVER throws — each draft's attempt is individually
 * guarded so one bad draft can't block the rest.
 *
 * isTestEnv() gate is INDEPENDENT of evaluateHarvestedDrafts's own `scorer`
 * guard: many existing tests inject `deps.scorer` (to exercise Unit 3) without
 * ever intending to exercise this sweep, so this function must not fire a
 * real rewriter call just because a scorer happened to be injected upstream.
 * A test that wants this branch injects `deps.rewriter` AND clears
 * VITEST/NODE_ENV, same discipline as `refineExistingSkill`'s judge guard.
 */
async function rewriteFlaggedDrafts(
  deps: EvaluateDeps,
  now: () => string,
): Promise<{ rewriteAttempted: number; rewritten: number }> {
  const result = { rewriteAttempted: 0, rewritten: 0 };
  if (isTestEnv() && !deps.rewriter) return result;
  if (!isSkillRefinementEnabled()) return result;
  const judgeTimeoutMs = deps.judgeTimeoutMs ?? harvestJudgeTimeoutMs();

  for (const name of listDraftSkillNames()) {
    try {
      const draft = readDraftSkill(name);
      if (!draft || draft.frontmatter.status !== 'rewrite-needed') continue;

      // Loop-safety cap: already attempted, and nothing has re-evaluated this
      // draft since (or there's nothing to compare against) -> never retry.
      const attemptedAt = draft.frontmatter.rewriteAttemptedAt;
      const evaluatedAt = draft.frontmatter.evaluatedAt;
      const alreadyAttempted = attemptedAt !== undefined && (!evaluatedAt || attemptedAt >= evaluatedAt);
      if (alreadyAttempted) continue;

      result.rewriteAttempted++;
      const purpose: SkillPurpose = { name, description: draft.frontmatter.description ?? null };
      const reason = draft.frontmatter.measureReason ?? 'flagged rewrite-needed';
      const candidateBody = await rewriteSkillBody(purpose, draft.body, reason, deps.rewriter);
      const candidateScore = await withHarvestJudgeTimeout(
        `rewrite judge for '${name}'`,
        judgeTimeoutMs,
        () => scoreSkillBody(purpose, candidateBody, deps.scorer),
      );
      if (!candidateScore) continue;

      // 2026-07-11 incident — an unreadable score cannot justify writing anything, including
      // the `rewriteAttemptedAt` cap marker: stamping it would burn this
      // draft's ONE lifetime attempt on a judge outage. Leave the file exactly
      // as it is and let a later pass retry.
      // ponytail: ceiling — a permanently broken judge re-runs the
      // generate+score pair once per idle sweep for this draft. Bound it with a
      // separate unknown-attempt counter in frontmatter only if that shows up
      // in the cost logs.
      if (candidateScore.unknown) {
        logger.warn(
          `[harvest-eval] rewrite judge for '${name}' returned no readable score ` +
            `(${candidateScore.reason}) — leaving the draft untouched and NOT consuming its rewrite attempt`,
        );
        continue;
      }

      const baselineScore = draft.frontmatter.postScore ?? 0;
      const attemptedAtNow = now();

      const baseInput = {
        name,
        description: draft.frontmatter.description,
        sourceSessionId: draft.frontmatter.sourceSession ?? '',
        confidence: draft.frontmatter.confidence ?? 0,
        provenance: draft.frontmatter.provenance,
        extractedAt: draft.frontmatter.extractedAt,
        rewriteAttemptedAt: attemptedAtNow,
      };

      // Non-destructive quality bar: apply only a MEASURABLE improvement that
      // ALSO clears the SAME absolute bar Unit 3 uses to decide 'active' — a
      // worse/equal/still-mediocre candidate never touches the live body.
      if (candidateScore.score > baselineScore && candidateScore.score >= KEEP_SCORE_BAR) {
        writeDraftManagedSkill({
          ...baseInput,
          body: candidateBody,
          status: 'active',
          evaluatedAt: attemptedAtNow,
          postScore: candidateScore.score,
          measureReason: candidateScore.reason,
        });
        result.rewritten++;
        logger.info(
          `[harvest-eval] rewrote '${name}' in place (${baselineScore} -> ${candidateScore.score}) — status: active`,
        );
      } else {
        // Not an improvement — leave the body untouched, just stamp the
        // attempt marker so this draft is never re-tried.
        writeDraftManagedSkill({
          ...baseInput,
          body: draft.body,
          status: 'rewrite-needed',
          evaluatedAt: draft.frontmatter.evaluatedAt,
          postScore: draft.frontmatter.postScore,
          measureReason: draft.frontmatter.measureReason,
        });
        logger.info(
          `[harvest-eval] rewrite attempt for '${name}' did not improve it (${baselineScore} -> ${candidateScore.score}) — capped, staying rewrite-needed`,
        );
      }
    } catch (err) {
      logger.warn(`[harvest-eval] rewrite attempt for '${name}' failed (non-fatal): ${String(err)}`);
    }
  }

  return result;
}

/**
 * Unit 3 — evaluate every eligible draft and decide keep/disable/rewrite-
 * needed; Unit 5 (#969) — sweep every rewrite-needed draft (including ones
 * freshly flagged by Unit 3 in THIS pass) for a one-shot refiner attempt;
 * Unit 4 — fires the harvester-quality check when this pass produced any bad
 * outcome (run AFTER Unit 5, so a same-pass successful rewrite is already
 * 'active' and correctly excluded from the bad-outcome window). NEVER
 * throws; each draft's evaluation is individually guarded so one bad draft
 * can't block the rest.
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
    const agentConfigsRepo = deps.agentConfigsRepo ?? new AgentConfigsRepository();
    const judgeTimeoutMs = deps.judgeTimeoutMs ?? harvestJudgeTimeoutMs();

    const uses = countUses();
    const dependedOnSkillNames = collectDependedOnSkillNames(agentConfigsRepo);
    const summary: EvaluateSummary = { ...EMPTY_SUMMARY };

    for (const name of listDraftSkillNames()) {
      try {
        const draft = readDraftSkill(name);
        if (!draft || draft.frontmatter.status !== 'draft') continue; // already evaluated or unknown shape

        const count = uses.get(name) ?? 0;
        if (count < evalThreshold()) continue;

        const purpose: SkillPurpose = {
          name,
          description: draft.frontmatter.description ?? null,
        };
        const result = await withHarvestJudgeTimeout(
          `judge for '${name}'`,
          judgeTimeoutMs,
          () => scoreSkillBody(purpose, draft.body, deps.scorer),
        );
        if (!result) continue;

        // 2026-07-11 incident — UNKNOWN IS NOT ZERO. A judge response we could not read tells
        // us NOTHING about this skill, so do nothing at all: no status change,
        // no file write, no disable, no rewrite flag. The draft stays
        // `status: draft`, which is exactly the condition this loop selects on,
        // so the next pass retries it for free. Treating unknown as 0 is what
        // emptied four hand-written skills on 2026-07-11.
        if (result.unknown) {
          summary.scoreUnknown++;
          logger.warn(
            `[harvest-eval] could NOT read a score for '${name}' (${result.reason}) — ` +
              `leaving the draft untouched; a later pass will retry`,
          );
          continue;
        }

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
        } else if (result.score <= DISABLE_SCORE_BAR && !dependedOnSkillNames.has(draft.frontmatter.name ?? name)) {
          moveDraftToDisabled(name, { evaluatedAt, postScore: result.score, measureReason: result.reason });
          try {
            await reload();
          } catch (err) {
            logger.warn(`[harvest-eval] reload after disabling '${name}' failed (non-fatal): ${String(err)}`);
          }
          summary.disabled++;
        } else if (result.score <= DISABLE_SCORE_BAR) {
          // #959 — a depended-on skill is NEVER auto-disabled, even at a
          // disable-tier score. Route to rewrite-needed instead (still live,
          // still flagged, still counted toward the Unit 4 bad-outcome streak).
          logger.info(
            `[harvest-eval] '${name}' scored ${result.score} (disable-tier) but is referenced by an agent's ` +
              `allowed_skills_json — routing to rewrite-needed instead of disabling`,
          );
          writeDraftManagedSkill({ ...baseInput, status: 'rewrite-needed' });
          summary.rewriteNeeded++;
        } else {
          writeDraftManagedSkill({ ...baseInput, status: 'rewrite-needed' });
          summary.rewriteNeeded++;
        }
      } catch (err) {
        logger.warn(`[harvest-eval] evaluating '${name}' failed (non-fatal): ${String(err)}`);
      }
    }

    // #969 (Unit 5) — one-shot refiner attempt for every LIVE rewrite-needed
    // draft, INCLUDING any just flagged by Unit 3 above in this same pass.
    const rewriteResult = await rewriteFlaggedDrafts(deps, now);
    summary.rewriteAttempted = rewriteResult.rewriteAttempted;
    summary.rewritten = rewriteResult.rewritten;

    if (summary.disabled > 0 || summary.rewriteNeeded > 0) {
      summary.harvesterSignalCreated = await maybeSignalHarvesterQuality(deps.proposalsRepo);
    }
    return summary;
  } catch (err) {
    logger.warn(`[harvest-eval] FAILED (non-fatal): ${String(err)}`);
    return { ...EMPTY_SUMMARY };
  }
}
