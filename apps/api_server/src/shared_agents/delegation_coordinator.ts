import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';

import type { AgentSession } from '../models/agent_session';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  MAX_DELEGATION_DEPTH,
  nextDelegationDepth,
  parseAllowedDelegates,
  requireExecutableProfile,
} from '../services/agent_delegation_service';
import { run as runAgent, type AgentRunResult } from '../services/agent_runner';
import { asyncDelegationCompletionService } from '../services/async_delegation_completion_service';
import { opencodeClient } from '../services/opencode_engine';
import { logger } from '../utils/logger';
import type { BridgeGrant } from './bridge_grants';
import { grantForUser } from './bridge_grants';
import {
  AgentBridgeJobsRepository,
  BridgeJobError,
  type AgentBridgeJobRow,
  type BridgeJobView,
} from './delegation_jobs_repository';
import { buildSharedAgent, effectiveDelegationPermission } from './projection_service';
import { AgentBridgeProjectionsRepository } from './projections_repository';
import type { ProjectionRule, SharedAgentSnapshotV2 } from './contract';
import { computeMemoryVaultId } from './memory_search_service';

export class BridgeDelegationError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string) {
    super(code);
    this.name = 'BridgeDelegationError';
  }
}

interface ParentReference { projectionId: string; sessionKey: string }

export interface DelegationCoordinatorDeps {
  jobs?: AgentBridgeJobsRepository;
  projections?: AgentBridgeProjectionsRepository;
  agentConfigs?: AgentConfigsRepository;
  runAgent?: typeof runAgent;
  now?: () => Date;
  onBridgeTerminal?: (parentSessionId: string) => Promise<void>;
}

function requestHash(target: string, prompt: string, context: string | null): string {
  return createHash('sha256').update(`${target}\0${prompt}\0${context ?? ''}`).digest('hex');
}

function effectForTarget(rules: ProjectionRule[], target: string): 'allow' | 'ask' | 'deny' {
  let effect: 'allow' | 'ask' | 'deny' = 'deny';
  for (const rule of rules) {
    if (rule.tool !== 'rhythm_delegate' || rule.argument !== 'targetAgentId') continue;
    if (rule.pattern === '*' || rule.pattern === target) effect = rule.effect;
  }
  return effect;
}

function currentRosterAllows(
  caller: ReturnType<AgentConfigsRepository['getById']> & {},
  targetId: string,
  roster: ReadonlyArray<ReturnType<AgentConfigsRepository['getById']> & {}>,
): boolean {
  if (!parseAllowedDelegates(caller.allowedDelegatesJson).has(targetId)) return false;
  return effectiveDelegationPermission(caller, roster, targetId) !== 'deny';
}

const claimWaiters = new Map<string, Set<() => void>>();

function claimWaiterKey(localUserId: number, profile: string): string {
  return `${localUserId}:${profile}`;
}

function notifyClaimWaiters(localUserId: number, profile: string): void {
  const key = claimWaiterKey(localUserId, profile);
  const waiters = claimWaiters.get(key);
  if (!waiters) return;
  claimWaiters.delete(key);
  for (const wake of waiters) wake();
}

function mapError(error: unknown): never {
  if (error instanceof BridgeDelegationError) throw error;
  if (error instanceof BridgeJobError) {
    throw new BridgeDelegationError(error.statusCode, error.code);
  }
  throw error;
}

function executable(
  repo: AgentConfigsRepository,
  profileId: string,
  role: 'caller' | 'target',
) {
  try { return requireExecutableProfile(repo, profileId, role); }
  catch {
    throw new BridgeDelegationError(
      role === 'caller' ? 409 : 409,
      role === 'caller' ? 'caller_unavailable' : 'target_unavailable',
    );
  }
}

export class DelegationCoordinator {
  private readonly jobs: AgentBridgeJobsRepository;
  private readonly projections: AgentBridgeProjectionsRepository;
  private readonly configs: AgentConfigsRepository;
  private readonly runner: typeof runAgent;
  private readonly clock: () => Date;
  private readonly terminal: (parentSessionId: string) => Promise<void>;

