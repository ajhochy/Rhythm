import { AgentApprovalsRepository, type AgentApproval } from '../repositories/agent_approvals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { logger } from '../utils/logger';
import { resolveProfileScope } from './agent_profile_scope';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';

/**
 * Durably delivers a machine-authored continuation after a human decides an
 * approval. The wake contains only server-owned state (decision + UUID), never
 * the model-authored action/preview, so untrusted text cannot be re-injected.
 */
export class AgentApprovalContinuationService {
  private readonly approvals = new AgentApprovalsRepository();
  private readonly sessions = new AgentSessionsRepository();
  private readonly sessionChains = new Map<string, Promise<void>>();

  async onDecision(approval: AgentApproval): Promise<void> {
    if (!approval.sessionId) return;
    try {
      await this.flushSession(approval.sessionId);
    } catch (error) {
      // The signed decision is already committed with continuation_state=queued.
      // Delivery failure must not turn that successful human decision into a
      // misleading HTTP error; idle/restart recovery will retry it.
      logger.warn(
        `[AgentApprovalContinuation] deferred wake for ${approval.id}: ${String(error)}`,
      );
    }
  }

  async onSessionIdle(sessionId: string): Promise<void> {
    await this.flushSession(sessionId);
  }

  async recoverAfterRestart(): Promise<void> {
    const sessionIds = new Set(
      this.approvals
        .listContinuations()
        .map((approval) => approval.sessionId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const sessionId of sessionIds) {
      await this.flushSession(sessionId);
    }
  }

  private async flushSession(sessionId: string): Promise<void> {
    const previous = this.sessionChains.get(sessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.flushSessionLocked(sessionId));
    this.sessionChains.set(sessionId, current);
    try {
      await current;
    } finally {
      if (this.sessionChains.get(sessionId) === current) {
        this.sessionChains.delete(sessionId);
      }
    }
  }

  private async flushSessionLocked(sessionId: string): Promise<void> {
    const session = this.sessions.findById(sessionId);
    if (!session || session.status === 'starting' || session.status === 'working') {
      return;
    }
    if (session.status !== 'idle') return;

    // The live map is authoritative. Persisted sdk_session_id is only a
    // fallback after restart and must never overwrite a newer live mapping.
    const sdkSessionId =
      opencodeSessionMap.get(session.id) ?? session.sdkSessionId ?? null;
    if (!sdkSessionId) return;

    const profileId = (session.mcpRole ?? session.agentKind)?.trim() || null;
    const scope = await resolveProfileScope(profileId);
    const runningAsOwnAgent =
      scope.ocAgent !== null && scope.ocAgent === profileId;
    const promptOptions: Record<string, unknown> = {
      permissionMode: session.permissionMode,
      ...(scope.ocAgent ? { agent: scope.ocAgent } : {}),
      ...(scope.systemPrompt && !runningAsOwnAgent
        ? { system: scope.systemPrompt }
        : {}),
    };

    // Ensure the normal transcript/status event path is attached before the
    // wake can produce output. Import lazily to avoid the bridge/service cycle.
    const { streamBridge } = await import('./opencode_stream_bridge');
    await streamBridge.streamSession(session.id, sdkSessionId, session.cwd);

    for (const approval of this.approvals.listContinuations(session.id)) {
      if (approval.status !== 'approved' && approval.status !== 'rejected') {
        continue;
      }

      if (await this.reconcileWaking(approval, sdkSessionId, session.cwd)) {
        continue;
      }
      if (!this.approvals.claimContinuation(approval.id)) continue;

      const continuation = this.buildContinuation(approval);
      try {
        const accepted = await opencodeClient.promptAsync(
          sdkSessionId,
          continuation,
          scope.model,
          session.cwd,
          promptOptions,
        );
        if (accepted) {
          this.approvals.markContinuationDelivered(approval.id);
          continue;
        }
        const delivered = await this.wasDelivered(
          approval,
          sdkSessionId,
          session.cwd,
        );
        if (delivered === true) {
          this.approvals.markContinuationDelivered(approval.id);
        } else if (delivered === false) {
          this.approvals.releaseContinuation(approval.id);
        }
      } catch (error) {
        const delivered = await this.wasDelivered(
          approval,
          sdkSessionId,
          session.cwd,
        );
        if (delivered === true) {
          this.approvals.markContinuationDelivered(approval.id);
        } else if (delivered === false) {
          this.approvals.releaseContinuation(approval.id);
        }
        logger.warn(
          `[AgentApprovalContinuation] wake failed for ${approval.id}: ${String(error)}`,
        );
      }
    }
  }

  private async reconcileWaking(
    approval: AgentApproval,
    sdkSessionId: string,
    cwd: string,
  ): Promise<boolean> {
    const row = this.approvals
      .listContinuations(approval.sessionId ?? undefined)
      .find((candidate) => candidate.id === approval.id);
    if (!row) return true;
    const state = this.continuationState(approval.id);
    if (state !== 'waking') return false;

    const delivered = await this.wasDelivered(approval, sdkSessionId, cwd);
    if (delivered === true) {
      this.approvals.markContinuationDelivered(approval.id);
      return true;
    }
    if (delivered === false) this.approvals.releaseContinuation(approval.id);
    return delivered === null;
  }

  private continuationState(id: string): string | null {
    const row = this.approvals.getById(id);
    return row?.continuationState ?? null;
  }

  private async wasDelivered(
    approval: AgentApproval,
    sdkSessionId: string,
    cwd: string,
  ): Promise<boolean | null> {
    if (typeof opencodeClient.listMessages !== 'function') return null;
    try {
      const messages = await opencodeClient.listMessages(sdkSessionId, cwd);
      const marker = this.marker(approval.id);
      return messages.some((message) =>
        JSON.stringify(message).includes(marker),
      );
    } catch {
      return null;
    }
  }

  private buildContinuation(approval: AgentApproval): string {
    const marker = this.marker(approval.id);
    if (approval.status === 'approved') {
      return (
        '[Rhythm human approval decision]\n' +
        `approval_id: ${approval.id}\n` +
        'Retry the identical protected action exactly once now using this approval_id. ' +
        'Keep the original action and payload unchanged. Do not request a replacement approval for that retry.\n' +
        marker
      );
    }
    return (
      '[Rhythm human approval decision]\n' +
      `Approval ${approval.id} was rejected.\n` +
      'Do not perform or retry the protected action. Continue safely without it and report the rejection.\n' +
      marker
    );
  }

  private marker(approvalId: string): string {
    return `<!-- rhythm-approval-continuation:${approvalId} -->`;
  }
}

export const agentApprovalContinuationService =
  new AgentApprovalContinuationService();
