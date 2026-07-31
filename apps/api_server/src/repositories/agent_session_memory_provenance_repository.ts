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

export interface MemoryProvenanceItem {
  memoryId: string;
  source: string | null;
  sourceId: string | null;
  lane: 'fts' | 'semantic' | 'hybrid';
  score: number;
  confidence: number | null;
  reason: string;
  excerptChars?: number;
  estimatedTokens?: number;
}

export interface MemoryProvenanceRecord {
  sessionId: string;
  /** Ids of the memories injected into this turn's prompt (top-5, capped). */
  memoryIds: string[];
  /** Positionally-aligned originating vault note path for each memory id. */
  notePaths: (string | null)[];
  /** Retrieval evidence only. Never contains a note body or prompt text. */
  items: MemoryProvenanceItem[];
  updatedAt: string;
}

interface ProvenanceRow {
  session_id: string;
  memory_ids_json: string;
  note_paths_json: string;
  items_json: string;
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
    updatedAt: row.updated_at,
  };
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
    }));
    getDb()
      .prepare(
        `INSERT INTO agent_session_memory_provenance
           (session_id, memory_ids_json, note_paths_json, items_json, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(session_id) DO UPDATE SET
           memory_ids_json = excluded.memory_ids_json,
           note_paths_json = excluded.note_paths_json,
           items_json = excluded.items_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        sessionId,
        JSON.stringify(cappedIds),
        JSON.stringify(cappedPaths),
        JSON.stringify(cappedItems),
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
