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
import { getAgentMemoryRetrievalMode, resolveEngraphMemoryVaultRoot, resolveMemoryDirPath } from '../config/env';
import { EngraphHttpClient, mapEngraphFileToSourceId } from './engraph_client';
import type { EngraphClient } from './engraph_client';
import { engraphManager } from './engraph_manager';

const DEFAULT_TOP_N = 5;

/** Tokens shorter than this are dropped as noise. */
const MIN_TOKEN_LEN = 3;
/** Cap how many distinct prompt tokens we probe so a huge prompt can't fan out. */
const MAX_QUERY_TOKENS = 12;
const RRF_K = 60;

type MemoryRepository = Pick<AgentMemoryRepository, 'searchAsync' | 'findBySourceIdsAsync'>;

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
 * probe every significant token concurrently and SCORE each memory by how many
 * distinct probes returned it (see getRelevantMemories), preserving the shared
 * owner-scoped FTS path without re-implementing full-text search or touching the
 * shared repository (which the on-demand `rhythm_search_memory` tool also uses).
 */
export function extractQueryTokens(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of query.toLowerCase().split(/[^a-z0-9]+/)) {
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
 * RANKING (why): FTS5 MATCH / plainto_tsquery AND all bare tokens together, so
 * feeding the whole prompt as one query rarely matches a short stored fact.
 * We instead probe every significant token (extractQueryTokens, capped at
 * MAX_QUERY_TOKENS) and run the probes CONCURRENTLY via Promise.all — probing
 * is I/O bound and independent per token, so fanning out keeps total latency
 * close to the slowest single probe instead of growing linearly with prompt
 * length. Each probe still has its own try/catch: one failing probe (e.g. a
 * transient FTS error) must not abort the others or the whole retrieval.
 *
 * A memory is scored by the number of DISTINCT probes that returned it — more
 * matched tokens is a strong relevance signal an early-exit union can't see.
 * Rank order is: match count (desc), then the best (lowest) index the memory
 * held within any single probe's results (asc — a probe's own ranking is
 * itself a relevance signal), then first-seen order across probes (asc, for a
 * fully deterministic tie-break).
 *
 * JUNK SUPPRESSION: a memory that only shares ONE word with the prompt is easy
 * to hit by coincidence (e.g. a common noun) and crowds out genuinely relevant
 * facts. So once ANY memory in the result set matched 2+ distinct probes, every
 * memory that matched only 1 probe is dropped entirely — a preface with one
 * strong match beats five single-word coincidences. When nothing cleared 2
 * matches (including the common case of a single-significant-token prompt, or
 * the raw-query fallback below, where every hit is definitionally a 1-probe
 * match), single-probe matches are kept so recall isn't lost.
 *
 * `repo` is injectable for testing (defaults to a real AgentMemoryRepository).
 */
export async function getRelevantMemories(
  query: string,
  ownerUserId?: number | null,
  topN: number = DEFAULT_TOP_N,
  repo: MemoryRepository = new AgentMemoryRepository(),
): Promise<AgentMemory[]> {
  if (!query || query.trim().length === 0) return [];

  // searchAsync treats `undefined` owner as "no filter" but `null` as a value;
  // normalize null→undefined so the repo SQL owner filter is only applied when a
  // concrete owner id exists. The defense-in-depth filter below still enforces
  // null-owner-only retrieval when no owner is known.
  const ownerArg = ownerUserId == null ? undefined : ownerUserId;
  const wanted = ownerUserId == null ? null : ownerUserId;

  // Probe each significant token. Fall back to the raw query when tokenization
  // yields nothing (e.g. all-stopword / non-latin input) — that fallback is
  // itself a single probe, so it naturally skips junk suppression below.
  const tokens = extractQueryTokens(query);
  const probes = tokens.length > 0 ? tokens : [query];

  // Run every probe concurrently; a rejected probe resolves to `null` instead
  // of throwing so the rest of the fan-out is unaffected.
  const probeResults = await Promise.all(
    probes.map(async (probe): Promise<AgentMemory[] | null> => {
      try {
        return await repo.searchAsync(probe, ownerArg, topN);
      } catch {
        return null; // one probe failing must not abort the rest
      }
    }),
  );

  interface ScoredEntry {
    memory: AgentMemory;
    matchCount: number;
    bestIndex: number;
    firstSeen: number;
  }
  const byId = new Map<string, ScoredEntry>();
  let firstSeen = 0;

  for (const rows of probeResults) {
    if (!rows) continue;
    for (let index = 0; index < rows.length; index += 1) {
      const m = rows[index];
      // Defense in depth: enforce exact owner match (incl. null-owner-only when
      // no owner is known) regardless of the repo SQL filter.
      if (m.ownerUserId !== wanted) continue;
      const existing = byId.get(m.id);
      if (existing) {
        existing.matchCount += 1;
        if (index < existing.bestIndex) existing.bestIndex = index;
      } else {
        byId.set(m.id, { memory: m, matchCount: 1, bestIndex: index, firstSeen: firstSeen++ });
      }
    }
  }

  const entries = Array.from(byId.values());
  const hasMultiTokenMatch = entries.some((e) => e.matchCount >= 2);
  const ranked = hasMultiTokenMatch ? entries.filter((e) => e.matchCount >= 2) : entries;

  ranked.sort((a, b) => (
    b.matchCount - a.matchCount
    || a.bestIndex - b.bestIndex
    || a.firstSeen - b.firstSeen
  ));

  return ranked.slice(0, topN).map((e) => e.memory);
}

