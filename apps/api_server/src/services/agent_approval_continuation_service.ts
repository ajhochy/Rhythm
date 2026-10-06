import { AgentApprovalsRepository, type AgentApproval } from '../repositories/agent_approvals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  CoordinatorConversationsRepository,
  type CoordinatorGoalApprovalResumeCandidate,
} from '../repositories/coordinator_conversations_repository';
import { WORKFLOW_APPROVAL_ACTION, workflowApprovalResumeCandidate } from './chat_bounded_workflow';
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

  private workflowReadiness: (() => Promise<boolean>) | null = null;

  /** Server composition only; no request or model input can supply this probe. */
  configureWorkflowReadiness(probe: (() => Promise<boolean>) | null): void {
    this.workflowReadiness = probe;
  }

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

    // Idle events are emitted for every completed turn. Do not attach (or
    // reattach) an engine stream unless this session actually has durable
    // continuation work. Re-subscribing an already-ended stream from its own
    // idle callback can replay another idle event and recurse forever.
    const continuations = this.approvals.listContinuations(session.id);
    if (continuations.length === 0) return;

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

    for (const approval of continuations) {
      if (approval.status !== 'approved' && approval.status !== 'rejected') {
        continue;
      }

      if (await this.reconcileWaking(approval, sdkSessionId, session.cwd)) {
        continue;
      }
      // Only an exact current approved workflow may reconnect its existing
      // local core. Failed connection/readiness leaves the durable wake queued.
      if (approval.securityAction === WORKFLOW_APPROVAL_ACTION && approval.status === 'approved') {
        const before = workflowApprovalResumeCandidate(approval.id);
        if (before?.sdkSessionId === sdkSessionId) {
          if (!this.workflowReadiness || !(await opencodeClient.reconnectConfiguredLocalRhythmMcp()) ||
              !(await this.workflowReadiness())) continue;
          const after = workflowApprovalResumeCandidate(approval.id);
          const live = opencodeSessionMap.get(session.id) ?? this.sessions.findById(session.id)?.sdkSessionId;
          if (live !== sdkSessionId || !after || JSON.stringify(before) !== JSON.stringify(after)) continue;
        }
      }
      if (!this.approvals.claimContinuation(approval.id)) continue;

      // Qualified from CURRENT rows after every producer await above and only
      // for the exact approved goal approval; anything else is the ordinary wake.
      const workflowResume = workflowApprovalResumeCandidate(approval.id);
      const workflow = workflowResume?.sdkSessionId === sdkSessionId ? workflowResume : null;
      const resume = this.qualifyGoalResume(approval, sdkSessionId);
      const controls = resume ? this.captureControls(session.id) : null;
      const continuation = workflow
        ? `[Rhythm exact finite workflow human decision]\napproval_id: ${workflow.approvalId}\nproposal_digest: ${workflow.proposalDigest}\nCall rhythm_start_bounded_coding_workflow exactly once with these two values. Do not change the proposal, grant authority yourself, or create another approval.\n${this.marker(approval.id)}`
        : this.buildContinuation(approval, resume);
      try {
        const accepted = await opencodeClient.promptAsync(
          sdkSessionId,
          continuation,
          scope.model,
          session.cwd,
          promptOptions,
          undefined,
          undefined,
          {
            sessionId: session.id,
            sdkSessionId,
            origin: 'approval_continuation',
            requestedSource: 'agent_config',
            requestedProviderId: scope.model?.providerID ?? null,
            requestedModelId: scope.model?.modelID ?? null,
            resolvedProviderId: scope.model?.providerID ?? null,
            resolvedModelId: scope.model?.modelID ?? null,
            routeAuthed: null,
            finalProviderId: scope.model?.providerID ?? null,
            finalModelId: scope.model?.modelID ?? null,
            ...(workflow ? { reasonCode: workflow.reasonCode } : resume ? { reasonCode: resume.reasonCode } : {}),
          },
          undefined,
          undefined,
          undefined,
          // Distinct internal context (generic wakes pass none): the client mints
          // the native message id, persists the exact dispatch row with it before
          // exposure and runs this SYNCHRONOUS check again immediately before the
          // SDK call, after its last awaited history/authority guard.
          workflow
            ? {
              kind: 'coordinator_workflow_approval_resume_v1' as const,
              validate: () => {
                const current = workflowApprovalResumeCandidate(approval.id);
                const live = opencodeSessionMap.get(session.id) ?? this.sessions.findById(session.id)?.sdkSessionId;
                return live === sdkSessionId && current !== null && JSON.stringify(current) === JSON.stringify(workflow);
              },
            }
            : resume
            ? {
              kind: 'coordinator_goal_approval_resume_v1' as const,
              validate: () => this.resumeCurrent(approval, session.id, sdkSessionId, resume, controls),
            }
            : undefined,
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

  /**
   * Narrow qualification of the exact approved coordinator-goal approval. The
   * repository proves (synchronously, from current rows) that this approval is
   * the current primary root's approved, unconsumed, unexpired
   * `delegation.start-async` approval bound to the current taint, and that its
   * digest uniquely selects one captured, unlinked, uncommanded goal. Rejected,
   * pending, generic and ambiguous approvals return null and are untouched.
   */
  private qualifyGoalResume(
    approval: AgentApproval,
    sdkSessionId: string,
  ): CoordinatorGoalApprovalResumeCandidate | null {
    if (approval.status !== 'approved') return null;
    try {
      const candidate = new CoordinatorConversationsRepository().findGoalApprovalResumeCandidate({
        id: approval.id,
        sessionId: approval.sessionId,
      });
      return candidate && candidate.sdkSessionId === sdkSessionId ? candidate : null;
    } catch {
      return null;
    }
  }

  /** Controls captured when the wake was qualified; a change after that is stale. */
  private captureControls(sessionId: string): { permissionMode: string; approvalBypassExplicit: boolean } | null {
    const row = this.sessions.findById(sessionId);
    return row ? { permissionMode: row.permissionMode, approvalBypassExplicit: row.approvalBypassExplicit === true } : null;
  }

  /**
   * SYNCHRONOUS current-fingerprint proof (no await anywhere): the approval is
   * still approved/unconsumed/unexpired for the exact action/digest, the goal
   * revision, root/profile/owner/project/SDK and taint are those qualified, the
   * live SDK mapping is unchanged and the root's permission controls are the
   * same. Any difference (or a throw) is a refusal.
   */
  private resumeCurrent(
    approval: AgentApproval,
    sessionId: string,
    sdkSessionId: string,
    expected: CoordinatorGoalApprovalResumeCandidate,
    controls: { permissionMode: string; approvalBypassExplicit: boolean } | null,
  ): boolean {
    try {
      const current = this.qualifyGoalResume(approval, sdkSessionId);
      if (!current || current.fingerprint !== expected.fingerprint || current.reasonCode !== expected.reasonCode) return false;
      const live = opencodeSessionMap.get(sessionId) ?? this.sessions.findById(sessionId)?.sdkSessionId ?? null;
      const now = this.captureControls(sessionId);
      return live === sdkSessionId && controls !== null && now !== null &&
        now.permissionMode === controls.permissionMode &&
        now.approvalBypassExplicit === controls.approvalBypassExplicit;
    } catch {
      return false;
    }
  }

  private buildContinuation(
    approval: AgentApproval,
    resume: CoordinatorGoalApprovalResumeCandidate | null = null,
  ): string {
    const marker = this.marker(approval.id);
    if (approval.securityAction === WORKFLOW_APPROVAL_ACTION) {
      return `[Rhythm finite workflow decision]\nApproval ${approval.id} is ${approval.status}, but no current exact native workflow resume is qualified. Hold this workflow; do not start a goal, grant authority, retry, or infer consent from this message.\n${marker}`;
    }
    if (approval.status === 'approved') {
      return (
        '[Rhythm human approval decision]\n' +
        `approval_id: ${approval.id}\n` +
        // Server-derived ids only; never the goal objective or any model text.
        (resume ? `goal_id: ${resume.goalId}\n` : '') +
        'Retry the identical protected action exactly once now using this approval_id. ' +
        'Keep the original action and payload unchanged. Do not request a replacement approval for that retry.' +
        (resume
          ? ' Call rhythm_start_coordinator_goal once with exactly this goal_id and approval_id.'
          : '') +
        '\n' +
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
