import { createHash } from 'node:crypto';

import {
  AgentAsyncDelegationsRepository,
} from '../repositories/agent_async_delegations_repository';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentSession } from '../models/agent_session';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { untrustedContext } from '../security/untrusted_fence';
import { getDb } from '../database/db';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { resolveProfileScope } from './agent_profile_scope';
import {
  AgentBridgeJobsRepository,
  type AgentBridgeJobRow,
} from '../shared_agents/delegation_jobs_repository';
import {
  isNativeWorkstreamDeliveryScope,
  projectNativeWorkstreamWake,
  renderNativeWorkstreamWake,
  type NativeWorkstreamDeliveryPolicy,
  type NativeWorkstreamDeliveryScope,
  type NativeWorkstreamWakeItem,
} from '../shared_agents/native_workstream_wake_contract';

const RESTART_RECOVERY_PARENT_LIMIT = 100;
const DISABLED_NATIVE_DELIVERY_POLICY: NativeWorkstreamDeliveryPolicy = {
  enabled: () => false,
  currentHostEpoch: () => null,
  isParentContextEligible: () => false,
};

interface NativeDeliveryContext {
  parent: AgentSession;
  parentSdkSessionId: string;
  scope: NativeWorkstreamDeliveryScope;
}

/**
 * Serializes and coalesces asynchronous child callbacks by parent session.
 *
 * Durable delivery state lives in agent_async_delegations. These maps only
 * prevent two SSE callbacks in this process from racing between the parent's
 * durable idle status and the engine's later busy event.
 */
export class AsyncDelegationCompletionService {
  private parentChains = new Map<string, Promise<void>>();
  private wakeInFlight = new Set<string>();
  private delegationsRepo = new AgentAsyncDelegationsRepository();
  private messagesRepo = new AgentSessionMessagesRepository();
  private sessionsRepo = new AgentSessionsRepository();
  private bridgeRestartRecovered = false;

  constructor(
    private readonly nativeDeliveryPolicy: NativeWorkstreamDeliveryPolicy =
      DISABLED_NATIVE_DELIVERY_POLICY,
  ) {}

  async onBridgeJobTerminal(parentSessionId: string): Promise<void> {
    await this.flushParent(parentSessionId);
  }

  /**
   * Production restart hook. Each query is bounded, but cursor pagination
   * continues through every stale parent so a restart cannot strand parent
   * 101 merely because the first page contained 100. Each selected parent's
   * logical batch is reconciled as one unit. The caller invokes this only
   * after the engine and persisted session mappings are ready.
   */
  async recoverAfterRestart(
    limit = RESTART_RECOVERY_PARENT_LIMIT,
  ): Promise<{ parentsExamined: number; claimsRemaining: number }> {
    const bridgeJobs = new AgentBridgeJobsRepository();
    if (!this.bridgeRestartRecovered) {
      bridgeJobs.recoverAfterRestart();
      this.bridgeRestartRecovered = true;
    }
    const pageSize = Math.max(
      1,
      Math.min(RESTART_RECOVERY_PARENT_LIMIT, Math.floor(limit)),
    );
    const examined = new Set<string>();
    let afterParentSessionId: string | null = null;

    while (true) {
      const parentIds = this.delegationsRepo.listWakingParentIds(
        pageSize,
        afterParentSessionId,
      );
      if (parentIds.length === 0) break;

      for (const parentSessionId of parentIds) {
        if (examined.has(parentSessionId)) {
          logger.warn(
            `[AsyncDelegation] restart recovery stopped after cursor made no progress at ${parentSessionId}`,
          );
          return {
            parentsExamined: examined.size,
            claimsRemaining: this.delegationsRepo.countWakingClaims(),
          };
        }
        examined.add(parentSessionId);
        await this.flushParent(parentSessionId);
      }

      const nextCursor = parentIds.at(-1)!;
      if (nextCursor === afterParentSessionId) break;
      afterParentSessionId = nextCursor;
    }

    for (const parentSessionId of bridgeJobs.listWakingParentIds(pageSize)) {
      if (!examined.has(parentSessionId)) {
        examined.add(parentSessionId);
        await this.flushParent(parentSessionId);
      }
    }

    const nativeEpoch = this.nativeDeliveryEpoch();
    if (nativeEpoch) {
      let nativeCursor: string | undefined;
      while (true) {
        if (this.nativeDeliveryEpoch() !== nativeEpoch) break;
        const scopes = bridgeJobs.listNativeWakingParentIds(
          nativeEpoch,
          pageSize,
          nativeCursor,
        );
        if (scopes.length === 0) break;
        for (const scope of scopes) {
          if (this.nativeDeliveryEpoch() !== nativeEpoch) break;
          const parent = this.sessionsRepo.findById(scope.parentSessionId);
          if (!parent) continue;
          const context = await this.resolveNativeDeliveryContext(parent);
          if (!context || !sameNativeScope(context.scope, scope)) continue;
          examined.add(scope.parentSessionId);
          await this.flushParent(scope.parentSessionId);
        }
        const nextCursor = scopes.at(-1)?.parentSessionId;
        if (!nextCursor || nextCursor === nativeCursor) break;
        nativeCursor = nextCursor;
      }
    }

    return {
      parentsExamined: examined.size,
      claimsRemaining: this.delegationsRepo.countWakingClaims(),
    };
  }

