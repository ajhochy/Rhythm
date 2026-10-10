import { syncAutoAccountSessionProvenance } from './decision/capacity_router';
import { AppError } from '../errors/app_error';
import {
  CODING_WORKFLOW_ADAPTER,
  CODING_WORKFLOW_DISPATCH_REASON,
  parseCodingWorkflowDispatchReceipt,
  type CodingWorkflowAuthorization,
  type CodingWorkflowDispatchReceipt,
  type CodingWorkflowEngineIdentity,
} from '../contracts/coordinator_conversation_contract';
import type { WorkflowBinding } from '../contracts/dayflow_provider_admission_contract';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { run as runAgent } from './agent_runner';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { isInteractiveChatSession } from './opencode_client_service';
import { resolveProfileScope } from './agent_profile_scope';
import { listAgentModelCatalog } from '../routes/agents_models_routes';

/**
 * Server-only input for ONE fixed Coding Workflow child (G2 first adapter). It
 * carries no tool, permission or model authority; it only asks the existing
 * delegation->prompt boundary to export its exact pre-SDK identity.
 */
export interface CodingWorkflowDispatchInput {
  authorization: CodingWorkflowAuthorization;
  /** Server-owned outer job/expiry; absent is never eligible for native enrollment. */
  workflowBinding?: Pick<WorkflowBinding, 'jobId' | 'expiresAt'>;
  /** Exact project the caller session must still belong to. */
  expectedProjectId: string;
  /** Current admission/owner/epoch/permission proof at each awaited phase. */
  validate(phase: 'prepare' | 'before_sdk' | 'sdk_exposure'): boolean | Promise<boolean>;
  /** Synchronous proof, run after the last await and immediately before the SDK request. */
  isCurrent(): boolean;
  /**
   * Persist the full durable manager/delegation/native-anchor join before the
   * SDK request. This hook is intentionally synchronous: any storage refusal
   * prevents exposure rather than becoming a best-effort receipt.
   */
  onPrepared?(binding: CodingWorkflowPreparedBinding): boolean;
  /**
   * Install the native schema-2 marker after `onPrepared` succeeded. The
   * client revalidates all authority after this await before SDK exposure.
   */
  enroll?(binding: CodingWorkflowPreparedBinding): Promise<boolean>;
  /** Persist the real delivery outcome; unknown is never retryable. */
  onOutcome?(binding: CodingWorkflowPreparedBinding & { delivery: 'accepted' | 'unknown' | 'rejected' }): void;
}

/** Private pre-SDK binding; this is a receipt shape without a delivery claim. */
export interface CodingWorkflowPreparedBinding {
  authorization: CodingWorkflowAuthorization;
  workflowBinding: WorkflowBinding;
  owner: CodingWorkflowDispatchReceipt['owner'];
  delegation: CodingWorkflowDispatchReceipt['delegation'];
  dispatch: { dispatchId: string; sdkUserMessageId: string };
  engine: CodingWorkflowEngineIdentity;
}

/**
 * Thrown only for the Coding Workflow path when the SDK request was attempted
 * but its delivery cannot be confirmed. The delegation row and child are left
 * as dispatched (never marked failed); the caller must hold the job unknown.
 */
export class CodingWorkflowDeliveryUnknownError extends AppError {
  constructor(public readonly receipt: CodingWorkflowDispatchReceipt | null) {
    super(502, 'DELIVERY_UNKNOWN', 'coding workflow delivery is unknown');
    this.name = 'CodingWorkflowDeliveryUnknownError';
  }
}

/** The one canonical profile the typed Coding Workflow adapter may dispatch to. */
const CODING_WORKFLOW_TARGET_PROFILE = 'workflow-orchestrator';

