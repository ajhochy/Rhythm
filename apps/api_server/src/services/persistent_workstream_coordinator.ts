import { randomUUID } from 'node:crypto';

import type { AuthContext } from '../middleware/auth_middleware';
import { AppError } from '../errors/app_error';
import type {
  WorkstreamReferenceInput,
  WorkstreamRunPolicy,
} from '../contracts/agent_workstream_contract';
import type { NativeTerminationReceipt } from '../shared_agents/native_workstream_job_contract';
import {
  AgentBridgeJobsRepository,
  type AgentBridgeJobRow,
  type CoordinatorBudgetState,
  type CoordinatorLegacyCapacityAssessment,
  type LegacyCoordinatorCapacityRow,
} from '../shared_agents/delegation_jobs_repository';
import {
  AgentWorkstreamsRepository,
} from '../repositories/agent_workstreams_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
  type AgentConfig,
} from '../repositories/agent_configs_repository';
import {
  asOpenCodeAgentId,
  asRhythmProfileId,
  type AgentSession,
} from '../models/agent_session';
import type { AgentWorkstream } from '../models/agent_workstream';
import {
  ManagedWorkstreamContextRepository,
  type ManagedContextReference,
} from '../repositories/managed_workstream_context_repository';
import {
  ManagedWorkstreamContextAssembler,
  ManagedWorkstreamPromptOverflow,
} from './managed_workstream_context_assembler';
import {
  WorkstreamArtifactAuthorityResolver,
  WorkstreamArtifactResolutionError,
  type QualifiedWorkstreamArtifact,
} from './workstream_artifact_verifier';
import {
  resolveProfileMcpScope,
  resolveProfileScope,
  type McpRoleConfig,
  type ProfileScope,
} from './agent_profile_scope';
import type {
  OpencodeClientService,
  OpencodeEngineIdentity,
} from './opencode_client_service';
import { opencodeSessionMap } from './opencode_engine';

const ACTIVE_JOB_STATES = new Set(['queued', 'claimed', 'running', 'unknown']);
const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'cancelled']);
const SAFE_REASON = /^[a-z][a-z0-9_]{0,63}$/;
const STATUS_PROBE_TIMEOUT_MS = 3_000;

export interface WorkstreamReadiness {
  available: boolean;
  reason: string | null;
  hostEpoch: string | null;
  engine: { version: string; pid: number; bootId: string } | null;
}

export interface WorkstreamJobView {
  id: string;
  /** Opaque durable key needed only to retry this exact queued user command. */
  commandKey: string;
  state: AgentBridgeJobRow['state'];
  stateReason: string | null;
  createdAt: string;
  startedAt: string | null;
  lastProgressAt: string | null;
  terminalAt: string | null;
  cancellationRequestedAt: string | null;
  workerSessionId: string | null;
  targetProfileId: string | null;
  requestedProviderId: string | null;
  requestedModelId: string | null;
  policy: WorkstreamRunPolicy | null;
  estimate: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  application: Record<string, unknown> | null;
}

export interface WorkstreamStatusView {
  workstream: AgentWorkstream;
  readiness: WorkstreamReadiness;
  jobs: WorkstreamJobView[];
  budget: CoordinatorBudgetState;
}

export interface WorkstreamEvidenceView {
  selector: string;
  available: boolean;
  eligible: boolean;
  reason: string | null;
  canonicalId: string | null;
  observedVersion: string | null;
  observedHash: string | null;
  sourceNamespace: string | null;
  sourceInstance: string | null;
  evidenceState: 'preexisting' | null;
}

function evidenceView(resolved: QualifiedWorkstreamArtifact): WorkstreamEvidenceView {
  return {
    selector: resolved.selector,
    available: true,
    eligible: resolved.eligible,
    reason: resolved.receipt.reason,
    canonicalId: resolved.receipt.canonicalId,
    observedVersion: resolved.receipt.observedVersion,
    observedHash: resolved.receipt.observedHash,
    sourceNamespace: resolved.receipt.sourceNamespace ?? null,
    sourceInstance: resolved.receipt.sourceInstance ?? null,
    evidenceState: resolved.receipt.evidenceState ?? null,
  };
}

/** Only a fully bound, locally-idle dispatched child can be engine-checked. */
function isLegacyIdleCapacityCandidate(row: LegacyCoordinatorCapacityRow): boolean {
  return row.delegationStatus === 'dispatched' &&
    row.parentBoundSessionId === row.parentSessionId &&
    typeof row.parentStatus === 'string' && row.parentStatus.length > 0 &&
    typeof row.parentUpdatedAt === 'string' && row.parentUpdatedAt.length > 0 &&
    typeof row.delegationUpdatedAt === 'string' && row.delegationUpdatedAt.length > 0 &&
    typeof row.childSessionId === 'string' && row.childSessionId.length > 0 &&
    row.childSessionId !== row.parentSessionId &&
    typeof row.childSdkSessionId === 'string' && row.childSdkSessionId.length > 0 &&
    row.childStatus === 'idle' &&
    typeof row.childUpdatedAt === 'string' && row.childUpdatedAt.length > 0 &&
    typeof row.childCwd === 'string' && row.childCwd.length > 0 &&
    row.childParentSessionId === row.parentSessionId;
}

export interface WorkstreamRunRequest {
  expectedRevision: number;
  commandKey: string;
  targetProfileId: string;
  parentSessionId: string;
  policy: WorkstreamRunPolicy;
  references: WorkstreamReferenceInput[];
}

export interface PersistentWorkstreamCoordinatorDependencies {
  engine: Pick<
    OpencodeClientService,
    | 'isReady'
    | 'hasOwnedEngine'
    | 'getEngineIdentity'
    | 'createSession'
    | 'promptAsync'
    | 'abortSession'
    | 'getSessionStatuses'
    | 'inspectBoundSessionLifecycles'
    | 'listMessagesPage'
    | 'listQuestions'
    | 'listPermissions'
    | 'listMcp'
  >;
  records: ManagedWorkstreamContextRepository;
  /** Construction alone is not readiness; this must probe the owned capture seam. */
  captureAvailable: () => boolean;
  enabled: () => boolean;
  dbClient: 'sqlite' | 'postgres';
  role: 'all' | 'local' | 'cloud' | 'relay';
  rhythmMcpServerName: string;
  workstreams?: AgentWorkstreamsRepository;
  jobs?: AgentBridgeJobsRepository;
  sessions?: AgentSessionsRepository;
  configs?: AgentConfigsRepository;
  assembler?: ManagedWorkstreamContextAssembler;
  artifactResolver?: WorkstreamArtifactAuthorityResolver;
  /** Injectable only for local contract tests; production uses the shared resolver. */
  profileScopeResolver?: (profileId: string) => Promise<ProfileScope>;
  hostEpoch?: string;
}

/**
 * The sole explicit-dispatch adapter for persistent workstreams.  It uses the
 * existing native bridge ledger for intent, the existing session catalog for
 * child ancestry, and OpencodeClientService for the one real prompt.  It owns
 * no timer, queue consumer, retry loop, or second completion store.
 */
export class PersistentWorkstreamCoordinator {
  readonly hostEpoch: string;

  private readonly workstreams: AgentWorkstreamsRepository;
  private readonly jobs: AgentBridgeJobsRepository;
  private readonly sessions: AgentSessionsRepository;
  private readonly configs: AgentConfigsRepository;
  private readonly assembler: ManagedWorkstreamContextAssembler;
  private readonly artifactResolver: WorkstreamArtifactAuthorityResolver;
  private initialized = false;
  private bootReconciled = false;
  private disposed = false;

  constructor(private readonly dependencies: PersistentWorkstreamCoordinatorDependencies) {
    this.hostEpoch = dependencies.hostEpoch ?? randomUUID();
    this.workstreams = dependencies.workstreams ?? new AgentWorkstreamsRepository();
    this.jobs = dependencies.jobs ?? new AgentBridgeJobsRepository();
    this.sessions = dependencies.sessions ?? new AgentSessionsRepository();
    this.configs = dependencies.configs ?? new AgentConfigsRepository();
    this.assembler = dependencies.assembler ?? new ManagedWorkstreamContextAssembler();
    this.artifactResolver = dependencies.artifactResolver ?? new WorkstreamArtifactAuthorityResolver();
  }

  /** Marks the boot boundary.  It deliberately performs no engine action. */
  initialize(): void {
    this.initialized = true;
    this.bootReconciled = false;
  }

  dispose(): void {
    this.disposed = true;
  }