  constructor(deps: DelegationCoordinatorDeps = {}) {
    this.jobs = deps.jobs ?? new AgentBridgeJobsRepository();
    this.projections = deps.projections ?? new AgentBridgeProjectionsRepository();
    this.configs = deps.agentConfigs ?? new AgentConfigsRepository();
    this.runner = deps.runAgent ?? runAgent;
    this.clock = deps.now ?? (() => new Date());
    this.terminal = deps.onBridgeTerminal ??
      ((parentSessionId) => asyncDelegationCompletionService.onBridgeJobTerminal(parentSessionId));
  }

  private wakeParent(parentSessionId: string, jobId: string): void {
    void this.terminal(parentSessionId).catch((error) => {
      logger.error('[SharedAgents] failed to wake parent for terminal bridge job', {
        jobId,
        error: String(error),
      });
    });
  }

  async dispatchFromHermes(grant: BridgeGrant, input: {
    idempotencyKey: string;
    parent: ParentReference;
    targetAgentId: string;
    prompt: string;
    context?: string | null;
  }): Promise<{ job: BridgeJobView; replay: boolean }> {
    const parent = this.projections.getByProjectionAndSession(
      input.parent.projectionId,
      input.parent.sessionKey,
    );
    if (!parent || parent.local_user_id !== grant.localUserId || parent.hermes_profile !== grant.hermesProfile) {
      throw new BridgeDelegationError(404, 'projection_not_found');
    }
    if (parent.launch_kind !== 'interactive') {
      throw new BridgeDelegationError(403, 'caller_not_manager');
    }
    let frozen: SharedAgentSnapshotV2;
    try { frozen = JSON.parse(parent.snapshot_json) as SharedAgentSnapshotV2; }
    catch { throw new BridgeDelegationError(409, 'caller_unavailable'); }
    if (!frozen.allowed_tools.includes('rhythm_delegate')) {
      throw new BridgeDelegationError(403, 'caller_not_manager');
    }

    const caller = executable(this.configs, parent.agent_id, 'caller');
    if (!caller.isManager || !caller.sessionSelectable) {
      throw new BridgeDelegationError(403, 'caller_not_manager');
    }
    if (caller.id === input.targetAgentId) {
      throw new BridgeDelegationError(400, 'self_delegation');
    }
    if (effectForTarget(frozen.rules, input.targetAgentId) === 'deny') {
      throw new BridgeDelegationError(403, 'target_not_in_roster');
    }
    if (!currentRosterAllows(caller, input.targetAgentId, this.configs.list())) {
      throw new BridgeDelegationError(403, 'delegation_denied_by_policy');
    }
    const target = executable(this.configs, input.targetAgentId, 'target');
    if (!target.isAgent) throw new BridgeDelegationError(409, 'target_unavailable');
    const depth = nextDelegationDepth(parent.depth);
    const now = this.clock().toISOString();
    const context = input.context?.trim() || null;
    let cwd: string | null = null;
    if (parent.cwd) {
      try {
        cwd = await realpath(parent.cwd);
        if (cwd !== parent.cwd || frozen.paths.protected.some((path) => cwd === path || cwd!.startsWith(`${path}/`))) {
          cwd = null;
        }
      } catch { cwd = null; }
    }
    const created = this.jobs.createOrReplay({
      direction: 'hermes_to_rhythm',
      idempotencyKey: input.idempotencyKey,
      requestSha256: requestHash(input.targetAgentId, input.prompt, context),
      localUserId: grant.localUserId,
      hermesProfile: grant.hermesProfile,
      parentRuntime: 'hermes',
      parentRuntimeInstance: grant.runtimeGeneration,
      parentSessionId: parent.chain_id,
      parentAgentId: caller.id,
      parentProjectionId: parent.projection_id,
      targetAgentId: target.id,
      targetRevision: target.revision,
      targetRuntime: 'opencode',
      depth,
      chainId: parent.chain_id,
      prompt: input.prompt,
      context,
      cwd,
      now,
    });
    let allowMemoryPreface = false;
    if (grant.scopes.has('memory.search')) {
      const currentVaultId = await computeMemoryVaultId();
      allowMemoryPreface = currentVaultId !== null && currentVaultId === grant.memoryVaultId;
      if (!allowMemoryPreface) grant.scopes.delete('memory.search');
    }
    if (!created.replay) void this.executeHermesToRhythm(created.row, allowMemoryPreface);
    return { job: this.jobs.view(created.row), replay: created.replay };
  }

