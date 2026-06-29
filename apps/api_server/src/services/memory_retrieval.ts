/**
 * memory_retrieval.ts — owner-scoped retrieval + transient prompt-preface builder
 * for the per-user agent memory store (the missing "feedback half" of memory:
 * captured facts/preferences are now scored against the incoming prompt and
 * injected into the prompt as a transient "Known context" block).
 *
 * This MIRRORS the skill-injection pattern in `skill_retrieval.ts`
 * (`isSkillInjectionEnabled` / `buildSkillsPreface`) but with two critical
 * differences driven by memory being PER-USER, not instance-shared:
 *
 *  1. OWNER SCOPING (the whole point). `agent_memory` rows carry
 *     `owner_user_id`. Retrieval MUST filter to the run's owner so user A's
 *     facts never leak into user B's prompt. We FAIL CLOSED: if the owner can't
 *     be resolved (`ownerUserId == null`), we retrieve ONLY null-owner /
 *     instance-global rows — never another user's memory. The cross-user-leak
 *     guard lives in `AgentMemoryRepository.searchAsync(query, ownerUserId, ...)`,
 *     which appends `owner_user_id = ?` when an id is provided; we pass it
 *     through and additionally drop any row whose ownerUserId does not match the
 *     requested owner (defense in depth, including the null-owner case).
 *
 *  2. FTS5 over Jaccard. Skills use a pure in-memory Jaccard scorer because the
 *     skill store is small and shared. Memory REUSES the existing
 *     `AgentMemoryRepository.searchAsync` which already implements full-text
 *     search (Postgres tsvector + SQLite FTS5, with a LIKE fallback) AND owner
 *     filtering. Re-using it (rather than re-implementing Jaccard) means
 *     retrieval is consistent with the on-demand `rhythm_search_memory` MCP tool
 *     and gets owner-scoping for free. Injection is purely ADDITIVE — the
 *     on-demand recall tool stays.
 *
 * SOURCE = THE DERIVED INDEX (Issue #805, memory epic #801). Retrieval reads
 * through `AgentMemoryRepository.searchAsync`, which queries the local SQLite
 * `agent_memory` / `agent_memory_fts` store — the DERIVED, DISPOSABLE index that
 * `MemoryIndexService` rebuilds from the Obsidian Memory-Vault (see #802). It
 * NEVER scans the vault on the prompt path, so injection works with Obsidian
 * closed (the REST plugin offline) and stays fast. Vault edits/deletions reach
 * injection via the index-refresh passes (the periodic cron + startup rebuild),
 * not via a per-prompt rescan. Every returned `AgentMemory` carries its
 * `sourceId` — the vault-relative note path — so a result traces back to a file.
 *
 * The built preface is TRANSIENT: it is prepended to the in-memory prompt for a
 * single send only. It must NEVER be persisted to a profile `systemPrompt`,
 * session memory, or an opencode agent `.md` file.
 */

import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import type { AgentMemory } from '../repositories/agent_memory_repository';

const DEFAULT_TOP_N = 5;

/** Tokens shorter than this (after stripping punctuation) are dropped as noise. */
const MIN_TOKEN_LEN = 3;
/** Cap how many distinct prompt tokens we probe so a huge prompt can't fan out. */
const MAX_QUERY_TOKENS = 12;

/**
 * Very common English words that carry no retrieval signal. Kept tiny on
 * purpose — FTS already ranks; this just trims obvious noise so a natural-
 * language prompt doesn't degrade to "every memory matches 'the'".
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
  'her', 'was', 'one', 'our', 'out', 'his', 'has', 'had', 'how', 'who',
  'what', 'when', 'where', 'why', 'will', 'with', 'this', 'that', 'they',
  'them', 'then', 'than', 'from', 'have', 'about', 'into', 'your', 'please',
  'remind', 'tell', 'give', 'need', 'want', 'should',
]);

/**
 * Reduce a free-text prompt to the distinct significant tokens we probe the FTS
 * index with. Why: `AgentMemoryRepository.searchAsync` forwards the query
 * straight to FTS5 MATCH / plainto_tsquery, both of which AND all bare tokens
 * together — so feeding a whole natural-language prompt almost never matches a
 * short stored fact (every token would have to appear in the fact). We instead
 * probe each significant token separately and union the hits (see
 * getRelevantMemories), preserving the shared owner-scoped FTS path without
 * re-implementing scoring or touching the shared repository (which the on-demand
 * `rhythm_search_memory` tool also uses).
 */
export function extractQueryTokens(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.toLowerCase().split(/\s+/)) {
    const w = raw.replace(/[^a-z0-9]+/g, '');
    if (w.length < MIN_TOKEN_LEN) continue;
    if (STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= MAX_QUERY_TOKENS) break;
  }
  return out;
}

/**
 * Read the instance-wide memory-injection toggle at call time.
 *
 * `env.agentMemoryInjectionEnabled` is evaluated once at module load; reading the
 * raw env var here lets the toggle be flipped per-call (and in tests) without a
 * process restart. Only the explicit strings 'false'/'0' disable it; anything
 * else (including unset) is enabled. Default ON. (Mirrors
 * `isSkillInjectionEnabled` exactly.)
 */
export function isMemoryInjectionEnabled(): boolean {
  const raw = (process.env.AGENT_MEMORY_INJECTION_ENABLED ?? '').trim().toLowerCase();
  return !(raw === 'false' || raw === '0');
}