  /**
   * A bounded, status-only restart reconciliation.  A busy, exactly bound
   * child can be reattached to this coordinator epoch.  Everything ambiguous
   * stays unknown; no old intent is ever replayed.
   */
  async reconcileAfterEngineReady(): Promise<{ examined: number; reattached: number; unknown: number }> {
    if (!this.initialized || this.disposed) return { examined: 0, reattached: 0, unknown: 0 };
    const readiness = await this.evaluateReadiness({ allowPendingReconciliation: true });
    if (!readiness.available) return { examined: 0, reattached: 0, unknown: 0 };

    let examined = 0;
    let reattached = 0;
    let unknown = 0;
    let cursor: { createdAt: string; id: string } | undefined;
    do {
      const page = this.jobs.listCoordinatorOutsideEpochPage({
        currentEpoch: this.hostEpoch,
        cursor,
        limit: 20,
      });
      cursor = page.nextCursor ?? undefined;
      for (const job of page.items) {
        examined += 1;
        const now = new Date().toISOString();
        if (!job.workstream_id || !job.workstream_project_id) {
          // Preserve the ledger fact even if an old corrupt row no longer has
          // a visible workstream; it can never be admitted by this boot.
          unknown += 1;
          continue;
        }
        const workstream = this.workstreams.find(job.local_user_id, job.workstream_project_id, job.workstream_id);
        if (!workstream) {
          this.jobs.markCoordinatorUnknown({
            localUserId: job.local_user_id,
            workstreamId: job.workstream_id,
            jobId: job.id,
            reason: 'restart_reconciliation_workstream_missing',
            now,
          });
          unknown += 1;
          continue;
        }
        const child = job.native_child_session_id
          ? this.sessions.findById(job.native_child_session_id)
          : null;
        if (
          job.state === 'running' && child?.sdkSessionId &&
          child.sdkSessionId === job.native_child_sdk_session_id && job.host_epoch
        ) {
          const statuses = await this.withProbeTimeout(
            this.dependencies.engine.getSessionStatuses(child.cwd),
          );
          if (statuses?.[child.sdkSessionId]?.type === 'busy') {
            try {
              this.jobs.reattachCoordinatorEpoch({
                localUserId: job.local_user_id,
                projectId: job.workstream_project_id,
                workstreamId: job.workstream_id,
                jobId: job.id,
                priorEpoch: job.host_epoch,
                currentEpoch: this.hostEpoch,
                expectedRevision: workstream.revision,
                expectedExecutorEpoch: workstream.executorEpoch,
                expectedLastJobId: workstream.lastJobId,
                expectedStates: ['queued', 'running', 'blocked', 'unknown'],
                now,
              });
              this.publishRuntime(workstream, job.id, 'running', 'worker_reattached_after_restart', {
                executorEpoch: this.hostEpoch,
                expectedStates: ['queued', 'running', 'blocked', 'unknown'],
              });
              reattached += 1;
              continue;
            } catch {
              // Fall through to an explicit unknown record.
            }
          }
        }
        this.markUnknown(workstream, job, 'restart_reconciliation_ambiguous');
        unknown += 1;
      }
    } while (cursor);
    this.bootReconciled = true;
    return { examined, reattached, unknown };
  }

  async readiness(): Promise<WorkstreamReadiness> {
    return this.evaluateReadiness({ allowPendingReconciliation: false });
  }

  async list(auth: AuthContext, projectId: string, limit: number, cursor?: string): Promise<{
    items: WorkstreamStatusView[];
    nextCursor: string | null;
  }> {
    this.assertActor(auth);
    const items = this.workstreams.list(auth.user.id, projectId, limit, cursor);
    // A list is an explicit user status read, not a scheduler.  Bound it to
    // ten current entries so it never becomes an unbounded engine sweep.
    const reconciled = await Promise.all(items.slice(0, 10).map((item) => this.status(auth, projectId, item.id)));
    const viewsById = new Map(reconciled.map((view) => [view.workstream.id, view]));
    return {
      // Keep pagination truthful: only reconciliation is bounded.  Rows beyond
      // that bound still appear with an explicitly unprobed readiness state.
      items: items.map((item) => viewsById.get(item.id) ?? this.view(item)),
      nextCursor: items.length === limit ? items.at(-1)?.id ?? null : null,
    };
  }

