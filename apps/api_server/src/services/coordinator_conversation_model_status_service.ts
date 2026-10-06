import { Buffer } from 'node:buffer';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../database/db';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { WORKFLOW_APPROVAL_ACTION, parseBoundedWorkflowEstimate, readWorkflowProposal, workflowProposalDigest, workflowApprovalResumeCandidate, workflowResumeDispatchCurrent, type BoundedWorkflowProposal } from './chat_bounded_workflow';

import type { AuthContext } from '../middleware/auth_middleware';
import type {
  CoordinatorConversationsRepository,
  CoordinatorMcpDispatchBinding,
} from '../repositories/coordinator_conversations_repository';
import { ExternalContentSecurityService } from './external_content_security_service';
import {
  verifyTrustedMcpCall,
  type VerifiedTrustedMcpCall,
} from '../security/trusted_mcp_call';
import type { OpencodeClientService } from './opencode_client_service';
import { CoordinatorConversationService } from './coordinator_conversation_service';
import { CoordinatorForegroundMcpAuthority } from './coordinator_foreground_mcp_authority';

const TOOL_NAME = 'rhythm_get_coordinator_status';
const GOAL_TOOL_NAME = 'rhythm_start_coordinator_goal';

export type CoordinatorAgentToolStatusResponse =
  | { schemaVersion: 1; status: 'available'; text: string }
  | { schemaVersion: 1; status: 'unavailable'; text: '' };

const unavailable = (): CoordinatorAgentToolStatusResponse => ({
  schemaVersion: 1,
  status: 'unavailable',
  text: '',
});

export type CoordinatorAgentToolGoalResponse = {
  schemaVersion: 1;
  status: 'started' | 'held' | 'unavailable';
  text: string;
};

const goalUnavailable = (): CoordinatorAgentToolGoalResponse => ({
  schemaVersion: 1,
  status: 'unavailable',
  text: 'Coordinator goal action is unavailable.',
});

const goalHeld = (): CoordinatorAgentToolGoalResponse => ({
  schemaVersion: 1,
  status: 'held',
  text: 'Coordinator goal action is held; do not retry automatically.',
});

const goalStarted = (): CoordinatorAgentToolGoalResponse => ({
  schemaVersion: 1,
  status: 'started',
  text: 'Coding Workflow was dispatched for the exact tracked goal. Its result returns through the existing root callback for review; it is not verified completion.',
});

function trustedEnvelope(value: unknown): unknown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && Object.hasOwn(record, 'trustedCall')
    ? record.trustedCall
    : null;
}

/** Signed args exactly `{goalId, approval_id?}`, both bounded and nonempty. */
function goalFromArguments(value: Record<string, unknown>): { goalId: string; approvalId?: string } | null {
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (
    !keys.every((key) => key === 'goalId' || key === 'approval_id') ||
    typeof value.goalId !== 'string' || value.goalId.length === 0 || value.goalId.length > 256 ||
    (value.approval_id !== undefined &&
      (typeof value.approval_id !== 'string' || value.approval_id.length === 0 || value.approval_id.length > 256))
  ) return null;
  return value.approval_id === undefined
    ? { goalId: value.goalId }
    : { goalId: value.goalId, approvalId: value.approval_id as string };
}

/**
 * Opaque receipt key for ONE native tool call's goal action. The approval id
 * (when the call carries one) is part of the hash, so the key can only exist
 * if the coupled reservation+consumption transaction for exactly that token ran.
 */
function goalActionCommandKey(
  auth: AuthContext,
  binding: { sessionId: string; projectId: string; sdkSessionId: string; sdkUserMessageId: string },
  verified: VerifiedTrustedMcpCall,
  goalId: string,
  approvalId?: string,
): string {
  return `coordinator-goal-action:${createHash('sha256').update(JSON.stringify({
    actorUserId: auth.user.id,
    sessionId: binding.sessionId,
    projectId: binding.projectId,
    sdkSessionId: binding.sdkSessionId,
    sdkUserMessageId: binding.sdkUserMessageId,
    turnId: verified.context.turnId,
    toolCallId: verified.context.toolCallId,
    goalId,
    ...(approvalId === undefined ? {} : { approvalId }),
  })).digest('hex')}`;
}

