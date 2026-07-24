/**
 * _approval_gate.ts — Issue #1134
 *
 * Shared server-enforced authorization transition for outbound tools
 * (rhythm_send_email, rhythm_send_message, rhythm_create_message_thread).
 * Lives in one place so the "check taint → verify approval → allow/refuse"
 * logic isn't duplicated per caller (root-cause fix, not per-site patching).
 *
 * There is no `GET /agent-approvals/:id` single-item route (only
 * `POST /agent-approvals`, `GET /agent-approvals` list, and
 * `PATCH /agent-approvals/:id` — see
 * apps/api_server/src/routes/agent_approvals_routes.ts). Approval status for
 * a given id is confirmed by fetching `GET /agent-approvals?status=all` and
 * matching the id — no new api_server route needed for this PR (mcp_server
 * scope only).
 */

import { isTainted, taintReason } from '../taint.js';

export interface ApprovalGateResult {
  allowed: boolean;
  /** Present when allowed=false: the message to return as the tool's isError text. */
  refusalMessage?: string;
}

interface EnforceApprovalArgs {
  agentUrl: string;
  approvalId?: string;
  /** Short description of the action being gated, e.g. "send email to x@y.com". */
  action: string;
}

interface AgentApprovalRecord {
  id: string;
  status: string;
}

/**
 * If the process is clean (no untrusted external content consumed this
 * session), allow immediately. If tainted, hard-refuse unless `approvalId`
 * is present and a server-side lookup confirms it is `status: 'approved'`.
 * Fails closed on any lookup error.
 */
export async function enforceApprovalIfTainted({
  agentUrl,
  approvalId,
  action,
}: EnforceApprovalArgs): Promise<ApprovalGateResult> {
  if (!isTainted()) return { allowed: true };

  if (!approvalId) {
    return {
      allowed: false,
      refusalMessage:
        `Blocked: this session read untrusted external content (source: ${taintReason()}) ` +
        `and "${action}" has not been approved. Call rhythm_request_approval first, then retry ` +
        `this call with the returned id as approval_id.`,
    };
  }

  try {
    const res = await fetch(`${agentUrl}/agent-approvals?status=all`);
    if (!res.ok) {
      return {
        allowed: false,
        refusalMessage: `Blocked: could not verify approval_id "${approvalId}" (agent server returned ${res.status}). Not proceeding.`,
      };
    }
    const approvals = (await res.json()) as AgentApprovalRecord[];
    const match = approvals.find((a) => a.id === approvalId);
    if (match?.status === 'approved') {
      return { allowed: true };
    }
    return {
      allowed: false,
      refusalMessage: `Blocked: approval_id "${approvalId}" is not approved (status: ${match?.status ?? 'not found'}). Not proceeding.`,
    };
  } catch (err) {
    return {
      allowed: false,
      refusalMessage: `Blocked: approval verification failed (${err instanceof Error ? err.message : String(err)}). Failing closed — not proceeding.`,
    };
  }
}
