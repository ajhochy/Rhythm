/**
 * skill_retrieval.ts — relevance scorer for the shared agent skill library.
 *
 * Mirrors Odysseus `services/memory/skills.py::SkillsManager.get_relevant_skills`
 * (the scoring section). Given an incoming message it ranks stored AgentSkills
 * by lexical relevance and returns the top-N eligible matches.
 *
 * This is a PURE function over in-memory rows loaded from AgentSkillsRepository.
 * No caching, no FTS. With < ~100 skills the O(skills * tokens) scan is trivially
 * cheap; if the library grows past a few hundred entries an FTS index would be
 * the next step (FLAGGED as future perf work).
 *
 * Skills are SHARED instance-wide — there is intentionally no owner/user
 * weighting (matches the AgentSkill model + repository).
 */

import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { AgentSkill } from '../models/agent_skill';

const THRESHOLD = 0.3;
const DEFAULT_TOP_N = 5;
/** Draft skills must clear this confidence bar to be eligible (fail-closed). */
const DRAFT_CONFIDENCE_GATE = 0.6;

/**
 * Tokenize text the same way Odysseus `_tokenize` does:
 *   - lowercase
 *   - split on whitespace
 *   - strip a fixed set of edge punctuation (.,!?";:()[])
 *   - drop tokens of length <= 1
 *   - dedupe into a Set
 *
 * NOTE on the issue spec: the issue text said "split on non-alphanumeric",
 * but the Odysseus reference is authoritative and splits on whitespace then
 * strips edge punctuation only (so an interior hyphen/underscore keeps the
 * token whole, e.g. "weekly-report" stays one token). We mirror the reference
 * exactly to keep scoring parity with the existing skill store semantics.
 */
function tokenize(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const raw of text.toLowerCase().split(/\s+/)) {
    // Strip the same leading/trailing punctuation Python's str.strip(chars) does.
    const w = raw.replace(/^[.,!?";:()[\]]+/, '').replace(/[.,!?";:()[\]]+$/, '');
    if (w.length > 1) out.add(w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Coerce a possibly-missing/garbage confidence to a float, mirroring Odysseus
 * `_to_float`. Returns `fallback` for null/undefined/NaN.
 */
function toFloat(x: unknown, fallback: number): number {
  if (typeof x === 'number') return Number.isNaN(x) ? fallback : x;
  if (typeof x === 'string') {
    const n = Number(x);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

/** Is `subset` a (non-empty) whole-token subset of `superset`? */
function isSubset(subset: Set<string>, superset: Set<string>): boolean {
  if (subset.size === 0) return false;
  for (const x of subset) {
    if (!superset.has(x)) return false;
  }
  return true;
}

/**
 * Eligibility filter (mirrors Odysseus):
 *   - status === 'published' → always eligible (already vetted).
 *   - status === 'draft' → eligible ONLY if confidence >= DRAFT_CONFIDENCE_GATE.
 *     Fail-closed: a missing / NaN / unparseable confidence on a draft excludes it.
 *   - any other status → excluded (Odysseus only retrieves published + draft).
 */
export function isEligible(skill: AgentSkill): boolean {
  if (skill.status === 'published') return true;
  if (skill.status === 'draft') {
    const c = skill.confidence;
    if (c === null || c === undefined) return false;
    const n = toFloat(c, NaN);
    if (Number.isNaN(n)) return false;
    return n >= DRAFT_CONFIDENCE_GATE;
  }
  return false;
}

/**
 * Score a single skill against an already-lowercased raw query + its token set.
 * Mirrors the Odysseus scoring order exactly:
 *   1. jaccard over (title + description + whenToUse + tags + steps) tokens
 *   2. tag boost: any tag whose tokens are a whole-token subset of the query
 *      → score = max(score, 0.3) * 1.3
 *   3. description substring: raw lowercased query inside description
 *      → score = max(score, 0.6)
 *   4. confidence multiplier: score *= 1 + (confidence ?? 0.5) * 0.1
 *   5. usage multiplier: uses > 0 → score *= 1.05
 *
 * Exported so tests can assert the raw score independent of threshold/sort.
 */
export function scoreSkill(query: string, skill: AgentSkill): number {
  const rawQuery = query.toLowerCase();
  const queryTokens = tokenize(query);

  const tags = skill.tags ?? [];
  const steps = skill.steps ?? [];
  const text = [
    skill.title ?? '',
    skill.description ?? '',
    skill.whenToUse ?? '',
    tags.join(' '),
    steps.join(' '),
  ].join(' ');

  let score = jaccard(queryTokens, tokenize(text));

  for (const tag of tags) {
    const tagTokens = tokenize(tag);
    if (isSubset(tagTokens, queryTokens)) {
      score = Math.max(score, 0.3) * 1.3;
    }
  }

  if ((skill.description ?? '').toLowerCase().includes(rawQuery)) {
    score = Math.max(score, 0.6);
  }

  score *= 1.0 + toFloat(skill.confidence, 0.5) * 0.1;

  if ((skill.uses ?? 0) > 0) {
    score *= 1.05;
  }

  return score;
}

/**
 * Rank all stored skills against `query` and return the top-N eligible matches
 * scoring at or above the 0.3 threshold (descending by score).
 *
 * - Empty store or empty/whitespace-only query → [].
 * - Loads every skill via AgentSkillsRepository.list() (no owner scoping).
 * - Pure scoring; does NOT mutate `uses` (P3-2 increments on actual injection).
 */
export function getRelevantSkills(
  query: string,
  topN: number = DEFAULT_TOP_N,
  repo: AgentSkillsRepository = new AgentSkillsRepository(),
): AgentSkill[] {
  if (!query || query.trim().length === 0) return [];

  const all = repo.list();
  if (all.length === 0) return [];

  const eligible = all.filter(isEligible);

  const scored: Array<{ score: number; skill: AgentSkill }> = [];
  for (const skill of eligible) {
    const score = scoreSkill(query, skill);
    if (score >= THRESHOLD) {
      scored.push({ score, skill });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.skill);
}
