import { workflowApprovalResumeCandidate, workflowResumeDispatchCurrent, type WorkflowApprovalResumeCandidate } from './chat_bounded_workflow';
import type { AuthContext } from '../middleware/auth_middleware';
import {
  CoordinatorConversationsRepository,
  type CoordinatorDelegationCallbackMcpDispatchBinding,
  type CoordinatorForegroundMcpDispatchBinding,
  type CoordinatorGoalApprovalResumeMcpDispatchBinding,
  type CoordinatorMcpDispatchBinding,
} from '../repositories/coordinator_conversations_repository';
import type { VerifiedTrustedMcpCall } from '../security/trusted_mcp_call';
import type { ManagedActiveToolCall, OpencodeClientService } from './opencode_client_service';

function sameBinding(
  left: CoordinatorMcpDispatchBinding,
  right: CoordinatorMcpDispatchBinding,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'delegation_callback' && right.kind === 'delegation_callback' && (
    left.goalId !== right.goalId || left.delegationId !== right.delegationId ||
    left.childSessionId !== right.childSessionId || left.callbackReasonCode !== right.callbackReasonCode
  )) return false;
  if (left.kind === 'goal_approval_resume' && right.kind === 'goal_approval_resume' && (
    left.goalId !== right.goalId || left.approvalId !== right.approvalId || left.reasonCode !== right.reasonCode
  )) return false;
  return left.ownerUserId === right.ownerUserId &&
    left.sessionId === right.sessionId && left.projectId === right.projectId &&
    left.sdkSessionId === right.sdkSessionId && left.sdkUserMessageId === right.sdkUserMessageId &&
    left.cwd === right.cwd;
}

function activeMatches(
  active: ManagedActiveToolCall,
  verified: VerifiedTrustedMcpCall,
  expectedToolName: string,
): boolean {
  return active.sdkSessionId === verified.context.sdkSessionId &&
    active.assistantId === verified.context.turnId &&
    active.toolCallId === verified.context.toolCallId &&
    active.agentName === verified.context.agentName &&
    active.serverName === 'rhythm' && active.toolName === expectedToolName;
}

/**
 * Binds one signed MCP call to the current active native tool and to the exact
 * accepted C2 foreground dispatch that created its real user message.  It is
 * deliberately read-only and cannot discover a root from a browser/model id.
 */
export class CoordinatorForegroundMcpAuthority {
  constructor(private readonly dependencies: {
    engine: Pick<OpencodeClientService, 'getCurrentTrustedMcpToolCall'>;
    records: CoordinatorConversationsRepository;
  }) {}

  async resolveForeground(
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
  ): Promise<CoordinatorForegroundMcpDispatchBinding | null> {
    const initial = this.dependencies.records.findForegroundMcpSessionScope({
      ownerUserId: auth.user.id,
      sdkSessionId: verified.context.sdkSessionId,
    });
    if (!initial) return null;
    const active = await this.dependencies.engine.getCurrentTrustedMcpToolCall(
      verified.context.sdkSessionId,
      verified.context.turnId,
      verified.context.toolCallId,
      initial.cwd,
    );
    if (!active || !activeMatches(active, verified, expectedToolName)) return null;
    const bound = this.dependencies.records.findForegroundMcpDispatch({
      ...initial,
      sdkUserMessageId: active.userMessageId,
    });
    if (!bound) return null;
    // Both the engine inspection and the dispatch lookup are boundaries.  A
    // root/profile/project change that lands while they await must withhold
    // the status projection rather than disclose the earlier scope.
    const reread = this.dependencies.records.findForegroundMcpDispatch(bound);
    return reread && sameBinding(bound, reread) ? reread : null;
  }

  /**
   * The only admitted post-child turn is an internal completion carrying the
   * exact C2 marker emitted by AsyncDelegationCompletionService. An ordinary
   * SDK session, a generic completion, or a mixed wake remains unavailable.
   */
  async resolveDelegationCallback(
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
  ): Promise<CoordinatorDelegationCallbackMcpDispatchBinding | null> {
    const initial = this.dependencies.records.findForegroundMcpSessionScope({
      ownerUserId: auth.user.id,
      sdkSessionId: verified.context.sdkSessionId,
    });
    if (!initial) return null;
    const active = await this.dependencies.engine.getCurrentTrustedMcpToolCall(
      verified.context.sdkSessionId,
      verified.context.turnId,
      verified.context.toolCallId,
      initial.cwd,
    );
    if (!active || !activeMatches(active, verified, expectedToolName)) return null;
    const bound = this.dependencies.records.findDelegationCallbackMcpDispatch({
      ...initial,
      sdkUserMessageId: active.userMessageId,
    });
    if (!bound) return null;
    const reread = this.dependencies.records.findDelegationCallbackMcpDispatch(bound);
    return reread && sameBinding(bound, reread) ? reread : null;
  }

