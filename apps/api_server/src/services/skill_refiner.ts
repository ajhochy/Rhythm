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
import { applyToEngineSkill, type ApplyCandidate, type ApplyOutcome } from './skill_apply';
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

/** Default (real) judge — guarded; never reached under isTestEnv. */
const defaultJudge: JudgeCall = async (existing, candidate) => {
  const { opencodeClient } = await import('./opencode_engine');
  const { resolveRunModel } = await import('./agent_runner');
  const model = resolveRunModel();
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
  const session = await opencodeClient.createSession('skill-refine-judge');
  if (!session?.id) {
    _setRefineRunning(false);
    return { verdict: 'equal', reason: 'no judge session' };
  }
  const resp = await opencodeClient.prompt(session.id, `${system}\n\n${user}`, model, undefined, {
    permissionMode: 'bypassPermissions',
  });
  _setRefineRunning(false);
  const text = (resp?.parts ?? [])
    .filter((p): p is import('@opencode-ai/sdk').TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
  return parseJudgeResponse(text);
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
   * #794 — Injectable apply step over the LIVE engine skill set (defaults to
   * {@link applyToEngineSkill}). On a 'better' verdict the refiner hands the
   * candidate here to write a SKILL.md (managed in-place / external fork-to-shadow)
   * and move the sidecar row to `status='measuring'`. Tests inject a double so
   * no real file write / engine call happens.
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
    const applyToEngine = deps.applyToEngine ?? ((c: ApplyCandidate) => applyToEngineSkill(c));
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
