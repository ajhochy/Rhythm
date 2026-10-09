import { createHash } from 'node:crypto';
import { getDb } from '../database/db';
import { AgentApprovalsRepository, type AgentApproval } from '../repositories/agent_approvals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository, type CoordinatorForegroundMcpSessionScope } from '../repositories/coordinator_conversations_repository';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';

export const WORKFLOW_APPROVAL_ACTION = 'coordinator.workflow.start';
export interface BoundedWorkflowEstimate {
  totalSoftTokens: number;
  workerWallSeconds: number;
  expirySeconds: number;
  outerTurns: 2;
  rationale: string;
}
export interface BoundedWorkflowProposal {
  schemaVersion: 1;
  purpose: 'selected_reference_summary_v1';
  proposalId: string;
  ownerUserId: number;
  sessionId: string;
  projectId: string;
  sdkSessionId: string;
  profileId: string;
  profileRevision: number;
  scopeFingerprint: string;
  controlRevision: number;
  goalId: string;
  goalRevision: number;
  objective: string;
  referenceSourceId: string;
  referenceVersion: string;
  canonicalSource: string;
  sourceInstance: string;
  estimate: BoundedWorkflowEstimate;
  proposedAt: string;
  expiresAt: string;
}
export const workflowProposalDigest = (proposal: BoundedWorkflowProposal): string =>
  createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
export const workflowApprovalResumeReasonCode = (approvalId: string, digest: string): string =>
  `workflow_approval_resume_${createHash('sha256').update(`${approvalId}\n${digest}`).digest('hex').slice(0, 32)}`;

export function parseBoundedWorkflowEstimate(value: unknown): BoundedWorkflowEstimate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 5 || !['totalSoftTokens', 'workerWallSeconds', 'expirySeconds', 'outerTurns', 'rationale'].every(k => Object.hasOwn(v,k)) ||
      !Number.isSafeInteger(v.totalSoftTokens) || Number(v.totalSoftTokens) < 1 || Number(v.totalSoftTokens) > 2_000_000 ||
      !Number.isSafeInteger(v.workerWallSeconds) || Number(v.workerWallSeconds) < 30 || Number(v.workerWallSeconds) > 300 ||
      !Number.isSafeInteger(v.expirySeconds) || Number(v.expirySeconds) < 30 || Number(v.expirySeconds) > 3_600 ||
      v.outerTurns !== 2 || typeof v.rationale !== 'string' || !v.rationale.trim() || v.rationale.length > 1_000) return null;
  return { totalSoftTokens: Number(v.totalSoftTokens), workerWallSeconds: Number(v.workerWallSeconds),
    expirySeconds: Number(v.expirySeconds), outerTurns: 2, rationale: v.rationale.trim() };
}

/** The durable digest covers the entire compact canonical payload, never model acknowledgement flags. */
export function readWorkflowProposal(approval: AgentApproval): BoundedWorkflowProposal | null {
  try {
    if (approval.securityAction !== WORKFLOW_APPROVAL_ACTION || !approval.boundPayloadJson ||
        approval.boundPayloadJson.length > 16_384) return null;
    const p = JSON.parse(approval.boundPayloadJson) as BoundedWorkflowProposal;
    if (!p || Object.keys(p).length !== 21 || !['schemaVersion','purpose','proposalId','ownerUserId','sessionId','projectId','sdkSessionId','profileId','profileRevision','scopeFingerprint','controlRevision','goalId','goalRevision','objective','referenceSourceId','referenceVersion','canonicalSource','sourceInstance','estimate','proposedAt','expiresAt'].every(k => Object.hasOwn(p,k)) || p.schemaVersion !== 1 || p.purpose !== 'selected_reference_summary_v1' ||
        workflowProposalDigest(p) !== approval.payloadDigest || approval.sessionId !== p.sessionId ||
        approval.agentConfigId !== p.profileId || approval.boundAgent !== p.profileId ||
        approval.expiresAt !== p.expiresAt || !parseBoundedWorkflowEstimate(p.estimate) ||
        !/^memory:[0-9a-f-]{36}$/i.test(p.referenceSourceId) || !/^sha256:[0-9a-f]{64}$/.test(p.referenceVersion) ||
        !Number.isSafeInteger(p.ownerUserId) || p.ownerUserId <= 0 || !Number.isSafeInteger(p.controlRevision) || p.controlRevision < 1 ||
        !Number.isSafeInteger(p.goalRevision) || p.goalRevision < 1 || !Number.isSafeInteger(p.profileRevision) || p.profileRevision < 0 ||
        ![p.proposalId,p.sessionId,p.projectId,p.sdkSessionId,p.profileId,p.goalId,p.objective,p.canonicalSource,p.sourceInstance,p.scopeFingerprint]
          .every(v => typeof v === 'string' && v.length > 0 && v.length <= 4_000) ||
        !Number.isFinite(Date.parse(p.proposedAt)) || !Number.isFinite(Date.parse(p.expiresAt)) ||
        Date.parse(p.expiresAt) - Date.parse(p.proposedAt) !== p.estimate.expirySeconds * 1_000) return null;
    return p;
  } catch { return null; }
}

export interface WorkflowApprovalResumeCandidate extends CoordinatorForegroundMcpSessionScope {
  approvalId: string;
  proposalDigest: string;
  proposal: BoundedWorkflowProposal;
  reasonCode: string;
  /** Derived only from the unused exact server-created link, never request input. */
  linkedWorkstreamId?: string;
}

