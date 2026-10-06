/**
 * G2 S5 harness: the REAL CoordinatorConversationService, conversation
 * repository, PersistentWorkstreamCoordinator, CodingWorkflowCoverageInspector,
 * workstream and native-job repositories on one SQLite database. Stubbed: the
 * engine transport (an in-memory native tree/messages behind the existing read
 * ports), the indexed-memory resolver, the async-delegation SDK adapter and
 * the local session/delegation/dispatch lookups the S2 harness already fakes.
 * The adapter stub honours the production contract: one `onPrepared` call, an
 * SDK request only when it returned true.
 */
import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { vi } from 'vitest';

import type { AuthContext } from '../../middleware/auth_middleware';
import { setDb } from '../../database/db';
import { installAgentWorkstreamsSchema } from '../../database/agent_workstreams_schema';
import { installCoordinatorConversationSchema } from '../../database/coordinator_conversation_schema';
import { installAgentBridgeSchema } from '../../shared_agents/bridge_schema';
import { AgentBridgeJobsRepository } from '../../shared_agents/delegation_jobs_repository';
import { CoordinatorConversationsRepository } from '../../repositories/coordinator_conversations_repository';
import { AgentWorkstreamsRepository } from '../../repositories/agent_workstreams_repository';
import { CoordinatorConversationContextAssembler } from '../../services/coordinator_conversation_context';
import { CoordinatorConversationService } from '../../services/coordinator_conversation_service';
import {
  CodingWorkflowCoverageInspector,
  PersistentWorkstreamCoordinator,
} from '../../services/persistent_workstream_coordinator';
import { selectedReferenceCitation } from '../../services/workstream_artifact_verifier';
import type { CodingWorkflowPreparedBinding } from '../../services/agent_delegation_service';
import type { ManagedWorkstreamContextRepository } from '../../repositories/managed_workstream_context_repository';
import type { ProfileScope } from '../../services/agent_profile_scope';

