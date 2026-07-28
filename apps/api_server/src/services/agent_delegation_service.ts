import { AppError } from '../errors/app_error';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { run as runAgent } from './agent_runner';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { resolveProfileScope } from './agent_profile_scope';

export interface AgentDelegationInput {
  authenticatedUserId: number;
  callerAgentConfigId?: string | null;
  targetAgentConfigId: string;
  prompt: string;
  callerSessionId: string;
  context?: string | null;
  cwd?: string | null;
}

export interface AgentDelegationResult {
  sessionId: string;
  output: string;
  targetAgentConfigId: string;
}

export interface AsyncAgentDelegationResult {
  sessionId: string;
  sdkSessionId: string;
  status: 'dispatched';
  message: string;
  targetAgentConfigId: string;
}

/**
 * Maximum delegation nesting depth for the Secretary → orchestrator → specialist chain.
 *
 * Depth semantics: root sessions are stored at depth 0. Each delegation derives
 * the child depth from the caller session row (`caller.delegationDepth + 1`).
 * Stored child depth may be 1 or 2; a request that would create depth 3 is
 * rejected.
 *
 * Design decision (2026-06-25, issue #742):
 *   The intended 3-level chain is Secretary (manager, depth=0) →
 *   workflow-orchestrator (manager-capable delegate, depth=1) →
 *   specialist (depth=2). The old cap of 1 blocked the orchestrator from
 *   sub-delegating because it was already a child (depth=1 ≥ 1).
 *
 *   Raising to 2 enables one additional level. The manager-role check
 *   (`caller.isManager`) at each delegation node ensures only explicitly
 *   designated manager profiles can delegate — a random specialist cannot
 *   use this path even at depth=1. The combined constraint (isManager +
 *   allowedDelegatesJson + child depth <= 2) is the hard cap against runaway
 *   nesting.
 *
 *   See docs/ai/decisions/2026-06-25-delegation-depth.md for full rationale.
 */
const MAX_DELEGATION_DEPTH = 2;

function parseAllowedDelegates(json: string | null): Set<string> {
  if (!json) return new Set();
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string => typeof value === 'string' && value.trim() !== ''),
    );
  } catch {
    return new Set();
  }
}

function requireExecutableProfile(
  repo: AgentConfigsRepository,
  profileId: string,
  role: 'caller' | 'target',
) {
  const profile = repo.getById(profileId);
  if (!profile) {
    if (role === 'caller') {
      throw AppError.forbidden('caller profile is not allowed to delegate');
    }
    throw AppError.badRequest('target profile is not runnable');
  }
  const blockReason = agentConfigExecutionBlockReason(profile);
  if (blockReason) {
    if (role === 'caller') throw AppError.forbidden(blockReason);
    throw AppError.badRequest(blockReason);
  }
  return profile;
}

function dispatchFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'async delegation dispatch failed';
}

export async function delegateToAgent(
  input: AgentDelegationInput,
): Promise<AgentDelegationResult> {
  const claimedCallerId = input.callerAgentConfigId?.trim();
  const callerSessionId = input.callerSessionId?.trim();
  const targetId = input.targetAgentConfigId?.trim();
  const prompt = input.prompt?.trim();

  if (!callerSessionId) throw AppError.badRequest('callerSessionId is required');
  if (!targetId) throw AppError.badRequest('targetAgentConfigId is required');
  if (!prompt) throw AppError.badRequest('prompt is required');

  const sessionRepo = new AgentSessionsRepository();
  const callerSession = sessionRepo.findById(callerSessionId);
  if (!callerSession) throw AppError.badRequest('caller session not found');
  if (callerSession.ownerUserId !== input.authenticatedUserId) {
    throw AppError.forbidden('caller session is owned by another user');
  }

  const callerId = (callerSession.mcpRole ?? callerSession.agentKind)?.trim();
  if (!callerId) throw AppError.forbidden('caller session has no agent profile');
  if (claimedCallerId && claimedCallerId !== callerId) {
    throw AppError.forbidden('callerAgentConfigId does not match caller session');
  }

  if (callerId === targetId) throw AppError.badRequest('self-delegation is not allowed');
  const childDepth = callerSession.delegationDepth + 1;
  if (childDepth > MAX_DELEGATION_DEPTH) {
    throw AppError.badRequest('delegation depth limit exceeded');
  }

  const repo = new AgentConfigsRepository();
  const caller = requireExecutableProfile(repo, callerId, 'caller');
  if (!caller.isManager) {
    throw AppError.forbidden('caller profile is not allowed to delegate');
  }

  const allowed = parseAllowedDelegates(caller.allowedDelegatesJson);
  if (!allowed.has(targetId)) {
    throw AppError.forbidden('target profile is not an allowed delegate');
  }

  const target = requireExecutableProfile(repo, targetId, 'target');
  if (!target.isAgent) {
    throw AppError.badRequest('target profile is not runnable');
  }

  const scopedPrompt = input.context ? `${input.context.trim()}\n\n${prompt}` : prompt;
  const result = await runAgent({
    prompt: scopedPrompt,
    agentConfigId: targetId,
    agentKind: targetId,
    sessionName: `Delegated: ${target.label}`,
    outputTarget: 'session',
    cwd: input.cwd ?? undefined,
    ownerUserId: callerSession.ownerUserId,
    delegationDepth: childDepth,
  });

  if (result.status !== 'done') {
    throw AppError.internal(result.error ?? 'delegated run did not complete');
  }

  return {
    sessionId: result.sessionId,
    output: result.result,
    targetAgentConfigId: targetId,
  };
}

