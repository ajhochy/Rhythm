import type { DayflowQualifiedEvidenceCandidate } from '../contracts/dayflow_coordinator_reader_contract';
import type { AuthContext } from '../middleware/auth_middleware';
import {
  DayflowReceivingContextRepository,
  type DayflowContextUnsafeCode,
  type DayflowReceivingBinding,
} from '../repositories/dayflow_receiving_context_repository';
import type { VerifiedTrustedMcpCall } from '../security/trusted_mcp_call';
import type {
  DayflowGuardEnrollment,
  DayflowReceivingContext,
  DayflowReceivingContextAuthority,
} from './dayflow_qualified_evidence_service';
import type { ManagedActiveToolCall, OpencodeClientService } from './opencode_client_service';

function activeMatches(active: ManagedActiveToolCall, verified: VerifiedTrustedMcpCall, expectedToolName: string): boolean {
  return active.sdkSessionId === verified.context.sdkSessionId &&
    active.assistantId === verified.context.turnId && active.toolCallId === verified.context.toolCallId &&
    active.agentName === verified.context.agentName && active.toolName === expectedToolName;
}

function asContext(binding: DayflowReceivingBinding, verified: VerifiedTrustedMcpCall, toolName: string): DayflowReceivingContext {
  return { dispatchId: binding.dispatchId, ownerUserId: binding.ownerUserId, projectId: binding.projectId,
    sdkSessionId: binding.sdkSessionId, sdkUserMessageId: binding.sdkUserMessageId, turnId: verified.context.turnId,
    toolCallId: verified.context.toolCallId, toolName };
}

function bindingFor(context: DayflowReceivingContext): DayflowReceivingBinding | null {
  if (!context.dispatchId || !context.sdkUserMessageId) return null;
  return {
    dispatchId: context.dispatchId,
    ownerUserId: context.ownerUserId,
    projectId: context.projectId,
    sdkSessionId: context.sdkSessionId,
    sdkTurnId: context.turnId,
    sdkUserMessageId: context.sdkUserMessageId,
  };
}

/**
 * The one shared enrollment seam. It enrolls an SDK in the owned engine's
 * monotonic guard record through the frozen `rhythm-dayflow-guard` route, using
 * the session's own server-owned directory. It authorizes no source read and no
 * provider exposure by itself; it only makes native refuse to forget the SDK.
 */
export class DayflowGuardEnrollmentService implements DayflowGuardEnrollment {
  constructor(private readonly dependencies: {
    engine: Pick<OpencodeClientService, 'enrollDayflowGuard'>;
    records: Pick<DayflowReceivingContextRepository, 'providerSessionScope'>;
  }) {}

  async ensure(input: { sdkSessionId: string }): Promise<boolean> {
    try {
      const scope = this.dependencies.records.providerSessionScope(input.sdkSessionId);
      if (!scope) return false;
      const enrolled = await this.dependencies.engine.enrollDayflowGuard(input.sdkSessionId, scope.directory);
      return enrolled !== null;
    } catch {
      return false;
    }
  }
}

/** Requires a live signed engine tool plus a server-authenticated dispatch. */
export class DayflowReceivingContextAuthorityService implements DayflowReceivingContextAuthority {
  constructor(private readonly dependencies: {
    engine: Pick<OpencodeClientService, 'getCurrentTrustedMcpToolCall'>;
    records: DayflowReceivingContextRepository;
  }) {}

  async resolve(auth: AuthContext, verified: VerifiedTrustedMcpCall, expectedToolName: string): Promise<DayflowReceivingContext | null> {
    // The engine exposes active tools per working directory. Resolve the
    // durable, server-owned root session first; querying without its directory
    // can silently inspect another project when SDK ids overlap.
    const session = this.dependencies.records.activeSessionScope(verified.context.sdkSessionId);
    if (!session || session.ownerUserId !== auth.user.id) return null;
    const active = await this.dependencies.engine.getCurrentTrustedMcpToolCall(
      verified.context.sdkSessionId, verified.context.turnId, verified.context.toolCallId, session.directory,
    );
    if (!active || !activeMatches(active, verified, expectedToolName)) return null;
    const binding = this.dependencies.records.findByActiveTool({
      ownerUserId: auth.user.id,
      sdkSessionId: verified.context.sdkSessionId,
      sdkTurnId: verified.context.turnId,
      sdkUserMessageId: active.userMessageId,
    });
    return binding ? asContext(binding, verified, expectedToolName) : null;
  }

  async isCurrent(context: DayflowReceivingContext, auth: AuthContext, verified: VerifiedTrustedMcpCall, expectedToolName: string): Promise<boolean> {
    const next = await this.resolve(auth, verified, expectedToolName);
    return !!next && next.dispatchId === context.dispatchId && next.ownerUserId === context.ownerUserId &&
      next.projectId === context.projectId && next.sdkSessionId === context.sdkSessionId &&
      next.turnId === context.turnId && next.toolCallId === context.toolCallId && next.toolName === context.toolName;
  }

  async isCurrentWithDependencies(
    context: DayflowReceivingContext,
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
    expected: readonly DayflowQualifiedEvidenceCandidate[],
  ): Promise<boolean> {
    // Resolve performs the live engine/tool check first. Its return value is
    // then joined synchronously with the exact durable route-authenticated
    // dispatch/session/turn and persisted manifest before this promise
    // resolves; the caller follows it only with a synchronous source proof.
    const next = await this.resolve(auth, verified, expectedToolName);
    if (!next || next.dispatchId !== context.dispatchId || next.ownerUserId !== context.ownerUserId ||
        next.projectId !== context.projectId || next.sdkSessionId !== context.sdkSessionId ||
        next.turnId !== context.turnId || next.toolCallId !== context.toolCallId || next.toolName !== context.toolName) return false;
    const binding = bindingFor(next);
    return !!binding && this.dependencies.records.finalAdmissionCurrent(binding, expected);
  }

  finalAdmissionCurrent(
    context: DayflowReceivingContext,
    expected: readonly DayflowQualifiedEvidenceCandidate[],
  ): boolean {
    // This is deliberately only the synchronous durable half of final
    // response admission. read() pairs it with the preceding live engine
    // current-tool check, rather than treating local history as a lease.
    const binding = bindingFor(context);
    return !!binding && this.dependencies.records.finalAdmissionCurrent(binding, expected);
  }

  async appendDependencies(context: DayflowReceivingContext, references: DayflowQualifiedEvidenceCandidate[]): Promise<boolean> {
    if (!context.dispatchId) return false;
    return this.dependencies.records.append({
      dispatchId: context.dispatchId, ownerUserId: context.ownerUserId, projectId: context.projectId,
      sdkSessionId: context.sdkSessionId, sdkTurnId: context.turnId,
      // append re-reads the durable user-message binding, so this transient
      // context cannot fabricate a dispatch association.
      sdkUserMessageId: '',
    }, references);
  }

  async markUnsafe(context: DayflowReceivingContext, reason: 'dayflow_dependency_persistence_failure' | 'dayflow_receiving_context_changed'): Promise<boolean> {
    if (!context.dispatchId) return false;
    return this.dependencies.records.markUnsafe({ dispatchId: context.dispatchId }, reason as DayflowContextUnsafeCode);
  }
}