export interface AgentDelegationInput {
  authenticatedUserId: number;
  /** Optional typed Coding Workflow receipt export; absent = the unchanged path. */
  codingWorkflow?: CodingWorkflowDispatchInput;
  callerAgentConfigId?: string | null;
  targetAgentConfigId: string;
  prompt: string;
  callerSessionId: string;
  context?: string | null;
  cwd?: string | null;
  isolateWorktree?: boolean;
  worktreeName?: string;
  model?: unknown;
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
  /** Present only when the caller supplied `codingWorkflow` and delivery was accepted. */
  workflowReceipt?: CodingWorkflowDispatchReceipt;
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
export const MAX_DELEGATION_DEPTH = 2;

export function nextDelegationDepth(parentDepth: number): number {
  const depth = parentDepth + 1;
  if (depth > MAX_DELEGATION_DEPTH) {
    throw AppError.badRequest('delegation depth limit exceeded');
  }
  return depth;
}

export function parseAllowedDelegates(json: string | null): Set<string> {
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

export function requireExecutableProfile(
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

async function validateModelOverride(input: unknown): Promise<{
  providerID: string;
  modelID: string;
} | undefined> {
  if (input === undefined || input === null) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw AppError.badRequest('model override must include providerID and modelID');
  }
  const { providerID, modelID } = input as Record<string, unknown>;
  if (typeof providerID !== 'string' || typeof modelID !== 'string' || !providerID.trim() || !modelID.trim()) {
    throw AppError.badRequest('model override must include providerID and modelID');
  }
  const model = { providerID: providerID.trim(), modelID: modelID.trim() };
  const catalog = await listAgentModelCatalog();
  if (!catalog.some((entry) =>
    entry.provider === model.providerID && entry.modelId === model.modelID &&
    entry.authorized && entry.available !== false && entry.visible !== false,
  )) {
    throw AppError.badRequest(`model override is unknown or unauthorized: ${model.providerID}/${model.modelID}`);
  }
  return model;
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
  const childDepth = nextDelegationDepth(callerSession.delegationDepth);

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
  const modelOverride = await validateModelOverride(input.model);

  const scopedPrompt = input.context ? `${input.context.trim()}\n\n${prompt}` : prompt;
  const result = await runAgent({
    prompt: scopedPrompt,
    agentConfigId: targetId,
    agentKind: targetId,
    sessionName: `Delegated: ${target.label}`,
    outputTarget: 'session',
    cwd: input.cwd ?? undefined,
    ownerUserId: callerSession.ownerUserId,
    parentSessionId: callerSession.id,
    delegationDepth: childDepth,
    ...(modelOverride ? { modelOverride } : {}),
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
  // A specialist's profile supplies its tools, but dispatch must not turn an
  // interactive parent's selected permission mode into an automatic bypass.
  const permissionMode = callerSession.permissionMode;
  if (!['default', 'plan', 'acceptEdits', 'bypassPermissions'].includes(permissionMode)) {
    throw AppError.forbidden('caller permission mode is invalid');
  }
  /** The canonical root row's CURRENT project, re-read each call (never the initial snapshot). */
  const currentRootProject = (): string | null => sessionRepo.findById(callerSessionId)?.projectId ?? null;
  const assertPermissionScopeCurrent = (): void => {
    const current = sessionRepo.findById(callerSessionId);
    if (!current || current.ownerUserId !== input.authenticatedUserId ||
        current.permissionMode !== permissionMode) {
      throw AppError.forbidden('caller permission scope changed during async delegation');
    }
  };
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

  const childDepth = nextDelegationDepth(callerSession.delegationDepth);

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
  // The typed Coding Workflow adapter is fixed to the one canonical profile. This
  // narrows eligibility only (never widens allowedDelegates) and runs before any
  // worktree, child/native session or SDK/model effect; untyped delegation of
  // any other allowed specialist is unchanged.
  if (input.codingWorkflow && targetId !== CODING_WORKFLOW_TARGET_PROFILE) {
    throw AppError.forbidden('coding workflow is fixed to the workflow-orchestrator profile');
  }

  const target = requireExecutableProfile(configRepo, targetId, 'target');
  if (!target.isAgent) {
    throw AppError.badRequest('target profile is not runnable');
  }
  const modelOverride = await validateModelOverride(input.model);

  // Re-read both profiles at the first engine boundary. The caller/target rows
  // can be security-locked after the initial roster checks above; a stale
  // in-memory object must never authorize creation of an executable child.
  requireExecutableProfile(configRepo, callerId, 'caller');
  requireExecutableProfile(configRepo, targetId, 'target');
  const profileScope = await resolveProfileScope(targetId);
  const runModel = modelOverride ?? profileScope.model;
  const skillNames = parseSkillNames(profileScope.allowedSkillsJson);
  const scopedPrompt = input.context?.trim()
    ? `${input.context.trim()}\n\n${prompt}`
    : prompt;
  const childTitle = `Async delegation: ${target.label} (@${targetId} subagent)`;
  // Typed preflight BEFORE the optional worktree: exact expected project and the
  // current admission. The post-worktree block below is deliberately kept as the
  // fresh currency check after that await, before any child/model exposure.
  if (input.codingWorkflow) {
    if (callerSession.projectId !== input.codingWorkflow.expectedProjectId) {
      throw AppError.forbidden('coding workflow project scope does not match the caller session');
    }
    if ((await input.codingWorkflow.validate('prepare')) !== true) {
      throw AppError.forbidden('coding workflow admission is no longer current');
    }
    // The admission await can race a project change: re-read the CANONICAL root
    // (never the initial snapshot) synchronously, immediately before the worktree.
    if (currentRootProject() !== input.codingWorkflow.expectedProjectId) {
      throw AppError.forbidden('coding workflow project scope does not match the caller session');
    }
    assertPermissionScopeCurrent();
    // Durable hooks are required, but only AFTER the accepted project/admission
    // refusals so their reasons stay stable; still before any worktree/child/SDK.
    const hooks = input.codingWorkflow;
    if (
      !hooks.workflowBinding || typeof hooks.onPrepared !== 'function' ||
      typeof hooks.enroll !== 'function' || typeof hooks.onOutcome !== 'function'
    ) {
      throw AppError.forbidden('coding workflow durable enrollment is unavailable');
    }
  }
  let effectiveCwd = callerSession.cwd;
  let worktree: { name: string; path: string; branch: string | null } | null = null;
  if (input.isolateWorktree === true) {
    const created = await opencodeClient.createWorktree(callerSession.cwd, {
      name: input.worktreeName,
    });
    effectiveCwd = created.directory;
    worktree = {
      name: created.name,
      path: created.directory,
      branch: created.branch ?? null,
    };
  }
  assertPermissionScopeCurrent();
  const workflow = input.codingWorkflow;
  if (workflow) {
    // Currency boundary after the awaited preparation, BEFORE any child session:
    // the CURRENT project of the root (re-read, not the earlier snapshot) and,
    // when an awaited worktree was created since the preflight, the admission
    // proof again. Without that await the preflight proof is still the latest.
    if (currentRootProject() !== workflow.expectedProjectId) {
      throw AppError.forbidden('coding workflow project scope does not match the caller session');
    }
    if (worktree && (await workflow.validate('prepare')) !== true) {
      throw AppError.forbidden('coding workflow admission is no longer current');
    }
    // Again synchronously AFTER the awaited admission, immediately before the child session.
    if (currentRootProject() !== workflow.expectedProjectId) {
      throw AppError.forbidden('coding workflow project scope does not match the caller session');
    }
    assertPermissionScopeCurrent();
  }
  const childSession = await opencodeClient.createSession(
    childTitle,
    effectiveCwd,
    profileScope.mcpRoleConfig ?? undefined,
    skillNames,
    runModel.providerID,
    parentSdkSessionId,
    permissionMode,
    // The child inherits the caller's category/is_system/scheduled_task_id
    // (upsertResolvedChildSession), so it is interactive exactly when the
    // caller is — always, past the gate above. A manager child must also
    // delegate named profiles via rhythm_delegate_async.
    isInteractiveChatSession(callerSession),
  );
  if (!childSession?.id) {
    throw AppError.internal('failed to create async delegated child session');
  }

  const childRow = sessionRepo.upsertChildSession(
    childSession.id,
    parentSdkSessionId,
    childTitle,
    effectiveCwd,
    profileScope.mcpRoleConfig?.allowedToolsJson ?? null,
  );
  if (childRow) syncAutoAccountSessionProvenance(childRow);
  if (!childRow) {
    throw AppError.internal('failed to persist async delegated child session');
  }
  if (worktree) sessionRepo.setWorktree(childRow.id, worktree);

  opencodeSessionMap.set(childRow.id, childSession.id);
  sessionRepo.updatePermissionMode(childRow.id, permissionMode);
  sessionRepo.updateStatus(childRow.id, 'working');

  const delegationRepo = new AgentAsyncDelegationsRepository();
  let delegationPersisted = false;
  let delegationId: string | null = null;
  let preparedBinding: { dispatchId: string; sdkUserMessageId: string } | null = null;
  let preparedWorkflowBinding: CodingWorkflowPreparedBinding | null = null;
  let deliveryOutcome: 'accepted' | 'unknown' | 'rejected' | null = null;
  try {
    assertPermissionScopeCurrent();
    delegationId = delegationRepo.create({
      parentSessionId: callerSession.id,
      childSessionId: childRow.id,
      targetAgentConfigId: targetId,
    }).id;
    delegationPersisted = true;

    // Subscribe before enqueue so a very fast child cannot finish before the
    // bridge has a route for its first message/status event.
    const { streamBridge } = await import('./opencode_stream_bridge');
    await streamBridge.streamSession(childRow.id, childSession.id, effectiveCwd);

    // This is the actual execution boundary. Re-read both profiles after the
    // awaited stream subscription so a lock applied during setup wins.
    requireExecutableProfile(configRepo, callerId, 'caller');
    requireExecutableProfile(configRepo, targetId, 'target');
    assertPermissionScopeCurrent();
    if (sessionRepo.findById(childRow.id)?.permissionMode !== permissionMode) {
      throw AppError.forbidden('child permission scope changed during async delegation');
    }

    // The receipt names the exact engine process that will receive the request;
    // without a current identity nothing is sent.
    let engineIdentity: Awaited<ReturnType<typeof opencodeClient.getEngineIdentity>> = null;
    if (workflow) {
      engineIdentity = await opencodeClient.getEngineIdentity();
      if (!engineIdentity) throw AppError.internal('engine identity unavailable for coding workflow dispatch');
    }

    const runningAsOwnAgent =
      profileScope.ocAgent !== null && profileScope.ocAgent === targetId;
    const promptOpts: Record<string, unknown> = {
      permissionMode,
      ...(profileScope.ocAgent ? { agent: profileScope.ocAgent } : {}),
      ...(profileScope.systemPrompt && !runningAsOwnAgent
        ? { system: profileScope.systemPrompt }
        : {}),
    };
    const promptHead = [
      childSession.id,
      scopedPrompt,
      runModel,
      effectiveCwd,
      promptOpts,
      undefined,
      undefined,
      {
        sessionId: childRow.id,
        sdkSessionId: childSession.id,
        origin: 'delegation',
        requestedSource: 'agent_config',
        requestedProviderId: runModel.providerID,
        requestedModelId: runModel.modelID,
        resolvedProviderId: runModel.providerID,
        resolvedModelId: runModel.modelID,
        routeAuthed: null,
        finalProviderId: runModel.providerID,
        finalModelId: runModel.modelID,
        ...(workflow ? { reasonCode: CODING_WORKFLOW_DISPATCH_REASON } : {}),
      },
    ] as const;
    // Calls without the typed input keep their exact original argument list.
    const enqueued = workflow
      ? await opencodeClient.promptAsync(
        ...promptHead,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          kind: 'coding_workflow_dispatch_v1',
          // Every awaited phase re-proves the caller's owner/permission scope,
          // the child's permission scope and the admission itself.
          validate: async (phase) => {
            try {
              assertPermissionScopeCurrent();
              if (sessionRepo.findById(childRow.id)?.permissionMode !== permissionMode) return false;
              return (await workflow.validate(phase.phase)) === true;
            } catch {
              return false;
            }
          },
          isCurrent: () => {
            try {
              assertPermissionScopeCurrent();
              // Final synchronous fence: the canonical root's CURRENT project too.
              return currentRootProject() === workflow.expectedProjectId &&
                sessionRepo.findById(childRow.id)?.permissionMode === permissionMode &&
                workflow.isCurrent() === true;
            } catch {
              return false;
            }
          },
          onPrepared: (binding) => {
            if (!delegationId || !engineIdentity || callerSession.ownerUserId === null || !callerSession.projectId) {
              return false;
            }
            const prepared: CodingWorkflowPreparedBinding = {
              authorization: workflow.authorization,
              workflowBinding: {
                schemaVersion: 1,
                jobId: workflow.workflowBinding!.jobId,
                rootSdkSessionId: parentSdkSessionId,
                managerSdkSessionId: childSession.id,
                expiresAt: workflow.workflowBinding!.expiresAt,
              },
              owner: {
                ownerUserId: callerSession.ownerUserId,
                projectId: callerSession.projectId,
                rootSessionId: callerSession.id,
                rootSdkSessionId: parentSdkSessionId,
              },
              delegation: {
                delegationId,
                managerSessionId: childRow.id,
                managerSdkSessionId: childSession.id,
                nativeParentSdkSessionId: parentSdkSessionId,
              },
              dispatch: binding,
              engine: engineIdentity,
            };
            // A durable join is the source of truth.  Do not retain it locally
            // until the consumer confirmed its same-job CAS.
            if (workflow.onPrepared!(prepared) !== true) return false;
            preparedWorkflowBinding = prepared;
            preparedBinding = binding;
            return true;
          },
          enroll: async (binding) => {
            const prepared = preparedWorkflowBinding;
            if (!prepared || prepared.dispatch.dispatchId !== binding.dispatchId ||
                prepared.dispatch.sdkUserMessageId !== binding.sdkUserMessageId) return false;
            return (await workflow.enroll!(prepared)) === true;
          },
          onOutcome: (outcome) => {
            deliveryOutcome = outcome.delivery;
            const prepared = preparedWorkflowBinding;
            if (!prepared || prepared.dispatch.dispatchId !== outcome.dispatchId ||
                prepared.dispatch.sdkUserMessageId !== outcome.sdkUserMessageId) return;
            workflow.onOutcome!({ ...prepared, delivery: outcome.delivery });
          },
        },
      )
      : await opencodeClient.promptAsync(...promptHead);
    if (workflow) {
      const prepared = preparedBinding as { dispatchId: string; sdkUserMessageId: string } | null;
      const delivery = deliveryOutcome as 'accepted' | 'unknown' | 'rejected' | null;
      const workflowReceiptBinding = preparedWorkflowBinding as CodingWorkflowPreparedBinding | null;
      const receipt = workflowReceiptBinding && prepared && (delivery === 'accepted' || delivery === 'unknown')
        ? parseCodingWorkflowDispatchReceipt({
          schemaVersion: 1,
          adapter: CODING_WORKFLOW_ADAPTER,
          authorization: workflowReceiptBinding.authorization,
          owner: workflowReceiptBinding.owner,
          delegation: workflowReceiptBinding.delegation,
          dispatch: { ...prepared, delivery },
          engine: workflowReceiptBinding.engine,
        })
        : null;
      if (delivery === 'unknown' || (enqueued && !receipt)) {
        // The request left (or its identity cannot be exported): never claim
        // failure and never claim success. The caller holds the job unknown.
        throw new CodingWorkflowDeliveryUnknownError(receipt);
      }
      if (!enqueued) throw AppError.internal('failed to enqueue async delegated prompt');
      if (worktree) sessionRepo.setWorktree(childRow.id, worktree);
      return {
        sessionId: childRow.id,
        sdkSessionId: childSession.id,
        status: 'dispatched',
        targetAgentConfigId: targetId,
        message: `Dispatched to ${target.label}; you'll be notified when it's done.`,
        workflowReceipt: receipt!,
      };
    }
    if (!enqueued) {
      throw AppError.internal('failed to enqueue async delegated prompt');
    }
    if (worktree) sessionRepo.setWorktree(childRow.id, worktree);
  } catch (error) {
    // An unknown workflow delivery leaves the delegation/child dispatched: the
    // engine may be running it, so it is neither failed nor completed here.
    if (error instanceof CodingWorkflowDeliveryUnknownError) throw error;
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
