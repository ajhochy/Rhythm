/**
 * memory_retrieval.ts — owner-scoped retrieval + transient prompt-preface builder
 * for the per-user agent memory store (the missing "feedback half" of memory:
 * captured facts/preferences are now scored against the incoming prompt and
 * supplied through the SDK's hidden per-turn system seam as a transient
 * "Known context" block).
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
 * The built preface is TRANSIENT: callers supply it as hidden per-turn system
 * context for a single send only. It must NEVER be concatenated into persisted
 * user text, a profile `systemPrompt`, session memory, or an opencode agent
 * `.md` file.
 */

import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import {
  getAgentMemoryRetrievalMode,
  getSemanticSearchBudgetMs,
  isMemoryLinkExpansionEnabled,
  resolveEngraphMemoryVaultRoot,
  resolveMemoryDirPath,
} from '../config/env';
import { EngraphHttpClient, mapEngraphFileToSourceId } from './engraph_client';
import type { EngraphClient } from './engraph_client';
import type { MemoryProvenanceItem } from '../repositories/agent_session_memory_provenance_repository';
import { engraphManager } from './engraph_manager';
import {
  extractMemoryBodyLinks,
  isActive,
} from './memory_note_format';
import { resolveMemoryLinkTarget } from './memoryVaultWriteService';

const DEFAULT_TOP_N = 5;
export const AUTOMATIC_MEMORY_MAX_ITEMS = 2;
export const AUTOMATIC_MEMORY_MAX_ITEM_CHARS = 500;
export const AUTOMATIC_MEMORY_MAX_TOTAL_CHARS = 1200;
export const AUTOMATIC_MEMORY_MAX_ESTIMATED_TOKENS = 300;
export const DEFAULT_AUTOMATIC_MEMORY_MIN_RELEVANCE = 0.60;
/** Stay safely below SQLite's historical 999 bind-variable limit. */
const MAX_LINK_LOOKUP_SOURCE_IDS = 200;

/** Tokens shorter than this are dropped as noise. */
const MIN_TOKEN_LEN = 3;
/** Cap how many distinct prompt tokens we probe so a huge prompt can't fan out. */
const MAX_QUERY_TOKENS = 12;
const RRF_K = 60;
const SEMANTIC_INITIAL_CANDIDATE_FACTOR = 4;
const SEMANTIC_MAX_CANDIDATE_FACTOR = 16;

interface RetrievalEvidence {
  lane: 'fts' | 'semantic' | 'hybrid';
  score: number;
  confidence: number | null;
  reason: string;
}

const retrievalEvidence = new WeakMap<AgentMemory, RetrievalEvidence>();

type MemoryRepository = Pick<AgentMemoryRepository, 'searchAsync' | 'findBySourceIdsAsync'>;

function currentDate(): string {
  const now = new Date();
  return [
    now.getFullYear().toString().padStart(4, '0'),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0'),
  ].join('-');
}

function isMemoryActive(memory: AgentMemory, today: string): boolean {
  return isActive({
    status: memory.status,
    stale_after: memory.staleAfter,
  }, today);
}

function trustRank(memory: AgentMemory): number {
  switch (memory.trustTier) {
    case 'human':
      return 2;
    case 'machine':
      return 1;
    default:
      return 0;
  }
}

function curatedRank(memory: AgentMemory): number {
  return memory.kind === 'synthesis' ? 0 : 1;
}

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

// Superset of the probe STOPWORDS: interrogatives and auxiliaries carry no
// retrievable content, so they must not inflate the relevance denominator —
// "When are the X scheduled?" must score like "X scheduled". Deriving from
// STOPWORDS keeps the two lists from drifting apart again (live-gate regression:
// 'when'/'will' counted as meaningful and pushed a directly-relevant stored
// preference below the absolute threshold).
const RELEVANCE_STOPWORDS = new Set([
  ...STOPWORDS,
  'be', 'does', 'work', 'working',
]);

function relevanceTokens(value: string): string[] {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return [...new Set(normalized.split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LEN && !RELEVANCE_STOPWORDS.has(token))
    .map((token) => (
      token.length > 4 && token.endsWith('ies')
        ? `${token.slice(0, -3)}y`
        : token.length > 4 && token.endsWith('s') && !token.endsWith('ss')
          ? token.slice(0, -1)
          : token
    )))];
}