  private async executeHermesToRhythm(row: AgentBridgeJobRow, allowMemoryPreface: boolean): Promise<void> {
    let outcome: AgentRunResult;
    try {
      const caller = executable(this.configs, row.parent_agent_id, 'caller');
      if (!caller.isManager || !caller.sessionSelectable ||
          !currentRosterAllows(caller, row.target_agent_id, this.configs.list())) {
        throw new BridgeDelegationError(403, 'delegation_denied_by_policy');
      }
      const target = executable(this.configs, row.target_agent_id, 'target');
      outcome = await this.runner({
        prompt: row.context ? `${row.context}\n\n${row.prompt}` : row.prompt,
        agentConfigId: target.id,
        agentKind: target.id,
        sessionName: `Delegated from Hermes: ${target.label}`,
        outputTarget: 'session',
        cwd: row.cwd ?? undefined,
        ownerUserId: row.local_user_id,
        parentSessionId: null,
        delegationDepth: row.depth,
        bridgeOrigin: { allowMemoryPreface },
        onSessionCreated: (id) => { this.jobs.setChild(row.id, id); },
      });
    } catch (error) {
      outcome = { sessionId: '', status: 'error', result: '', error: String(error), errorCode: 'profile_unavailable' };
    }
    const terminal = this.jobs.completeFromRunner(row.id, outcome);
    if (terminal.parent_runtime === 'opencode') await this.terminal(terminal.parent_session_id);
  }

  queryFromHermes(grant: BridgeGrant, parent: ParentReference, jobId?: string): BridgeJobView[] {
    const projection = this.requireParent(grant, parent);
    return this.jobs.listForParent({
      localUserId: grant.localUserId,
      parentRuntime: 'hermes',
      parentSessionId: projection.chain_id,
      ...(jobId ? { jobId } : {}),
    }).map((row) => this.jobs.view(row));
  }

  resultFromHermes(grant: BridgeGrant, parent: ParentReference, jobId: string) {
    const projection = this.requireParent(grant, parent);
    const row = this.jobs.listForParent({
      localUserId: grant.localUserId,
      parentRuntime: 'hermes',
      parentSessionId: projection.chain_id,
      jobId,
    })[0];
    if (!row) throw new BridgeDelegationError(404, 'job_not_found');
    try {
      const delivered = this.jobs.readResult(jobId, this.clock().toISOString());
      return {
        jobId,
        state: delivered.state,
        untrusted: true as const,
        text: delivered.result_text ?? '',
        truncated: delivered.result_truncated === 1,
        deliveredAt: delivered.delivered_at,
      };
    } catch (error) { return mapError(error); }
  }

  async cancelFromHermes(grant: BridgeGrant, parent: ParentReference, jobId: string): Promise<BridgeJobView> {
    const projection = this.requireParent(grant, parent);
    const row = this.jobs.listForParent({
      localUserId: grant.localUserId,
      parentRuntime: 'hermes',
      parentSessionId: projection.chain_id,
      jobId,
    })[0];
    if (!row) throw new BridgeDelegationError(404, 'job_not_found');
    try {
      const cancelled = this.jobs.cancel(jobId, this.clock().toISOString());
      if (cancelled.child_session_id) {
        const child = new AgentSessionsRepository().findById(cancelled.child_session_id);
        if (child?.sdkSessionId) {
          try { await opencodeClient.abortSession(child.sdkSessionId, child.cwd); }
          catch { /* ledger cancellation remains authoritative */ }
        }
      }
      return this.jobs.view(cancelled);
    } catch (error) { return mapError(error); }
  }