/** Bounded (<=600 byte) held text that names the exact fixed approval mapping. */
const goalApprovalRequired = (goalId: string): CoordinatorAgentToolGoalResponse => ({
  schemaVersion: 1,
  status: 'held',
  text: 'Coordinator goal action needs a human approval first. Call rhythm_request_approval with security_action ' +
    `"delegation.start-async" and security_payload ${JSON.stringify({ goalId })} exactly, wait for the human ` +
    'decision, then retry this tool once with its approval_id.',
});

/**
 * The read-only coordinator tool is a distinct signed boundary: a bearer is
 * necessary but insufficient, and a generic active SDK session is insufficient.
 * It must be the exact accepted C2 foreground user-message currently hosting
 * this native MCP call.
 */
export class CoordinatorConversationModelStatusService {
  private readonly authority: CoordinatorForegroundMcpAuthority;
  private readonly verify: typeof verifyTrustedMcpCall;
  private readonly security: Pick<ExternalContentSecurityService, 'consumeCoordinatorGoalApproval'>;

  constructor(private readonly dependencies: {
    conversations: CoordinatorConversationService;
    records: CoordinatorConversationsRepository;
    engine: Pick<OpencodeClientService, 'getCurrentTrustedMcpToolCall'>;
    verify?: typeof verifyTrustedMcpCall;
    /** Defaults to the real approval/taint service; only an isolated-schema fixture substitutes it. */
    approvals?: Pick<ExternalContentSecurityService, 'consumeCoordinatorGoalApproval'>;
  }) {
    this.security = dependencies.approvals ?? new ExternalContentSecurityService();
    this.authority = new CoordinatorForegroundMcpAuthority({
      engine: dependencies.engine,
      records: dependencies.records,
    });
    this.verify = dependencies.verify ?? verifyTrustedMcpCall;
  }