export const scope = { ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' };
export const auth = { sessionToken: 'test-auth', user: { id: scope.ownerUserId } } as AuthContext;
export const ENGINE = { version: 'test-engine', pid: 991, bootId: 'boot-g2' };
export const HASH = 'a'.repeat(64);
const INSTANCE = 'b'.repeat(64);
export const SOURCE = 'note-1';
export const VERSION = 'v7';
const CWD = '/safe/project';

const profiles: Record<string, Record<string, unknown>> = {
  'readonly-profile': {
    id: 'readonly-profile', enabled: true, isAgent: true, locked: false,
    modelProvider: 'provider-a', modelId: 'model-a', revision: 9,
  },
  'workflow-orchestrator': {
    id: 'workflow-orchestrator', label: 'Workflow', allowedMcpsJson: null, enabled: true, isAgent: true, isManager: true, locked: false,
    modelProvider: 'provider-a', modelId: 'model-a', revision: 3, allowedDelegatesJson: JSON.stringify(['verification-gate']),
  },
  'verification-gate': {
    id: 'verification-gate', label: 'Verify', allowedMcpsJson: null, enabled: true, isAgent: true, locked: false,
    modelProvider: 'provider-a', modelId: 'model-a', revision: 1,
  },
};

export function admission(over: Record<string, unknown> = {}) {
  return {
    commandKey: 'wf-plan-1', totalTokenAuthorization: 4096, maxTurns: 2 as const, maxWallTimeSeconds: 300,
    expiresInSeconds: 600, acknowledgesSoftTotalTokenAuthorization: true as const, purpose: 'workflow' as const,
    acknowledgesCodingWorkflowCoverage: true as const,
    workflowCheck: { kind: 'selected_reference_summary_v1' as const, sourceId: SOURCE, expectedVersion: VERSION },
    ...over,
  };
}

type Message = { info: Record<string, unknown>; parts: unknown[] };
const step = (id: string, parentID: string, text: string): Message => ({
  info: {
    id, role: 'assistant', parentID, finish: 'stop', time: { completed: 100 }, providerID: 'provider-a', modelID: 'model-a',
    cost: 0.01, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  parts: [{ type: 'text', text }],
});

export const SUMMARY = `The note states the plan. ${selectedReferenceCitation(SOURCE, VERSION)}`;
export function summaryText(summary = SUMMARY) {
  return `Brief ready.\n${JSON.stringify({ kind: 'selected_reference_summary_v1', sourceId: SOURCE, version: VERSION, summary })}`;
}
export function reviewText(over: Record<string, unknown> = {}, summary = SUMMARY) {
  return JSON.stringify({
    kind: 'selected_reference_review_v1', criterionId: 'reviewed_summary_with_citation', verdict: 'pass',
    sourceId: SOURCE, version: VERSION, summarySha256: createHash('sha256').update(summary).digest('hex'), ...over,
  });
}

/** Mutable world shared by every (re)constructed service on the same database. */
export interface World {
  db: Database.Database;
  previous: Database.Database | null;
  clock: { value: Date };
  sourceHash: { value: string };
  /** Actor-path project access (canAccess) and catalog archival. */
  access: { value: boolean };
  archived: { value: boolean };
  delivery: { value: 'accepted' | 'unknown' | 'rejected' | 'refused_before_prepare' };
  sessions: Map<string, Record<string, unknown>>;
  delegations: Map<string, Record<string, unknown>>;
  dispatches: Map<string, Record<string, unknown>>;
  pages: Map<string, Message[]>;
  /** Native sessions currently busy (a running manager is not idle). */
  busy: Set<string>;
  children: Map<string, Array<{ id: string; parentID: string; directory: string }>>;
  sdkRequests: CodingWorkflowPreparedBinding[];
  objectives: string[];
}

export function world(): World {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY, owner_user_id INTEGER, project_id TEXT, parent_session_id TEXT,
    is_system INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'chat', profile_id TEXT, sdk_session_id TEXT,
    archived_at TEXT, permission_mode TEXT NOT NULL DEFAULT 'default', approval_bypass_explicit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE agent_session_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
    role TEXT NOT NULL, raw_text TEXT NOT NULL, stripped_text TEXT NOT NULL)`);
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO agent_sessions (id, owner_user_id, project_id, parent_session_id, is_system, category, profile_id,
    sdk_session_id, permission_mode, approval_bypass_explicit, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 0, 'chat', 'readonly-profile', 'sdk-root', 'plan', 0, ?, ?)`)
    .run(scope.sessionId, scope.ownerUserId, scope.projectId, at, at);
  installCoordinatorConversationSchema(db);
  installAgentWorkstreamsSchema(db);
  installAgentBridgeSchema(db);
  const previous = setDb(db);
  const sessions = new Map<string, Record<string, unknown>>();
  sessions.set(scope.sessionId, {
    id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId, parentSessionId: null,
    isSystem: false, category: 'chat', sdkSessionId: 'sdk-root', cwd: CWD, profileId: 'readonly-profile',
    providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed', permissionMode: 'plan', approvalBypassExplicit: false,
    status: 'idle',
  });
  return {
    db, previous, clock: { value: new Date() }, sourceHash: { value: HASH }, access: { value: true }, archived: { value: false }, delivery: { value: 'accepted' },
    sessions, delegations: new Map(), dispatches: new Map(), pages: new Map(), children: new Map(), busy: new Set(),
    sdkRequests: [], objectives: [],
  };
}

export function closeWorld(w: World) {
  setDb(w.previous);
  w.db.close();
}

/** The manager of ordinal n closes its exact anchor (the model says "done": not a checked result). */
export function managerFinishes(w: World, ordinal: number, text = 'Done. The source is current.') {
  w.busy.delete(`sdk-manager-${ordinal}`);
  w.pages.set(`sdk-manager-${ordinal}`, [
    { info: { id: `msg-anchor-${ordinal}`, role: 'user' }, parts: [] },
    step(`asst-manager-${ordinal}`, `msg-anchor-${ordinal}`, text),
  ]);
}

/** The manager's closing step carries an engine error. */
export function managerErrors(w: World, ordinal: number) {
  managerFinishes(w, ordinal);
  (w.pages.get(`sdk-manager-${ordinal}`)![1].info as Record<string, unknown>).error = { name: 'ProviderError' };
}

