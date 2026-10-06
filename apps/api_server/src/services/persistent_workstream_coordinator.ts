import { randomUUID } from 'node:crypto';

import type { AuthContext } from '../middleware/auth_middleware';
import { AppError } from '../errors/app_error';
import {
  parseManagedWorkstreamStructuredProposal,
  type ManagedWorkstreamStructuredProposal,
  SELECTED_REFERENCE_RECEIPT_BASES,
  SELECTED_REFERENCE_SOURCE_CRITERION,
  SELECTED_REFERENCE_SUMMARY_CRITERION,
  workflowCriterionReceiptId,
  type WorkflowCriterionReceipt,
  type WorkstreamReferenceInput,
  type WorkstreamRunPolicy,
} from '../contracts/agent_workstream_contract';
import {
  type OneShotAutomationPlan,
  type OneShotAutomationRequest,
} from '../contracts/agent_workstream_automation_contract';
import {
  evaluateOneShotAutomation,
  type OneShotAutomationDecision,
} from './workstream_automation_policy';
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
import type { AgentWorkstream, AgentWorkstreamCheckpoint } from '../models/agent_workstream';
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
  checkSelectedReferenceSummary,
  selectedReferenceCurrent,
  type QualifiedWorkstreamArtifact,
  type SelectedReferenceExpectation,
} from './workstream_artifact_verifier';
import {
  resolveProfileMcpScope,
  resolveProfileScope,
  type McpRoleConfig,
  type ProfileScope,
} from './agent_profile_scope';
import type { FiniteExecutionPermissionRule } from './coordinator_finite_execution_scope';
import type {
  BoundSessionLifecycleInspection,
  OpencodeClientService,
  OpencodeEngineIdentity,
  PersistedManagedConsentAuthority,
} from './opencode_client_service';
import {
  CODING_WORKFLOW_BOUNDS,
  CODING_WORKFLOW_DISPATCH_REASON,
  parseCodingWorkflowDispatchReceipt,
  type CodingWorkflowCoverageIds,
  type CodingWorkflowCoverageResult,
  type CodingWorkflowAuthorization,
  type CodingWorkflowDispatchReceipt,
  type CodingWorkflowHoldReason,
  type CodingWorkflowRootTurn,
} from '../contracts/coordinator_conversation_contract';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
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

/**
 * A restart scan is complete only after every outside-epoch page has been
 * inspected under one current owned-engine identity.  Waiting and failed are
 * intentionally distinct: an explicit later status read may retry either,
 * but neither may publish coordinator readiness.
 */