/** Synchronous local proof used by wake producer and consumer; final server scope/source proofs remain mandatory at issuance. */
export function workflowApprovalResumeCandidate(approvalId: string, records = new CoordinatorConversationsRepository(),
  options: { linkedWorkstreamId?: string; now?: number } = {}): WorkflowApprovalResumeCandidate | null {
  try {
    const approval = new AgentApprovalsRepository().getById(approvalId);
    if (!approval || approval.status !== 'approved' || !approval.actor?.startsWith('user:') ||
        !approval.decidedAt || approval.decisionNonce !== null || approval.consumedAt !== null) return null;
    const p = readWorkflowProposal(approval);
    if (!p || approval.actor !== `user:${p.ownerUserId}` || Date.parse(p.expiresAt) <= (options.now ?? Date.now())) return null;
    const session = new AgentSessionsRepository().findById(p.sessionId);
    if (!session || session.profileId !== p.profileId || session.permissionMode !== 'plan' || session.approvalBypassExplicit ||
        session.sdkSessionId !== p.sdkSessionId) return null;
    const scope = records.findForegroundMcpSessionScope({ ownerUserId: p.ownerUserId, sdkSessionId: p.sdkSessionId });
    if (!scope || scope.sessionId !== p.sessionId || scope.projectId !== p.projectId) return null;
    const current = records.get(scope);
    if (current.kind !== 'found' || !current.conversation.primaryOwnerRoot) return null;
    const goal = current.conversation.goals.find(g => g.id === p.goalId);
    const linked = options.linkedWorkstreamId ?? (goal?.state === 'linked' ? goal.linkedWorkstreamId ?? undefined : undefined);
    if (!goal || goal.objective !== p.objective || goal.revision !== p.goalRevision + (linked ? 1 : 0) ||
        current.conversation.controlRevision !== p.controlRevision + (linked ? 1 : 0) ||
        goal.state !== (linked ? 'linked' : 'captured') || goal.linkedWorkstreamId !== (linked ?? null)) return null;
    const db = getDb();
    if (linked) {
      const workstream = new AgentWorkstreamsRepository().find(p.ownerUserId, p.projectId, linked);
      if (!workstream || workstream.goal !== p.objective || workstream.createKey !== `conversation:workflow:${current.conversation.id}:${p.goalId}` ||
          workstream.state !== 'ready' || workstream.revision !== 1 || workstream.executorEpoch !== null || workstream.lastJobId !== null ||
          workstream.automation !== null || workstream.closedReason !== null || workstream.stateReason !== null ||
          JSON.stringify(workstream.checkpoint) !== JSON.stringify({ version: 1,
            criteria: [{ id: 'selected_reference_current', status: 'pending' }, { id: 'reviewed_summary_with_citation', status: 'pending' }],
            references: [{ sourceId: p.referenceSourceId, expectedVersion: p.referenceVersion, scope: p.projectId, provenance: 'user_reference' }],
            nextAction: { kind: 'review', scope: p.projectId } }) ||
          current.conversation.continuations.some(c => c.goalId === p.goalId || c.workstreamId === linked) ||
          db.prepare('SELECT id FROM agent_bridge_jobs WHERE workstream_id=? LIMIT 1').get(linked) ||
          // Old settled delegation history is unrelated to this newly authored proposal.
          db.prepare('SELECT id FROM agent_async_delegations WHERE parent_session_id=? AND created_at>=? LIMIT 1').get(p.sessionId, p.proposedAt)) return null;
    }
    const profile = db.prepare('SELECT revision, enabled FROM agent_configs WHERE id=?').get(p.profileId) as { revision: number; enabled: number } | undefined;
    if (!profile || profile.enabled !== 1 || profile.revision !== p.profileRevision) return null;
    // A revised card supersedes older terms without mutating their signed rows.
    const newer = db.prepare(`SELECT id FROM agent_approvals WHERE session_id=? AND security_action=?
      AND json_extract(bound_payload_json,'$.goalId')=? AND rowid>(SELECT rowid FROM agent_approvals WHERE id=?) LIMIT 1`)
      .get(p.sessionId, WORKFLOW_APPROVAL_ACTION, p.goalId, approval.id);
    if (newer) return null;
    return { ...scope, ...(linked ? { linkedWorkstreamId: linked } : {}), approvalId, proposalDigest: approval.payloadDigest!, proposal: p,
      reasonCode: workflowApprovalResumeReasonCode(approvalId, approval.payloadDigest!) };
  } catch { return null; }
}

/** Exactly one accepted dispatch for the native anchor, including conflicting origins/reasons. */
export function workflowResumeDispatchCurrent(input: CoordinatorForegroundMcpSessionScope & { sdkUserMessageId: string; reasonCode: string }): boolean {
  const rows = getDb().prepare(`SELECT origin,requested_source,route_authed,reason_code FROM agent_turn_dispatches
    WHERE session_id=? AND sdk_session_id=? AND sdk_user_message_id=? AND outcome='accepted' LIMIT 2`)
    .all(input.sessionId,input.sdkSessionId,input.sdkUserMessageId) as Array<{ origin: string; requested_source: string; route_authed: number | null; reason_code: string }>;
  return rows.length === 1 && rows[0].origin === 'approval_continuation' && rows[0].requested_source === 'agent_config' &&
    rows[0].route_authed === null && rows[0].reason_code === input.reasonCode;
}
