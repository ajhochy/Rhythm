import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

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
      return this.dependencies.conversations.modelStatusScopeCurrent(auth, binding)
        ? { schemaVersion: 1, status: 'available', text: result.text }
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
