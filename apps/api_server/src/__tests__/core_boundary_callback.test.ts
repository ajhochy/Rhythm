/**
 * Core boundary item 1: the exact child-completion callback marker must be
 * durably insertable through the ACTUAL OpencodeClientService provenance path
 * and then qualify exactly the status-only callback through the ACTUAL
 * repository lookup, after the bridge's late native-user linkage. Only the SDK
 * transport is faked; the completion service, client, provenance repository
 * and coordinator service/repository are real. No direct-SQL dispatch positive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import type { CoordinatorContextRead } from '../contracts/coordinator_conversation_contract';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

const { promptAsync } = vi.hoisted(() => ({ promptAsync: vi.fn() }));

vi.mock('../services/opencode_engine', async () => {
  const { OpencodeClientService } = await vi.importActual<typeof import('../services/opencode_client_service')>(
    '../services/opencode_client_service',
  );
  const svc = new OpencodeClientService();
  // Only the network boundary is a stand-in; provenance/guards run unchanged.
  (svc as unknown as { client: unknown }).client = { session: { promptAsync } };
  (svc as unknown as { status: string }).status = 'ready';
  (svc as unknown as { server: unknown }).server = { url: 'http://engine.test', close() {} };
  return { opencodeClient: svc, opencodeSessionMap: new Map<string, string>() };
});
vi.mock('../services/automatic_memory_preface', async (original) => ({
  ...(await original<typeof import('../services/automatic_memory_preface')>()),
  prepareAutomaticMemoryPreface: vi.fn(async () => null),
}));

import { opencodeClient, opencodeSessionMap } from '../services/opencode_engine';
import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';
vi.mock('../services/ws_gateway', () => ({ broadcast: vi.fn(), broadcastSessionUpdated: vi.fn() }));
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';
import { encodeCoordinatorCallbackMarker, parseCoordinatorCallbackMarker } from '../contracts/coordinator_callback_marker';

const OWNER = 7;
const PROJECT = 'project-boundary';
const SDK = 'ses_root_boundary';
const NOW = new Date('2026-10-06T12:00:00.000Z');
const NATIVE = 'msg_native_user_1';
const MARKER = 'c2_goal_callback:dg-1';

const available = <T>(items: T[]): CoordinatorContextRead<T> => ({
  availability: 'available', reason: null, complete: true, authoritative: true,
  observedAt: NOW.toISOString(), sourceVersion: 'snapshot-1', items,
});

describe('callback provenance through the actual client and repository', () => {
  let access: { value: boolean };
  let onHistoryRevalidate: (() => void) | null;
  let repo: CoordinatorConversationsRepository;
  let completion: AsyncDelegationCompletionService;
  const provenance = new ModelProvenanceRepository();
  const scope = () => ({ ownerUserId: OWNER, projectId: PROJECT, sessionId: 'root' });
  const lookup = (over: Record<string, unknown> = {}) => repo.findDelegationCallbackMcpDispatch({
    ownerUserId: OWNER, sessionId: 'root', projectId: PROJECT, sdkSessionId: SDK, cwd: '/tmp',
    sdkUserMessageId: NATIVE, ...over,
  });

  function session(id: string, over: Record<string, unknown> = {}): void {
    new AgentSessionsRepository().insert({ agentKind: 'librarian', taskId: null, cwd: '/tmp', name: id, profileId: 'librarian' } as never);
    const created = getDb().prepare('SELECT id FROM agent_sessions ORDER BY rowid DESC LIMIT 1').get() as { id: string };
    getDb().prepare('UPDATE agent_sessions SET id=? WHERE id=?').run(id, created.id);
    getDb().prepare(`UPDATE agent_sessions SET owner_user_id=?, project_id=?, status='idle' WHERE id=?`).run(OWNER, PROJECT, id);
    for (const [column, value] of Object.entries(over)) getDb().prepare(`UPDATE agent_sessions SET ${column}=? WHERE id=?`).run(value, id);
  }
  function delegation(id: string, child: string, over: { status?: string; target?: string } = {}): void {
    getDb().prepare(`INSERT INTO agent_async_delegations
      (id, parent_session_id, child_session_id, target_agent_config_id, status, completion_text, completed_at, created_at, updated_at)
      VALUES (?, 'root', ?, ?, ?, ?, ?, ?, ?)`).run(
      id, child, over.target ?? 'workflow-orchestrator', over.status ?? 'dispatched',
      over.status && over.status !== 'dispatched' ? 'child result' : null,
      over.status && over.status !== 'dispatched' ? NOW.toISOString() : null, NOW.toISOString(), NOW.toISOString(),
    );
  }

  beforeEach(() => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.pragma('foreign_keys = OFF');
    setDb(db);
    promptAsync.mockReset().mockResolvedValue({ response: { status: 204 } });
    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent)
      VALUES ('librarian', 'Synthetic profile', 'x', 'synthetic', 1, 1)`).run();
    access = { value: true };
    onHistoryRevalidate = null;
    session('root', { sdk_session_id: SDK, permission_mode: 'plan', model_mode: 'auto' });
    repo = new CoordinatorConversationsRepository(db, () => NOW);
    expect(repo.designatePrimaryOwnerRoot(scope()).kind).toBe('found');
    const goal = repo.addGoal({ ...scope(), expectedControlRevision: 1, commandKey: 'goal-1', objective: 'Fix the login bug' });
    const goalId = (goal as { goal: { id: string } }).goal.id;
    expect(repo.reserveGoalDelegation({ ...scope(), expectedControlRevision: 2, commandKey: 'delegate-1', goalId, parentSdkSessionId: SDK }).kind).toBe('reserved');
    session('child-1', { parent_session_id: 'root' });
    delegation('dg-1', 'child-1');
    expect(repo.settleGoalDelegation({
      ...scope(), expectedControlRevision: 3, commandKey: 'delegate-1', goalId,
      outcome: 'dispatched', delegationId: 'dg-1', childSessionId: 'child-1',
    }).kind).toBe('dispatched');

    const assembler = new CoordinatorConversationContextAssembler({
      tasks: { read: async () => available([]) }, schedules: { read: async () => available([]) },
      rhythms: { read: async () => available([]) }, workstreams: { read: async () => available([]) },
      receipts: { read: async () => available([]) },
    });
    const profile = { id: 'librarian', enabled: true, isAgent: true, locked: false, modelProvider: 'provider', modelId: 'model', revision: 1 };
    const service = new CoordinatorConversationService({
      repository: repo,
      context: { assemble: async (input: Parameters<typeof assembler.assemble>[0]) => assembler.assemble(input) } as never,
      sessions: new AgentSessionsRepository(),
      configs: { getById: () => profile, listEnabled: () => [profile] } as never,
      projects: { findById: () => ({ id: PROJECT, archivedAt: null }) } as never,
      projectAccess: { canAccess: () => access.value, canOwnerAccess: () => access.value },
      enabled: () => true,
    } as never);
    completion = new AsyncDelegationCompletionService();
    completion.setCoordinatorCallbackContext({ prepare: (input) => service.prepareCallbackContext(input) });
    (opencodeClient as unknown as { setDayflowSdkHistoryGuard(g: unknown): void }).setDayflowSdkHistoryGuard({
      shouldBindPrompt: async () => false,
      revalidateBeforeSdk: async () => { onHistoryRevalidate?.(); return true; },
    });
  });

  async function wake(): Promise<void> {
    await completion.onChildIdle('child-1');
  }
  const rows = () => provenance.list('root');
  // The bridge's actual late native-user linkage, not a SQL shortcut.
  const bridgeLink = (id = NATIVE) => provenance.linkOldestUserMessage('root', SDK, id);

  it('shares one strict marker encoding', () => {
    expect(encodeCoordinatorCallbackMarker('dg-1')).toBe(MARKER);
    expect(parseCoordinatorCallbackMarker(MARKER)).toBe('dg-1');
    for (const bad of ['c2_goal_callback:', 'c2_goal_callback:bad id', 'c2_goal_callback:a:b', 'c2_goal_callback:-x', `c2_goal_callback:${'a'.repeat(129)}`, 'C2_goal_callback:dg', 'dg-1', null, 7]) {
      expect(parseCoordinatorCallbackMarker(bad as never), String(bad)).toBeNull();
    }
    expect(encodeCoordinatorCallbackMarker('has space')).toBeNull();
  });

  it('persists the accepted callback dispatch and qualifies exactly that status-only callback after late native linkage', async () => {
    await wake();
    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual([expect.objectContaining({
      origin: 'delegation_completion', requestedSource: 'agent_config', routeAuthed: null,
      reasonCode: MARKER, outcome: 'accepted', sdkUserMessageId: null,
    })]);
    // Not authority before the exact native user message is linked.
    expect(lookup()).toBeNull();
    expect(bridgeLink()).toBe(true);
    expect(lookup()).toMatchObject({
      kind: 'delegation_callback', delegationId: 'dg-1', childSessionId: 'child-1',
      callbackReasonCode: MARKER, sdkUserMessageId: NATIVE, ownerUserId: OWNER, sessionId: 'root', projectId: PROJECT,
    });
    // Replay: a later native id cannot be linked to the same dispatch, nor reuse it.
    expect(bridgeLink('msg_native_user_2')).toBe(false);
    expect(lookup({ sdkUserMessageId: 'msg_native_user_2' })).toBeNull();
    // Route authentication is never claimed for the callback.
    expect(rows()[0].routeAuthed).toBeNull();
  });

  it('stays closed for foreign, stale, rebound and wrong-binding lookups of the persisted dispatch', async () => {
    await wake();
    bridgeLink();
    expect(lookup({ ownerUserId: 99 })).toBeNull();
    expect(lookup({ projectId: 'other-project' })).toBeNull();
    expect(lookup({ sdkSessionId: 'ses_other' })).toBeNull();
    expect(lookup({ cwd: '/elsewhere' })).toBeNull();
    // Delegation no longer in a callback-eligible state.
    getDb().prepare(`UPDATE agent_async_delegations SET status='failed' WHERE id='dg-1'`).run();
    expect(lookup()).toBeNull();
    getDb().prepare(`UPDATE agent_async_delegations SET status='notified' WHERE id='dg-1'`).run();
    expect(lookup()).not.toBeNull();
    getDb().prepare(`UPDATE agent_async_delegations SET child_session_id='child-other' WHERE id='dg-1'`).run();
    expect(lookup()).toBeNull();
    getDb().prepare(`UPDATE agent_async_delegations SET child_session_id='child-1' WHERE id='dg-1'`).run();
    getDb().prepare(`UPDATE agent_sessions SET archived_at='2026-10-06' WHERE id='root'`).run();
    expect(lookup()).toBeNull();
  });

  it('refuses the marker for any other origin, source or identifier, and keeps normal reason restrictions', () => {
    const base = { sessionId: 'root', sdkSessionId: SDK, routeAuthed: null } as const;
    const ok = { ...base, origin: 'delegation_completion', requestedSource: 'agent_config', reasonCode: MARKER } as never;
    expect(provenance.insert(ok).reasonCode).toBe(MARKER);
    for (const bad of [
      { origin: 'prompt_api', requestedSource: 'agent_config', reasonCode: MARKER },
      { origin: 'delegation_completion', requestedSource: 'session', reasonCode: MARKER },
      { origin: 'delegation', requestedSource: 'agent_config', reasonCode: MARKER },
      { origin: 'delegation_completion', requestedSource: 'agent_config', reasonCode: 'c2_goal_callback:' },
      { origin: 'delegation_completion', requestedSource: 'agent_config', reasonCode: 'c2_goal_callback:a b' },
      { origin: 'delegation_completion', requestedSource: 'agent_config', reasonCode: 'c2_goal_callback:a:b' },
      { origin: 'delegation_completion', requestedSource: 'agent_config', reasonCode: 'other:dg-1' },
      { origin: 'delegation_completion', requestedSource: 'agent_config', reasonCode: 'Not A Code' },
    ]) {
      expect(() => provenance.insert({ ...base, ...bad } as never), JSON.stringify(bad)).toThrow(/Invalid dispatch/);
    }
    expect(provenance.insert({ ...base, origin: 'prompt_api', requestedSource: 'session', reasonCode: 'c2_foreground', routeAuthed: true } as never).reasonCode).toBe('c2_foreground');
  });

  it('a mixed completion batch carries no marker and can never qualify as the callback', async () => {
    session('child-2', { parent_session_id: 'root' });
    delegation('dg-2', 'child-2', { status: 'completed', target: 'librarian' });
    await wake();
    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual([expect.objectContaining({ origin: 'delegation_completion', reasonCode: null, routeAuthed: null })]);
    bridgeLink();
    expect(lookup()).toBeNull();
  });

  it('a rejected SDK enqueue leaves no accepted dispatch and no authority', async () => {
    promptAsync.mockResolvedValue({ error: { message: 'engine rejected' } });
    await wake();
    expect(rows().map((row) => row.outcome)).toEqual(['rejected']);
    bridgeLink();
    expect(lookup()).toBeNull();
  });

  it('a forged marker without the durable goal/delegation/child binding is not authority', async () => {
    await wake();
    getDb().prepare(`UPDATE agent_turn_dispatches SET reason_code='c2_goal_callback:dg-forged'`).run();
    bridgeLink();
    expect(lookup()).toBeNull();
  });

  it('final SDK boundary: scope lost during the history-guard await withholds the callback overlay', async () => {
    // Retained history makes the client await the guard AFTER the completion
    // service's last overlay recheck; access is revoked inside that await.
    getDb().prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_binding_ambiguous' WHERE id='root'`).run();
    onHistoryRevalidate = () => { access.value = false; };
    await wake();
    const sentSystem = promptAsync.mock.calls.length > 0
      ? String((promptAsync.mock.calls[0][0] as { body: { system?: string } }).body.system ?? '')
      : '';
    expect(sentSystem).not.toContain('completion callback of one Coding Workflow child');
    // The stale dispatch is withheld whole: settled rejected, never accepted, no authority.
    expect(promptAsync).not.toHaveBeenCalled();
    expect(rows().map((row) => row.outcome)).toEqual(['rejected']);
    bridgeLink();
    expect(lookup()).toBeNull();
  });

  it('with the receiver still current at the final boundary the overlay is sent', async () => {
    getDb().prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_binding_ambiguous' WHERE id='root'`).run();
    await wake();
    expect(String((promptAsync.mock.calls[0][0] as { body: { system?: string } }).body.system)).toContain('completion callback of one Coding Workflow child');
    expect(rows().map((row) => row.outcome)).toEqual(['accepted']);
  });

  it('ordinary non-coordinator completion dispatch is unchanged', async () => {
    await completion.onChildIdle('missing-child');
    session('plain-parent', { sdk_session_id: 'ses_plain' });
    session('plain-child', { parent_session_id: 'plain-parent' });
    getDb().prepare(`INSERT INTO agent_async_delegations
      (id, parent_session_id, child_session_id, target_agent_config_id, status, completion_text, completed_at, created_at, updated_at)
      VALUES ('dg-plain', 'plain-parent', 'plain-child', 'librarian', 'completed', 'x', ?, ?, ?)`).run(NOW.toISOString(), NOW.toISOString(), NOW.toISOString());
    promptAsync.mockClear();
    await completion.onChildIdle('plain-child');
    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(provenance.list('plain-parent')).toEqual([expect.objectContaining({ reasonCode: null, outcome: 'accepted' })]);
  });

  it('Sol: actual bridge message.updated late-links the accepted callback before status lookup', async () => {
    await wake();
    expect(rows()).toEqual([expect.objectContaining({ origin: 'delegation_completion', routeAuthed: null, reasonCode: MARKER, outcome: 'accepted', sdkUserMessageId: null })]);
    expect(lookup()).toBeNull();
    opencodeSessionMap.set('root', SDK);
    try {
      const bridge = new OpencodeStreamBridge();
      (bridge as unknown as { _relayEvent(event: unknown): void })._relayEvent({
        type: 'message.updated', properties: { info: { id: NATIVE, sessionID: SDK, role: 'user', time: { created: 1 } } },
      });
      expect(rows()[0].sdkUserMessageId).toBe(NATIVE);
      expect(getDb().prepare('SELECT sdk_message_id,role FROM agent_session_messages WHERE session_id=? AND sdk_message_id=?').get('root',NATIVE)).toEqual({ sdk_message_id: NATIVE, role: 'input' });
      expect(lookup()).toMatchObject({ kind: 'delegation_callback', delegationId: 'dg-1', childSessionId: 'child-1', sdkUserMessageId: NATIVE });
      (bridge as unknown as { _relayEvent(event: unknown): void })._relayEvent({
        type: 'message.updated', properties: { info: { id: 'msg_later_no_replay', sessionID: SDK, role: 'user', time: { created: 2 } } },
      });
      expect(rows()[0].sdkUserMessageId).toBe(NATIVE);
      expect(lookup({ sdkUserMessageId: 'msg_later_no_replay' })).toBeNull();
    } finally { opencodeSessionMap.delete('root'); }
  });
});