  async proposeWorkflow(auth: AuthContext | undefined, body: unknown) {
    const held = () => ({ schemaVersion: 1 as const, status: 'held' as const, text: 'Bounded Coding Workflow proposal is held; check the current captured goal, indexed reference and plan-root scope.' });
    try {
      const envelope = trustedEnvelope(body);
      if (!auth || !envelope) return held();
      const verified = await this.verify(envelope, 'rhythm_propose_bounded_coding_workflow', Date.now(), 'coordinator_workflow_proposal');
      const a = verified.arguments;
      if (Object.keys(a).length !== 5 || !['goalSelector','referenceSelector','referenceSourceId','referenceVersion','estimate'].every(k => Object.hasOwn(a,k)) ||
          !['goalSelector','referenceSelector','referenceSourceId','referenceVersion'].every(k => typeof a[k] === 'string' && (a[k] as string).trim().length > 0 && (a[k] as string).length <= 4_000)) return held();
      const estimate = parseBoundedWorkflowEstimate(a.estimate);
      if (!estimate) return held();
      const binding = await this.authority.resolveForeground(auth, verified, 'rhythm_propose_bounded_coding_workflow');
      if (!binding || !this.dependencies.conversations.modelStatusScopeCurrent(auth, binding)) return held();
      const initial = this.dependencies.conversations.boundedWorkflowSelection(auth, binding, a.goalSelector as string);
      if (!initial || initial.profileId !== verified.context.agentName) return held();
      const resolved = await this.dependencies.conversations.resolveBoundedWorkflowReference(auth, binding, a.referenceSourceId as string, a.referenceVersion as string);
      if (!resolved?.eligible || !resolved.managedReference || resolved.receipt.kind !== 'memory_vault' ||
          !resolved.receipt.verified || resolved.receipt.reason !== null || !resolved.receipt.sourceInstance || !resolved.isCurrent) return held();
      if (!(await this.authority.isCurrent(binding, auth, verified, 'rhythm_propose_bounded_coding_workflow'))) return held();
      const current = this.dependencies.conversations.boundedWorkflowSelection(auth, binding, a.goalSelector as string);
      if (!current || JSON.stringify(current) !== JSON.stringify(initial) || !resolved.isCurrent()) return held();
      const approvals = new AgentApprovalsRepository();
      const now = new Date();
      const candidate: BoundedWorkflowProposal = {
        schemaVersion: 1, purpose: 'selected_reference_summary_v1', proposalId: randomUUID(),
        ownerUserId: auth.user.id, sessionId: binding.sessionId, projectId: binding.projectId, sdkSessionId: binding.sdkSessionId,
        profileId: current.profileId, profileRevision: current.profileRevision, scopeFingerprint: current.scopeFingerprint,
        controlRevision: current.conversation.controlRevision, goalId: current.goal.id, goalRevision: current.goal.revision,
        objective: current.goal.objective, referenceSourceId: resolved.selector, referenceVersion: resolved.receipt.observedVersion,
        canonicalSource: resolved.receipt.canonicalId, sourceInstance: resolved.receipt.sourceInstance, estimate,
        proposedAt: now.toISOString(), expiresAt: new Date(now.valueOf() + estimate.expirySeconds * 1_000).toISOString(),
      };
      // Identical pending terms reuse the latest exact card; changed estimates are fresh immutable proposals.
      const last = getDb().prepare(`SELECT id FROM agent_approvals WHERE session_id=? AND security_action=?
        AND json_extract(bound_payload_json,'$.goalId')=? ORDER BY rowid DESC LIMIT 1`)
        .get(binding.sessionId, WORKFLOW_APPROVAL_ACTION, candidate.goalId) as { id: string } | undefined;
      const previous = last ? approvals.getById(last.id) : null;
      const old = previous ? readWorkflowProposal(previous) : null;
      const comparable = (p: BoundedWorkflowProposal) => { const { proposalId, proposedAt, expiresAt, ...terms } = p; return JSON.stringify(terms); };
      let approval;
      if (previous?.status === 'pending' && old && Date.parse(old.expiresAt) > now.valueOf() && comparable(old) === comparable(candidate)) {
        approval = previous;
      } else {
        const sourceLabel = path.basename(candidate.canonicalSource, '.md').replace(/[-_]+/g, ' ').slice(0, 160);
        const preview = `Goal: ${candidate.objective}\nSource: ${sourceLabel} (${candidate.canonicalSource}) @ ${candidate.referenceVersion}\n` +
          `${estimate.totalSoftTokens.toLocaleString('en-US')} soft tokens total (input/output/reasoning/cache; no hard output cap); ` +
          `${estimate.workerWallSeconds} seconds per worker; ${estimate.outerTurns} checked outer turns.\n` +
          `Expiry allowance: ${estimate.expirySeconds} seconds from proposal, absolute deadline ${candidate.expiresAt}; approval does not extend it.\n` +
          `Estimate rationale: ${estimate.rationale}`;
        approval = getDb().transaction(() => {
          if (!resolved.isCurrent!() || JSON.stringify(this.dependencies.conversations.boundedWorkflowSelection(auth, binding, candidate.goalId)) !== JSON.stringify(current)) {
            throw new Error('proposal scope changed');
          }
          const created = approvals.create({ sessionId: binding.sessionId, agentConfigId: current.profileId,
            action: 'Approve finite Coding Workflow', preview,
            consequence: 'One selected-reference workflow using the existing manager and distinct reviewer, with two server-checked criteria and a checked stop. No new tools, permissions, workspace or schedule are granted.',
            securityAction: WORKFLOW_APPROVAL_ACTION, payloadDigest: workflowProposalDigest(candidate),
            boundAgent: current.profileId, expiresAt: candidate.expiresAt, boundPayloadJson: JSON.stringify(candidate) });
          getDb().prepare(`UPDATE agent_approvals SET status='rejected', actor='system:workflow_superseded',
            decided_at=?, decision_nonce=NULL, continuation_state=NULL WHERE session_id=? AND security_action=?
            AND status='pending' AND id<>? AND json_extract(bound_payload_json,'$.goalId')=?`)
            .run(now.toISOString(),binding.sessionId,WORKFLOW_APPROVAL_ACTION,created.id,candidate.goalId);
          return created;
        })();
      }
      return { schemaVersion: 1 as const, status: 'approval_pending' as const,
        text: `${approval.preview}\nApproval is pending in this same chat. Wait for the signed human decision; prose is not consent.\napproval_id: ${approval.id}\nproposal_digest: ${approval.payloadDigest}` };
    } catch { return held(); }
  }