export interface RestartReconciliationResult {
  status: 'completed' | 'waiting' | 'failed' | 'skipped';
  reason: string | null;
  examined: number;
  reattached: number;
  unknown: number;
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

/**
 * Server-internal finite conversation authority. It is never accepted by an
 * HTTP route and cannot be represented by a browser bearer or scheduler.
 * The conversation service derives it only from a current durable outer grant
 * after owner, root, profile, budget, and source controls are rechecked.
 */
export interface CoordinatorFiniteConversationAuthority {
  kind: 'conversation_finite';
  ownerUserId: number;
  conversationId: string;
  authorizationId: string;
  acknowledgementAt: string;
  /**
   * Synchronous control fence used around local admission/session creation.
   * The stricter asynchronous validator below runs at every managed SDK
   * boundary, after all awaited preparation has completed.
   */
  stillAuthorized(): boolean;
  /**
   * A server-only capability derived from the exact durable finite authority.
   * It intentionally contains no browser bearer and is re-read immediately
   * before managed SDK preparation and exposure.
   */
  validate: PersistedManagedConsentAuthority['validate'];
  /**
   * Present only for a fresh `execute` acknowledgement.  The closure is
   * server-created from the persisted scope snapshot; it re-derives the
   * profile/project target before each exposure and never accepts a browser
   * path, MCP list, skill list, or permission rule.
   */
  executionScope?: {
    scopeSignature: string;
    resolve(): Promise<{
      targetCwd: string;
      permissionRules: FiniteExecutionPermissionRule[];
      mcpRoleConfig: McpRoleConfig;
      skillAllowlist: string[];
      scopeSignature: string;
    } | null>;
  };
}

/**
 * Server-private handoff to the pre-existing async Coding Workflow route. It
 * is attached only after a finite ordinal has been durably reserved and this
 * coordinator job has claimed one host-global slot.  It contains no bearer,
 * caller-selected target, path, model, tool or permission.
 */
export interface CoordinatorWorkflowDispatchInput {
  authorization: CodingWorkflowAuthorization;
  dispatch(input: {
    ownerUserId: number;
    projectId: string;
    workstream: AgentWorkstream;
    job: AgentBridgeJobRow;
    parent: AgentSession;
    targetProfile: AgentConfig;
    targetProfileScope: ProfileScope;
  }): Promise<'accepted' | 'unknown' | 'rejected'>;
}

/** Status-only post-reconciliation event; it deliberately carries no prose. */
export interface CoordinatorTerminalObserver {
  onCoordinatorTerminal(input: {
    ownerUserId: number;
    projectId: string;
    workstreamId: string;
    parentSessionId: string;
    jobId: string;
    state: 'succeeded' | 'failed';
    hostEpoch: string;
  }): Promise<void> | void;
}

export interface WorkstreamAutomationStatusView {
  workstreamId: string;
  revision: number;
  plan: OneShotAutomationPlan | null;
  decision: OneShotAutomationDecision;
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
  /** Explicit, authenticated acknowledgement of soft total-token semantics. */
  softTokenBudgetAcknowledged: true;
  policy: WorkstreamRunPolicy;
  references: WorkstreamReferenceInput[];
  /** Internal-only fixed G2 manager route; no HTTP parser accepts this field. */
  workflow?: CoordinatorWorkflowDispatchInput;
}

/**
 * The only non-interactive path is a consumed, server-created one-shot plan.
 * It deliberately has no bearer/session token: the SDK boundary receives a
 * narrow, synchronous capability that re-reads the durable plan and native
 * binding immediately before inference.
 */
type WorkstreamDispatchAuthority =
  | {
    kind: 'interactive';
    ownerUserId: number;
    auth: AuthContext;
    acknowledgementAt: string | null;
  }
  | {
    kind: 'one_shot_automation';
    ownerUserId: number;
    plan: OneShotAutomationPlan;
    acknowledgementAt: string;
  }
  | CoordinatorFiniteConversationAuthority;

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
  /** C2 composition may consume only a reconciled finite conversation turn. */
  terminalObserver?: CoordinatorTerminalObserver;
  /**
   * G2: complete manager + descendants + charged callback accounting. Absent
   * means a workflow job's usage is never known (it holds, never advances).
   */
  workflowCoverage?: Pick<CodingWorkflowCoverageInspector, 'inspect'>;
  /** G2 reviewer identification (exact async delegation target). */
  delegations?: Pick<AgentAsyncDelegationsRepository, 'findByChildSessionId'>;
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
  private reconciledEngineBootId: string | null = null;
  private disposed = false;
  private reconciliationGeneration = 0;
  private restartReconciliationInFlight: Promise<RestartReconciliationResult> | null = null;
  private automationSweepInFlight: Promise<void> | null = null;
  private automationSweepCursor: string | undefined;

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
    this.reconciledEngineBootId = null;
    this.reconciliationGeneration += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.reconciliationGeneration += 1;
  }

  /**
   * A bounded, status-only restart reconciliation.  A busy, exactly bound
   * child can be reattached to this coordinator epoch.  Everything ambiguous
   * stays unknown; no old intent is ever replayed.
   */
  async reconcileAfterEngineReady(): Promise<RestartReconciliationResult> {
    if (this.restartReconciliationInFlight) return this.restartReconciliationInFlight;
    if (this.bootReconciled) {
      // A later engine-ready callback is a real lifecycle boundary.  Reuse a
      // completed scan only for this exact owned engine boot; a changed boot
      // must be scanned again before it can admit a new worker.
      const current = await this.evaluateReadiness({ allowPendingReconciliation: true });
      if (!current.available || !current.engine) {
        return this.restartResult(this.restartUnavailableStatus(current.reason), current.reason);
      }
      if (this.reconciledEngineBootId === current.engine.bootId) {
        return this.restartResult('completed', null);
      }
      this.bootReconciled = false;
      this.reconciledEngineBootId = null;
      if (this.restartReconciliationInFlight) return this.restartReconciliationInFlight;
    }
    const generation = this.reconciliationGeneration;
    const pending = this.performRestartReconciliation(generation);
    this.restartReconciliationInFlight = pending;
    try {
      return await pending;
    } finally {
      if (this.restartReconciliationInFlight === pending) {
        this.restartReconciliationInFlight = null;
      }
    }
  }

  async readiness(): Promise<WorkstreamReadiness> {
    const reconciliation = await this.reconcileAfterEngineReady();
    const readiness = await this.evaluateReadiness({ allowPendingReconciliation: false });
    // A scan exception is not a generic pending state: surface its bounded,
    // safe reason so the normal client can distinguish a retryable scan
    // failure from an engine/MCP precondition that is still waiting.
    if (
      !readiness.available &&
      readiness.reason === 'restart_reconciliation_pending' &&
      reconciliation.status === 'failed'
    ) {
      return { ...readiness, reason: reconciliation.reason };
    }
    return readiness;
  }

  private async performRestartReconciliation(
    generation: number,
  ): Promise<RestartReconciliationResult> {
    let examined = 0;
    let reattached = 0;
    let unknown = 0;
    let initial: WorkstreamReadiness;
    try {
      initial = await this.evaluateReadiness({ allowPendingReconciliation: true });
    } catch {
      return this.restartResult('failed', 'restart_reconciliation_scan_failed');
    }
    if (!initial.available || !initial.engine) {
      return this.restartResult(this.restartUnavailableStatus(initial.reason), initial.reason);
    }
    const snapshot = { generation, engineBootId: initial.engine.bootId };

    try {
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
          // An unknown record is an immutable safety hold during automatic
          // restart reconciliation.  Its cancellation/result/usage receipt
          // and any user control row must remain exactly as they were.
          if (job.state === 'unknown') {
            unknown += 1;
            continue;
          }
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
            const current = await this.restartReadinessForSnapshot(snapshot);
            if (!current.available) {
              return this.restartResult(this.restartUnavailableStatus(current.reason), current.reason, {
                examined,
                reattached,
                unknown,
              });
            }
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
      const current = await this.restartReadinessForSnapshot(snapshot);
      if (!current.available) {
        return this.restartResult(this.restartUnavailableStatus(current.reason), current.reason, {
          examined,
          reattached,
          unknown,
        });
      }
      this.bootReconciled = true;
      this.reconciledEngineBootId = snapshot.engineBootId;
      return this.restartResult('completed', null, { examined, reattached, unknown });
    } catch {
      // A partial walk is never evidence of completion.  The next explicit
      // readiness/status/read request may retry from the durable ledger.
      return this.restartResult('failed', 'restart_reconciliation_scan_failed', {
        examined,
        reattached,
        unknown,
      });
    }
  }

  async list(auth: AuthContext, projectId: string, limit: number, cursor?: string): Promise<{
    items: WorkstreamStatusView[];
    nextCursor: string | null;
  }> {
    this.assertActor(auth);
    const items = this.workstreams.list(auth.user.id, projectId, limit, cursor);
    // A list/Refresh is an explicit status read even when the project has no
    // visible workstreams.  Let it finish a previously waiting boot scan once
    // current prerequisites become available; this never schedules a worker.
    const readiness = await this.readiness();
    // A list is an explicit user status read, not a scheduler.  Bound it to
    // ten current entries so it never becomes an unbounded engine sweep.
    const reconciled = await Promise.all(items.slice(0, 10).map((item) => this.status(auth, projectId, item.id)));
    const viewsById = new Map(reconciled.map((view) => [view.workstream.id, view]));
    return {
      // Keep pagination truthful: only reconciliation is bounded.  Rows beyond
      // that bound still appear with an explicitly unprobed readiness state.
      items: items.map((item) => viewsById.get(item.id) ?? this.view(item, readiness)),
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

  /** Save a single server-resolved future authorization; saving never dispatches. */
  async configureAutomation(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    requested: OneShotAutomationRequest,
  ): Promise<WorkstreamAutomationStatusView> {
    this.assertActor(auth);
    const initial = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    if (initial.revision !== requested.expectedRevision || initial.state !== 'ready') {
      throw AppError.conflict('workstream is not ready at the requested revision');
    }
    if (this.hasActiveCoordinatorJob(initial)) {
      throw AppError.conflict('workstream has an active or uncertain worker');
    }
    const parent = this.resolveParent(auth.user.id, projectId, requested.parentSessionId);
    const profile = this.resolveProfile(requested.targetProfileId);
    if (this.profileBlockReason(profile)) throw AppError.conflict('target profile is unavailable');
    const profileScope = await (this.dependencies.profileScopeResolver ?? resolveProfileScope)(profile.id);
    if (
      profileScope.model.providerID !== requested.requestedModel.providerId ||
      profileScope.model.modelID !== requested.requestedModel.modelId
    ) {
      throw AppError.conflict('selected profile no longer resolves to the requested model');
    }
    const current = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    const currentProfile = this.resolveProfile(profile.id);
    let currentParent: AgentSession;
    try {
      currentParent = this.resolveParent(auth.user.id, projectId, parent.id);
    } catch {
      throw AppError.conflict('selected parent session changed while saving automation');
    }
    if (
      current.revision !== initial.revision || current.state !== 'ready' ||
      !this.profileStillAuthorized(currentProfile) ||
      (currentProfile.revision ?? 1) !== (profile.revision ?? 1) ||
      currentParent.sdkSessionId !== parent.sdkSessionId || Date.now() >= Date.parse(requested.dueAt)
    ) {
      throw AppError.conflict('workstream or target profile changed while saving automation');
    }
    const requestedPolicy: WorkstreamRunPolicy = {
      maxTurns: 1,
      maxWallTimeSeconds: requested.maxWallTimeSeconds,
      maxTokens: requested.maxTokens,
      queueDeadlineAt: requested.expiresAt,
    };
    const admission = this.admissionPolicy(current, requestedPolicy);
    if ('reason' in admission || admission.policy.maxTokens !== requested.maxTokens) {
      throw AppError.conflict('current authorized budget cannot reserve the selected automation');
    }
    const acknowledgedAt = new Date().toISOString();
    const plan: OneShotAutomationPlan = {
      ...requested,
      schemaVersion: 1,
      planId: randomUUID(),
      workstreamId: current.id,
      // Parent lookup normalizes a paired mobile SDK handle to the durable
      // local root id before it can become a saved authority.
      parentSessionId: parent.id,
      requestedModel: {
        providerId: profileScope.model.providerID,
        modelId: profileScope.model.modelID,
      },
      resolvedModel: {
        providerId: profileScope.model.providerID,
        modelId: profileScope.model.modelID,
      },
      workstreamRevision: current.revision,
      targetProfileRevision: currentProfile.revision ?? 1,
      acknowledgedByUserId: auth.user.id,
      acknowledgedAt,
      status: 'scheduled',
    };
    const saved = this.workstreams.configureAutomation({
      ownerUserId: auth.user.id,
      projectId,
      id: current.id,
      expectedRevision: current.revision,
      plan,
    });
    if (saved.conflict || !saved.row) {
      throw AppError.conflict('workstream automation changed; refresh before saving');
    }
    // Persisting consent is deliberately inert: it must not initiate a
    // restart/status reconciliation just to decorate the save response.
    return this.automationStatusFor(saved.row, this.unprobedAutomationReadiness());
  }

  async disableAutomation(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
    planId: string,
  ): Promise<WorkstreamAutomationStatusView> {
    this.assertActor(auth);
    const row = this.workstreams.disableAutomation({
      ownerUserId: auth.user.id,
      projectId,
      id: workstreamId,
      expectedRevision,
      planId,
    });
    if (!row) throw AppError.conflict('workstream automation changed; refresh before disabling');
    // Disabling is likewise a durable control write only.  A later explicit
    // status/readiness action may probe runtime state.
    return this.automationStatusFor(row, this.unprobedAutomationReadiness());
  }

  async automationStatus(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
  ): Promise<WorkstreamAutomationStatusView> {
    this.assertActor(auth);
    const row = this.requireWorkstream(auth.user.id, projectId, workstreamId);
    return this.automationStatusFor(row, await this.readiness());
  }

  /**
   * Existing minute scheduler callback.  It has no timer of its own, never
   * scans when the local coordinator is off, and coalesces concurrent ticks.
   */
  async sweepOneShotAutomation(): Promise<void> {
    if (this.automationSweepInFlight) return this.automationSweepInFlight;
    if (
      this.disposed || !this.dependencies.enabled() || this.dependencies.dbClient !== 'sqlite' ||
      (this.dependencies.role !== 'local' && this.dependencies.role !== 'all')
    ) return;
    const pending = this.performOneShotAutomationSweep();
    this.automationSweepInFlight = pending;
    try {
      await pending;
    } finally {
      if (this.automationSweepInFlight === pending) this.automationSweepInFlight = null;
    }
  }

  private async performOneShotAutomationSweep(): Promise<void> {
    // A bounded page prevents the legacy minute job from becoming a new queue
    // executor.  The cursor rotates only through opted-in rows.
    const candidates = this.workstreams.listAutomationCandidates(20, this.automationSweepCursor);
    if (candidates.length === 0 && this.automationSweepCursor) {
      this.automationSweepCursor = undefined;
      return;
    }
    this.automationSweepCursor = candidates.length === 20 ? candidates.at(-1)?.workstream.id : undefined;
    for (const candidate of candidates) {
      if (this.disposed || !this.dependencies.enabled()) return;
      const plan = candidate.automation.plan;
      if (!plan || candidate.automation.serialized === null) continue;
      if (plan.status === 'consumed') {
        // Consumption is a once-only admission receipt, not a terminal
        // receipt.  A later scheduler tick may inspect only the exact active
        // child it admitted so durable actual usage can be recorded.  It
        // cannot create, retry, wake, or reconcile an unknown worker.
        await this.reconcileConsumedOneShotAutomation(candidate.workstream, plan);
        continue;
      }
      if (plan.status !== 'scheduled') continue;
      // A future authorization is inert.  Do not touch engine/MCP status
      // before its due instant merely because the existing minute scheduler
      // happened to tick.
      const now = Date.now();
      if (now < Date.parse(plan.dueAt)) continue;
      if (now >= Date.parse(plan.expiresAt)) {
        this.workstreams.blockAutomation({
          ownerUserId: candidate.workstream.ownerUserId,
          projectId: candidate.workstream.projectId,
          id: candidate.workstream.id,
          expectedRevision: candidate.workstream.revision,
          planId: plan.planId,
          serialized: candidate.automation.serialized,
          reason: 'automation_expired',
        });
        continue;
      }
      const readiness = await this.readiness();
      const decision = await this.automationDecisionFor(candidate.workstream, candidate.automation.value, readiness);
      if (decision.status === 'off' || decision.status === 'scheduled' ||
          decision.status === 'consumed' || decision.status === 'disabled') continue;
      if (decision.status === 'expired' || decision.status === 'blocked') {
        this.workstreams.blockAutomation({
          ownerUserId: candidate.workstream.ownerUserId,
          projectId: candidate.workstream.projectId,
          id: candidate.workstream.id,
          expectedRevision: candidate.workstream.revision,
          planId: plan.planId,
          serialized: candidate.automation.serialized,
          reason: `automation_${decision.reason}`,
        });
        continue;
      }
      const consumed = this.workstreams.consumeAutomation({
        ownerUserId: candidate.workstream.ownerUserId,
        projectId: candidate.workstream.projectId,
        id: candidate.workstream.id,
        expectedRevision: candidate.workstream.revision,
        planId: plan.planId,
        serialized: candidate.automation.serialized,
      });
      if (!consumed) continue;
      const consumedRecord = this.workstreams.getAutomation(
        consumed.ownerUserId, consumed.projectId, consumed.id,
      );
      if (!consumedRecord?.plan || consumedRecord.plan.status !== 'consumed' || !consumedRecord.serialized) continue;
      try {
        await this.runNextAuthorized({
          kind: 'one_shot_automation',
          ownerUserId: consumed.ownerUserId,
          plan: consumedRecord.plan,
          acknowledgementAt: consumedRecord.plan.acknowledgedAt,
        }, consumed.projectId, consumed.id, this.automationRunRequest(consumedRecord.plan, consumed));
      } catch {
        // The consumed record remains the once-only receipt.  If no native
        // intent became visible, fence it for human review rather than retry.
        const after = this.workstreams.find(consumed.ownerUserId, consumed.projectId, consumed.id);
        if (after?.state === 'ready') {
          this.workstreams.blockAutomation({
            ownerUserId: consumed.ownerUserId,
            projectId: consumed.projectId,
            id: consumed.id,
            expectedRevision: after.revision,
            planId: consumedRecord.plan.planId,
            serialized: consumedRecord.serialized,
            reason: 'automation_dispatch_not_admitted',
          });
        }
      }
    }
  }

  /**
   * The minute callback is allowed to observe an already-consumed run, but
   * never to extend its authority.  Every field below is re-read from the
   * owner-scoped durable row before the existing strict terminal-accounting
   * path can touch the engine.  A user control revision, cancellation,
   * unknown receipt, different command, or replacement last-job binding is
   * therefore a no-op rather than a scheduler recovery attempt.
   */
  private async reconcileConsumedOneShotAutomation(
    observed: AgentWorkstream,
    observedPlan: OneShotAutomationPlan,
  ): Promise<void> {
    if (
      this.disposed || !this.dependencies.enabled() || this.dependencies.dbClient !== 'sqlite' ||
      (this.dependencies.role !== 'local' && this.dependencies.role !== 'all')
    ) return;
    const current = this.workstreams.find(observed.ownerUserId, observed.projectId, observed.id);
    const record = current
      ? this.workstreams.getAutomation(current.ownerUserId, current.projectId, current.id)
      : null;
    const plan = record?.plan;
    if (
      !current || !record?.serialized || !plan || plan.status !== 'consumed' ||
      plan.planId !== observedPlan.planId || plan.authorizationKey !== observedPlan.authorizationKey ||
      plan.workstreamId !== observedPlan.workstreamId ||
      plan.workstreamRevision !== observedPlan.workstreamRevision ||
      plan.workstreamId !== current.id || plan.expectedRevision !== plan.workstreamRevision ||
      plan.workstreamRevision !== current.revision ||
      plan.acknowledgedByUserId !== current.ownerUserId ||
      current.executorEpoch !== this.hostEpoch || !current.lastJobId ||
      (current.state !== 'queued' && current.state !== 'running' && current.state !== 'blocked') ||
      current.stateReason === 'controls_revised'
    ) return;
    const job = this.jobs.getNativeForWorkstream({
      localUserId: current.ownerUserId,
      workstreamId: current.id,
      jobId: current.lastJobId,
    });
    if (
      !job || job.state !== 'claimed' && job.state !== 'running' || job.cancel_requested_at !== null ||
      job.direction !== 'rhythm_to_native' || job.native_execution_kind !== 'coordinator' ||
      job.local_user_id !== current.ownerUserId || job.workstream_id !== current.id ||
      job.workstream_project_id !== current.projectId || job.workstream_revision !== current.revision ||
      job.host_epoch !== this.hostEpoch || job.idempotency_key !== plan.authorizationKey ||
      job.parent_session_id !== plan.parentSessionId || job.target_agent_id !== plan.targetProfileId ||
      job.target_revision !== plan.targetProfileRevision
    ) return;
    await this.reconcileJob(current, job);
  }

  async runNext(
    auth: AuthContext,
    projectId: string,
    workstreamId: string,
    input: WorkstreamRunRequest,
  ): Promise<WorkstreamStatusView> {
    this.assertActor(auth);
    return this.runNextAuthorized({
      kind: 'interactive',
      ownerUserId: auth.user.id,
      auth,
      acknowledgementAt: null,
    }, projectId, workstreamId, input);
  }

  /**
   * Internal C2 continuation entrypoint. There is intentionally no route for
   * this method: it accepts only a server-derived finite authority after a
   * reconciled terminal receipt, never an HTTP bearer or a scheduler payload.
   */
  async runNextFromFiniteConversation(
    authority: CoordinatorFiniteConversationAuthority,
    projectId: string,
    workstreamId: string,
    input: WorkstreamRunRequest,
  ): Promise<WorkstreamStatusView> {
    if (
      authority.kind !== 'conversation_finite' ||
      !Number.isSafeInteger(authority.ownerUserId) || authority.ownerUserId <= 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(authority.conversationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(authority.authorizationId) ||
      Number.isNaN(Date.parse(authority.acknowledgementAt)) ||
      typeof authority.stillAuthorized !== 'function' || typeof authority.validate !== 'function' ||
      !authority.stillAuthorized()
    ) {
      throw AppError.forbidden('finite conversation authority is invalid');
    }
    return this.runNextAuthorized(authority, projectId, workstreamId, input);
  }

  /**
   * Existing scheduler/native-completion seam for an already-admitted C2
   * child. This is deliberately status-only: it can reconcile one exact
   * durable job and emit the existing terminal observer, but it cannot create
   * a worker, reserve an ordinal, wake a parent, or replay an unknown job.
   */
  async reconcileFiniteConversationJob(
    authority: CoordinatorFiniteConversationAuthority,
    projectId: string,
    workstreamId: string,
    jobId: string,
  ): Promise<void> {
    if (
      authority.kind !== 'conversation_finite' ||
      !Number.isSafeInteger(authority.ownerUserId) || authority.ownerUserId <= 0 ||
      typeof authority.stillAuthorized !== 'function' || !authority.stillAuthorized()
    ) return;
    const workstream = this.workstreams.find(authority.ownerUserId, projectId, workstreamId);
    if (!workstream || workstream.lastJobId !== jobId) return;
    const job = this.jobs.getNativeForWorkstream({
      localUserId: authority.ownerUserId,
      workstreamId,
      jobId,
    });
    if (!job || job.state === 'unknown' || TERMINAL_JOB_STATES.has(job.state)) return;
    // `reconcileJob` owns strict engine/receipt accounting and all durable
    // CAS fences. If authority changes during its awaits, the observer's own
    // rereads hold continuation; this method never dispatches by itself.
    await this.reconcileJob(workstream, job);
  }

  /**
   * G2 `selected_reference_summary_v1` checked result for one reconciled
   * workflow job. Model output, a stop step, a valid proposal or a callback
   * never resolve a criterion: only this method's fresh server resolution
   * (plus, for the brief, the deterministic citation check and the enrolled
   * independent reviewer's verdict) writes the receipt, through the existing
   * criterion transaction. Re-entrant: an already applied job replays its
   * outcome; it never dispatches anything itself.
   */
  async checkWorkflowResult(input: {
    ownerUserId: number;
    projectId: string;
    workstreamId: string;
    jobId: string;
    expectation: SelectedReferenceExpectation;
    /** Synchronous same-goal authority proof, re-run after every await. */
    current(): boolean;
  }): Promise<CodingWorkflowCheckOutcome> {
    const hold = (reason: string): CodingWorkflowCheckOutcome => ({ kind: 'hold', reason });
    const read = () => {
      const workstream = this.workstreams.find(input.ownerUserId, input.projectId, input.workstreamId);
      const job = this.jobs.getNativeForWorkstream({
        localUserId: input.ownerUserId, workstreamId: input.workstreamId, jobId: input.jobId,
      });
      return { workstream, job };
    };
    if (!input.current()) return hold('authority_changed');
    const { workstream, job } = read();
    const record = job ? codingWorkflowRecord(job) : null;
    if (
      !workstream || !job || !record || workstream.lastJobId !== job.id || job.state !== 'succeeded' ||
      job.host_epoch !== this.hostEpoch || job.cancel_requested_at !== null
    ) return hold('job_not_checkable');
    if (['paused', 'cancelled'].includes(workstream.state)) return hold(`workstream_${workstream.state}`);
    const application = jsonRecord(job.native_application_json);
    const priorReceipts = application?.status === 'applied' && Array.isArray(application.workflowReceipts)
      ? application.workflowReceipts as WorkflowCriterionReceipt[]
      : null;
    if (priorReceipts) {
      // Duplicate terminal / concurrent sweep: replay the durable outcome only
      // while the workstream is still exactly the applied revision.
      if (workstream.revision !== Number(application!.workstreamRevision) + 1) return hold('application_superseded');
      return priorReceipts[0]?.criterionId === SELECTED_REFERENCE_SUMMARY_CRITERION
        ? { kind: 'final', workstreamRevision: workstream.revision }
        : { kind: 'intermediate', workstreamRevision: workstream.revision };
    }
    if (application?.status !== 'quarantined') return hold('application_fenced');
    if (this.jobs.coordinatorBudgetState({ localUserId: input.ownerUserId, workstreamId: input.workstreamId }).holdReason !== null) {
      return hold('usage_incomplete_or_budget_hold');
    }
    const status = (id: string) => workstream.checkpoint.criteria.find((candidate) => candidate.id === id)?.status;
    const criterionId = status(SELECTED_REFERENCE_SOURCE_CRITERION) === 'pending'
      ? SELECTED_REFERENCE_SOURCE_CRITERION
      : status(SELECTED_REFERENCE_SOURCE_CRITERION) === 'verified' && status(SELECTED_REFERENCE_SUMMARY_CRITERION) === 'pending'
        ? SELECTED_REFERENCE_SUMMARY_CRITERION
        : null;
    const reference = workstream.checkpoint.references.find((candidate) => candidate.sourceId === input.expectation.sourceId);
    if (!criterionId || !reference || reference.expectedVersion !== input.expectation.observedVersion) {
      return hold('criterion_unavailable');
    }

    let review: WorkflowCriterionReceipt['review'] = null;
    if (criterionId === SELECTED_REFERENCE_SUMMARY_CRITERION) {
      const reviewed = await this.readWorkflowReview(job, input.expectation);
      if ('reason' in reviewed) return hold(reviewed.reason);
      review = reviewed;
    }
    // The fresh server resolution is the last await before the CAS.
    let resolved: QualifiedWorkstreamArtifact;
    try {
      resolved = await this.artifactResolver.resolveReference({
        ownerUserId: input.ownerUserId,
        projectId: input.projectId,
        workstreamId: input.workstreamId,
        workstreamRevision: workstream.revision,
        reference,
      });
    } catch {
      return hold('source_unavailable');
    }
    if (!selectedReferenceCurrent(input.expectation, resolved)) return hold('source_changed');
    const after = read();
    if (
      !input.current() || !after.workstream || !after.job || after.workstream.revision !== workstream.revision ||
      after.workstream.lastJobId !== job.id || after.job.native_application_json !== job.native_application_json ||
      after.job.state !== 'succeeded'
    ) return hold('changed_during_check');
    const receipt: WorkflowCriterionReceipt = {
      schemaVersion: 1,
      kind: 'selected_reference_summary_v1',
      criterionId,
      bases: SELECTED_REFERENCE_RECEIPT_BASES[criterionId],
      sourceId: input.expectation.sourceId,
      canonicalId: resolved.receipt.canonicalId,
      observedVersion: resolved.receipt.observedVersion,
      observedHash: resolved.receipt.observedHash,
      sourceInstance: resolved.receipt.sourceInstance!,
      review,
    };
    const outcome = this.jobs.applyCoordinatorCriteria({
      localUserId: input.ownerUserId,
      projectId: input.projectId,
      workstreamId: input.workstreamId,
      jobId: job.id,
      expectedRevision: workstream.revision,
      currentEpoch: this.hostEpoch,
      authorityCurrent: this.resultAuthorityReason(after.workstream, after.job) === null,
      criteria: [{ criterionId, criterionStatus: 'verified', receiptId: workflowCriterionReceiptId(receipt) }],
      workflowReceipts: [receipt],
      application: { authority: 'server_checked_selected_reference_summary_v1' },
      now: new Date().toISOString(),
    });
    if (outcome.outcome !== 'applied') return hold(`criterion_${outcome.outcome}`);
    const applied = this.workstreams.find(input.ownerUserId, input.projectId, input.workstreamId);
    if (!applied) return hold('workstream_missing');
    return criterionId === SELECTED_REFERENCE_SUMMARY_CRITERION
      ? { kind: 'final', workstreamRevision: applied.revision }
      : { kind: 'intermediate', workstreamRevision: applied.revision };
  }

  /**
   * The manager's cited brief and the exactly-one covered `verification-gate`
   * async child's strict verdict. Reviewer identity comes from the durable
   * delegation row + the job's covered descendant set, never from text.
   */
  private async readWorkflowReview(
    job: AgentBridgeJobRow,
    expectation: SelectedReferenceExpectation,
  ): Promise<NonNullable<WorkflowCriterionReceipt['review']> | { reason: string }> {
    const result = jsonRecord(job.native_result_json);
    const coverage = result?.workflowCoverage as { descendantSdkSessionIds?: unknown } | null | undefined;
    const descendants = Array.isArray(coverage?.descendantSdkSessionIds) ? coverage!.descendantSdkSessionIds as string[] : null;
    const manager = job.native_child_session_id ? this.sessions.findById(job.native_child_session_id) : null;
    if (!descendants || !manager?.cwd || !manager.sdkSessionId) return { reason: 'review_coverage_unavailable' };
    const delegations = this.dependencies.delegations ?? new AgentAsyncDelegationsRepository();
    const reviewers = descendants.flatMap((sdkSessionId) => {
      const child = this.sessions.findBySdkSessionId(sdkSessionId);
      const delegation = child ? delegations.findByChildSessionId(child.id) : null;
      return child?.cwd && child.parentSessionId === manager.id && delegation?.parentSessionId === manager.id &&
        delegation.targetAgentConfigId === 'verification-gate'
        ? [child]
        : [];
    });
    if (reviewers.length !== 1) return { reason: reviewers.length === 0 ? 'review_absent' : 'review_ambiguous' };
    const reviewer = reviewers[0];
    let managerMessages: Array<{ info: unknown; parts?: unknown }> | null;
    let reviewerMessages: Array<{ info: unknown; parts?: unknown }> | null;
    try {
      managerMessages = await this.listAllMessages(manager.sdkSessionId, manager.cwd);
      reviewerMessages = await this.listAllMessages(reviewer.sdkSessionId!, reviewer.cwd!);
    } catch {
      return { reason: 'review_messages_unavailable' };
    }
    const brief = managerMessages ? closingAssistantText(managerMessages, job.native_sdk_user_message_id) : null;
    const verdict = reviewerMessages ? closingAssistantText(reviewerMessages, null) : null;
    if (!brief || !verdict) return { reason: 'review_messages_unavailable' };
    const checked = checkSelectedReferenceSummary({ expectation, managerText: brief.text, reviewerText: verdict.text });
    if (!checked.ok) return { reason: checked.reason };
    return {
      managerTerminalMessageId: brief.messageId,
      reviewerSdkSessionId: reviewer.sdkSessionId!,
      reviewerTerminalMessageId: verdict.messageId,
      summarySha256: checked.summarySha256,
    };
  }

  /** Shared explicit/saved-consent admission; only the public wrapper owns bearer auth. */
  private async runNextAuthorized(
    authority: WorkstreamDispatchAuthority,
    projectId: string,
    workstreamId: string,
    input: WorkstreamRunRequest,
  ): Promise<WorkstreamStatusView> {
    const ownerUserId = authority.ownerUserId;
    const workflow = input.workflow;
    if (workflow) {
      // The workflow adapter is a private finite-consumer branch, never an
      // alternate public Run-next shape. It must be tied to the consumed
      // authority/ordinal and fixed manager profile before any row/session or
      // engine operation.
      if (
        authority.kind !== 'conversation_finite' ||
        input.policy.outputContract !== 'coding_workflow_durable_consumer_v1' ||
        input.targetProfileId !== 'workflow-orchestrator' ||
        workflow.authorization.workstreamId !== workstreamId ||
        workflow.authorization.authorizationId !== authority.authorizationId ||
        !Number.isSafeInteger(workflow.authorization.ordinal) || workflow.authorization.ordinal < 1
      ) throw AppError.forbidden('workflow finite authority is invalid');
    }
    if (input.softTokenBudgetAcknowledged !== true) {
      throw AppError.badRequest('Run next requires explicit acknowledgement of the soft total-token authorization');
    }
    const initial = this.requireWorkstream(ownerUserId, projectId, workstreamId);
    if (initial.revision !== input.expectedRevision) {
      throw AppError.conflict('workstream revision changed; refresh before Run next');
    }
    if (authority.kind === 'one_shot_automation' && !this.oneShotAdmissionStillAuthorized(authority.plan, initial, input)) {
      throw AppError.conflict('saved one-shot authorization is no longer current');
    }
    if (authority.kind === 'conversation_finite' && !authority.stillAuthorized()) {
      throw AppError.conflict('finite conversation authorization is no longer current');
    }
    const existingQueued = initial.lastJobId
      ? this.jobs.getNativeForWorkstream({
          localUserId: ownerUserId,
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
      if (authority.kind !== 'interactive') {
        throw AppError.conflict('a consumed server authority cannot retry a queued worker');
      }
      if (!existingQueued || existingQueued.idempotency_key !== input.commandKey) {
        throw AppError.conflict('the queued worker has a different command key');
      }
    }

    const admission = retryingQueuedIntent ? null : this.admissionPolicy(initial, input.policy);
    if (admission && 'reason' in admission) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', admission.reason, {
        expectedStates: ['ready', 'blocked', 'unknown'],
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), await this.readiness());
    }
    const policy = admission?.policy ?? input.policy;
    const budgetAuthorization = admission?.budget.authorizedTokens ?? input.policy.maxTokens;

    let readiness = await this.readiness();
    if (!readiness.available || !readiness.engine) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', readiness.reason ?? 'coordinator_unavailable', {
        expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }

    const parent = this.resolveParent(ownerUserId, projectId, input.parentSessionId);
    const profile = this.resolveProfile(input.targetProfileId);
    const profileBlock = this.profileBlockReason(profile);
    if (profileBlock) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', profileBlock, {
        expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }

    let finiteExecutionScope: {
      targetCwd: string;
      permissionRules: FiniteExecutionPermissionRule[];
      mcpRoleConfig: McpRoleConfig;
      skillAllowlist: string[];
      scopeSignature: string;
    } | null = null;
    const profileScope = await (this.dependencies.profileScopeResolver ?? resolveProfileScope)(profile.id);
    if (authority.kind === 'conversation_finite' && authority.executionScope) {
      finiteExecutionScope = await authority.executionScope.resolve();
      if (
        !finiteExecutionScope ||
        finiteExecutionScope.scopeSignature !== authority.executionScope.scopeSignature ||
        finiteExecutionScope.targetCwd !== parent.cwd
      ) {
        this.publishRuntime(initial, initial.lastJobId, 'blocked', 'finite_execution_scope_unavailable', {
          expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
        });
        return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
      }
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
        scopedExecution: finiteExecutionScope !== null,
      });
    } catch (error) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', this.referenceFailureReason(error), {
        expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }
    // This is only a conservative preflight against the already assembled
    // authored control. It is not a complete input or total-use estimate:
    // engine, profile, tool, and system overhead remain deliberately unknown.
    if (policy.maxTokens < assembled.estimatedAddedTokens) {
      this.publishRuntime(initial, initial.lastJobId, 'blocked', 'token_authorization_below_authored_control_estimate', {
        expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }

    // Resolve the actual request model before the durable intent is written.
    // This is the resolved per-profile request, not a guess made from a later
    // terminal message; the served identity is recorded independently.
    const currentBeforeIntent = this.requireWorkstream(ownerUserId, projectId, workstreamId);
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
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }
    // Re-probe immediately before durable admission. A captured flag/profile
    // cannot authorize a worker after asynchronous source/model preparation.
    readiness = await this.readiness();
    if (!readiness.available || !readiness.engine || !this.dependencies.enabled() || !this.captureReady()) {
      this.publishRuntime(currentBeforeIntent, currentBeforeIntent.lastJobId, 'blocked',
        readiness.reason ?? 'coordinator_unavailable', {
          expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
        });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }
    const currentAtAdmission = this.requireWorkstream(ownerUserId, projectId, workstreamId);
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
      localUserId: ownerUserId,
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
    // A queued replay is the same already-acknowledged user command, not a
    // new authorization event. Reuse its immutable acknowledgement timestamp
    // so idempotency does not turn a safe retry into a different job payload.
    if (retryingQueuedIntent && (!native.replay || currentAtAdmission.lastJobId !== native.row.id)) {
      throw AppError.conflict('workstream is not ready for a new explicit Run next');
    }
    const acknowledgementAt = native.replay
      ? this.replaySoftTokenAcknowledgementAt(native.row, ownerUserId)
      : authority.acknowledgementAt ?? now;
    if (!acknowledgementAt) {
      throw AppError.conflict('queued worker lacks a durable soft total-token acknowledgement');
    }
    const metadata = this.coordinatorMetadata(
      input,
      policy,
      budgetAuthorization,
      currentProfile,
      parent,
      assembled,
      profileScope,
      ownerUserId,
      acknowledgementAt,
    );
    const configured = this.jobs.configureCoordinatorNativeJob({
      localUserId: ownerUserId,
      workstreamId,
      jobId: native.row.id,
      metadata,
      now,
    });

    // Replays are owned by the native ledger. A different key cannot piggyback
    // on an active workstream, and a replay never sends another prompt.
    if (TERMINAL_JOB_STATES.has(configured.state) || configured.state === 'running' || configured.state === 'unknown') {
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }

    const queued = this.publishRuntime(currentAtAdmission, configured.id, 'queued', null, {
      expectedStates: retryingQueuedIntent ? ['queued', 'blocked'] : ['ready'],
      executorEpoch: this.hostEpoch,
      lastJobId: configured.id,
    });
    if (!queued) {
      this.jobs.markCoordinatorUnknown({
        localUserId: ownerUserId,
        workstreamId,
        jobId: configured.id,
        reason: 'dispatch_controls_changed_before_claim',
        now: new Date().toISOString(),
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }

    // This status-only probe belongs exclusively to this explicit Run next.
    // It cannot start, retry, complete, or wake legacy work.  The repository
    // will re-read every qualifying durable row inside its claim transaction.
    const legacyCapacityAssessment = await this.assessLegacyCoordinatorCapacity(readiness);
    const controlsAfterCapacityProbe = this.requireWorkstream(ownerUserId, projectId, workstreamId);
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
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }
    if (!this.profileStillAuthorized(currentProfile)) {
      this.publishRuntime(queued, configured.id, 'blocked', 'target_profile_changed_during_preparation', {
        expectedStates: ['queued'],
        executorEpoch: this.hostEpoch,
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }
    if (
      legacyCapacityAssessment &&
      readiness.engine.bootId !== legacyCapacityAssessment.engineRuntimeInstance
    ) {
      // A status observation from a prior engine instance cannot clear a
      // current host-global slot.  Preserve the unexecuted intent as unknown
      // rather than replaying it under the changed runtime identity.
      this.markUnknown(queued, configured, 'capacity_engine_identity_changed_before_claim');
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }
    let claim: { row: AgentBridgeJobRow; admitted: boolean };
    try {
      claim = this.jobs.claimCoordinatorForExplicitDispatch({
        localUserId: ownerUserId,
        workstreamId,
        jobId: configured.id,
        hostEpoch: this.hostEpoch,
        expectedRevision: queued.revision,
        legacyCapacityAssessment,
        now: new Date().toISOString(),
      });
    } catch {
      this.jobs.markCoordinatorUnknown({
        localUserId: ownerUserId,
        workstreamId,
        jobId: configured.id,
        reason: 'dispatch_controls_changed_before_claim',
        now: new Date().toISOString(),
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }
    if (!claim.admitted) {
      this.publishRuntime(queued, configured.id, 'queued', 'worker_capacity_full', {
        expectedStates: ['queued'],
        executorEpoch: this.hostEpoch,
      });
      return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
    }

    if (workflow) {
      await this.dispatchWorkflowManager({
        authority,
        workstream: queued,
        parent,
        profile: currentProfile,
        profileScope,
        job: claim.row,
        workflow,
      });
    } else {
      await this.dispatchFreshWorker({
        authority,
        workstream: queued,
        parent,
        profile: currentProfile,
        profileScope,
        job: claim.row,
        assembled,
        declaredReferences: input.references,
        finiteExecutionScope,
      });
    }
    return this.view(this.requireWorkstream(ownerUserId, projectId, workstreamId), readiness);
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

  private restartResult(
    status: RestartReconciliationResult['status'],
    reason: string | null,
    counters: Partial<Pick<RestartReconciliationResult, 'examined' | 'reattached' | 'unknown'>> = {},
  ): RestartReconciliationResult {
    return {
      status,
      reason,
      examined: counters.examined ?? 0,
      reattached: counters.reattached ?? 0,
      unknown: counters.unknown ?? 0,
    };
  }

  private restartUnavailableStatus(
    reason: string | null,
  ): Extract<RestartReconciliationResult['status'], 'waiting' | 'skipped'> {
    return reason === 'coordinator_disposed' ||
      reason === 'coordinator_not_initialized' ||
      reason === 'coordinator_lifecycle_changed_during_reconciliation'
      ? 'skipped'
      : 'waiting';
  }

  /** Recheck every async scan observation against the current owned runtime. */
  private async restartReadinessForSnapshot(snapshot: {
    generation: number;
    engineBootId: string;
  }): Promise<WorkstreamReadiness> {
    const readiness = await this.evaluateReadiness({ allowPendingReconciliation: true });
    if (!readiness.available) return readiness;
    if (snapshot.generation !== this.reconciliationGeneration || this.disposed) {
      return this.unavailableReadiness(
        this.disposed ? 'coordinator_disposed' : 'coordinator_lifecycle_changed_during_reconciliation',
      );
    }
    if (!readiness.engine || readiness.engine.bootId !== snapshot.engineBootId) {
      return this.unavailableReadiness('owned_engine_identity_changed_during_reconciliation');
    }
    return readiness;
  }

  private unavailableReadiness(reason: string): WorkstreamReadiness {
    return {
      available: false,
      reason,
      hostEpoch: this.initialized ? this.hostEpoch : null,
      engine: null,
    };
  }

  /** Preconditions that do not cross an async engine boundary. */
  private readinessPreconditionReason(): string | null {
    if (this.disposed) return 'coordinator_disposed';
    if (!this.initialized) return 'coordinator_not_initialized';
    if (!this.dependencies.enabled()) return 'workstreams_opt_in_required';
    if (this.dependencies.dbClient !== 'sqlite') return 'local_sqlite_executor_required';
    if (this.dependencies.role !== 'local' && this.dependencies.role !== 'all') return 'local_executor_role_required';
    if (!this.captureReady() || !this.dependencies.rhythmMcpServerName) {
      return 'managed_capture_unavailable';
    }
    if (!this.dependencies.engine.isReady || !this.dependencies.engine.hasOwnedEngine) {
      return 'owned_engine_not_ready';
    }
    return null;
  }

  private async evaluateReadiness(options: { allowPendingReconciliation: boolean }): Promise<WorkstreamReadiness> {
    const initialReason = this.readinessPreconditionReason();
    if (initialReason) return this.unavailableReadiness(initialReason);
    let identity: OpencodeEngineIdentity | null;
    try {
      identity = await this.dependencies.engine.getEngineIdentity();
    } catch {
      return this.unavailableReadiness('owned_engine_identity_unavailable');
    }
    if (!identity) return this.unavailableReadiness('owned_engine_identity_unavailable');
    let mcp: Record<string, { status?: unknown }> | null;
    try {
      mcp = await this.dependencies.engine.listMcp();
    } catch {
      return this.unavailableReadiness('managed_mcp_status_unavailable');
    }
    const afterMcpReason = this.readinessPreconditionReason();
    if (afterMcpReason) return this.unavailableReadiness(afterMcpReason);
    if (!mcp || mcp[this.dependencies.rhythmMcpServerName]?.status !== 'connected') {
      return this.unavailableReadiness('managed_mcp_unavailable');
    }
    // listMcp is asynchronous too. Confirm the owned engine identity after
    // it returns so a restart cannot turn a prior runtime's MCP response into
    // current readiness or restart-scan completion.
    let confirmedIdentity: OpencodeEngineIdentity | null;
    try {
      confirmedIdentity = await this.dependencies.engine.getEngineIdentity();
    } catch {
      return this.unavailableReadiness('owned_engine_identity_unavailable');
    }
    if (!confirmedIdentity) return this.unavailableReadiness('owned_engine_identity_unavailable');
    const finalReason = this.readinessPreconditionReason();
    if (finalReason) return this.unavailableReadiness(finalReason);
    if (confirmedIdentity.bootId !== identity.bootId) {
      return this.unavailableReadiness('owned_engine_identity_changed_during_readiness');
    }
    if (
      !options.allowPendingReconciliation &&
      (!this.bootReconciled || this.reconciledEngineBootId !== confirmedIdentity.bootId)
    ) {
      return this.unavailableReadiness('restart_reconciliation_pending');
    }
    return {
      available: true,
      reason: null,
      hostEpoch: this.hostEpoch,
      engine: confirmedIdentity,
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

  private hasActiveCoordinatorJob(workstream: AgentWorkstream): boolean {
    return this.jobs.listNativeForWorkstream({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
    }).some((job) => ACTIVE_JOB_STATES.has(job.state));
  }

  private oneShotAdmissionStillAuthorized(
    plan: OneShotAutomationPlan,
    workstream: AgentWorkstream,
    input: WorkstreamRunRequest,
  ): boolean {
    const stored = this.workstreams.getAutomation(workstream.ownerUserId, workstream.projectId, workstream.id)?.plan;
    return !!stored && stored.planId === plan.planId && stored.status === 'consumed' &&
      stored.workstreamId === workstream.id && stored.workstreamRevision === workstream.revision &&
      stored.acknowledgedByUserId === workstream.ownerUserId && workstream.state === 'ready' &&
      input.commandKey === stored.authorizationKey && input.parentSessionId === stored.parentSessionId &&
      input.targetProfileId === stored.targetProfileId && input.expectedRevision === stored.workstreamRevision &&
      input.policy.maxTurns === 1 && input.policy.maxWallTimeSeconds === stored.maxWallTimeSeconds &&
      input.policy.maxTokens === stored.maxTokens && input.policy.queueDeadlineAt === stored.expiresAt &&
      Date.now() >= Date.parse(stored.dueAt) && Date.now() < Date.parse(stored.expiresAt);
  }

  private automationRunRequest(
    plan: OneShotAutomationPlan,
    workstream: AgentWorkstream,
  ): WorkstreamRunRequest {
    return {
      expectedRevision: workstream.revision,
      commandKey: plan.authorizationKey,
      targetProfileId: plan.targetProfileId,
      parentSessionId: plan.parentSessionId,
      softTokenBudgetAcknowledged: true,
      policy: {
        maxTurns: 1,
        maxWallTimeSeconds: plan.maxWallTimeSeconds,
        maxTokens: plan.maxTokens,
        queueDeadlineAt: plan.expiresAt,
      },
      references: workstream.checkpoint.references.map((reference) => ({ ...reference })),
    };
  }

  private async automationStatusFor(
    workstream: AgentWorkstream,
    readiness: WorkstreamReadiness,
  ): Promise<WorkstreamAutomationStatusView> {
    const record = this.workstreams.getAutomation(workstream.ownerUserId, workstream.projectId, workstream.id);
    return {
      workstreamId: workstream.id,
      revision: workstream.revision,
      plan: record?.plan ?? null,
      decision: await this.automationDecisionFor(workstream, record?.value ?? null, readiness),
    };
  }

  /** Current facts come from existing scoped repositories; no scheduler state is trusted. */
  private async automationDecisionFor(
    workstream: AgentWorkstream,
    planValue: unknown,
    readiness: WorkstreamReadiness,
  ): Promise<OneShotAutomationDecision> {
    const record = this.workstreams.getAutomation(workstream.ownerUserId, workstream.projectId, workstream.id);
    const plan = record?.plan ?? null;
    let parentSessionId: string | null = null;
    let profile: { id: string; revision: number; model: { providerId: string; modelId: string } } | null = null;
    if (plan) {
      try {
        parentSessionId = this.resolveParent(
          workstream.ownerUserId, workstream.projectId, plan.parentSessionId,
        ).id;
      } catch {
        parentSessionId = null;
      }
      try {
        const currentProfile = this.resolveProfile(plan.targetProfileId);
        if (!this.profileBlockReason(currentProfile)) {
          const scope = await (this.dependencies.profileScopeResolver ?? resolveProfileScope)(currentProfile.id);
          profile = {
            id: currentProfile.id,
            revision: currentProfile.revision ?? 1,
            model: { providerId: scope.model.providerID, modelId: scope.model.modelID },
          };
        }
      } catch {
        profile = null;
      }
    }
    const requested: WorkstreamRunPolicy | null = plan
      ? {
        maxTurns: 1,
        maxWallTimeSeconds: plan.maxWallTimeSeconds,
        maxTokens: plan.maxTokens,
        queueDeadlineAt: plan.expiresAt,
      }
      : null;
    const admission = requested ? this.admissionPolicy(workstream, requested) : null;
    const admissionEligible = !!requested && workstream.state === 'ready' && !this.hasActiveCoordinatorJob(workstream) &&
      !!admission && !('reason' in admission) && admission.policy.maxTokens === requested.maxTokens;
    // Candidate pages can be stale across awaited readiness/profile reads.
    // Evaluate only the current repository value; the caller-supplied value
    // is retained solely for the deliberately guarded no-record case.
    return evaluateOneShotAutomation(record?.value ?? planValue, {
      now: new Date(),
      workstreamRevision: workstream.revision,
      workstreamState: workstream.state,
      parentSessionId,
      profile,
      runtimeEligible: readiness.available && readiness.engine !== null && !this.disposed,
      admissionEligible,
    });
  }

  /**
   * A save/disable response must not turn into a hidden restart scan.  It is
   * intentionally an unavailable runtime snapshot; only explicit status,
   * Run preparation, or the existing scheduler callback can probe readiness.
   */
  private unprobedAutomationReadiness(): WorkstreamReadiness {
    return {
      available: false,
      reason: 'runtime_not_probed',
      hostEpoch: this.disposed ? null : this.hostEpoch,
      engine: null,
    };
  }

  private dispatchAuthorityStillAuthorized(
    authority: WorkstreamDispatchAuthority,
    workstream: AgentWorkstream,
    parent: AgentSession,
    profile: AgentConfig,
    profileScope: ProfileScope,
    job: AgentBridgeJobRow,
  ): boolean {
    if (authority.kind === 'interactive') return true;
    if (authority.kind === 'conversation_finite') return authority.stillAuthorized();
    return this.oneShotConsentStillAuthorized(authority.plan, workstream, parent, profile, profileScope, job);
  }

  private finiteConversationConsentAuthority(
    authority: CoordinatorFiniteConversationAuthority,
  ): PersistedManagedConsentAuthority {
    return {
      kind: 'finite_conversation_workstream',
      actorUserId: authority.ownerUserId,
      validate: authority.validate,
    };
  }

  private oneShotConsentStillAuthorized(
    plan: OneShotAutomationPlan,
    workstream: AgentWorkstream,
    parent: AgentSession,
    profile: AgentConfig,
    profileScope: ProfileScope,
    job: AgentBridgeJobRow,
  ): boolean {
    const current = this.workstreams.find(workstream.ownerUserId, workstream.projectId, workstream.id);
    const stored = this.workstreams.getAutomation(workstream.ownerUserId, workstream.projectId, workstream.id)?.plan;
    // `job` is the admission-time claim.  Child/session/dispatch binding is
    // written later, so every control decision must inspect the current,
    // owner-scoped native row rather than treating that stale claim as truth.
    const currentJob = this.jobs.getNativeForWorkstream({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: job.id,
    });
    const currentParent = this.sessions.findById(plan.parentSessionId);
    if (
      !current || !currentJob || !stored || stored.planId !== plan.planId || stored.status !== 'consumed' ||
      stored.workstreamId !== workstream.id || stored.workstreamRevision !== workstream.revision ||
      stored.acknowledgedByUserId !== workstream.ownerUserId ||
      current.revision !== plan.workstreamRevision || current.executorEpoch !== this.hostEpoch ||
      current.lastJobId !== currentJob.id || (current.state !== 'queued' && current.state !== 'running') ||
      currentParent?.id !== parent.id || currentParent.ownerUserId !== workstream.ownerUserId ||
      currentParent.projectId !== workstream.projectId || currentParent.parentSessionId !== null ||
      currentParent.sdkSessionId !== parent.sdkSessionId ||
      profile.id !== plan.targetProfileId || (profile.revision ?? 1) !== plan.targetProfileRevision ||
      profileScope.model.providerID !== plan.resolvedModel.providerId ||
      profileScope.model.modelID !== plan.resolvedModel.modelId || !this.profileStillAuthorized(profile) ||
      !this.dependencies.enabled() || this.disposed || !this.captureReady() ||
      this.dependencies.dbClient !== 'sqlite' ||
      (this.dependencies.role !== 'local' && this.dependencies.role !== 'all') ||
      !this.dependencies.engine.isReady || !this.dependencies.engine.hasOwnedEngine ||
      currentJob.idempotency_key !== plan.authorizationKey || currentJob.direction !== 'rhythm_to_native' ||
      currentJob.native_execution_kind !== 'coordinator' || currentJob.local_user_id !== workstream.ownerUserId ||
      currentJob.workstream_id !== workstream.id || currentJob.workstream_project_id !== workstream.projectId ||
      currentJob.workstream_revision !== workstream.revision || currentJob.host_epoch !== this.hostEpoch ||
      currentJob.parent_session_id !== parent.id || currentJob.target_agent_id !== profile.id ||
      (currentJob.state !== 'claimed' && currentJob.state !== 'running')
    ) return false;
    const now = Date.now();
    return Number.isFinite(now) && now < Date.parse(plan.expiresAt) && Date.parse(plan.dueAt) <= now;
  }

  private persistedConsentAuthority(
    plan: OneShotAutomationPlan,
    workstream: AgentWorkstream,
    parent: AgentSession,
    job: AgentBridgeJobRow,
  ): PersistedManagedConsentAuthority {
    return {
      kind: 'one_shot_workstream',
      actorUserId: plan.acknowledgedByUserId,
      validate: async ({ scope, workerJobId }) => {
        const currentWorkerBinding = (): AgentBridgeJobRow | null => {
          const current = this.jobs.getNativeForWorkstream({
            localUserId: workstream.ownerUserId,
            workstreamId: workstream.id,
            jobId: job.id,
          });
          if (
            !current || current.id !== job.id ||
            current.native_child_session_id !== scope.sessionId ||
            current.native_child_sdk_session_id !== scope.sdkSessionId
          ) return null;
          return current;
        };
        const currentProfileScope = async (): Promise<{ profile: AgentConfig; scope: ProfileScope } | null> => {
          try {
            const refreshedProfile = this.resolveProfile(plan.targetProfileId);
            if (this.profileBlockReason(refreshedProfile)) return null;
            const refreshedScope = await (this.dependencies.profileScopeResolver ?? resolveProfileScope)(
              refreshedProfile.id,
            );
            return { profile: refreshedProfile, scope: refreshedScope };
          } catch {
            return null;
          }
        };
        if (
          workerJobId !== job.id || !currentWorkerBinding() ||
          scope.ownerUserId !== workstream.ownerUserId || scope.projectId !== workstream.projectId ||
          scope.workstreamId !== workstream.id || scope.workstreamRevision !== workstream.revision ||
          scope.hostEpoch !== this.hostEpoch || scope.role !== 'worker'
        ) return false;
        const beforeIdentity = await currentProfileScope();
        if (!beforeIdentity || !this.oneShotConsentStillAuthorized(
          plan, workstream, parent, beforeIdentity.profile, beforeIdentity.scope, job,
        )) return false;
        try {
          const identity = await this.dependencies.engine.getEngineIdentity();
          // A profile resolver and engine identity are both awaited boundaries.
          // Re-read the profile/model, controls, native binding, and runtime
          // after them; an identical profile revision alone is not a model-pin
          // proof when the resolver's answer has drifted.
          const afterIdentity = await currentProfileScope();
          const currentJob = currentWorkerBinding();
          return !!identity && !!afterIdentity && !!currentJob &&
            identity.bootId === currentJob.parent_runtime_instance &&
            this.oneShotConsentStillAuthorized(
              plan, workstream, parent, afterIdentity.profile, afterIdentity.scope, job,
            );
        } catch {
          return false;
        }
      },
    };
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
    acknowledgedByUserId: number,
    acknowledgedAt: string,
  ): Record<string, unknown> {
    const workflow = input.workflow;
    return {
      schemaVersion: 1,
      executionKind: workflow ? 'coding_workflow_durable_consumer' : 'read_only_managed_worker',
      targetProfileId: profile.id,
      targetProfileRevision: profile.revision ?? 1,
      parentSessionId: parent.id,
      requestedModel: {
        providerId: safeIdentifier(profileScope.model.providerID),
        modelId: safeIdentifier(profileScope.model.modelID),
      },
      policy,
      budget: {
        schemaVersion: 2,
        // This remains the user-authorized workstream cap across runs. The
        // per-job policy may be lower because prior actual/charged usage spent
        // part of it; it is not a claimed hard intra-turn enforcement cap.
        authorizedTokens,
        units: 'tokens',
        authorizationKind: 'soft_total_tokens',
        softTokenBudgetAcknowledgement: {
          schemaVersion: 1,
          accepted: input.softTokenBudgetAcknowledged,
          actorUserId: acknowledgedByUserId,
          acknowledgedAt,
          includes: ['input', 'output', 'reasoning', 'cache'],
          inputOverhead: 'unknown_engine_profile_tool_system',
          outputCapEnforced: false,
        },
      },
      estimate: {
        schemaVersion: 2,
        basis: 'assembled_control_bytes_div_4',
        addedTokens: assembled.estimatedAddedTokens,
        scope: 'authored_control_only',
        fullInputEstimate: 'unknown',
        totalUsageEstimate: 'unknown',
        outputCapEnforced: false,
        authorizedTokens: policy.maxTokens,
        actualUsage: 'pending',
      },
      initialReferences: assembled.references.map((reference) => ({
        dependencyId: reference.dependencyId,
        canonicalId: reference.canonicalId,
        observedVersion: reference.observedVersion,
        observedHash: reference.observedHash,
      })),
      ...(workflow ? {
        // The prepared/accepted delivery and every native provider member are
        // appended by the existing job repository under its byte-bounded CAS.
        // This initial descriptor is intentionally identity-only.
        workflow: {
          schemaVersion: 1,
          kind: 'coding_workflow',
          authorization: workflow.authorization,
          prepared: null,
          delivery: 'unprepared',
          membership: [],
        },
      } : {}),
    };
  }

  /** A retry can only reuse a previously durable, exact acknowledgement. */
  private replaySoftTokenAcknowledgementAt(
    job: AgentBridgeJobRow,
    actorUserId: number,
  ): string | null {
    const budget = asRecord(jsonRecord(job.native_metadata_json)?.budget);
    const acknowledgement = asRecord(budget?.softTokenBudgetAcknowledgement);
    const acknowledgedAt = acknowledgement?.acknowledgedAt;
    if (
      acknowledgement?.schemaVersion !== 1 ||
      acknowledgement?.accepted !== true ||
      acknowledgement?.actorUserId !== actorUserId ||
      typeof acknowledgedAt !== 'string' ||
      !Number.isFinite(Date.parse(acknowledgedAt)) ||
      new Date(acknowledgedAt).toISOString() !== acknowledgedAt
    ) return null;
    return acknowledgedAt;
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
    authority: WorkstreamDispatchAuthority;
    workstream: AgentWorkstream;
    parent: AgentSession;
    profile: AgentConfig;
    profileScope: ProfileScope;
    job: AgentBridgeJobRow;
    assembled: ReturnType<ManagedWorkstreamContextAssembler['assemble']>;
    declaredReferences: WorkstreamReferenceInput[];
    finiteExecutionScope: {
      targetCwd: string;
      permissionRules: FiniteExecutionPermissionRule[];
      mcpRoleConfig: McpRoleConfig;
      skillAllowlist: string[];
      scopeSignature: string;
    } | null;
  }): Promise<void> {
    const {
      authority, workstream, parent, profile, profileScope, job, assembled, declaredReferences, finiteExecutionScope,
    } = input;
    // The source authority and controls are checked again directly before a
    // fresh session can expose the assembled metadata to an SDK request.
    try {
      const recheckedReferences = await this.resolveQualifiedReferences(workstream, declaredReferences);
      if (!this.sameReferences(recheckedReferences, assembled.references) ||
          !this.dispatchStillAuthorized(workstream, job.id, profile) ||
          !this.dispatchAuthorityStillAuthorized(authority, workstream, parent, profile, profileScope, job)) {
        throw new WorkstreamArtifactResolutionError('dispatch_preparation_fenced');
      }
    } catch (error) {
      this.markUnknown(workstream, job, this.referenceFailureReason(error));
      return;
    }
    // A finite execution scope is a separate current authority from the
    // read-only finite grant. Re-derive it after every await before a child
    // can be created. A vanished/revised profile target is not repaired from
    // the captured scope or caller input.
    if (authority.kind === 'conversation_finite' && authority.executionScope) {
      const currentScope = await authority.executionScope.resolve();
      if (
        !currentScope || !finiteExecutionScope ||
        currentScope.scopeSignature !== authority.executionScope.scopeSignature ||
        currentScope.scopeSignature !== finiteExecutionScope.scopeSignature ||
        currentScope.targetCwd !== parent.cwd
      ) {
        this.markUnknown(workstream, job, 'finite_execution_scope_unavailable');
        return;
      }
    }
    const workerMcpScope = finiteExecutionScope?.mcpRoleConfig ?? this.managedMcpScope(profile);
    const workerSkillAllowlist = finiteExecutionScope?.skillAllowlist ?? [];
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
      mcpRole: workerMcpScope.role,
      mcpAllowedToolsJson: workerMcpScope.allowedToolsJson,
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
        workerMcpScope,
        workerSkillAllowlist,
        profileScope.model.providerID,
        parent.sdkSessionId!,
        'default',
        false,
        finiteExecutionScope === null,
        finiteExecutionScope?.permissionRules,
      );
      if (!created.id) throw new Error('fresh_managed_session_not_confirmed');
      sdkSessionId = created.id;
      // Session creation is not an inference. Still, a user control or flag
      // drift after this await wins and prevents the prompt from being sent.
      if (
        !this.dispatchStillAuthorized(workstream, job.id, profile) ||
        !this.dispatchAuthorityStillAuthorized(authority, workstream, parent, profile, profileScope, job)
      ) {
        throw new Error('dispatch_controls_changed_before_prompt');
      }
      if (authority.kind === 'conversation_finite' && authority.executionScope) {
        const currentScope = await authority.executionScope.resolve();
        if (
          !currentScope || !finiteExecutionScope ||
          currentScope.scopeSignature !== authority.executionScope.scopeSignature ||
          currentScope.scopeSignature !== finiteExecutionScope.scopeSignature ||
          currentScope.targetCwd !== parent.cwd
        ) throw new Error('finite_execution_scope_changed_before_prompt');
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
          ...(authority.kind === 'interactive'
            ? { auth: authority.auth }
            : {
              persistedConsent: authority.kind === 'one_shot_automation'
                ? this.persistedConsentAuthority(authority.plan, workstream, parent, job)
                : this.finiteConversationConsentAuthority(authority),
            }),
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
            if (
              !this.dispatchStillAuthorized(workstream, job.id, profile) ||
              !this.dispatchAuthorityStillAuthorized(authority, workstream, parent, profile, profileScope, job)
            ) {
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

  /**
   * The G2 path uses the already-owned async delegation manager, not a second
   * managed worker.  The private callback is responsible for the atomic
   * prepared binding before prompt exposure; this coordinator only retains the
   * ordinary job/workstream lifecycle and fails closed around it.
   */
  private async dispatchWorkflowManager(input: {
    authority: WorkstreamDispatchAuthority;
    workstream: AgentWorkstream;
    parent: AgentSession;
    profile: AgentConfig;
    profileScope: ProfileScope;
    job: AgentBridgeJobRow;
    workflow: CoordinatorWorkflowDispatchInput;
  }): Promise<void> {
    const { authority, workstream, parent, profile, profileScope, job, workflow } = input;
    if (authority.kind !== 'conversation_finite' || !authority.stillAuthorized()) {
      this.markUnknown(workstream, job, 'workflow_authority_changed_before_dispatch');
      return;
    }
    const current = this.jobs.getNativeForWorkstream({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: job.id,
    });
    if (
      !current || current.state !== 'claimed' || current.host_epoch !== this.hostEpoch ||
      current.parent_session_id !== parent.id || current.target_agent_id !== profile.id ||
      current.workstream_revision !== workstream.revision || !this.dispatchStillAuthorized(workstream, job.id, profile)
    ) {
      if (current) this.markUnknown(workstream, current, 'workflow_dispatch_binding_changed');
      return;
    }
    let outcome: 'accepted' | 'unknown' | 'rejected';
    try {
      outcome = await workflow.dispatch({
        ownerUserId: workstream.ownerUserId,
        projectId: workstream.projectId,
        workstream,
        job: current,
        parent,
        targetProfile: profile,
        targetProfileScope: profileScope,
      });
    } catch {
      outcome = 'unknown';
    }
    const latest = this.jobs.getNativeForWorkstream({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: job.id,
    });
    if (!latest) return;
    if (outcome === 'accepted' && latest.state === 'running' && authority.stillAuthorized()) {
      this.publishRuntime(workstream, job.id, 'running', null, {
        expectedStates: ['queued', 'running'], executorEpoch: this.hostEpoch,
      });
      return;
    }
    if (outcome === 'rejected' || latest.state === 'failed') {
      this.publishRuntime(workstream, job.id, 'blocked', 'workflow_delivery_rejected', {
        expectedStates: ['queued', 'running', 'blocked'], executorEpoch: this.hostEpoch,
      });
      return;
    }
    // A thrown transport call or any missing/changed durable prepared receipt
    // may have reached the engine.  Preserve the consumed ordinal as unknown;
    // neither this path nor a later scheduler pass retries it.
    if (latest.state === 'unknown') {
      // The durable outcome hook already fenced the job; project it honestly.
      this.publishRuntime(workstream, job.id, 'unknown', 'native_status_unknown', {
        expectedStates: ['queued', 'running', 'blocked', 'unknown'], executorEpoch: this.hostEpoch,
      });
      return;
    }
    this.markUnknown(workstream, latest, 'workflow_delivery_unknown');
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
    if (job.state === 'claimed') {
      this.markUnknown(workstream, job, 'child_binding_incomplete');
      return;
    }
    const binding = this.boundCoordinatorTerminalSessions(workstream, job);
    if (!binding) {
      this.markUnknown(workstream, job, 'terminal_binding_incomplete');
      return;
    }
    // An omitted /session/status map entry is documented idle behavior, not a
    // terminal receipt on its own.  It can be used only after this strict
    // inspection confirms the exact known SDK child, its directory, and
    // complete current status/question/permission responses under one owned
    // engine identity. Convenience wrapper fallbacks ({}/[]) are never proof.
    const beforeEngine = await this.terminalReceiptEngineIdentity(true);
    if (!beforeEngine) {
      this.markUnknown(workstream, job, 'terminal_engine_readiness_unavailable');
      return;
    }
    const inspection = await this.withProbeTimeout(
      this.dependencies.engine.inspectBoundSessionLifecycles(
        [binding.child.sdkSessionId!],
        binding.child.cwd,
      ),
    );
    const afterEngine = await this.terminalReceiptEngineIdentity(false);
    if (!afterEngine || afterEngine.bootId !== beforeEngine.bootId) {
      this.markUnknown(workstream, job, 'terminal_engine_identity_changed_during_inspection');
      return;
    }
    if (
      !inspection?.available ||
      !inspection.knownSessionIds.includes(binding.child.sdkSessionId!)
    ) {
      this.markUnknown(workstream, job, 'terminal_lifecycle_probe_unavailable');
      return;
    }
    const currentJob = this.currentCoordinatorTerminalJob(workstream, job);
    if (!currentJob) return;
    const currentBinding = this.boundCoordinatorTerminalSessions(workstream, currentJob);
    if (!currentBinding) {
      this.markUnknown(workstream, currentJob, 'terminal_binding_changed_during_inspection');
      return;
    }
    const sdkSessionId = currentBinding.child.sdkSessionId!;
    const status = inspection.statusBySessionId[sdkSessionId];
    const pendingQuestion = inspection.pendingQuestionSessionIds.includes(sdkSessionId);
    const pendingPermission = inspection.pendingPermissionSessionIds.includes(sdkSessionId);
    const interactionReason = pendingQuestion
      ? 'worker_question_pending'
      : pendingPermission
        ? 'worker_permission_pending'
        : null;
    if (status?.type === 'busy') {
      // A late read is not proof that the turn exceeded its wall budget:
      // completed children must reach exact terminal accounting below. Only
      // a freshly confirmed busy child still needs deadline cancellation.
      if (currentJob.state === 'running' && this.wallTimeExceeded(currentJob, new Date().toISOString())) {
        await this.requestBestEffortCancellation(
          workstream.ownerUserId,
          workstream.id,
          currentJob.id,
          'wall_time_exceeded_termination_unconfirmed',
        );
        this.publishRuntime(workstream, currentJob.id, 'unknown', 'wall_time_exceeded_termination_unconfirmed', {
          expectedStates: ['queued', 'running', 'blocked', 'unknown'],
          executorEpoch: this.hostEpoch,
        });
        return;
      }
      // A busy observation is not a terminal receipt.  Keep an already
      // unknown job fenced rather than reclassifying it as running.
      if (reconcilingUnknown || currentJob.state === 'unknown') return;
      this.jobs.touchCoordinatorProgress({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
        jobId: currentJob.id,
        now,
      });
      this.publishRuntime(workstream, currentJob.id, interactionReason ? 'blocked' : 'running', interactionReason, {
        expectedStates: ['queued', 'running', 'blocked'],
        executorEpoch: this.hostEpoch,
      });
      return;
    }
    if (status && status.type !== 'idle') {
      this.markUnknown(workstream, currentJob, 'engine_status_unrecognized');
      return;
    }
    if (interactionReason) {
      if (reconcilingUnknown || currentJob.state === 'unknown') return;
      this.publishRuntime(workstream, currentJob.id, 'blocked', interactionReason, {
        expectedStates: ['queued', 'running', 'blocked'],
        executorEpoch: this.hostEpoch,
      });
      return;
    }
    let messages: Array<{ info: unknown; parts?: unknown }>;
    try {
      const response = await this.listAllMessages(sdkSessionId, currentBinding.child.cwd);
      if (!response) {
        this.markUnknown(workstream, currentJob, 'terminal_message_lookup_timed_out');
        return;
      }
      messages = response;
    } catch {
      this.markUnknown(workstream, currentJob, 'terminal_message_lookup_unavailable');
      return;
    }
    // The message page is asynchronous too. Re-read the exact lifecycle
    // boundary before applying accounting so a newly pending interaction or
    // changed engine cannot turn an earlier idle observation into completion.
    const finalInspection = await this.withProbeTimeout(
      this.dependencies.engine.inspectBoundSessionLifecycles(
        [sdkSessionId],
        currentBinding.child.cwd,
      ),
    );
    const finalEngine = await this.terminalReceiptEngineIdentity(false);
    if (!finalEngine || finalEngine.bootId !== beforeEngine.bootId) {
      this.markUnknown(workstream, currentJob, 'terminal_engine_identity_changed_during_message_read');
      return;
    }
    if (!finalInspection?.available) {
      this.markUnknown(workstream, currentJob, 'terminal_lifecycle_probe_unavailable');
      return;
    }
    if (!finalInspection.knownSessionIds.includes(sdkSessionId)) {
      this.markUnknown(workstream, currentJob, 'terminal_lifecycle_known_session_missing');
      return;
    }
    const finalStatus = finalInspection.statusBySessionId[sdkSessionId];
    if (
      (finalStatus && finalStatus.type !== 'idle') ||
      finalInspection.pendingQuestionSessionIds.includes(sdkSessionId) ||
      finalInspection.pendingPermissionSessionIds.includes(sdkSessionId)
    ) {
      this.markUnknown(workstream, currentJob, 'terminal_lifecycle_changed_during_message_read');
      return;
    }
    const applyingJob = this.currentCoordinatorTerminalJob(workstream, currentJob);
    if (!applyingJob) return;
    const applyingBinding = this.boundCoordinatorTerminalSessions(workstream, applyingJob);
    if (!applyingBinding) {
      this.markUnknown(workstream, applyingJob, 'terminal_binding_changed_during_message_read');
      return;
    }
    const matches = messages.filter((message) => {
      const info = message.info as {
        id?: unknown; role?: unknown; parentID?: unknown;
      };
      return info.role === 'assistant' && info.parentID === applyingJob.native_sdk_user_message_id && typeof info.id === 'string';
    });
    if (matches.length === 0) {
      this.markUnknown(workstream, applyingJob, 'terminal_message_binding_missing');
      return;
    }
    const infos = matches.map((message) => message.info as {
      id: string; error?: { name?: unknown }; time?: { completed?: unknown };
      providerID?: unknown; modelID?: unknown; finish?: unknown; tokens?: unknown; cost?: unknown;
    });
    if (infos.some((info) => !info.time || typeof info.time.completed !== 'number')) {
      this.markUnknown(workstream, applyingJob, 'turn_assistant_step_incomplete');
      return;
    }
    const terminal = matches.filter((message) => (message.info as { finish?: unknown }).finish === 'stop');
    if (terminal.length !== 1) {
      this.markUnknown(workstream, applyingJob, terminal.length > 1
        ? 'terminal_message_binding_ambiguous'
        : 'terminal_message_not_authoritative');
      return;
    }
    const terminalMessage = terminal[0];
    const info = terminalMessage.info as {
      id: string; error?: { name?: unknown }; time?: { completed?: unknown };
      providerID?: unknown; modelID?: unknown; finish?: unknown; tokens?: unknown; cost?: unknown;
    };
    const policy = this.policyFor(applyingJob);
    let usage = usageFromAssistantSteps(infos, policy);
    const errored = !!info.error;
    // G2: the manager's own steps are never the workflow's whole cost. Only a
    // complete manager + descendants + charged-callback inspection is usage.
    let workflowCoverage: CodingWorkflowCoverageIds | null = null;
    let workflowCoverageHold: string | null = null;
    const workflowRecord = codingWorkflowRecord(applyingJob);
    if (workflowRecord && usage && errored) {
      // An errored manager turn is terminal but never a closed accounting
      // group: record it failed with usage explicitly NOT complete (budget
      // stays unknown), rather than waiting forever or claiming a total.
      usage = { ...usage, status: 'manager_only_incomplete' };
    } else if (workflowRecord && usage) {
      const coverage = this.dependencies.workflowCoverage
        ? await this.dependencies.workflowCoverage.inspect({
          receipt: codingWorkflowReceipt(workflowRecord),
          rootTurns: codingWorkflowRootTurns(workflowRecord),
          current: () => this.currentCoordinatorTerminalJob(workstream, applyingJob) !== null,
        })
        : { status: 'hold' as const, reason: 'scope_unsupported' as const, coverage: null, usage: null };
      if (coverage.status === 'hold' && TRANSIENT_WORKFLOW_HOLDS.has(coverage.reason)) {
        // A still-open charged turn: keep the reservation and re-read on the
        // next existing sweep/observation. Nothing is completed or released.
        return;
      }
      if (coverage.status === 'complete') {
        usage = {
          ...coverage.usage,
          authorizedTokens: policy?.maxTokens ?? null,
          overshoot: policy ? coverage.usage.totalTokens > policy.maxTokens : null,
        };
        workflowCoverage = coverage.coverage;
      } else {
        usage = null;
        workflowCoverageHold = coverage.reason;
      }
    }
    // No raw assistant text is retained. A finite C2 worker may carry one
    // exact, bounded JSON proposal; all other prose/tool-shaped output is a
    // non-authoritative hold for continuation purposes.
    const structuredProposal = !errored && policy?.outputContract === 'structured_read_only_proposal_v1'
      ? parseManagedWorkstreamStructuredProposal(terminalMessage.parts, workstream.projectId)
      : null;
    const priorResult = jsonRecord(applyingJob.native_result_json);
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
      usageStatus: usage?.status === 'actual' ? 'actual' : 'unknown',
      terminalObservation: {
        schemaVersion: 1,
        kind: 'strict_bound_session_lifecycle',
        status: finalStatus?.type === 'idle' ? 'idle_explicit' : 'idle_omitted_after_complete_snapshot',
        originalHostEpoch: safeIdentifier(applyingJob.host_epoch),
        originalParentRuntimeInstance: safeIdentifier(applyingJob.parent_runtime_instance),
        observedEngineBootId: safeIdentifier(finalEngine.bootId),
      },
      priorUnknownBoundary: applyingJob.state === 'unknown' ? {
        stateReason: safeReason(applyingJob.state_reason),
        resultReason: safeReason(priorResult?.reason),
        cancellationRequestedAt: applyingJob.cancel_requested_at,
      } : null,
      structuredProposal: policy?.outputContract === 'structured_read_only_proposal_v1'
        ? structuredProposal
          ? { schemaVersion: 1, state: 'parsed', criteria: structuredProposal.criteria, nextAction: structuredProposal.nextAction }
          : { schemaVersion: 1, state: 'unavailable' }
        : null,
      ...(workflowRecord ? { workflowCoverage, workflowCoverageHold } : {}),
    };
    if (!usage) {
      // A recheck cannot trade an existing unknown/cancellation receipt for a
      // different incomplete observation. Keep that original durable safety
      // boundary until a complete exact terminal usage receipt arrives.
      if (applyingJob.state === 'unknown') return;
      this.jobs.holdCoordinatorUsageUnknown({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
        jobId: applyingJob.id,
        result,
        reason: workflowCoverageHold ? 'workflow_coverage_incomplete' : 'turn_usage_incomplete',
        now,
      });
      this.publishRuntime(workstream, applyingJob.id, 'unknown', 'usage_unknown_ack_required', {
        expectedStates: ['queued', 'running', 'blocked', 'unknown'],
        executorEpoch: this.hostEpoch,
      });
      return;
    }
    const completed = this.jobs.completeCoordinator({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: applyingJob.id,
      state: errored ? 'failed' : 'succeeded',
      result,
      usage,
      now,
    });
    // A completed terminal receipt can be durable even if a later feature,
    // capture, MCP, or profile check is no longer admissible. Recheck that
    // authority after completion and re-read controls after the await: the
    // receipt stays visible, but its application/runtime projection is stale.
    const applicationReadiness = await this.readiness();
    const current = this.workstreams.find(workstream.ownerUserId, workstream.projectId, workstream.id);
    const fencedByControls = !current ||
      current.revision !== applyingJob.workstream_revision ||
      current.executorEpoch !== this.hostEpoch ||
      current.lastJobId !== applyingJob.id ||
      current.state === 'paused' || current.state === 'cancelled' || current.state === 'completed' ||
      current.stateReason === 'controls_revised';
    const authorityReason = !current
      ? 'workstream_missing'
      : this.resultAuthorityReason(current, completed) ??
        (applicationReadiness.available ? null : 'runtime_readiness_changed_before_result');
    const fenced = fencedByControls || authorityReason !== null;
    // A finite structured proposal is never completion evidence. It can only
    // add new pending/blocked controls after all exact terminal, runtime, and
    // source fences held. The update preserves revision and every existing
    // criterion/reference, so it cannot erase a user pause/revise or turn a
    // model statement into verified work.
    let runtimeWorkstream = current;
    let proposalStored = false;
    if (!fenced && current && !errored && structuredProposal) {
      const checkpoint = checkpointWithStructuredProposal(current.checkpoint, structuredProposal);
      if (checkpoint) {
        const updated = this.workstreams.updateCheckpointForApplication({
          ownerUserId: current.ownerUserId,
          projectId: current.projectId,
          id: current.id,
          expectedRevision: current.revision,
          checkpoint,
          state: 'ready',
          reason: null,
        });
        if (updated) {
          runtimeWorkstream = updated;
          proposalStored = true;
        }
      }
    }
    const structuredProposalState = policy?.outputContract === 'structured_read_only_proposal_v1'
      ? proposalStored
        ? 'stored'
        : structuredProposal
          ? 'apply_conflict'
          : 'unavailable'
      : null;
    const applicationReason = fencedByControls
      ? 'controls_or_user_state_changed_before_result'
      : authorityReason
        ? 'runtime_authority_changed_before_result'
        : errored
          ? 'worker_terminal_error_no_application'
          : structuredProposalState === 'apply_conflict'
            ? 'structured_proposal_apply_conflict'
            : structuredProposalState === 'unavailable'
              ? 'structured_proposal_unavailable'
              : structuredProposalState === 'stored'
                ? 'read_only_proposal_pending_authoritative_criterion_receipt'
                : 'read_only_result_requires_authoritative_criterion_receipt';
    this.jobs.recordCoordinatorApplication({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: applyingJob.id,
      application: {
        schemaVersion: 1,
        status: fenced ? 'stale' : 'quarantined',
        reason: applicationReason,
        terminalMessageId: info.id,
        workstreamRevision: current?.revision ?? workstream.revision,
        structuredProposal: structuredProposalState === null
          ? null
          : {
            state: structuredProposalState,
            criteriaCount: proposalStored ? structuredProposal!.criteria.length : 0,
            nextAction: proposalStored ? structuredProposal!.nextAction.kind : null,
          },
      },
      now,
    });
    if (!fencedByControls && runtimeWorkstream) {
      const budget = this.jobs.coordinatorBudgetState({
        localUserId: workstream.ownerUserId,
        workstreamId: workstream.id,
      });
      this.publishRuntime(runtimeWorkstream, completed.id,
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
    // This is an observation-only hand-off after the existing durable terminal
    // receipt/application sequence. It cannot revive legacy parent wakes,
    // retry an unknown job, or infer a result. The conversation service must
    // independently re-read its finite authority before it can admit another
    // ordinal; failures here remain a durable status-only hold.
    const observer = this.dependencies.terminalObserver;
    if (observer) {
      void Promise.resolve(observer.onCoordinatorTerminal({
        ownerUserId: workstream.ownerUserId,
        projectId: workstream.projectId,
        workstreamId: workstream.id,
        parentSessionId: applyingJob.parent_session_id,
        jobId: applyingJob.id,
        state: errored ? 'failed' : 'succeeded',
        hostEpoch: this.hostEpoch,
      })).catch(() => undefined);
    }
  }

  /**
   * Terminal accounting consumes only one already-bound coordinator child.
   * The child and parent rows are local ownership evidence; engine metadata
   * and lifecycle status are verified separately by the strict inspection.
   * A cached local child status is deliberately not terminal evidence: stream
   * updates can lag the current owned engine status response in either
   * direction.
   */
  private boundCoordinatorTerminalSessions(
    workstream: AgentWorkstream,
    job: AgentBridgeJobRow,
  ): { child: AgentSession; parent: AgentSession } | null {
    if (
      job.direction !== 'rhythm_to_native' ||
      job.native_execution_kind !== 'coordinator' ||
      job.local_user_id !== workstream.ownerUserId ||
      job.workstream_id !== workstream.id ||
      job.workstream_project_id !== workstream.projectId ||
      job.parent_runtime !== 'opencode' ||
      !job.parent_runtime_instance ||
      !job.host_epoch ||
      typeof job.workstream_revision !== 'number' ||
      !Number.isSafeInteger(job.workstream_revision) || job.workstream_revision < 1 ||
      !job.native_child_session_id || !job.native_child_sdk_session_id ||
      !job.native_dispatch_id || !job.native_sdk_user_message_id
    ) return null;
    const child = this.sessions.findById(job.native_child_session_id);
    const parent = this.sessions.findById(job.parent_session_id);
    if (
      !child || !parent ||
      child.sdkSessionId !== job.native_child_sdk_session_id ||
      child.ownerUserId !== workstream.ownerUserId ||
      child.projectId !== workstream.projectId ||
      child.parentSessionId !== job.parent_session_id ||
      !child.cwd ||
      parent.ownerUserId !== workstream.ownerUserId ||
      parent.projectId !== workstream.projectId ||
      parent.parentSessionId !== null ||
      !parent.sdkSessionId ||
      parent.cwd !== child.cwd
    ) return null;
    return { child, parent };
  }

  /** A late read may account only the same immutable durable worker binding. */
  private currentCoordinatorTerminalJob(
    workstream: AgentWorkstream,
    observed: AgentBridgeJobRow,
  ): AgentBridgeJobRow | null {
    const current = this.jobs.getNativeForWorkstream({
      localUserId: workstream.ownerUserId,
      workstreamId: workstream.id,
      jobId: observed.id,
    });
    if (!current || TERMINAL_JOB_STATES.has(current.state)) return null;
    return (
      current.direction === observed.direction &&
      current.native_execution_kind === observed.native_execution_kind &&
      current.local_user_id === observed.local_user_id &&
      current.workstream_id === observed.workstream_id &&
      current.workstream_project_id === observed.workstream_project_id &&
      current.workstream_revision === observed.workstream_revision &&
      current.host_epoch === observed.host_epoch &&
      current.parent_runtime === observed.parent_runtime &&
      current.parent_runtime_instance === observed.parent_runtime_instance &&
      current.parent_session_id === observed.parent_session_id &&
      current.native_child_session_id === observed.native_child_session_id &&
      current.native_child_sdk_session_id === observed.native_child_sdk_session_id &&
      current.native_dispatch_id === observed.native_dispatch_id &&
      current.native_sdk_user_message_id === observed.native_sdk_user_message_id &&
      current.native_metadata_json === observed.native_metadata_json
    ) ? current : null;
  }

  private markUnknown(workstream: AgentWorkstream, job: AgentBridgeJobRow, reason: string): void {
    // An existing unknown record may contain a cancellation request or an
    // incomplete terminal observation. A failed follow-up probe never erases
    // that durable safety evidence merely to restate that it is unknown.
    if (job.state === 'unknown') return;
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

  /**
   * An already-bound receipt may be inspected under the opted-in local
   * executor without dispatch-only capture or MCP transport readiness. The
   * initial observation requires current opt-in; a later opt-in drift fences
   * application rather than erasing an exact receipt already under inspection.
   * This never creates a session, connects a tool, or admits work; the exact
   * child/parent binding and lifecycle evidence remain required by the caller.
   */
  private async terminalReceiptEngineIdentity(requireOptIn: boolean): Promise<OpencodeEngineIdentity | null> {
    if (
      this.disposed || !this.initialized ||
      (requireOptIn && !this.dependencies.enabled()) ||
      this.dependencies.dbClient !== 'sqlite' ||
      (this.dependencies.role !== 'local' && this.dependencies.role !== 'all') ||
      !this.dependencies.engine.isReady || !this.dependencies.engine.hasOwnedEngine
    ) return null;
    try {
      return await this.dependencies.engine.getEngineIdentity();
    } catch {
      return null;
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
  ): Promise<Array<{ info: unknown; parts?: unknown }> | null> {
    const messages: Array<{ info: unknown; parts?: unknown }> = [];
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
      messages.push(...page.messages as Array<{ info: unknown; parts?: unknown }>);
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
    const outputContract = value.outputContract === undefined
      ? undefined
      : value.outputContract === 'structured_read_only_proposal_v1'
        ? 'structured_read_only_proposal_v1' as const
        : null;
    if (
      value.maxTurns !== 1 || !Number.isSafeInteger(value.maxWallTimeSeconds) ||
      !Number.isSafeInteger(value.maxTokens) ||
      (value.queueDeadlineAt !== null && typeof value.queueDeadlineAt !== 'string') ||
      outputContract === null
    ) return null;
    return {
      maxTurns: 1,
      maxWallTimeSeconds: value.maxWallTimeSeconds as number,
      maxTokens: value.maxTokens as number,
      queueDeadlineAt: value.queueDeadlineAt as string | null,
      ...(outputContract === undefined ? {} : { outputContract }),
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

/**
 * A model proposal can add bounded pending/blocked criteria, never rewrite a
 * user/server criterion, verification receipt, reference, or goal. Returning
 * null makes the terminal result a durable hold rather than guessing how to
 * merge a conflicting model control.
 */
function checkpointWithStructuredProposal(
  current: AgentWorkstreamCheckpoint,
  proposal: ManagedWorkstreamStructuredProposal,
): AgentWorkstreamCheckpoint | null {
  const ids = new Set(current.criteria.map((criterion) => criterion.id));
  if (current.criteria.length + proposal.criteria.length > 100 || proposal.criteria.some((criterion) => ids.has(criterion.id))) {
    return null;
  }
  return {
    version: 1,
    criteria: [
      ...current.criteria.map((criterion) => ({ ...criterion })),
      ...proposal.criteria.map((criterion) => ({ ...criterion })),
    ],
    // References are an independent qualified-source control. A model cannot
    // add, remove, or reinterpret them through a structured proposal.
    references: current.references.map((reference) => ({ ...reference })),
    nextAction: { ...proposal.nextAction },
  };
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

/** Holds that mean "a charged turn is still open": re-read later, never complete. */
const TRANSIENT_WORKFLOW_HOLDS = new Set<CodingWorkflowHoldReason>([
  'turn_not_terminal', 'turn_incomplete', 'session_busy', 'pending_interaction', 'lifecycle_changed',
  'native_tree_changed',
]);

type CodingWorkflowJobRecord = Record<string, unknown> & { prepared: Record<string, unknown> };

/** The exact durable workflow block of a coordinator job, or null for every other lane. */
function codingWorkflowRecord(job: AgentBridgeJobRow): CodingWorkflowJobRecord | null {
  const workflow = jsonRecord(job.native_metadata_json)?.workflow;
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return null;
  const record = workflow as Record<string, unknown>;
  return record.kind === 'coding_workflow' && record.prepared && typeof record.prepared === 'object'
    ? record as CodingWorkflowJobRecord
    : null;
}

/** The typed dispatch receipt re-derived from durable job JSON (strictly re-parsed by the inspector). */
function codingWorkflowReceipt(record: CodingWorkflowJobRecord): unknown {
  const prepared = record.prepared;
  return {
    schemaVersion: 1,
    adapter: 'coding_workflow_v1',
    authorization: record.authorization,
    owner: prepared.owner,
    delegation: prepared.delegation,
    dispatch: { ...(prepared.dispatch as Record<string, unknown>), delivery: record.delivery },
    engine: prepared.engine,
  };
}

/** Exact charged callback anchors persisted before their exposure; never inferred. */
function codingWorkflowRootTurns(record: CodingWorkflowJobRecord): unknown {
  const anchors = Array.isArray(record.callbackAnchors) ? record.callbackAnchors as Array<Record<string, unknown>> : [];
  return anchors.map((anchor) => ({ dispatchId: anchor.dispatchId, sdkUserMessageId: anchor.sdkUserMessageId }));
}

/** Text of the one closing assistant step answering `parentId` (null when absent/ambiguous). */
function closingAssistantText(
  messages: Array<{ info: unknown; parts?: unknown }>,
  parentId: string | null,
): { messageId: string; text: string } | null {
  const closing = messages.filter((message) => {
    const info = message.info as { role?: unknown; parentID?: unknown; finish?: unknown; id?: unknown };
    return info.role === 'assistant' && info.finish === 'stop' && typeof info.id === 'string' &&
      (parentId === null || info.parentID === parentId);
  });
  if (closing.length !== 1) return null;
  const parts = Array.isArray(closing[0].parts) ? closing[0].parts as Array<{ type?: unknown; text?: unknown }> : [];
  return {
    messageId: (closing[0].info as { id: string }).id,
    text: parts.filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n'),
  };
}

export type CodingWorkflowCheckOutcome =
  | { kind: 'intermediate' | 'final'; workstreamRevision: number }
  | { kind: 'hold'; reason: string };

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

// ── Coding Workflow coverage inspection (G2 first adapter) ─────────────────────

/** Existing owned-engine read ports only; no new endpoint. */
export interface CodingWorkflowInspectionEngine {
  getEngineIdentity(): Promise<OpencodeEngineIdentity | null>;
  getSession(sdkId: string): Promise<{ id: string; parentID?: string; directory?: string } | null>;
  listChildrenStrict(sdkId: string, directory: string): Promise<Array<{ id: string; parentID: string; directory: string }> | null>;
  listMessagesPageStrict(
    sdkId: string,
    directory: string,
    options?: { limit?: number; before?: string },
  ): Promise<{ messages: Array<{ info: Record<string, unknown>; parts?: unknown }>; nextCursor: string | null } | null>;
  inspectBoundSessionLifecycles(sdkSessionIds: string[], directory: string): Promise<BoundSessionLifecycleInspection>;
}

export interface CodingWorkflowInspectionInput {
  /** The typed receipt exported at the actual SDK boundary (re-parsed strictly here). */
  receipt: unknown;
  /**
   * Exact persisted dispatch anchors of the root/review turns charged to this
   * ordinal (including any charged automatic callback/review). Never lastN, a
   * timestamp or an oldest/newest row.
   */
  rootTurns: unknown;
  /** Synchronous owner/epoch/permission/admission proof, run after the last await. */
  current(): boolean;
}

interface NativeNode { id: string; parentID: string; directory: string; depth: number }

/**
 * Complete manager + recursive native descendants + exact root/review accounting.
 * Anything missing, malformed, ambiguous, pending, changed or over a bound is a
 * hold with no usage figure: there is no fabricated zero and no manager-only total.
 */
export class CodingWorkflowCoverageInspector {
  constructor(private readonly dependencies: {
    engine: CodingWorkflowInspectionEngine;
    sessions: Pick<AgentSessionsRepository, 'findById'>;
    delegations: Pick<AgentAsyncDelegationsRepository, 'findById'>;
    dispatches: Pick<ModelProvenanceRepository, 'get'>;
    probeTimeoutMs?: number;
  }) {}

  async inspect(input: CodingWorkflowInspectionInput): Promise<CodingWorkflowCoverageResult> {
    const hold = (reason: CodingWorkflowHoldReason, coverage: CodingWorkflowCoverageIds | null = null): CodingWorkflowCoverageResult =>
      ({ status: 'hold', reason, coverage, usage: null });
    const receipt = parseCodingWorkflowDispatchReceipt(input.receipt);
    if (!receipt) return hold('receipt_invalid');
    if (receipt.dispatch.delivery !== 'accepted') return hold('delivery_unknown');
    const rootTurns = parseRootTurns(input.rootTurns);
    if (!rootTurns) return hold('root_turns_missing');

    const binding = this.localBinding(receipt, rootTurns);
    if (binding.kind !== 'ok') return hold(binding.reason);
    const ids = (descendants: string[] = [], turns: CodingWorkflowRootTurn[] = []): CodingWorkflowCoverageIds => ({
      managerSessionId: receipt.delegation.managerSessionId,
      managerSdkSessionId: receipt.delegation.managerSdkSessionId,
      descendantSdkSessionIds: [...descendants].sort(),
      rootTurns: turns,
    });

    const engine = this.dependencies.engine;
    const before = await this.bounded(engine.getEngineIdentity());
    if (!before) return hold('engine_identity_unavailable');
    if (before.bootId !== receipt.engine.bootId) return hold('engine_identity_changed');

    const manager = await this.bounded(engine.getSession(receipt.delegation.managerSdkSessionId));
    if (
      !manager || manager.id !== receipt.delegation.managerSdkSessionId ||
      manager.parentID !== receipt.owner.rootSdkSessionId ||
      typeof manager.directory !== 'string' || manager.directory.length === 0
    ) return hold('native_metadata_unavailable', ids());
    const managerNode: NativeNode = {
      id: manager.id, parentID: manager.parentID, directory: manager.directory, depth: 0,
    };

    const tree = await this.enumerate(managerNode);
    if (tree.kind !== 'ok') return hold(tree.reason, ids());
    const descendants = tree.nodes;
    const descendantIds = descendants.map((node) => node.id);
    const covered = ids(descendantIds);

    const lifecycle = await this.lifecycle([managerNode, ...descendants]);
    if (lifecycle !== 'ok') return hold(lifecycle, covered);

    const steps: Array<Record<string, unknown>> = [];
    const sessionsWithSteps = new Set<string>();
    // Manager: every assistant step in its session must belong to the one
    // exact exported anchor, and exactly one terminal step must close it.
    const managerMessages = await this.readAll(managerNode.id, managerNode.directory);
    if (managerMessages.kind !== 'ok') return hold(managerMessages.reason, covered);
    const managerAssistants = managerMessages.messages.filter((message) => message.info.role === 'assistant');
    if (managerAssistants.some((message) => message.info.parentID !== receipt.dispatch.sdkUserMessageId)) {
      return hold('uncovered_assistant_turn', covered);
    }
    if (managerAssistants.length === 0) return hold('accounting_missing', covered);
    if (managerAssistants.some((message) => !completedStep(message.info))) return hold('turn_incomplete', covered);
    if (turnGroupClosure(managerAssistants) !== 'closed') return hold('turn_not_terminal', covered);
    steps.push(...managerAssistants.map((message) => message.info));
    sessionsWithSteps.add(managerNode.id);

    // Every actual native descendant is charged for ALL of its assistant steps.
    for (const node of descendants) {
      const read = await this.readAll(node.id, node.directory);
      if (read.kind !== 'ok') return hold(read.reason, covered);
      const assistants = read.messages.filter((message) => message.info.role === 'assistant');
      if (assistants.length === 0) return hold('accounting_missing', covered);
      if (assistants.some((message) => !completedStep(message.info))) return hold('turn_incomplete', covered);
      // A completed tool-calls STEP is not a closed TURN: every actual turn
      // group (assistant steps sharing one user parent) must close exactly once.
      const groups = groupByParent(assistants);
      if (!groups) return hold('uncovered_assistant_turn', covered);
      if (groups.some((group) => turnGroupClosure(group) !== 'closed')) return hold('turn_not_terminal', covered);
      steps.push(...assistants.map((message) => message.info));
      sessionsWithSteps.add(node.id);
    }

    // Root/review turns: exactly the promised persisted dispatch anchors.
    if (rootTurns.length > 0) {
      const rootRead = await this.readAll(receipt.owner.rootSdkSessionId, binding.rootDirectory);
      if (rootRead.kind !== 'ok') return hold(rootRead.reason, covered);
      for (const turn of rootTurns) {
        const assistants = rootRead.messages.filter((message) =>
          message.info.role === 'assistant' && message.info.parentID === turn.sdkUserMessageId);
        if (assistants.length === 0) return hold('accounting_missing', covered);
        if (assistants.some((message) => !completedStep(message.info))) return hold('turn_incomplete', covered);
        // Same closed-turn proof for each exactly charged root/review anchor; no
        // blanket idle requirement for unrelated root activity.
        if (turnGroupClosure(assistants) !== 'closed') return hold('turn_not_terminal', covered);
        steps.push(...assistants.map((message) => message.info));
      }
      sessionsWithSteps.add(receipt.owner.rootSdkSessionId);
    }
    const coverage = ids(descendantIds, rootTurns);

    // Every await above can race the engine: re-prove the identity, the child
    // set and the lifecycle, then the local/owner/epoch scope synchronously.
    const afterTree = await this.enumerate(managerNode);
    if (afterTree.kind !== 'ok') return hold(afterTree.reason, coverage);
    if (canonicalTree(afterTree.nodes) !== canonicalTree(descendants)) return hold('native_tree_changed', coverage);
    const finalLifecycle = await this.lifecycle([managerNode, ...afterTree.nodes]);
    if (finalLifecycle !== 'ok') return hold(finalLifecycle === 'lifecycle_unavailable' ? 'lifecycle_unavailable' : 'lifecycle_changed', coverage);
    const after = await this.bounded(engine.getEngineIdentity());
    if (!after || after.bootId !== before.bootId) return hold('engine_identity_changed', coverage);

    const summed = usageFromAssistantSteps(steps, null);
    if (!summed) return hold('usage_incomplete', coverage);
    let current = false;
    try { current = input.current() === true; } catch { current = false; }
    if (!current) return hold('scope_changed', coverage);
    if (this.localBinding(receipt, rootTurns).kind !== 'ok') return hold('local_binding_changed', coverage);

    return {
      status: 'complete',
      coverage,
      engineBootId: after.bootId,
      usage: {
        schemaVersion: 1,
        status: 'actual',
        basis: 'engine_assistant_turn_steps',
        assistantStepCount: summed.assistantStepCount as number,
        coveredSessionCount: sessionsWithSteps.size,
        inputTokens: summed.inputTokens as number,
        outputTokens: summed.outputTokens as number,
        reasoningTokens: summed.reasoningTokens as number,
        cacheReadTokens: summed.cacheReadTokens as number,
        cacheWriteTokens: summed.cacheWriteTokens as number,
        totalTokens: summed.totalTokens as number,
        cost: summed.cost as number | null,
      },
    };
  }

  /** Exact synchronous local joins: owner/project/root/manager/delegation/dispatch/root anchors. */
  private localBinding(
    receipt: CodingWorkflowDispatchReceipt,
    rootTurns: CodingWorkflowRootTurn[],
  ): { kind: 'ok'; rootDirectory: string } | { kind: 'hold'; reason: CodingWorkflowHoldReason } {
    const changed = { kind: 'hold', reason: 'local_binding_changed' } as const;
    try {
      const { sessions, delegations, dispatches } = this.dependencies;
      const root = sessions.findById(receipt.owner.rootSessionId);
      const manager = sessions.findById(receipt.delegation.managerSessionId);
      if (
        !root || !manager || root.ownerUserId !== receipt.owner.ownerUserId ||
        root.projectId !== receipt.owner.projectId || root.sdkSessionId !== receipt.owner.rootSdkSessionId ||
        root.parentSessionId !== null || typeof root.cwd !== 'string' || root.cwd.length === 0 ||
        manager.ownerUserId !== receipt.owner.ownerUserId ||
        manager.projectId !== receipt.owner.projectId ||
        manager.parentSessionId !== root.id || manager.sdkSessionId !== receipt.delegation.managerSdkSessionId
      ) return changed;
      const delegation = delegations.findById(receipt.delegation.delegationId);
      if (
        !delegation || delegation.parentSessionId !== root.id || delegation.childSessionId !== manager.id ||
        delegation.targetAgentConfigId !== 'workflow-orchestrator'
      ) return changed;
      const dispatch = dispatches.get(receipt.dispatch.dispatchId);
      if (
        !dispatch || dispatch.sessionId !== manager.id || dispatch.sdkSessionId !== manager.sdkSessionId ||
        dispatch.sdkUserMessageId !== receipt.dispatch.sdkUserMessageId || dispatch.origin !== 'delegation' ||
        dispatch.reasonCode !== CODING_WORKFLOW_DISPATCH_REASON || dispatch.outcome !== 'accepted'
      ) return changed;
      for (const turn of rootTurns) {
        const row = dispatches.get(turn.dispatchId);
        if (
          !row || row.sessionId !== root.id || row.sdkSessionId !== root.sdkSessionId ||
          row.sdkUserMessageId !== turn.sdkUserMessageId || row.outcome !== 'accepted'
        ) return { kind: 'hold', reason: 'root_turn_unbound' };
      }
      return { kind: 'ok', rootDirectory: root.cwd };
    } catch {
      return changed;
    }
  }

  /** Bounded BFS over actual native parent edges; excess or a cycle is a hold, never a partial tree. */
  private async enumerate(
    manager: NativeNode,
  ): Promise<{ kind: 'ok'; nodes: NativeNode[] } | { kind: 'hold'; reason: CodingWorkflowHoldReason }> {
    const seen = new Set<string>([manager.id]);
    const nodes: NativeNode[] = [];
    const directories = new Set<string>([manager.directory]);
    const queue: NativeNode[] = [manager];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const children = await this.bounded(this.dependencies.engine.listChildrenStrict(node.id, node.directory));
      if (!children) return { kind: 'hold', reason: 'native_tree_unavailable' };
      for (const child of children) {
        if (child.parentID !== node.id || !child.id || !child.directory) {
          return { kind: 'hold', reason: 'descendant_identity_missing' };
        }
        if (seen.has(child.id)) return { kind: 'hold', reason: 'native_tree_cycle' };
        const depth = node.depth + 1;
        directories.add(child.directory);
        if (
          depth > CODING_WORKFLOW_BOUNDS.maxDepth || nodes.length + 1 > CODING_WORKFLOW_BOUNDS.maxDescendants ||
          directories.size > CODING_WORKFLOW_BOUNDS.maxDirectories
        ) return { kind: 'hold', reason: 'native_tree_bounds_exceeded' };
        seen.add(child.id);
        const next = { id: child.id, parentID: child.parentID, directory: child.directory, depth };
        nodes.push(next);
        queue.push(next);
      }
    }
    return { kind: 'ok', nodes };
  }

  /** Strict lifecycle per owned directory batch (<=100 ids): known, idle/absent, nothing pending. */
  private async lifecycle(nodes: NativeNode[]): Promise<'ok' | CodingWorkflowHoldReason> {
    const byDirectory = new Map<string, string[]>();
    for (const node of nodes) byDirectory.set(node.directory, [...(byDirectory.get(node.directory) ?? []), node.id]);
    for (const [directory, sessionIds] of byDirectory) {
      for (let offset = 0; offset < sessionIds.length; offset += 100) {
        const batch = sessionIds.slice(offset, offset + 100);
        const inspection = await this.bounded(this.dependencies.engine.inspectBoundSessionLifecycles(batch, directory));
        if (!inspection?.available) return 'lifecycle_unavailable';
        for (const id of batch) {
          if (!inspection.knownSessionIds.includes(id)) return 'lifecycle_unavailable';
          if (inspection.pendingQuestionSessionIds.includes(id) || inspection.pendingPermissionSessionIds.includes(id)) {
            return 'pending_interaction';
          }
          const status = inspection.statusBySessionId[id];
          if (status && status.type === 'busy') return 'session_busy';
          if (status && status.type !== 'idle') return 'lifecycle_changed';
        }
      }
    }
    return 'ok';
  }

  /** Every cursor page to the engine's explicit end; a failed/repeated/over-cap page is a hold. */
  private async readAll(
    sdkSessionId: string,
    directory: string,
  ): Promise<{ kind: 'ok'; messages: Array<{ info: Record<string, unknown>; parts?: unknown }> } | { kind: 'hold'; reason: CodingWorkflowHoldReason }> {
    const messages: Array<{ info: Record<string, unknown>; parts?: unknown }> = [];
    const cursors = new Set<string>();
    let before: string | undefined;
    for (let page = 0; page < CODING_WORKFLOW_BOUNDS.maxMessagePagesPerSession; page += 1) {
      const result = await this.bounded(this.dependencies.engine.listMessagesPageStrict(
        sdkSessionId, directory, { limit: 100, ...(before === undefined ? {} : { before }) },
      ));
      if (!result) return { kind: 'hold', reason: 'messages_unavailable' };
      messages.push(...result.messages);
      if (!result.nextCursor) return { kind: 'ok', messages };
      if (cursors.has(result.nextCursor)) return { kind: 'hold', reason: 'message_pages_incomplete' };
      cursors.add(result.nextCursor);
      before = result.nextCursor;
    }
    return { kind: 'hold', reason: 'message_pages_incomplete' };
  }

  private bounded<T>(pending: Promise<T>): Promise<T | null> {
    const timeoutMs = this.dependencies.probeTimeoutMs ?? STATUS_PROBE_TIMEOUT_MS;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), timeoutMs);
      pending.then(
        (value) => { clearTimeout(timeout); resolve(value); },
        () => { clearTimeout(timeout); resolve(null); },
      );
    });
  }
}

function parseRootTurns(value: unknown): CodingWorkflowRootTurn[] | null {
  if (!Array.isArray(value) || value.length > CODING_WORKFLOW_BOUNDS.maxRootTurns) return null;
  const turns: CodingWorkflowRootTurn[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    if (
      !record || Object.keys(record).length !== 2 ||
      typeof record.dispatchId !== 'string' || record.dispatchId.length === 0 ||
      typeof record.sdkUserMessageId !== 'string' || record.sdkUserMessageId.length === 0 ||
      seen.has(record.dispatchId) || seen.has(record.sdkUserMessageId)
    ) return null;
    seen.add(record.dispatchId);
    seen.add(record.sdkUserMessageId);
    turns.push({ dispatchId: record.dispatchId, sdkUserMessageId: record.sdkUserMessageId });
  }
  return turns;
}

/** Assistant steps grouped by their user-message parent; null when any step has no usable parent. */
function groupByParent(assistants: Array<{ info: Record<string, unknown> }>): Array<Array<{ info: Record<string, unknown> }>> | null {
  const groups = new Map<string, Array<{ info: Record<string, unknown> }>>();
  for (const message of assistants) {
    const parent = message.info.parentID;
    if (typeof parent !== 'string' || parent.length === 0) return null;
    groups.set(parent, [...(groups.get(parent) ?? []), message]);
  }
  return [...groups.values()];
}

/**
 * Supported terminal policy for ONE completed turn group: exactly one step with
 * finish `stop` and no step carrying an engine error. A group with no `stop`
 * (only tool-calls/length/other finishes), several `stop`s (ambiguous) or any
 * error is `unclosed`; the caller holds with usage=null rather than guessing
 * success or summing a smaller total. Coverage is not an outcome claim.
 */
function turnGroupClosure(group: Array<{ info: Record<string, unknown> }>): 'closed' | 'unclosed' {
  if (group.some((message) => message.info.error !== undefined && message.info.error !== null)) return 'unclosed';
  return group.filter((message) => message.info.finish === 'stop').length === 1 ? 'closed' : 'unclosed';
}

function completedStep(info: Record<string, unknown>): boolean {
  const time = asRecord(info.time);
  return !!time && typeof time.completed === 'number';
}

function canonicalTree(nodes: NativeNode[]): string {
  return JSON.stringify(nodes.map((node) => `${node.id}<${node.parentID}@${node.directory}`).sort());
}