  async status(auth: AuthContext, projectId: string, workstreamId: string): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const row = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (row.lastJobId) {
      const job = this.jobs.getNativeForWorkstream({
        localUserId: auth.user.id,
        workstreamId,
        jobId: row.lastJobId,
      });
      if (job) await this.reconcileJob(row, job);
    }
    const refreshed = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    return this.view(refreshed, await this.readiness());
  }

  async runNext(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    input: WorkstreamRunRequest,
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const initial = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (initial.revision !== input.expectedRevision) {
      throw AppError.conflict('workstream revision changed; refresh before Run next');
    }
    const existingQueued = initial.lastJobId
      ? this.jobs.getNativeForWorkstream({
          localUserId: auth.user.id,
          workstreamId,
          jobId: initial.lastJobId,
        })
      : null;
    const retryingQueuedIntent = Boolean(
      existingQueued?.native_execution_kind === 'coordinator' &&
      existingQueued.state === 'queued' &&
      (initial.state === 'queued' || initial.state === 'blocked'),
    );
    if (initial.state !== 'ready' && !retryingQueuedIntent) {
      throw AppError.conflict('workstream is not ready for a new explicit Run next');
    }
    if (retryingQueuedIntent) {
      if (!existingQueued || existingQueued.idempotency_key !== input.commandKey) {
        throw AppError.conflict('the queued worker has a different command key');
      }
    }

    const admission = retryingQueuedIntent ? null : this.admissionPolicy(initial, input.policy);
    if (admission && 'reason' in admission) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', admission.reason, {
        expectedStates: ['ready', 'blocked', 'unknown'],
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), await this.readiness());
    }
    const policy = admission?.policy ?? input.policy;
    const budgetAuthorization = admission?.budget.authorizedTokens ?? input.policy.maxTokens;

    let readiness = await this.readiness();
    if (!readiness.available || !readiness.engine) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', readiness.reason ?? 'coordinator_unavailable', {
        expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }

    const parent = this.resolveParent(auth.user.id, projectId, input.parentSessionId);
    const profile = this.resolveProfile(input.targetProfileId);
    const profileBlock = this.profileBlockReason(profile);
    if (profileBlock) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', profileBlock, {
        expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }

    let references: ManagedContextReference[];
    let assembled: ReturnType<ManagedWorkstreamContextAssembler['assemble']>;
    try {
      references = await this.resolveQualifiedReferences(initial, input.references);
      assembled = this.assembler.assemble({
        workstream: initial,
        policy,
        references,
        targetProfileId: profile.id,
        hostEpoch: this.hostEpoch,
      });
    } catch (error) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', this.referenceFailureReason(error), {
        expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }

    // Resolve the actual request model before the durable intent is written.
    // This is the resolved per-profile request, not a guess made from a later
    // terminal message; the served identity is recorded independently.
    const profileScope = await (this.dependencies.profileScopeResolver ?? resolveProfileScope)(profile.id);
    const currentBeforeIntent = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (
      currentBeforeIntent.revision !== initial.revision ||
      (!retryingQueuedIntent && currentBeforeIntent.state !== 'ready') ||
      (retryingQueuedIntent && currentBeforeIntent.lastJobId !== existingQueued?.id)
    ) {
      throw AppError.conflict('workstream controls changed while preparing Run next');
    }
    const currentProfile = this.resolveProfile(profile.id);
    if ((currentProfile.revision ?? 1) !== (profile.revision ?? 1) || this.profileBlockReason(currentProfile)) {
      this.publishRuntime(currentBeforeIntent, currentBeforeIntent.lastJobId, 'blocked', 'target_profile_changed_during_preparation', {
        expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }
    // Re-probe immediately before durable admission. A captured flag/profile
    // cannot authorize a worker after asynchronous source/model preparation.
    readiness = await this.readiness();
    if (!readiness.available || !readiness.engine || !this.dependencies.enabled() || !this.captureReady()) {
      this.publishRuntime(currentBeforeIntent, currentBeforeIntent.lastJobId, 'blocked',
        readiness.reason ?? 'coordinator_unavailable', {
          expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
        });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }
    const currentAtAdmission = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (
      currentAtAdmission.revision !== initial.revision ||
      (!retryingQueuedIntent && currentAtAdmission.state !== 'ready') ||
      (retryingQueuedIntent && currentAtAdmission.lastJobId !== existingQueued?.id)
    ) {
      throw AppError.conflict('workstream controls changed before worker admission');
    }
    const now = new Date().toISOString();
    const targetRevision = currentProfile.revision ?? 1;
    const native = this.jobs.createNativeOrReplay({
      localUserId: auth.user.id,
      workstreamId,
      projectId,
      capturedRevision: currentAtAdmission.revision,
      hostEpoch: this.hostEpoch,
      commandKey: input.commandKey,
      targetAgentId: profile.id,
      targetRevision,
      parent: {
        runtimeInstance: readiness.engine.bootId,
        sessionId: parent.id,
        agentId: parent.profileId ?? parent.opencodeAgentId ?? 'managed-parent',
        projectionId: parent.profileId ?? null,
      },
      queueDeadlineAt: policy.queueDeadlineAt,
      now,
    });
    const metadata = this.coordinatorMetadata(input, policy, budgetAuthorization, currentProfile, parent, assembled, profileScope);
    const configured = this.jobs.configureCoordinatorNativeJob({
      localUserId: auth.user.id,
      workstreamId,
      jobId: native.row.id,
      metadata,
      now,
    });

    // Replays are owned by the native ledger.  A different key cannot piggyback
    // on an active workstream, and a replay never sends another prompt.
    if (retryingQueuedIntent && (!native.replay || currentAtAdmission.lastJobId !== configured.id)) {
      throw AppError.conflict('workstream is not ready for a new explicit Run next');
    }
    if (TERMINAL_JOB_STATES.has(configured.state) || configured.state === 'running' || configured.state === 'unknown') {
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }

    const queued = this.publishRuntime(currentAtAdmission, configured.id, 'queued', null, {
      expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      executorEpoch: this.hostEpoch,
      lastJobId: configured.id,
    });
    if (!queued) {
      this.jobs.markCoordinatorUnknown({
        localUserId: auth.user.id,
        workstreamId,
        jobId: configured.id,
        reason: 'dispatch_controls_changed_before_claim',
        now: new Date().toISOString(),
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }

    // This status-only probe belongs exclusively to this explicit Run next.
    // It cannot start, retry, complete, or wake legacy work.  The repository
    // will re-read every qualifying durable row inside its claim transaction.
    const legacyCapacityAssessment = await this.assessLegacyCoordinatorCapacity(readiness);
    const controlsAfterCapacityProbe = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (
      controlsAfterCapacityProbe.revision !== queued.revision ||
      controlsAfterCapacityProbe.state !== 'queued' ||
      controlsAfterCapacityProbe.executorEpoch !== this.hostEpoch ||
      controlsAfterCapacityProbe.lastJobId !== configured.id
    ) {
      // Pause, cancel, revise, and any other current control transition wins
      // over a late capacity observation.  Do not rewrite it or create a SDK
      // child after this await.
      return this.view(controlsAfterCapacityProbe, readiness);
    }
    readiness = await this.readiness();
    if (!readiness.available || !readiness.engine) {
      this.publishRuntime(queued, configured.id, 'blocked', readiness.reason ?? 'coordinator_unavailable', {
        expectedStates: ['queued'],
        executorEpoch: this.hostEpoch,
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }
    if (!this.profileStillAuthorized(currentProfile)) {
      this.publishRuntime(queued, configured.id, 'blocked', 'target_profile_changed_during_preparation', {
        expectedStates: ['queued'],
        executorEpoch: this.hostEpoch,
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }
    if (
      legacyCapacityAssessment &&
      readiness.engine.bootId !== legacyCapacityAssessment.engineRuntimeInstance
    ) {
      // A status observation from a prior engine instance cannot clear a
      // current host-global slot.  Preserve the unexecuted intent as unknown
      // rather than replaying it under the changed runtime identity.
      this.markUnknown(queued, configured, 'capacity_engine_identity_changed_before_claim');
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }
    let claim: { row: AgentBridgeJobRow; admitted: boolean };
    try {
      claim = this.jobs.claimCoordinatorForExplicitDispatch({
        localUserId: auth.user.id,
        workstreamId,
        jobId: configured.id,
        hostEpoch: this.hostEpoch,
        expectedRevision: queued.revision,
        legacyCapacityAssessment,
        now: new Date().toISOString(),
      });
    } catch {
      this.jobs.markCoordinatorUnknown({
        localUserId: auth.user.id,
        workstreamId,
        jobId: configured.id,
        reason: 'dispatch_controls_changed_before_claim',
        now: new Date().toISOString(),
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }
    if (!claim.admitted) {
      this.publishRuntime(queued, configured.id, 'queued', 'worker_capacity_full', {
        expectedStates: ['queued'],
        executorEpoch: this.hostEpoch,
      });
      return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
    }

    await this.dispatchFreshWorker({
      auth,
      workstream: queued,
      parent,
      profile: currentProfile,
      profileScope,
      job: claim.row,
      assembled,
      declaredReferences: input.references,
    });
    return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId), readiness);
  }

  async pause(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const current = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    const row = this.workstreams.pause(auth.user.id, projectId, workstreamId, expectedRevision);
    if (!row) throw AppError.conflict('workstream revision changed; refresh before pause');
    await this.requestBestEffortCancellation(auth.user.id, workstreamId, current.lastJobId);
    return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId));
  }

  async resume(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const current = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (current.lastJobId) {
      const job = this.jobs.getNativeForWorkstream({
        localUserId: auth.user.id,
        workstreamId,
        jobId: current.lastJobId,
      });
      if (job && ACTIVE_JOB_STATES.has(job.state)) {
        throw AppError.reconciliationRequired('the previous worker remains unresolved; do not admit another turn');
      }
    }
    const budget = this.jobs.coordinatorBudgetState({
      localUserId: auth.user.id,
      workstreamId,
    });
    if (budget.holdReason) {
      throw AppError.reconciliationRequired(`workstream remains held: ${budget.holdReason}`);
    }
    const row = this.workstreams.resume(auth.user.id, projectId, workstreamId, expectedRevision);
    if (!row) throw AppError.conflict('workstream cannot resume at this revision');
    return this.view(row);
  }

  async cancel(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
    jobId: string,
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const current = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (current.lastJobId !== jobId) throw AppError.conflict('only the current worker may be cancelled');
    const row = this.workstreams.cancel(auth.user.id, projectId, workstreamId, expectedRevision);
    if (!row) throw AppError.conflict('workstream cannot cancel at this revision');
    await this.requestBestEffortCancellation(auth.user.id, workstreamId, jobId);
    return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId));
  }

  async acknowledgeUsageEstimate(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
    jobId: string,
    accept: boolean,
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const workstream = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (workstream.revision !== expectedRevision || workstream.lastJobId !== jobId) {
      throw AppError.conflict('workstream revision or worker changed; refresh usage before acknowledging');
    }
    const job = this.jobs.getNativeForWorkstream({ localUserId: auth.user.id, workstreamId, jobId });
    if (!job || job.native_execution_kind !== 'coordinator') throw AppError.notFound('Workstream worker');
    const result = jsonRecord(job.native_result_json);
    if (jsonRecord(job.native_usage_json) || result?.usageStatus !== 'unknown') {
      throw AppError.conflict('usage acknowledgement is not required for this worker');
    }
    const budget = this.jobs.coordinatorBudgetState({
      localUserId: auth.user.id,
      workstreamId,
    });
    const policy = this.policyFor(job);
    const authorizedTokens = budget.authorizedTokens ?? policy?.maxTokens;
    if (!policy || !authorizedTokens) {
      throw AppError.conflict('usage estimate cannot be charged without its durable authorization');
    }
    const chargedEstimateTokens = accept ? policy.maxTokens : 0;
    // The job being acknowledged is currently uncharged, so the pre-existing
    // committed total is the only amount we subtract before this explicit
    // charge. The acknowledgement can never increase authorizedTokens.
    const remainingAuthorizedTokens = Math.max(0, authorizedTokens - budget.committedTokens - chargedEstimateTokens);
    const overshoot = budget.committedTokens + chargedEstimateTokens > authorizedTokens;
    this.jobs.acknowledgeCoordinatorEstimate({
      localUserId: auth.user.id,
      workstreamId,
      jobId,
      actorUserId: auth.user.id,
      accepted: accept,
      chargedEstimateTokens,
      authorizedTokens,
      remainingAuthorizedTokens,
      basis: 'declared_worker_authorization_due_to_missing_actual_usage',
      uncertainty: 'actual_usage_unavailable',
      now: new Date().toISOString(),
    });
    this.publishRuntime(workstream, jobId,
      accept && !overshoot && remainingAuthorizedTokens > 0 ? 'ready' : 'blocked',
      !accept
        ? 'usage_estimate_not_acknowledged'
        : overshoot
          ? 'budget_overshoot_hold'
          : remainingAuthorizedTokens === 0
            ? 'budget_exhausted_hold'
            : 'usage_estimate_charged', {
        expectedStates: ['unknown', 'blocked'],
        executorEpoch: this.hostEpoch,
      });
    return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId));
  }

  /** Trusted native-bridge seam only; never exposed through a user HTTP route. */
  async reconcileUnknown(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
    jobId: string,
    receipt: NativeTerminationReceipt,
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const workstream = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (workstream.revision !== expectedRevision || workstream.lastJobId !== jobId) {
      throw AppError.conflict('workstream revision or worker changed; refresh before reconciling');
    }
    const reconciled = this.jobs.reconcileNativeUnknown({
      localUserId: auth.user.id,
      workstreamId,
      jobId,
      receipt,
    });
    // A user pause/cancel remains authoritative even after the worker's
    // termination receipt lands.  Do not reopen it merely because the native
    // ledger can now classify the old job as failed.
    if (workstream.state !== 'paused' && workstream.state !== 'cancelled') {
      this.publishRuntime(workstream, jobId,
        reconciled.state === 'failed' ? 'blocked' : 'unknown',
        reconciled.state === 'failed' ? 'cancelled_after_unknown' : 'native_status_unknown', {
          expectedStates: ['queued', 'running', 'blocked', 'unknown'],
          executorEpoch: this.hostEpoch,
        });
    }
    return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId));
  }

  /**
   * Explicit user action may ask the server to re-read the exact engine
   * binding.  It never accepts a client-shaped receipt and never sends a
   * prompt.  Anything short of one exact completed terminal message remains
   * held as unknown.
   */
  async reconcileUnknownFromEngine(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
    jobId: string,
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const workstream = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (workstream.revision !== expectedRevision || workstream.lastJobId !== jobId) {
      throw AppError.conflict('workstream revision or worker changed; refresh before reconciling');
    }
    const job = this.jobs.getNativeForWorkstream({ localUserId: auth.user.id, workstreamId, jobId });
    if (!job || job.native_execution_kind !== 'coordinator' || job.state !== 'unknown') {
      throw AppError.conflict('only an unknown coordinator worker can be reconciled');
    }
    await this.reconcileJob(workstream, job, { allowUnknownReconciliation: true });
    return this.view(
      this.requireWorkstream(auth.user.id, projectId, workstreamId),
      await this.readiness(),
    );
  }

  /** Compatibility form: it succeeds only when this is the last unresolved criterion. */
  async waiveCriterion(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
    jobId: string,
    criterionId: string,
  ): Promise<WorkstreamStatusView> {
    return this.waiveCriteria(auth, projectId, workstreamId, expectedRevision, jobId, [criterionId]);
  }

  /**
   * One reviewed batch resolves every remaining criterion from a terminal
   * worker result. This cannot turn one worker result into a sequence of
   * partial applications with an orphaned remainder.
   */
  async waiveCriteria(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
    jobId: string,
    criterionIds: string[],
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    return this.applyCriteria(auth, projectId, workstreamId, {
      expectedRevision,
      jobId,
      criteria: criterionIds.map((criterionId) => ({
        criterionId,
        status: 'waived' as const,
        receiptId: `user-waiver:${randomUUID()}`,
      })),
      application: {
        authority: 'authenticated_user_waiver',
        actorUserId: auth.user.id,
        appliedAt: new Date().toISOString(),
      },
    });
  }

  /** Server-owned evidence inspection; source bytes and filesystem paths never leave this boundary. */
  async inspectEvidence(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    sourceId: string,
  ): Promise<WorkstreamEvidenceView> {
    this.assertActor(auth);
    const workstream = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    const reference = workstream.checkpoint.references.find((item) => item.sourceId === sourceId);
    if (!reference) throw AppError.notFound('Workstream evidence reference');
    try {
      const resolved = await this.artifactResolver.resolveReference({
        ownerUserId: auth.user.id,
        projectId,
        workstreamId,
        workstreamRevision: workstream.revision,
        reference,
      });
      return evidenceView(resolved);
    } catch (error) {
      return {
        selector: sourceId,
        available: false,
        eligible: false,
        reason: this.referenceFailureReason(error),
        canonicalId: null,
        observedVersion: null,
        observedHash: null,
        sourceNamespace: null,
        sourceInstance: null,
        evidenceState: null,
      };
    }
  }

  /**
   * Re-resolves selected evidence at application time. The browser may send a
   * selector and criterion ids only; it cannot supply a receipt, source bytes,
   * an arbitrary path, or a generic file/network permission.
   */
  async verifyCriteriaFromEvidence(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    input: {
      expectedRevision: number;
      jobId: string;
      sourceId: string;
      criterionIds: string[];
    },
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    const workstream = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (workstream.revision !== input.expectedRevision) {
      throw AppError.conflict('workstream revision changed; refresh evidence before applying');
    }
    const reference = workstream.checkpoint.references.find((item) => item.sourceId === input.sourceId);
    if (!reference) throw AppError.conflict('selected evidence is not bound to this workstream');
    let resolved: QualifiedWorkstreamArtifact;
    try {
      resolved = await this.artifactResolver.resolveReference({
        ownerUserId: auth.user.id,
        projectId,
        workstreamId,
        workstreamRevision: workstream.revision,
        reference,
      });
    } catch (error) {
      throw AppError.conflict(`qualified evidence unavailable: ${this.referenceFailureReason(error)}`);
    }
    if (!resolved.eligible || !resolved.receipt.verified || resolved.receipt.reason !== null ||
        !/^[0-9a-f]{64}$/.test(resolved.receipt.observedHash)) {
      throw AppError.conflict('qualified evidence is stale or unavailable');
    }
    return this.applyCriteria(auth, projectId, workstreamId, {
      expectedRevision: input.expectedRevision,
      jobId: input.jobId,
      criteria: input.criterionIds.map((criterionId) => ({
        criterionId,
        status: 'verified' as const,
        receiptId: `artifact:memory_vault:${resolved.receipt.observedHash}:${criterionId}`,
      })),
      application: {
        authority: 'server_resolved_memory_vault_evidence',
        selector: input.sourceId,
        receiptKind: resolved.receipt.kind,
        canonicalId: resolved.receipt.canonicalId,
        observedVersion: resolved.receipt.observedVersion,
        observedHash: resolved.receipt.observedHash,
        sourceNamespace: resolved.receipt.sourceNamespace,
        sourceInstance: resolved.receipt.sourceInstance,
        evidenceState: resolved.receipt.evidenceState,
        appliedAt: new Date().toISOString(),
      },
    });
  }

  private applyCriteria(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    input: {
      expectedRevision: number;
      jobId: string;
      criteria: Array<{ criterionId: string; status: 'verified' | 'waived'; receiptId: string }>;
      application: Record<string, unknown>;
    },
  ): WorkstreamStatusView {
    const workstream = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    const job = this.jobs.getNativeForWorkstream({
      localUserId: auth.user.id,
      workstreamId,
      jobId: input.jobId,
    });
    if (!job?.host_epoch) throw AppError.conflict('worker is unavailable for criterion application');
    const authorityCurrent = this.resultAuthorityReason(workstream, job) === null;
    const outcome = this.jobs.applyCoordinatorCriteria({
      localUserId: auth.user.id,
      projectId,
      workstreamId,
      jobId: input.jobId,
      expectedRevision: input.expectedRevision,
      currentEpoch: this.hostEpoch,
      authorityCurrent,
      criteria: input.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        criterionStatus: criterion.status,
        receiptId: criterion.receiptId,
      })),
      application: input.application,
      now: new Date().toISOString(),
    });
    if (outcome.outcome === 'criterion_unavailable') {
      throw AppError.conflict('criterion is unavailable for authoritative application');
    }
    if (outcome.outcome === 'already_applied') {
      throw AppError.conflict('worker result has already been applied or fenced');
    }
    return this.view(this.requireWorkstream(auth.user.id, projectId, workstreamId));
  }

  /**
   * A bounded, status-only inspection used only by an explicit Run next.
   * Legacy delivery rows remain untouched.  The engine's status protocol omits
   * idle entries, so omission becomes evidence only after the dedicated
   * inspection confirms the exact SDK session and directory plus successful,
   * complete status/question/permission reads.  Any unavailable component is
   * a hold rather than a guessed idle state.
   */
  private async assessLegacyCoordinatorCapacity(
    readiness: WorkstreamReadiness,
  ): Promise<CoordinatorLegacyCapacityAssessment | undefined> {
    if (!readiness.engine) return undefined;
    const snapshot = this.jobs.readCoordinatorLegacyCapacitySnapshot();
    if (!snapshot.available) return undefined;

    const byDirectory = new Map<string, LegacyCoordinatorCapacityRow[]>();
    for (const row of snapshot.rows) {
      if (!isLegacyIdleCapacityCandidate(row)) continue;
      const directory = row.childCwd!;
      const candidates = byDirectory.get(directory) ?? [];
      candidates.push(row);
      byDirectory.set(directory, candidates);
    }

    const qualified = new Map<string, LegacyCoordinatorCapacityRow>();
    for (const [directory, candidates] of byDirectory) {
      const observation = await this.withProbeTimeout(
        this.dependencies.engine.inspectBoundSessionLifecycles(
          candidates.map((candidate) => candidate.childSdkSessionId!),
          directory,
        ),
      );
      if (!observation?.available) continue;
      const known = new Set(observation.knownSessionIds);
      const pending = new Set([
        ...observation.pendingQuestionSessionIds,
        ...observation.pendingPermissionSessionIds,
      ]);
      for (const candidate of candidates) {
        const sdkSessionId = candidate.childSdkSessionId!;
        const status = observation.statusBySessionId[sdkSessionId];
        // `SessionStatus.set(idle)` removes the entry.  It is only a current
        // idle proof here because this exact id was successfully read from
        // GET /session/{id} in this directory and all sibling lifecycle reads
        // were successful and complete. Busy/retry/unknown entries remain holds.
        if (
          known.has(sdkSessionId) &&
          (status === undefined || status.type === 'idle') &&
          !pending.has(sdkSessionId)
        ) {
          qualified.set(candidate.delegationId, candidate);
        }
      }
    }
    return {
      hostEpoch: this.hostEpoch,
      engineRuntimeInstance: readiness.engine.bootId,
      qualifiedRows: [...qualified.values()],
    };
  }

  private async evaluateReadiness(options: { allowPendingReconciliation: boolean }): Promise<WorkstreamReadiness> {
    const unavailable = (reason: string): WorkstreamReadiness => ({
      available: false,
      reason,
      hostEpoch: this.initialized ? this.hostEpoch : null,
      engine: null,
    });
    if (this.disposed) return unavailable('coordinator_disposed');
    if (!this.initialized) return unavailable('coordinator_not_initialized');
    if (!this.dependencies.enabled()) return unavailable('workstreams_opt_in_required');
    if (this.dependencies.dbClient !== 'sqlite') return unavailable('local_sqlite_executor_required');
    if (this.dependencies.role !== 'local' && this.dependencies.role !== 'all') return unavailable('local_executor_role_required');
    if (!this.captureReady() || !this.dependencies.rhythmMcpServerName) {
      return unavailable('managed_capture_unavailable');
    }
    if (!options.allowPendingReconciliation && !this.bootReconciled) {
      return unavailable('restart_reconciliation_pending');
    }
    if (!this.dependencies.engine.isReady || !this.dependencies.engine.hasOwnedEngine) {
      return unavailable('owned_engine_not_ready');
    }
    const identity = await this.dependencies.engine.getEngineIdentity();
    if (!identity) return unavailable('owned_engine_identity_unavailable');
    let mcp: Record<string, { status?: unknown }>;
    try {
      mcp = await this.dependencies.engine.listMcp();
    } catch {
      return unavailable('managed_mcp_status_unavailable');
    }
    if (mcp[this.dependencies.rhythmMcpServerName]?.status !== 'connected') {
      return unavailable('managed_mcp_unavailable');
    }
    return {
      available: true,
      reason: null,
      hostEpoch: this.hostEpoch,
      engine: identity,
    };
  }

  private assertActor(auth: AuthContext | undefined): asserts auth is AuthContext {
    if (!auth?.sessionToken || !Number.isSafeInteger(auth.user?.id) || auth.user.id <= 0) {
      throw AppError.unauthorized('Authentication is required for workstreams');
    }
  }

  private requireWorkstream(ownerUserId: number, projectId: string, id: string): AgentWorkstream {
    const row = this.workstreams.find(ownerUserId, projectId, id);
    if (!row) throw AppError.notFound('Workstream');
    return row;
  }

  private resolveParent(ownerUserId: number, projectId: string, handle: string): AgentSession {
    const session = this.sessions.findById(handle) ?? this.sessions.findBySdkSessionId(handle);
    if (
      !session || session.ownerUserId !== ownerUserId || session.projectId !== projectId ||
      session.parentSessionId !== null || !session.sdkSessionId
    ) {
      throw AppError.forbidden('Run next requires a selected root session in this project');
    }
    return session;
  }

  private resolveProfile(id: string): AgentConfig {
    const profile = this.configs.getById(id);
    if (!profile) throw AppError.badRequest('target profile is unavailable');
    return profile;
  }

  private profileBlockReason(profile: AgentConfig): string | null {
    const executionBlock = agentConfigExecutionBlockReason(profile);
    if (executionBlock) return 'target_profile_unavailable';
    if (!profile.isAgent) return 'target_profile_not_worker';
    const grants = resolveProfileMcpScope(profile.allowedMcpsJson, profile.id, profile.label);
    if (grants.shape === 'invalid') return 'target_profile_mcp_scope_invalid';
    if (grants.shape !== 'unrestricted') {
      const rhythm = grants.toolsByServer[this.dependencies.rhythmMcpServerName];
      if (!rhythm || (rhythm.length > 0 && !rhythm.includes('rhythm_search_memory'))) {
        return 'target_profile_lacks_qualified_read_scope';
      }
    }
    return null;
  }

  private captureReady(): boolean {
    try {
      return this.dependencies.captureAvailable();
    } catch {
      return false;
    }
  }

  /** A CAS projection for asynchronous executor observations. */
  private publishRuntime(
    observed: AgentWorkstream,
    jobId: string | null,
    state: AgentWorkstream['state'],
    reason: string | null,
    options: {
      executorEpoch?: string | null;
      expectedStates?: AgentWorkstream['state'][];
      lastJobId?: string | null;
    } = {},
  ): AgentWorkstream | null {
    return this.workstreams.setRuntimeStateIfCurrent({
      ownerUserId: observed.ownerUserId,
      projectId: observed.projectId,
      id: observed.id,
      expectedRevision: observed.revision,
      expectedExecutorEpoch: observed.executorEpoch,
      expectedLastJobId: observed.lastJobId,
      expectedStates: options.expectedStates ?? [observed.state],
      state,
      reason,
      executorEpoch: options.executorEpoch,
      lastJobId: options.lastJobId === undefined ? jobId : options.lastJobId,
    });
  }

  private dispatchStillAuthorized(
    observed: AgentWorkstream,
    jobId: string,
    profile?: AgentConfig,
  ): boolean {
    const current = this.workstreams.find(observed.ownerUserId, observed.projectId, observed.id);
    return !!current &&
      current.revision === observed.revision &&
      current.executorEpoch === this.hostEpoch &&
      current.lastJobId === jobId &&
      (current.state === 'queued' || current.state === 'running') &&
      this.dependencies.enabled() && !this.disposed && this.captureReady() &&
      (!profile || this.profileStillAuthorized(profile));
  }

  private profileStillAuthorized(profile: AgentConfig): boolean {
    try {
      const current = this.resolveProfile(profile.id);
      return (current.revision ?? 1) === (profile.revision ?? 1) && !this.profileBlockReason(current);
    } catch {
      return false;
    }
  }

  /**
   * Current runtime authority for applying an already-observed terminal
   * result.  This is intentionally re-read after every awaited engine path;
   * the job's saved profile/epoch is evidence of the past, never authority for
   * the present.  It does not call the engine or wake a worker.
   */
  private resultAuthorityReason(workstream: AgentWorkstream, job: AgentBridgeJobRow): string | null {
    if (this.disposed || !this.dependencies.enabled()) return 'workstreams_opt_in_required';
    if (this.dependencies.dbClient !== 'sqlite' ||
        (this.dependencies.role !== 'local' && this.dependencies.role !== 'all') ||
        !this.captureReady()) return 'managed_capture_unavailable';
    if (job.host_epoch !== this.hostEpoch || workstream.executorEpoch !== this.hostEpoch) {
      return 'executor_epoch_changed';
    }
    const metadata = jsonRecord(job.native_metadata_json);
    const profileId = typeof metadata?.targetProfileId === 'string' ? metadata.targetProfileId : null;
    const profileRevision = typeof metadata?.targetProfileRevision === 'number'
      ? metadata.targetProfileRevision
      : null;
    if (!profileId || !Number.isSafeInteger(profileRevision)) return 'target_profile_unavailable';
    try {
      const currentProfile = this.resolveProfile(profileId);
      if ((currentProfile.revision ?? 1) !== profileRevision || this.profileBlockReason(currentProfile)) {
        return 'target_profile_changed_during_execution';
      }
    } catch {
      return 'target_profile_unavailable';
    }
    return null;
  }

  private async resolveQualifiedReferences(
    workstream: AgentWorkstream,
    declared: WorkstreamReferenceInput[],
  ): Promise<ManagedContextReference[]> {
    const unique = new Map<string, WorkstreamReferenceInput>();
    for (const reference of [...workstream.checkpoint.references, ...declared]) {
      unique.set(JSON.stringify(reference), reference);
    }
    const resolved = await Promise.all([...unique.values()].map(async (reference) => {
      const authority = await this.artifactResolver.resolveReference({
        ownerUserId: workstream.ownerUserId,
        projectId: workstream.projectId,
        workstreamId: workstream.id,
        workstreamRevision: workstream.revision,
        reference,
      });
      if (!authority.eligible || !authority.managedReference) {
        throw new WorkstreamArtifactResolutionError(authority.receipt.reason ?? 'reference_authority_unavailable');
      }
      return authority.managedReference;
    }));
    return resolved.sort((left, right) => left.dependencyId.localeCompare(right.dependencyId));
  }

  private sameReferences(
    left: ManagedContextReference[],
    right: ManagedContextReference[],
  ): boolean {
    return JSON.stringify(left.map((reference) => reference.dependencyId).sort()) ===
      JSON.stringify(right.map((reference) => reference.dependencyId).sort());
  }

  private admissionPolicy(
    workstream: AgentWorkstream,
    requested: WorkstreamRunPolicy,
  ): { policy: WorkstreamRunPolicy; budget: CoordinatorBudgetState } | { reason: string; budget: CoordinatorBudgetState } {
    const budget = this.jobs.coordinatorBudgetState({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
    });
    if (budget.holdReason === 'budget_overshoot') return { reason: 'budget_overshoot_hold', budget };
    if (budget.holdReason === 'budget_usage_unknown') return { reason: 'budget_usage_unknown_hold', budget };
    if (budget.holdReason === 'budget_exhausted') return { reason: 'budget_exhausted_hold', budget };
    const available = budget.remainingTokens ?? requested.maxTokens;
    const maxTokens = Math.min(requested.maxTokens, available);
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) return { reason: 'budget_exhausted_hold', budget };
    return {
      budget,
      policy: { ...requested, maxTokens },
    };
  }

  private referenceFailureReason(error: unknown): string {
    if (error instanceof WorkstreamArtifactResolutionError) return error.reason;
    if (error instanceof ManagedWorkstreamPromptOverflow) return 'prompt_control_overflow';
    return 'reference_admission_unavailable';
  }

  private coordinatorMetadata(
    input: WorkstreamRunRequest,
    policy: WorkstreamRunPolicy,
    authorizedTokens: number,
    profile: AgentConfig,
    parent: AgentSession,
    assembled: ReturnType<ManagedWorkstreamContextAssembler['assemble']>,
    profileScope: ProfileScope,
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      executionKind: 'read_only_managed_worker',
      targetProfileId: profile.id,
      targetProfileRevision: profile.revision ?? 1,
      parentSessionId: parent.id,
      requestedModel: {
        providerId: safeIdentifier(profileScope.model.providerID),
        modelId: safeIdentifier(profileScope.model.modelID),
      },
      policy,
      budget: {
        schemaVersion: 1,
        // This remains the user-authorized workstream cap across runs. The
        // per-job policy may be lower because prior actual/charged usage spent
        // part of it; it is not a claimed hard intra-turn enforcement cap.
        authorizedTokens,
        units: 'tokens',
      },
      estimate: {
        schemaVersion: 1,
        basis: 'assembled_control_bytes_div_4',
        addedTokens: assembled.estimatedAddedTokens,
        authorizedTokens: policy.maxTokens,
        actualUsage: 'pending',
      },
      initialReferences: assembled.references.map((reference) => ({
        dependencyId: reference.dependencyId,
        canonicalId: reference.canonicalId,
        observedVersion: reference.observedVersion,
        observedHash: reference.observedHash,
      })),
    };
  }

  private managedMcpScope(profile: AgentConfig): McpRoleConfig {
    return {
      role: `managed-workstream:${profile.id}`,
      mcpServers: {
        [this.dependencies.rhythmMcpServerName]: {
          allowedTools: ['rhythm_search_memory'],
        },
      },
      allowedToolsJson: JSON.stringify({
        [this.dependencies.rhythmMcpServerName]: ['rhythm_search_memory'],
      }),
    };
  }

  private async dispatchFreshWorker(input: {
    auth: AuthContext;
    workstream: AgentWorkstream;
    parent: AgentSession;
    profile: AgentConfig;
    profileScope: ProfileScope;
    job: AgentBridgeJobRow;
    assembled: ReturnType<ManagedWorkstreamContextAssembler['assemble']>;
    declaredReferences: WorkstreamReferenceInput[];
  }): Promise<void> {
    const { auth, workstream, parent, profile, profileScope, job, assembled, declaredReferences } = input;
    // The source authority and controls are checked again directly before a
    // fresh session can expose the assembled metadata to an SDK request.
    try {
      const recheckedReferences = await this.resolveQualifiedReferences(workstream, declaredReferences);
      if (!this.sameReferences(recheckedReferences, assembled.references) ||
          !this.dispatchStillAuthorized(workstream, job.id, profile)) {
        throw new WorkstreamArtifactResolutionError('dispatch_preparation_fenced');
      }
    } catch (error) {
      this.markUnknown(workstream, job, this.referenceFailureReason(error));
      return;
    }
    const localWorker = this.sessions.insert({
      agentKind: 'claude-code',
      profileId: asRhythmProfileId(profile.id),
      opencodeAgentId: asOpenCodeAgentId(profile.ocAgent ?? profile.id),
      taskId: null,
      taskTitle: `Managed workstream ${workstream.id}`,
      cwd: parent.cwd,
      name: `Workstream worker ${workstream.id.slice(0, 8)}`,
      projectId: workstream.projectId,
      permissionMode: 'default',
      mcpRole: this.managedMcpScope(profile).role,
      mcpAllowedToolsJson: this.managedMcpScope(profile).allowedToolsJson,
      ownerUserId: workstream.ownerUserId,
      parentSessionId: parent.id,
      delegationDepth: parent.delegationDepth + 1,
      isSystem: false,
      category: 'chat',
    });

    let sdkSessionId: string | null = null;
    try {
      const created = await this.dependencies.engine.createSession(
        `Workstream worker ${workstream.id.slice(0, 8)}`,
        parent.cwd,
        this.managedMcpScope(profile),
        [],
        profileScope.model.providerID,
        parent.sdkSessionId!,
        'default',
        false,
        true,
      );
      if (!created.id) throw new Error('fresh_managed_session_not_confirmed');
      sdkSessionId = created.id;
      // Session creation is not an inference. Still, a user control or flag
      // drift after this await wins and prevents the prompt from being sent.
      if (!this.dispatchStillAuthorized(workstream, job.id, profile)) {
        throw new Error('dispatch_controls_changed_before_prompt');
      }
      this.sessions.setSdkSessionId(localWorker.id, sdkSessionId);
      this.sessions.updateStatus(localWorker.id, 'working');
      opencodeSessionMap.set(localWorker.id, sdkSessionId);
      this.jobs.bindCoordinatorChild({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
        jobId: job.id,
        localSessionId: localWorker.id,
        sdkSessionId,
        now: new Date().toISOString(),
      });
      // Use the existing bridge so the normal app continues receiving ordinary
      // session status events.  This does not enqueue a model turn.
      void import('./opencode_stream_bridge')
        .then(({ streamBridge }) => streamBridge.streamSession(localWorker.id, sdkSessionId!, parent.cwd))
        .catch(() => undefined);

      const accepted = await this.dependencies.engine.promptAsync(
        sdkSessionId,
        assembled.prompt,
        profileScope.model,
        parent.cwd,
        profileScope.ocAgent ? { agent: profileScope.ocAgent } : undefined,
        undefined,
        undefined,
        {
          sessionId: localWorker.id,
          sdkSessionId,
          origin: 'delegation',
          requestedSource: 'agent_config',
          requestedProviderId: profileScope.model.providerID,
          requestedModelId: profileScope.model.modelID,
          resolvedProviderId: profileScope.model.providerID,
          resolvedModelId: profileScope.model.modelID,
          routeAuthed: true,
          reasonCode: 'managed_workstream',
        },
        {
          auth,
          scope: {
            sessionId: localWorker.id,
            ownerUserId: workstream.ownerUserId,
            projectId: workstream.projectId,
            workstreamId: workstream.id,
            workstreamRevision: workstream.revision,
            role: 'worker',
            hostEpoch: this.hostEpoch,
            sdkSessionId,
          },
          records: this.dependencies.records,
          policy: {
            enabled: this.dependencies.enabled,
            dbClient: this.dependencies.dbClient,
            role: this.dependencies.role,
            currentHostEpoch: () => this.disposed ? null : this.hostEpoch,
          },
          captureReady: this.captureReady(),
          workerJobId: job.id,
          initialReferences: assembled.references,
          onPrepared: ({ dispatchId, sdkUserMessageId }) => {
            if (!this.dispatchStillAuthorized(workstream, job.id, profile)) {
              throw new Error('dispatch_controls_changed_before_sdk_call');
            }
            this.jobs.bindCoordinatorDispatch({
              localUserId: workstream.ownerUserId,
              workstreamId: workstream.id,
              jobId: job.id,
              dispatchId,
              sdkUserMessageId,
              now: new Date().toISOString(),
            });
            this.publishRuntime(workstream, job.id, 'running', null, {
              expectedStates: ['queued'],
              executorEpoch: this.hostEpoch,
            });
          },
        },
      );
      if (!accepted) throw new Error('managed_prompt_transport_unconfirmed');
    } catch {
      this.jobs.markCoordinatorUnknown({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
        jobId: job.id,
        reason: sdkSessionId ? 'prompt_transport_unconfirmed' : 'fresh_session_creation_unconfirmed',
        now: new Date().toISOString(),
      });
      this.publishRuntime(workstream, job.id, 'unknown', sdkSessionId ? 'prompt_transport_unconfirmed' : 'fresh_session_creation_unconfirmed', {
        expectedStates: ['queued', 'running', 'blocked', 'unknown'],
        executorEpoch: this.hostEpoch,
      });
    }
  }

  private async reconcileJob(
    workstream: AgentWorkstream,
    job: AgentBridgeJobRow,
    options: { allowUnknownReconciliation?: boolean } = {},
  ): Promise<void> {
    if (TERMINAL_JOB_STATES.has(job.state)) return;
    // Unknown is an explicit safety boundary.  A later status refresh never
    // converts it into a terminal result from a best-effort observation; only
    // a trusted native receipt or this explicit exact-engine recheck may
    // reconcile it.
    const reconcilingUnknown = job.state === 'unknown';
    if (reconcilingUnknown && !options.allowUnknownReconciliation) return;
    const now = new Date().toISOString();
    if (job.state === 'queued') {
      const expired = this.jobs.expireCoordinatorQueueDeadline({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
        jobId: job.id,
        now,
      });
      if (expired.state === 'failed') {
        this.publishRuntime(workstream, job.id, 'blocked', 'queue_deadline_exceeded', {
          expectedStates: ['queued', 'blocked'],
        });
      }
      return;
    }
    if (job.state === 'running' && this.wallTimeExceeded(job, now)) {
      // This occurs only during an explicit status/boot reconciliation read;
      // there is no background timer or follow-up dispatch.  The cancellation
      // transport is deliberately not treated as a completion receipt.
      await this.requestBestEffortCancellation(
        workstream.ownerUserId,
        workstream.id,
        job.id,
        'wall_time_exceeded_termination_unconfirmed',
      );
      this.publishRuntime(workstream, job.id, 'unknown', 'wall_time_exceeded_termination_unconfirmed', {
        expectedStates: ['queued', 'running', 'blocked', 'unknown'],
        executorEpoch: this.hostEpoch,
      });
      return;
    }
    if (job.state === 'claimed' || !job.native_child_session_id || !job.native_child_sdk_session_id) {
      this.markUnknown(workstream, job, 'child_binding_incomplete');
      return;
    }
    const child = this.sessions.findById(job.native_child_session_id);
    if (!child || child.sdkSessionId !== job.native_child_sdk_session_id) {
      this.markUnknown(workstream, job, 'child_binding_mismatch');
      return;
    }
    const statuses = await this.withProbeTimeout(
      this.dependencies.engine.getSessionStatuses(child.cwd),
    );
    if (!statuses) {
      this.markUnknown(workstream, job, 'engine_status_probe_timed_out');
      return;
    }
    const status = statuses[child.sdkSessionId];
    if (!status) {
      this.markUnknown(workstream, job, 'engine_status_missing_or_unavailable');
      return;
    }
    if (status.type === 'busy') {
      // A busy observation is not a terminal receipt.  Keep an already
      // unknown job fenced rather than reclassifying it as running.
      if (reconcilingUnknown) return;
      this.jobs.touchCoordinatorProgress({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
        jobId: job.id,
        now,
      });
      const interaction = await this.pendingInteractionReason(child.sdkSessionId, child.cwd);
      if (!interaction) {
        this.markUnknown(workstream, job, 'interaction_probe_timed_out');
        return;
      }
      this.publishRuntime(workstream, job.id, interaction.reason ? 'blocked' : 'running', interaction.reason, {
        expectedStates: ['queued', 'running', 'blocked'],
        executorEpoch: this.hostEpoch,
      });
      return;
    }
    if (status.type !== 'idle') {
      this.markUnknown(workstream, job, 'engine_status_unrecognized');
      return;
    }
    const idleInteraction = await this.pendingInteractionReason(child.sdkSessionId, child.cwd);
    if (idleInteraction === null) {
      this.markUnknown(workstream, job, 'interaction_probe_timed_out');
      return;
    }
    if (idleInteraction.reason) {
      this.publishRuntime(workstream, job.id, 'blocked', idleInteraction.reason, {
        expectedStates: ['queued', 'running', 'blocked'],
        executorEpoch: this.hostEpoch,
      });
      return;
    }
    let messages: Array<{ info: unknown }>;
    try {
      const response = await this.listAllMessages(child.sdkSessionId, child.cwd);
      if (!response) {
        this.markUnknown(workstream, job, 'terminal_message_lookup_timed_out');
        return;
      }
      messages = response;
    } catch {
      this.markUnknown(workstream, job, 'terminal_message_lookup_unavailable');
      return;
    }
    const matches = messages.filter((message) => {
      const info = message.info as {
        id?: unknown; role?: unknown; parentID?: unknown;
      };
      return info.role === 'assistant' && info.parentID === job.native_sdk_user_message_id && typeof info.id === 'string';
    });
    if (matches.length === 0) {
      this.markUnknown(workstream, job, 'terminal_message_binding_missing');
      return;
    }
    const infos = matches.map((message) => message.info as {
      id: string; error?: { name?: unknown }; time?: { completed?: unknown };
      providerID?: unknown; modelID?: unknown; finish?: unknown; tokens?: unknown; cost?: unknown;
    });
    if (infos.some((info) => !info.time || typeof info.time.completed !== 'number')) {
      this.markUnknown(workstream, job, 'turn_assistant_step_incomplete');
      return;
    }
    const terminal = infos.filter((info) => info.finish === 'stop');
    if (terminal.length !== 1) {
      this.markUnknown(workstream, job, terminal.length > 1
        ? 'terminal_message_binding_ambiguous'
        : 'terminal_message_not_authoritative');
      return;
    }
    const info = terminal[0];
    const usage = usageFromAssistantSteps(infos, this.policyFor(job));
    const errored = !!info.error;
    const result = {
      schemaVersion: 1,
      status: usage ? (errored ? 'failed' : 'succeeded') : 'unknown',
      terminalMessageId: info.id,
      assistantMessageIds: infos.map((assistant) => assistant.id),
      observedAt: now,
      servedProviderId: safeIdentifier(info.providerID),
      servedModelId: safeIdentifier(info.modelID),
      finish: safeIdentifier(info.finish),
      errorCode: errored ? safeReason(info.error?.name) ?? 'engine_terminal_error' : null,
      usageStatus: usage ? 'actual' : 'unknown',
    };
    if (!usage) {
      this.jobs.holdCoordinatorUsageUnknown({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
        jobId: job.id,
        result,
        reason: 'turn_usage_incomplete',
        now,
      });
      this.publishRuntime(workstream, job.id, 'unknown', 'usage_unknown_ack_required', {
        expectedStates: ['queued', 'running', 'blocked', 'unknown'],
        executorEpoch: this.hostEpoch,
      });
      return;
    }
    const completed = this.jobs.completeCoordinator({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: job.id,
      state: errored ? 'failed' : 'succeeded',
      result,
      usage,
      now,
    });
    const current = this.workstreams.find(workstream.ownerUserId, workstream.projectId, workstream.id);
    const fencedByControls = !current ||
      current.revision !== job.workstream_revision ||
      current.executorEpoch !== this.hostEpoch ||
      current.lastJobId !== job.id ||
      current.state === 'paused' || current.state === 'cancelled' || current.state === 'completed' ||
      current.stateReason === 'controls_revised';
    const authorityReason = current ? this.resultAuthorityReason(current, completed) : 'workstream_missing';
    const fenced = fencedByControls || authorityReason !== null;
    this.jobs.recordCoordinatorApplication({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: job.id,
      application: {
        schemaVersion: 1,
        status: fenced ? 'stale' : 'quarantined',
        reason: fencedByControls
          ? 'controls_or_user_state_changed_before_result'
          : authorityReason
            ? 'runtime_authority_changed_before_result'
          : errored
            ? 'worker_terminal_error_no_application'
            : 'read_only_result_requires_authoritative_criterion_receipt',
        terminalMessageId: info.id,
        workstreamRevision: current?.revision ?? workstream.revision,
      },
      now,
    });
    if (!fencedByControls && current) {
      const budget = this.jobs.coordinatorBudgetState({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
      });
      this.publishRuntime(current, completed.id,
        authorityReason || budget.holdReason !== null || errored ? 'blocked' : 'ready',
        authorityReason
          ? 'coordinator_runtime_authority_changed'
          : budget.holdReason === 'budget_overshoot'
          ? 'budget_overshoot_hold'
          : budget.holdReason === 'budget_exhausted'
            ? 'budget_exhausted_hold'
            : budget.holdReason === 'budget_usage_unknown'
              ? 'budget_usage_unknown_hold'
          : errored
            ? 'worker_terminal_error'
            : 'result_quarantined_requires_receipt', {
          expectedStates: ['queued', 'running', 'blocked', 'unknown'],
          executorEpoch: this.hostEpoch,
        });
    }
  }

  private markUnknown(workstream: AgentWorkstream, job: AgentBridgeJobRow, reason: string): void {
    this.jobs.markCoordinatorUnknown({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: job.id,
      reason,
      now: new Date().toISOString(),
    });
    this.publishRuntime(workstream, job.id, 'unknown', 'native_status_unknown', {
      expectedStates: ['queued', 'running', 'blocked', 'unknown'],
      executorEpoch: this.hostEpoch,
    });
  }

  private async requestBestEffortCancellation(
    ownerUserId: number,
    workstreamId: string,
    jobId: string | null,
    reason?: string,
  ): Promise<void> {
    if (!jobId) return;
    const job = this.jobs.getNativeForWorkstream({ localUserId: ownerUserId, workstreamId, jobId });
    if (!job || TERMINAL_JOB_STATES.has(job.state)) return;
    const requested = this.jobs.requestCoordinatorCancellation({
      localUserId: ownerUserId,
      workstreamId,
      jobId,
      reason,
      now: new Date().toISOString(),
    });
    if (requested.native_child_sdk_session_id) {
      const child = requested.native_child_session_id ? this.sessions.findById(requested.native_child_session_id) : null;
      try {
        // A boolean/error is transport evidence only.  The ledger remains
        // unknown until the accepted termination-receipt reconciliation path.
        await this.dependencies.engine.abortSession(requested.native_child_sdk_session_id, child?.cwd);
      } catch {
        // Deliberately keep the unknown/cancelling record unchanged.
      }
    }
  }

  /** Bounded reads only; expiry records ambiguity instead of a guessed status. */
  private async withProbeTimeout<T>(pending: Promise<T>): Promise<T | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), STATUS_PROBE_TIMEOUT_MS);
      void pending.then(
        (value) => { clearTimeout(timeout); resolve(value); },
        () => { clearTimeout(timeout); resolve(null); },
      );
    });
  }

  /** Probe questions/permissions for both busy and idle sessions. */
  private async pendingInteractionReason(
    sdkSessionId: string,
    cwd: string,
  ): Promise<{ reason: 'worker_question_pending' | 'worker_permission_pending' | null } | null> {
    const interactions = await this.withProbeTimeout(Promise.all([
      this.dependencies.engine.listQuestions(cwd),
      this.dependencies.engine.listPermissions(cwd),
    ]));
    if (!interactions) return null;
    const [questions, permissions] = interactions;
    return {
      reason: questions.some((item) => item.sessionID === sdkSessionId)
        ? 'worker_question_pending'
        : permissions.some((item) => item.sessionID === sdkSessionId)
          ? 'worker_permission_pending'
          : null,
    };
  }

  /**
   * Walk every cursor page to the engine's explicit completion boundary. A
   * repeated cursor or failed page is not a partial success and is held
   * unknown by the caller.
   */
  private async listAllMessages(
    sdkSessionId: string,
    cwd: string,
  ): Promise<Array<{ info: unknown }> | null> {
    const messages: Array<{ info: unknown }> = [];
    const cursors = new Set<string>();
    let before: string | undefined;
    for (;;) {
      const page = await this.withProbeTimeout(this.dependencies.engine.listMessagesPage(
        sdkSessionId,
        cwd,
        {
          limit: 100,
          ...(before === undefined ? {} : { before }),
          caller: 'persistent_workstream_coordinator',
        },
      ));
      if (!page) return null;
      messages.push(...page.messages as Array<{ info: unknown }>);
      if (!page.nextCursor) return messages;
      if (cursors.has(page.nextCursor)) throw new Error('message_page_cursor_repeated');
      cursors.add(page.nextCursor);
      before = page.nextCursor;
    }
  }

  private policyFor(job: AgentBridgeJobRow): WorkstreamRunPolicy | null {
    const policy = jsonRecord(job.native_metadata_json)?.policy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;
    const value = policy as Record<string, unknown>;
    if (
      value.maxTurns !== 1 || !Number.isSafeInteger(value.maxWallTimeSeconds) ||
      !Number.isSafeInteger(value.maxTokens) ||
      (value.queueDeadlineAt !== null && typeof value.queueDeadlineAt !== 'string')
    ) return null;
    return {
      maxTurns: 1,
      maxWallTimeSeconds: value.maxWallTimeSeconds as number,
      maxTokens: value.maxTokens as number,
      queueDeadlineAt: value.queueDeadlineAt as string | null,
    };
  }

  private wallTimeExceeded(job: AgentBridgeJobRow, now: string): boolean {
    const policy = this.policyFor(job);
    if (!policy || !job.native_started_at) return false;
    const startedAt = Date.parse(job.native_started_at);
    const observedAt = Date.parse(now);
    return Number.isFinite(startedAt) && Number.isFinite(observedAt) &&
      observedAt - startedAt >= policy.maxWallTimeSeconds * 1_000;
  }

  private view(workstream: AgentWorkstream, readiness?: WorkstreamReadiness): WorkstreamStatusView {
    const jobs = this.jobs.listNativeForWorkstream({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
    }).map((job) => this.jobView(job));
    return {
      workstream,
      // Never infer that the executor is usable from local flags.  A caller
      // that did not explicitly probe gets an honest, unavailable projection.
      readiness: readiness ?? {
        available: false,
        reason: 'executor_status_not_probed',
        hostEpoch: this.initialized ? this.hostEpoch : null,
        engine: null,
      },
      jobs,
      budget: this.jobs.coordinatorBudgetState({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
      }),
    };
  }

  private jobView(job: AgentBridgeJobRow): WorkstreamJobView {
    const metadata = jsonRecord(job.native_metadata_json);
    const requestedModel = asRecord(metadata?.requestedModel);
    const estimate = asRecord(metadata?.estimate);
    const estimateAcknowledgement = asRecord(metadata?.estimateAcknowledgement);
    return {
      id: job.id,
      commandKey: job.idempotency_key,
      state: job.state,
      stateReason: job.state_reason,
      createdAt: job.created_at,
      startedAt: job.native_started_at,
      lastProgressAt: job.native_progress_at,
      terminalAt: job.terminal_at,
      cancellationRequestedAt: job.cancel_requested_at,
      workerSessionId: job.native_child_session_id,
      targetProfileId: typeof metadata?.targetProfileId === 'string' ? metadata.targetProfileId : null,
      requestedProviderId: safeIdentifier(requestedModel?.providerId),
      requestedModelId: safeIdentifier(requestedModel?.modelId),
      policy: this.policyFor(job),
      estimate: estimate
        ? {
          ...estimate,
          ...(estimateAcknowledgement ? { estimateAcknowledgement } : {}),
        }
        : estimateAcknowledgement
          ? { estimateAcknowledgement }
          : null,
      usage: jsonRecord(job.native_usage_json),
      result: jsonRecord(job.native_result_json),
      application: jsonRecord(job.native_application_json),
    };
  }
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._:/@+\-]{1,200}$/.test(value) ? value : null;
}