  async startWorkflow(auth: AuthContext | undefined, body: unknown) {
    const held = () => ({ schemaVersion: 1 as const, status: 'held' as const, text: 'Bounded Coding Workflow start is held; no additional ordinal is authorized.' });
    try {
      const envelope = trustedEnvelope(body);
      if (!auth || !envelope) return held();
      const verified = await this.verify(envelope, 'rhythm_start_bounded_coding_workflow', Date.now(), 'coordinator_workflow_start');
      const a = verified.arguments;
      if (Object.keys(a).length !== 2 || typeof a.approval_id !== 'string' || a.approval_id.length > 256 ||
          typeof a.proposal_digest !== 'string' || !/^[a-f0-9]{64}$/.test(a.proposal_digest)) return held();
      if (!(await this.dependencies.conversations.boundedWorkflowRuntimeReady())) return held();
      const binding = await this.authority.resolveWorkflowApprovalResume(auth, verified, a.approval_id, a.proposal_digest);
      if (!binding) return held();
      const p = binding.proposal;
      const selection = this.dependencies.conversations.boundedWorkflowSelection(auth, binding, p.goalId, binding.linkedWorkstreamId);
      if (!selection || selection.scopeFingerprint !== p.scopeFingerprint || selection.profileRevision !== p.profileRevision) return held();
      const commandKey = `chat-workflow:${p.proposalId}`;
      const result = await this.dependencies.conversations.preparePlan(auth, {
        sessionId: p.sessionId, projectId: p.projectId, expectedControlRevision: p.controlRevision + (binding.linkedWorkstreamId ? 1 : 0), goalId: p.goalId,
        admission: { commandKey, totalTokenAuthorization: p.estimate.totalSoftTokens, maxTurns: p.estimate.outerTurns,
          maxWallTimeSeconds: p.estimate.workerWallSeconds, expiresInSeconds: p.estimate.expirySeconds,
          acknowledgesSoftTotalTokenAuthorization: true, acknowledgesCodingWorkflowCoverage: true, purpose: 'workflow',
          workflowCheck: { kind: 'selected_reference_summary_v1', sourceId: p.referenceSourceId, expectedVersion: p.referenceVersion } },
      }, {
        expiresAt: p.expiresAt,
        reprove: async ({ workstreamId, resolved }) => {
          if (!(await this.dependencies.conversations.boundedWorkflowRuntimeReady())) return null;
          const next = await this.authority.resolveWorkflowApprovalResume(auth, verified, binding.approvalId, binding.proposalDigest, workstreamId);
          if (!next || next.sdkUserMessageId !== binding.sdkUserMessageId || !resolved.isCurrent ||
              resolved.selector !== p.referenceSourceId || resolved.receipt.canonicalId !== p.canonicalSource ||
              resolved.receipt.observedVersion !== p.referenceVersion || resolved.receipt.sourceInstance !== p.sourceInstance) return null;
          return () => {
            const live = workflowApprovalResumeCandidate(binding.approvalId, this.dependencies.records, { linkedWorkstreamId: workstreamId });
            const selected = this.dependencies.conversations.boundedWorkflowSelection(auth, binding, p.goalId, workstreamId);
            if (!live || live.proposalDigest !== binding.proposalDigest || !selected || selected.scopeFingerprint !== p.scopeFingerprint ||
                selected.profileRevision !== p.profileRevision || !resolved.isCurrent!()) return false;
            if (!workflowResumeDispatchCurrent(binding)) return false;
            const consumedAt = new Date().toISOString();
            return getDb().prepare(`UPDATE agent_approvals SET consumed_at=? WHERE id=? AND status='approved' AND actor=?
              AND security_action=? AND payload_digest=? AND bound_payload_json=? AND consumed_at IS NULL AND decision_nonce IS NULL AND expires_at>?`)
              .run(consumedAt,binding.approvalId,`user:${p.ownerUserId}`,WORKFLOW_APPROVAL_ACTION,binding.proposalDigest,JSON.stringify(p),consumedAt).changes === 1;
          };
        },
      });
      return result.kind === 'planned' ? { schemaVersion: 1 as const, status: 'started' as const,
        text: 'Exact approved finite Coding Workflow dispatched. Only selected_reference_current and reviewed_summary_with_citation are server-checked; await those checks and the checked stop.' } : held();
    } catch { return held(); }
  }