export interface AutomaticMemoryScore {
  score: number;
  matchedTokens: number;
  queryTokens: number;
}

/**
 * Absolute lexical relevance used by every automatic lane. Rank answers
 * "which candidate is best"; this answers the separate question "is it
 * relevant enough to inject at all?".
 */
export function scoreMemoryForAutomaticInjection(
  query: string,
  candidate: AgentMemory,
): AutomaticMemoryScore {
  const queryTokens = relevanceTokens(query);
  const candidateTokens = new Set(relevanceTokens([
    candidate.content,
    candidate.kind,
    candidate.tagsJson,
    candidate.sourceId ?? '',
  ].join(' ')));
  const matchedTokens = queryTokens.filter((token) => candidateTokens.has(token)).length;
  return {
    score: queryTokens.length === 0 ? 0 : matchedTokens / queryTokens.length,
    matchedTokens,
    queryTokens: queryTokens.length,
  };
}

export function getAutomaticMemoryMinRelevance(): number {
  const parsed = Number(process.env.AGENT_MEMORY_INJECTION_MIN_RELEVANCE);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : DEFAULT_AUTOMATIC_MEMORY_MIN_RELEVANCE;
}

function sourcePathExcluded(sourceId: string | null): boolean {
  const segments = (sourceId ?? '').replaceAll('\\', '/').toLowerCase().split('/');
  const excluded = new Set([
    'research', 'report', 'reports', 'daily', 'dailies', 'summary',
    'summaries', 'transcript', 'transcripts', 'archive', 'archives',
    'generated', 'document', 'documents',
  ]);
  return segments.some((segment) => excluded.has(segment));
}

function isAutomaticallyInjectable(memory: AgentMemory): boolean {
  if (memory.autoInjectable !== undefined) return memory.autoInjectable;
  if (memory.generatedAt || memory.generatedBy || sourcePathExcluded(memory.sourceId)) return false;
  if (memory.source !== 'obsidian-memory') {
    return ['fact', 'preference', 'context', 'person', 'project'].includes(memory.kind);
  }
  const segments = (memory.sourceId ?? '').replaceAll('\\', '/').toLowerCase().split('/');
  return ['fact', 'preference', 'context', 'person', 'project']
    .some((kind) => segments.includes(kind));
}

function clearsAutomaticGate(
  query: string,
  memory: AgentMemory,
): AutomaticMemoryScore | null {
  if (!isAutomaticallyInjectable(memory)) return null;
  const score = scoreMemoryForAutomaticInjection(query, memory);
  if (
    score.queryTokens < 2
    || score.matchedTokens < 2
    || score.score < getAutomaticMemoryMinRelevance()
  ) {
    return null;
  }
  return score;
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
 * itself a relevance signal), trust tier (human > machine > unverified), then
 * first-seen order across probes (asc, for a fully deterministic tie-break).
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
/**
 * Owner visibility for retrieval: a row is retrievable when it is
 * instance-global (ownerUserId null — e.g. vault-synced notes) or owned by the
 * requesting owner. An unknown/unresolved owner (wanted === null) keeps ONLY
 * global rows — user-owned context never flows to an unowned run (fail-closed
 * cross-user rule).
 */
