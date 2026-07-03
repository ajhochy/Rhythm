import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db';
import { env } from '../config/env';

/**
 * denied_tool_events — issue #818 (org-optimizer-02).
 *
 * Local-SQLite-only telemetry of dispatch-time tool denials, written by
 * `OpencodeStreamBridge.isToolAllowedForSession` on the deny branch only (see
 * that method for the logging seam rationale). `sessionId` and
 * `agentConfigId` are both nullable because the seam that observes a denial
 * does not always have both: a session row always exists when this fires, but
 * profile attribution is best-effort — the bridge resolves `agentConfigId`
 * from the session row's `mcp_role` / `agent_kind` (both logical references
 * to `agent_configs.id`), validated against a real `agent_configs` row, and
 * falls back to null when neither matches or the lookup fails.
 */
export interface DeniedToolEvent {
  id: string;
  sessionId: string | null;
  agentConfigId: string | null;
  toolName: string;
  createdAt: string;
}

export interface RecordDeniedToolEventInput {
  sessionId: string | null;
  agentConfigId: string | null;
  toolName: string;
  /** Override for tests exercising the aggregation time window; defaults to now. */
  createdAt?: string;
}

export interface DeniedToolCount {
  agentConfigId: string;
  toolName: string;
  count: number;
}

function rowToModel(row: Record<string, unknown>): DeniedToolEvent {
  return {
    id: row.id as string,
    sessionId: (row.session_id as string | null) ?? null,
    agentConfigId: (row.agent_config_id as string | null) ?? null,
    toolName: row.tool_name as string,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : (row.created_at as Date).toISOString(),
  };
}

/**
 * SQLite-only repository — `denied_tool_events` is never created in
 * `postgres_bootstrap.ts` (production data does not carry this local
 * dispatch-guard telemetry). Every method below no-ops safely on Postgres so
 * a misconfigured `DB_CLIENT` can never throw trying to query a table that
 * does not exist there.
 */
export class DeniedToolEventsRepository {
  async recordAsync(input: RecordDeniedToolEventInput): Promise<void> {
    if (env.dbClient === 'postgres') return;

    const id = randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO denied_tool_events (id, session_id, agent_config_id, tool_name, created_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(id, input.sessionId, input.agentConfigId, input.toolName, createdAt);
  }

  async listAllAsync(): Promise<DeniedToolEvent[]> {
    if (env.dbClient === 'postgres') return [];

    const rows = getDb()
      .prepare(`SELECT * FROM denied_tool_events ORDER BY created_at ASC`)
      .all();
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  /**
   * Aggregation for the org audit (org-optimizer-03): "profile X was denied
   * tool Y N times" since `sinceIso`. A real GROUP BY query, not a stored
   * counter, so the count is always derived from the actual event log. Rows
   * with a null `agent_config_id` are excluded — there is no profile to
   * attribute them to.
   */
  async countByProfileAndToolAsync(sinceIso: string): Promise<DeniedToolCount[]> {
    if (env.dbClient === 'postgres') return [];

    const rows = getDb()
      .prepare(
        `SELECT agent_config_id, tool_name, COUNT(*) AS count
           FROM denied_tool_events
          WHERE created_at >= ?
            AND agent_config_id IS NOT NULL
          GROUP BY agent_config_id, tool_name`,
      )
      .all(sinceIso) as { agent_config_id: string; tool_name: string; count: number }[];

    return rows.map((r) => ({
      agentConfigId: r.agent_config_id,
      toolName: r.tool_name,
      count: r.count,
    }));
  }
}
