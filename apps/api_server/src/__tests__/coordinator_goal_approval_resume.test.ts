/**
 * Approved coordinator-goal approval RESUME (plan 5f2a1684…).
 *
 * Real: the approval HTTP routes + signed human decision, the approval-wake
 * producer (AgentApprovalContinuationService), the real OpencodeClientService
 * promptAsync/provenance path, the bridge's native-user linkage call, the real
 * trusted-MCP verifier + signer, ExternalContentSecurityService, the real
 * CoordinatorForegroundMcpAuthority / ModelStatusService / ConversationService /
 * repository on a migrated SQLite. Stand-ins (the only ones): the SDK transport
 * (`session.promptAsync`, whose request is asserted), the engine's active-native-
 * tool inspection (`getCurrentTrustedMcpToolCall`), the stream bridge attach, and
 * the Coding Workflow child dispatcher (counted). No fabricated dispatch rows for
 * the resume positive and no direct resolveForeground success.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoordinatorContextRead } from '../contracts/coordinator_conversation_contract';
import type { AuthContext } from '../middleware/auth_middleware';

const { sdkPromptAsync, hooks } = vi.hoisted(() => ({
  sdkPromptAsync: vi.fn(),
  hooks: {} as { stream?: () => void; beforePrompt?: () => void; engine?: (call: number) => void },
}));

vi.mock('../services/opencode_engine', async () => {
  const { OpencodeClientService } = await vi.importActual<typeof import('../services/opencode_client_service')>(
    '../services/opencode_client_service',
  );
  const svc = new OpencodeClientService();
  (svc as unknown as { client: unknown }).client = { session: { promptAsync: sdkPromptAsync } };
  (svc as unknown as { status: string }).status = 'ready';
  (svc as unknown as { server: unknown }).server = { url: 'http://engine.test', close() {} };
  (svc as unknown as { listMessages: unknown }).listMessages = async () => [];
  return { opencodeClient: svc, opencodeSessionMap: new Map<string, string>() };
});
vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession: vi.fn(async () => { hooks.stream?.(); }) },
}));

import { createApp } from '../app';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { clearTrustedMcpVerifier, pinTrustedMcpPublicKey } from '../security/trusted_mcp_call';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { CoordinatorConversationModelStatusService } from '../services/coordinator_conversation_model_status_service';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';
import { ExternalContentSecurityService } from '../services/external_content_security_service';
import { opencodeClient, opencodeSessionMap } from '../services/opencode_engine';
import { startTestServer } from './helpers/real_server';
import {
  installHumanApprovalTestCredentials,
  signHumanApprovalDecision,
  type HumanApprovalTestCredentials,
} from './helpers/human_approval_test_credentials';
import { createTrustedMcpTestSigner } from './helpers/trusted_mcp_test_proof';

const PROJECT = 'project-resume';
const SDK = 'ses_root_resume';
const AGENT = 'secretary-agent';
const GOAL_TOOL = 'rhythm_start_coordinator_goal';
const ACTION = 'delegation.start-async';
const NOW = new Date('2026-10-06T12:00:00.000Z');
const NATIVE_WAKE = 'msg_native_wake_1';
const NATIVE_FG = 'msg_native_foreground_1';
const available = <T>(items: T[]): CoordinatorContextRead<T> => ({
  availability: 'available', reason: null, complete: true, authoritative: true,
  observedAt: NOW.toISOString(), sourceVersion: 'snapshot-1', items,
});
// Independent statement of the strict encoding: sha256(approval LF goal LF goalRevision), first 32 hex.
const resumeCode = (approvalId: string, goalId: string, revision: number) =>
  `goal_approval_resume_${createHash('sha256').update(`${approvalId}\n${goalId}\n${revision}`).digest('hex').slice(0, 32)}`;

describe('coordinator goal approval resume', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let headers: Record<string, string>;
  let credentials: HumanApprovalTestCredentials;
  let signer: ReturnType<typeof createTrustedMcpTestSigner>;
  let auth: AuthContext;
  let userId: number;
  let rootId: string;
  let goalId: string;
  let repo: CoordinatorConversationsRepository;
  let service: CoordinatorConversationService;
  let statusService: CoordinatorConversationModelStatusService;
  let dispatchChild: ReturnType<typeof vi.fn>;
  let access: { value: boolean };
  let profile: Record<string, unknown>;
  let active: { userMessageId: string; agent: string; tool: string };
  let engineCalls: number;
  let mint: { mode: 'ok' | 'null' | 'throw'; calls: number };
  let sequence = 0;
  const security = new ExternalContentSecurityService();
  const provenance = new ModelProvenanceRepository();

  const scope = () => ({ ownerUserId: userId, projectId: PROJECT, sessionId: rootId });
  const rootJson = () => (db.prepare('SELECT coordinator_conversation_json AS j FROM agent_sessions WHERE id=?').get(rootId) as { j: string }).j;
  const commands = () => {
    const read = repo.get(scope());
    return read.kind === 'found'
      ? read.conversation.commandDedupe.filter((command) => command.kind === 'delegate_goal')
      : [];
  };
  const approvals = new AgentApprovalsRepository();
  const dispatches = () => db.prepare('SELECT * FROM agent_turn_dispatches WHERE session_id=? ORDER BY rowid').all(rootId) as Array<Record<string, unknown>>;
  const consumedCount = () => (db.prepare('SELECT COUNT(*) AS n FROM agent_approvals WHERE consumed_at IS NOT NULL').get() as { n: number }).n;
  const ctx = (turnId: string, toolCallId: string, agentName = AGENT) => ({ sdkSessionId: SDK, turnId, agentName, toolCallId });

  function taint(turn = 'turn-read'): void {
    security.markTainted({
      context: ctx(turn, `call-${turn}`), source: 'calendar.events', contentDigest: 'a'.repeat(64), blocked: false, diagnostics: [],
    });
  }
  async function requestApproval(payload: Record<string, unknown> = { goalId }, action = ACTION) {
    const res = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST', headers,
      body: JSON.stringify({
        action: 'Start the captured goal', consequence: 'One Coding Workflow child starts.',
        security: { context: ctx('turn-request', 'call-request'), action, payload },
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; decisionNonce: string; payloadDigest: string };
  }
  async function decide(approval: { id: string; decisionNonce: string; payloadDigest: string }, status: 'approved' | 'rejected' = 'approved') {
    const res = await fetch(`${baseUrl}/agent-approvals/${approval.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status, signature: signHumanApprovalDecision(credentials, approval, status) }),
    });
    expect(res.status).toBe(200);
  }
  /** Real wake: the approval decision drives the real producer + real client. */
  async function approvedWake(payload: Record<string, unknown> = { goalId }, action = ACTION) {
    sdkPromptAsync.mockClear();
    const approval = await requestApproval(payload, action);
    await decide(approval);
    return approval;
  }
  const linkWake = (messageId = NATIVE_WAKE) => provenance.linkOldestUserMessage(rootId, SDK, messageId);
  function foregroundDispatch(messageId = NATIVE_FG): void {
    const row = provenance.insert({
      sessionId: rootId, sdkSessionId: SDK, origin: 'prompt_api', requestedSource: 'session', routeAuthed: true,
      reasonCode: 'c2_foreground', requestedProviderId: 'provider', requestedModelId: 'model',
      resolvedProviderId: 'provider', resolvedModelId: 'model', finalProviderId: 'provider', finalModelId: 'model',
    });
    provenance.setOutcome(row.id, 'accepted', messageId);
  }
  async function startGoal(opts: {
    goalId?: string; approvalId?: string | null; tool?: string; extra?: Record<string, unknown>;
    turn?: string; call?: string; agent?: string; issuedAt?: number; envelope?: unknown;
  } = {}) {
    sequence += 1;
    const turn = opts.turn ?? `turn-act-${sequence}`;
    const call = opts.call ?? `call-act-${sequence}`;
    const args: Record<string, unknown> = {
      goalId: opts.goalId ?? goalId,
      ...(opts.approvalId ? { approval_id: opts.approvalId } : {}),
      ...(opts.extra ?? {}),
    };
    const envelope = opts.envelope ?? signer.signCall(ctx(turn, call, opts.agent ?? AGENT), opts.tool ?? GOAL_TOOL, args, opts.issuedAt);
    return statusService.startGoal(auth, { trustedCall: envelope });
  }

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    db.pragma('foreign_keys = OFF');
    setDb(db);
    sdkPromptAsync.mockReset().mockResolvedValue({ response: { status: 204 } });
    hooks.stream = undefined; hooks.beforePrompt = undefined; hooks.engine = undefined;
    sequence = 0; engineCalls = 0;
    access = { value: true };
    active = { userMessageId: NATIVE_WAKE, agent: AGENT, tool: GOAL_TOOL };
    const user = new UsersRepository().create({ name: 'Resume Owner', email: 'resume-owner@example.com' });
    userId = user.id;
    auth = { sessionToken: 'resume-auth', user: { id: user.id } } as AuthContext;
    const authSession = await new SessionsRepository().createAsync(user.id);
    credentials = installHumanApprovalTestCredentials();
    signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    headers = { Authorization: `Bearer ${authSession.token}`, ...credentials.capabilityHeader, 'Content-Type': 'application/json' };

    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent)
      VALUES ('librarian', 'Synthetic profile', 'x', 'synthetic', 1, 1)`).run();
    new AgentSessionsRepository().insert({ agentKind: 'librarian', taskId: null, cwd: '/tmp', name: 'root', profileId: 'librarian' } as never);
    rootId = (db.prepare('SELECT id FROM agent_sessions ORDER BY rowid DESC LIMIT 1').get() as { id: string }).id;
    db.prepare(`UPDATE agent_sessions SET owner_user_id=?, project_id=?, status='idle', permission_mode='plan', model_mode='auto' WHERE id=?`).run(userId, PROJECT, rootId);
    new AgentSessionsRepository().setSdkSessionId(rootId, SDK);
    opencodeSessionMap.set(rootId, SDK);
    db.prepare(`UPDATE agent_sessions SET status='idle' WHERE id=?`).run(rootId);

    repo = new CoordinatorConversationsRepository(db, () => NOW);
    expect(repo.designatePrimaryOwnerRoot(scope()).kind).toBe('found');
    const added = repo.addGoal({ ...scope(), expectedControlRevision: 1, commandKey: 'goal-1', objective: 'Fix the login bug' });
    goalId = (added as { goal: { id: string } }).goal.id;

    const assembler = new CoordinatorConversationContextAssembler({
      tasks: { read: async () => available([]) }, schedules: { read: async () => available([]) },
      rhythms: { read: async () => available([]) }, workstreams: { read: async () => available([]) },
      receipts: { read: async () => available([]) },
    });
    profile = { id: 'librarian', enabled: true, isAgent: true, locked: false, modelProvider: 'provider', modelId: 'model', revision: 1 };
    dispatchChild = vi.fn(async () => ({ targetAgentConfigId: 'workflow-orchestrator', delegationId: 'dg-1', childSessionId: 'child-1' }));
    service = new CoordinatorConversationService({
      repository: repo,
      context: { assemble: async (input: Parameters<typeof assembler.assemble>[0]) => assembler.assemble(input) } as never,
      sessions: new AgentSessionsRepository(),
      configs: { getById: () => profile, listEnabled: () => [profile] } as never,
      projects: { findById: () => ({ id: PROJECT, archivedAt: null }) } as never,
      projectAccess: { canAccess: () => access.value, canOwnerAccess: () => access.value },
      codingWorkflow: { dispatch: dispatchChild },
      enabled: () => true,
      now: () => NOW,
    } as never);
    const engine = {
      getCurrentTrustedMcpToolCall: async (sdk: string, assistantId: string, toolCallId: string) => {
        engineCalls += 1;
        hooks.engine?.(engineCalls);
        return {
          sdkSessionId: sdk, assistantId, userMessageId: active.userMessageId, partId: 'part-1', toolCallId,
          toolKey: active.tool, agentName: active.agent, serverName: 'rhythm', toolName: active.tool,
        };
      },
    };
    statusService = new CoordinatorConversationModelStatusService({ conversations: service, records: repo, engine } as never);

    // Engine stand-in for the fork-generated native user-message anchor.
    mint = { mode: 'ok', calls: 0 };
    (opencodeClient as unknown as { mintPromptAnchor: unknown }).mintPromptAnchor = async () => {
      mint.calls += 1;
      if (mint.mode === 'throw') throw new Error('engine unavailable');
      return mint.mode === 'null' ? null : NATIVE_WAKE;
    };
    // Observe the request at the await boundary just before the client's own checks.
    const original = opencodeClient.promptAsync.bind(opencodeClient);
    vi.spyOn(opencodeClient, 'promptAsync').mockImplementation(async (...args: Parameters<typeof original>) => {
      hooks.beforePrompt?.();
      return original(...args);
    });
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    clearTrustedMcpVerifier();
    (opencodeClient as unknown as { setDayflowSdkHistoryGuard(g: unknown): void }).setDayflowSdkHistoryGuard(null);
    await closeServer();
    opencodeSessionMap.clear();
    vi.restoreAllMocks();
  });

  describe('producer: the real approval wake', () => {
    it('an approved exact goal approval wakes the root once with the strict resume provenance and server-derived ids', async () => {
      taint();
      const approval = await approvedWake();
      expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
      const body = (sdkPromptAsync.mock.calls[0][0] as { body: { parts: Array<{ text: string }> } }).body;
      const text = body.parts[0].text;
      expect(text).toContain(`approval_id: ${approval.id}`);
      expect(text).toContain(`goal_id: ${goalId}`);
      expect(text).toMatch(/retry[^.\n]*exactly once/i);
      expect(text).not.toContain('Fix the login bug');
      expect(dispatches()).toEqual([expect.objectContaining({
        origin: 'approval_continuation', requested_source: 'agent_config', route_authed: null,
        reason_code: resumeCode(
          approval.id, goalId,
          (repo.get(scope()) as { conversation: { goals: Array<{ id: string; revision: number }> } })
            .conversation.goals.find((goal) => goal.id === goalId)!.revision,
        ),
        outcome: 'accepted',
      })]);
      expect(approvals.getById(approval.id)).toMatchObject({ continuationState: 'delivered' });
    });

    it('never claims foreground provenance or the child-callback marker', async () => {
      taint();
      await approvedWake();
      const [row] = dispatches();
      expect(row.reason_code).not.toBe('c2_foreground');
      expect(String(row.reason_code)).not.toMatch(/^c2_goal_callback/);
      expect(row.route_authed).toBeNull();
    });

    it.each([
      ['a generic delegation payload', () => approvedWake({ target: 'someone', sequence: 1 })],
      ['another action with a goal-shaped payload', () => approvedWake({ goalId }, 'task.create')],
      ['a goal id that is not captured on this root', () => approvedWake({ goalId: 'not-a-goal' })],
    ])('%s keeps the ordinary wake with no resume code', async (_name, run) => {
      taint();
      await run();
      expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
      const text = (sdkPromptAsync.mock.calls[0][0] as { body: { parts: Array<{ text: string }> } }).body.parts[0].text;
      expect(text).toContain('Retry the identical protected action exactly once');
      expect(text).not.toContain('goal_id:');
      expect(dispatches()[0]).toMatchObject({ origin: 'approval_continuation', reason_code: null });
    });

    it('a rejected goal approval gets only the ordinary rejection wake', async () => {
      taint();
      const approval = await requestApproval();
      sdkPromptAsync.mockClear();
      await decide(approval, 'rejected');
      const text = (sdkPromptAsync.mock.calls[0][0] as { body: { parts: Array<{ text: string }> } }).body.parts[0].text;
      expect(text).toMatch(/rejected/i);
      expect(text).not.toContain('goal_id:');
      expect(dispatches()[0]).toMatchObject({ reason_code: null });
    });

    it('an expired, consumed or stale-taint approval is not qualified', async () => {
      taint();
      const stale = await requestApproval();
      taint('turn-read-two'); // a newer taint makes the stale approval's binding obsolete
      sdkPromptAsync.mockClear();
      await decide(stale);
      expect((sdkPromptAsync.mock.calls[0][0] as { body: { parts: Array<{ text: string }> } }).body.parts[0].text).not.toContain('goal_id:');
      expect(dispatches()[0]).toMatchObject({ reason_code: null });
    });

    it('is withheld when the root drifts between qualification and exposure (nothing is sent)', async () => {
      taint();
      const approval = await requestApproval();
      sdkPromptAsync.mockClear();
      // The client call boundary: after the producer qualified, before its own freshness hook.
      hooks.beforePrompt = () => { taint('turn-read-late'); };
      await decide(approval);
      expect(sdkPromptAsync).not.toHaveBeenCalled();
      expect(approvals.getById(approval.id)).toMatchObject({ continuationState: 'queued', consumedAt: null });
      expect(dispatches().filter((row) => row.outcome === 'accepted')).toEqual([]);
    });
  });

  describe('consumer: action-bound resume authority', () => {
    it('pre-fix cause: the real foreground resolver rejects the approval-origin wake message', async () => {
      taint();
      await approvedWake();
      const verified = signer.signCall(ctx('turn-x', 'call-x'), GOAL_TOOL, { goalId });
      const { CoordinatorForegroundMcpAuthority } = await import('../services/coordinator_foreground_mcp_authority');
      const { verifyTrustedMcpCall } = await import('../security/trusted_mcp_call');
      const authority = new CoordinatorForegroundMcpAuthority({
        engine: { getCurrentTrustedMcpToolCall: async (sdk: string, assistantId: string, toolCallId: string) => ({
          sdkSessionId: sdk, assistantId, userMessageId: NATIVE_WAKE, partId: 'p', toolCallId, toolKey: GOAL_TOOL,
          agentName: AGENT, serverName: 'rhythm', toolName: GOAL_TOOL,
        }) } as never,
        records: repo,
      });
      const proof = await verifyTrustedMcpCall(verified, GOAL_TOOL, Date.now(), 'coordinator_agent_goal');
      expect(await authority.resolveForeground(auth, proof, GOAL_TOOL)).toBeNull();
    });

    it('exact approved resume starts exactly one child and consumes the token once', async () => {
      taint();
      const approval = await approvedWake();
      const result = await startGoal({ approvalId: approval.id, turn: 'turn-act', call: 'call-act' });
      expect(result).toMatchObject({ status: 'started' });
      expect(dispatchChild).toHaveBeenCalledTimes(1);
      expect(approvals.getById(approval.id)?.consumedAt).not.toBeNull();
      expect(commands()).toEqual([expect.objectContaining({ kind: 'delegate_goal', goalId, state: 'dispatched', childSessionId: 'child-1' })]);
      // the SAME native call replays to the same result without a second child or consumption
      const replay = await startGoal({ approvalId: approval.id, turn: 'turn-act', call: 'call-act' });
      expect(replay).toMatchObject({ status: 'started' });
      expect(dispatchChild).toHaveBeenCalledTimes(1);
      expect(consumedCount()).toBe(1);
      // a NEW native call with the already-consumed token cannot start a second child
      const again = await startGoal({ approvalId: approval.id });
      expect(again.status).not.toBe('started');
      expect(dispatchChild).toHaveBeenCalledTimes(1);
    });

    it('a wrong active binding consumes no token', async () => {
      taint();
      const approval = await approvedWake();
      const before = rootJson();
      active.userMessageId = 'msg_native_other'; // not the accepted approval-origin user message
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'unavailable' });
      active.userMessageId = NATIVE_WAKE;
      active.agent = 'someone-else';
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'unavailable' });
      active.agent = AGENT;
      active.tool = 'rhythm_delegate_async';
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'unavailable' });
      expect(consumedCount()).toBe(0);
      expect(rootJson()).toBe(before);
      expect(dispatchChild).not.toHaveBeenCalled();
    });

    it('an active native message that is not the wake request\'s own anchored id is a hold with nothing consumed', async () => {
      taint();
      const approval = await approvedWake();
      // The anchor is durable at request time (no bridge linkage involved); any other native message is foreign.
      active.userMessageId = 'msg_native_unanchored';
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'unavailable' });
      expect(consumedCount()).toBe(0);
      expect(dispatchChild).not.toHaveBeenCalled();
    });

    it.each([
      ['a different approval id', async (approval: { id: string }) => ({ approvalId: (await requestApproval({ goalId })).id })],
      ['an unknown approval id', async () => ({ approvalId: 'approval-unknown' })],
      ['no signed approval id', async () => ({ approvalId: null })],
      ['a different goal id', async (approval: { id: string }) => ({ approvalId: approval.id, goalId: 'other-goal' })],
      ['extra signed fields', async (approval: { id: string }) => ({ approvalId: approval.id, extra: { cwd: '/etc' } })],
    ])('refuses %s with nothing consumed or reserved', async (_name, build) => {
      taint();
      const approval = await approvedWake();
      const before = rootJson();
      const result = await startGoal(await build(approval));
      expect(result.status).not.toBe('started');
      expect(consumedCount()).toBe(0);
      expect(rootJson()).toBe(before);
      expect(dispatchChild).not.toHaveBeenCalled();
    });

    it('rejects a wrong signed tool, altered/expired proofs and a replayed nonce', async () => {
      taint();
      const approval = await approvedWake();
      expect(await startGoal({ approvalId: approval.id, tool: 'rhythm_delegate_async' })).toMatchObject({ status: 'unavailable' });
      expect(await startGoal({ approvalId: approval.id, issuedAt: Date.now() - 60 * 60 * 1000 })).toMatchObject({ status: 'unavailable' });
      const tampered = signer.signCall(ctx('turn-t', 'call-t'), GOAL_TOOL, { goalId, approval_id: approval.id });
      (tampered.proof as { signature: string }).signature = `${tampered.proof.signature[0] === 'A' ? 'B' : 'A'}${tampered.proof.signature.slice(1)}`;
      expect(await startGoal({ envelope: tampered })).toMatchObject({ status: 'unavailable' });
      const envelope = signer.signCall(ctx('turn-r', 'call-r'), GOAL_TOOL, { goalId, approval_id: approval.id });
      expect(await startGoal({ envelope })).toMatchObject({ status: 'started' });
      expect(await startGoal({ envelope })).toMatchObject({ status: 'unavailable' });
      expect(dispatchChild).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a rejected decision', (id: string) => db.prepare(`UPDATE agent_approvals SET status='rejected' WHERE id=?`).run(id)],
      ['an expired approval', (id: string) => db.prepare(`UPDATE agent_approvals SET expires_at=? WHERE id=?`).run(new Date(Date.now() - 1000).toISOString(), id)],
      ['a different decider', (id: string) => db.prepare(`UPDATE agent_approvals SET actor='user:99999' WHERE id=?`).run(id)],
      ['a different action', (id: string) => db.prepare(`UPDATE agent_approvals SET security_action='task.create' WHERE id=?`).run(id)],
      ['a different digest', (id: string) => db.prepare(`UPDATE agent_approvals SET payload_digest=? WHERE id=?`).run('b'.repeat(64), id)],
      ['a different bound agent', (id: string) => db.prepare(`UPDATE agent_approvals SET bound_agent='other-agent' WHERE id=?`).run(id)],
      ['an already consumed token', (id: string) => db.prepare(`UPDATE agent_approvals SET consumed_at=? WHERE id=?`).run(new Date().toISOString(), id)],
    ])('refuses %s without a child or reservation', async (_name, mutate) => {
      taint();
      const approval = await approvedWake();
      mutate(approval.id);
      const before = rootJson();
      const result = await startGoal({ approvalId: approval.id });
      expect(result.status).not.toBe('started');
      expect(rootJson()).toBe(before);
      expect(dispatchChild).not.toHaveBeenCalled();
    });

    it('a changed external-content taint (after the approval) withholds the resume and burns nothing', async () => {
      taint();
      const approval = await approvedWake();
      taint('turn-read-newer');
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'unavailable' });
      expect(consumedCount()).toBe(0);
      expect(dispatchChild).not.toHaveBeenCalled();
    });

    it.each([
      ['project access revoked', () => { access.value = false; }],
      ['root archived', () => { db.prepare('UPDATE agent_sessions SET archived_at=? WHERE id=?').run(NOW.toISOString(), rootId); }],
      ['profile disabled', () => { profile.enabled = false; }],
      ['permission mode moved to bypass without the explicit marker', () => { db.prepare(`UPDATE agent_sessions SET permission_mode='bypassPermissions' WHERE id=?`).run(rootId); }],
      ['SDK binding replaced', () => { db.prepare(`UPDATE agent_sessions SET sdk_session_id='ses_replaced' WHERE id=?`).run(rootId); }],
      ['goal link changed', () => { db.prepare(`UPDATE agent_sessions SET coordinator_conversation_json=json_set(coordinator_conversation_json, '$.goals[0].revision', 99) WHERE id=?`).run(rootId); }],
      ['taint replaced', () => { taint('turn-read-race'); }],
    ])('drift during the consumer awaits (%s) holds with no token burned', async (_name, drift) => {
      taint();
      const approval = await approvedWake();
      hooks.engine = (call) => { if (call === 1) drift(); };
      const result = await startGoal({ approvalId: approval.id });
      expect(result.status).not.toBe('started');
      expect(consumedCount()).toBe(0);
      expect(dispatchChild).not.toHaveBeenCalled();
      expect(commands()).toEqual([]);
    });
  });

  describe('coupled reservation + consumption', () => {
    it('an authorization refusal rolls the goal reservation back with the consumption (clean foreground without a token)', async () => {
      taint(); // tainted session, no approval token: the existing gate must refuse
      foregroundDispatch();
      active.userMessageId = NATIVE_FG;
      const before = rootJson();
      const result = await startGoal();
      expect(result.status).toBe('held');
      expect(result.text).toContain(ACTION);
      expect(result.text).toContain(JSON.stringify({ goalId }));
      expect(rootJson()).toBe(before);
      expect(commands()).toEqual([]);
      expect(dispatchChild).not.toHaveBeenCalled();
      // the goal is not poisoned: after a human approval it can still be started once
      const approval = await requestApproval();
      await decide(approval);
      const started = await startGoal({ approvalId: approval.id });
      expect(started.status).toBe('started');
      expect(dispatchChild).toHaveBeenCalledTimes(1);
    });

    it('a consume refusal inside the transaction (injected) leaves the approval unconsumed and the goal reservable', async () => {
      taint();
      const approval = await approvedWake();
      const consume = vi.spyOn(ExternalContentSecurityService.prototype, 'consumeApproval').mockImplementationOnce(() => {
        throw new Error('injected refusal');
      });
      const before = rootJson();
      expect((await startGoal({ approvalId: approval.id })).status).not.toBe('started');
      expect(consume).toHaveBeenCalledTimes(1);
      expect(rootJson()).toBe(before);
      expect(consumedCount()).toBe(0);
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'started' });
      expect(dispatchChild).toHaveBeenCalledTimes(1);
    });

    it('clean foreground (no taint) still starts the goal with no token', async () => {
      foregroundDispatch();
      active.userMessageId = NATIVE_FG;
      expect(await startGoal()).toMatchObject({ status: 'started' });
      expect(dispatchChild).toHaveBeenCalledTimes(1);
      expect(consumedCount()).toBe(0);
    });

    it('a consumed token with an uncertain dispatch stays a durable hold: no refund, reset or second child', async () => {
      taint();
      const approval = await approvedWake();
      dispatchChild.mockRejectedValueOnce(new Error('child boundary unknown'));
      expect((await startGoal({ approvalId: approval.id, turn: 'turn-u', call: 'call-u' })).status).toBe('held');
      expect(approvals.getById(approval.id)?.consumedAt).not.toBeNull();
      expect(commands()).toEqual([expect.objectContaining({ kind: 'delegate_goal', state: 'uncertain' })]);
      // same call replay, and a fresh call with the consumed token: held / unavailable, never a second child
      expect((await startGoal({ approvalId: approval.id, turn: 'turn-u', call: 'call-u' })).status).toBe('held');
      expect((await startGoal({ approvalId: approval.id })).status).not.toBe('started');
      expect(dispatchChild).toHaveBeenCalledTimes(1);
      expect(consumedCount()).toBe(1);
      expect(commands()).toHaveLength(1);
    });

    it('post-consume currency accepts only its own receipt: another consumed approval cannot stand in', async () => {
      taint();
      const first = await approvedWake();
      const second = await requestApproval();
      await decide(second);
      // consume `second` out of band, as another consumer would
      db.prepare('UPDATE agent_approvals SET consumed_at=? WHERE id=?').run(new Date().toISOString(), second.id);
      expect(await startGoal({ approvalId: second.id })).toMatchObject({ status: 'unavailable' });
      expect(approvals.getById(first.id)?.consumedAt).toBeNull();
      expect(dispatchChild).not.toHaveBeenCalled();
    });
  });

  describe('boundaries that must not widen', () => {
    it('the obsolete goal-only consume route fails closed and burns nothing', async () => {
      taint();
      const approval = await approvedWake();
      const payload = { goalId };
      const envelope = signer.signCall(ctx('turn-old', 'call-old', AGENT), GOAL_TOOL, { goalId, approval_id: approval.id });
      const res = await fetch(`${baseUrl}/agent-approvals/consume`, {
        method: 'POST', headers,
        body: JSON.stringify({ trustedCall: envelope, context: ctx('turn-old', 'call-old'), approvalId: approval.id, action: ACTION, payload }),
      });
      expect(res.status).toBe(403);
      expect(consumedCount()).toBe(0);
    });

    it('the resume wake binding is status-tool and callback inert: the status tool cannot use it', async () => {
      taint();
      await approvedWake();
      active.tool = 'rhythm_get_coordinator_status';
      const status = await statusService.status(auth, {
        trustedCall: signer.signCall(ctx('turn-s', 'call-s'), 'rhythm_get_coordinator_status', {}),
      });
      expect(status).toMatchObject({ status: 'unavailable' });
    });

    it('a generic non-goal approval still works through the generic consume route', async () => {
      taint();
      const payload = { target: 'someone', sequence: 1 };
      const approval = await requestApproval(payload);
      await decide(approval);
      const envelope = signer.signCall(ctx('turn-g', 'call-g'), 'rhythm_delegate_async', payload);
      const res = await fetch(`${baseUrl}/agent-approvals/consume`, {
        method: 'POST', headers,
        body: JSON.stringify({ trustedCall: envelope, context: ctx('turn-g', 'call-g'), approvalId: approval.id, action: ACTION, payload }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ allowed: true, consumed: true });
    });
  });

  // ── Native-anchor follow-on (Astra review 8556b470…): the REAL client mints the
  // request's message id, persists the exact dispatch row with it BEFORE SDK
  // exposure, puts the SAME id in the actual SDK body, and re-validates the
  // producer fingerprint synchronously after its last awaited guard. The only
  // stand-ins are the SDK transport and the engine's mint (`mintPromptAnchor`).
  describe('native anchor: the actual SDK request carries the durable resume message id', () => {
    const resumeRows = () => dispatches().filter((row) => String(row.reason_code ?? '').startsWith('goal_approval_resume_'));
    const requestBody = () => (sdkPromptAsync.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    function installGuard(onRevalidate: () => void | Promise<void>): void {
      // A real existing history guard made reachable by a real nonreuse marker on the root.
      db.prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_receiving_context_changed',
        dayflow_context_nonreuse_at=? WHERE id=?`).run(NOW.toISOString(), rootId);
      (opencodeClient as unknown as { setDayflowSdkHistoryGuard(g: unknown): void }).setDayflowSdkHistoryGuard({
        shouldBindPrompt: async () => false,
        revalidateBeforeSdk: async () => { await new Promise((r) => setTimeout(r, 15)); await onRevalidate(); return true; },
      });
    }

    it('body.messageID equals the durable resume dispatch id, independent of an older unlinked generic row and event order', async () => {
      taint();
      // An OLDER eligible generic dispatch with no native id yet (what the oldest-unlinked heuristic would pick).
      provenance.insert({ sessionId: rootId, sdkSessionId: SDK, origin: 'ws_input', requestedSource: 'session' });
      const approval = await approvedWake();
      expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
      const [row] = resumeRows();
      expect(row).toMatchObject({ origin: 'approval_continuation', route_authed: null, outcome: 'accepted' });
      expect(row.sdk_user_message_id).toBe(NATIVE_WAKE);
      expect(requestBody().messageID).toBe(row.sdk_user_message_id);
      // Adversarial late linkage: the bridge's heuristic may attach another id to the OLDER row;
      // it can neither steal nor rewrite the resume row.
      linkWake('msg_native_heuristic');
      expect(resumeRows()[0].sdk_user_message_id).toBe(NATIVE_WAKE);
      active.userMessageId = 'msg_native_heuristic';
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'unavailable' });
      expect(consumedCount()).toBe(0);
      active.userMessageId = NATIVE_WAKE;
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'started' });
      expect(dispatchChild).toHaveBeenCalledTimes(1);
    });

    it('the resume authority needs no late linkage: no linkOldestUserMessage call is made or required', async () => {
      taint();
      const approval = await approvedWake();
      const link = vi.spyOn(ModelProvenanceRepository.prototype, 'linkOldestUserMessage');
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'started' });
      expect(link).not.toHaveBeenCalled();
    });

    it.each([
      ['approval expired', (id: string) => db.prepare(`UPDATE agent_approvals SET expires_at=? WHERE id=?`).run(new Date(Date.now() - 1000).toISOString(), id)],
      ['approval consumed elsewhere', (id: string) => db.prepare(`UPDATE agent_approvals SET consumed_at=? WHERE id=?`).run(new Date().toISOString(), id)],
      ['taint replaced', () => taint('turn-read-late')],
      ['root archived', () => db.prepare('UPDATE agent_sessions SET archived_at=? WHERE id=?').run(NOW.toISOString(), rootId)],
      ['profile changed', () => db.prepare(`UPDATE agent_sessions SET profile_id='other-profile' WHERE id=?`).run(rootId)],
      ['goal revised', () => db.prepare(`UPDATE agent_sessions SET coordinator_conversation_json=json_set(coordinator_conversation_json, '$.goals[0].revision', 99) WHERE id=?`).run(rootId)],
      ['current SDK replaced', () => db.prepare(`UPDATE agent_sessions SET sdk_session_id='ses_replaced' WHERE id=?`).run(rootId)],
    ])('a delayed history guard with the %s mutation invokes the SDK ZERO times and yields no resume authority', async (_name, mutate) => {
      taint();
      const approval = await requestApproval();
      sdkPromptAsync.mockClear();
      installGuard(() => { mutate(approval.id); });
      await decide(approval);
      expect(sdkPromptAsync).not.toHaveBeenCalled();
      expect(resumeRows().filter((row) => row.outcome === 'accepted')).toEqual([]);
      active.userMessageId = NATIVE_WAKE;
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'unavailable' });
      expect(dispatchChild).not.toHaveBeenCalled();
    });

    it('a guard that does NOT mutate lets the delayed resume through with the same anchor', async () => {
      taint();
      installGuard(() => undefined);
      const approval = await approvedWake();
      expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
      expect(requestBody().messageID).toBe(NATIVE_WAKE);
      expect(resumeRows()[0]).toMatchObject({ sdk_user_message_id: NATIVE_WAKE, outcome: 'accepted' });
      expect(await startGoal({ approvalId: approval.id })).toMatchObject({ status: 'started' });
    });

    it('a mint that returns nothing or throws refuses exposure and leaves the continuation queued', async () => {
      taint();
      for (const mode of ['null', 'throw'] as const) {
        mint.mode = mode;
        const approval = await requestApproval();
        sdkPromptAsync.mockClear();
        await decide(approval);
        expect(sdkPromptAsync).not.toHaveBeenCalled();
        expect(resumeRows().filter((row) => row.outcome === 'accepted')).toEqual([]);
        expect(approvals.getById(approval.id)).toMatchObject({ continuationState: 'queued', consumedAt: null });
        db.prepare(`UPDATE agent_approvals SET status='rejected' WHERE id=?`).run(approval.id); // clear the queue
        db.prepare(`UPDATE agent_approvals SET continuation_state='delivered' WHERE id=?`).run(approval.id);
      }
    });

    it('a failed exact-row persistence refuses exposure', async () => {
      taint();
      const approval = await requestApproval();
      sdkPromptAsync.mockClear();
      vi.spyOn(ModelProvenanceRepository.prototype, 'insert').mockImplementation(() => { throw new Error('disk full'); });
      await decide(approval);
      expect(sdkPromptAsync).not.toHaveBeenCalled();
      expect(approvals.getById(approval.id)).toMatchObject({ continuationState: 'queued', consumedAt: null });
    });

    describe('typed client context is strict (real OpencodeClientService.promptAsync)', () => {
      const code = `goal_approval_resume_${'a'.repeat(32)}`;
      const prov = (over: Record<string, unknown> = {}) => ({
        sessionId: rootId, sdkSessionId: SDK, origin: 'approval_continuation', requestedSource: 'agent_config',
        routeAuthed: null, reasonCode: code, ...over,
      });
      const ctx = (over: Record<string, unknown> = {}) => ({ kind: 'coordinator_goal_approval_resume_v1', validate: () => true, ...over });
      const call = (provenanceArg: unknown, context: unknown, extra: unknown[] = []) =>
        (opencodeClient as unknown as { promptAsync: (...a: unknown[]) => Promise<boolean> }).promptAsync(
          SDK, 'wake', undefined, '/tmp', {}, undefined, undefined, provenanceArg, extra[0], extra[1], extra[2], context,
        );

      it('accepts only the exact typed qualification', async () => {
        sdkPromptAsync.mockClear();
        expect(await call(prov(), ctx())).toBe(true);
        expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
        expect((sdkPromptAsync.mock.calls[0][0] as { body: { messageID: string } }).body.messageID).toBe(NATIVE_WAKE);
      });

      it.each([
        ['a wrong kind', prov(), ctx({ kind: 'coordinator_foreground_v1' })],
        ['a non-function validator', prov(), ctx({ validate: 'yes' })],
        ['foreground provenance', prov({ origin: 'prompt_api', requestedSource: 'session', routeAuthed: true, reasonCode: 'c2_foreground' }), ctx()],
        ['the child-callback origin/marker', prov({ origin: 'delegation_completion', reasonCode: 'c2_goal_callback:dg-1' }), ctx()],
        ['a route-authenticated approval wake', prov({ routeAuthed: true }), ctx()],
        ['a different source', prov({ requestedSource: 'session' }), ctx()],
        ['an arbitrary reason code', prov({ reasonCode: 'something_else' }), ctx()],
        ['a malformed resume code', prov({ reasonCode: 'goal_approval_resume_xyz' }), ctx()],
        ['no reason code', prov({ reasonCode: null }), ctx()],
        ['a different SDK session', prov({ sdkSessionId: 'ses_other' }), ctx()],
        ['no provenance', undefined, ctx()],
      ])('refuses %s without any SDK call or dispatch row', async (_name, provenanceArg, context) => {
        sdkPromptAsync.mockClear();
        const before = dispatches().length;
        expect(await call(provenanceArg, context)).toBe(false);
        expect(sdkPromptAsync).not.toHaveBeenCalled();
        expect(dispatches()).toHaveLength(before);
      });

      it('cannot be combined with managed, foreground or callback contexts', async () => {
        sdkPromptAsync.mockClear();
        for (const [slot, value] of [[0, {}], [1, { kind: 'coordinator_foreground_v1' }], [2, { kind: 'coordinator_callback_v1', validate: () => true }]] as const) {
          const extra: unknown[] = [undefined, undefined, undefined];
          extra[slot] = value;
          expect(await call(prov(), ctx(), extra)).toBe(false);
        }
        expect(sdkPromptAsync).not.toHaveBeenCalled();
      });

      it('a validator that fails at any check refuses the call, and a throwing validator is a refusal', async () => {
        sdkPromptAsync.mockClear();
        expect(await call(prov(), ctx({ validate: () => false }))).toBe(false);
        expect(await call(prov(), ctx({ validate: () => { throw new Error('boom'); } }))).toBe(false);
        expect(sdkPromptAsync).not.toHaveBeenCalled();
      });

      it('unrelated ordinary promptAsync calls are unchanged: no mint, no messageID', async () => {
        sdkPromptAsync.mockClear();
        const before = mint.calls;
        const ok = await (opencodeClient as unknown as { promptAsync: (...a: unknown[]) => Promise<boolean> })
          .promptAsync(SDK, 'plain', undefined, '/tmp', {}, undefined, undefined, prov({ origin: 'ws_input', requestedSource: 'session', reasonCode: null }));
        expect(ok).toBe(true);
        expect(mint.calls).toBe(before);
        expect(requestBody()).not.toHaveProperty('messageID');
      });
    });

    it('a generic approval wake keeps the ordinary request: no mint, no messageID, no resume code', async () => {
      taint();
      const before = mint.calls;
      await approvedWake({ target: 'someone', sequence: 1 });
      expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
      expect(mint.calls).toBe(before);
      expect(requestBody()).not.toHaveProperty('messageID');
      expect(dispatches()[0]).toMatchObject({ origin: 'approval_continuation', reason_code: null });
    });
  });

  describe('Sol actual client approval exposure seam', () => {
    it('SOL approval SDK body has the exact durable native anchor despite an older unlinked generic dispatch', async () => {
      // Produce the older generic row through the ACTUAL client, not an inserted resume stand-in.
      await opencodeClient.promptAsync(SDK, 'Synthetic generic status', undefined, '/tmp', { permissionMode: 'plan' },
        undefined, undefined, { sessionId: rootId, sdkSessionId: SDK, origin: 'approval_continuation',
          requestedSource: 'agent_config', routeAuthed: null });
      const older = dispatches()[0];
      expect(older).toMatchObject({ outcome: 'accepted', reason_code: null, sdk_user_message_id: null });
      vi.spyOn(opencodeClient, 'mintPromptAnchor').mockResolvedValue(NATIVE_WAKE);
      let rowsAtSdkExposure: Array<Record<string, unknown>> = [];
      sdkPromptAsync.mockImplementation(async () => { rowsAtSdkExposure = dispatches(); return { response: { status: 204 } }; });
      taint();
      const approval = await approvedWake();
      expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
      const body = (sdkPromptAsync.mock.calls[0][0] as { body: { messageID?: string } }).body;
      const resume = dispatches().find((row) => row.reason_code === resumeCode(approval.id, goalId, 1))!;
      expect(resume).toBeDefined();
      // Exact ID must be durable BEFORE SDK exposure, not inferred from event order afterwards.
      expect(body.messageID).toBeTypeOf('string');
      expect(body.messageID).toBe(NATIVE_WAKE);
      expect(body.messageID).toBe(resume.sdk_user_message_id);
      expect(rowsAtSdkExposure.find((row) => row.id === resume.id)?.sdk_user_message_id).toBe(body.messageID);
      expect(older.sdk_user_message_id).toBeNull();
      expect(consumedCount()).toBe(0);
      expect(dispatchChild).not.toHaveBeenCalled();
    });

    it('SOL approval taint drift inside the actual awaited history guard refuses SDK exposure', async () => {
      vi.spyOn(opencodeClient, 'mintPromptAnchor').mockResolvedValue(NATIVE_WAKE);
      taint();
      const approval = await requestApproval();
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const held = new Promise<void>((resolve) => { release = resolve; });
      // Hold ONLY the real client's existing history-read await; producer and dispatch code remain actual.
      vi.spyOn(opencodeClient as unknown as { assertDayflowSdkHistoryMayBeReused: (sdk: string) => Promise<void> },
        'assertDayflowSdkHistoryMayBeReused').mockImplementation(async () => { enter(); await held; });
      sdkPromptAsync.mockClear();
      const decision = decide(approval);
      await entered;
      taint('turn-sol-history-guard-drift');
      release();
      await decision;
      expect(sdkPromptAsync).not.toHaveBeenCalled();
      expect(dispatches().filter((row) => row.reason_code === resumeCode(approval.id, goalId, 1) && row.outcome === 'accepted')).toEqual([]);
      expect(consumedCount()).toBe(0);
      expect(dispatchChild).not.toHaveBeenCalled();
    });
  });

});
