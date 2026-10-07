/**
 * G2 first adapter: complete manager + recursive native descendants + exact
 * charged root/review coverage. The engine is an in-memory native tree behind
 * the existing read-port shapes; the local owner/delegation/dispatch joins use
 * real SQLite repositories. Source proof only, not a live engine run.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { CoordinatorWorkflowMembership } from '../shared_agents/delegation_jobs_repository';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import {
  CodingWorkflowCoverageInspector,
  type CodingWorkflowInspectionEngine,
} from '../services/persistent_workstream_coordinator';

const PROJECT = 'project-g2';
const IDENTITY = { version: '1.2.3', pid: 4242, bootId: 'boot-a' };
const MGR_ANCHOR = 'msg_mgr_anchor';

type Info = Record<string, unknown>;
const step = (id: string, parentID: string, over: Info = {}): { info: Info; parts: unknown[] } => ({
  info: {
    id, role: 'assistant', parentID, finish: 'stop', time: { completed: 100 }, cost: 0.01,
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, ...over,
  },
  parts: [],
});
const user = (id: string) => ({ info: { id, role: 'user' }, parts: [] });

/** An in-memory native engine behind the existing read-port shapes. */
class FakeEngine implements CodingWorkflowInspectionEngine {
  identity: typeof IDENTITY | null = IDENTITY;
  identityCalls = 0;
  sessions = new Map<string, { id: string; parentID?: string; directory?: string }>();
  children = new Map<string, Array<{ id: string; parentID: string; directory: string }> | null>();
  /** sdk id -> pages, newest cursor chain: pages[0] has cursor 'c1' when more remain. */
  pages = new Map<string, Array<Array<{ info: Info; parts?: unknown }>> | null>();
  repeatCursor = false;
  pendingQuestion = new Set<string>();
  pendingPermission = new Set<string>();
  busy = new Set<string>();
  lifecycleAvailable = true;
  hiddenFromKnown = new Set<string>();
  lifecycleCalls: Array<{ ids: string[]; directory: string }> = [];
  /** Hooks that run when the corresponding awaited read happens (to race the engine). */
  onMessages?: (sdkId: string) => void;
  onIdentity?: (call: number) => void;

  async getEngineIdentity() { this.identityCalls += 1; this.onIdentity?.(this.identityCalls); return this.identity; }
  async getSession(sdkId: string) { return this.sessions.get(sdkId) ?? null; }
  async listChildrenStrict(sdkId: string) { return this.children.has(sdkId) ? this.children.get(sdkId)! : []; }
  async listMessagesPageStrict(sdkId: string, _directory: string, options: { before?: string } = {}) {
    this.onMessages?.(sdkId);
    const pages = this.pages.get(sdkId);
    if (!pages) return null;
    const index = options.before === undefined ? 0 : Number(options.before.replace('c', ''));
    const more = index + 1 < pages.length;
    return {
      messages: pages[index],
      nextCursor: this.repeatCursor && index > 0 ? options.before! : more ? `c${index + 1}` : null,
    };
  }
  async inspectBoundSessionLifecycles(ids: string[], directory: string) {
    this.lifecycleCalls.push({ ids: [...ids], directory });
    if (!this.lifecycleAvailable) return { available: false, knownSessionIds: [], statusBySessionId: {}, pendingQuestionSessionIds: [], pendingPermissionSessionIds: [] };
    return {
      available: true,
      knownSessionIds: ids.filter((id) => !this.hiddenFromKnown.has(id)),
      statusBySessionId: Object.fromEntries(ids.filter((id) => this.busy.has(id)).map((id) => [id, { type: 'busy' }])),
      pendingQuestionSessionIds: ids.filter((id) => this.pendingQuestion.has(id)),
      pendingPermissionSessionIds: ids.filter((id) => this.pendingPermission.has(id)),
    };
  }
}

interface Fixture {
  engine: FakeEngine;
  inspector: CodingWorkflowCoverageInspector;
  receipt: Record<string, any>;
  rootTurns: Array<{ dispatchId: string; sdkUserMessageId: string }>;
  rootId: string;
  managerId: string;
  delegationId: string;
  current: { value: boolean };
  inspect(over?: { receipt?: unknown; rootTurns?: unknown }): ReturnType<CodingWorkflowCoverageInspector['inspect']>;
}