/**
 * Retrieve the top-N relevant memories for `query`, SCOPED to `ownerUserId`.
 *
 * - Empty/whitespace query → [] (no retrieval).
 * - Delegates to the FTS5-backed, owner-filtering
 *   `AgentMemoryRepository.searchAsync(query, ownerUserId, topN)`.
 * - Defense-in-depth: even though searchAsync already filters by owner, we drop
 *   any returned row whose ownerUserId !== the requested owner. When
 *   `ownerUserId` is null/undefined this keeps ONLY null-owner (instance-global)
 *   rows, so a null owner can NEVER pull a user-owned fact.
 *
 * `repo` is injectable for testing (defaults to a real AgentMemoryRepository).
 */
export async function getRelevantMemories(
  query: string,
  ownerUserId?: number | null,
  topN: number = DEFAULT_TOP_N,
  repo: AgentMemoryRepository = new AgentMemoryRepository(),
): Promise<AgentMemory[]> {
  if (!query || query.trim().length === 0) return [];

  // searchAsync treats `undefined` owner as "no filter" but `null` as a value;
  // normalize null→undefined so the repo SQL owner filter is only applied when a
  // concrete owner id exists. The defense-in-depth filter below still enforces
  // null-owner-only retrieval when no owner is known.
  const ownerArg = ownerUserId == null ? undefined : ownerUserId;
  const wanted = ownerUserId == null ? null : ownerUserId;

  // FTS5 MATCH / plainto_tsquery AND all bare tokens, so a full prompt rarely
  // matches a short fact. Probe each significant token and union the hits,
  // preserving first-seen (rank) order across probes. Fall back to the raw query
  // when tokenization yields nothing (e.g. all-stopword / non-latin input).
  const tokens = extractQueryTokens(query);
  const probes = tokens.length > 0 ? tokens : [query];

  const byId = new Map<string, AgentMemory>();
  for (const probe of probes) {
    if (byId.size >= topN) break;
    let rows: AgentMemory[];
    try {
      rows = await repo.searchAsync(probe, ownerArg, topN);
    } catch {
      continue; // one probe failing must not abort the rest
    }
    for (const m of rows) {
      // Defense in depth: enforce exact owner match (incl. null-owner-only when
      // no owner is known) regardless of the repo SQL filter.
      if (m.ownerUserId !== wanted) continue;
      if (!byId.has(m.id)) byId.set(m.id, m);
    }
  }

  return Array.from(byId.values()).slice(0, topN);
}

export interface MemoryPreface {
  /** Transient preface text to prepend to the prompt. Empty when disabled / no matches. */
  text: string;
  /** Ids of the matched memories (for logging/diagnostics; memory has no `uses`). */
  memoryIds: string[];
  /**
   * Originating vault note path for each matched memory (#805 AC6) — the
   * derived index row's `sourceId`. Positionally aligned with `memoryIds`; an
   * entry is `null` for a row that has no vault path (e.g. a legacy
   * non-vault-sourced row). Diagnostics only — never injected into the prompt.
   */
  notePaths: (string | null)[];
}

export interface BuildMemoryPrefaceOptions {
  /** Override the instance-wide toggle (defaults to the live env read). */
  enabled?: boolean;
  /** Max memories to retrieve (forwarded to getRelevantMemories). */
  topN?: number;
  /** Injectable retrieval fn (defaults to getRelevantMemories) for testing. */
  getRelevant?: (
    query: string,
    ownerUserId?: number | null,
    topN?: number,
  ) => Promise<AgentMemory[]>;
}

/**
 * Build a transient "## Known context (facts & preferences)" preface for
 * `query`, OWNER-SCOPED to `ownerUserId`.
 *
 * Returns `{ text: '', memoryIds: [] }` when:
 *   - the toggle is off, OR
 *   - no memories match.
 * Callers then skip injection entirely (no preface).
 *
 * FAIL-SAFE: `ownerUserId` is passed straight through to owner-scoped retrieval.
 * When it is null/undefined only instance-global (null-owner) memory is
 * retrieved — a user-owned fact can never reach another user's prompt.
 *
 * The returned text is INTENDED to be prepended to the prompt in memory only. It
 * must NEVER be persisted to a profile systemPrompt, session memory, or an
 * opencode agent .md file (core safeguard, mirrors buildSkillsPreface).
 */
export async function buildMemoryPreface(
  query: string,
  ownerUserId?: number | null,
  opts: BuildMemoryPrefaceOptions = {},
): Promise<MemoryPreface> {
  const enabled = opts.enabled ?? isMemoryInjectionEnabled();
  if (!enabled) return { text: '', memoryIds: [], notePaths: [] };

  const retrieve = opts.getRelevant ?? getRelevantMemories;
  let matches: AgentMemory[];
  try {
    matches = await retrieve(query, ownerUserId, opts.topN ?? DEFAULT_TOP_N);
  } catch {
    // A retrieval failure must never produce a partial/garbled preface — and the
    // call sites also wrap this in try/catch as a second backstop.
    return { text: '', memoryIds: [], notePaths: [] };
  }
  if (!matches || matches.length === 0) return { text: '', memoryIds: [], notePaths: [] };

  const lines = ['## Known context (facts & preferences)'];
  for (const m of matches) {
    lines.push(`- ${m.content}`);
  }

  return {
    text: lines.join('\n'),
    memoryIds: matches.map((m) => m.id),
    // #805 AC6: surface the originating vault note path for each match so a
    // result traces back to a file. `sourceId` is the vault-relative path for
    // index rows derived from the Memory-Vault.
    notePaths: matches.map((m) => m.sourceId),
  };
}