  async onChildIdle(childSessionId: string): Promise<void> {
    const delegation = this.delegationsRepo.findByChildSessionId(childSessionId);
    if (!delegation || delegation.status === 'notified' || delegation.status === 'failed') {
      return;
    }

    if (delegation.status === 'dispatched') {
      const messages = this.messagesRepo
        .listBySession(childSessionId, 500)
        .filter((message) => message.role === 'output' && message.rawText.trim().length > 0);
      const completionText =
        messages.at(-1)?.rawText.trim() || 'The delegated agent completed without a text result.';
      this.delegationsRepo.markCompleted(childSessionId, completionText);
    }

    await this.flushParent(delegation.parentSessionId);
  }

  async onChildFailed(childSessionId: string, errorText: string): Promise<void> {
    const delegation = this.delegationsRepo.findByChildSessionId(childSessionId);
    if (!delegation || delegation.status !== 'dispatched') return;
    this.delegationsRepo.markFailed(childSessionId, errorText);
    await this.flushParent(delegation.parentSessionId);
  }

  async onParentIdle(parentSessionId: string): Promise<void> {
    // An accepted callback prompt owns this marker until its resulting parent
    // turn reaches the next idle boundary. Only then may another batch wake it.
    this.wakeInFlight.delete(parentSessionId);
    await this.flushParent(parentSessionId);
  }

  private async flushParent(parentSessionId: string): Promise<void> {
    const previous = this.parentChains.get(parentSessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.flushParentLocked(parentSessionId));
    this.parentChains.set(parentSessionId, current);
    try {
      await current;
    } finally {
      if (this.parentChains.get(parentSessionId) === current) {
        this.parentChains.delete(parentSessionId);
      }
    }
  }