function fixture(): Fixture {
  const sessions = new AgentSessionsRepository();
  const provenance = new ModelProvenanceRepository();
  const root = sessions.insert({
    agentKind: 'manager' as never, taskId: null, cwd: '/repo/root', name: 'root', mcpRole: 'manager', ownerUserId: 42,
  });
  sessions.setSdkSessionId(root.id, 'sdk-root');
  getDb().prepare('UPDATE agent_sessions SET project_id=? WHERE id=?').run(PROJECT, root.id);
  const manager = sessions.upsertChildSession('sdk-mgr', 'sdk-root', 'Async delegation', '/repo/root', null)!;
  const delegationId = new AgentAsyncDelegationsRepository().create({
    parentSessionId: root.id, childSessionId: manager.id, targetAgentConfigId: 'workflow-orchestrator',
  }).id;
  const managerDispatch = provenance.insert({
    sessionId: manager.id, sdkSessionId: 'sdk-mgr', sdkUserMessageId: MGR_ANCHOR, origin: 'delegation',
    requestedSource: 'agent_config', routeAuthed: null, reasonCode: 'g2_coding_workflow',
  });
  provenance.setOutcome(managerDispatch.id, 'accepted');
  const rootTurns = ['msg_root_1', 'msg_review_2'].map((anchor) => {
    const row = provenance.insert({
      sessionId: root.id, sdkSessionId: 'sdk-root', sdkUserMessageId: anchor, origin: 'prompt_api',
      requestedSource: 'session', routeAuthed: true,
    });
    provenance.setOutcome(row.id, 'accepted');
    return { dispatchId: row.id, sdkUserMessageId: anchor };
  });

  const engine = new FakeEngine();
  engine.sessions.set('sdk-mgr', { id: 'sdk-mgr', parentID: 'sdk-root', directory: '/repo/root' });
  engine.children.set('sdk-mgr', [
    { id: 'sdk-child1', parentID: 'sdk-mgr', directory: '/repo/root' },
    { id: 'sdk-child2', parentID: 'sdk-mgr', directory: '/repo/root' },
  ]);
  engine.children.set('sdk-child1', [{ id: 'sdk-grand1', parentID: 'sdk-child1', directory: '/repo/other' }]);
  engine.pages.set('sdk-mgr', [[user(MGR_ANCHOR), step('a_mgr_1', MGR_ANCHOR, { finish: 'tool-calls' }), step('a_mgr_2', MGR_ANCHOR)]]);
  engine.pages.set('sdk-child1', [[user('u_c1'), step('a_c1', 'u_c1')]]);
  engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2', 'u_c2')]]);
  engine.pages.set('sdk-grand1', [[user('u_g1'), step('a_g1', 'u_g1')]]);
  engine.pages.set('sdk-root', [[
    user('msg_root_1'), step('a_root_1', 'msg_root_1'), user('msg_review_2'),
    step('a_review_2a', 'msg_review_2', { finish: 'tool-calls' }), step('a_review_2b', 'msg_review_2'),
    step('a_uncharged', 'msg_unrelated_turn'),
  ]]);

  const receipt = {
    schemaVersion: 1, adapter: 'coding_workflow_v1',
    authorization: { authorizationId: 'auth-1', ordinal: 2, workstreamId: 'ws-1', goalId: 'goal-1' },
    owner: { ownerUserId: 42, projectId: PROJECT, rootSessionId: root.id, rootSdkSessionId: 'sdk-root' },
    delegation: { delegationId, managerSessionId: manager.id, managerSdkSessionId: 'sdk-mgr', nativeParentSdkSessionId: 'sdk-root' },
    dispatch: { dispatchId: managerDispatch.id, sdkUserMessageId: MGR_ANCHOR, delivery: 'accepted' },
    engine: IDENTITY,
  };
  const inspector = new CodingWorkflowCoverageInspector({
    engine, sessions: new AgentSessionsRepository(), delegations: new AgentAsyncDelegationsRepository(), dispatches: provenance,
    probeTimeoutMs: 500,
  });
  const current = { value: true };
  return {
    engine, inspector, receipt, rootTurns, rootId: root.id, managerId: manager.id, delegationId, current,
    inspect: (over = {}) => inspector.inspect({
      receipt: 'receipt' in over ? over.receipt : receipt,
      rootTurns: 'rootTurns' in over ? over.rootTurns : rootTurns,
      current: () => current.value,
    }),
  };
}