function safeReason(value: unknown): string | null {
  return typeof value === 'string' && SAFE_REASON.test(value) ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function usageFromAssistantSteps(
  infos: Array<{ tokens?: unknown; cost?: unknown }>,
  policy: WorkstreamRunPolicy | null,
): Record<string, unknown> | null {
  if (infos.length === 0) return null;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let cost: number | null = 0;
  for (const info of infos) {
    const tokens = info.tokens;
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
    const record = tokens as Record<string, unknown>;
    const cache = record.cache;
    const cacheRecord = cache && typeof cache === 'object' && !Array.isArray(cache)
      ? cache as Record<string, unknown>
      : null;
    const input = tokenCount(record.input);
    const output = tokenCount(record.output);
    const reasoning = tokenCount(record.reasoning);
    const cacheRead = tokenCount(cacheRecord?.read);
    const cacheWrite = tokenCount(cacheRecord?.write);
    const explicitTotal = tokenCount(record.total);
    if ([input, output, reasoning, cacheRead, cacheWrite].some((value) => value === null)) return null;
    // The engine's explicit total is authoritative because some providers put
    // reasoning inside output. Without that total, a nonzero reasoning field
    // cannot be safely added without risking a double charge.
    if (explicitTotal === null && reasoning! > 0) return null;
    inputTokens += input!;
    outputTokens += output!;
    reasoningTokens += reasoning!;
    cacheReadTokens += cacheRead!;
    cacheWriteTokens += cacheWrite!;
    totalTokens += explicitTotal ?? (input! + output! + cacheRead! + cacheWrite!);
    const stepCost = finite(info.cost);
    cost = cost === null || stepCost === null ? null : cost + stepCost;
  }
  return {
    schemaVersion: 1,
    status: 'actual',
    basis: 'engine_assistant_turn_steps',
    assistantStepCount: infos.length,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    authorizedTokens: policy?.maxTokens ?? null,
    overshoot: policy ? totalTokens > policy.maxTokens : null,
    cost,
  };
}
