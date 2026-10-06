import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sdkPromptAsync, sdkMcpStatus, sdkMcpConnect } = vi.hoisted(() => ({
  sdkPromptAsync: vi.fn(), sdkMcpStatus: vi.fn(), sdkMcpConnect: vi.fn(),
}));
vi.mock('../services/opencode_engine', async () => {
  const { OpencodeClientService } = await vi.importActual<typeof import('../services/opencode_client_service')>('../services/opencode_client_service');
  const service = new OpencodeClientService();
  (service as unknown as { client: unknown }).client = {
    session: { promptAsync: sdkPromptAsync },
    mcp: { status: sdkMcpStatus, connect: sdkMcpConnect },
  };
  (service as unknown as { status: string }).status = 'ready';
  (service as unknown as { server: unknown }).server = { url: 'http://engine.test', close() {} };
  (service as unknown as { listMessages: unknown }).listMessages = async () => [];
  return { opencodeClient: service, opencodeSessionMap: new Map<string, string>() };
});
vi.mock('../services/opencode_stream_bridge', () => ({ streamBridge: { streamSession: vi.fn(async () => undefined) } }));

import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { WorkstreamArtifactAuthorityResolver } from '../services/workstream_artifact_verifier';
import { workflowApprovalResumeReasonCode } from '../services/chat_bounded_workflow';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { ManagedWorkstreamContextRepository } from '../repositories/managed_workstream_context_repository';
import { PersistentWorkstreamCoordinator } from '../services/persistent_workstream_coordinator';
import type { CodingWorkflowPreparedBinding } from '../services/agent_delegation_service';
import type { ProfileScope } from '../services/agent_profile_scope';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { CoordinatorConversationModelStatusService } from '../services/coordinator_conversation_model_status_service';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { createApp } from '../app';
import { createTrustedMcpTestSigner } from '../__tests__/helpers/trusted_mcp_test_proof';
import { startTestServer } from '../__tests__/helpers/real_server';
import { pinTrustedMcpPublicKey, clearTrustedMcpVerifier } from '../security/trusted_mcp_call';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { installHumanApprovalTestCredentials, signHumanApprovalDecision, type HumanApprovalTestCredentials } from '../__tests__/helpers/human_approval_test_credentials';
import { opencodeClient, opencodeSessionMap } from '../services/opencode_engine';
import { AgentApprovalContinuationService } from '../services/agent_approval_continuation_service';
import type { TestServer } from '../__tests__/helpers/real_server';

const ROOT = 'chat-bounded-root';
const SDK = 'sdk-chat-bounded-root';
const PROFILE = 'Secretary';
const NOW = Date.now();
const available = <T>(items: T[]) => ({
  availability: 'available' as const, reason: null, complete: true as const, authoritative: true as const,
  observedAt: new Date(NOW).toISOString(), sourceVersion: 'fixture-v1', items,
});

