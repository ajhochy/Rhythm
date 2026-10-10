import { getDb } from '../database/db';
import type { MemoryPreface } from '../services/memory_retrieval';

/** Local diagnostic history only: deliberately projects no body/query/token fields. */
export class AgentMemoryTurnReceiptsRepository {
  /** Stop at the nearest current task, including a task that admitted no memories. */
  recentTaskMemoryIds(sessionId: string): string[] {
    const rows = getDb().prepare(`SELECT query_mode, candidates_json FROM agent_memory_turn_receipts
      WHERE session_id = ? ORDER BY id DESC LIMIT 8`).all(sessionId) as Array<{ query_mode: string | null; candidates_json: string }>;
    const ids = new Set<string>();
    for (const row of rows) {
      // Unknown historical intent is not proof that two turns share a task.
      if (row.query_mode === null) break;
      if (row.query_mode !== 'abstain') {
        let candidates: unknown;
        try { candidates = JSON.parse(row.candidates_json); } catch { break; }
        if (!Array.isArray(candidates)) break;
        for (const candidate of candidates.slice(0, 10)) {
          if (candidate?.admitted === true && typeof candidate.memoryId === 'string') ids.add(candidate.memoryId);
        }
      }
      if (row.query_mode === 'current') break;
    }
    return [...ids].slice(0, 10);
  }

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
