/**
 * agent_session_memory_provenance_repository.ts — Issue #862 (memory trust,
 * "explain-which-memories").
 *
 * Stores the LATEST turn's injected memory ids + originating vault note paths
 * per session, so the desktop app can render "Memories used in this reply: …"
 * (or explicitly "no memories were used" when the array is empty). One row
 * per session_id, overwritten on every turn — see migrations.ts's
 * `agent_session_memory_provenance` table comment for the full rationale.
 *
 * SQLite-only (mirrors AgentSessionMessagesRepository) — the local agent
 * server on :4001 is the only writer/reader; never added to
 * postgres_bootstrap.ts.
 */
import { getDb } from '../database/db';

const MAX_PROVENANCE_ENTRIES = 5;

export type MemorySemanticStatus =
  | 'disabled'
  | 'backend_unavailable'
  | 'timeout'
  | 'http_error'
  | 'malformed'
  | 'no_hits'
  | 'no_confidence'
  | 'unmapped'
  | 'lexical_gate'
  | 'used';

export interface MemoryProvenanceItem {
  memoryId: string;
  source: string | null;
  sourceId: string | null;
  lane: 'fts' | 'semantic' | 'hybrid' | 'rerank';
  score: number;
  confidence: number | null;
  reason: string;
  excerptChars?: number;
  estimatedTokens?: number;
  /** Body-free diagnostic outcome for the semantic retrieval lane. */
  semanticStatus?: MemorySemanticStatus;
  /** Bounded source-material origin metadata; never a note body. */
  origin?: string | null;
  observationId?: string | null;
  observedAt?: string | null;
  originTags?: string[];
}

export interface MemoryProvenanceRecord {
  sessionId: string;
  /** Ids of the memories injected into this turn's prompt (top-5, capped). */
  memoryIds: string[];
  /** Positionally-aligned originating vault note path for each memory id. */
  notePaths: (string | null)[];
  /** Retrieval evidence only. Never contains a note body or prompt text. */
  items: MemoryProvenanceItem[];
  /** Semantic retrieval outcome for the turn, even when no memory was selected. */
  semanticStatus: MemorySemanticStatus;
  /** Bounded, body-free count of Engraph hits observed for the turn. */
  semanticHitCount: number;
  updatedAt: string;
}

interface ProvenanceRow {
  session_id: string;
  memory_ids_json: string;
  note_paths_json: string;
  items_json: string;
  semantic_status: string;
  semantic_hit_count: number;
  updated_at: string;
}

function rowToModel(row: ProvenanceRow): MemoryProvenanceRecord {
  let memoryIds: string[] = [];
  let notePaths: (string | null)[] = [];
  let items: MemoryProvenanceItem[] = [];
  try {
    const parsed = JSON.parse(row.memory_ids_json);
    if (Array.isArray(parsed)) memoryIds = parsed;
  } catch {
    /* malformed — treat as empty */
  }
  try {
    const parsed = JSON.parse(row.note_paths_json);
    if (Array.isArray(parsed)) notePaths = parsed;
  } catch {
    /* malformed — treat as empty */
  }
  try {
    const parsed = JSON.parse(row.items_json ?? '[]');
    if (Array.isArray(parsed)) items = parsed.slice(0, MAX_PROVENANCE_ENTRIES);
  } catch {
    /* malformed — treat as empty */
  }
  return {
    sessionId: row.session_id,
    memoryIds,
    notePaths,
    items,
    semanticStatus: isSemanticStatus(row.semantic_status) ? row.semantic_status : 'disabled',
    semanticHitCount: Number.isInteger(row.semantic_hit_count) && row.semantic_hit_count >= 0
      ? row.semantic_hit_count
      : 0,
    updatedAt: row.updated_at,
  };
}

function isSemanticStatus(value: unknown): value is MemorySemanticStatus {
  return value === 'disabled' || value === 'backend_unavailable' || value === 'timeout'
    || value === 'http_error' || value === 'malformed' || value === 'no_hits'
    || value === 'no_confidence' || value === 'unmapped' || value === 'lexical_gate'
    || value === 'used';
}