describe('chat bounded Coding Workflow API acceptance contract', () => {
  let db: Database.Database;
  let http: TestServer;
  let token: string;
  let signer: ReturnType<typeof createTrustedMcpTestSigner>;
  let rootId: string;
  let goalId: string;
  let repo: CoordinatorConversationsRepository;
  let active: { userMessageId: string; toolName: string };
  let sequence = 0;
  let memoryDir: string;
  let memoryId: string;
  let referenceVersion: string;
  let humanCredentials: HumanApprovalTestCredentials;
  let failPreparedBind = false;
  let approvalWakes = 0;
  let lastWakeId = '';
  let priorMemorySubdir: string | undefined;
  let mcpStatus = 'connected';
  let readinessMcpCalls = 0;
  let unavailableAtReadinessCall: number | null = null;
  let homeSpy: ReturnType<typeof vi.spyOn> | undefined;

  const signed = (toolName: string, args: Record<string, unknown>) => {
    sequence += 1;
    return signer.signCall({
      sdkSessionId: SDK,
      turnId: `turn-${sequence}`,
      agentName: PROFILE,
      toolCallId: `call-${sequence}`,
    }, toolName, args, NOW);
  };

  beforeEach(async () => {
    priorMemorySubdir = process.env.MEMORY_VAULT_SUBDIR;
    process.env.MEMORY_VAULT_SUBDIR = '';
    db = new Database(':memory:');
    runMigrations(db);
    installAgentWorkstreamsSchema(db);
    installAgentBridgeSchema(db);
    setDb(db);
    db.pragma('foreign_keys = OFF');
    sdkPromptAsync.mockReset().mockResolvedValue({ response: { status: 204 } });
    sdkMcpStatus.mockReset().mockImplementation(async () => ({ data: { rhythm: { status: mcpStatus } } }));
    sdkMcpConnect.mockReset().mockImplementation(async () => {
      mcpStatus = 'connected';
      return { data: true };
    });
    mcpStatus = 'connected';
    readinessMcpCalls = 0;
    unavailableAtReadinessCall = null;
    failPreparedBind = false;
    approvalWakes = 0;
    lastWakeId = '';
    const user = new UsersRepository().create({ name: 'Contract Owner', email: `contract-${Math.random()}@example.test` });
    token = (await new SessionsRepository().createAsync(user.id)).token;
    humanCredentials = installHumanApprovalTestCredentials();
    const project = new ProjectsRepository().insert({
      name: 'Contract Project', cwd: '/tmp/chat-bounded-contract', icon: null,
      vcs: { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: null },
    });
    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent, revision)
      VALUES (?, ?, 'S', 'synthetic', 1, 1, 1)`).run(PROFILE, PROFILE);
    db.prepare(`UPDATE agent_configs SET model_provider='provider', model_id='model' WHERE id=?`).run(PROFILE);
    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent, is_manager, allowed_delegates_json, model_provider, model_id, revision)
      VALUES ('workflow-orchestrator','Workflow','W','synthetic',1,1,1,'["verification-gate"]','provider','model',1),
      ('verification-gate','Reviewer','V','synthetic',1,1,0,'[]','provider','model',1)`).run();
    new AgentSessionsRepository().insert({
      agentKind: PROFILE as never, opencodeAgentId: 'opencode' as never, taskId: null, cwd: '/tmp', name: 'Secretary root', profileId: PROFILE as never,
    } as never);
    rootId = (db.prepare('SELECT id FROM agent_sessions ORDER BY rowid DESC LIMIT 1').get() as { id: string }).id;
    db.prepare(`UPDATE agent_sessions SET owner_user_id=?, project_id=?, status='idle', permission_mode='plan', provider_id='provider', model_id='model', model_mode='fixed' WHERE id=?`)
      .run(user.id, project.id, rootId);
    new AgentSessionsRepository().setSdkSessionId(rootId, SDK);
    opencodeSessionMap.set(rootId, SDK);
    repo = new CoordinatorConversationsRepository(db, () => new Date(NOW));
    expect(repo.designatePrimaryOwnerRoot({
      ownerUserId: user.id, projectId: project.id, sessionId: rootId,
    }).kind).toBe('found');
    const context = new CoordinatorConversationContextAssembler({
      tasks: { read: async () => available([]) }, schedules: { read: async () => available([]) },
      rhythms: { read: async () => available([]) }, workstreams: { read: async () => available([]) },
      receipts: { read: async () => available([]) },
    });
    memoryDir = await mkdtemp(path.join(os.tmpdir(), 'chat-bounded-memory-'));
    const fixtureHome = path.join(memoryDir, 'home');
    await mkdir(path.join(fixtureHome, '.config', 'opencode'), { recursive: true });
    await mkdir(path.join(fixtureHome, '.config', 'rhythm'), { recursive: true });
    await writeFile(path.join(fixtureHome, '.config', 'opencode', 'opencode.json'), JSON.stringify({
      mcp: { rhythm: { type: 'local', enabled: true, command: ['synthetic-fixture-command'] } },
    }));
    await writeFile(path.join(fixtureHome, '.config', 'rhythm', 'mcp-deletions.json'), JSON.stringify({ deleted: [] }));
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fixtureHome);
    await mkdir(path.join(memoryDir, 'notes'));
    const noteBody = 'Sunday service notes: readings, songs, and one short announcement.';
    const noteBytes = `---\nid: sunday-service-notes\nkind: context\ntags: [service]\ncreated: 2026-10-06\nupdated: 2026-10-06\nsource: fixture\nstatus: stable\n---\n${noteBody}\n`;
    await writeFile(path.join(memoryDir, 'notes', 'sunday-service-notes.md'), noteBytes);
    const indexed = await new AgentMemoryRepository().createAsync({
      kind: 'context', content: noteBody, source: 'obsidian-memory', sourceId: 'notes/sunday-service-notes.md', ownerUserId: user.id,
    });
    memoryId = indexed.id;
    referenceVersion = `sha256:${createHash('sha256').update(noteBytes).digest('hex')}`;
    const realResolver = new WorkstreamArtifactAuthorityResolver({ memoryRoot: () => memoryDir });
    const configs = new AgentConfigsRepository();
    const projects = new ProjectsRepository();
    const sessions = new AgentSessionsRepository();
    const workstreams = new AgentWorkstreamsRepository();
    const jobsBase = new AgentBridgeJobsRepository(db);
    const jobs = new Proxy(jobsBase, {
      get(target, prop, receiver) {
        if (prop === 'bindCoordinatorWorkflowPrepared' && failPreparedBind) return () => { throw new Error('contract storage failure'); };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const engine = {
      isReady: true, hasOwnedEngine: true,
      getEngineIdentity: async () => ({ version: 'contract-engine', pid: 991, bootId: 'chat-bounded-contract' }),
      createSession: async () => ({ id: 'unused-worker' }), promptAsync: async () => true,
      abortSession: async () => undefined, getSessionStatuses: async () => ({}),
      inspectBoundSessionLifecycles: async (ids: string[]) => ({ available: true, knownSessionIds: ids, statusBySessionId: {}, pendingQuestionSessionIds: [], pendingPermissionSessionIds: [] }),
      listMessagesPage: async () => ({ messages: [], nextCursor: null }), listQuestions: async () => [], listPermissions: async () => [],
      listMcp: async () => {
        readinessMcpCalls += 1;
        const unavailable = unavailableAtReadinessCall !== null && readinessMcpCalls >= unavailableAtReadinessCall;
        return { rhythm: { status: unavailable ? 'needs_auth' : mcpStatus } };
      },
    };
    const coordinator = new PersistentWorkstreamCoordinator({
      artifactResolver: realResolver, engine: engine as never, records: new ManagedWorkstreamContextRepository(db),
      captureAvailable: () => true, enabled: () => true, dbClient: 'sqlite', role: 'local', rhythmMcpServerName: 'rhythm',
      workstreams, jobs, sessions, configs,
      profileScopeResolver: async (): Promise<ProfileScope> => ({ model: { providerID: 'provider', modelID: 'model' }, mcpRoleConfig: null,
        allowedSkillsJson: null, systemPrompt: null, ocAgent: null, modelTierHint: null }),
      hostEpoch: 'chat-bounded-contract',
    });
    coordinator.initialize();
    const codingWorkflow = {
      dispatch: async (input: { workflow?: { authorization: CodingWorkflowPreparedBinding['authorization']; workflowBinding?: { jobId: string; expiresAt: string };
        onPrepared?: (binding: CodingWorkflowPreparedBinding) => boolean; onOutcome?: (binding: CodingWorkflowPreparedBinding & { delivery: 'accepted' | 'unknown' | 'rejected' }) => void; isCurrent(): boolean } }) => {
        const workflow = input.workflow;
        if (!workflow?.workflowBinding || !workflow.isCurrent()) return null;
        const binding: CodingWorkflowPreparedBinding = {
          authorization: workflow.authorization,
          workflowBinding: { schemaVersion: 1, jobId: workflow.workflowBinding.jobId, rootSdkSessionId: SDK,
            managerSdkSessionId: 'sdk-workflow-manager', expiresAt: workflow.workflowBinding.expiresAt },
          owner: { ownerUserId: user.id, projectId: project.id, rootSessionId: rootId, rootSdkSessionId: SDK },
          delegation: { delegationId: 'contract-delegation', managerSessionId: 'contract-manager-session',
            managerSdkSessionId: 'sdk-workflow-manager', nativeParentSdkSessionId: SDK },
          dispatch: { dispatchId: 'contract-dispatch', sdkUserMessageId: 'contract-manager-message' },
          engine: { version: 'contract-engine', pid: 991, bootId: 'chat-bounded-contract' },
        };
        if (workflow.onPrepared?.(binding) !== true || !workflow.isCurrent()) return null;
        workflow.onOutcome?.({ ...binding, delivery: 'accepted' });
        return { delegationId: 'contract-delegation', childSessionId: 'contract-manager-session',
          targetAgentConfigId: 'workflow-orchestrator' as const, delivery: 'accepted' as const };
      },
    };
    const service = new CoordinatorConversationService({
      repository: repo,
      context,
      workstreams, jobs, coordinator, codingWorkflow,
      artifactResolver: realResolver,
      sessions,
      configs,
      projects,
      projectAccess: { canAccess: () => true, canOwnerAccess: () => true },
      enabled: () => true,
      now: () => new Date(NOW),
    });
    const captured = await service.receiveMessage({ sessionToken: token, user } as never, {
      sessionId: rootId, projectId: project.id, expectedControlRevision: 1,
      commandKey: 'capture-chat-bounded-goal', message: 'Prepare a concise cited Sunday service brief from the current notes.',
    });
    expect(captured.kind).toBe('created');
    expect(configs.getById('workflow-orchestrator')).toMatchObject({ enabled: true, isAgent: true, isManager: true, allowedDelegatesJson: '[\"verification-gate\"]' });
    expect(configs.getById('verification-gate')).toMatchObject({ enabled: true, isAgent: true });
    goalId = (captured as { goal: { id: string } }).goal.id;
    const actor = { sessionToken: token, user } as never;
    const binding = { sessionId: rootId, projectId: project.id, sdkSessionId: SDK };
    expect(service.modelStatusScopeCurrent(actor, binding)).toBe(true);
    expect(service.boundedWorkflowSelection(actor, binding, 'Prepare a concise cited Sunday service brief from the current notes.')).not.toBeNull();
    const resolved = await realResolver.resolveReference({ ownerUserId: user.id, projectId: project.id, workstreamId: 'proposal-proof', workstreamRevision: 1,
      reference: { sourceId: `memory:${memoryId}`, expectedVersion: referenceVersion, scope: project.id, provenance: 'user_reference' } });
    expect(resolved).toMatchObject({ eligible: true, receipt: { verified: true, reason: null } });
    expect(resolved?.isCurrent?.()).toBe(true);
    active = { userMessageId: 'native-foreground-proposal', toolName: 'rhythm_propose_bounded_coding_workflow' };
    const dispatch = new ModelProvenanceRepository().insert({
      sessionId: rootId, sdkSessionId: SDK, sdkUserMessageId: active.userMessageId,
      origin: 'prompt_api', requestedSource: 'session', routeAuthed: true, reasonCode: 'c2_foreground',
      requestedProviderId: 'provider', requestedModelId: 'model', resolvedProviderId: 'provider',
      resolvedModelId: 'model', finalProviderId: 'provider', finalModelId: 'model',
    });
    new ModelProvenanceRepository().setOutcome(dispatch.id, 'accepted', active.userMessageId);
    signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    (opencodeClient as unknown as { mintPromptAnchor: unknown }).mintPromptAnchor = async () => `native-workflow-wake-${approvalWakes + 1}`;

    const status = new CoordinatorConversationModelStatusService({
      conversations: service,
      records: repo,
      engine: { getCurrentTrustedMcpToolCall: async (sdkSessionId: string, assistantId: string, toolCallId: string) => ({
        sdkSessionId, assistantId, userMessageId: active.userMessageId, partId: 'part-contract', toolCallId,
        toolKey: active.toolName, agentName: PROFILE, serverName: 'rhythm', toolName: active.toolName,
      }) } as never,
    } as never);
    http = await startTestServer(createApp({
      coordinatorConversationService: service,
      coordinatorAgentTools: status,
    }));
  });

  afterEach(async () => {
    clearTrustedMcpVerifier();
    opencodeSessionMap.clear();
    if (priorMemorySubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
    else process.env.MEMORY_VAULT_SUBDIR = priorMemorySubdir;
    homeSpy?.mockRestore();
    homeSpy = undefined;
    if (memoryDir) await rm(memoryDir, { recursive: true, force: true });
    await http?.close();
    db?.close();
  });

  const post = (path: string, body: unknown) => fetch(`${http.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const proposeApproval = async (estimate = { totalSoftTokens: 12_000, workerWallSeconds: 180, expirySeconds: 600, outerTurns: 2 as const,
    rationale: 'The source is one concise note; one manager pass and one reviewer pass should fit this allowance.' }) => {
    active = { userMessageId: 'native-foreground-proposal', toolName: 'rhythm_propose_bounded_coding_workflow' };
    const proposal = await post('/coordinator-agent/propose-workflow', { trustedCall: signed('rhythm_propose_bounded_coding_workflow', {
      goalSelector: 'Prepare a concise cited Sunday service brief from the current notes.',
      referenceSelector: 'Sunday service notes', referenceSourceId: `memory:${memoryId}`, referenceVersion,
      estimate,
    }) });
    expect(proposal.status).toBe(200);
    const proposalResult = await proposal.json() as { status: string; text: string };
    expect(proposalResult.status).toBe('approval_pending');
    const approvalId = proposalResult.text.match(/^approval_id: ([^\n]+)$/m)?.[1];
    const proposalDigest = proposalResult.text.match(/^proposal_digest: ([a-f0-9]{64})$/m)?.[1];
    expect(approvalId).toBeTruthy(); expect(proposalDigest).toBeTruthy();
    return { approvalId: approvalId!, proposalDigest: proposalDigest!, proposalResult };
  };
  const decideApproval = async (approvalId: string, proposalDigest: string, decision: 'approved' | 'rejected' = 'approved') => {
    const approval = new AgentApprovalsRepository().getById(approvalId);
    expect(approval).toMatchObject({ status: 'pending', securityAction: 'coordinator.workflow.start', payloadDigest: proposalDigest });
    const response = await fetch(`${http.baseUrl}/agent-approvals/${approvalId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, ...humanCredentials.capabilityHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: decision, signature: signHumanApprovalDecision(humanCredentials,
        { ...approval!, decisionNonce: approval!.decisionNonce! }, decision) }),
    });
    expect(response.status).toBe(200);
    if (decision === 'approved') {
      approvalWakes += 1;
      expect(sdkPromptAsync).toHaveBeenCalledTimes(approvalWakes);
      expect(new AgentApprovalsRepository().getById(approvalId)).toMatchObject({ status: 'approved', continuationState: 'delivered' });
    } else {
      expect(new AgentApprovalsRepository().getById(approvalId)).toMatchObject({ status: 'rejected' });
      return;
    }
    lastWakeId = `native-workflow-wake-${approvalWakes}`;
    expect(new ModelProvenanceRepository().linkOldestUserMessage(rootId, SDK, lastWakeId)).toBe(true);
    active = { userMessageId: lastWakeId, toolName: 'rhythm_start_bounded_coding_workflow' };
  };
  const startApproval = (approvalId: string, proposalDigest: string) => post('/coordinator-agent/start-workflow', {
    trustedCall: signed('rhythm_start_bounded_coding_workflow', { approval_id: approvalId, proposal_digest: proposalDigest }),
  });
  const insertPriorDelegation = (name: string, createdAt: string) => {
    const projectId = (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id;
    const child = new AgentSessionsRepository().insert({ agentKind: PROFILE as never, opencodeAgentId: 'opencode' as never,
      taskId: null, cwd: '/tmp', name, profileId: PROFILE as never, projectId: projectId as never,
      ownerUserId: 1, parentSessionId: rootId } as never);
    db.prepare(`UPDATE agent_sessions SET owner_user_id=?, status='completed' WHERE id=?`).run(1, child.id);
    db.prepare(`INSERT INTO agent_async_delegations (id,parent_session_id,child_session_id,target_agent_config_id,status,created_at,updated_at)
      VALUES (?,?,?,'workflow-orchestrator','completed',?,?)`).run(`prior-${child.id}`, rootId, child.id, createdAt, createdAt);
    return child;
  };

  it('chat-bounded-c1: signed Secretary proposal exposes a unique current reference and reasoned estimate without issuing finite authority or a child', async () => {
    const args = {
      goalSelector: 'Prepare a concise cited Sunday service brief from the current notes.',
      referenceSelector: 'Sunday service notes', referenceSourceId: `memory:${memoryId}`, referenceVersion,
      estimate: {
        totalSoftTokens: 12_000, workerWallSeconds: 180, expirySeconds: 600, outerTurns: 2,
        rationale: 'The source is one concise note; one manager pass and one reviewer pass should fit this allowance.',
      },
    };
    const response = await post('/coordinator-agent/propose-workflow', {
      trustedCall: signed('rhythm_propose_bounded_coding_workflow', args),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as Record<string, unknown>;
    expect(result.status, String(result.text)).toBe('approval_pending');
    expect(result.text).toMatch(/12,?000.*soft tokens/i);
    expect(result.text).toMatch(/notes\/sunday-service-notes\.md.*sha256:[a-f0-9]{64}/i);
    expect(result.text).toContain(args.estimate.rationale);
    expect(JSON.stringify(result)).not.toMatch(/\/Users\/|\/private\/|sourceBytes|rawTranscript/i);
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_workstreams`).get()).toEqual({ n: 0 });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c1: permission-bypassed root holds before approval or workstream creation', async () => {
    db.prepare(`UPDATE agent_sessions SET permission_mode='bypass', approval_bypass_explicit=1 WHERE id=?`).run(rootId);
    const response = await post('/coordinator-agent/propose-workflow', { trustedCall: signed('rhythm_propose_bounded_coding_workflow', {
      goalSelector: 'Prepare a concise cited Sunday service brief from the current notes.', referenceSelector: 'Sunday service notes',
      referenceSourceId: `memory:${memoryId}`, referenceVersion,
      estimate: { totalSoftTokens: 12_000, workerWallSeconds: 180, expirySeconds: 600, outerTurns: 2,
        rationale: 'One manager and one reviewer pass fit the existing two-turn stop.' },
    }) });
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_approvals WHERE security_action='coordinator.workflow.start'`).get()).toEqual({ n: 0 });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_workstreams`).get()).toEqual({ n: 0 });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c3: signed human decision wakes the exact proposal once, issues one finite authority, and rejects replay', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    const wake = getDb().prepare(`SELECT reason_code, origin, requested_source, route_authed, outcome FROM agent_turn_dispatches
      WHERE session_id=? AND sdk_user_message_id=?`).get(rootId, lastWakeId) as Record<string, unknown>;
    expect(wake).toEqual({
      reason_code: workflowApprovalResumeReasonCode(approvalId, proposalDigest), origin: 'approval_continuation',
      requested_source: 'agent_config', route_authed: null, outcome: 'accepted',
    });
    const conflictingDispatch = new ModelProvenanceRepository().insert({
      sessionId: rootId, sdkSessionId: SDK, sdkUserMessageId: lastWakeId,
      origin: 'prompt_api', requestedSource: 'session', routeAuthed: true, reasonCode: 'unrelated_prompt',
      requestedProviderId: 'provider', requestedModelId: 'model', resolvedProviderId: 'provider',
      resolvedModelId: 'model', finalProviderId: 'provider', finalModelId: 'model',
    });
    new ModelProvenanceRepository().setOutcome(conflictingDispatch.id, 'accepted', lastWakeId);
    const mixedAnchor = await startApproval(approvalId, proposalDigest);
    expect(await mixedAnchor.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    db.prepare('DELETE FROM agent_turn_dispatches WHERE id=?').run(conflictingDispatch.id);
    active = { userMessageId: 'foreign-native-message', toolName: 'rhythm_start_bounded_coding_workflow' };
    const foreignMessage = await startApproval(approvalId, proposalDigest);
    expect(await foreignMessage.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    active = { userMessageId: lastWakeId, toolName: 'rhythm_start_bounded_coding_workflow' };
    const altered = await startApproval(approvalId, '0'.repeat(64));
    expect(await altered.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    const started = await startApproval(approvalId, proposalDigest);
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ schemaVersion: 1, status: 'started' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeTruthy();
    const stored = repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId });
    expect(stored).toMatchObject({ kind: 'found', conversation: { continuations: [{ purpose: 'workflow', status: 'consumed', consumedTurns: 1, maxTurns: 2 }] } });
    const jobsBefore = getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get();
    const replay = await startApproval(approvalId, proposalDigest);
    expect(await replay.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeTruthy();
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual(jobsBefore);
  });

  it('chat-bounded-c3: reconnects an existing configured local Rhythm MCP before the exact approved workflow wake', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    mcpStatus = 'configured';
    await decideApproval(approvalId, proposalDigest);
    expect(sdkMcpConnect).toHaveBeenCalledTimes(1);
    expect(sdkMcpConnect).toHaveBeenCalledWith({ path: { name: 'rhythm' } });
    expect(mcpStatus).toBe('connected');
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'started' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeTruthy();
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 1 });
  });

  it('chat-bounded-c3: authority-write failure preserves consent and exact retry recovers only its own linked preparation', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    db.exec(`CREATE TRIGGER contract_fail_authority_write
      BEFORE UPDATE OF coordinator_conversation_json ON agent_sessions
      WHEN json_array_length(json_extract(NEW.coordinator_conversation_json, '$.continuations')) >
           json_array_length(json_extract(OLD.coordinator_conversation_json, '$.continuations'))
      BEGIN SELECT RAISE(ABORT, 'contract issuance failure'); END`);
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)).toMatchObject({ status: 'approved', consumedAt: null });
    const scopeProjectId = (getDb().prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id;
    const stored = repo.get({ ownerUserId: 1, projectId: scopeProjectId, sessionId: rootId });
    expect(stored).toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
    getDb().exec('DROP TRIGGER contract_fail_authority_write');
    const retried = await startApproval(approvalId, proposalDigest);
    expect(await retried.json()).toMatchObject({ schemaVersion: 1, status: 'started' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeTruthy();
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 1 });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_workstreams`).get()).toEqual({ n: 1 });
  });

  it('chat-bounded-c3: arbitrary linked workstream createKey cannot recover a failed proposal', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    db.exec(`CREATE TRIGGER contract_fail_authority_write
      BEFORE UPDATE OF coordinator_conversation_json ON agent_sessions
      WHEN json_array_length(json_extract(NEW.coordinator_conversation_json, '$.continuations')) >
           json_array_length(json_extract(OLD.coordinator_conversation_json, '$.continuations'))
      BEGIN SELECT RAISE(ABORT, 'contract issuance failure'); END`);
    const failed = await startApproval(approvalId, proposalDigest);
    expect(await failed.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    getDb().exec('DROP TRIGGER contract_fail_authority_write');
    const workstream = getDb().prepare('SELECT id FROM agent_workstreams LIMIT 1').get() as { id: string };
    getDb().prepare('UPDATE agent_workstreams SET create_key=? WHERE id=?')
      .run('conversation:workflow:forged-conversation:forged-goal', workstream.id);
    const retried = await startApproval(approvalId, proposalDigest);
    expect(await retried.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c3: unrelated extra control revision cannot recover a failed proposal', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    db.exec(`CREATE TRIGGER contract_fail_authority_write
      BEFORE UPDATE OF coordinator_conversation_json ON agent_sessions
      WHEN json_array_length(json_extract(NEW.coordinator_conversation_json, '$.continuations')) >
           json_array_length(json_extract(OLD.coordinator_conversation_json, '$.continuations'))
      BEGIN SELECT RAISE(ABORT, 'contract issuance failure'); END`);
    const failed = await startApproval(approvalId, proposalDigest);
    expect(await failed.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    getDb().exec('DROP TRIGGER contract_fail_authority_write');
    db.prepare(`UPDATE agent_sessions SET coordinator_conversation_json=json_set(coordinator_conversation_json,
      '$.controlRevision', json_extract(coordinator_conversation_json, '$.controlRevision') + 1) WHERE id=?`).run(rootId);
    const retried = await startApproval(approvalId, proposalDigest);
    expect(await retried.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c3: post-authority prepared-binding failure stays held with approval and ordinal conservatively consumed', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    failPreparedBind = true;
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeTruthy();
    const scopeProjectId = (getDb().prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id;
    const stored = repo.get({ ownerUserId: 1, projectId: scopeProjectId, sessionId: rootId });
    expect(stored).toMatchObject({ kind: 'found', conversation: { continuations: [{ purpose: 'workflow', consumedTurns: 1, maxTurns: 2 }] } });
    const jobsBefore = getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get();
    const replay = await startApproval(approvalId, proposalDigest);
    expect(await replay.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeTruthy();
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual(jobsBefore);
  });

  it('chat-bounded-c3: current source drift after signed approval cannot consume the proposal', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    await writeFile(path.join(memoryDir, 'notes', 'sunday-service-notes.md'), '---\nid: sunday-service-notes\nkind: context\ntags: [service]\ncreated: 2026-10-06\nupdated: 2026-10-06\nsource: fixture\nstatus: stable\n---\nThe source changed after approval.\n');
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c3: an expired signed proposal cannot consume approval or issue authority', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    const approval = new AgentApprovalsRepository().getById(approvalId)!;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(approval.expiresAt!) + 1);
    try {
      const response = await startApproval(approvalId, proposalDigest);
      expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    } finally { clock.mockRestore(); }
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
  });

  it('chat-bounded-c3: a configured but not connected local Rhythm MCP holds before consuming approval', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    mcpStatus = 'needs_auth';
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c3: final runtime loss after initial readiness holds without authority and never replays the delivered wake', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
    expect(new AgentApprovalsRepository().getById(approvalId)).toMatchObject({
      status: 'approved', continuationState: 'delivered', consumedAt: null,
    });

    // The route's first readiness probe consumes two genuine coordinator status
    // scans (restart reconciliation plus current readiness). The next scan is
    // the final reproof after preparation/source awaits, and now loses MCP.
    readinessMcpCalls = 0;
    unavailableAtReadinessCall = 3;
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)).toMatchObject({
      status: 'approved', continuationState: 'delivered', consumedAt: null,
    });
    const projectId = (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id;
    const conversation = repo.get({ ownerUserId: 1, projectId, sessionId: rootId });
    expect(conversation).toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    // The operation may have recorded its own pristine deterministic link
    // before final reproof; it must still have no finite authority or job.
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_workstreams`).get()).toEqual({ n: 1 });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });

    // Explicit startup and idle recovery over the real continuation service
    // do not replay an already delivered wake. Repeated start also does not
    // auto-refund/regrant consent while the runtime remains unavailable.
    const restartRecovery = new AgentApprovalContinuationService();
    await restartRecovery.recoverAfterRestart();
    await restartRecovery.onSessionIdle(rootId);
    const repeated = await startApproval(approvalId, proposalDigest);
    expect(await repeated.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c3: rejected signed decision cannot issue workflow authority or a job', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest, 'rejected');
    active = { userMessageId: 'native-workflow-wake-1', toolName: 'rhythm_start_bounded_coding_workflow' };
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c3: profile revision drift after signed approval cannot consume authority', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    db.prepare('UPDATE agent_configs SET revision=revision+1 WHERE id=?').run(PROFILE);
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
  });

  it('chat-bounded-c3: a settled unrelated delegation before the proposal does not block the bounded workflow', async () => {
    insertPriorDelegation('Prior unrelated child', new Date(NOW - 60_000).toISOString());
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'started' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeTruthy();
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 1 });
  });

  it('chat-bounded-c3: a new unrelated delegation after the proposal holds before authority issuance', async () => {
    const { approvalId, proposalDigest } = await proposeApproval();
    await decideApproval(approvalId, proposalDigest);
    insertPriorDelegation('Concurrent unrelated child', new Date().toISOString());
    const response = await startApproval(approvalId, proposalDigest);
    expect(await response.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(approvalId)?.consumedAt).toBeNull();
    expect(repo.get({ ownerUserId: 1, projectId: (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id, sessionId: rootId }))
      .toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get()).toEqual({ n: 0 });
  });

  it('chat-bounded-c2: real approval list hides another owner and malformed bounded cards but preserves ordinary approvals', async () => {
    const { approvalId } = await proposeApproval();
    const ordinary = new AgentApprovalsRepository().create({ sessionId: rootId, agentConfigId: PROFILE, action: 'Ordinary approval' });
    const malformed = new AgentApprovalsRepository().create({ sessionId: rootId, agentConfigId: PROFILE,
      action: 'Malformed bounded card', securityAction: 'coordinator.workflow.start', payloadDigest: 'bad-digest', boundPayloadJson: '{}' });
    const anotherUser = new UsersRepository().create({ name: 'Other Owner', email: `other-${Math.random()}@example.test` });
    const otherToken = (await new SessionsRepository().createAsync(anotherUser.id)).token;
    const response = await fetch(`${http.baseUrl}/agent-approvals?status=all`, {
      headers: { Authorization: `Bearer ${otherToken}`, ...humanCredentials.capabilityHeader },
    });
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<{ id: string; action: string; boundPayloadJson?: string }>;
    expect(rows.some(row => row.id === approvalId)).toBe(false);
    expect(rows.some(row => row.id === malformed.id)).toBe(false);
    expect(rows.some(row => row.id === ordinary.id && row.action === 'Ordinary approval')).toBe(true);
    expect(rows.every(row => !Object.hasOwn(row, 'boundPayloadJson'))).toBe(true);
  });

  it('chat-bounded-c5: an adjusted limit proposal supersedes the old digest and only its exact signed values fund authority', async () => {
    const outOfRange = await post('/coordinator-agent/propose-workflow', { trustedCall: signed('rhythm_propose_bounded_coding_workflow', {
      goalSelector: 'Prepare a concise cited Sunday service brief from the current notes.', referenceSelector: 'Sunday service notes',
      referenceSourceId: `memory:${memoryId}`, referenceVersion,
      estimate: { totalSoftTokens: 2_000_001, workerWallSeconds: 240, expirySeconds: 900, outerTurns: 2,
        rationale: 'This exceeds the service token cap.' },
    }) });
    expect(await outOfRange.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_approvals WHERE security_action='coordinator.workflow.start'`).get()).toEqual({ n: 0 });
    const pending = await proposeApproval();
    const pendingSnapshot = new AgentApprovalsRepository().getById(pending.approvalId)!;
    const revised = await proposeApproval({ totalSoftTokens: 18_000, workerWallSeconds: 240, expirySeconds: 900, outerTurns: 2,
      rationale: 'The human requested extra review time; the same two checked turns remain the stop condition.' });
    expect(revised.proposalDigest).not.toBe(pending.proposalDigest);
    expect(new AgentApprovalsRepository().getById(pending.approvalId)).toMatchObject({ status: 'rejected', payloadDigest: pendingSnapshot.payloadDigest,
      boundPayloadJson: pendingSnapshot.boundPayloadJson });
    await decideApproval(revised.approvalId, revised.proposalDigest);
    const approvedSnapshot = new AgentApprovalsRepository().getById(revised.approvalId)!;
    active = { userMessageId: 'native-foreground-proposal', toolName: 'rhythm_propose_bounded_coding_workflow' };
    const finalTerms = await proposeApproval({ totalSoftTokens: 21_000, workerWallSeconds: 250, expirySeconds: 900, outerTurns: 2,
      rationale: 'The human added a modest review allowance; execution still stops after the same two checked turns.' });
    expect(new AgentApprovalsRepository().getById(revised.approvalId)).toMatchObject({ status: 'approved', payloadDigest: approvedSnapshot.payloadDigest,
      boundPayloadJson: approvedSnapshot.boundPayloadJson, consumedAt: null });
    active = { userMessageId: lastWakeId, toolName: 'rhythm_start_bounded_coding_workflow' };
    const stale = await startApproval(revised.approvalId, revised.proposalDigest);
    expect(await stale.json()).toMatchObject({ schemaVersion: 1, status: 'held' });
    expect(new AgentApprovalsRepository().getById(revised.approvalId)?.consumedAt).toBeNull();
    await decideApproval(finalTerms.approvalId, finalTerms.proposalDigest);
    const started = await startApproval(finalTerms.approvalId, finalTerms.proposalDigest);
    expect(await started.json()).toMatchObject({ schemaVersion: 1, status: 'started' });
    const projectId = (db.prepare('SELECT project_id FROM agent_sessions WHERE id=?').get(rootId) as { project_id: string }).project_id;
    const stored = repo.get({ ownerUserId: 1, projectId, sessionId: rootId });
    expect(stored).toMatchObject({ kind: 'found', conversation: { continuations: [{ purpose: 'workflow', status: 'consumed', maxTurns: 2,
      totalTokenAuthorization: 21_000, maxWallTimeSeconds: 250 }] } });
    expect((stored as { kind: 'found'; conversation: { continuations: Array<{ expiresAt: string }> } })
      .conversation.continuations[0].expiresAt).toBe(new AgentApprovalsRepository().getById(finalTerms.approvalId)?.expiresAt);
  });

});
