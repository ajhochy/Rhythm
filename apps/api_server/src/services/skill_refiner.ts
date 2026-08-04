/**
 * skill_refiner.ts — P5-2
 *
 * The self-improvement loop's "improve an EXISTING skill in place" decision.
 *
 * When the background extractor (P2) or the teacher-escalation path (P4) distills
 * a candidate that matches a skill already in the store (by title, or by a high
 * relevance score), we do NOT blindly overwrite it. Instead:
 *
 *   1. A QUALITY BAR gates the replacement. confidence alone is NOT enough — an
 *      injectable LLM "judge" compares the existing skill against the candidate
 *      and returns better | equal | worse (+ reason). We only revise on a clear
 *      "better". FAIL-CLOSED: equal / worse / uncertain / a thrown judge → keep
 *      the existing skill untouched.
 *   2. We additionally require candidate.confidence >= existing.confidence.
 *   3. On "better": call reviseInPlace(...) (auto-applied, no human approval —
 *      version history + rollback make it non-destructive).
 *
 * Design constraints (mirror the rest of the loop):
 *   • isTestEnv() short-circuits the real judge LLM to ZERO side effects.
 *   • NEVER throws — callers (skill_extractor / escalateAndCapture) are
 *     fire-and-forget.
 *   • Postgres is a no-op (agent data is local-SQLite-only).
 *   • The judge LLM call is INJECTABLE so tests need no real model.
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { getRelevantSkills } from './skill_retrieval';
import { applyAndMeasure, type ApplyCandidate, type ApplyOutcome } from './skill_apply';
import type { AgentSkill } from '../models/agent_skill';

/** Mirrors opencode_agent_writer.ts isTestEnv() VERBATIM. */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

// ── Background status tracking ────────────────────────────────────────────────
let _refineLastAt: string | null = null;
let _refineRunning = false;

/** Update refine-run tracking. Called by runJudge start/end. */
export function _setRefineRunning(running: boolean, at?: string): void {
  _refineRunning = running;
  if (at) _refineLastAt = at;
}

/** Return lightweight refine status for the background-status endpoint. */
export function getCuratorRefineStatus(): { running: boolean; lastRunAt: string | null } {
  return { running: _refineRunning, lastRunAt: _refineLastAt };
}

/**
 * Live read of the refinement toggle (mirrors isSkillInjectionEnabled). When OFF
 * the loop still drafts NEW skills but never revises existing ones. Default ON.
 * Only the literal strings 'false' / '0' disable it.
 */
export function isSkillRefinementEnabled(): boolean {
  const raw = (process.env.AGENT_SKILL_REFINEMENT_ENABLED ?? '').trim().toLowerCase();
  return !(raw === 'false' || raw === '0');
}

/**
 * Relevance score at/above which a candidate is treated as the SAME skill as an
 * existing one (and therefore a revision candidate rather than a new draft).
 * Title match always wins regardless of score.
 */
const SAME_SKILL_THRESHOLD = 0.6;

export type JudgeVerdict = 'better' | 'equal' | 'worse';

export interface JudgeResult {
  verdict: JudgeVerdict;
  reason: string;
}

/** A distilled candidate ready to be compared against an existing skill. */
export interface RefineCandidate {
  title: string;
  description?: string | null;
  whenToUse?: string | null;
  steps?: string[] | null;
  tags?: string[] | null;
  body?: string | null;
  confidence: number;
}

/**
 * Injectable LLM judge: given the existing skill and the candidate, decide
 * whether the candidate is better. Defaults to the real opencode-backed impl.
 */
export type JudgeCall = (existing: AgentSkill, candidate: RefineCandidate) => Promise<JudgeResult>;