  /**
   * The exact approved-goal retry turn: the active signed native tool's user
   * message must be the one accepted approval-continuation dispatch whose
   * strict reason code names THIS (signed) approval id and goal id, and the
   * approval decision/action/digest/taint/expiry, the goal and the current
   * primary root are all re-proved by the repository. Distinct from foreground
   * (never route-authenticated) and from the status-only child callback.
   * `receiptCommandKey` is supplied only after the coupled transaction
   * consumed the token, and then admits that one consumption only.
   */
  async resolveGoalApprovalResume(
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
    approval: { approvalId: string; goalId: string },
    /**
     * A key, or a function deriving it from the resolved native user message
     * (the key cannot exist before the active message is known). Only the
     * coupled transaction's own command key admits an already-consumed token,
     * which makes a same-call replay find its own receipt.
     */
    receipt?: string | ((scope: {
      sessionId: string; projectId: string; sdkSessionId: string; sdkUserMessageId: string;
    }) => string),
  ): Promise<CoordinatorGoalApprovalResumeMcpDispatchBinding | null> {
    const initial = this.dependencies.records.findForegroundMcpSessionScope({
      ownerUserId: auth.user.id,
      sdkSessionId: verified.context.sdkSessionId,
    });
    if (!initial) return null;
    const active = await this.dependencies.engine.getCurrentTrustedMcpToolCall(
      verified.context.sdkSessionId,
      verified.context.turnId,
      verified.context.toolCallId,
      initial.cwd,
    );
    if (!active || !activeMatches(active, verified, expectedToolName)) return null;
    const receiptCommandKey = typeof receipt === 'function'
      ? receipt({ ...initial, sdkUserMessageId: active.userMessageId })
      : receipt;
    const lookup = {
      ...initial,
      sdkUserMessageId: active.userMessageId,
      approvalId: approval.approvalId,
      goalId: approval.goalId,
      agentName: verified.context.agentName,
      receiptCommandKey,
    };
    const bound = this.dependencies.records.findGoalApprovalResumeMcpDispatch(lookup);
    if (!bound) return null;
    // The engine inspection and the repository proof are both boundaries.
    const reread = this.dependencies.records.findGoalApprovalResumeMcpDispatch({ ...lookup, ...bound });
    return reread && sameBinding(bound, reread) ? reread as CoordinatorGoalApprovalResumeMcpDispatchBinding : null;
  }

  /** Dedicated exact finite-proposal wake; never admitted by generic status/goal resolution. */
  async resolveWorkflowApprovalResume(auth: AuthContext, verified: VerifiedTrustedMcpCall,
    approvalId: string, digest: string, linkedWorkstreamId?: string): Promise<(WorkflowApprovalResumeCandidate & { sdkUserMessageId: string }) | null> {
    const initial = workflowApprovalResumeCandidate(approvalId, this.dependencies.records, { linkedWorkstreamId });
    if (!initial || initial.ownerUserId !== auth.user.id || initial.proposalDigest !== digest ||
        initial.sdkSessionId !== verified.context.sdkSessionId || initial.proposal.profileId !== verified.context.agentName) return null;
    const active = await this.dependencies.engine.getCurrentTrustedMcpToolCall(
      verified.context.sdkSessionId, verified.context.turnId, verified.context.toolCallId, initial.cwd);
    if (!active || !activeMatches(active, verified, 'rhythm_start_bounded_coding_workflow')) return null;
    const current = workflowApprovalResumeCandidate(approvalId, this.dependencies.records, { linkedWorkstreamId });
    if (!current || JSON.stringify(current) !== JSON.stringify(initial)) return null;
    return workflowResumeDispatchCurrent({ ...current, sdkUserMessageId: active.userMessageId })
      ? { ...current, sdkUserMessageId: active.userMessageId } : null;
  }

  async resolve(
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
  ): Promise<CoordinatorMcpDispatchBinding | null> {
    // Status stays foreground or child-callback only; the goal-resume kind is
    // action-bound and reachable solely through resolveGoalApprovalResume.
    return (await this.resolveForeground(auth, verified, expectedToolName)) ??
      this.resolveDelegationCallback(auth, verified, expectedToolName);
  }

  async isCurrent(
    binding: CoordinatorMcpDispatchBinding,
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
    options: { receiptCommandKey?: string } = {},
  ): Promise<boolean> {
    const next = binding.kind === 'foreground'
      ? await this.resolveForeground(auth, verified, expectedToolName)
      : binding.kind === 'goal_approval_resume'
        ? await this.resolveGoalApprovalResume(
          auth, verified, expectedToolName,
          { approvalId: binding.approvalId, goalId: binding.goalId }, options.receiptCommandKey,
        )
        : await this.resolveDelegationCallback(auth, verified, expectedToolName);
    return !!next && sameBinding(binding, next);
  }
}