/** Ordinal 2's manager delegated to a verification-gate async child that returned `review`. */
export function reviewerFinishes(w: World, ordinal: number, review: string) {
  const id = `reviewer-${ordinal}`;
  w.sessions.set(id, {
    id, ownerUserId: scope.ownerUserId, projectId: scope.projectId, parentSessionId: `manager-${ordinal}`,
    sdkSessionId: `sdk-${id}`, cwd: CWD, isSystem: false, category: 'chat', status: 'idle',
  });
  w.delegations.set(`by-child:${id}`, {
    id: `rev-delegation-${ordinal}`, parentSessionId: `manager-${ordinal}`, childSessionId: id,
    targetAgentConfigId: 'verification-gate',
  });
  w.children.set(`sdk-manager-${ordinal}`, [{ id: `sdk-${id}`, parentID: `sdk-manager-${ordinal}`, directory: CWD }]);
  w.pages.set(`sdk-${id}`, [
    { info: { id: `rev-user-${ordinal}`, role: 'user' }, parts: [] },
    step(`asst-reviewer-${ordinal}`, `rev-user-${ordinal}`, review),
  ]);
}

export function build(w: World, options: { observe?: boolean } = {}) {
  const findById = (id: string) => (w.sessions.get(id) ?? null) as never;
  const findBySdkSessionId = (sdk: string) =>
    ([...w.sessions.values()].find((session) => session.sdkSessionId === sdk) ?? null) as never;
  const sessions = { findById, findBySdkSessionId, insert: vi.fn(), setSdkSessionId: vi.fn(), updateStatus: vi.fn() };
  const configs = { getById: (id: string) => (profiles[id] ?? null) as never };
  const delegations = {
    findById: (id: string) => (w.delegations.get(id) ?? null) as never,
    findByChildSessionId: (id: string) => (w.delegations.get(`by-child:${id}`) ?? null) as never,
  };
  const dispatches = { get: (id: string) => (w.dispatches.get(id) ?? null) as never };
  const managerOf = (sdk: string) => [...w.sessions.values()].find((s) => s.sdkSessionId === sdk);
  const engine = {
    isReady: true, hasOwnedEngine: true,
    getEngineIdentity: vi.fn(async () => ENGINE),
    createSession: vi.fn(async () => ({ id: 'unexpected-worker' })),
    promptAsync: vi.fn(async () => true),
    abortSession: vi.fn(async () => undefined),
    getSessionStatuses: vi.fn(async () => ({})),
    inspectBoundSessionLifecycles: vi.fn(async (ids: string[]) => ({
      available: true, knownSessionIds: ids,
      statusBySessionId: Object.fromEntries(ids.filter((id) => w.busy.has(id)).map((id) => [id, { type: 'busy' }])),
      pendingQuestionSessionIds: [], pendingPermissionSessionIds: [],
    })),
    listMessagesPage: vi.fn(async (sdk: string) => ({ messages: w.pages.get(sdk) ?? [], nextCursor: null })),
    listMessagesPageStrict: vi.fn(async (sdk: string) => (w.pages.has(sdk) ? { messages: w.pages.get(sdk)!, nextCursor: null } : null)),
    listChildrenStrict: vi.fn(async (sdk: string) => w.children.get(sdk) ?? []),
    getSession: vi.fn(async (sdk: string) => {
      const session = managerOf(sdk);
      if (!session) return null;
      const parent = session.parentSessionId ? w.sessions.get(session.parentSessionId as string) : null;
      return { id: sdk, parentID: parent?.sdkSessionId as string | undefined, directory: CWD };
    }),
    listQuestions: vi.fn(async () => []),
    listPermissions: vi.fn(async () => []),
    listMcp: vi.fn(async () => ({ rhythm: { status: 'connected' } })),
  };
  const resolveReference = vi.fn(async (input: {
    ownerUserId: number; projectId: string; workstreamId: string; workstreamRevision: number;
    reference: { sourceId: string; expectedVersion: string };
  }) => {
    const current = input.reference.expectedVersion === VERSION;
    return {
      selector: input.reference.sourceId,
      eligible: current,
      managedReference: current ? {
        schemaVersion: 1, dependencyId: 'dep-note-1', canonicalId: 'canon-1', observedVersion: VERSION,
        observedHash: w.sourceHash.value, sourceNamespace: 'memory-vault', sourceInstance: INSTANCE,
        ownerUserId: input.ownerUserId, projectId: input.projectId, workstreamId: input.workstreamId,
        workstreamRevision: input.workstreamRevision, provenance: 'user_reference',
      } : null,
      receipt: {
        kind: 'memory_vault', verified: current, reason: current ? null : 'version_mismatch', canonicalId: 'canon-1',
        observedVersion: VERSION, observedHash: w.sourceHash.value, sourceNamespace: 'memory-vault', sourceInstance: INSTANCE,
      },
    };
  });
  const jobs = new AgentBridgeJobsRepository(w.db);
  const workstreams = new AgentWorkstreamsRepository();
  let service: CoordinatorConversationService;
  const coordinator = new PersistentWorkstreamCoordinator({
    artifactResolver: { resolveReference } as never,
    engine: engine as never,
    records: {} as ManagedWorkstreamContextRepository,
    captureAvailable: () => true, enabled: () => true, dbClient: 'sqlite', role: 'local', rhythmMcpServerName: 'rhythm',
    workstreams, jobs, sessions: sessions as never, configs: configs as never,
    profileScopeResolver: async (): Promise<ProfileScope> => ({
      model: { providerID: 'provider-a', modelID: 'model-a' }, mcpRoleConfig: null, allowedSkillsJson: null,
      systemPrompt: null, ocAgent: null, modelTierHint: null,
    }),
    workflowCoverage: new CodingWorkflowCoverageInspector({
      engine: engine as never, sessions: sessions as never, delegations: delegations as never, dispatches: dispatches as never,
    }),
    delegations: delegations as never,
    ...(options.observe === false ? {} : {
      terminalObserver: { onCoordinatorTerminal: (input) => service.onCoordinatorTerminal(input) },
    }),
    hostEpoch: 'g2-epoch',
  });
  coordinator.initialize();

  const dispatch = vi.fn(async (input: {
    objective: string;
    workflow?: { authorization: CodingWorkflowPreparedBinding['authorization']; workflowBinding?: { jobId: string; expiresAt: string };
      onPrepared?: (binding: CodingWorkflowPreparedBinding) => boolean; isCurrent(): boolean; };
  }) => {
    const workflow = input.workflow!;
    const n = workflow.authorization.ordinal;
    const binding: CodingWorkflowPreparedBinding = {
      authorization: workflow.authorization,
      workflowBinding: {
        schemaVersion: 1, jobId: workflow.workflowBinding!.jobId, rootSdkSessionId: 'sdk-root',
        managerSdkSessionId: `sdk-manager-${n}`, expiresAt: workflow.workflowBinding!.expiresAt,
      },
      owner: { ownerUserId: scope.ownerUserId, projectId: scope.projectId, rootSessionId: scope.sessionId, rootSdkSessionId: 'sdk-root' },
      delegation: {
        delegationId: `delegation-${n}`, managerSessionId: `manager-${n}`, managerSdkSessionId: `sdk-manager-${n}`,
        nativeParentSdkSessionId: 'sdk-root',
      },
      dispatch: { dispatchId: `dispatch-${n}`, sdkUserMessageId: `msg-anchor-${n}` },
      engine: ENGINE,
    };
    // The real delegation route persists these local rows before the SDK.
    w.sessions.set(`manager-${n}`, {
      id: `manager-${n}`, ownerUserId: scope.ownerUserId, projectId: scope.projectId, parentSessionId: scope.sessionId,
      sdkSessionId: `sdk-manager-${n}`, cwd: CWD, isSystem: false, category: 'chat', status: 'working',
    });
    w.delegations.set(`delegation-${n}`, {
      id: `delegation-${n}`, parentSessionId: scope.sessionId, childSessionId: `manager-${n}`, targetAgentConfigId: 'workflow-orchestrator',
    });
    w.dispatches.set(`dispatch-${n}`, {
      id: `dispatch-${n}`, sessionId: `manager-${n}`, sdkSessionId: `sdk-manager-${n}`, sdkUserMessageId: `msg-anchor-${n}`,
      origin: 'delegation', reasonCode: 'g2_coding_workflow', outcome: 'accepted',
    });
    if (w.delivery.value === 'refused_before_prepare') return null; // e.g. the server root check refused
    if (workflow.onPrepared?.(binding) !== true || workflow.isCurrent() !== true) return null;
    if (w.delivery.value === 'rejected') {
      (workflow as unknown as { onOutcome?: (b: unknown) => void }).onOutcome?.({ ...binding, delivery: 'rejected' });
      return null;
    }
    w.sdkRequests.push(binding);
    w.busy.add(`sdk-manager-${n}`);
    w.objectives.push(input.objective);
    const delivery = w.delivery.value;
    (workflow as unknown as { onOutcome?: (b: unknown) => void }).onOutcome?.({ ...binding, delivery });
    return { delegationId: `delegation-${n}`, childSessionId: `manager-${n}`, targetAgentConfigId: 'workflow-orchestrator' as const, delivery };
  });
  const repository = new CoordinatorConversationsRepository(w.db, () => w.clock.value);
  const available = <T>(items: T[]) => ({
    availability: 'available' as const, reason: null, complete: true as const, authoritative: true as const,
    observedAt: w.clock.value.toISOString(), sourceVersion: 'v1', items,
  });
  service = new CoordinatorConversationService({
    repository,
    context: new CoordinatorConversationContextAssembler({
      tasks: { read: async () => available([]) }, schedules: { read: async () => available([]) },
      rhythms: { read: async () => available([]) }, workstreams: { read: async () => available([]) },
      receipts: { read: async () => available([]) },
    }),
    workstreams, sessions: sessions as never, configs: configs as never, coordinator, jobs,
    artifactResolver: { resolveReference } as never,
    codingWorkflow: { dispatch } as never,
    projects: {
      findById: (id: string) => id === scope.projectId ? { id, cwd: CWD, archivedAt: w.archived.value ? '2026-10-01T00:00:00Z' : null } : null,
    } as never,
    projectAccess: {
      canAccess: ({ actor, projectId }: { actor: AuthContext; projectId: string }) =>
        w.access.value && actor.user.id === scope.ownerUserId && projectId === scope.projectId,
      canOwnerAccess: ({ ownerUserId, projectId }: { ownerUserId: number; projectId: string }) =>
        ownerUserId === scope.ownerUserId && projectId === scope.projectId,
    },
    enabled: () => true,
    now: () => w.clock.value,
  });
  const nativeJobs = () => w.db.prepare(
    `SELECT id, idempotency_key, state, native_metadata_json, native_application_json, native_usage_json
       FROM agent_bridge_jobs WHERE native_execution_kind='coordinator' ORDER BY created_at, rowid`,
  ).all() as Array<{ id: string; idempotency_key: string; state: string; native_metadata_json: string;
    native_application_json: string | null; native_usage_json: string | null }>;
  return { service, repository, workstreams, jobs, coordinator, dispatch, resolveReference, engine, nativeJobs };
}

