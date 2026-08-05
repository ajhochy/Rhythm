import { createHash } from 'node:crypto';

import {
  AgentAsyncDelegationsRepository,
  type AgentAsyncDelegation,
} from '../repositories/agent_async_delegations_repository';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentSession } from '../models/agent_session';
import { logger } from '../utils/logger';
import { untrustedContext } from '../security/untrusted_fence';
import { getDb } from '../database/db';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { resolveProfileScope } from './agent_profile_scope';

const RESTART_RECOVERY_PARENT_LIMIT = 100;

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
    if (claimed.length === 0) return;
    const ids = claimed.map((delegation) => delegation.id);
    const parentSdkSessionId =
      parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
    if (!parentSdkSessionId) {
      this.delegationsRepo.releaseClaims(ids);
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
      logger.warn(
        `[AsyncDelegation] parent ${parent.id} locked before wake; completion remains queued: ${executionBlockReason}`,
      );
      return;
    }
    const runningAsOwnAgent =
      profileScope.ocAgent !== null && profileScope.ocAgent === parentAgentConfigId;
    const messageID = this.deliveryMessageId(claimed);
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
    const wakeText = this.buildWakeText(claimed, messageID);

    this.wakeInFlight.add(parentSessionId);
    let deliveryUnknown = false;
    try {
      const enqueued = await opencodeClient.promptAsync(
        parentSdkSessionId,
        wakeText,
        profileScope.model,
        parent.cwd,
        promptOpts,
      );
      if (!enqueued) {
        const delivered = await this.wasWakeDelivered(parent, claimed);
        if (delivered === true) {
          this.delegationsRepo.markNotified(ids);
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
      logger.info(
        `[AsyncDelegation] woke parent ${parentSessionId} with ${claimed.length} completed delegate(s)`,
      );
    } catch (error) {
      const delivered = await this.wasWakeDelivered(parent, claimed);
      if (delivered === true) {
        this.delegationsRepo.markNotified(ids);
        logger.info(
          `[AsyncDelegation] recovered accepted parent wake ${messageID} after enqueue exception`,
        );
        return;
      }
      deliveryUnknown = delivered === null;
      throw error;
    } finally {
      this.wakeInFlight.delete(parentSessionId);
      if (!deliveryUnknown) this.delegationsRepo.releaseClaims(ids);
    }
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
    const waking = this.delegationsRepo.listWakingForParent(parent.id);
    if (waking.length === 0) return true;

    const delivered = await this.wasWakeDelivered(parent, waking);
    if (delivered === true) {
      this.delegationsRepo.markNotified(
        waking.map((delegation) => delegation.id),
      );
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
      waking.map((delegation) => delegation.id),
    );
    return true;
  }

  private async wasWakeDelivered(
    parent: AgentSession,
    delegations: AgentAsyncDelegation[],
  ): Promise<boolean | null> {
    const messageID = this.deliveryMessageId(delegations);
    const marker = this.deliveryMarker(messageID);
    const childIds = delegations.map((delegation) => delegation.childSessionId);
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
        (text.includes('[Async delegation update]') &&
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

  private deliveryMessageId(delegations: AgentAsyncDelegation[]): string {
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
    delegations: AgentAsyncDelegation[],
    messageID = this.deliveryMessageId(delegations),
  ): string {
    const blocks = delegations.map((delegation) => {
      // A child's output is only first-party if the CHILD never consumed external
      // content. When it did, that text is attacker-influenced and must be fenced
      // before it enters the parent's prompt — the rule in
      // docs/ai/decisions/2026-06-27-fence-untrusted-external-content.md.
      // This path previously interpolated it raw, which was the one place in the
      // system that injected possibly-tainted text into a prompt unfenced.
      const tainted = childConsumedExternalContent(delegation.childSessionId);
      const body = delegation.completionText ?? '(no text result)';
      const outcome = delegation.errorText
        ? `failed: ${delegation.errorText}`
        : `finished:\n${
            tainted
              ? untrustedContext(body, `delegated result from @${delegation.targetAgentConfigId}`)
              : body
          }`;
      return (
        `- @${delegation.targetAgentConfigId} ` +
        `(delegated child session ${delegation.childSessionId}) ${outcome}`
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
