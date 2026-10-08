import { getDb } from '../database/db';
import type { MemoryPreface } from '../services/memory_retrieval';

/** Local diagnostic history only: deliberately projects no body/query/token fields. */
export class AgentMemoryTurnReceiptsRepository {
  append(sessionId: string, preface: MemoryPreface): void {
    const candidates = (preface.candidates ?? []).slice(0, 10).map(c => ({
      memoryId: c.memoryId, sourceId: c.sourceId, lane: c.lane,
      nativeRank: c.nativeRank, sharedTokenCount: c.sharedTokenCount,
      broad: c.broad, admitted: c.admitted, reason: c.reason,
    }));
    const db = getDb();
    db.transaction(() => {
      db.prepare(`INSERT INTO agent_memory_turn_receipts
        (session_id, created_at, query_mode, decision, semantic_status, semantic_hit_count,
         candidates_json, injected_count, injected_chars, latency_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sessionId, new Date().toISOString(), preface.queryMode ?? null,
          preface.decision ?? (preface.memoryIds.length ? 'injected' : 'none_relevant'),
          preface.semanticStatus, preface.semanticHitCount, JSON.stringify(candidates),
          preface.memoryIds.length, preface.text.length, preface.latencyMs ?? 0);
      db.prepare(`DELETE FROM agent_memory_turn_receipts WHERE session_id = ? AND id NOT IN
        (SELECT id FROM agent_memory_turn_receipts WHERE session_id = ? ORDER BY id DESC LIMIT 200)`)
        .run(sessionId, sessionId);
    })();
  }
}