/** Deterministic rank-only fusion; raw FTS and Engraph scores are incomparable. */
export function fuseMemoryRanks(
  fts: AgentMemory[],
  semantic: AgentMemory[],
  topN: number,
): AgentMemory[] {
  const fused = new Map<string, { memory: AgentMemory; score: number; first: number }>();
  let first = 0;
  for (const ranked of [fts, semantic]) {
    ranked.forEach((memory, index) => {
      const current = fused.get(memory.id);
      const score = 1 / (RRF_K + index + 1);
      if (current) current.score += score;
      else fused.set(memory.id, { memory, score, first: first++ });
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .slice(0, topN)
    .map(({ memory }) => memory);
}

/**
 * Opt-in hybrid retrieval. FTS always runs so fresh vault writes remain visible;
 * any failed/untrusted semantic lane returns its original FTS ordering unchanged.
 */
export async function getRelevantMemoriesSemantic(
  query: string,
  ownerUserId?: number | null,
  topN: number = DEFAULT_TOP_N,
  repo: MemoryRepository = new AgentMemoryRepository(),
  engraph: EngraphClient = new EngraphHttpClient(),
): Promise<AgentMemory[]> {
  const ftsPromise = getRelevantMemories(query, ownerUserId, topN, repo);
  const hitsPromise = engraph.search(query, topN).catch(() => []);
  const [fts, hits] = await Promise.all([ftsPromise, hitsPromise]);
  if (hits.length === 0) return fts;

  const sourceIds = [...new Set(hits.map((hit) => mapEngraphFileToSourceId(
    hit.file,
    resolveMemoryDirPath(),
    resolveEngraphMemoryVaultRoot(),
  )).filter((sourceId): sourceId is string => sourceId !== null))];
  if (sourceIds.length === 0) return fts;

  const wanted = ownerUserId == null ? null : ownerUserId;
  let joined: AgentMemory[];
  try {
    joined = await repo.findBySourceIdsAsync('obsidian-memory', sourceIds, wanted ?? undefined);
  } catch {
    return fts;
  }
  const candidatesBySourceId = new Map<string, AgentMemory[]>();
  for (const memory of joined) {
    // Defense in depth after the semantic-to-index join, including null owners.
    if (memory.ownerUserId !== wanted || memory.source !== 'obsidian-memory' || !memory.sourceId) continue;
    const candidates = candidatesBySourceId.get(memory.sourceId) ?? [];
    candidates.push(memory);
    candidatesBySourceId.set(memory.sourceId, candidates);
  }
  const semantic = sourceIds.flatMap((sourceId) => {
    const candidates = candidatesBySourceId.get(sourceId);
    return candidates?.length === 1 ? candidates : [];
  });
  return semantic.length === 0 ? fts : fuseMemoryRanks(fts, semantic, topN);
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

  // #1096 WP1: when hybrid mode is on, prefer the device-local Engraph
  // manager's client (loopback, authenticated, health-gated) over the raw
  // env-var-only client `getRelevantMemoriesSemantic` would otherwise default
  // to. `getRetrievalClient()` itself falls back to a client whose search()
  // always resolves [] whenever the manager is disabled/unhealthy, so this is
  // purely additive: with the manager left off (its default state), behavior
  // is unchanged from #1093/#1095.
  const retrieve = opts.getRelevant ?? (
    getAgentMemoryRetrievalMode() === 'hybrid'
      ? (q: string, ownerUserId?: number | null, topN?: number) =>
          getRelevantMemoriesSemantic(q, ownerUserId, topN, undefined, engraphManager.getRetrievalClient())
      : getRelevantMemories
  );
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