export class AgentSessionMemoryProvenanceRepository {
  /**
   * Record (overwrite) the memory provenance for a session's latest turn.
   * Caps both arrays at {@link MAX_PROVENANCE_ENTRIES} (top-5 injection
   * contract) — a caller passing more is truncated, never rejected.
   * An empty array is a valid, meaningful input ("this turn used no memories").
   */
  record(
    sessionId: string,
    memoryIds: string[],
    notePaths: (string | null)[],
    items: MemoryProvenanceItem[] = [],
    diagnostics: Pick<MemoryProvenanceRecord, 'semanticStatus' | 'semanticHitCount'> = {
      semanticStatus: 'disabled', semanticHitCount: 0,
    },
  ): void {
    const cappedIds = memoryIds.slice(0, MAX_PROVENANCE_ENTRIES);
    const cappedPaths = notePaths.slice(0, MAX_PROVENANCE_ENTRIES);
    const cappedItems = items.slice(0, MAX_PROVENANCE_ENTRIES).map((item) => ({
      memoryId: item.memoryId,
      source: item.source,
      sourceId: item.sourceId,
      lane: item.lane,
      score: item.score,
      confidence: item.confidence,
      reason: item.reason.slice(0, 240),
      ...(item.excerptChars === undefined ? {} : { excerptChars: item.excerptChars }),
      ...(item.estimatedTokens === undefined ? {} : { estimatedTokens: item.estimatedTokens }),
      ...(item.semanticStatus === undefined ? {} : { semanticStatus: item.semanticStatus }),
      ...(item.origin === undefined ? {} : { origin: item.origin?.slice(0, 120) ?? null }),
      ...(item.observationId === undefined ? {} : { observationId: item.observationId?.slice(0, 120) ?? null }),
      ...(item.observedAt === undefined ? {} : { observedAt: item.observedAt?.slice(0, 120) ?? null }),
      ...(item.originTags === undefined ? {} : { originTags: item.originTags.slice(0, 3).map((tag) => tag.slice(0, 120)) }),
    }));
    const semanticStatus = isSemanticStatus(diagnostics.semanticStatus)
      ? diagnostics.semanticStatus
      : 'disabled';
    const semanticHitCount = Number.isInteger(diagnostics.semanticHitCount)
      && diagnostics.semanticHitCount >= 0
      ? diagnostics.semanticHitCount
      : 0;
    getDb()
      .prepare(
        `INSERT INTO agent_session_memory_provenance
           (session_id, memory_ids_json, note_paths_json, items_json, semantic_status, semantic_hit_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(session_id) DO UPDATE SET
           memory_ids_json = excluded.memory_ids_json,
           note_paths_json = excluded.note_paths_json,
           items_json = excluded.items_json,
           semantic_status = excluded.semantic_status,
           semantic_hit_count = excluded.semantic_hit_count,
           updated_at = excluded.updated_at`,
      )
      .run(
        sessionId,
        JSON.stringify(cappedIds),
        JSON.stringify(cappedPaths),
        JSON.stringify(cappedItems),
        semanticStatus,
        semanticHitCount,
      );
  }

  /**
   * Read the latest recorded provenance for a session.
   * Returns null when NO turn has ever been recorded for this session —
   * distinct from a recorded turn whose `memoryIds` is an empty array (which
   * means "this turn injected no memories", a meaningful, different state).
   */
  getLatest(sessionId: string): MemoryProvenanceRecord | null {
    const row = getDb()
      .prepare(`SELECT * FROM agent_session_memory_provenance WHERE session_id = ?`)
      .get(sessionId) as ProvenanceRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /** Remove the provenance row for a session (e.g. on session deletion). */
  deleteBySession(sessionId: string): number {
    const result = getDb()
      .prepare(`DELETE FROM agent_session_memory_provenance WHERE session_id = ?`)
      .run(sessionId);
    return result.changes;
  }
}