  private async flushParentLocked(parentSessionId: string): Promise<void> {
    if (this.wakeInFlight.has(parentSessionId)) return;

    const parent = this.sessionsRepo.findById(parentSessionId);
    if (!parent) return;

    const nativeContext = await this.resolveNativeDeliveryContext(parent);
    let nativeReady = false;
    if (nativeContext) {
      nativeReady = await this.reconcileNativeWakingClaims(nativeContext);
      if (!nativeReady && this.hasLegacyWakingClaims(parent.id)) {
        // These claims may be one accepted mixed batch. Without a qualified
        // native receipt, mutating the legacy half could create a duplicate.
        return;
      }
    }

    // A process can die after the engine accepts a wake but before SQLite is
    // marked notified. Resolve that ambiguity before considering any retry.
    // A deterministic engine message id plus transcript inspection makes an
    // already-accepted wake observable and prevents duplicate parent turns.
    const wakingReady = await this.reconcileWakingClaims(parent);
    if (!wakingReady) return;

    if (parent.status === 'starting' || parent.status === 'working') return;

    const parentAgentConfigId = (parent.mcpRole ?? parent.agentKind)?.trim() || null;
    const initialBlockReason = this.parentExecutionBlockReason(
      parentAgentConfigId,
    );
    if (initialBlockReason) {
      logger.warn(
        `[AsyncDelegation] parent ${parent.id} remains queued: ${initialBlockReason}`,
      );
      return;
    }

    const claimed = this.delegationsRepo.claimCompletedForParent(parentSessionId);
    const bridgeRepo = new AgentBridgeJobsRepository();
    const bridgeClaimed = bridgeRepo.claimCompletedForParent(parentSessionId);
    const ids = claimed.map((delegation) => delegation.id);
    const bridgeIds = bridgeClaimed.map((delegation) => delegation.id);
    const wakeDelegations: WakeDelegation[] = [
      ...claimed,
      ...bridgeClaimed.map(bridgeWakeDelegation),
    ];
    let nativeRows: AgentBridgeJobRow[] = [];
    if (nativeContext && nativeReady
        && await this.nativeContextStillEligible(nativeContext)) {
      nativeRows = bridgeRepo.claimNativeCompletedForParent(nativeContext.scope);
    }
    const projectedNative = nativeRows.flatMap((nativeRow) => {
      const projection = projectNativeWorkstreamWake(nativeRow);
      if (!projection.ok) {
        logger.warn(
          `[AsyncDelegation] native delivery held code=projection_${projection.code}`,
        );
        return [];
      }
      return [projection.item];
    });
    if (wakeDelegations.length === 0 && projectedNative.length === 0) return;

    let activeNative = projectedNative;
    if (activeNative.length > 0 && nativeContext
        && !await this.nativeContextStillEligible(nativeContext)) {
      activeNative = [];
    }
    if (wakeDelegations.length === 0 && activeNative.length === 0) return;

    let parentSdkSessionId = activeNative.length > 0
      ? nativeContext?.parentSdkSessionId ?? null
      : parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
    if (!parentSdkSessionId) {
      this.delegationsRepo.releaseClaims(ids);
      bridgeRepo.releaseDeliveryClaims(bridgeIds);
      if (nativeContext) {
        await this.releaseNativeClaimsIfEligible(
          bridgeRepo,
          nativeContext,
          activeNative.map((item) => item.jobId),
        );
      }
      logger.warn(
        `[AsyncDelegation] parent ${parent.id} has no engine session; completion remains queued`,
      );
      return;
    }

    const profileScope = await resolveProfileScope(parentAgentConfigId);
    const executionBlockReason = this.parentExecutionBlockReason(
      parentAgentConfigId,
    );
    if (executionBlockReason) {
      this.delegationsRepo.releaseClaims(ids);
      if (nativeContext) {
        await this.releaseNativeClaimsIfEligible(
          bridgeRepo,
          nativeContext,
          activeNative.map((item) => item.jobId),
        );
      }
      logger.warn(
        `[AsyncDelegation] parent ${parent.id} locked before wake; completion remains queued: ${executionBlockReason}`,
      );
      return;
    }
    const runningAsOwnAgent =
      profileScope.ocAgent !== null && profileScope.ocAgent === parentAgentConfigId;
    // `messageID` is deliberately NOT forwarded to the engine.
    //
    // Engine message ids are `msg_` + 12 HEX characters encoding a timestamp +
    // random base62 (Identifier.create in the fork's id/id.ts), and the engine
    // orders a session's messages by that decoded timestamp. Our deterministic id
    // is `msg_rhythm_async_<sha256>`, whose characters 4..16 are `rhythm_async` —
    // not hex — so `Identifier.timestamp()` cannot decode it and the wake message
    // has no position in time. The engine therefore never saw the wake as the
    // latest, answered message: every reply the parent produced got a correctly
    // ordered id that sorted BEFORE the unplaceable wake, so it re-invoked the
    // model forever. Observed 2026-08-05 — a single wake produced 56 assistant
    // turns ("OK", "OK", "OK"…) until the session was cancelled.
    //
    // Idempotency does not need it: `wasWakeDelivered` matches on the delivery
    // MARKER embedded in the wake text, and the id branch there is only a
    // redundant fast path (kept for wakes delivered before this fix). Letting the
    // engine assign the id restores correct ordering and ends the turn normally.
    const promptOpts: Record<string, unknown> = {
      permissionMode: parent.permissionMode,
      ...(profileScope.ocAgent ? { agent: profileScope.ocAgent } : {}),
      ...(profileScope.systemPrompt && !runningAsOwnAgent
        ? { system: profileScope.systemPrompt }
        : {}),
    };

    if (activeNative.length > 0 && nativeContext) {
      if (!await this.nativeContextStillEligible(nativeContext)) {
        activeNative = [];
        parentSdkSessionId = parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
      } else {
        // This synchronous read is deliberately adjacent to enqueue. It
        // rechecks the exact claimed IDs against current ready/revision scope
        // after every awaited policy/profile step.
        activeNative = this.refreshClaimedNativeItems(
          bridgeRepo,
          nativeContext,
          activeNative,
        );
      }
    }
    if (activeNative.length === 0) {
      parentSdkSessionId = parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
    }
    if (!parentSdkSessionId
        || (wakeDelegations.length === 0 && activeNative.length === 0)) {
      this.delegationsRepo.releaseClaims(ids);
      bridgeRepo.releaseDeliveryClaims(bridgeIds);
      return;
    }

    const messageID = activeNative.length > 0 && nativeContext
      ? this.nativeDeliveryMessageId(
        wakeDelegations,
        activeNative,
        nativeContext.scope.hostEpoch,
      )
      : this.deliveryMessageId(wakeDelegations);
    const wakeText = activeNative.length > 0
      ? this.buildNativeWakeText(wakeDelegations, activeNative, messageID)
      : this.buildWakeText(wakeDelegations, messageID);

    this.wakeInFlight.add(parentSessionId);
    let deliveryUnknown = false;
    const attemptedNative = activeNative.length > 0 && nativeContext
      ? { context: nativeContext, items: activeNative }
      : null;
    try {
      const enqueued = await opencodeClient.promptAsync(
        parentSdkSessionId,
        wakeText,
        profileScope.model,
        parent.cwd,
        promptOpts,
        undefined,
        undefined,
        {
          sessionId: parentSessionId,
          sdkSessionId: parentSdkSessionId,
          origin: 'delegation_completion',
          requestedSource: 'agent_config',
          requestedProviderId: profileScope.model?.providerID ?? null,
          requestedModelId: profileScope.model?.modelID ?? null,
          resolvedProviderId: profileScope.model?.providerID ?? null,
          resolvedModelId: profileScope.model?.modelID ?? null,
          routeAuthed: null,
          finalProviderId: profileScope.model?.providerID ?? null,
          finalModelId: profileScope.model?.modelID ?? null,
        },
      );
      if (!enqueued) {
        let nativeDelivered = attemptedNative
          ? wakeDelegations.length > 0
            ? await this.wasMixedWakeDelivered(
              attemptedNative.context,
              attemptedNative.items,
              wakeDelegations,
            )
            : await this.wasNativeWakeDelivered(
              attemptedNative.context,
              attemptedNative.items,
              wakeDelegations,
            )
          : null;
        if (nativeDelivered === true) {
          const acknowledged = wakeDelegations.length > 0
            ? await this.markMixedDeliveredIfEligible(
              bridgeRepo,
              attemptedNative!.context,
              attemptedNative!.items.map((item) => item.jobId),
              ids,
              bridgeIds,
            )
            : await this.markNativeDeliveredIfEligible(
              bridgeRepo,
              attemptedNative!.context,
              attemptedNative!.items.map((item) => item.jobId),
            );
          if (!acknowledged) nativeDelivered = null;
        }
        const delivered = attemptedNative
          ? nativeDelivered
          : await this.wasWakeDelivered(parent, wakeDelegations);
        if (delivered === true && wakeDelegations.length > 0) {
          if (!attemptedNative) {
            this.delegationsRepo.markNotified(ids);
            bridgeRepo.markDelivered(bridgeIds);
          }
          logger.info(
            `[AsyncDelegation] recovered accepted parent wake ${messageID} after an ambiguous enqueue result`,
          );
          return;
        }
        deliveryUnknown = delivered === null;
        logger.warn(
          `[AsyncDelegation] engine rejected parent wake for ${parentSessionId}; ` +
            `${deliveryUnknown ? 'claim retained pending delivery inspection' : 'callbacks re-queued'}`,
        );
        return;
      }

      this.delegationsRepo.markNotified(ids);
      bridgeRepo.markDelivered(bridgeIds);
      if (attemptedNative) {
        await this.markNativeDeliveredIfEligible(
          bridgeRepo,
          attemptedNative.context,
          attemptedNative.items.map((item) => item.jobId),
        );
      }
      logger.info(
        `[AsyncDelegation] woke parent ${parentSessionId} with ` +
          `${claimed.length} completed delegate(s) and ${activeNative.length} native status item(s)`,
      );
    } catch (error) {
      let nativeDelivered = attemptedNative
        ? wakeDelegations.length > 0
          ? await this.wasMixedWakeDelivered(
            attemptedNative.context,
            attemptedNative.items,
            wakeDelegations,
          )
          : await this.wasNativeWakeDelivered(
            attemptedNative.context,
            attemptedNative.items,
            wakeDelegations,
          )
        : null;
      if (nativeDelivered === true) {
        const acknowledged = wakeDelegations.length > 0
          ? await this.markMixedDeliveredIfEligible(
            bridgeRepo,
            attemptedNative!.context,
            attemptedNative!.items.map((item) => item.jobId),
            ids,
            bridgeIds,
          )
          : await this.markNativeDeliveredIfEligible(
            bridgeRepo,
            attemptedNative!.context,
            attemptedNative!.items.map((item) => item.jobId),
          );
        if (!acknowledged) nativeDelivered = null;
      }
      const delivered = attemptedNative
        ? nativeDelivered
        : await this.wasWakeDelivered(parent, wakeDelegations);
      if (delivered === true && wakeDelegations.length > 0) {
        if (!attemptedNative) {
          this.delegationsRepo.markNotified(ids);
          bridgeRepo.markDelivered(bridgeIds);
        }
        logger.info(
          `[AsyncDelegation] recovered accepted parent wake ${messageID} after enqueue exception`,
        );
        return;
      }
      deliveryUnknown = delivered === null;
      throw error;
    } finally {
      this.wakeInFlight.delete(parentSessionId);
      if (!deliveryUnknown) {
        this.delegationsRepo.releaseClaims(ids);
        bridgeRepo.releaseDeliveryClaims(bridgeIds);
      }
    }
  }