function isOwnerVisible(rowOwner: number | null, wanted: number | null): boolean {
  return rowOwner === null || rowOwner === wanted;
}

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
  // Capture once per call, never at module load: a long-running process starts
  // excluding a note on its stale_after boundary without restart or reindex.
  const today = currentDate();

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
        return await repo.searchAsync(probe, ownerArg, topN, {
          activeOnly: true,
          injectableOnly: true,
          today,
        });
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
      // Defense in depth: own + instance-global rows only (null-owner-only when
      // no owner is known) regardless of the repo SQL filter.
      if (!isOwnerVisible(m.ownerUserId, wanted)) continue;
      // Defense in depth for injected/fake repositories. The real SQLite
      // repository applies this gate in SQL before LIMIT so inactive rows are
      // replaced by the next-best live rows instead of shrinking the result.
      if (!isMemoryActive(m, today)) continue;
      const absoluteScore = clearsAutomaticGate(query, m);
      if (absoluteScore) {
        retrievalEvidence.set(m, {
          lane: 'fts',
          score: Number(absoluteScore.score.toFixed(4)),
          confidence: null,
          reason: `lexical overlap ${absoluteScore.matchedTokens}/${absoluteScore.queryTokens} cleared threshold ${getAutomaticMemoryMinRelevance().toFixed(2)}`,
        });
      }
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
    || curatedRank(b.memory) - curatedRank(a.memory)
    || a.bestIndex - b.bestIndex
    || trustRank(b.memory) - trustRank(a.memory)
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
  const today = currentDate();
  const fused = new Map<string, { memory: AgentMemory; score: number; first: number }>();
  let first = 0;
  // Gate each lane before calculating RRF positions and before topN slicing.
  // A stale high-rank entry therefore cannot consume a rank or output slot.
  for (const ranked of [
    fts.filter((memory) => isMemoryActive(memory, today)),
    semantic.filter((memory) => isMemoryActive(memory, today)),
  ]) {
    ranked.forEach((memory, index) => {
      const current = fused.get(memory.id);
      const score = 1 / (RRF_K + index + 1);
      if (current) current.score += score;
      else fused.set(memory.id, { memory, score, first: first++ });
    });
  }
  return [...fused.values()]
    .sort((a, b) => (
      curatedRank(b.memory) - curatedRank(a.memory)
      || b.score - a.score
      || trustRank(b.memory) - trustRank(a.memory)
      || a.first - b.first
    ))
    .slice(0, topN)
    .map(({ memory }) => memory);
}

type DeadlineResult<T> =
  | { ok: true; value: T }
  | { ok: false };

