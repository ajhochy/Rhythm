/**
 * #895 — Agent Approvals repository.
 *
 * SQLite-only, same convention as agent_sessions/agent_configs: local-agent
 * execution state never syncs to Postgres.
 */

import { randomBytes, randomUUID } from 'node:crypto';
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
  securityAction: string | null;
  payloadDigest: string | null;
  taintId: string | null;
  taintedTurnId: string | null;
  boundAgent: string | null;
  expiresAt: string | null;
  consumedAt: string | null;
  decisionNonce: string | null;
  continuationState?: string | null;
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
  securityAction?: string | null;
  payloadDigest?: string | null;
  taintId?: string | null;
  taintedTurnId?: string | null;
  boundAgent?: string | null;
  expiresAt?: string | null;
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
    securityAction: (row.security_action as string | null) ?? null,
    payloadDigest: (row.payload_digest as string | null) ?? null,
    taintId: (row.taint_id as string | null) ?? null,
    taintedTurnId: (row.tainted_turn_id as string | null) ?? null,
    boundAgent: (row.bound_agent as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    consumedAt: (row.consumed_at as string | null) ?? null,
    decisionNonce: (row.decision_nonce as string | null) ?? null,
    continuationState: (row.continuation_state as string | null) ?? null,
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
    // #1134: security-bound outbound approvals can never inherit a profile's
    // auto-approve flag. They require an explicit human decision.
    const autoApprove = input.autoApprove === true && !input.securityAction;
    const status: AgentApprovalStatus = autoApprove ? 'approved' : 'pending';
    const decidedAt = autoApprove ? new Date().toISOString() : null;
    const actor = autoApprove ? 'auto-approved' : (input.actor ?? null);
    const decisionNonce = autoApprove
      ? null
      : randomBytes(32).toString('base64url');

    getDb()
      .prepare(
        `INSERT INTO agent_approvals
          (id, session_id, agent_config_id, action, preview, consequence, status,
           actor, decided_at, security_action, payload_digest, taint_id,
           tainted_turn_id, bound_agent, expires_at, decision_nonce)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.securityAction ?? null,
        input.payloadDigest ?? null,
        input.taintId ?? null,
        input.taintedTurnId ?? null,
        input.boundAgent ?? null,
        input.expiresAt ?? null,
        decisionNonce,
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

  /**
   * Atomically consume a pending decision nonce. Signature verification occurs
   * immediately before this call; the nonce predicate prevents replay and
   * closes the verify/update race between two concurrent requests.
   */
  decideWithNonce(
    id: string,
    status: 'approved' | 'rejected',
    actor: string,
    decisionNonce: string,
  ): AgentApproval | null {
    const updated = getDb()
      .prepare(
        `UPDATE agent_approvals
         SET status = ?, actor = ?, decided_at = ?, decision_nonce = NULL,
             continuation_state = CASE
               WHEN session_id IS NOT NULL THEN 'queued'
               ELSE NULL
             END,
             continuation_updated_at = CASE
               WHEN session_id IS NOT NULL THEN ?
               ELSE NULL
             END
         WHERE id = ? AND status = 'pending' AND decision_nonce = ?`,
      )
      .run(
        status,
        actor,
        new Date().toISOString(),
        new Date().toISOString(),
        id,
        decisionNonce,
      );
    if (updated.changes !== 1) return null;

    return this.getById(id);
  }

  listContinuations(sessionId?: string): AgentApproval[] {
    const rows = sessionId
      ? getDb()
          .prepare(
            `SELECT * FROM agent_approvals
             WHERE session_id = ?
               AND continuation_state IN ('queued', 'waking')
             ORDER BY decided_at ASC`,
          )
          .all(sessionId)
      : getDb()
          .prepare(
            `SELECT * FROM agent_approvals
             WHERE continuation_state IN ('queued', 'waking')
             ORDER BY decided_at ASC
             LIMIT 100`,
          )
          .all();
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  claimContinuation(id: string): boolean {
    return getDb()
      .prepare(
        `UPDATE agent_approvals
         SET continuation_state = 'waking', continuation_updated_at = ?
         WHERE id = ? AND continuation_state = 'queued'`,
      )
      .run(new Date().toISOString(), id).changes === 1;
  }

  markContinuationDelivered(id: string): void {
    getDb()
      .prepare(
        `UPDATE agent_approvals
         SET continuation_state = 'delivered', continuation_updated_at = ?
         WHERE id = ? AND continuation_state IN ('queued', 'waking')`,
      )
      .run(new Date().toISOString(), id);
  }

  releaseContinuation(id: string): void {
    getDb()
      .prepare(
        `UPDATE agent_approvals
         SET continuation_state = 'queued', continuation_updated_at = ?
         WHERE id = ? AND continuation_state = 'waking'`,
      )
      .run(new Date().toISOString(), id);
  }
}