  private hasLegacyWakingClaims(parentSessionId: string): boolean {
    if (this.delegationsRepo.listWakingForParent(parentSessionId).length > 0) {
      return true;
    }
    return new AgentBridgeJobsRepository()
      .listWakingForParent(parentSessionId)
      .length > 0;
  }

  private hasNativeWakingClaims(parentSessionId: string): boolean {
    try {
      const row = getDb().prepare(`SELECT 1 FROM agent_bridge_jobs
        WHERE parent_runtime='opencode' AND parent_session_id=?
          AND direction='rhythm_to_native' AND delivery_state='waking'
          AND COALESCE(native_execution_kind, 'legacy') <> 'coordinator'
        LIMIT 1`).get(parentSessionId);
      return Boolean(row);
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=waking_inspection_exception',
      );
      return true;
    }
  }

  private refreshClaimedNativeItems(
    repository: AgentBridgeJobsRepository,
    context: NativeDeliveryContext,
    claimed: NativeWorkstreamWakeItem[],
  ): NativeWorkstreamWakeItem[] {
    const claimedIds = new Set(claimed.map((item) => item.jobId));
    const refreshed: NativeWorkstreamWakeItem[] = [];
    for (const row of repository.listNativeWakingForParent(context.scope)) {
      if (!claimedIds.has(row.id)) continue;
      const projection = projectNativeWorkstreamWake(row);
      if (!projection.ok) {
        logger.warn(
          `[AsyncDelegation] native delivery held code=projection_${projection.code}`,
        );
        continue;
      }
      refreshed.push(projection.item);
    }
    if (refreshed.length !== claimed.length) {
      logger.warn('[AsyncDelegation] native delivery held code=claimed_scope_changed');
    }
    return refreshed;
  }

  private nativeDeliveryEpoch(): string | null {
    try {
      if (!env.workstreamsEnabled
          || env.dbClient !== 'sqlite'
          || env.role === 'cloud'
          || env.role === 'relay'
          || !this.nativeDeliveryPolicy.enabled()) {
        return null;
      }
      const epoch = this.nativeDeliveryPolicy.currentHostEpoch();
      return typeof epoch === 'string' && epoch.length > 0 ? epoch : null;
    } catch {
      logger.warn('[AsyncDelegation] native delivery held code=gate_exception');
      return null;
    }
  }

  private nativeDeliveryContextForParent(
    parent: AgentSession,
  ): NativeDeliveryContext | null {
    const hostEpoch = this.nativeDeliveryEpoch();
    if (!hostEpoch || parent.ownerUserId === null || !parent.projectId) return null;
    const parentSdkSessionId =
      opencodeSessionMap.get(parent.id) ?? parent.sdkSessionId ?? null;
    if (!parentSdkSessionId) return null;
    const scope: NativeWorkstreamDeliveryScope = {
      localUserId: parent.ownerUserId,
      projectId: parent.projectId,
      parentSessionId: parent.id,
      hostEpoch,
    };
    if (!isNativeWorkstreamDeliveryScope(scope)) return null;
    return { parent, parentSdkSessionId, scope };
  }

  private async resolveNativeDeliveryContext(
    parent: AgentSession,
  ): Promise<NativeDeliveryContext | null> {
    const initial = this.nativeDeliveryContextForParent(parent);
    if (!initial) return null;
    let eligible = false;
    try {
      eligible = await this.nativeDeliveryPolicy.isParentContextEligible(
        initial.parent,
        initial.scope,
      );
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=context_policy_exception',
      );
      return null;
    }
    if (!eligible) return null;
    const refreshedParent = this.sessionsRepo.findById(parent.id);
    if (!refreshedParent) return null;
    const refreshed = this.nativeDeliveryContextForParent(refreshedParent);
    if (!refreshed
        || !sameNativeScope(initial.scope, refreshed.scope)
        || initial.parentSdkSessionId !== refreshed.parentSdkSessionId) {
      return null;
    }
    return refreshed;
  }

  private async nativeContextStillEligible(
    context: NativeDeliveryContext,
  ): Promise<boolean> {
    const parent = this.sessionsRepo.findById(context.parent.id);
    if (!parent) return false;
    const current = this.nativeDeliveryContextForParent(parent);
    if (!current
        || !sameNativeScope(context.scope, current.scope)
        || context.parentSdkSessionId !== current.parentSdkSessionId) {
      return false;
    }
    let eligible = false;
    try {
      eligible = await this.nativeDeliveryPolicy.isParentContextEligible(
        current.parent,
        current.scope,
      );
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=context_recheck_exception',
      );
      return false;
    }
    if (!eligible) return false;
    const afterAwait = this.sessionsRepo.findById(context.parent.id);
    if (!afterAwait) return false;
    const finalContext = this.nativeDeliveryContextForParent(afterAwait);
    return Boolean(finalContext
      && sameNativeScope(context.scope, finalContext.scope)
      && context.parentSdkSessionId === finalContext.parentSdkSessionId);
  }

  private async releaseNativeClaimsIfEligible(
    repository: AgentBridgeJobsRepository,
    context: NativeDeliveryContext,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0 || !await this.nativeContextStillEligible(context)) return;
    repository.releaseNativeDeliveryClaims(context.scope, ids);
  }

  private async markNativeDeliveredIfEligible(
    repository: AgentBridgeJobsRepository,
    context: NativeDeliveryContext,
    ids: string[],
  ): Promise<boolean> {
    if (ids.length === 0 || !await this.nativeContextStillEligible(context)) {
      return false;
    }
    repository.markNativeDelivered(context.scope, ids);
    return true;
  }

  private async markMixedDeliveredIfEligible(
    repository: AgentBridgeJobsRepository,
    context: NativeDeliveryContext,
    nativeIds: string[],
    asyncLegacyIds: string[],
    bridgeLegacyIds: string[],
  ): Promise<boolean> {
    if (nativeIds.length === 0
        || (asyncLegacyIds.length === 0 && bridgeLegacyIds.length === 0)
        || !await this.nativeContextStillEligible(context)) {
      return false;
    }
    let acknowledged = false;
    getDb().transaction(() => {
      const eligibleIds = new Set(
        repository.listNativeWakingForParent(context.scope).map((row) => row.id),
      );
      if (!nativeIds.every((id) => eligibleIds.has(id))) return;
      const currentAsyncLegacyIds = new Set(
        this.delegationsRepo.listWakingForParent(context.scope.parentSessionId)
          .map((delegation) => delegation.id),
      );
      const currentBridgeLegacyIds = new Set(
        repository.listWakingForParent(context.scope.parentSessionId)
          .map((delegation) => delegation.id),
      );
      if (!asyncLegacyIds.every((id) => currentAsyncLegacyIds.has(id))
          || !bridgeLegacyIds.every((id) => currentBridgeLegacyIds.has(id))) {
        return;
      }
      repository.markNativeDelivered(context.scope, nativeIds);
      this.delegationsRepo.markNotified(asyncLegacyIds);
      repository.markDelivered(bridgeLegacyIds);
      acknowledged = true;
    }).immediate();
    return acknowledged;
  }

  private async reconcileNativeWakingClaims(
    context: NativeDeliveryContext,
  ): Promise<boolean> {
    if (!await this.nativeContextStillEligible(context)) return false;
    const repository = new AgentBridgeJobsRepository();
    const rows = repository.listNativeWakingForParent(context.scope);
    if (rows.length === 0) {
      return !this.hasNativeWakingClaims(context.scope.parentSessionId);
    }
    const items: NativeWorkstreamWakeItem[] = [];
    for (const row of rows) {
      const projection = projectNativeWorkstreamWake(row);
      if (!projection.ok) {
        logger.warn(
          `[AsyncDelegation] native delivery held code=projection_${projection.code}`,
        );
        return false;
      }
      items.push(projection.item);
    }
    const asyncWaking = this.delegationsRepo.listWakingForParent(
      context.scope.parentSessionId,
    );
    const bridgeWaking = repository.listWakingForParent(
      context.scope.parentSessionId,
    );
    const legacyWaking: WakeDelegation[] = [
      ...asyncWaking,
      ...bridgeWaking.map(bridgeWakeDelegation),
    ];
    const delivered = legacyWaking.length > 0
      ? await this.wasMixedWakeDelivered(context, items, legacyWaking)
      : await this.wasNativeWakeDelivered(context, items, []);
    if (delivered === true) {
      if (legacyWaking.length > 0) {
        const acknowledged = await this.markMixedDeliveredIfEligible(
          repository,
          context,
          items.map((item) => item.jobId),
          asyncWaking.map((delegation) => delegation.id),
          bridgeWaking.map((delegation) => delegation.id),
        );
        if (!acknowledged) return false;
      } else {
        const acknowledged = await this.markNativeDeliveredIfEligible(
          repository,
          context,
          items.map((item) => item.jobId),
        );
        if (!acknowledged) return false;
      }
      logger.info(
        `[AsyncDelegation] reconciled exact native wake ${this.nativeDeliveryMessageId([], items, context.scope.hostEpoch)} for parent ${context.parent.id}`,
      );
      return true;
    }
    logger.warn(
      `[AsyncDelegation] native wake inspection is incomplete for ${context.parent.id}; ` +
        `retaining ${items.length} waking claim(s)`,
    );
    return false;
  }

  private async wasMixedWakeDelivered(
    context: NativeDeliveryContext,
    items: NativeWorkstreamWakeItem[],
    legacyDelegations: WakeDelegation[],
  ): Promise<true | null> {
    if (items.length === 0
        || legacyDelegations.length === 0
        || !await this.nativeContextStillEligible(context)) {
      return null;
    }
    const nativeMarker = this.nativeDeliveryMarker(
      this.nativeDeliveryMessageId([], items, context.scope.hostEpoch),
    );
    const legacyMarker = this.deliveryMarker(
      this.deliveryMessageId(legacyDelegations),
    );
    const maybeClient = opencodeClient as unknown as {
      listMessages?: (
        sdkId: string,
        directory?: string,
      ) => Promise<Array<{
        parts?: Array<{ type?: string; text?: string }>;
      }>>;
    };
    if (typeof maybeClient.listMessages !== 'function') return null;
    try {
      const messages = await maybeClient.listMessages.call(
        opencodeClient,
        context.parentSdkSessionId,
        context.parent.cwd,
      );
      const exactMixedReceipt = messages.some((candidate) => {
        const text = candidate.parts
          ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n') ?? '';
        return text.includes(nativeMarker) && text.includes(legacyMarker);
      });
      return exactMixedReceipt ? true : null;
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=mixed_inspection_exception',
      );
      return null;
    }
  }

  private async wasNativeWakeDelivered(
    context: NativeDeliveryContext,
    items: NativeWorkstreamWakeItem[],
    _legacyDelegations: WakeDelegation[],
  ): Promise<true | null> {
    if (!await this.nativeContextStillEligible(context)) return null;
    const messageID = this.nativeDeliveryMessageId(
      [],
      items,
      context.scope.hostEpoch,
    );
    const marker = this.nativeDeliveryMarker(messageID);
    const matches = (candidate: {
      rawText?: string | null;
      parts?: Array<{ type?: string; text?: string }>;
    }): boolean => {
      const text = candidate.rawText ?? candidate.parts
        ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n') ?? '';
      return text.includes(marker);
    };
    const maybeClient = opencodeClient as unknown as {
      listMessages?: (
        sdkId: string,
        directory?: string,
      ) => Promise<Array<{
        parts?: Array<{ type?: string; text?: string }>;
      }>>;
    };
    if (typeof maybeClient.listMessages !== 'function') return null;
    try {
      const messages = await maybeClient.listMessages.call(
        opencodeClient,
        context.parentSdkSessionId,
        context.parent.cwd,
      );
      return messages.some(matches) ? true : null;
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=inspection_exception',
      );
      return null;
    }
  }

  private nativeDeliveryMessageId(
    _legacyDelegations: WakeDelegation[],
    items: NativeWorkstreamWakeItem[],
    hostEpoch: string,
  ): string {
    const stableItems = items.map((item) => [
      item.kind,
      item.jobId,
      item.workstreamId,
      item.status,
      item.reasonCode ?? 'none',
      hostEpoch,
    ].join(':')).sort().join('|');
    const digest = createHash('sha256')
      .update(stableItems)
      .digest('hex')
      .slice(0, 24);
    return `msg_rhythm_native_${digest}`;
  }

  private nativeDeliveryMarker(messageID: string): string {
    return `<!-- rhythm-native-workstream:${messageID} -->`;
  }

  private buildNativeWakeText(
    legacyDelegations: WakeDelegation[],
    items: NativeWorkstreamWakeItem[],
    messageID: string,
  ): string {
    const nativeSection =
      '[Native workstream status update]\n' +
      items.map(renderNativeWorkstreamWake).join('\n\n') +
      '\n\nTreat this as status-only notification bookkeeping. ' +
      'Do not infer completion or apply effects from this notice.\n' +
      this.nativeDeliveryMarker(messageID);
    if (legacyDelegations.length === 0) return nativeSection;
    const legacyMessageID = this.deliveryMessageId(legacyDelegations);
    const legacyText = this.buildWakeText(legacyDelegations, legacyMessageID);
    return `${legacyText}\n\n${nativeSection}`;
  }

  private parentExecutionBlockReason(
    parentAgentConfigId: string | null,
  ): string | null {
    if (!parentAgentConfigId) return 'parent session has no agent profile';
    const config = new AgentConfigsRepository().getById(parentAgentConfigId);
    if (!config || !config.isAgent) {
      return `parent profile is not runnable: '${parentAgentConfigId}'`;
    }
    return agentConfigExecutionBlockReason(config);
  }

  private async reconcileWakingClaims(parent: AgentSession): Promise<boolean> {
    const bridgeRepo = new AgentBridgeJobsRepository();
    const asyncWaking = this.delegationsRepo.listWakingForParent(parent.id);
    const bridgeWaking = bridgeRepo.listWakingForParent(parent.id);
    const waking: WakeDelegation[] = [
      ...asyncWaking,
      ...bridgeWaking.map(bridgeWakeDelegation),
    ];
    if (waking.length === 0) return true;

    const delivered = await this.wasWakeDelivered(parent, waking);
    if (delivered === true) {
      this.delegationsRepo.markNotified(
        asyncWaking.map((delegation) => delegation.id),
      );
      bridgeRepo.markDelivered(bridgeWaking.map((delegation) => delegation.id));
      logger.info(
        `[AsyncDelegation] reconciled already-delivered wake ${this.deliveryMessageId(waking)} for parent ${parent.id}`,
      );
      return true;
    }
    if (delivered === null) {
      logger.warn(
        `[AsyncDelegation] could not inspect parent ${parent.id}; retaining ${waking.length} waking claim(s)`,
      );
      return false;
    }

    this.delegationsRepo.releaseClaims(
      asyncWaking.map((delegation) => delegation.id),
    );
    bridgeRepo.releaseDeliveryClaims(bridgeWaking.map((delegation) => delegation.id));
    return true;
  }

  private async wasWakeDelivered(
    parent: AgentSession,
    delegations: WakeDelegation[],
  ): Promise<boolean | null> {
    const messageID = this.deliveryMessageId(delegations);
    const marker = this.deliveryMarker(messageID);
    const childIds = delegations
      .map((delegation) => delegation.childSessionId)
      .filter((id): id is string => Boolean(id));
    const matches = (
      candidate: {
        sdkMessageId?: string | null;
        rawText?: string | null;
        info?: { id?: string };
        parts?: Array<{ type?: string; text?: string }>;
      },
    ): boolean => {
      if (candidate.sdkMessageId === messageID || candidate.info?.id === messageID) {
        return true;
      }
      const text =
        candidate.rawText ??
        candidate.parts
          ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n') ??
        '';
      return (
        text.includes(marker) ||
        (childIds.length > 0 && text.includes('[Async delegation update]') &&
          childIds.every((childId) => text.includes(childId)))
      );
    };

    if (this.messagesRepo.listBySession(parent.id, 2_000).some(matches)) {
      return true;
    }

    const parentSdkSessionId =
      parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
    if (!parentSdkSessionId) return false;
    const maybeClient = opencodeClient as unknown as {
      listMessages?: (
        sdkId: string,
        directory?: string,
      ) => Promise<Array<{
        info?: { id?: string };
        parts?: Array<{ type?: string; text?: string }>;
      }>>;
    };
    if (typeof maybeClient.listMessages !== 'function') {
      // Unit/fake transports cannot inspect the engine. They have no independent
      // process that could have accepted a prompt after throwing, so a retry is
      // unambiguous in that environment.
      return false;
    }
    try {
      const messages = await maybeClient.listMessages.call(
        opencodeClient,
        parentSdkSessionId,
        parent.cwd,
      );
      return messages.some(matches);
    } catch (error) {
      logger.warn(
        `[AsyncDelegation] wake delivery inspection failed for ${parent.id}: ${String(error)}`,
      );
      return null;
    }
  }

  private deliveryMessageId(delegations: WakeDelegation[]): string {
    const stableIds = delegations
      .map((delegation) => delegation.id)
      .sort()
      .join(':');
    const digest = createHash('sha256').update(stableIds).digest('hex').slice(0, 24);
    return `msg_rhythm_async_${digest}`;
  }

  private deliveryMarker(messageID: string): string {
    return `<!-- rhythm-async-delegation:${messageID} -->`;
  }

  private buildWakeText(
    delegations: WakeDelegation[],
    messageID = this.deliveryMessageId(delegations),
  ): string {
    const blocks = delegations.map((delegation) => {
      // A child's output is only first-party if the CHILD never consumed external
      // content. When it did, that text is attacker-influenced and must be fenced
      // before it enters the parent's prompt — the rule in
      // docs/ai/decisions/2026-06-27-fence-untrusted-external-content.md.
      // This path previously interpolated it raw, which was the one place in the
      // system that injected possibly-tainted text into a prompt unfenced.
      const tainted = delegation.forceUntrusted ||
        childConsumedExternalContent(delegation.childSessionId ?? '');
      const body = delegation.completionText ?? '(no text result)';
      const renderedBody = tainted
        ? untrustedContext(body, `delegated result from @${delegation.targetAgentConfigId}`)
        : body;
      const outcome = delegation.errorText
        ? `failed (${delegation.errorText}):\n${renderedBody}`
        : `finished:\n${renderedBody}`;
      const childReference = delegation.forceUntrusted
        ? 'external runtime'
        : delegation.childSessionId ?? 'unknown';
      return (
        `- @${delegation.targetAgentConfigId} ` +
        `(delegated child session ${childReference}) ${outcome}`
      );
    });
    return (
      '[Async delegation update]\n' +
      `${blocks.join('\n\n')}\n\n` +
      'Incorporate these results into the conversation. Respect any newer user direction already in the session.\n' +
      this.deliveryMarker(messageID)
    );
  }
}

