import type { AuthContext } from '../middleware/auth_middleware';
import {
  CoordinatorConversationsRepository,
  type CoordinatorDelegationCallbackMcpDispatchBinding,
  type CoordinatorForegroundMcpDispatchBinding,
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

  async resolve(
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
  ): Promise<CoordinatorMcpDispatchBinding | null> {
    return (await this.resolveForeground(auth, verified, expectedToolName)) ??
      this.resolveDelegationCallback(auth, verified, expectedToolName);
  }

  async isCurrent(
    binding: CoordinatorMcpDispatchBinding,
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
  ): Promise<boolean> {
    const next = binding.kind === 'foreground'
      ? await this.resolveForeground(auth, verified, expectedToolName)
      : await this.resolveDelegationCallback(auth, verified, expectedToolName);
    return !!next && sameBinding(binding, next);
  }
}