  private requireParent(grant: BridgeGrant, parent: ParentReference) {
    const projection = this.projections.getByProjectionAndSession(parent.projectionId, parent.sessionKey);
    if (!projection || projection.local_user_id !== grant.localUserId || projection.hermes_profile !== grant.hermesProfile) {
      throw new BridgeDelegationError(404, 'projection_not_found');
    }
    return projection;
  }

  async dispatchToHermes(input: {
    localUserId: number;
    parent: AgentSession;
    targetAgentId: string;
    prompt: string;
    context?: string | null;
    idempotencyKey: string;
  }): Promise<BridgeJobView> {
    const grant = grantForUser(input.localUserId);
    if (!grant || !grant.scopes.has('delegation.execute') || grant.lastClaimAt === null ||
        this.clock().getTime() - grant.lastClaimAt >= 45_000) {
      throw new BridgeDelegationError(503, 'hermes_runtime_unavailable');
    }
    const callerId = (input.parent.mcpRole ?? input.parent.profileId ?? input.parent.agentKind)?.trim();
    if (!callerId) throw new BridgeDelegationError(409, 'caller_unavailable');
    const caller = executable(this.configs, callerId, 'caller');
    if (!caller.isManager || !caller.sessionSelectable ||
        !currentRosterAllows(caller, input.targetAgentId, this.configs.list())) {
      throw new BridgeDelegationError(403, 'delegation_denied_by_policy');
    }
    if (caller.id === input.targetAgentId) throw new BridgeDelegationError(400, 'self_delegation');
    const target = executable(this.configs, input.targetAgentId, 'target');
    const projected = await buildSharedAgent(target, {
      localUserId: input.localUserId,
      runtime: {
        owned: true,
        bridgeAvailable: true,
        connected: true,
        reported: grant.report !== null,
        executorFresh: true,
        providers: grant.report?.providers,
        reasoningEfforts: grant.report?.reasoningEfforts,
        terminalBackend: grant.report?.terminalBackend,
      },
      cwd: input.parent.cwd,
    });
    if (projected.runtimes.hermes.readiness !== 'supported' || !projected.runtimes.hermes.launchKinds.delegated) {
      throw new BridgeDelegationError(409, 'target_unavailable');
    }
    const depth = nextDelegationDepth(input.parent.delegationDepth);
    let cwd: string | null = null;
    try { cwd = await realpath(input.parent.cwd); } catch { cwd = null; }
    const context = input.context?.trim() || null;
    const created = this.jobs.createOrReplay({
      direction: 'rhythm_to_hermes',
      idempotencyKey: input.idempotencyKey,
      requestSha256: requestHash(target.id, input.prompt, context),
      localUserId: input.localUserId,
      hermesProfile: grant.hermesProfile,
      parentRuntime: 'opencode',
      parentRuntimeInstance: 'local',
      parentSessionId: input.parent.id,
      parentAgentId: caller.id,
      parentProjectionId: null,
      targetAgentId: target.id,
      targetRevision: target.revision,
      targetRuntime: 'hermes',
      depth,
      chainId: input.parent.id,
      prompt: input.prompt,
      context,
      cwd,
      now: this.clock().toISOString(),
    });
    if (!created.replay) notifyClaimWaiters(grant.localUserId, grant.hermesProfile);
    return this.jobs.view(created.row);
  }

  statusForOpenCode(localUserId: number, parentSessionId: string): BridgeJobView[] {
    for (const terminalParent of this.jobs.sweep(this.clock().toISOString())) {
      this.wakeParent(terminalParent, 'sweep');
    }
    return this.jobs.listForParent({ localUserId, parentRuntime: 'opencode', parentSessionId })
      .map((row) => this.jobs.view(row));
  }

  cancelForOpenCode(localUserId: number, parentSessionId: string, jobId: string): BridgeJobView {
    const row = this.jobs.listForParent({ localUserId, parentRuntime: 'opencode', parentSessionId, jobId })[0];
    if (!row) throw new BridgeDelegationError(404, 'job_not_found');
    try {
      return this.jobs.view(this.jobs.cancel(jobId, this.clock().toISOString()));
    } catch (error) {
      return mapError(error);
    }
  }