async function settleBeforeDeadline<T>(
  deadline: number,
  operation: () => Promise<T>,
): Promise<DeadlineResult<T>> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { ok: false };

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = Symbol('semantic-deadline-expired');
  try {
    const value = await Promise.race([
      operation(),
      new Promise<typeof expired>((resolve) => {
        timeout = setTimeout(() => resolve(expired), remaining);
      }),
    ]);
    return value === expired ? { ok: false } : { ok: true, value };
  } catch {
    return { ok: false };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Hybrid retrieval (the DEFAULT prompt-path lane as of step 2; see
 * `getAgentMemoryRetrievalMode`). FTS always runs so fresh vault writes remain
 * visible; any failed/untrusted semantic lane returns its original FTS
 * ordering unchanged.
 */
export async function getRelevantMemoriesSemantic(
  query: string,
  ownerUserId?: number | null,
  topN: number = DEFAULT_TOP_N,
  repo: MemoryRepository = new AgentMemoryRepository(),
  // Step 3: bound the prompt-path search timeout to the configurable budget
  // (default 500ms) instead of EngraphHttpClient's own 1000ms default, so a
  // hung/slow Engraph service can never delay a first agent response by more
  // than the budget.
  engraph: EngraphClient = new EngraphHttpClient(undefined, undefined, getSemanticSearchBudgetMs()),
): Promise<AgentMemory[]> {
  if (topN <= 0) return [];

  const deadline = Date.now() + getSemanticSearchBudgetMs();
  const ftsPromise = getRelevantMemories(query, ownerUserId, topN, repo);
  const wanted = ownerUserId == null ? null : ownerUserId;
  const today = currentDate();
  const memoryRoot = resolveMemoryDirPath();
  const engraphVaultRoot = resolveEngraphMemoryVaultRoot();
  const seenSourceIds = new Set<string>();
  const semanticBySourceId = new Map<string, AgentMemory>();
  const semanticHitBySourceId = new Map<string, {
    score: number | null;
    confidence: number;
  }>();
  let candidateLimit = Math.max(
    topN * SEMANTIC_INITIAL_CANDIDATE_FACTOR,
    topN,
  );
  const maxCandidateLimit = Math.max(
    topN * SEMANTIC_MAX_CANDIDATE_FACTOR,
    candidateLimit,
  );

  while (true) {
    const searchResult = await settleBeforeDeadline(
      deadline,
      () => engraph.search(query, candidateLimit),
    );
    if (!searchResult.ok) return await ftsPromise;
    const hits = searchResult.value;

    // Engraph 1.7.2 exposes only an RRF rank score, not calibrated semantic
    // confidence. Path-only and score-only hits therefore fail closed. This
    // lane becomes eligible only if a backend version explicitly supplies a
    // bounded confidence/similarity field.
    const sourceIds: string[] = [];
    for (const hit of hits) {
      if (
        typeof hit.confidence !== 'number'
        || !Number.isFinite(hit.confidence)
        || hit.confidence < getAutomaticMemoryMinRelevance()
        || hit.confidence > 1
      ) {
        continue;
      }
      const sourceId = mapEngraphFileToSourceId(
        hit.file,
        memoryRoot,
        engraphVaultRoot,
      );
      if (!sourceId) continue;
      if (!semanticHitBySourceId.has(sourceId)) sourceIds.push(sourceId);
      semanticHitBySourceId.set(sourceId, {
        score: typeof hit.score === 'number' && Number.isFinite(hit.score)
          ? hit.score
          : null,
        confidence: hit.confidence,
      });
    }
    const newSourceIds = sourceIds.filter((sourceId) => {
      if (seenSourceIds.has(sourceId)) return false;
      seenSourceIds.add(sourceId);
      return true;
    });

    if (newSourceIds.length > 0) {
      const joinResult = await settleBeforeDeadline(
        deadline,
        () => repo.findBySourceIdsAsync(
          'obsidian-memory',
          newSourceIds,
          wanted ?? undefined,
        ),
      );
      if (!joinResult.ok) return await ftsPromise;

      const candidatesBySourceId = new Map<string, AgentMemory[]>();
      for (const memory of joinResult.value) {
        // Defense in depth after the semantic-to-index join, including null owners.
        if (
          !isOwnerVisible(memory.ownerUserId, wanted)
          || memory.source !== 'obsidian-memory'
          || !memory.sourceId
          || !isAutomaticallyInjectable(memory)
        ) continue;
        const candidates = candidatesBySourceId.get(memory.sourceId) ?? [];
        candidates.push(memory);
        candidatesBySourceId.set(memory.sourceId, candidates);
      }
      for (const sourceId of newSourceIds) {
        const candidates = candidatesBySourceId.get(sourceId);
        if (candidates?.length === 1 && isMemoryActive(candidates[0], today)) {
          const memory = candidates[0];
          const overlap = clearsAutomaticGate(query, memory);
          const hit = semanticHitBySourceId.get(sourceId);
          if (!overlap || !hit) continue;
          retrievalEvidence.set(memory, {
            lane: 'semantic',
            score: Number(overlap.score.toFixed(4)),
            confidence: hit.confidence,
            reason: `semantic confidence ${hit.confidence.toFixed(4)} and lexical overlap ${overlap.matchedTokens}/${overlap.queryTokens} cleared threshold ${getAutomaticMemoryMinRelevance().toFixed(2)}`,
          });
          semanticBySourceId.set(sourceId, memory);
        }
      }
    }

    const exhausted = hits.length < candidateLimit;
    if (
      semanticBySourceId.size >= topN ||
      exhausted ||
      candidateLimit >= maxCandidateLimit
    ) {
      break;
    }
    candidateLimit = Math.min(candidateLimit * 2, maxCandidateLimit);
  }

  const fts = await ftsPromise;
  const semantic = [...semanticBySourceId.values()];
  if (semantic.length === 0) return fts;
  const fused = fuseMemoryRanks(fts, semantic, topN);
  for (const memory of fused) {
    if (fts.some((candidate) => candidate.id === memory.id)
      && semantic.some((candidate) => candidate.id === memory.id)) {
      const evidence = retrievalEvidence.get(memory);
      if (evidence) retrievalEvidence.set(memory, { ...evidence, lane: 'hybrid' });
    }
  }
  return fused;
}

export interface MemoryPreface {
  /** Hidden per-turn context text. Empty when disabled / no matches. */
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
  /** Body-free turn provenance for every bounded excerpt. */
  items: MemoryProvenanceItem[];
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
  /** Injectable exact-lookup lane for one-hop link expansion tests. */
  linkRepository?: MemoryRepository;
  /** Override the memory-dir boundary used to resolve bundle-relative links. */
  memoryDir?: string;
}

function emptyMemoryPreface(): MemoryPreface {
  return { text: '', memoryIds: [], notePaths: [], items: [] };
}

function boundedRelevantExcerpt(query: string, content: string): string {
  const sentences = content
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const querySet = new Set(relevanceTokens(query));
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      matches: relevanceTokens(sentence).filter((token) => querySet.has(token)).length,
    }))
    .sort((a, b) => b.matches - a.matches || a.index - b.index);
  const selected = ranked[0]?.sentence ?? content.replace(/\s+/g, ' ').trim();
  if (selected.length <= AUTOMATIC_MEMORY_MAX_ITEM_CHARS) return selected;
  return `${selected.slice(0, AUTOMATIC_MEMORY_MAX_ITEM_CHARS - 1).trimEnd()}…`;
}

