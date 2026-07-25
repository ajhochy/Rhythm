import {
  AgentAsyncDelegationsRepository,
  type AgentAsyncDelegation,
} from '../repositories/agent_async_delegations_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { logger } from '../utils/logger';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { resolveProfileScope } from './agent_profile_scope';

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
    if (parent.status === 'starting' || parent.status === 'working') return;

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

    const parentAgentConfigId = (parent.mcpRole ?? parent.agentKind)?.trim() || null;
    const profileScope = await resolveProfileScope(parentAgentConfigId);
    const runningAsOwnAgent =
      profileScope.ocAgent !== null && profileScope.ocAgent === parentAgentConfigId;
    const promptOpts: Record<string, unknown> = {
      permissionMode: parent.permissionMode,
      ...(profileScope.ocAgent ? { agent: profileScope.ocAgent } : {}),
      ...(profileScope.systemPrompt && !runningAsOwnAgent
        ? { system: profileScope.systemPrompt }
        : {}),
    };
    const wakeText = this.buildWakeText(claimed);

    this.wakeInFlight.add(parentSessionId);
    const enqueued = await opencodeClient.promptAsync(
      parentSdkSessionId,
      wakeText,
      profileScope.model,
      parent.cwd,
      promptOpts,
    );
    if (!enqueued) {
      this.wakeInFlight.delete(parentSessionId);
      this.delegationsRepo.releaseClaims(ids);
      logger.warn(
        `[AsyncDelegation] engine rejected parent wake for ${parentSessionId}; callbacks re-queued`,
      );
      return;
    }

    this.delegationsRepo.markNotified(ids);
    logger.info(
      `[AsyncDelegation] woke parent ${parentSessionId} with ${claimed.length} completed delegate(s)`,
    );
  }

  private buildWakeText(delegations: AgentAsyncDelegation[]): string {
    const blocks = delegations.map((delegation) => {
      const outcome = delegation.errorText
        ? `failed: ${delegation.errorText}`
        : `finished:\n${delegation.completionText ?? '(no text result)'}`;
      return (
        `- @${delegation.targetAgentConfigId} ` +
        `(delegated child session ${delegation.childSessionId}) ${outcome}`
      );
    });
    return (
      '[Async delegation update]\n' +
      `${blocks.join('\n\n')}\n\n` +
      'Incorporate these results into the conversation. Respect any newer user direction already in the session.'
    );
  }
}

export const asyncDelegationCompletionService =
  new AsyncDelegationCompletionService();