export type Built = ReturnType<typeof build>;

/** Capture a goal and admit the deliberate workflow (ordinal 1 dispatched). */
export async function admit(w: World, h: Built, over: Record<string, unknown> = {}) {
  h.repository.designatePrimaryOwnerRoot(scope);
  const captured = await h.service.receiveMessage(auth, {
    sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
    commandKey: 'chat-goal-1', message: 'Validate the selected note and write a cited brief.',
  });
  if (captured.kind !== 'created') throw new Error(`expected a captured goal, got ${captured.kind}`);
  const planned = await h.service.preparePlan(auth, {
    sessionId: scope.sessionId, projectId: scope.projectId,
    expectedControlRevision: captured.conversation.controlRevision, goalId: captured.goal.id,
    admission: admission(over) as never,
  });
  return { captured, planned };
}

export function authority(h: Built) {
  const found = h.repository.get(scope);
  if (found.kind !== 'found') throw new Error('conversation missing');
  return found.conversation.continuations[0];
}

export function workstream(h: Built) {
  return h.workstreams.find(scope.ownerUserId, scope.projectId, authority(h).workstreamId)!;
}

export function criteria(h: Built) {
  return Object.fromEntries(workstream(h).checkpoint.criteria.map((c) => [c.id, c.status]));
}

/** Let the void-promise terminal observer chain settle. */
export async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}
