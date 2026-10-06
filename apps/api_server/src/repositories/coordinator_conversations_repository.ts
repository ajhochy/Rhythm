import { createHash, randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import type Database from 'better-sqlite3';

import {
  COORDINATOR_CONVERSATION_SCHEMA_VERSION,
  MAX_COORDINATOR_CONVERSATION_AUTHORIZATIONS,
  MAX_COORDINATOR_CONVERSATION_COMMANDS,
  MAX_COORDINATOR_CONVERSATION_GOALS,
  parseStoredCoordinatorConversation,
  type CoordinatorConversation,
  type CoordinatorConversationCommand,
  type CoordinatorConversationContinuationAuthority,
  type CoordinatorConversationGoal,
} from '../contracts/coordinator_conversation_contract';
import { COORDINATOR_CONVERSATION_COLUMN } from '../database/coordinator_conversation_schema';
import { getDb } from '../database/db';
import { canonicalize } from '../utils/path_containment';
import { encodeCoordinatorCallbackMarker, parseCoordinatorCallbackMarker } from '../contracts/coordinator_callback_marker';
import { appendRelayUpsert } from './relay_outbox_repository';
import { publishCoordinatorChanged, type CoordinatorChangedScope } from '../services/opencode_event_hub';
import { securityPayloadDigest } from '../services/external_content_security_service';

export interface CoordinatorConversationScope {
  ownerUserId: number;
  projectId: string;
  sessionId: string;
}

export type CoordinatorConversationRead =
  | { kind: 'found'; conversation: CoordinatorConversation }
  | { kind: 'not_found' }
  | { kind: 'schema_unavailable' }
  | { kind: 'integrity_hold' };

export type CoordinatorConversationOpen =
  | { kind: 'created'; conversation: CoordinatorConversation }
  | { kind: 'replay'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

export type CoordinatorConversationGoalWrite =
  | { kind: 'created'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'replay'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | { kind: 'goal_limit'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

export type CoordinatorConversationAuthorityWrite =
  | { kind: 'updated'; conversation: CoordinatorConversation }
  | { kind: 'replay'; conversation: CoordinatorConversation }
  | { kind: 'authority_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/** A transcript-backed, zero-inference user control. */
export type CoordinatorConversationStatusControlWrite =
  | { kind: 'stored'; conversation: CoordinatorConversation; messageId: number }
  | { kind: 'replay'; conversation: CoordinatorConversation; messageId: number }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | { kind: 'command_limit'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/** A transport reservation whose real user/assistant events stay SDK-owned. */
export type CoordinatorConversationForegroundWrite =
  | { kind: 'reserved'; conversation: CoordinatorConversation }
  | { kind: 'accepted_replay'; conversation: CoordinatorConversation }
  | { kind: 'uncertain'; conversation: CoordinatorConversation }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | { kind: 'command_limit'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

export type CoordinatorConversationForegroundSettle =
  | { kind: 'accepted'; conversation: CoordinatorConversation }
  | { kind: 'uncertain'; conversation: CoordinatorConversation }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/**
 * One server-owned Coding Workflow action is reserved before the existing
 * delegation service can create a child. A reserved command is never replayed
 * because a process could have crossed the child-creation boundary already.
 */
export type CoordinatorConversationGoalDelegationReservation =
  | { kind: 'reserved'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'dispatched_replay'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal; delegationId: string; childSessionId: string }
  | { kind: 'uncertain'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'goal_delegation_conflict'; conversation: CoordinatorConversation }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | { kind: 'command_limit'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

export type CoordinatorConversationGoalDelegationSettle =
  | { kind: 'dispatched'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'dispatched_replay'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'uncertain'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'goal_delegation_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/**
 * Narrow server-only binding for a signed tool call made while an ordinary
 * C2 foreground turn is active.  It deliberately carries identifiers and the
 * server-owned directory only: no user/assistant history or prompt body is
 * read through this path.
 */
export interface CoordinatorForegroundMcpSessionScope {
  ownerUserId: number;
  sessionId: string;
  projectId: string;
  sdkSessionId: string;
  cwd: string;
}

export interface CoordinatorForegroundMcpDispatchBinding extends CoordinatorForegroundMcpSessionScope {
  kind: 'foreground';
  sdkUserMessageId: string;
}

/** A one-delegation completion wake whose dispatch was explicitly marked C2. */
export interface CoordinatorDelegationCallbackMcpDispatchBinding extends CoordinatorForegroundMcpSessionScope {
  kind: 'delegation_callback';
  sdkUserMessageId: string;
  goalId: string;
  delegationId: string;
  childSessionId: string;
  callbackReasonCode: string;
}

/**
 * The one approved-goal retry wake: an accepted approval-continuation dispatch
 * whose strict reason code names exactly this approval and goal. It is action
 * bound (one `delegation.start-async` goal action), never foreground authority
 * and never the status-only child callback.
 */
export interface CoordinatorGoalApprovalResumeMcpDispatchBinding extends CoordinatorForegroundMcpSessionScope {
  kind: 'goal_approval_resume';
  sdkUserMessageId: string;
  goalId: string;
  approvalId: string;
  reasonCode: string;
}

export type CoordinatorMcpDispatchBinding =
  | CoordinatorForegroundMcpDispatchBinding
  | CoordinatorDelegationCallbackMcpDispatchBinding
  | CoordinatorGoalApprovalResumeMcpDispatchBinding;

/** Exactly-qualified approval wake input for the producer (identities only; no objective body). */
export interface CoordinatorGoalApprovalResumeCandidate extends CoordinatorForegroundMcpSessionScope {
  approvalId: string;
  goalId: string;
  reasonCode: string;
  /** Opaque, bounded; recomputed from current rows to prove nothing changed. */
  fingerprint: string;
}

/** Row fields of an approval the qualification needs (a plain snapshot, never trusted alone). */
export interface CoordinatorGoalApprovalSnapshot {
  id: string;
  sessionId: string | null;
}

/**
 * Strict, legal-shape reason code for the approval wake of one goal approval.
 * It matches the provenance repository's existing `^[a-z][a-z0-9_]{0,63}$`
 * allowlist (53 chars), so no marker parser or schema change is needed; the
 * hash binds the approval id, goal id and the goal's CURRENT revision without
 * embedding any of them, so a goal that changed after the wake no longer
 * matches the accepted dispatch.
 */
export function goalApprovalResumeReasonCode(approvalId: string, goalId: string, goalRevision: number): string {
  return `goal_approval_resume_${createHash('sha256')
    .update(`${approvalId}\n${goalId}\n${goalRevision}`).digest('hex').slice(0, 32)}`;
}

class GoalAuthorizationRefused extends Error {
  constructor(readonly refusal: unknown) {
    super('coordinator goal authorization refused');
  }
}

/** A durable conversation goal may bind exactly one server-created workstream. */
export type CoordinatorConversationGoalLinkWrite =
  | { kind: 'updated'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'replay'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'goal_link_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/**
 * A dedicated owner root is created exactly once. `createSession` is the
 * existing metadata-only session insert, invoked inside this repository's
 * SQLite transaction; it must not call an engine/SDK boundary or await.
 */
export type CoordinatorConversationPrimaryRootWrite =
  | { kind: 'created'; conversation: CoordinatorConversation }
  | { kind: 'replay'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

type SessionRow = {
  id: string;
  owner_user_id: number;
  project_id: string;
  coordinator_conversation_json: string | null;
};

type ForegroundSessionScopeRow = SessionRow & {
  sdk_session_id: string | null;
  cwd: string | null;
  parent_session_id: string | null;
  is_system: number;
  category: string;
  archived_at: string | null;
};

/**
 * Internal scheduler inventory only. It deliberately returns parsed durable
 * controls rather than JSON bytes, and never creates a root/session/job.
 */
export interface CoordinatorConversationFiniteReconciliationPage {
  items: CoordinatorConversation[];
  nextCursor: string | null;
}

const MAX_PRIMARY_ROOT_SCAN = 500;
const MAX_GOAL_OUTCOMES = 64;

/**
 * Execution outcome of one dispatched goal's existing delegated child. It is
 * NOT goal verification: `returned_result_unverified` only means the child
 * returned without an error, and `unknown` means the link could not be proven.
 */
export interface CoordinatorGoalDelegationOutcome {
  goalId: string;
  delegationId: string | null;
  childSessionId: string | null;
  outcome: 'running' | 'returned_result_unverified' | 'failed' | 'cancelled' | 'unknown';
  terminalAt: string | null;
}
const MCP_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/;

function nowIso(clock: () => Date): string {
  return clock().toISOString();
}

function intentHash(objective: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'add_goal', objective }))
    .digest('hex');
}

function controlIntentHash(kind: 'status' | 'foreground', message: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind, message }))
    .digest('hex');
}

function goalDelegationIntentHash(input: {
  goalId: string;
  parentSdkSessionId: string;
  targetAgentConfigId: 'workflow-orchestrator';
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'delegate_goal', ...input }))
    .digest('hex');
}

class ConversationCommandRace extends Error {}
class ConversationTranscriptUnavailable extends Error {}

function parseRow(row: SessionRow): CoordinatorConversationRead {
  if (row.coordinator_conversation_json === null) return { kind: 'not_found' };
  try {
    const conversation = parseStoredCoordinatorConversation(JSON.parse(row.coordinator_conversation_json));
    if (
      conversation.sessionId !== row.id ||
      conversation.ownerUserId !== row.owner_user_id ||
      conversation.projectId !== row.project_id
    ) {
      return { kind: 'integrity_hold' };
    }
    return { kind: 'found', conversation };
  } catch {
    return { kind: 'integrity_hold' };
  }
}

function isValidAuthorityFor(
  conversation: CoordinatorConversation,
  authority: CoordinatorConversationContinuationAuthority,
): boolean {
  try {
    parseStoredCoordinatorConversation({ ...conversation, continuations: [authority] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Durable, exact-session binding for C1/C2. Literal/status user controls are
 * inserted as ordinary local `agent_session_messages` input rows in the same
 * SQLite transaction as their metadata CAS. The repository never invents an
 * SDK id, assistant event, workstream/job/permission, or engine history read.
 * Its SQL is local SQLite only until the C2/C3 owners explicitly provide a
 * dual-DB migration/relay contract.
 */
export class CoordinatorConversationsRepository {
  constructor(
    private readonly db: Database.Database = getDb(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Resolve only the current dedicated root which owns an SDK session.  This
   * is an authority lookup for a signed active-tool proof, not an SDK history
   * lookup and not a way to discover an ordinary chat by caller input.
   */
  findForegroundMcpSessionScope(input: {
    ownerUserId: number;
    sdkSessionId: string;
  }): CoordinatorForegroundMcpSessionScope | null {
    if (
      !Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0 ||
      !MCP_IDENTIFIER.test(input.sdkSessionId)
    ) return null;
    try {
      const rows = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN},
          sdk_session_id, cwd, parent_session_id, is_system, category, archived_at
        FROM agent_sessions
        WHERE owner_user_id=? AND sdk_session_id=?
          AND parent_session_id IS NULL AND is_system=0 AND category='chat'
          AND archived_at IS NULL
        LIMIT 2`).all(input.ownerUserId, input.sdkSessionId) as ForegroundSessionScopeRow[];
      if (rows.length !== 1) return null;
      const row = rows[0];
      const parsed = parseRow(row);
      if (
        parsed.kind !== 'found' || !parsed.conversation.primaryOwnerRoot ||
        row.sdk_session_id !== input.sdkSessionId || typeof row.cwd !== 'string' ||
        row.cwd.length === 0 || row.cwd.length > 4_096 ||
        row.parent_session_id !== null || row.is_system !== 0 || row.category !== 'chat' ||
        row.archived_at !== null
      ) return null;
      return {
        ownerUserId: parsed.conversation.ownerUserId,
        sessionId: parsed.conversation.sessionId,
        projectId: parsed.conversation.projectId,
        sdkSessionId: row.sdk_session_id,
        cwd: row.cwd,
      };
    } catch {
      return null;
    }
  }

  /**
   * Join a live active native user message to its one route-authenticated C2
   * foreground dispatch. Pending, rejected, unknown, ordinary and managed
   * dispatches are intentionally not accepted as this authority.
   */
  findForegroundMcpDispatch(input: CoordinatorForegroundMcpSessionScope & {
    sdkUserMessageId: string;
  }): CoordinatorForegroundMcpDispatchBinding | null {
    if (!MCP_IDENTIFIER.test(input.sdkUserMessageId)) return null;
    const current = this.findForegroundMcpSessionScope(input);
    if (
      !current || current.sessionId !== input.sessionId || current.projectId !== input.projectId ||
      current.cwd !== input.cwd
    ) return null;
    try {
      const rows = this.db.prepare(`SELECT d.id
        FROM agent_turn_dispatches d
        WHERE d.session_id=? AND d.sdk_session_id=? AND d.sdk_user_message_id=?
          AND d.origin='prompt_api' AND d.requested_source='session'
          AND d.route_authed=1 AND d.reason_code='c2_foreground'
          AND d.outcome='accepted'
        LIMIT 2`).all(
        current.sessionId,
        current.sdkSessionId,
        input.sdkUserMessageId,
      ) as Array<{ id: string }>;
      return rows.length === 1
        ? { ...current, kind: 'foreground', sdkUserMessageId: input.sdkUserMessageId }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * An async completion may carry a coordinator callback marker only when the
   * batch has exactly one previously bound Coding Workflow child. This keeps a
   * generic/mixed completion wake from acquiring C2 model-control authority.
   */
  coordinatorDelegationCallbackReason(input: {
    parentSessionId: string;
    parentSdkSessionId: string;
    delegationId: string;
    childSessionId: string;
    targetAgentConfigId: string;
  }): string | null {
    if (
      !MCP_IDENTIFIER.test(input.parentSessionId) || !MCP_IDENTIFIER.test(input.parentSdkSessionId) ||
      !MCP_IDENTIFIER.test(input.delegationId) || !MCP_IDENTIFIER.test(input.childSessionId) ||
      input.targetAgentConfigId !== 'workflow-orchestrator'
    ) return null;
    try {
      const rows = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN},
          sdk_session_id, cwd, parent_session_id, is_system, category, archived_at
        FROM agent_sessions
        WHERE id=? AND sdk_session_id=? AND parent_session_id IS NULL AND is_system=0
          AND category='chat' AND archived_at IS NULL
        LIMIT 2`).all(input.parentSessionId, input.parentSdkSessionId) as ForegroundSessionScopeRow[];
      if (rows.length !== 1) return null;
      const row = rows[0];
      const parsed = parseRow(row);
      if (
        parsed.kind !== 'found' || !parsed.conversation.primaryOwnerRoot ||
        parsed.conversation.sessionId !== input.parentSessionId || row.sdk_session_id !== input.parentSdkSessionId
      ) return null;
      const command = parsed.conversation.commandDedupe.find((candidate) =>
        candidate.kind === 'delegate_goal' && candidate.state === 'dispatched' &&
        candidate.parentSdkSessionId === input.parentSdkSessionId &&
        candidate.targetAgentConfigId === input.targetAgentConfigId &&
        candidate.delegationId === input.delegationId && candidate.childSessionId === input.childSessionId,
      );
      return command ? encodeCoordinatorCallbackMarker(input.delegationId) : null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve the callback authority only from an exact C2-marked completion
   * dispatch plus the durable parent/child/delegation binding. It deliberately
   * refuses all generic or mixed async completion turns.
   */
  findDelegationCallbackMcpDispatch(input: CoordinatorForegroundMcpSessionScope & {
    sdkUserMessageId: string;
  }): CoordinatorDelegationCallbackMcpDispatchBinding | null {
    if (!MCP_IDENTIFIER.test(input.sdkUserMessageId)) return null;
    const current = this.findForegroundMcpSessionScope(input);
    if (
      !current || current.sessionId !== input.sessionId || current.projectId !== input.projectId ||
      current.cwd !== input.cwd
    ) return null;
    try {
      const rows = this.db.prepare(`SELECT d.reason_code
        FROM agent_turn_dispatches d
        WHERE d.session_id=? AND d.sdk_session_id=? AND d.sdk_user_message_id=?
          AND d.origin='delegation_completion' AND d.requested_source='agent_config'
          AND d.outcome='accepted' AND d.reason_code LIKE 'c2_goal_callback:%'
        LIMIT 2`).all(
        current.sessionId,
        current.sdkSessionId,
        input.sdkUserMessageId,
      ) as Array<{ reason_code: string | null }>;
      const reason = rows.length === 1 && typeof rows[0].reason_code === 'string'
        ? rows[0].reason_code
        : null;
      // Same strict parser the provenance insert uses; the marker is shape, not authority.
      const delegationId = parseCoordinatorCallbackMarker(reason);
      if (!reason || delegationId === null || !MCP_IDENTIFIER.test(delegationId)) return null;
      const record = this.read({
        ownerUserId: current.ownerUserId,
        projectId: current.projectId,
        sessionId: current.sessionId,
      });
      if (record.kind !== 'found' || !record.conversation.primaryOwnerRoot) return null;
      const command = record.conversation.commandDedupe.find((candidate): candidate is Extract<
        CoordinatorConversationCommand,
        { kind: 'delegate_goal' }
      > => (
        candidate.kind === 'delegate_goal' && candidate.state === 'dispatched' &&
        candidate.parentSdkSessionId === current.sdkSessionId && candidate.delegationId === delegationId &&
        candidate.targetAgentConfigId === 'workflow-orchestrator' && candidate.childSessionId !== null
      ));
      if (!command || !command.childSessionId) return null;
      const delegationRows = this.db.prepare(`SELECT id
        FROM agent_async_delegations
        WHERE id=? AND parent_session_id=? AND child_session_id=?
          AND target_agent_config_id='workflow-orchestrator' AND status IN ('waking', 'notified')
        LIMIT 2`).all(delegationId, current.sessionId, command.childSessionId) as Array<{ id: string }>;
      if (delegationRows.length !== 1) return null;
      return {
        ...current,
        kind: 'delegation_callback',
        sdkUserMessageId: input.sdkUserMessageId,
        goalId: command.goalId,
        delegationId,
        childSessionId: command.childSessionId,
        callbackReasonCode: reason,
      };
    } catch {
      return null;
    }
  }

  /**
   * Shared read-only proof for the approved-goal retry. Before the token is
   * consumed (`receiptCommandKey` absent) it requires an unconsumed, unexpired
   * approval and a goal with no delegation command. After the coupled
   * transaction consumed it, the token is accepted ONLY together with that same
   * transaction's own delegate command (`receiptCommandKey`), so another
   * consumer's consumption can never stand in for this action's receipt.
   */
  private goalApprovalResumeState(input: {
    approvalId: string;
    sessionId: string;
    goalId?: string;
    agentName?: string;
    receiptCommandKey?: string;
  }): {
    ownerUserId: number; projectId: string; sdkSessionId: string; cwd: string; profileId: string | null;
    goal: CoordinatorConversationGoal; taintId: string; taintedTurnId: string; consumed: boolean;
  } | null {
    try {
      const row = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN},
          sdk_session_id, cwd, parent_session_id, is_system, category, archived_at, agent_kind, profile_id
        FROM agent_sessions
        WHERE id=? AND parent_session_id IS NULL AND is_system=0 AND category='chat'
          AND archived_at IS NULL AND sdk_session_id IS NOT NULL
        LIMIT 1`).get(input.sessionId) as (ForegroundSessionScopeRow & { agent_kind: string; profile_id: string | null }) | undefined;
      if (!row) return null;
      const parsed = parseRow(row);
      if (
        parsed.kind !== 'found' || !parsed.conversation.primaryOwnerRoot || parsed.conversation.sessionId !== row.id ||
        typeof row.sdk_session_id !== 'string' || typeof row.cwd !== 'string' || row.cwd.length === 0 || row.cwd.length > 4_096
      ) return null;
      const approval = this.db.prepare('SELECT * FROM agent_approvals WHERE id=?').get(input.approvalId) as
        Record<string, unknown> | undefined;
      if (
        !approval || approval.session_id !== row.id || approval.status !== 'approved' ||
        approval.actor !== `user:${row.owner_user_id}` || approval.security_action !== 'delegation.start-async' ||
        approval.agent_config_id !== row.agent_kind || typeof approval.payload_digest !== 'string' ||
        typeof approval.taint_id !== 'string' || typeof approval.tainted_turn_id !== 'string' ||
        (input.agentName !== undefined && approval.bound_agent !== input.agentName)
      ) return null;
      const taint = this.db.prepare('SELECT taint_id, tainted_turn_id FROM agent_external_taint_state WHERE session_id=?')
        .get(row.id) as { taint_id: string; tainted_turn_id: string } | undefined;
      if (!taint || taint.taint_id !== approval.taint_id || taint.tainted_turn_id !== approval.tainted_turn_id) return null;
      const consumed = approval.consumed_at !== null && approval.consumed_at !== undefined;
      if (!consumed && (typeof approval.expires_at !== 'string' || Date.parse(approval.expires_at) <= Date.now())) return null;
      const matches = parsed.conversation.goals.filter((candidate) =>
        securityPayloadDigest('delegation.start-async', { goalId: candidate.id }) === approval.payload_digest);
      if (matches.length !== 1 || (input.goalId !== undefined && matches[0].id !== input.goalId)) return null;
      const goal = matches[0];
      const goalCommands = parsed.conversation.commandDedupe.filter((command) =>
        command.kind === 'delegate_goal' && command.goalId === goal.id);
      if (consumed) {
        const receipt = input.receiptCommandKey === undefined ? undefined : goalCommands.find((command) =>
          command.key === input.receiptCommandKey && command.kind === 'delegate_goal' &&
          command.parentSdkSessionId === row.sdk_session_id);
        if (!receipt || goalCommands.length !== 1) return null;
      } else if (goal.state !== 'captured' || goal.linkedWorkstreamId !== null || goalCommands.length !== 0) {
        return null;
      }
      return {
        ownerUserId: row.owner_user_id, projectId: row.project_id, sdkSessionId: row.sdk_session_id, cwd: row.cwd,
        profileId: row.profile_id, goal, taintId: taint.taint_id, taintedTurnId: taint.tainted_turn_id, consumed,
      };
    } catch {
      return null;
    }
  }

  /**
   * Producer qualification: the approved, unexpired, unconsumed
   * `delegation.start-async` approval of this current primary root whose stored
   * payload digest uniquely selects one captured, unlinked, uncommanded goal.
   * Null for generic/ambiguous/stale approvals — those keep the ordinary wake.
   */
  findGoalApprovalResumeCandidate(approval: CoordinatorGoalApprovalSnapshot): CoordinatorGoalApprovalResumeCandidate | null {
    if (!approval.sessionId || !MCP_IDENTIFIER.test(approval.id) || !MCP_IDENTIFIER.test(approval.sessionId)) return null;
    const state = this.goalApprovalResumeState({ approvalId: approval.id, sessionId: approval.sessionId });
    if (!state || state.consumed || !MCP_IDENTIFIER.test(state.goal.id)) return null;
    return {
      ownerUserId: state.ownerUserId,
      sessionId: approval.sessionId,
      projectId: state.projectId,
      sdkSessionId: state.sdkSessionId,
      cwd: state.cwd,
      approvalId: approval.id,
      goalId: state.goal.id,
      reasonCode: goalApprovalResumeReasonCode(approval.id, state.goal.id, state.goal.revision),
      fingerprint: createHash('sha256').update(JSON.stringify([
        approval.id, state.goal.id, state.goal.revision,
        createHash('sha256').update(state.goal.objective).digest('hex'),
        state.ownerUserId, approval.sessionId, state.projectId, state.profileId, state.sdkSessionId,
        state.taintId, state.taintedTurnId,
      ])).digest('hex'),
    };
  }

  /**
   * Join the live active native user message to the exactly-one accepted
   * approval-continuation dispatch whose strict reason code names this
   * approval + goal, then independently re-prove the approval, taint, goal and
   * current primary root. Foreground, generic approval, callback and unknown
   * dispatches never qualify.
   */
  findGoalApprovalResumeMcpDispatch(input: CoordinatorForegroundMcpSessionScope & {
    sdkUserMessageId: string;
    approvalId: string;
    goalId: string;
    agentName: string;
    receiptCommandKey?: string;
  }): CoordinatorGoalApprovalResumeMcpDispatchBinding | null {
    if (
      !MCP_IDENTIFIER.test(input.sdkUserMessageId) || !MCP_IDENTIFIER.test(input.approvalId) ||
      !MCP_IDENTIFIER.test(input.goalId) || input.agentName.length === 0
    ) return null;
    const current = this.findForegroundMcpSessionScope(input);
    if (
      !current || current.sessionId !== input.sessionId || current.projectId !== input.projectId ||
      current.cwd !== input.cwd
    ) return null;
    const state = this.goalApprovalResumeState({
      approvalId: input.approvalId,
      sessionId: current.sessionId,
      goalId: input.goalId,
      agentName: input.agentName,
      receiptCommandKey: input.receiptCommandKey,
    });
    if (
      !state || state.ownerUserId !== current.ownerUserId || state.projectId !== current.projectId ||
      state.sdkSessionId !== current.sdkSessionId
    ) return null;
    const reasonCode = goalApprovalResumeReasonCode(input.approvalId, input.goalId, state.goal.revision);
    try {
      const rows = this.db.prepare(`SELECT d.id
        FROM agent_turn_dispatches d
        WHERE d.session_id=? AND d.sdk_session_id=? AND d.sdk_user_message_id=?
          AND d.origin='approval_continuation' AND d.requested_source='agent_config'
          AND d.route_authed IS NULL AND d.reason_code=? AND d.outcome='accepted'
        LIMIT 2`).all(current.sessionId, current.sdkSessionId, input.sdkUserMessageId, reasonCode) as Array<{ id: string }>;
      return rows.length === 1
        ? {
          ...current, kind: 'goal_approval_resume', sdkUserMessageId: input.sdkUserMessageId,
          goalId: input.goalId, approvalId: input.approvalId, reasonCode,
        }
        : null;
    } catch {
      return null;
    }
  }

  private session(scope: CoordinatorConversationScope): SessionRow | null {
    try {
      const row = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
          FROM agent_sessions
         WHERE id=? AND owner_user_id=? AND project_id=?
           AND parent_session_id IS NULL AND is_system=0 AND category='chat'
         LIMIT 1`).get(
        scope.sessionId,
        scope.ownerUserId,
        scope.projectId,
      ) as SessionRow | undefined;
      return row ?? null;
    } catch {
      return null;
    }
  }

  private record(scope: CoordinatorConversationScope): {
    result: CoordinatorConversationRead;
    serialized: string | null;
  } {
    const row = this.session(scope);
    if (!row) {
      try {
        // A column check distinguishes an unavailable installer/schema from an
        // ordinary non-disclosing scope miss without exposing SQL errors.
        const hasColumn = (this.db.prepare('PRAGMA table_info(agent_sessions)').all() as Array<{ name: string }>)
          .some((column) => column.name === COORDINATOR_CONVERSATION_COLUMN);
        return { result: hasColumn ? { kind: 'not_found' } : { kind: 'schema_unavailable' }, serialized: null };
      } catch {
        return { result: { kind: 'schema_unavailable' }, serialized: null };
      }
    }
    return { result: parseRow(row), serialized: row.coordinator_conversation_json };
  }

  private read(scope: CoordinatorConversationScope): CoordinatorConversationRead {
    return this.record(scope).result;
  }

  get(scope: CoordinatorConversationScope): CoordinatorConversationRead {
    return this.read(scope);
  }

  /**
   * Read-only evidence for the identity-only mobile change hint: the CURRENT
   * owned, nonarchived, nonchild, nonsystem ordinary chat that is the owner's
   * primary root, in a nonarchived project with a usable canonical directory.
   * It needs no SDK binding (an inert primary qualifies) and is never an action
   * grant. Optional `ownerUserId`/`projectId` must match exactly. Any miss,
   * malformed row or failure is null.
   */
  findCanonicalNotificationScope(input: {
    sessionId: string;
    ownerUserId?: number;
    projectId?: string;
  }): (CoordinatorChangedScope & { ownerUserId: number }) | null {
    try {
      const row = this.db.prepare(`SELECT s.id, s.owner_user_id, s.project_id, s.${COORDINATOR_CONVERSATION_COLUMN},
          p.cwd AS project_cwd
        FROM agent_sessions s JOIN projects p ON p.id = s.project_id
        WHERE s.id=? AND s.parent_session_id IS NULL AND s.is_system=0 AND s.category='chat'
          AND s.archived_at IS NULL AND p.archived_at IS NULL
        LIMIT 1`).get(input.sessionId) as (SessionRow & { project_cwd: string }) | undefined;
      if (!row) return null;
      if (input.ownerUserId !== undefined && row.owner_user_id !== input.ownerUserId) return null;
      if (input.projectId !== undefined && row.project_id !== input.projectId) return null;
      const parsed = parseRow(row);
      if (parsed.kind !== 'found' || parsed.conversation.primaryOwnerRoot !== true) return null;
      const directory = canonicalize(row.project_cwd);
      if (!statSync(directory).isDirectory()) return null;
      return {
        directory,
        projectId: row.project_id,
        conversationId: parsed.conversation.id,
        localSessionId: row.id,
        ownerUserId: row.owner_user_id,
      };
    } catch {
      return null;
    }
  }

  /**
   * Relay-side, read-only identity of a MIRRORED primary root: the exact
   * nonarchived, nonchild, nonsystem chat row with a valid parsed conversation
   * that is its owner's `primaryOwnerRoot`. Unlike the Mac lookup it needs no
   * projects row and no filesystem (the relay has neither); it is an eventual
   * replica read, advisory for a body-free hint and never an authority grant.
   */
  findMirroredPrimaryRoot(sessionId: string): { ownerUserId: number; projectId: string; conversationId: string; localSessionId: string } | null {
    try {
      const row = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
        FROM agent_sessions
        WHERE id=? AND parent_session_id IS NULL AND is_system=0 AND category='chat' AND archived_at IS NULL
        LIMIT 1`).get(sessionId) as SessionRow | undefined;
      if (!row || typeof row.project_id !== 'string' || row.project_id.length === 0) return null;
      const parsed = parseRow(row);
      if (parsed.kind !== 'found' || parsed.conversation.primaryOwnerRoot !== true) return null;
      return {
        ownerUserId: row.owner_user_id,
        projectId: row.project_id,
        conversationId: parsed.conversation.id,
        localSessionId: row.id,
      };
    } catch {
      return null;
    }
  }

  /**
   * Bounded, read-only join of each DISPATCHED goal delegation to the existing
   * async-delegation row and child session. It re-proves the current
   * owner/project/primary root, its SDK binding, the exact delegation↔child
   * link and the child's parent/owner/project on every call, and projects only
   * identities and a coarse outcome — never output bodies, never a state
   * change, retry or verification. Anything unprovable is `unknown`, which is
   * deliberately different from `failed`.
   */
  listGoalDelegationOutcomes(scope: CoordinatorConversationScope): CoordinatorGoalDelegationOutcome[] {
    const read = this.read(scope);
    if (read.kind !== 'found') return [];
    const commands = read.conversation.commandDedupe.flatMap((command) =>
      command.kind === 'delegate_goal' && command.state === 'dispatched' ? [command] : []);
    if (commands.length === 0) return [];
    let rootSdkSessionId: string | null = null;
    try {
      const root = this.db.prepare(`SELECT sdk_session_id, profile_id FROM agent_sessions
        WHERE id=? AND owner_user_id=? AND project_id=? AND parent_session_id IS NULL
          AND is_system=0 AND category='chat' AND archived_at IS NULL`)
        .get(scope.sessionId, scope.ownerUserId, scope.projectId) as
        { sdk_session_id: string | null; profile_id: string | null } | undefined;
      if (root && read.conversation.primaryOwnerRoot && root.profile_id) rootSdkSessionId = root.sdk_session_id;
    } catch {
      rootSdkSessionId = null;
    }
    return commands.slice(0, MAX_GOAL_OUTCOMES).map((command): CoordinatorGoalDelegationOutcome => {
      const unknown: CoordinatorGoalDelegationOutcome = {
        goalId: command.goalId,
        delegationId: command.delegationId,
        childSessionId: command.childSessionId,
        outcome: 'unknown',
        terminalAt: null,
      };
      if (!rootSdkSessionId || rootSdkSessionId !== command.parentSdkSessionId || !command.delegationId || !command.childSessionId) {
        return unknown;
      }
      try {
        const row = this.db.prepare(`SELECT d.status, d.completed_at, d.notified_at,
            d.error_text IS NOT NULL AS has_error
          FROM agent_async_delegations d JOIN agent_sessions c ON c.id = d.child_session_id
          WHERE d.id=? AND d.child_session_id=? AND d.parent_session_id=?
            AND d.target_agent_config_id='workflow-orchestrator'
            AND c.parent_session_id=? AND c.owner_user_id=? AND c.project_id=?
          LIMIT 1`).get(
          command.delegationId, command.childSessionId, scope.sessionId,
          scope.sessionId, scope.ownerUserId, scope.projectId,
        ) as { status: string; completed_at: string | null; notified_at: string | null; has_error: number } | undefined;
        if (!row) return unknown;
        const terminalAt = row.completed_at ?? row.notified_at;
        if (row.status === 'dispatched') return { ...unknown, outcome: 'running' };
        if (row.status === 'failed' || row.status === 'cancelled') {
          return { ...unknown, outcome: row.status === 'failed' ? 'failed' : 'cancelled', terminalAt };
        }
        if (row.status === 'completed' || row.status === 'waking' || row.status === 'notified') {
          return { ...unknown, outcome: row.has_error ? 'failed' : 'returned_result_unverified', terminalAt };
        }
        return unknown;
      } catch {
        return unknown;
      }
    });
  }

  /**
   * Server-side only root discovery. The browser never chooses an owner or a
   * session. A malformed durable control is a hold rather than an opportunity
   * to create a second primary root.
   */
  findPrimaryOwnerRoot(ownerUserId: number): CoordinatorConversationRead {
    try {
      const rows = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
          FROM agent_sessions
         WHERE owner_user_id=? AND parent_session_id IS NULL AND is_system=0 AND category='chat'
           AND ${COORDINATOR_CONVERSATION_COLUMN} IS NOT NULL
         ORDER BY created_at, id LIMIT ?`).all(ownerUserId, MAX_PRIMARY_ROOT_SCAN + 1) as SessionRow[];
      if (rows.length > MAX_PRIMARY_ROOT_SCAN) return { kind: 'integrity_hold' };
      const roots: CoordinatorConversation[] = [];
      for (const row of rows) {
        const parsed = parseRow(row);
        if (parsed.kind === 'integrity_hold') return parsed;
        if (parsed.kind === 'found' && parsed.conversation.primaryOwnerRoot) roots.push(parsed.conversation);
      }
      return roots.length === 0
        ? { kind: 'not_found' }
        : roots.length === 1
          ? { kind: 'found', conversation: roots[0] }
          : { kind: 'integrity_hold' };
    } catch {
      return { kind: 'schema_unavailable' };
    }
  }

  /**
   * Bounded, read-only inventory for the already-owned scheduler callback.
   * The cursor is a durable local session id, not an authorization token. A
   * malformed row is omitted rather than being treated as a candidate; its
   * normal scoped read remains an integrity hold.
   */
  listFiniteReconciliationCandidates(
    limit: number,
    after?: string,
  ): CoordinatorConversationFiniteReconciliationPage {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    try {
      const rows = (after
        ? this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
            FROM agent_sessions
           WHERE ${COORDINATOR_CONVERSATION_COLUMN} IS NOT NULL AND id>?
           ORDER BY id LIMIT ?`).all(after, bounded)
        : this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
            FROM agent_sessions
           WHERE ${COORDINATOR_CONVERSATION_COLUMN} IS NOT NULL
           ORDER BY id LIMIT ?`).all(bounded)) as SessionRow[];
      const items = rows.flatMap((row) => {
        const parsed = parseRow(row);
        return parsed.kind === 'found' && parsed.conversation.primaryOwnerRoot &&
          parsed.conversation.continuations.some((authority) =>
            authority.status === 'consumed' && authority.consumedTurns >= 1 && authority.consumedTurns <= authority.maxTurns,
          )
          ? [parsed.conversation]
          : [];
      });
      return {
        items,
        nextCursor: rows.length === bounded ? rows.at(-1)?.id ?? null : null,
      };
    } catch {
      // The scheduler has no authority to reinterpret unavailable storage as
      // an empty inventory. Returning an empty terminal page is a safe no-op;
      // scoped UI reads continue to expose the concrete schema/integrity hold.
      return { items: [], nextCursor: null };
    }
  }

  /** Candidate discovery is bounded and never creates a session or SDK turn. */
  listPrimaryRootCandidates(input: { ownerUserId: number; projectHint?: string }): Array<{ sessionId: string; projectId: string }> {
    try {
      const rows = input.projectHint === undefined
        ? this.db.prepare(`SELECT id, project_id FROM agent_sessions
            WHERE owner_user_id=? AND parent_session_id IS NULL AND is_system=0 AND category='chat'
              AND archived_at IS NULL AND project_id IS NOT NULL AND sdk_session_id IS NOT NULL AND profile_id IS NOT NULL
            ORDER BY created_at, id LIMIT ?`).all(input.ownerUserId, MAX_PRIMARY_ROOT_SCAN) as Array<{ id: string; project_id: string }>
        : this.db.prepare(`SELECT id, project_id FROM agent_sessions
            WHERE owner_user_id=? AND project_id=? AND parent_session_id IS NULL AND is_system=0 AND category='chat'
              AND archived_at IS NULL AND sdk_session_id IS NOT NULL AND profile_id IS NOT NULL
            ORDER BY created_at, id LIMIT ?`).all(input.ownerUserId, input.projectHint, MAX_PRIMARY_ROOT_SCAN) as Array<{ id: string; project_id: string }>;
      return rows.filter((row) => typeof row.id === 'string' && typeof row.project_id === 'string')
        .map((row) => ({ sessionId: row.id, projectId: row.project_id }));
    } catch {
      return [];
    }
  }

  /**
   * Atomically creates/designates one owner primary root on an existing chat.
   * This cannot move a root between projects or touch an SDK/job/capture row.
   */
  designatePrimaryOwnerRoot(
    scope: CoordinatorConversationScope,
    options: { allowUnboundSdk?: boolean } = {},
  ): CoordinatorConversationRead {
    try {
      return this.outer((): CoordinatorConversationRead => {
        const existing = this.findPrimaryOwnerRoot(scope.ownerUserId);
        if (existing.kind !== 'not_found') return existing;
        const boundSdkClause = options.allowUnboundSdk ? '' : ' AND sdk_session_id IS NOT NULL';
        const row = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
            FROM agent_sessions
           WHERE id=? AND owner_user_id=? AND project_id=?
             AND parent_session_id IS NULL AND is_system=0 AND category='chat'
             AND archived_at IS NULL${boundSdkClause} AND profile_id IS NOT NULL
           LIMIT 1`).get(scope.sessionId, scope.ownerUserId, scope.projectId) as SessionRow | undefined;
        if (!row) return { kind: 'not_found' };
        const now = nowIso(this.clock);
        let next: CoordinatorConversation;
        if (row.coordinator_conversation_json === null) {
          next = {
            schemaVersion: COORDINATOR_CONVERSATION_SCHEMA_VERSION,
            id: randomUUID(),
            sessionId: scope.sessionId,
            ownerUserId: scope.ownerUserId,
            projectId: scope.projectId,
            controlRevision: 1,
            primaryOwnerRoot: true,
            goals: [],
            commandDedupe: [],
            continuations: [],
            createdAt: now,
            updatedAt: now,
          };
        } else {
          const parsed = parseRow(row);
          if (parsed.kind !== 'found') return parsed;
          next = { ...parsed.conversation, primaryOwnerRoot: true, updatedAt: now };
        }
        const changed = this.db.prepare(`UPDATE agent_sessions
            SET ${COORDINATOR_CONVERSATION_COLUMN}=?, updated_at=?
          WHERE id=? AND owner_user_id=? AND project_id=?
            AND parent_session_id IS NULL AND is_system=0 AND category='chat'
            AND ${COORDINATOR_CONVERSATION_COLUMN} IS ?`).run(
          JSON.stringify(next), next.updatedAt, scope.sessionId, scope.ownerUserId, scope.projectId,
          row.coordinator_conversation_json,
        ).changes;
        if (changed === 1) {
          appendRelayUpsert(this.db, 'agent_sessions', scope.sessionId);
          this.markCommitted(scope);
        }
        return changed === 1 ? { kind: 'found', conversation: next } : this.findPrimaryOwnerRoot(scope.ownerUserId);
      });
    } catch {
      return { kind: 'schema_unavailable' };
    }
  }

  /**
   * Create an inert dedicated root and mark it primary as one local durable
   * operation. A competing owner root rolls this transaction back instead of
   * committing an unbound extra chat; a later resolve can safely replay it.
   */
  createPrimaryOwnerRoot(input: {
    ownerUserId: number;
    projectId: string;
    createSession: () => { id: string };
  }): CoordinatorConversationPrimaryRootWrite {
    try {
      return this.outer((): CoordinatorConversationPrimaryRootWrite => {
        const existing = this.findPrimaryOwnerRoot(input.ownerUserId);
        if (existing.kind === 'found') return { kind: 'replay', conversation: existing.conversation };
        if (existing.kind !== 'not_found') return existing;

        const created = input.createSession();
        if (!created || typeof created.id !== 'string' || created.id.length === 0) {
          throw new Error('metadata root insert did not return a session id');
        }
        const designated = this.designatePrimaryOwnerRoot({
          ownerUserId: input.ownerUserId,
          projectId: input.projectId,
          sessionId: created.id,
        }, { allowUnboundSdk: true });
        if (designated.kind !== 'found') return designated;
        // Do not commit a duplicate inert session if an independently durable
        // primary appeared while the metadata insert was in flight.
        if (designated.conversation.sessionId !== created.id) {
          throw new Error('primary root changed during creation');
        }
        return { kind: 'created', conversation: designated.conversation };
      });
    } catch {
      return { kind: 'schema_unavailable' };
    }
  }

  /** Explicit install only; there is no boot-time, list-time, or idle auto-create. */
  open(scope: CoordinatorConversationScope): CoordinatorConversationOpen {
    const first = this.read(scope);
    if (first.kind === 'found') return { kind: 'replay', conversation: first.conversation };
    if (first.kind !== 'not_found') return first;

    const now = nowIso(this.clock);
    const conversation: CoordinatorConversation = {
      schemaVersion: COORDINATOR_CONVERSATION_SCHEMA_VERSION,
      id: randomUUID(),
      sessionId: scope.sessionId,
      ownerUserId: scope.ownerUserId,
      projectId: scope.projectId,
      controlRevision: 1,
      primaryOwnerRoot: false,
      goals: [],
      commandDedupe: [],
      continuations: [],
      createdAt: now,
      updatedAt: now,
    };
    const serialized = JSON.stringify(conversation);
    try {
      const changes = this.db.prepare(`UPDATE agent_sessions
          SET ${COORDINATOR_CONVERSATION_COLUMN}=?, updated_at=?
        WHERE id=? AND owner_user_id=? AND project_id=?
          AND parent_session_id IS NULL AND is_system=0 AND category='chat'
          AND ${COORDINATOR_CONVERSATION_COLUMN} IS NULL`).run(
        serialized,
        now,
        scope.sessionId,
        scope.ownerUserId,
        scope.projectId,
      ).changes;
      if (changes === 1) return { kind: 'created', conversation };
    } catch {
      return { kind: 'schema_unavailable' };
    }

    const reread = this.read(scope);
    return reread.kind === 'found'
      ? { kind: 'replay', conversation: reread.conversation }
      : reread;
  }

  /**
   * Dedupe is durable on the existing chat binding. An exact replay returns
   * the original goal even after the control revision advanced; a changed
   * payload under the same command key is a conflict and never overwrites it.
   */
  addGoal(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    objective: string;
  }): CoordinatorConversationGoalWrite {
    return this.addGoalInternal(input, null);
  }

  /**
   * Record the exact literal control as an existing transcript input and add
   * its goal in one local transaction. The input row has no SDK message id and
   * never stands in for an assistant event.
   */
  addGoalFromMessage(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    objective: string;
    message: string;
  }): CoordinatorConversationGoalWrite {
    const hash = intentHash(input.objective);
    try {
      return this.outer(() => this.addGoalInternal(input, input.message, true));
    } catch (error) {
      if (error instanceof ConversationTranscriptUnavailable) return { kind: 'schema_unavailable' };
      if (error instanceof ConversationCommandRace) return this.goalReread(input, hash);
      return { kind: 'schema_unavailable' };
    }
  }

  private addGoalInternal(
    input: CoordinatorConversationScope & {
      expectedControlRevision: number;
      commandKey: string;
      objective: string;
    },
    message: string | null,
    transactional = false,
  ): CoordinatorConversationGoalWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const hash = intentHash(input.objective);
    const matchingCommand = current.conversation.commandDedupe.find((command) => command.key === input.commandKey);
    if (matchingCommand) {
      const goal = matchingCommand.kind === 'add_goal'
        ? current.conversation.goals.find((candidate) => candidate.id === matchingCommand.goalId)
        : undefined;
      return matchingCommand.kind === 'add_goal' && goal && matchingCommand.intentHash === hash
        ? { kind: 'replay', conversation: current.conversation, goal }
        : { kind: 'command_conflict', conversation: current.conversation };
    }
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    if (
      current.conversation.goals.length >= MAX_COORDINATOR_CONVERSATION_GOALS ||
      current.conversation.commandDedupe.length >= MAX_COORDINATOR_CONVERSATION_COMMANDS
    ) {
      return { kind: 'goal_limit', conversation: current.conversation };
    }
    const goal: CoordinatorConversationGoal = {
      id: randomUUID(),
      commandKey: input.commandKey,
      intentHash: hash,
      objective: input.objective,
      state: 'captured',
      linkedWorkstreamId: null,
      revision: 1,
      createdAt: nowIso(this.clock),
    };
    const messageId = message === null ? null : this.appendCanonicalUserInput(input, message);
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      goals: [...current.conversation.goals, goal],
      commandDedupe: [...current.conversation.commandDedupe, {
        key: input.commandKey,
        intentHash: hash,
        kind: 'add_goal',
        goalId: goal.id,
        messageId,
      }],
      updatedAt: nowIso(this.clock),
    };
    const saved = this.saveCurrent(input, snapshot.serialized!, next);
    if (saved) return { kind: 'created', conversation: next, goal };
    if (transactional) throw new ConversationCommandRace();
    return this.goalReread(input, hash);
  }

  private goalReread(
    input: CoordinatorConversationScope & { commandKey: string },
    hash: string,
  ): CoordinatorConversationGoalWrite {
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const raced = reread.conversation.commandDedupe.find((command) => command.key === input.commandKey);
    if (raced?.kind === 'add_goal') {
      const racedGoal = reread.conversation.goals.find((candidate) => candidate.id === raced.goalId)!;
      return raced.intentHash === hash
        ? { kind: 'replay', conversation: reread.conversation, goal: racedGoal }
        : { kind: 'command_conflict', conversation: reread.conversation };
    }
    if (raced) return { kind: 'command_conflict', conversation: reread.conversation };
    return { kind: 'revision_conflict', conversation: reread.conversation };
  }

  /**
   * Store a deterministic status question as a normal input event. It does
   * not advance `controlRevision`: status is a read, not a new grant or goal.
   * The durable command still prevents a transport replay from duplicating the
   * visible user event.
   */
  recordStatusMessage(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    message: string;
  }): CoordinatorConversationStatusControlWrite {
    const hash = controlIntentHash('status', input.message);
    try {
      return this.outer(() => {
        const snapshot = this.record(input);
        const current = snapshot.result;
        if (current.kind !== 'found') return current;
        const existing = current.conversation.commandDedupe.find((command) => command.key === input.commandKey);
        if (existing) {
          return existing.kind === 'status' && existing.intentHash === hash
            ? { kind: 'replay' as const, conversation: current.conversation, messageId: existing.messageId }
            : { kind: 'command_conflict' as const, conversation: current.conversation };
        }
        if (current.conversation.controlRevision !== input.expectedControlRevision) {
          return { kind: 'revision_conflict' as const, conversation: current.conversation };
        }
        if (current.conversation.commandDedupe.length >= MAX_COORDINATOR_CONVERSATION_COMMANDS) {
          return { kind: 'command_limit' as const, conversation: current.conversation };
        }
        const messageId = this.appendCanonicalUserInput(input, input.message);
        const next: CoordinatorConversation = {
          ...current.conversation,
          commandDedupe: [...current.conversation.commandDedupe, {
            key: input.commandKey,
            intentHash: hash,
            kind: 'status',
            messageId,
          }],
          updatedAt: nowIso(this.clock),
        };
        if (!this.saveCurrent(input, snapshot.serialized!, next)) throw new ConversationCommandRace();
        return { kind: 'stored' as const, conversation: next, messageId };
      });
    } catch (error) {
      if (error instanceof ConversationTranscriptUnavailable) return { kind: 'schema_unavailable' };
      if (!(error instanceof ConversationCommandRace)) return { kind: 'schema_unavailable' };
      return this.statusReread(input, hash);
    }
  }

  /** Reserve one ordinary SDK prompt; a reserved row is intentionally not replayed. */
  reserveForegroundMessage(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    message: string;
  }): CoordinatorConversationForegroundWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const hash = controlIntentHash('foreground', input.message);
    const existing = current.conversation.commandDedupe.find((command) => command.key === input.commandKey);
    if (existing) {
      if (existing.kind !== 'foreground' || existing.intentHash !== hash) {
        return { kind: 'command_conflict', conversation: current.conversation };
      }
      if (existing.state === 'accepted') return { kind: 'accepted_replay', conversation: current.conversation };
      return { kind: 'uncertain', conversation: current.conversation };
    }
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    if (current.conversation.commandDedupe.length >= MAX_COORDINATOR_CONVERSATION_COMMANDS) {
      return { kind: 'command_limit', conversation: current.conversation };
    }
    const next: CoordinatorConversation = {
      ...current.conversation,
      commandDedupe: [...current.conversation.commandDedupe, {
        key: input.commandKey,
        intentHash: hash,
        kind: 'foreground',
        state: 'reserved',
      }],
      updatedAt: nowIso(this.clock),
    };
    if (this.saveCurrent(input, snapshot.serialized!, next)) {
      return { kind: 'reserved', conversation: next };
    }
    return this.foregroundReread(input, hash);
  }

  /** Once reserved, any failed or ambiguous adapter result remains non-replayable. */
  settleForegroundMessage(input: CoordinatorConversationScope & {
    commandKey: string;
    message: string;
    outcome: 'accepted' | 'uncertain';
  }): CoordinatorConversationForegroundSettle {
    const hash = controlIntentHash('foreground', input.message);
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const command = current.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (!command || command.kind !== 'foreground' || command.intentHash !== hash) {
      return { kind: 'command_conflict', conversation: current.conversation };
    }
    if (command.state === 'accepted') return { kind: 'accepted', conversation: current.conversation };
    if (command.state === 'uncertain') return { kind: 'uncertain', conversation: current.conversation };
    const next: CoordinatorConversation = {
      ...current.conversation,
      commandDedupe: current.conversation.commandDedupe.map((candidate): CoordinatorConversationCommand =>
        candidate.key === command.key
          ? { ...command, state: input.outcome }
          : candidate,
      ),
      updatedAt: nowIso(this.clock),
    };
    if (this.saveCurrent(input, snapshot.serialized!, next)) {
      return { kind: input.outcome, conversation: next };
    }
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const raced = reread.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (raced?.kind !== 'foreground' || raced.intentHash !== hash) {
      return { kind: 'command_conflict', conversation: reread.conversation };
    }
    return { kind: raced.state === 'accepted' ? 'accepted' : 'uncertain', conversation: reread.conversation };
  }

  private statusReread(
    input: CoordinatorConversationScope & { commandKey: string },
    hash: string,
  ): CoordinatorConversationStatusControlWrite {
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const command = reread.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (command?.kind === 'status' && command.intentHash === hash) {
      return { kind: 'replay', conversation: reread.conversation, messageId: command.messageId };
    }
    return command
      ? { kind: 'command_conflict', conversation: reread.conversation }
      : { kind: 'revision_conflict', conversation: reread.conversation };
  }

  private foregroundReread(
    input: CoordinatorConversationScope & { commandKey: string },
    hash: string,
  ): CoordinatorConversationForegroundWrite {
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const command = reread.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (command?.kind === 'foreground' && command.intentHash === hash) {
      return command.state === 'accepted'
        ? { kind: 'accepted_replay', conversation: reread.conversation }
        : { kind: 'uncertain', conversation: reread.conversation };
    }
    return command
      ? { kind: 'command_conflict', conversation: reread.conversation }
      : { kind: 'revision_conflict', conversation: reread.conversation };
  }

  /**
   * Reserve the one existing Coding Workflow delegation that can be attached
   * to a captured coordinator goal. The target is deliberately fixed here;
   * callers cannot select a profile, prompt, cwd, worktree, model, or rule.
   */
  reserveGoalDelegation(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    goalId: string;
    parentSdkSessionId: string;
  }): CoordinatorConversationGoalDelegationReservation {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const goal = current.conversation.goals.find((candidate) => candidate.id === input.goalId);
    const targetAgentConfigId = 'workflow-orchestrator' as const;
    if (!goal || !MCP_IDENTIFIER.test(input.parentSdkSessionId)) {
      return { kind: 'goal_delegation_conflict', conversation: current.conversation };
    }
    const hash = goalDelegationIntentHash({
      goalId: goal.id,
      parentSdkSessionId: input.parentSdkSessionId,
      targetAgentConfigId,
    });
    const matching = current.conversation.commandDedupe.find((command) => command.key === input.commandKey);
    if (matching) {
      if (
        matching.kind !== 'delegate_goal' || matching.intentHash !== hash ||
        matching.goalId !== goal.id || matching.parentSdkSessionId !== input.parentSdkSessionId ||
        matching.targetAgentConfigId !== targetAgentConfigId
      ) return { kind: 'command_conflict', conversation: current.conversation };
      if (matching.state === 'dispatched' && matching.delegationId && matching.childSessionId) {
        return {
          kind: 'dispatched_replay', conversation: current.conversation, goal,
          delegationId: matching.delegationId, childSessionId: matching.childSessionId,
        };
      }
      return { kind: 'uncertain', conversation: current.conversation, goal };
    }
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    if (
      goal.state !== 'captured' || goal.linkedWorkstreamId !== null ||
      current.conversation.commandDedupe.some((command) =>
        command.kind === 'delegate_goal' && command.goalId === goal.id) ||
      current.conversation.commandDedupe.length >= MAX_COORDINATOR_CONVERSATION_COMMANDS
    ) return {
      kind: current.conversation.commandDedupe.length >= MAX_COORDINATOR_CONVERSATION_COMMANDS
        ? 'command_limit'
        : 'goal_delegation_conflict',
      conversation: current.conversation,
    };
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      commandDedupe: [...current.conversation.commandDedupe, {
        key: input.commandKey,
        intentHash: hash,
        kind: 'delegate_goal',
        goalId: goal.id,
        parentSdkSessionId: input.parentSdkSessionId,
        targetAgentConfigId,
        state: 'reserved',
        delegationId: null,
        childSessionId: null,
      }],
      updatedAt: nowIso(this.clock),
    };
    if (this.saveCurrent(input, snapshot.serialized!, next)) {
      return { kind: 'reserved', conversation: next, goal };
    }
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const raced = reread.conversation.commandDedupe.find((command) => command.key === input.commandKey);
    if (
      raced?.kind === 'delegate_goal' && raced.intentHash === hash && raced.goalId === goal.id &&
      raced.parentSdkSessionId === input.parentSdkSessionId && raced.targetAgentConfigId === targetAgentConfigId
    ) {
      if (raced.state === 'dispatched' && raced.delegationId && raced.childSessionId) {
        return {
          kind: 'dispatched_replay', conversation: reread.conversation, goal,
          delegationId: raced.delegationId, childSessionId: raced.childSessionId,
        };
      }
      return { kind: 'uncertain', conversation: reread.conversation, goal };
    }
    return raced
      ? { kind: 'command_conflict', conversation: reread.conversation }
      : { kind: 'revision_conflict', conversation: reread.conversation };
  }

  /**
   * `reserveGoalDelegation` + a SYNCHRONOUS authorization (the approval token
   * consumption) in ONE SQLite transaction. The authorization runs only for a
   * fresh reservation; a replayed/uncertain/dispatched command never consumes
   * again. A refusal rolls the reservation and any partial consumption back
   * together (the goal is not poisoned) and is reported with its cause. The
   * callback must not await.
   */
  reserveGoalDelegationAuthorized(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    goalId: string;
    parentSdkSessionId: string;
    authorize: () => void;
  }): CoordinatorConversationGoalDelegationReservation | {
    kind: 'authorization_refused'; conversation: CoordinatorConversation; refusal: unknown;
  } {
    const { authorize, ...reserveInput } = input;
    try {
      return this.outer(() => {
        const reservation = this.reserveGoalDelegation(reserveInput);
        if (reservation.kind === 'reserved') {
          try {
            authorize();
          } catch (refusal) {
            throw new GoalAuthorizationRefused(refusal);
          }
        }
        return reservation;
      });
    } catch (error) {
      if (!(error instanceof GoalAuthorizationRefused)) throw error;
      const reread = this.read(reserveInput);
      return reread.kind === 'found'
        ? { kind: 'authorization_refused', conversation: reread.conversation, refusal: error.refusal }
        : reread;
    }
  }

  /**
   * Persist the exact child/delegation receipt only while the reservation's
   * current root control epoch still holds. A child that crosses an unknown
   * boundary is deliberately left reserved/uncertain rather than replayed.
   */
  settleGoalDelegation(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    goalId: string;
    outcome: 'dispatched' | 'uncertain';
    delegationId?: string;
    childSessionId?: string;
  }): CoordinatorConversationGoalDelegationSettle {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const goal = current.conversation.goals.find((candidate) => candidate.id === input.goalId);
    const command = current.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (!goal || !command || command.kind !== 'delegate_goal' || command.goalId !== goal.id) {
      return { kind: 'goal_delegation_conflict', conversation: current.conversation };
    }
    if (command.state === 'dispatched') {
      return { kind: 'dispatched_replay', conversation: current.conversation, goal };
    }
    if (command.state === 'uncertain') {
      return { kind: 'uncertain', conversation: current.conversation, goal };
    }
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    if (
      input.outcome === 'dispatched' &&
      (!input.delegationId || !input.childSessionId || !MCP_IDENTIFIER.test(input.delegationId) || !MCP_IDENTIFIER.test(input.childSessionId))
    ) return { kind: 'goal_delegation_conflict', conversation: current.conversation };
    const nextCommand: CoordinatorConversationCommand = input.outcome === 'dispatched'
      ? {
        ...command,
        state: 'dispatched',
        delegationId: input.delegationId!,
        childSessionId: input.childSessionId!,
      }
      : { ...command, state: 'uncertain' };
    const next: CoordinatorConversation = {
      ...current.conversation,
      commandDedupe: current.conversation.commandDedupe.map((candidate) =>
        candidate.key === command.key ? nextCommand : candidate),
      updatedAt: nowIso(this.clock),
    };
    if (this.saveCurrent(input, snapshot.serialized!, next)) {
      return { kind: input.outcome, conversation: next, goal };
    }
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const raced = reread.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    const racedGoal = reread.conversation.goals.find((candidate) => candidate.id === input.goalId);
    if (!racedGoal || raced?.kind !== 'delegate_goal' || raced.goalId !== input.goalId) {
      return { kind: 'goal_delegation_conflict', conversation: reread.conversation };
    }
    return raced.state === 'dispatched'
      ? { kind: 'dispatched_replay', conversation: reread.conversation, goal: racedGoal }
      : raced.state === 'uncertain'
        ? { kind: 'uncertain', conversation: reread.conversation, goal: racedGoal }
        : { kind: 'revision_conflict', conversation: reread.conversation };
  }

  private appendCanonicalUserInput(scope: CoordinatorConversationScope, message: string): number {
    try {
      const result = this.db.prepare(`INSERT INTO agent_session_messages
        (session_id, role, raw_text, stripped_text) VALUES (?, 'input', ?, ?)`)
        .run(scope.sessionId, message, message);
      const id = Number(result.lastInsertRowid);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('message insert id unavailable');
      return id;
    } catch {
      throw new ConversationTranscriptUnavailable();
    }
  }

  /**
   * Bind an already-created owner/project-scoped workstream exactly once.
   * The workstream is created first so an interrupted request cannot leave a
   * conversation pointing at an invented identifier.  A matching binding is
   * an idempotent replay; any other existing binding is a hold.
   */
  linkGoal(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    goalId: string;
    workstreamId: string;
  }): CoordinatorConversationGoalLinkWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const goal = current.conversation.goals.find((candidate) => candidate.id === input.goalId);
    if (!goal || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.workstreamId)) {
      return { kind: 'goal_link_conflict', conversation: current.conversation };
    }
    if (goal.state === 'linked') {
      return goal.linkedWorkstreamId === input.workstreamId
        ? { kind: 'replay', conversation: current.conversation, goal }
        : { kind: 'goal_link_conflict', conversation: current.conversation };
    }
    if (
      goal.state !== 'captured' || goal.linkedWorkstreamId !== null ||
      current.conversation.commandDedupe.some((command) =>
        command.kind === 'delegate_goal' && command.goalId === goal.id)
    ) {
      return { kind: 'goal_link_conflict', conversation: current.conversation };
    }
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    const linkedGoal: CoordinatorConversationGoal = {
      ...goal,
      state: 'linked',
      linkedWorkstreamId: input.workstreamId,
      revision: goal.revision + 1,
    };
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      goals: current.conversation.goals.map((candidate) => candidate.id === goal.id ? linkedGoal : candidate),
      updatedAt: nowIso(this.clock),
    };
    if (this.saveCurrent(input, snapshot.serialized!, next)) {
      return { kind: 'updated', conversation: next, goal: linkedGoal };
    }
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const racedGoal = reread.conversation.goals.find((candidate) => candidate.id === input.goalId);
    if (racedGoal?.state === 'linked' && racedGoal.linkedWorkstreamId === input.workstreamId) {
      return { kind: 'replay', conversation: reread.conversation, goal: racedGoal };
    }
    return racedGoal ? { kind: 'goal_link_conflict', conversation: reread.conversation } : { kind: 'revision_conflict', conversation: reread.conversation };
  }

  /**
   * C2-only internal hook. There is intentionally no HTTP request that can
   * set this field. The shared owner must invoke it from an already-verified
   * one-shot authority path and compose its workstream/job transaction there.
   */
  setContinuationAuthority(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    authority: CoordinatorConversationContinuationAuthority;
    /**
     * Service-only proof that a live saved control no longer matches current
     * server-owned authority and this is a fresh explicit acknowledgement.
     * The repository still CASes the exact durable conversation before it can
     * replace an unused or settled finite record.
     */
    replaceInvalidatedAuthority?: boolean;
  }): CoordinatorConversationAuthorityWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    const authority = input.authority;
    const goal = current.conversation.goals.find((candidate) => candidate.id === authority.goalId);
    if (
      !goal || goal.state !== 'linked' || goal.linkedWorkstreamId !== authority.workstreamId ||
      authority.projectId !== current.conversation.projectId ||
      authority.status !== 'authorized' || authority.maxTurns < 1 || authority.maxTurns > 8 ||
      authority.consumedTurns !== 0 || !isValidAuthorityFor(current.conversation, authority)
    ) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    const existing = current.conversation.continuations.find((candidate) => candidate.goalId === authority.goalId);
    if (existing) {
      const existingLive = new Date(existing.expiresAt).valueOf() > this.clock().valueOf();
      const replaceInvalidated = input.replaceInvalidatedAuthority === true &&
        existingLive && existing.status !== 'blocked';
      return JSON.stringify(existing) === JSON.stringify(authority)
        ? { kind: 'replay', conversation: current.conversation }
        : (existing.status === 'authorized' || existing.consumedTurns < existing.maxTurns) && existingLive && !replaceInvalidated
          ? { kind: 'authority_conflict', conversation: current.conversation }
          : this.replaceConsumedAuthority(input, snapshot.serialized!, current.conversation, authority);
    }
    if (current.conversation.continuations.length >= MAX_COORDINATOR_CONVERSATION_AUTHORIZATIONS) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      continuations: [...current.conversation.continuations, authority],
      updatedAt: nowIso(this.clock),
    };
    return this.saveCurrent(input, snapshot.serialized!, next)
      ? { kind: 'updated', conversation: next }
      : this.authorityReread(input);
  }

  private replaceConsumedAuthority(
    input: CoordinatorConversationScope & {
      expectedControlRevision: number;
      authority: CoordinatorConversationContinuationAuthority;
      replaceInvalidatedAuthority?: boolean;
    },
    serialized: string,
    conversation: CoordinatorConversation,
    authority: CoordinatorConversationContinuationAuthority,
  ): CoordinatorConversationAuthorityWrite {
    const next: CoordinatorConversation = {
      ...conversation,
      controlRevision: conversation.controlRevision + 1,
      continuations: conversation.continuations.map((candidate) =>
        candidate.goalId === authority.goalId ? authority : candidate,
      ),
      updatedAt: nowIso(this.clock),
    };
    return this.saveCurrent(input, serialized, next)
      ? { kind: 'updated', conversation: next }
      : this.authorityReread(input);
  }

  /**
   * Reserve exactly one outer-authorized turn before asynchronous dispatch.
   * `expectedConsumedTurns` makes retries idempotent without allowing a later
   * request to reuse the same reservation for a second SDK call.
   */
  reserveContinuationTurn(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    authorizationId: string;
    expectedConsumedTurns: number;
    /**
     * A later independent goal may advance the conversation-wide UI revision.
     * The bounded authorization remains fenced to its own authored goal, so a
     * sibling idea cannot revoke or consume it by itself.
     */
    expectedGoalRevision?: number;
    /** Rebound only after the service observed a settled current workstream. */
    workstreamRevision?: number;
  }): CoordinatorConversationAuthorityWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const authority = current.conversation.continuations
      .find((candidate) => candidate.authorizationId === input.authorizationId);
    const goal = authority
      ? current.conversation.goals.find((candidate) => candidate.id === authority.goalId)
      : null;
    if (
      !authority || authority.authorizationId !== input.authorizationId || !goal ||
      goal.state !== 'linked' || goal.linkedWorkstreamId !== authority.workstreamId ||
      goal.revision !== authority.goalRevision ||
      (input.expectedGoalRevision !== undefined && goal.revision !== input.expectedGoalRevision)
    ) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    if (
      authority.status === 'consumed' &&
      authority.consumedTurns === input.expectedConsumedTurns + 1
    ) {
      return { kind: 'replay', conversation: current.conversation };
    }
    if (
      authority.consumedTurns !== input.expectedConsumedTurns ||
      authority.consumedTurns >= authority.maxTurns ||
      (authority.consumedTurns === 0 && authority.status !== 'authorized') ||
      (authority.consumedTurns > 0 && authority.status !== 'consumed')
    ) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    // This is deliberately a repository-side requirement rather than a
    // service-only recheck.  The parent permission/approval state lives on
    // the same durable session row as this control, so the final CAS below
    // can fence a change that lands after an awaited context read but before
    // the ordinal would otherwise be consumed.  A legacy schema-2/3 grant is
    // readable for status but has no such proof and therefore cannot reserve.
    if (!this.hasUsableParentPermissionAuthority(authority, input)) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    if (input.workstreamRevision !== undefined &&
        (!Number.isSafeInteger(input.workstreamRevision) || input.workstreamRevision < 1)) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      continuations: current.conversation.continuations.map((candidate) =>
        candidate.authorizationId !== authority.authorizationId ? candidate : {
          ...authority,
          status: 'consumed' as const,
          consumedTurns: authority.consumedTurns + 1,
          ...(input.workstreamRevision === undefined ? {} : { workstreamRevision: input.workstreamRevision }),
        },
      ),
      updatedAt: nowIso(this.clock),
    };
    return this.saveCurrent(input, snapshot.serialized!, next, authority)
      ? { kind: 'updated', conversation: next }
      : this.authorityReread(input);
  }

  /** Backward-compatible one-turn helper retained for existing C1 callers. */
  markContinuationConsumed(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    authorizationId: string;
  }): CoordinatorConversationAuthorityWrite {
    return this.reserveContinuationTurn({ ...input, expectedConsumedTurns: 0 });
  }

  private authorityReread(scope: CoordinatorConversationScope): CoordinatorConversationAuthorityWrite {
    const reread = this.read(scope);
    return reread.kind === 'found'
      ? { kind: 'revision_conflict', conversation: reread.conversation }
      : reread;
  }

  private saveCurrent(
    scope: CoordinatorConversationScope,
    currentSerialized: string,
    next: CoordinatorConversation,
    /**
     * Optional only for finite-turn reservation.  When present it becomes
     * part of the exact SQLite UPDATE predicate rather than a stale read, so
     * a changed parent permission cannot consume an ordinal.
     */
    expectedAuthority?: CoordinatorConversationContinuationAuthority,
  ): boolean {
    const permission = expectedAuthority?.permissionAuthority;
    if (expectedAuthority && !this.hasUsableParentPermissionAuthority(expectedAuthority, scope)) {
      return false;
    }
    try {
      const permissionPredicate = permission === null || permission === undefined
        ? ''
        : ' AND profile_id=? AND permission_mode=? AND approval_bypass_explicit=?';
      // The CAS and the root's agent_sessions outbox record commit together;
      // only a write that actually changed the row is reported as committed.
      const changed = this.db.transaction((): boolean => {
        const applied = this.db.prepare(`UPDATE agent_sessions
          SET ${COORDINATOR_CONVERSATION_COLUMN}=?, updated_at=?
        WHERE id=? AND owner_user_id=? AND project_id=?
          AND parent_session_id IS NULL AND is_system=0 AND category='chat'
          AND ${COORDINATOR_CONVERSATION_COLUMN} IS ?${permissionPredicate}`).run(
          JSON.stringify(next),
          next.updatedAt,
          scope.sessionId,
          scope.ownerUserId,
          scope.projectId,
          currentSerialized,
          ...(permission === null || permission === undefined
            ? []
            : [
              expectedAuthority!.profileId,
              permission.parent.permissionMode,
              permission.parent.approvalBypassExplicit ? 1 : 0,
            ]),
        ).changes === 1;
        if (applied) appendRelayUpsert(this.db, 'agent_sessions', scope.sessionId);
        return applied;
      })();
      if (changed) this.markCommitted(scope);
      return changed;
    } catch {
      return false;
    }
  }

  /**
   * Canonical-change hint bookkeeping. A committed write is published only
   * after the OUTERMOST transaction returns (`outer`), and only for writes that
   * actually changed a row. Inside a transaction this repository does not own
   * the commit is unprovable, so nothing is recorded (silent, never early).
   */
  private notifyDepth = 0;
  private readonly pendingCommits = new Map<string, CoordinatorConversationScope>();

  private markCommitted(scope: CoordinatorConversationScope): void {
    if (this.notifyDepth > 0) {
      this.pendingCommits.set(scope.sessionId, scope);
      return;
    }
    if (this.db.inTransaction) return;
    this.publishCommitted(scope);
  }

  private publishCommitted(scope: CoordinatorConversationScope): void {
    try {
      const target = this.findCanonicalNotificationScope(scope);
      if (target) publishCoordinatorChanged(target);
    } catch {
      // A failed notification never undoes, repeats or misreports the commit.
    }
  }

  private outer<T>(work: () => T): T {
    const top = this.notifyDepth === 0;
    // Captured BEFORE this repository opens its own transaction/savepoint: if a
    // caller already owns one, the savepoint returning proves nothing about the
    // real commit, so this invocation can never publish.
    const callerOwned = top && this.db.inTransaction;
    this.notifyDepth += 1;
    let committed = false;
    try {
      const result = this.db.transaction(work)();
      committed = true;
      return result;
    } finally {
      this.notifyDepth -= 1;
      if (top) {
        // Always discard the batch, so an unowned or failed one can neither
        // escape a rollback nor leak into a later independent operation.
        const batch = [...this.pendingCommits.values()];
        this.pendingCommits.clear();
        // Only a successful repository-owned OUTERMOST commit publishes, and
        // only once no transaction remains open.
        if (committed && !callerOwned && !this.db.inTransaction) {
          for (const scope of batch) this.publishCommitted(scope);
        }
      }
    }
  }

  /**
   * Structural validation is repeated here because callers of this repository
   * include recovery/terminal paths.  No caller may turn a stored nullable
   * legacy permission field into permission to reserve a new SDK turn.
   */
  private hasUsableParentPermissionAuthority(
    authority: CoordinatorConversationContinuationAuthority,
    scope: CoordinatorConversationScope,
  ): boolean {
    const permission = authority.permissionAuthority;
    const workflow = authority.purpose === 'workflow';
    if (!(permission !== null &&
      (workflow ? permission.schemaVersion === 2 : permission.schemaVersion === 1) &&
      permission.parent.sessionId === scope.sessionId &&
      permission.worker.parentSessionId === scope.sessionId &&
      permission.worker.permissionMode === 'default' &&
      permission.worker.managedReadOnly === (workflow ? false : true) &&
      (!workflow || (
        authority.schemaVersion === 6 && authority.workflow?.kind === 'coding_workflow' &&
        authority.workflow.targetAgentConfigId === 'workflow-orchestrator' &&
        permission.workflow?.parentSessionId === scope.sessionId &&
        permission.workflow.permissionMode === permission.parent.permissionMode &&
        permission.workflow.approvalBypassExplicit === permission.parent.approvalBypassExplicit &&
        permission.workflow.targetAgentConfigId === 'workflow-orchestrator'
      )) &&
      (permission.parent.permissionMode !== 'bypassPermissions' || permission.parent.approvalBypassExplicit === true))) {
      return false;
    }
    // The following local read gives callers a precise hold before the final
    // CAS. `saveCurrent` repeats these fields in that CAS predicate, so this
    // is explanatory only; it cannot create a check-then-use window.
    try {
      const row = this.db.prepare(`SELECT 1 AS present FROM agent_sessions
        WHERE id=? AND owner_user_id=? AND project_id=?
          AND parent_session_id IS NULL AND is_system=0 AND category='chat'
          AND profile_id=? AND permission_mode=? AND approval_bypass_explicit=?
        LIMIT 1`).get(
        scope.sessionId,
        scope.ownerUserId,
        scope.projectId,
        authority.profileId,
        permission.parent.permissionMode,
        permission.parent.approvalBypassExplicit ? 1 : 0,
      ) as { present: number } | undefined;
      return row?.present === 1;
    } catch {
      return false;
    }
  }
}