describe('Coding Workflow coverage inspection', () => {
  let f: Fixture;
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    db.prepare("INSERT INTO users (id,name,email) VALUES (42,'Test','g2-inspection@example.com')").run();
    db.prepare(`INSERT INTO projects (id, name, cwd, created_at) VALUES (?, 'G2', '/repo/root', ?)`).run(PROJECT, new Date().toISOString());
    f = fixture();
  });

  const expectHold = async (reason: string, run: () => ReturnType<Fixture['inspect']> = () => f.inspect()) => {
    const result = await run();
    expect(result).toMatchObject({ status: 'hold', reason, usage: null });
    return result;
  };

  describe('SOL charged turn closure', () => {
    it('does not report complete coverage for a charged root/review anchor with only a completed tool-calls step', async () => {
      f.engine.pages.set('sdk-root', [[
        user('msg_root_1'), step('a_root_1', 'msg_root_1'),
        user('msg_review_2'), step('a_review_tool', 'msg_review_2', { finish: 'tool-calls' }),
      ]]);
      const result = await f.inspect();
      expect(f.rootTurns).toHaveLength(2);
      expect(f.engine.pages.get('sdk-root')![0].filter((m) => m.info.parentID === 'msg_review_2')).toHaveLength(1);
      expect(result).toMatchObject({ status: 'hold', usage: null });
    });

    it('does not report complete coverage for a descendant with only a completed tool-calls step', async () => {
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2_tool', 'u_c2', { finish: 'tool-calls' })]]);
      const result = await f.inspect();
      expect(f.engine.busy.has('sdk-root')).toBe(false);
      expect(result).toMatchObject({ status: 'hold', usage: null });
    });
  });

  describe('manager completion callback accounting', () => {
    function enrolledCallback() {
      const provenance = new ModelProvenanceRepository();
      const callback = provenance.insert({
        sessionId: f.managerId, sdkSessionId: 'sdk-mgr', sdkUserMessageId: 'msg_mgr_callback',
        origin: 'delegation_completion', requestedSource: 'agent_config', routeAuthed: null,
      });
      provenance.setOutcome(callback.id, 'accepted');
      f.engine.pages.get('sdk-mgr')![0].push(user('msg_mgr_callback'), step('a_mgr_callback', 'msg_mgr_callback'));
      const membership: CoordinatorWorkflowMembership[] = [{
        nativeSessionId: 'sdk-mgr', parentNativeSessionId: 'sdk-root', nativeUserMessageId: 'msg_mgr_callback',
        engineGeneration: 'engine-a', runnerGeneration: 'runner-callback', purpose: 'answer', attempt: 0,
        requestIdentity: 'a'.repeat(64), accountingKind: 'persisted_assistant',
        assistantMessageId: 'a_mgr_callback', parentMessageId: 'msg_mgr_callback',
      }];
      const inspect = (members: readonly CoordinatorWorkflowMembership[] | undefined = membership) => f.inspector.inspect({
        receipt: f.receipt, rootTurns: f.rootTurns, managerMembership: members, current: () => f.current.value,
      });
      return { callback, membership, inspect };
    }

    it('charges the exact enrolled manager callback assistant in addition to its initial turn', async () => {
      const c = enrolledCallback();
      expect(await c.inspect()).toMatchObject({
        status: 'complete', usage: { assistantStepCount: 9, coveredSessionCount: 5, totalTokens: 135 },
      });
    });

    it('charges a callback tool step and its one terminal separately from the original closed turn', async () => {
      const c = enrolledCallback();
      f.engine.pages.get('sdk-mgr')![0].push(step('a_mgr_callback_terminal', 'msg_mgr_callback'));
      f.engine.pages.get('sdk-mgr')![0].find((m) => m.info.id === 'a_mgr_callback')!.info.finish = 'tool-calls';
      c.membership.push({ ...c.membership[0], assistantMessageId: 'a_mgr_callback_terminal', attempt: 1 });
      expect(await c.inspect()).toMatchObject({ status: 'complete', usage: { assistantStepCount: 10, totalTokens: 150 } });
    });

    it.each([
      ['native session', 'nativeSessionId', 'sdk-foreign'],
      ['native parent', 'parentNativeSessionId', 'sdk-foreign'],
      ['user anchor', 'nativeUserMessageId', 'msg_foreign'],
      ['assistant identity', 'assistantMessageId', 'a_foreign'],
      ['accounting parent', 'parentMessageId', 'msg_foreign'],
      ['accounting kind', 'accountingKind', 'unmetered_auxiliary'],
      ['engine generation', 'engineGeneration', ''],
      ['runner generation', 'runnerGeneration', ''],
      ['request identity', 'requestIdentity', ''],
      ['engine whitespace', 'engineGeneration', 'engine a'],
      ['engine control', 'engineGeneration', 'engine\u0001a'],
      ['runner whitespace', 'runnerGeneration', 'runner a'],
      ['runner control', 'runnerGeneration', 'runner\u0001a'],
      ['request whitespace', 'requestIdentity', 'request a'],
      ['request control', 'requestIdentity', 'request\u0001a'],
      ['attempt', 'attempt', -1],
      ['purpose', 'purpose', 'unknown'],
    ])('holds an enrolled callback with changed %s', async (_name, key, value) => {
      const c = enrolledCallback();
      Object.assign(c.membership[0], { [key]: value });
      expect(await c.inspect()).toMatchObject({ status: 'hold', reason: 'uncovered_assistant_turn', usage: null });
    });

    it.each([
      ['session', 'session_id', 'foreign-session'],
      ['SDK', 'sdk_session_id', 'sdk-foreign'],
      ['user anchor', 'sdk_user_message_id', 'msg_foreign'],
      ['origin', 'origin', 'prompt_api'],
      ['requested source', 'requested_source', 'session'],
      ['unknown outcome', 'outcome', 'unknown'],
      ['pending outcome', 'outcome', 'pending'],
      ['rejected outcome', 'outcome', 'rejected'],
    ])('holds when persisted callback provenance has foreign or unaccepted %s', async (_name, column, value) => {
      const c = enrolledCallback();
      getDb().prepare(`UPDATE agent_turn_dispatches SET ${column}=? WHERE id=?`).run(column === 'session_id' ? f.rootId : value, c.callback.id);
      expect(await c.inspect()).toMatchObject({ status: 'hold', reason: 'uncovered_assistant_turn', usage: null });
    });

    it('holds missing or ambiguous exact dispatch rows', async () => {
      const c = enrolledCallback();
      getDb().prepare('DELETE FROM agent_turn_dispatches WHERE id=?').run(c.callback.id);
      expect(await c.inspect()).toMatchObject({ status: 'hold', reason: 'uncovered_assistant_turn' });
      const provenance = new ModelProvenanceRepository();
      for (let i = 0; i < 2; i += 1) {
        const row = provenance.insert({ sessionId: f.managerId, sdkSessionId: 'sdk-mgr', sdkUserMessageId: 'msg_mgr_callback',
          origin: 'delegation_completion', requestedSource: 'agent_config', routeAuthed: null });
        provenance.setOutcome(row.id, 'accepted');
      }
      expect(await c.inspect()).toMatchObject({ status: 'hold', reason: 'uncovered_assistant_turn', usage: null });
    });

    it('holds absent, empty, ambiguous or over-bound membership for extra manager groups', async () => {
      const c = enrolledCallback();
      expect(await f.inspector.inspect({ receipt: f.receipt, rootTurns: f.rootTurns, current: () => true }))
        .toMatchObject({ status: 'hold', reason: 'uncovered_assistant_turn' });
      for (const members of [[], [c.membership[0], c.membership[0]], Array(49).fill(c.membership[0])]) {
        expect(await c.inspect(members)).toMatchObject({ status: 'hold', reason: 'uncovered_assistant_turn', usage: null });
      }
    });

    it('holds a callback whose second assistant step lacks exact enrollment', async () => {
      const c = enrolledCallback();
      f.engine.pages.get('sdk-mgr')![0].push(step('a_unenrolled', 'msg_mgr_callback'));
      expect(await c.inspect()).toMatchObject({ status: 'hold', reason: 'uncovered_assistant_turn', usage: null });
    });

    it.each(['tool-calls', 'incomplete', 'two-terminal'])('holds callback turn closure %s', async (kind) => {
      const c = enrolledCallback();
      const callback = f.engine.pages.get('sdk-mgr')![0].find((m) => m.info.id === 'a_mgr_callback')!;
      if (kind === 'tool-calls') callback.info.finish = 'tool-calls';
      if (kind === 'incomplete') callback.info.time = {};
      if (kind === 'two-terminal') {
        f.engine.pages.get('sdk-mgr')![0].push(step('a_extra_terminal', 'msg_mgr_callback'));
        c.membership.push({ ...c.membership[0], assistantMessageId: 'a_extra_terminal', attempt: 1 });
      }
      expect(await c.inspect()).toMatchObject({ status: 'hold', reason: kind === 'incomplete' ? 'turn_incomplete' : 'turn_not_terminal', usage: null });
    });

    it('does not double-count duplicate native assistant identities', async () => {
      const c = enrolledCallback();
      f.engine.pages.get('sdk-mgr')![0].push(step('a_mgr_callback', 'msg_mgr_callback'));
      expect(await c.inspect()).toMatchObject({ status: 'hold', reason: 'uncovered_assistant_turn', usage: null });
    });

    it.each(['outcome', 'SDK', 'membership', 'durable current'])('re-proves callback %s after the last engine await', async (kind) => {
      const c = enrolledCallback();
      f.engine.onIdentity = (call) => {
        if (call !== 2) return;
        if (kind === 'outcome') getDb().prepare("UPDATE agent_turn_dispatches SET outcome='unknown' WHERE id=?").run(c.callback.id);
        if (kind === 'SDK') getDb().prepare("UPDATE agent_turn_dispatches SET sdk_session_id='sdk-foreign' WHERE id=?").run(c.callback.id);
        if (kind === 'membership') c.membership[0].parentMessageId = 'msg_foreign';
        if (kind === 'durable current') f.current.value = false;
      };
      expect(await c.inspect()).toMatchObject({ status: 'hold', reason: kind === 'durable current' ? 'scope_changed' : 'local_binding_changed', usage: null });
    });
  });

  describe('complete coverage', () => {
    it('sums manager + every recursive native descendant + exactly the charged root/review turns', async () => {
      const result = await f.inspect();
      expect(result.status).toBe('complete');
      if (result.status !== 'complete') return;
      expect(result.coverage).toEqual({
        managerSessionId: f.managerId, managerSdkSessionId: 'sdk-mgr',
        descendantSdkSessionIds: ['sdk-child1', 'sdk-child2', 'sdk-grand1'],
        rootTurns: f.rootTurns,
      });
      // mgr 2 + child1 + grand + child2 + root 1 + review 2 = 8 steps; the unrelated root turn is NOT charged
      expect(result.usage).toMatchObject({
        status: 'actual', assistantStepCount: 8, coveredSessionCount: 5,
        inputTokens: 80, outputTokens: 40, totalTokens: 120,
      });
      expect(result.usage.cost).toBeCloseTo(0.08, 10);
      expect(result.engineBootId).toBe('boot-a');
      // complete lifecycle, split by owned directory with the same engine identity before/after
      expect(f.engine.lifecycleCalls.map((call) => call.directory).sort()).toEqual(['/repo/other', '/repo/other', '/repo/root', '/repo/root']);
      expect(f.engine.identityCalls).toBe(2);
    });

    it('works with no charged root turn, and reads a multi-page manager history to its explicit end', async () => {
      f.engine.pages.set('sdk-mgr', [
        [step('a_mgr_2', MGR_ANCHOR)],
        [user(MGR_ANCHOR), step('a_mgr_1', MGR_ANCHOR, { finish: 'tool-calls' })],
      ]);
      const result = await f.inspect({ rootTurns: [] });
      expect(result).toMatchObject({ status: 'complete', usage: { assistantStepCount: 5, coveredSessionCount: 4 } });
    });

    it('reports cost null (never zero) when any step omits it', async () => {
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2', 'u_c2', { cost: undefined })]]);
      const result = await f.inspect();
      expect(result).toMatchObject({ status: 'complete', usage: { cost: null, totalTokens: 120 } });
    });
  });

  describe('receipt and charged-turn inputs', () => {
    it('rejects a malformed receipt, a receipt with an extra key, or an unknown-delivery receipt', async () => {
      await expectHold('receipt_invalid', () => f.inspect({ receipt: null }));
      await expectHold('receipt_invalid', () => f.inspect({ receipt: { ...f.receipt, extra: true } }));
      await expectHold('receipt_invalid', () => f.inspect({ receipt: { ...f.receipt, delegation: { ...f.receipt.delegation, nativeParentSdkSessionId: 'sdk-other' } } }));
      await expectHold('delivery_unknown', () => f.inspect({ receipt: { ...f.receipt, dispatch: { ...f.receipt.dispatch, delivery: 'unknown' } } }));
    });

    it('requires an explicit, bounded, duplicate-free list of charged root anchors', async () => {
      await expectHold('root_turns_missing', () => f.inspect({ rootTurns: undefined }));
      await expectHold('root_turns_missing', () => f.inspect({ rootTurns: [{ dispatchId: 'x' }] }));
      await expectHold('root_turns_missing', () => f.inspect({ rootTurns: [f.rootTurns[0], f.rootTurns[0]] }));
      await expectHold('root_turns_missing', () => f.inspect({ rootTurns: Array.from({ length: 9 }, (_, i) => ({ dispatchId: `d${i}`, sdkUserMessageId: `m${i}` })) }));
    });

    it('holds a root anchor that is not an accepted persisted dispatch of the exact root', async () => {
      await expectHold('root_turn_unbound', () => f.inspect({ rootTurns: [{ ...f.rootTurns[0], sdkUserMessageId: 'msg_forged' }] }));
      getDb().prepare(`UPDATE agent_turn_dispatches SET outcome='rejected' WHERE id=?`).run(f.rootTurns[1].dispatchId);
      await expectHold('root_turn_unbound');
    });

    it('holds a root anchor with no assistant step (no fabricated zero)', async () => {
      f.engine.pages.set('sdk-root', [[user('msg_root_1'), user('msg_review_2'), step('a_review_2', 'msg_review_2')]]);
      await expectHold('accounting_missing');
    });
  });

  describe('exact local joins', () => {
    it.each([
      ['the delegation row points at another child', (x: Fixture) => getDb().prepare(`UPDATE agent_async_delegations SET child_session_id=? WHERE id=?`).run(x.rootId, x.delegationId)],
      ['the owner of the root changed', (x: Fixture) => getDb().prepare(`UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?`).run(x.rootId)],
      ['the project of the root changed', (x: Fixture) => getDb().prepare(`UPDATE agent_sessions SET project_id=NULL WHERE id=?`).run(x.rootId)],
      ['the manager was reparented', (x: Fixture) => getDb().prepare(`UPDATE agent_sessions SET parent_session_id=NULL WHERE id=?`).run(x.managerId)],
      ['the manager dispatch was not accepted', (_x: Fixture) => getDb().prepare(`UPDATE agent_turn_dispatches SET outcome='unknown' WHERE reason_code='g2_coding_workflow'`).run()],
      ['the manager dispatch carries another reason code', (_x: Fixture) => getDb().prepare(`UPDATE agent_turn_dispatches SET reason_code='other_code' WHERE reason_code='g2_coding_workflow'`).run()],
      ['the manager dispatch anchor differs', (_x: Fixture) => getDb().prepare(`UPDATE agent_turn_dispatches SET sdk_user_message_id='msg_other' WHERE reason_code='g2_coding_workflow'`).run()],
    ])('holds when %s', async (_name, mutate) => {
      mutate(f);
      await expectHold('local_binding_changed');
    });

    it('holds when a local join changes DURING the awaited reads', async () => {
      f.engine.onMessages = (sdkId) => {
        if (sdkId === 'sdk-grand1') getDb().prepare(`UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?`).run(f.rootId);
      };
      await expectHold('local_binding_changed');
    });

    it('holds when the owner/epoch/admission proof is no longer current at the end', async () => {
      f.engine.onMessages = (sdkId) => { if (sdkId === 'sdk-root') f.current.value = false; };
      await expectHold('scope_changed');
    });
  });

  describe('engine identity', () => {
    it('holds when the engine identity is unavailable, differs from the receipt, or changes during inspection', async () => {
      f.engine.identity = null;
      await expectHold('engine_identity_unavailable');
      f.engine.identity = { ...IDENTITY, bootId: 'boot-b' };
      await expectHold('engine_identity_changed');
      f.engine.identity = IDENTITY;
      f.engine.identityCalls = 0;
      f.engine.onIdentity = (call) => { if (call === 2) f.engine.identity = { ...IDENTITY, bootId: 'boot-c' }; };
      await expectHold('engine_identity_changed');
    });
  });

  describe('native tree', () => {
    it('holds on missing manager metadata or a manager whose native parent is not the root', async () => {
      f.engine.sessions.delete('sdk-mgr');
      await expectHold('native_metadata_unavailable');
      f.engine.sessions.set('sdk-mgr', { id: 'sdk-mgr', parentID: 'sdk-someone', directory: '/repo/root' });
      await expectHold('native_metadata_unavailable');
    });

    it('holds when a children response is missing/malformed instead of treating it as an empty tree', async () => {
      f.engine.children.set('sdk-child1', null);
      const result = await expectHold('native_tree_unavailable');
      expect(result.coverage?.managerSdkSessionId).toBe('sdk-mgr'); // IDs established so far are reported, with no usage
    });

    it('holds on a descendant whose parent edge or identity is wrong, and on a cycle', async () => {
      f.engine.children.set('sdk-child1', [{ id: 'sdk-grand1', parentID: 'sdk-elsewhere', directory: '/repo/other' }]);
      await expectHold('descendant_identity_missing');
      f.engine.children.set('sdk-child1', [{ id: 'sdk-mgr', parentID: 'sdk-child1', directory: '/repo/root' }]);
      await expectHold('native_tree_cycle');
    });

    it('holds (never a partial tree) past the descendant, depth or directory bounds', async () => {
      f.engine.children.set('sdk-mgr', Array.from({ length: 33 }, (_, i) => ({ id: `sdk-many${i}`, parentID: 'sdk-mgr', directory: '/repo/root' })));
      await expectHold('native_tree_bounds_exceeded');
      f.engine.children.set('sdk-mgr', [{ id: 'sdk-d1', parentID: 'sdk-mgr', directory: '/repo/root' }]);
      f.engine.children.set('sdk-d1', [{ id: 'sdk-d2', parentID: 'sdk-d1', directory: '/repo/root' }]);
      f.engine.children.set('sdk-d2', [{ id: 'sdk-d3', parentID: 'sdk-d2', directory: '/repo/root' }]);
      f.engine.children.set('sdk-d3', [{ id: 'sdk-d4', parentID: 'sdk-d3', directory: '/repo/root' }]);
      f.engine.children.set('sdk-d4', [{ id: 'sdk-d5', parentID: 'sdk-d4', directory: '/repo/root' }]);
      await expectHold('native_tree_bounds_exceeded');
      f.engine.children.set('sdk-mgr', Array.from({ length: 9 }, (_, i) => ({ id: `sdk-dir${i}`, parentID: 'sdk-mgr', directory: `/repo/d${i}` })));
      await expectHold('native_tree_bounds_exceeded');
    });

    it('holds when a new child appears after the messages were read', async () => {
      f.engine.onMessages = (sdkId) => {
        if (sdkId === 'sdk-root') {
          f.engine.children.set('sdk-child2', [{ id: 'sdk-late', parentID: 'sdk-child2', directory: '/repo/root' }]);
        }
      };
      await expectHold('native_tree_changed');
    });
  });

  describe('lifecycle', () => {
    it('holds on unavailable lifecycle, an unknown session, a pending interaction or a busy session', async () => {
      f.engine.lifecycleAvailable = false;
      await expectHold('lifecycle_unavailable');
      f.engine.lifecycleAvailable = true;
      f.engine.hiddenFromKnown.add('sdk-grand1');
      await expectHold('lifecycle_unavailable');
      f.engine.hiddenFromKnown.clear();
      f.engine.pendingQuestion.add('sdk-child2');
      await expectHold('pending_interaction');
      f.engine.pendingQuestion.clear();
      f.engine.pendingPermission.add('sdk-grand1');
      await expectHold('pending_interaction');
      f.engine.pendingPermission.clear();
      f.engine.busy.add('sdk-child1');
      await expectHold('session_busy');
    });

    it('holds when a descendant becomes busy after its messages were read', async () => {
      f.engine.onMessages = (sdkId) => { if (sdkId === 'sdk-root') f.engine.busy.add('sdk-child2'); };
      await expectHold('lifecycle_changed');
    });
  });

  describe('messages and accounting', () => {
    it('holds on an unreadable page, a repeated cursor, or a page cap', async () => {
      f.engine.pages.set('sdk-child2', null);
      await expectHold('messages_unavailable');
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2', 'u_c2')]]);
      f.engine.pages.set('sdk-mgr', [[step('a1', MGR_ANCHOR)], [step('a2', MGR_ANCHOR)], [user(MGR_ANCHOR), step('a3', MGR_ANCHOR)]]);
      f.engine.repeatCursor = true;
      await expectHold('message_pages_incomplete');
      f.engine.repeatCursor = false;
      f.engine.pages.set('sdk-mgr', Array.from({ length: 60 }, (_, i) => [step(`p${i}`, MGR_ANCHOR)]));
      await expectHold('message_pages_incomplete');
    });

    it('holds when the manager session has an assistant step outside the one exported anchor', async () => {
      f.engine.pages.set('sdk-mgr', [[user(MGR_ANCHOR), step('a_mgr_1', MGR_ANCHOR), step('a_mgr_x', 'msg_later_turn')]]);
      await expectHold('uncovered_assistant_turn');
    });

    it('holds a manager turn that is not terminal, has two terminals, is incomplete or has no step', async () => {
      f.engine.pages.set('sdk-mgr', [[user(MGR_ANCHOR), step('a_mgr_1', MGR_ANCHOR, { finish: 'tool-calls' })]]);
      await expectHold('turn_not_terminal');
      f.engine.pages.set('sdk-mgr', [[user(MGR_ANCHOR), step('a_mgr_1', MGR_ANCHOR), step('a_mgr_2', MGR_ANCHOR)]]);
      await expectHold('turn_not_terminal');
      f.engine.pages.set('sdk-mgr', [[user(MGR_ANCHOR), step('a_mgr_1', MGR_ANCHOR, { time: {} })]]);
      await expectHold('turn_incomplete');
      f.engine.pages.set('sdk-mgr', [[user(MGR_ANCHOR)]]);
      await expectHold('accounting_missing');
    });

    it('holds a descendant with no assistant step or an incomplete one (never a zero)', async () => {
      f.engine.pages.set('sdk-grand1', [[user('u_g1')]]);
      await expectHold('accounting_missing');
      f.engine.pages.set('sdk-grand1', [[user('u_g1'), step('a_g1', 'u_g1', { time: {} })]]);
      await expectHold('turn_incomplete');
    });

    it('holds when any step lacks actual token components, or reports reasoning without an explicit total', async () => {
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2', 'u_c2', { tokens: undefined })]]);
      await expectHold('usage_incomplete');
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2', 'u_c2', {
        tokens: { input: 1, output: 1, reasoning: 7, cache: { read: 0, write: 0 } },
      })]]);
      await expectHold('usage_incomplete');
    });
  });

  describe('first correction: manager project and closed-turn policy', () => {
    const setManagerProject = (value: string | null) => {
      if (value) {
        getDb().prepare(`INSERT OR IGNORE INTO projects (id, name, cwd, created_at) VALUES (?, 'Foreign', '/repo/foreign', ?)`)
          .run(value, new Date().toISOString());
      }
      getDb().prepare('UPDATE agent_sessions SET project_id=? WHERE id=?').run(value, f.managerId);
    };

    it('keeps the inherited-project positive: the manager row carries the root project and coverage is complete', async () => {
      expect(getDb().prepare('SELECT project_id AS p FROM agent_sessions WHERE id=?').get(f.managerId)).toEqual({ p: PROJECT });
      expect((await f.inspect()).status).toBe('complete');
    });

    it.each([['null', null], ['foreign', 'project-foreign']])('holds when the manager project is %s at the start', async (_name, value) => {
      setManagerProject(value);
      await expectHold('local_binding_changed');
      expect(f.engine.identityCalls).toBe(0); // refused before any engine read
    });

    it.each([['null', null], ['foreign', 'project-foreign']])('holds when the manager project becomes %s during the awaited reads', async (_name, value) => {
      f.engine.onMessages = (sdkId) => { if (sdkId === 'sdk-grand1') setManagerProject(value); };
      await expectHold('local_binding_changed');
    });

    it('holds a descendant turn group with two terminal steps (ambiguous) or with no terminal step', async () => {
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2a', 'u_c2'), step('a_c2b', 'u_c2')]]);
      await expectHold('turn_not_terminal');
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2a', 'u_c2', { finish: 'length' })]]);
      await expectHold('turn_not_terminal');
    });

    it('closes each descendant turn group independently: two closed groups complete, one open group among them holds', async () => {
      f.engine.pages.set('sdk-child2', [[
        user('u_c2'), step('a_c2_tool', 'u_c2', { finish: 'tool-calls' }), step('a_c2_stop', 'u_c2'),
        user('u_c2b'), step('a_c2b_stop', 'u_c2b'),
      ]]);
      expect(await f.inspect()).toMatchObject({ status: 'complete', usage: { assistantStepCount: 10 } });
      f.engine.pages.set('sdk-child2', [[
        user('u_c2'), step('a_c2_stop', 'u_c2'), user('u_c2b'), step('a_c2b_tool', 'u_c2b', { finish: 'tool-calls' }),
      ]]);
      await expectHold('turn_not_terminal');
    });

    it('holds an errored or unparented step instead of guessing success or summing a smaller total', async () => {
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2', 'u_c2', { error: { name: 'APIError' } })]]);
      await expectHold('turn_not_terminal');
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2', undefined as never, {})]]);
      await expectHold('uncovered_assistant_turn');
      f.engine.pages.set('sdk-child2', [[user('u_c2'), step('a_c2', 'u_c2')]]);
      f.engine.pages.set('sdk-mgr', [[user(MGR_ANCHOR), step('a_mgr_1', MGR_ANCHOR, { error: { name: 'APIError' } })]]);
      await expectHold('turn_not_terminal');
    });

    it('holds a charged root anchor whose group has two terminals or an error, but charges only that exact anchor set', async () => {
      f.engine.pages.set('sdk-root', [[
        user('msg_root_1'), step('a_root_1', 'msg_root_1'), step('a_root_1b', 'msg_root_1'),
        user('msg_review_2'), step('a_review_2', 'msg_review_2'),
      ]]);
      await expectHold('turn_not_terminal');
      f.engine.pages.set('sdk-root', [[
        user('msg_root_1'), step('a_root_1', 'msg_root_1', { error: { name: 'APIError' } }),
        user('msg_review_2'), step('a_review_2', 'msg_review_2'),
      ]]);
      await expectHold('turn_not_terminal');
    });

    it('does not require unrelated root activity to be idle or closed', async () => {
      f.engine.busy.add('sdk-root');
      f.engine.pendingQuestion.add('sdk-root');
      f.engine.pages.set('sdk-root', [[
        user('msg_root_1'), step('a_root_1', 'msg_root_1'), user('msg_review_2'), step('a_review_2', 'msg_review_2'),
        user('msg_unrelated'), step('a_unrelated_tool', 'msg_unrelated', { finish: 'tool-calls' }),
      ]]);
      expect(await f.inspect()).toMatchObject({ status: 'complete', usage: { assistantStepCount: 7 } });
    });
  });
});