function skillText(s: { title: string; description?: string | null; whenToUse?: string | null; steps?: string[] | null }): string {
  return [
    `title: ${s.title}`,
    s.whenToUse ? `whenToUse: ${s.whenToUse}` : '',
    s.description ? `description: ${s.description}` : '',
    s.steps && s.steps.length ? `steps:\n- ${s.steps.join('\n- ')}` : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

/**
 * #1110 (cost-002) — task-kind hint shared by every self-improvement LLM call
 * in this file (judge / scorer / rewriter). All three are cheap, tool-less,
 * mechanical grading/generation tasks over a skill body — not a judgment call
 * worth a frontier model — so they deliberately route to 'triage' (a
 * TASK_KIND_TIER_POLICY 'cheap'-tier kind), not 'judgment' (which resolves to
 * 'frontier'). AgentRunner's own tiered routing (agent_model_resolver.
 * resolveTieredModel) picks the cheapest AUTHED route; no modelOverride is
 * passed here (an explicit override would bypass tiering entirely).
 */
const SELF_IMPROVEMENT_TASK_KIND = 'triage';

/** Default (real) judge — guarded; never reached under isTestEnv. */
const defaultJudge: JudgeCall = async (existing, candidate) => {
  const system =
    'You are grading whether a CANDIDATE revision of an agent skill is an ' +
    'improvement over the EXISTING skill. Reply with ONLY one of: better, ' +
    'equal, worse — then a space and a one-sentence reason. "better" means the ' +
    'candidate is clearly more accurate, more complete, or more reusable than ' +
    'the existing skill WITHOUT losing important detail. If unsure, answer ' +
    '"equal". Never answer "better" unless the improvement is clear.';
  const user =
    `EXISTING skill:\n${skillText(existing)}\n\n` +
    `CANDIDATE skill:\n${skillText(candidate)}\n\n` +
    'Verdict (better|equal|worse) + one-sentence reason:';
  _setRefineRunning(true, new Date().toISOString());
  try {
    // USO B3 (#1030): route the judge through AgentRunner so it becomes an
    // observable self_improvement session (recorded row + transcript) instead of
    // a bare createSession/prompt pair. allowedMcpsJson '{}' → zero MCP tools
    // (Gemini-safe), matching the old createSession that passed no tools. A failed
    // run resolves status:'error' → '' → parseJudgeResponse's fail-closed 'equal'
    // (same fail-path as the old "no judge session" / empty-parts branches).
    // #1110: allowedSkillsJson '[]' denies all skills (no system-prompt skill
    // listing); taskKind routes to the cheap tier instead of a hardcoded
    // reliable-fallback model.
    const { run } = await import('./agent_runner');
    const res = await run({
      prompt: `${system}\n\n${user}`,
      sessionName: 'skill-refine-judge',
      category: 'self_improvement',
      taskKind: SELF_IMPROVEMENT_TASK_KIND,
      mcpRole: 'skill-refine-judge',
      allowedMcpsJson: '{}',
      allowedSkillsJson: '[]',
    });
    const text = res.status === 'error' ? '' : res.result;
    return parseJudgeResponse(text);
  } finally {
    _setRefineRunning(false);
  }
};

/**
 * Parse a free-text judge response into a {@link JudgeResult}. FAIL-CLOSED: any
 * response that does not clearly start with "better" maps to a non-improving
 * verdict ("equal" unless it clearly says "worse"). This is exported for tests.
 */
export function parseJudgeResponse(raw: string): JudgeResult {
  const text = (raw ?? '').trim();
  const lower = text.toLowerCase();
  // Look only at the leading token so a "...not better..." reason can't flip it.
  const head = lower.replace(/^[^a-z]*/, '');
  if (head.startsWith('better')) {
    return { verdict: 'better', reason: text };
  }
  if (head.startsWith('worse')) {
    return { verdict: 'worse', reason: text };
  }
  return { verdict: 'equal', reason: text || 'unrecognized judge verdict — treated as equal' };
}

// ── #795: purpose-anchored numeric scoring (measurement, not the categorical
//         in-place-refinement judge above) ──────────────────────────────────
//
// The categorical better|equal|worse judge above (used by refineExistingSkill)
// is EPHEMERAL and IGNORES the skill `body`. #795 needs a PERSISTED, bounded,
// purpose-anchored score that COMPARES the body so the measure step can decide
// `post_score > baseline_score`. That is this scorer. It is deliberately a
// separate exported function so the in-place refinement path is untouched.

/** The skill's stated purpose — the fixed anchor every body is scored against. */
export interface SkillPurpose {
  name: string;
  description?: string | null;
  whenToUse?: string | null;
}

export interface ScoreResult {
  /** Integer 0–100. */
  score: number;
  /** Judge's one-sentence rationale (or the failure reason). */
  reason: string;
}

/**
 * Injectable purpose-anchored body scorer: given a skill's stated PURPOSE and a
 * candidate BODY, return an integer 0–100 quality score + a one-line reason.
 * Defaults to the real opencode-backed impl. Tests inject a deterministic one.
 */
export type ScoreCall = (purpose: SkillPurpose, body: string) => Promise<ScoreResult>;

/**
 * The absolute quality bar a body must clear to be treated as good enough to
 * KEEP / ADOPT. Reuses {@link buildScoreSystemPrompt}'s OWN rubric band
 * boundary verbatim ("61-80: accurate, reasonably complete, and actionable") —
 * no separately-invented bar. Single source of truth for every caller that
 * needs an absolute (rather than relative) threshold:
 * harvested_skill_evaluator's keep/rewrite decision and
 * external_discovery_search's third-party adoption floor.
 */
export const KEEP_SCORE_BAR = 61;

function purposeText(p: SkillPurpose): string {
  return [
    `name: ${p.name}`,
    p.description ? `description: ${p.description}` : '',
    p.whenToUse ? `whenToUse: ${p.whenToUse}` : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

/**
 * The fixed scoring rubric. Stable across baseline + post calls so the two
 * scores are comparable. Anchors the body to the skill's STATED PURPOSE.
 */
function buildScoreSystemPrompt(): string {
  return (
    'You are grading how well a skill BODY fulfills the skill\'s STATED PURPOSE. ' +
    'Output ONLY an integer from 0 to 100 followed by a space and a one-sentence ' +
    'reason. Use this rubric:\n' +
    '- 0-20: body is missing, off-topic, or contradicts the purpose.\n' +
    '- 21-40: loosely related but vague, incomplete, or misleading.\n' +
    '- 41-60: covers the purpose at a basic level with notable gaps.\n' +
    '- 61-80: accurate, reasonably complete, and actionable.\n' +
    '- 81-100: precise, complete, reusable, and free of errors.\n' +
    'Judge ONLY the body against the purpose; do not reward verbosity.'
  );
}

/**
 * Default (real) scorer — guarded; never reached under isTestEnv.
 *
 * #1110 (cost-002): previously fanned out across every reliable authed
 * fallback provider (#930/#997 chain) — up to N run() calls (each a full
 * self_improvement session) per single score. That fan-out is the "Scorer
 * fan-out bounded" acceptance criterion's target: this now makes exactly ONE
 * run() call at the cheap tier (taskKind) and fails closed (score 0) on an
 * unparseable/error result, rather than retrying the next provider. A single
 * cheap-tier judge is an acceptable trade for the cost win — the caller
 * (harvested_skill_evaluator.ts) already treats a 0 score as "not good enough
 * yet", never as a crash.
 */
const defaultScorer: ScoreCall = async (purpose, body) => {
  const system = buildScoreSystemPrompt();
  const user =
    `PURPOSE:\n${purposeText(purpose)}\n\n` +
    `BODY:\n${(body ?? '').trim() || '(empty)'}\n\n` +
    'Score (0-100) + one-sentence reason:';
  // USO B3 (#1030): route through AgentRunner so scoring becomes an observable
  // self_improvement session. #1110: allowedSkillsJson '[]' denies all skills;
  // taskKind routes to the cheap tier instead of a hardcoded reliable-fallback
  // model — no modelOverride, no per-provider retry loop.
  const { run } = await import('./agent_runner');
  const res = await run({
    prompt: `${system}\n\n${user}`,
    sessionName: 'skill-measure-score',
    category: 'self_improvement',
    taskKind: SELF_IMPROVEMENT_TASK_KIND,
    mcpRole: 'skill-measure-score',
    allowedMcpsJson: '{}',
    allowedSkillsJson: '[]',
  });
  const text = res.status === 'error' ? '' : res.result;
  if (!/^\s*-?\d+\b/.test(text)) {
    return { score: 0, reason: `unparseable scorer response: ${text || 'empty scorer response'}` };
  }
  return parseScoreResponse(text);
};

/**
 * Parse a free-text score response into a {@link ScoreResult}. FAIL-CLOSED: a
 * response with no parseable leading integer in [0,100] yields score 0 (so the
 * measure step treats it as no improvement → revert). Exported for tests.
 */
export function parseScoreResponse(raw: string): ScoreResult {
  const text = (raw ?? '').trim();
  const m = text.match(/-?\d+/);
  if (!m) {
    return { score: 0, reason: text || 'unparseable score — treated as 0' };
  }
  let n = parseInt(m[0], 10);
  if (!Number.isFinite(n)) return { score: 0, reason: 'non-finite score — treated as 0' };
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  const reason = text.slice(text.indexOf(m[0]) + m[0].length).trim() || text;
  return { score: n, reason };
}

/**
 * Score a body against a stated purpose using the (injectable) scorer. NEVER
 * throws — a thrown scorer is mapped to a fail-closed score of 0. Used by the
 * #795 measurement step for both baseline and post bodies.
 */
export async function scoreSkillBody(
  purpose: SkillPurpose,
  body: string | null,
  scorer: ScoreCall = defaultScorer,
): Promise<ScoreResult> {
  try {
    return await scorer(purpose, body ?? '');
  } catch (err) {
    logger.warn(`[skill-measure] scorer threw (fail-closed → 0): ${String(err)}`);
    return { score: 0, reason: `scorer error: ${String(err)}` };
  }
}

// ── #969 — rewrite-needed → refiner candidate generation ───────────────────
//
// scoreSkillBody (above) JUDGES a body; nothing in this file GENERATES one.
// The rewrite-needed sweep (harvested_skill_evaluator.ts) needs an actual
// improved candidate to score, so this is the one missing piece: same LLM-call
// plumbing as defaultScorer, a different (generative) prompt. Never invents a
// new judge/quality-bar — the sweep still gates the result through
// scoreSkillBody + the SAME KEEP_SCORE_BAR the evaluator already uses.

/**
 * Injectable candidate-rewrite generator: given a skill's stated PURPOSE, its
 * CURRENT (inadequate) body, and the reason it was flagged, produce an
 * improved body. Defaults to the real opencode-backed impl. Tests inject a
 * deterministic one.
 */
export type RewriteCall = (purpose: SkillPurpose, currentBody: string, reason: string) => Promise<string>;

function buildRewriteSystemPrompt(): string {
  return (
    "You are rewriting an agent skill's BODY so it actually fulfills the skill's " +
    'STATED PURPOSE. You will be given the PURPOSE, the CURRENT BODY (already ' +
    'judged inadequate), and the REASON it was judged inadequate. Output ONLY the ' +
    'improved markdown body — no commentary, no frontmatter. Be concise, accurate, ' +
    'and actionable.'
  );
}

/** Default (real) rewriter — guarded; never reached under isTestEnv. */
const defaultRewrite: RewriteCall = async (purpose, currentBody, reason) => {
  const system = buildRewriteSystemPrompt();
  const user =
    `PURPOSE:\n${purposeText(purpose)}\n\n` +
    `CURRENT BODY (inadequate):\n${(currentBody ?? '').trim() || '(empty)'}\n\n` +
    `WHY IT WAS FLAGGED: ${reason || '(no reason recorded)'}\n\n` +
    'Improved BODY:';
  // USO B3 (#1030): route the rewrite through AgentRunner so it becomes an
  // observable self_improvement session. allowedMcpsJson '{}' → zero MCP tools
  // (Gemini-safe), matching the old createSession that passed no tools. A failed
  // run (status:'error' → '') or an empty rewrite degrades to the CURRENT body
  // UNCHANGED — same fail-closed path as the old "no rewrite session" / empty
  // response, so a generation failure can never masquerade as an improvement.
  // #1110: allowedSkillsJson '[]' denies all skills; taskKind routes to the
  // cheap tier instead of a hardcoded reliable-fallback model.
  const { run } = await import('./agent_runner');
  const res = await run({
    prompt: `${system}\n\n${user}`,
    sessionName: 'skill-refine-rewrite',
    category: 'self_improvement',
    taskKind: 'extraction',
    mcpRole: 'skill-refine-rewrite',
    allowedMcpsJson: '{}',
    allowedSkillsJson: '[]',
  });
  const text = res.status === 'error' ? '' : res.result;
  return text || currentBody;
};

/**
 * Generate a candidate rewrite of an inadequate skill body. NEVER throws — a
 * thrown/empty rewriter degrades to the CURRENT body UNCHANGED, so a
 * generation failure can never masquerade as an "improvement" downstream (the
 * subsequent score comparison against the same body can, at best, tie — never
 * beat the baseline — so the non-destructive gate holds even on failure).
 */
export async function rewriteSkillBody(
  purpose: SkillPurpose,
  currentBody: string,
  reason: string,
  rewriter: RewriteCall = defaultRewrite,
): Promise<string> {
  try {
    return await rewriter(purpose, currentBody, reason);
  } catch (err) {
    logger.warn(`[skill-refine] rewriter threw (fail-closed → unchanged body): ${String(err)}`);
    return currentBody;
  }
}

export interface RefineDeps {
  /** Injectable judge (defaults to the real opencode-backed impl). */
  judge?: JudgeCall;
  /** Injectable repo (defaults to a fresh AgentSkillsRepository). */
  repo?: AgentSkillsRepository;
  /** Injectable same-skill matcher (defaults to getRelevantSkills). */
  getRelevant?: (query: string, topN?: number) => AgentSkill[];
  /** Source label written on a successful revision. Defaults to 'auto-refined'. */
  source?: string;
  /**
   * #794 + #795 — Injectable apply step over the LIVE engine skill set (defaults
   * to {@link applyAndMeasure}). On a 'better' verdict the refiner hands the
   * candidate here to write a SKILL.md (managed in-place / external fork-to-shadow),
   * move the sidecar row to `status='measuring'`, and then MEASURE it so the row
   * ends `active` (kept) or `reverted` (auto-rolled-back) — never stuck measuring.
   * Tests inject a double so no real file write / engine / scorer call happens.
   */
  applyToEngine?: (candidate: ApplyCandidate) => Promise<ApplyOutcome>;
}

/**
 * #794 — Render a refine candidate to a SKILL.md body. Prefers an explicit
 * `body`; otherwise composes one from whenToUse + steps (mirrors
 * skill_materializer.renderSkillBody so a refined skill reads the same as a
 * materialized one).
 */
export function renderCandidateBody(candidate: RefineCandidate): string {
  if (candidate.body && candidate.body.trim() !== '') return candidate.body;

  const parts: string[] = [`# ${candidate.title}`, ''];
  const whenToUse = candidate.whenToUse ?? candidate.description ?? null;
  if (whenToUse && whenToUse.trim() !== '') {
    parts.push('## When to use', '', whenToUse.trim(), '');
  }
  const steps = candidate.steps ?? null;
  if (Array.isArray(steps) && steps.length > 0) {
    parts.push('## Steps', '');
    steps.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * Find the EXISTING skill a candidate should revise, if any.
 *
 * Match precedence:
 *   1. exact (case-insensitive) title match — always wins.
 *   2. else the top getRelevantSkills() hit, IF it scores high enough to be the
 *      "same" skill (>= SAME_SKILL_THRESHOLD). We re-score the single candidate
 *      against the matched skill is unnecessary — getRelevantSkills already
 *      ranks by relevance, so we take its top hit and trust the threshold via a
 *      title-token query built from the candidate.
 *
 * Returns null when there is no existing skill to revise (→ caller keeps the
 * candidate as a normal new draft).
 */
export function findRevisionTarget(
  candidate: RefineCandidate,
  repo: AgentSkillsRepository,
  getRelevant: (query: string, topN?: number) => AgentSkill[] = getRelevantSkills,
): AgentSkill | null {
  const byTitle = repo.findByTitle(candidate.title);
  if (byTitle) return byTitle;

  // Relevance match: query from the candidate's most descriptive text.
  const query = [candidate.title, candidate.whenToUse ?? '', candidate.description ?? '']
    .filter((s) => s && s.length > 0)
    .join(' ');
  const matches = getRelevant(query, 1);
  if (matches.length === 0) return null;

  // getRelevantSkills only returns hits >= its own 0.3 threshold; require the
  // stricter SAME_SKILL_THRESHOLD before treating it as the SAME skill. We can't
  // see the score from here, so re-derive it via a conservative second check:
  // the candidate title's tokens must overlap the matched skill meaningfully.
  const top = matches[0];
  if (isSameSkill(candidate, top)) return top;
  return null;
}

/**
 * Conservative "is this the same skill?" check used to gate relevance-based
 * matches. A title that is a substring of the other (either direction), or a
 * Jaccard token overlap >= SAME_SKILL_THRESHOLD over the titles, qualifies.
 */
export function isSameSkill(candidate: RefineCandidate, existing: AgentSkill): boolean {
  const a = candidate.title.trim().toLowerCase();
  const b = existing.title.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(/\s+/).filter((t) => t.length > 1));
  const tb = new Set(b.split(/\s+/).filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jacc = inter / (ta.size + tb.size - inter);
  return jacc >= SAME_SKILL_THRESHOLD;
}

/**
 * P5-2 core: given a freshly distilled candidate, attempt an in-place refinement
 * of a matching existing skill. Returns one of:
 *   - 'revised'   — the existing skill was improved in place (version bumped).
 *   - 'kept'      — a match existed but the quality bar failed; existing unchanged.
 *   - 'no-match'  — no existing skill matched; caller should draft a new skill.
 *   - 'skipped'   — disabled / test env / postgres; caller should draft normally.
 *
 * NEVER throws. The judge LLM call is injectable; under isTestEnv the real judge
 * never runs (a test must inject one), and we hard-skip to 'skipped' there too.
 */
export async function refineExistingSkill(
  candidate: RefineCandidate,
  deps: RefineDeps = {},
): Promise<'revised' | 'kept' | 'no-match' | 'skipped'> {
  try {
    if (!isSkillRefinementEnabled()) return 'skipped';
    // Hard guard: the REAL judge must never run under test. A test that wants to
    // exercise this path injects deps.judge AND clears VITEST/NODE_ENV.
    if (isTestEnv() && !deps.judge) return 'skipped';
    if (env.dbClient === 'postgres') return 'skipped';

    const repo = deps.repo ?? new AgentSkillsRepository();
    const existing = findRevisionTarget(candidate, repo, deps.getRelevant);
    if (!existing) return 'no-match';

    // Quality bar #1: candidate must be at least as confident as the existing.
    if (candidate.confidence < existing.confidence) {
      logger.info(
        `[skill-refine] '${candidate.title}' confidence ${candidate.confidence} < existing ${existing.confidence} — keeping existing`,
      );
      return 'kept';
    }

    // Quality bar #2: the LLM judge must say a CLEAR "better". FAIL-CLOSED on
    // equal/worse/throw.
    const judge = deps.judge ?? defaultJudge;
    let verdict: JudgeResult;
    try {
      verdict = await judge(existing, candidate);
    } catch (err) {
      logger.warn(`[skill-refine] judge threw (non-fatal) — keeping existing: ${String(err)}`);
      return 'kept';
    }

    if (verdict.verdict !== 'better') {
      logger.info(
        `[skill-refine] judge verdict '${verdict.verdict}' for '${candidate.title}' — keeping existing (${verdict.reason})`,
      );
      return 'kept';
    }

    // #794 — AUTO-APPLY to the LIVE engine skill set (not just the DB row). The
    // matched skill's `name` is its title (the sidecar join key #775/#778 align
    // on). applyToEngineSkill resolves it against the live set, re-checks the
    // pre-apply gate + duplicate guard, then writes a SKILL.md (managed in-place
    // OR external fork-to-shadow) and moves the sidecar row to 'measuring'.
    const source = deps.source ?? 'auto-refined';
    // #794 + #795 — default to applyAndMeasure so a 'better' verdict runs the
    // full apply → measure → (keep | auto-revert) pass in one fire-and-forget
    // step (the row never stays stuck 'measuring'). Tests inject a double.
    const applyToEngine = deps.applyToEngine ?? ((c: ApplyCandidate) => applyAndMeasure(c));
    const outcome = await applyToEngine({
      name: existing.title,
      body: renderCandidateBody(candidate),
      description: candidate.description ?? candidate.whenToUse ?? null,
      confidence: candidate.confidence,
      source,
    });

    if (outcome === 'applied-managed' || outcome === 'applied-external-fork') {
      logger.info(
        `[skill-refine] applied '${existing.title}' to live engine skill (${outcome}, source=${source}): ${verdict.reason}`,
      );
      return 'revised';
    }
    // no-target / skipped-gate / skipped-duplicate / skipped → existing untouched.
    logger.info(
      `[skill-refine] apply outcome '${outcome}' for '${existing.title}' — keeping existing`,
    );
    return 'kept';
  } catch (err) {
    // NEVER throw — the loop callers are fire-and-forget.
    logger.warn(`[skill-refine] FAILED (non-fatal): ${String(err)}`);
    return 'kept';
  }
}