  async status(auth: AuthContext | undefined, body: unknown): Promise<CoordinatorAgentToolStatusResponse> {
    try {
      const envelope = trustedEnvelope(body);
      if (!auth || !envelope) return unavailable();
      const verified = await this.verify(envelope, TOOL_NAME, Date.now(), 'coordinator_agent_status');
      if (Object.keys(verified.arguments).length !== 0) return unavailable();
      const binding = await this.authority.resolve(auth, verified, TOOL_NAME);
      if (!binding) return unavailable();
      const result = await this.dependencies.conversations.modelStatus(auth, {
        sessionId: binding.sessionId,
        projectId: binding.projectId,
        sdkSessionId: binding.sdkSessionId,
        bindingCurrent: () => this.authority.isCurrent(binding, auth, verified, TOOL_NAME),
      });
      if (result.kind !== 'available' || Buffer.byteLength(result.text, 'utf8') > 3_800) return unavailable();
      // The status service checked this after context assembly; retain final
      // native-tool and actor/project/root reads immediately before response.
      // A project revoke between the earlier context read and this response is
      // non-disclosing even when the active SDK tool itself is unchanged.
      if (!(await this.authority.isCurrent(binding, auth, verified, TOOL_NAME))) return unavailable();
      if (!this.dependencies.conversations.modelStatusScopeCurrent(auth, binding)) return unavailable();
      // Final synchronous render AFTER this wrapper's last await: an optional
      // source that changed during it loses only its own observations.
      const text = result.finalize ? result.finalize() : result.text;
      return Buffer.byteLength(text, 'utf8') <= 3_800
        ? { schemaVersion: 1, status: 'available', text }
        : unavailable();
    } catch {
      return unavailable();
    }
  }

  /**
   * Model-facing action control. The signed active foreground call can name
   * only an existing goal; all actual delegation inputs remain server-owned.
   * A callback turn is intentionally status-only and cannot recursively start
   * more work after a child returns.
   */
  async startGoal(auth: AuthContext | undefined, body: unknown): Promise<CoordinatorAgentToolGoalResponse> {
    try {
      const envelope = trustedEnvelope(body);
      if (!auth || !envelope) return goalUnavailable();
      const verified = await this.verify(envelope, GOAL_TOOL_NAME, Date.now(), 'coordinator_agent_goal');
      const requested = goalFromArguments(verified.arguments);
      if (!requested) return goalUnavailable();
      const { goalId, approvalId } = requested;
      // Foreground first. Only a call that carries a (signed) approval id may
      // instead qualify as the exact approved-goal retry turn.
      const binding: CoordinatorMcpDispatchBinding | null =
        (await this.authority.resolveForeground(auth, verified, GOAL_TOOL_NAME)) ??
        (approvalId === undefined
          ? null
          : await this.authority.resolveGoalApprovalResume(
            auth, verified, GOAL_TOOL_NAME, { approvalId, goalId },
            (scope) => goalActionCommandKey(auth, scope, verified, goalId, approvalId),
          ));
      if (!binding) return goalUnavailable();
      const commandKey = goalActionCommandKey(auth, binding, verified, goalId, approvalId);
      const bindingCurrent = () =>
        this.authority.isCurrent(binding, auth, verified, GOAL_TOOL_NAME, { receiptCommandKey: commandKey });
      const result = await this.dependencies.conversations.startCodingWorkflow(auth, {
        sessionId: binding.sessionId,
        projectId: binding.projectId,
        sdkSessionId: binding.sdkSessionId,
        goalId,
        commandKey,
        bindingCurrent,
        // Runs inside the goal reservation's SQLite transaction, only after the
        // native binding and root were re-proved above: the token is consumed
        // with the reservation or not at all.
        authorize: () => {
          this.security.consumeCoordinatorGoalApproval({
            context: verified.context,
            signedArguments: verified.arguments,
          });
        },
      });
      if (!(await bindingCurrent())) return goalUnavailable();
      if (!this.dependencies.conversations.modelStatusScopeCurrent(auth, binding)) return goalUnavailable();
      return result.kind === 'delegation_started'
        ? goalStarted()
        : result.kind === 'approval_required'
          ? goalApprovalRequired(goalId)
          : result.kind === 'delegation_held'
            ? goalHeld()
            : goalUnavailable();
    } catch {
      return goalUnavailable();
    }
  }
}
