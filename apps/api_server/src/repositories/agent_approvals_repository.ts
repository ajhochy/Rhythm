/**
 * #895 — Agent Approvals repository.
 *
 * SQLite-only, same convention as agent_sessions/agent_configs: local-agent
 * execution state never syncs to Postgres.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db';

export type AgentApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface AgentApproval {
  id: string;
  sessionId: string | null;
  agentConfigId: string | null;
  action: string;
  preview: string | null;
  consequence: string | null;
  status: AgentApprovalStatus;
  actor: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface CreateAgentApprovalInput {
  sessionId?: string | null;
  agentConfigId?: string | null;
  action: string;
  preview?: string | null;
  consequence?: string | null;
  /** True when the caller's profile has auto_approve_actions set — persists pre-approved. */
  autoApprove?: boolean;
  actor?: string | null;
}

function rowToModel(row: Record<string, unknown>): AgentApproval {
  return {
    id: row.id as string,
    sessionId: (row.session_id as string | null) ?? null,
    agentConfigId: (row.agent_config_id as string | null) ?? null,
    action: row.action as string,
    preview: (row.preview as string | null) ?? null,
    consequence: (row.consequence as string | null) ?? null,
    status: row.status as AgentApprovalStatus,
    actor: (row.actor as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * True when the given profile has auto_approve_actions set. Queried directly
 * against agent_configs (rather than through AgentConfigsRepository's full
 * model) to keep this a narrow, additive read — the column is not yet
 * exposed in the profile editor UI (follow-up).
 */
export function isAutoApproveProfile(agentConfigId: string | null | undefined): boolean {
  if (!agentConfigId) return false;
  const row = getDb()
    .prepare('SELECT auto_approve_actions FROM agent_configs WHERE id = ?')
    .get(agentConfigId) as { auto_approve_actions: number } | undefined;
  return row?.auto_approve_actions === 1;
}

export class AgentApprovalsRepository {
  create(input: CreateAgentApprovalInput): AgentApproval {
    const id = randomUUID();
    const status: AgentApprovalStatus = input.autoApprove ? 'approved' : 'pending';
    const decidedAt = input.autoApprove ? new Date().toISOString() : null;
    const actor = input.autoApprove ? 'auto-approved' : (input.actor ?? null);

    getDb()
      .prepare(
        `INSERT INTO agent_approvals
          (id, session_id, agent_config_id, action, preview, consequence, status, actor, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId ?? null,
        input.agentConfigId ?? null,
        input.action,
        input.preview ?? null,
        input.consequence ?? null,
        status,
        actor,
        decidedAt,
      );

    return this.getById(id)!;
  }

  getById(id: string): AgentApproval | null {
    const row = getDb().prepare('SELECT * FROM agent_approvals WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToModel(row) : null;
  }

  /** Defaults to pending-only (the notification panel's primary view). Pass null for all statuses. */
  list(status: AgentApprovalStatus | null = 'pending'): AgentApproval[] {
    const rows = status
      ? (getDb()
          .prepare('SELECT * FROM agent_approvals WHERE status = ? ORDER BY created_at DESC')
          .all(status) as Record<string, unknown>[])
      : (getDb().prepare('SELECT * FROM agent_approvals ORDER BY created_at DESC').all() as Record<
          string,
          unknown
        >[]);
    return rows.map(rowToModel);
  }

  /** Approve or reject a pending approval. Returns null if the row doesn't exist or isn't pending. */
  decide(id: string, status: 'approved' | 'rejected', actor: string | null): AgentApproval | null {
    const existing = this.getById(id);
    if (!existing || existing.status !== 'pending') return null;

    getDb()
      .prepare(
        `UPDATE agent_approvals SET status = ?, actor = ?, decided_at = ? WHERE id = ?`,
      )
      .run(status, actor, new Date().toISOString(), id);

    return this.getById(id);
  }
}