function hasExplicitAsyncDelegationDeny(corePermissionsJson: string | null): boolean {
  if (!corePermissionsJson) return false;
  try {
    const parsed = JSON.parse(corePermissionsJson) as Record<string, unknown>;
    const value = parsed?.rhythm_delegate_async;
    if (value === 'deny') return true;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.values(value as Record<string, unknown>).some((action) => action === 'deny');
    }
  } catch {
    // The profile writer already treats malformed permissions fail-soft. The
    // hard runtime mode/manager/roster gates below remain authoritative.
  }
  return false;
}

function parseSkillNames(allowedSkillsJson: string | null): string[] | undefined {
  if (allowedSkillsJson === null) return undefined;
  try {
    const parsed = JSON.parse(allowedSkillsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * #1123 — interactive-only, fire-and-forget delegation.
 *
 * This deliberately coexists with {@link delegateToAgent}: synchronous
 * scheduler/AgentFlow callers keep waiting for a final result, while an
 * interactive manager gets an immediate acknowledgement and a later pushed
 * completion through AsyncDelegationCompletionService.
 */
export async function delegateToAgentAsync(
  input: AgentDelegationInput,
): Promise<AsyncAgentDelegationResult> {
  const claimedCallerId = input.callerAgentConfigId?.trim();
  const callerSessionId = input.callerSessionId?.trim();
  const targetId = input.targetAgentConfigId?.trim();
  const prompt = input.prompt?.trim();

  if (!callerSessionId) throw AppError.badRequest('callerSessionId is required');
  if (!targetId) throw AppError.badRequest('targetAgentConfigId is required');
  if (!prompt) throw AppError.badRequest('prompt is required');

  const sessionRepo = new AgentSessionsRepository();
  const callerSession = sessionRepo.findById(callerSessionId);
  if (!callerSession) throw AppError.badRequest('caller session not found');
  if (callerSession.ownerUserId !== input.authenticatedUserId) {
    throw AppError.forbidden('caller session is owned by another user');
  }
  if (
    callerSession.isSystem ||
    callerSession.scheduledTaskId !== null ||
    callerSession.category !== 'chat'
  ) {
    throw AppError.forbidden('async delegation is only available in interactive chat sessions');
  }

  const callerId = (callerSession.mcpRole ?? callerSession.agentKind)?.trim();
  if (!callerId) throw AppError.forbidden('caller session has no agent profile');
  if (claimedCallerId && claimedCallerId !== callerId) {
    throw AppError.forbidden('callerAgentConfigId does not match caller session');
  }
  if (callerId === targetId) throw AppError.badRequest('self-delegation is not allowed');

  const parentSdkSessionId =
    callerSession.sdkSessionId ?? opencodeSessionMap.get(callerSession.id) ?? null;
  if (!parentSdkSessionId) {
    throw AppError.badRequest('caller session is not attached to the engine');
  }

  const childDepth = callerSession.delegationDepth + 1;
  if (childDepth > MAX_DELEGATION_DEPTH) {
    throw AppError.badRequest('delegation depth limit exceeded');
  }

  const configRepo = new AgentConfigsRepository();
  const caller = requireExecutableProfile(configRepo, callerId, 'caller');
  if (!caller.isManager || !caller.sessionSelectable) {
    throw AppError.forbidden('caller profile is not allowed to use interactive async delegation');
  }
  if (hasExplicitAsyncDelegationDeny(caller.corePermissionsJson)) {
    throw AppError.forbidden('caller profile denies rhythm_delegate_async');
  }
  if (!parseAllowedDelegates(caller.allowedDelegatesJson).has(targetId)) {
    throw AppError.forbidden('target profile is not an allowed delegate');
  }

  const target = requireExecutableProfile(configRepo, targetId, 'target');
  if (!target.isAgent) {
    throw AppError.badRequest('target profile is not runnable');
  }

  // Re-read both profiles at the first engine boundary. The caller/target rows
  // can be security-locked after the initial roster checks above; a stale
  // in-memory object must never authorize creation of an executable child.
  requireExecutableProfile(configRepo, callerId, 'caller');
  requireExecutableProfile(configRepo, targetId, 'target');
  const profileScope = await resolveProfileScope(targetId);
  const skillNames = parseSkillNames(profileScope.allowedSkillsJson);
  const scopedPrompt = input.context?.trim()
    ? `${input.context.trim()}\n\n${prompt}`
    : prompt;
  const childTitle = `Async delegation: ${target.label} (@${targetId} subagent)`;
  const childSession = await opencodeClient.createSession(
    childTitle,
    callerSession.cwd,
    profileScope.mcpRoleConfig ?? undefined,
    skillNames,
    profileScope.model.providerID,
    parentSdkSessionId,
  );
  if (!childSession?.id) {
    throw AppError.internal('failed to create async delegated child session');
  }

  const childRow = sessionRepo.upsertChildSession(
    childSession.id,
    parentSdkSessionId,
    childTitle,
    callerSession.cwd,
    profileScope.mcpRoleConfig?.allowedToolsJson ?? null,
  );
  if (!childRow) {
    throw AppError.internal('failed to persist async delegated child session');
  }

  opencodeSessionMap.set(childRow.id, childSession.id);
  sessionRepo.updatePermissionMode(childRow.id, 'bypassPermissions');
  sessionRepo.updateStatus(childRow.id, 'working');

  const delegationRepo = new AgentAsyncDelegationsRepository();
  let delegationPersisted = false;
  try {
    delegationRepo.create({
      parentSessionId: callerSession.id,
      childSessionId: childRow.id,
      targetAgentConfigId: targetId,
    });
    delegationPersisted = true;

    // Subscribe before enqueue so a very fast child cannot finish before the
    // bridge has a route for its first message/status event.
    const { streamBridge } = await import('./opencode_stream_bridge');
    await streamBridge.streamSession(childRow.id, childSession.id, callerSession.cwd);

    // This is the actual execution boundary. Re-read both profiles after the
    // awaited stream subscription so a lock applied during setup wins.
    requireExecutableProfile(configRepo, callerId, 'caller');
    requireExecutableProfile(configRepo, targetId, 'target');

    const runningAsOwnAgent =
      profileScope.ocAgent !== null && profileScope.ocAgent === targetId;
    const promptOpts: Record<string, unknown> = {
      permissionMode: 'bypassPermissions',
      ...(profileScope.ocAgent ? { agent: profileScope.ocAgent } : {}),
      ...(profileScope.systemPrompt && !runningAsOwnAgent
        ? { system: profileScope.systemPrompt }
        : {}),
    };
    const enqueued = await opencodeClient.promptAsync(
      childSession.id,
      scopedPrompt,
      profileScope.model,
      callerSession.cwd,
      promptOpts,
    );
    if (!enqueued) {
      throw AppError.internal('failed to enqueue async delegated prompt');
    }
  } catch (error) {
    const failure = dispatchFailureMessage(error);
    if (delegationPersisted) {
      delegationRepo.markDispatchFailed(childRow.id, failure);
    }
    sessionRepo.setErrorStatus(childRow.id, failure);
    throw error instanceof AppError
      ? error
      : AppError.internal('async delegation dispatch failed');
  }

  return {
    sessionId: childRow.id,
    sdkSessionId: childSession.id,
    status: 'dispatched',
    targetAgentConfigId: targetId,
    message: `Dispatched to ${target.label}; you'll be notified when it's done.`,
  };
}