  async claimWithWait(
    grant: BridgeGrant,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<{ job: Record<string, unknown> } | null> {
    const immediate = this.claim(grant);
    if (immediate || waitMs === 0 || signal?.aborted) return immediate;
    const key = claimWaiterKey(grant.localUserId, grant.hermesProfile);
    await new Promise<void>((resolve) => {
      const waiters = claimWaiters.get(key) ?? new Set<() => void>();
      let timer: NodeJS.Timeout;
      const finish = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        waiters.delete(finish);
        if (waiters.size === 0) claimWaiters.delete(key);
        resolve();
      };
      waiters.add(finish);
      claimWaiters.set(key, waiters);
      timer = setTimeout(finish, waitMs);
      signal?.addEventListener('abort', finish, { once: true });
      // Close the insert-before-wait race without polling.
      if (this.jobs.hasQueued(grant.localUserId, grant.hermesProfile)) finish();
    });
    if (signal?.aborted) return null;
    return this.claim(grant);
  }

  claim(grant: BridgeGrant): { job: Record<string, unknown> } | null {
    const claimedAt = this.clock();
    grant.lastClaimAt = claimedAt.getTime();
    for (const terminalParent of this.jobs.sweep(claimedAt.toISOString())) {
      this.wakeParent(terminalParent, 'sweep');
    }
    const claimed = this.jobs.claimNext({
      localUserId: grant.localUserId,
      hermesProfile: grant.hermesProfile,
      runtimeGeneration: grant.runtimeGeneration,
      now: claimedAt.toISOString(),
    });
    if (!claimed) return null;
    const currentTarget = this.configs.getById(claimed.row.target_agent_id);
    if (!currentTarget) {
      const terminal = this.jobs.completeFromRunner(claimed.row.id, {
        status: 'error', result: '',
        error: 'target_unavailable', errorCode: 'profile_unavailable',
      }, claimedAt.toISOString());
      this.wakeParent(terminal.parent_session_id, terminal.id);
      throw new BridgeDelegationError(409, 'target_unavailable');
    }
    try {
      this.jobs.assertClaimProjection({
        jobId: claimed.row.id,
        leaseToken: claimed.leaseToken,
        targetRevision: currentTarget.revision,
        runtimeGeneration: grant.runtimeGeneration,
        cwd: claimed.row.cwd,
        now: claimedAt.toISOString(),
      });
    } catch (error) {
      const terminal = this.jobs.get(claimed.row.id);
      if (terminal?.state === 'failed') {
        this.wakeParent(terminal.parent_session_id, terminal.id);
      }
      return mapError(error);
    }
    return { job: {
      jobId: claimed.row.id,
      targetAgentId: claimed.row.target_agent_id,
      targetLabel: this.configs.getById(claimed.row.target_agent_id)?.label ?? claimed.row.target_agent_id,
      targetRevision: claimed.row.target_revision,
      prompt: claimed.row.prompt,
      context: claimed.row.context,
      cwd: claimed.row.cwd,
      depth: claimed.row.depth,
      chainId: claimed.row.chain_id,
      leaseToken: claimed.leaseToken,
      leaseExpiresAt: claimed.row.lease_expires_at,
    } };
  }

  report(grant: BridgeGrant, jobId: string, body: Parameters<AgentBridgeJobsRepository['report']>[0]): BridgeJobView & { cancelRequested: boolean; leaseExpiresAt: string | null } {
    const current = this.jobs.get(jobId);
    if (!current || current.local_user_id !== grant.localUserId || current.child_runtime_instance !== grant.runtimeGeneration) {
      throw new BridgeDelegationError(403, 'lease_invalid');
    }
    let row: AgentBridgeJobRow;
    try { row = this.jobs.report({ ...body, jobId }); }
    catch (error) { return mapError(error); }
    if (row.state === 'succeeded' || row.state === 'failed' || row.state === 'cancelled') {
      this.wakeParent(row.parent_session_id, row.id);
    }
    return { ...this.jobs.view(row), cancelRequested: row.cancel_requested_at !== null, leaseExpiresAt: row.lease_expires_at };
  }
}

export { MAX_DELEGATION_DEPTH };