export async function expandLinkedMemories(
  direct: AgentMemory[],
  ownerUserId: number | null | undefined,
  topN: number,
  repo: MemoryRepository = new AgentMemoryRepository(),
  memoryDir: string = resolveMemoryDirPath(),
): Promise<AgentMemory[]> {
  if (topN <= 0) return [];
  const kept = direct.slice(0, topN);
  if (kept.length >= topN) return kept;

  const wanted = ownerUserId == null ? null : ownerUserId;
  const directIds = new Set(kept.map((memory) => memory.id));
  const directSourceIds = new Set(
    kept
      .map((memory) => memory.sourceId)
      .filter((sourceId): sourceId is string => sourceId !== null),
  );
  const requestedLinks: Array<{ fromSourceId: string; target: string }> = [];
  for (const memory of kept) {
    if (
      !isOwnerVisible(memory.ownerUserId, wanted) ||
      memory.source !== 'obsidian-memory' ||
      !memory.sourceId
    ) {
      continue;
    }
    for (const link of extractMemoryBodyLinks(memory.content)) {
      requestedLinks.push({
        fromSourceId: memory.sourceId,
        target: link.target,
      });
    }
  }
  if (requestedLinks.length === 0) return kept;

  const today = currentDate();
  const seenTargets = new Set<string>();
  for (
    let offset = 0;
    offset < requestedLinks.length && kept.length < topN;
    offset += MAX_LINK_LOOKUP_SOURCE_IDS
  ) {
    const requestedBatch = requestedLinks.slice(
      offset,
      offset + MAX_LINK_LOOKUP_SOURCE_IDS,
    );
    const resolvedBatch = await Promise.all(
      requestedBatch.map(({ fromSourceId, target }) =>
        resolveMemoryLinkTarget(memoryDir, fromSourceId, target),
      ),
    );
    const targetSourceIds: string[] = [];
    for (const target of resolvedBatch) {
      if (
        !target ||
        directSourceIds.has(target) ||
        seenTargets.has(target)
      ) {
        continue;
      }
      seenTargets.add(target);
      targetSourceIds.push(target);
    }
    if (targetSourceIds.length === 0) continue;

    const candidates = await repo.findBySourceIdsAsync(
      'obsidian-memory',
      targetSourceIds,
      wanted ?? undefined,
    );
    const bySourceId = new Map<string, AgentMemory>();
    for (const memory of candidates) {
      if (
        !isOwnerVisible(memory.ownerUserId, wanted) ||
        memory.source !== 'obsidian-memory' ||
        !memory.sourceId ||
        directIds.has(memory.id) ||
        directSourceIds.has(memory.sourceId) ||
        !isMemoryActive(memory, today) ||
        bySourceId.has(memory.sourceId)
      ) {
        continue;
      }
      bySourceId.set(memory.sourceId, memory);
    }
    for (const sourceId of targetSourceIds) {
      const expanded = bySourceId.get(sourceId);
      if (!expanded) continue;
      kept.push(expanded);
      directIds.add(expanded.id);
      directSourceIds.add(sourceId);
      if (kept.length >= topN) break;
    }
  }
  return kept;
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
 * The returned text is INTENDED for the SDK's hidden per-turn `system` seam.
 * It must NEVER be concatenated into user-authored text or persisted to a
 * profile systemPrompt, session memory, or an opencode agent .md file.
 */
export async function buildMemoryPreface(
  query: string,
  ownerUserId?: number | null,
  opts: BuildMemoryPrefaceOptions = {},
): Promise<MemoryPreface> {
  const enabled = opts.enabled ?? isMemoryInjectionEnabled();
  if (!enabled) return emptyMemoryPreface();

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
    return emptyMemoryPreface();
  }
  // Custom retrieval hooks and future lanes still cannot bypass lifecycle
  // gating, owner isolation, injectability, or absolute relevance.
  const today = currentDate();
  const wanted = ownerUserId == null ? null : ownerUserId;
  matches = matches.filter((memory) => (
    isOwnerVisible(memory.ownerUserId, wanted)
    && isMemoryActive(memory, today)
    && clearsAutomaticGate(query, memory) !== null
  ));
  if (isMemoryLinkExpansionEnabled()) {
    try {
      matches = await expandLinkedMemories(
        matches,
        ownerUserId,
        opts.topN ?? DEFAULT_TOP_N,
        opts.linkRepository,
        opts.memoryDir,
      );
    } catch {
      // Link expansion is optional. Exact retrieval remains useful on failure.
    }
  }
  matches = matches.filter((memory) => (
    isOwnerVisible(memory.ownerUserId, wanted)
    && isMemoryActive(memory, today)
    && clearsAutomaticGate(query, memory) !== null
  ));
  if (!matches || matches.length === 0) return emptyMemoryPreface();

  const ranked = matches
    .map((memory, index) => ({
      memory,
      index,
      relevance: clearsAutomaticGate(query, memory)!,
    }))
    .sort((a, b) => (
      b.relevance.score - a.relevance.score
      || b.relevance.matchedTokens - a.relevance.matchedTokens
      || trustRank(b.memory) - trustRank(a.memory)
      || a.index - b.index
    ));

  const lines = ['## Known context (facts & preferences)'];
  const accepted: Array<{
    memory: AgentMemory;
    excerpt: string;
    relevance: AutomaticMemoryScore;
  }> = [];
  for (const candidate of ranked.slice(0, AUTOMATIC_MEMORY_MAX_ITEMS)) {
    const excerpt = boundedRelevantExcerpt(query, candidate.memory.content);
    const nextText = [...lines, `- ${excerpt}`].join('\n');
    if (
      nextText.length > AUTOMATIC_MEMORY_MAX_TOTAL_CHARS
      || Math.ceil(nextText.length / 4) > AUTOMATIC_MEMORY_MAX_ESTIMATED_TOKENS
    ) {
      continue;
    }
    lines.push(`- ${excerpt}`);
    accepted.push({
      memory: candidate.memory,
      excerpt,
      relevance: candidate.relevance,
    });
  }
  if (accepted.length === 0) return emptyMemoryPreface();

  return {
    text: lines.join('\n'),
    memoryIds: accepted.map(({ memory }) => memory.id),
    // #805 AC6: surface the originating vault note path for each match so a
    // result traces back to a file. `sourceId` is the vault-relative path for
    // index rows derived from the Memory-Vault.
    notePaths: accepted.map(({ memory }) => memory.sourceId),
    items: accepted.map(({ memory, excerpt, relevance }) => {
      const evidence = retrievalEvidence.get(memory);
      return {
        memoryId: memory.id,
        source: memory.source,
        sourceId: memory.sourceId,
        lane: evidence?.lane ?? 'fts',
        score: evidence?.score ?? Number(relevance.score.toFixed(4)),
        confidence: evidence?.confidence ?? null,
        reason: evidence?.reason
          ?? `lexical overlap ${relevance.matchedTokens}/${relevance.queryTokens} cleared threshold ${getAutomaticMemoryMinRelevance().toFixed(2)}`,
        excerptChars: excerpt.length,
        estimatedTokens: Math.ceil(excerpt.length / 4),
      };
    }),
  };
}
