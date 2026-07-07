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
 *
 * SCOPE NOTE (#775): this module ranks the api_server DB skill store and emits a
 * transient PROMPT PREFACE hint. It is NOT the enforcement boundary for what the
 * model can actually load. The skills the model sees/invokes come from the
 * opencode FORK (the `skill` tool + system-prompt listing of filesystem SKILL.md
 * files), and per-profile scoping is enforced there via the per-session
 * `skillAllowlist` (mirror of mcpAllowlist) — see
 * apps/opencode_fork/.../session/skill_allowlist.ts and
 * docs/ai/decisions/2026-06-28-skill-scope-enforcement.md. The `allowedSkillsJson`
 * filtering below applies only to this DB-skill preface and must not be mistaken
 * for the real capability gate.
 */

import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { AgentSkill } from '../models/agent_skill';

const THRESHOLD = 0.3;
const DEFAULT_TOP_N = 5;
/**
 * Draft skills must clear this confidence bar to be eligible (fail-closed).
 * Exported (#929) so skill_extractor can gate materialize-on-harvest on the
 * SAME bar a draft needs to clear to be retrieval-eligible.
 */
export const DRAFT_CONFIDENCE_GATE = 0.6;

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
 * Parse an allowedSkillsJson string into a Set of allowed skill ids/titles.
 * Returns null when the list is null/undefined (meaning "all allowed").
 * Returns a Set for any present allowlist; an empty Set means deny all.
 *
 * P1b: when non-null, only skills whose id OR title appears in the set are eligible.
 * Contract: null → all skills eligible; [] or malformed/non-array → deny all.
 */
function parseAllowlist(allowedSkillsJson: string | null | undefined): Set<string> | null {
  if (allowedSkillsJson == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(allowedSkillsJson);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const s = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry === 'string' && entry.trim()) {
      s.add(entry.trim());
    }
  }
  return s;
}

/**
 * Rank all stored skills against `query` and return the top-N eligible matches
 * scoring at or above the 0.3 threshold (descending by score).
 *
 * - Empty store or empty/whitespace-only query → [].
 * - Loads every skill via AgentSkillsRepository.list() (no owner scoping).
 * - Pure scoring; does NOT mutate `uses` (P3-2 increments on actual injection).
 * - P1b: when `allowedSkillsJson` is a JSON array, only skills whose id or
 *   title is in the allowlist are eligible. null/undefined = all allowed.
 *   [] or malformed/non-array = deny all.
 */
export function getRelevantSkills(
  query: string,
  topN: number = DEFAULT_TOP_N,
  repo: AgentSkillsRepository = new AgentSkillsRepository(),
  allowedSkillsJson?: string | null,
): AgentSkill[] {
  if (!query || query.trim().length === 0) return [];

  const all = repo.list();
  if (all.length === 0) return [];

  // P1b: apply allowlist filter before scoring so disallowed skills can never
  // appear in results regardless of their relevance score.
  const allowlist = parseAllowlist(allowedSkillsJson);
  const eligible = all.filter((s) => {
    if (!isEligible(s)) return false;
    if (allowlist === null) return true;                  // null = all allowed
    return allowlist.has(s.id) || allowlist.has(s.title ?? '');
  });

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

// ── P3-2: prompt-preface builder ────────────────────────────────────────────

/**
 * Read the instance-wide skills toggle at call time.
 *
 * `env.agentSkillsEnabled` is evaluated once at module load; reading the raw
 * env var here lets the toggle be flipped per-call (and in tests) without a
 * process restart. Only the explicit strings 'false'/'0' disable it; anything
 * else (including unset) is enabled. Default ON (OQ-6).
 */
export function isSkillInjectionEnabled(): boolean {
  const raw = (process.env.AGENT_SKILLS_ENABLED ?? '').trim().toLowerCase();
  return !(raw === 'false' || raw === '0');
}

export interface SkillsPreface {
  /** Transient preface text to prepend to the prompt. Empty when disabled / no matches. */
  text: string;
  /** Ids of the matched skills, for a post-send `incrementUses` bump. */
  skillIds: string[];
}

export interface BuildSkillsPrefaceOptions {
  /** Override the instance-wide toggle (defaults to the live env read). */
  enabled?: boolean;
  /** Max skills to retrieve (forwarded to getRelevantSkills). */
  topN?: number;
  /** Injectable retrieval fn (defaults to getRelevantSkills) for testing. */
  getRelevant?: (query: string, topN?: number) => AgentSkill[];
  /**
   * P1b — Profile-level skill allowlist (raw JSON string of id/title array).
   * When provided (non-null array), only skills whose id or title
   * appears in the list are eligible — even if they score higher than any
   * allowlisted skill. null / undefined = all skills eligible; "[]" denies all.
   * Forwarded to getRelevantSkills when getRelevant is not overridden.
   * When a custom getRelevant is injected (e.g. in tests), the allowlist is
   * applied as a POST-filter on the returned skills (so tests can assert the
   * same exclusion behaviour without reimplementing the DB scan).
   */
  allowedSkillsJson?: string | null;
}

/**
 * Build a transient "Available skills (retrieved)" preface for `query`.
 *
 * Returns `{ text: '', skillIds: [] }` when the toggle is off OR no skills
 * match — callers then skip injection entirely (no preface, no uses bump).
 *
 * The returned text is INTENDED to be prepended to the prompt in memory only.
 * It must NEVER be persisted to a profile systemPrompt, session memory, or an
 * opencode agent .md file (P3-2 core safeguard).
 *
 * NOTE (Unify-6 / #775): this preface is an inert relevance HINT, NOT the
 * capability gate. The model can only LOAD skills the opencode fork discovered
 * on disk (filesystem SKILL.md), and per-session scoping is enforced there via
 * skillAllowlist. To make a DB skill loadable it must be MATERIALIZED to a
 * SKILL.md in the Rhythm-managed dir (see skill_materializer.ts) — adding it to
 * this preface alone does nothing. The allowlist filtering below likewise only
 * affects which hints are shown, never what the model can actually load.
 */
export function buildSkillsPreface(
  query: string,
  opts: BuildSkillsPrefaceOptions = {},
): SkillsPreface {
  const enabled = opts.enabled ?? isSkillInjectionEnabled();
  if (!enabled) return { text: '', skillIds: [] };

  // P1b: when a custom getRelevant is injected (test path), retrieve first then
  // apply the allowlist as a post-filter so test doubles don't need to know about
  // the allowlist logic. When using the default getRelevantSkills, pass the
  // allowlist directly so the filter runs before scoring (avoids loading skipped
  // skills into the scored array, though with a small library it's trivially fast).
  let matches: AgentSkill[];
  if (opts.getRelevant) {
    const raw = opts.getRelevant(query, opts.topN ?? DEFAULT_TOP_N);
    const allowlist = parseAllowlist(opts.allowedSkillsJson);
    matches = allowlist === null
      ? raw
      : raw.filter((s) => allowlist.has(s.id) || allowlist.has(s.title ?? ''));
  } else {
    matches = getRelevantSkills(query, opts.topN ?? DEFAULT_TOP_N, undefined, opts.allowedSkillsJson);
  }
  if (!matches || matches.length === 0) return { text: '', skillIds: [] };

  const lines = ['## Available skills (retrieved)'];
  for (const s of matches) {
    const detail = (s.whenToUse ?? s.description ?? '').trim();
    const conf = toFloat(s.confidence, 0).toFixed(2);
    lines.push(`- ${s.title}: ${detail} (confidence ${conf})`);
  }

  return {
    text: lines.join('\n'),
    skillIds: matches.map((s) => s.id),
  };
}