function sameNativeScope(
  left: NativeWorkstreamDeliveryScope,
  right: NativeWorkstreamDeliveryScope,
): boolean {
  return left.localUserId === right.localUserId
    && left.projectId === right.projectId
    && left.parentSessionId === right.parentSessionId
    && left.hostEpoch === right.hostEpoch;
}

interface WakeDelegation {
  id: string;
  childSessionId: string | null;
  targetAgentConfigId: string;
  completionText: string | null;
  errorText: string | null;
  forceUntrusted?: boolean;
}

function bridgeWakeDelegation(row: AgentBridgeJobRow): WakeDelegation {
  return {
    id: row.id,
    childSessionId: row.child_session_id,
    targetAgentConfigId: row.target_agent_id,
    completionText: row.result_text,
    errorText: row.state === 'failed' || row.state === 'unknown'
      ? row.state_reason ?? row.state
      : row.state === 'cancelled'
        ? 'cancelled'
        : null,
    forceUntrusted: true,
  };
}

/**
 * Did this child session read external content?
 *
 * Keyed off `agent_external_taint_state`, the same store the approval gate uses.
 * A child that only touched first-party data yields a result that needs no fence
 * and must not taint its parent — fencing everything would train the model to
 * ignore the fence, and tainting everything would put an approval gate in front
 * of every delegated result.
 */
function childConsumedExternalContent(childSessionId: string): boolean {
  if (!childSessionId) return false;
  try {
    const row = getDb()
      .prepare(`SELECT 1 FROM agent_external_taint_state WHERE session_id = ?`)
      .get(childSessionId);
    return Boolean(row);
  } catch {
    // Unknown taint status must fail SAFE: assume tainted and fence it.
    return true;
  }
}

export const asyncDelegationCompletionService =
  new AsyncDelegationCompletionService();
