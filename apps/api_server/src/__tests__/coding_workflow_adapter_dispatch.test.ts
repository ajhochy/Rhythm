/**
 * G2 first adapter: the ACTUAL delegateToAgentAsync -> OpencodeClientService.promptAsync
 * boundary exports a typed pre-SDK receipt. Only the engine network edge is
 * stubbed (SDK `session.promptAsync`/`create` and the anchor `fetch`); the
 * production request body, provenance row and receipt code run unchanged.
 * This is source proof, not a live engine run.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { engine, sessionMap, streamSession } = vi.hoisted(() => ({
  engine: {
    createSession: vi.fn(),
    createWorktree: vi.fn(),
    getEngineIdentity: vi.fn(),
    listAuthedProviders: vi.fn(),
    listModels: vi.fn(),
    listProviders: vi.fn(),
    promptAsync: vi.fn(),
    removeWorktree: vi.fn(),
  },
  sessionMap: new Map<string, string>(),
  streamSession: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({ opencodeClient: engine, opencodeSessionMap: sessionMap }));
vi.mock('../services/opencode_stream_bridge', () => ({ streamBridge: { streamSession } }));

import { parseCodingWorkflowDispatchReceipt } from '../contracts/coordinator_conversation_contract';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import {
  CodingWorkflowDeliveryUnknownError,
  delegateToAgentAsync,
  type CodingWorkflowDispatchInput,
} from '../services/agent_delegation_service';
import { OpencodeClientService } from '../services/opencode_client_service';

const ANCHOR = 'msg_native_workflow_anchor_1';
const IDENTITY = { version: '1.2.3', pid: 4242, bootId: 'boot-a' };
const PROJECT = 'project-g2';

function seedProfile(id: string, manager = false): void {
  new AgentConfigsRepository().insert({
    id, label: id, icon: 'agent', enabled: true, isAgent: true, isManager: manager, sessionSelectable: true,
    allowedDelegatesJson: manager ? JSON.stringify(['workflow-orchestrator']) : null,
    modelProvider: 'google', modelId: 'gemini-2.5-pro', ocAgent: id,
    corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
  });
}

function seedParent(): string {
  const repo = new AgentSessionsRepository();
  const parent = repo.insert({
    agentKind: 'manager' as never, taskId: null, cwd: '/repo/manager', name: 'manager', mcpRole: 'manager', ownerUserId: 42,
  });
  repo.setSdkSessionId(parent.id, 'sdk-parent');
  getDb().prepare('UPDATE agent_sessions SET project_id=? WHERE id=?').run(PROJECT, parent.id);
  return parent.id;
}

describe('Coding Workflow dispatch receipt at the actual SDK boundary', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sdkPrompt: Mock<(...args: any[]) => any>;
  let createCalls: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetcher: Mock<(...args: any[]) => any>;
  const previousExports = process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
  const provenance = new ModelProvenanceRepository();

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    db.prepare("INSERT INTO users (id,name,email) VALUES (42,'Test','g2-adapter@example.com')").run();
    db.prepare(`INSERT INTO projects (id, name, cwd, created_at) VALUES (?, 'G2', '/repo/manager', ?)`).run(PROJECT, new Date().toISOString());
    sessionMap.clear();
    vi.clearAllMocks();
    createCalls = 0;
    sdkPrompt = vi.fn(async () => ({ response: { status: 204 } }));
    const native = new OpencodeClientService();
    (native as unknown as { client: unknown }).client = {
      session: {
        create: async () => { createCalls += 1; return { data: { id: 'sdk-child' } }; },
        promptAsync: (...args: unknown[]) => sdkPrompt(...args),
      },
    };
    (native as unknown as { status: string }).status = 'ready';
    (native as unknown as { server: unknown }).server = { url: 'http://engine.test', close() {} };
    process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = '1';
    fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ messageID: ANCHOR }) }));
    vi.stubGlobal('fetch', fetcher);
    engine.createSession.mockImplementation(native.createSession.bind(native));
    engine.promptAsync.mockImplementation(native.promptAsync.bind(native));
    engine.getEngineIdentity.mockResolvedValue(IDENTITY);
    engine.listProviders.mockResolvedValue([]);
    streamSession.mockResolvedValue(undefined);
    seedProfile('manager', true);
    seedProfile('workflow-orchestrator');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousExports === undefined) delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
    else process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = previousExports;
  });

  function workflow(over: Partial<CodingWorkflowDispatchInput> = {}, phases: string[] = []): CodingWorkflowDispatchInput {
    return {
      authorization: { authorizationId: 'auth-1', ordinal: 1, workstreamId: 'ws-1', goalId: 'goal-1' },
      expectedProjectId: PROJECT,
      validate: (phase) => { phases.push(phase); return true; },
      isCurrent: () => { phases.push('final_sync'); return true; },
      // Production's only typed caller always supplies these durable hooks
      // (coordinator onPrepared/onOutcome + server enroll); they are required.
      workflowBinding: { jobId: 'job-1', expiresAt: '2099-01-01T00:00:00.000Z' },
      onPrepared: () => true,
      enroll: async () => true,
      onOutcome: () => {},
      ...over,
    };
  }
  const delegate = (callerSessionId: string, codingWorkflow?: CodingWorkflowDispatchInput) => delegateToAgentAsync({
    authenticatedUserId: 42, callerSessionId, targetAgentConfigId: 'workflow-orchestrator',
    prompt: 'Fix the login bug.', ...(codingWorkflow ? { codingWorkflow } : {}),
  });
  const childDispatches = () => (getDb().prepare(
    `SELECT id, session_id, sdk_session_id, sdk_user_message_id, origin, route_authed, reason_code, outcome
     FROM agent_turn_dispatches WHERE sdk_session_id='sdk-child'`).all() as Array<Record<string, unknown>>);

  it('SOL fixed Coding Workflow adapter refuses another otherwise allowed specialist before any child or SDK call', async () => {
    const parentId = seedParent();
    seedProfile('other-specialist');
    getDb().prepare('UPDATE agent_configs SET allowed_delegates_json=? WHERE id=?')
      .run(JSON.stringify(['workflow-orchestrator', 'other-specialist']), 'manager');
    await expect(delegateToAgentAsync({
      authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'other-specialist',
      prompt: 'Synthetic bounded workflow task.', codingWorkflow: workflow(),
    })).rejects.toThrow();
    expect(engine.createSession).not.toHaveBeenCalled();
    expect(sdkPrompt).not.toHaveBeenCalled();
  });

  it('mints the native anchor, persists the exact row BEFORE the SDK request, exports the receipt and settles accepted', async () => {
    const parentId = seedParent();
    const phases: string[] = [];
    let atSdk: { rows: Array<Record<string, unknown>>; phases: string[]; body: Record<string, unknown> } | null = null;
    sdkPrompt.mockImplementation(async (request: { body: Record<string, unknown> }) => {
      atSdk = { rows: childDispatches(), phases: [...phases], body: request.body };
      return { response: { status: 204 } };
    });
    const result = await delegate(parentId, workflow({}, phases));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('http://engine.test/session/sdk-child/rhythm-prompt-anchor?directory=%2Frepo%2Fmanager');
    // At the instant the request reached the SDK: the real anchor is in the body and the pending row is already durable.
    expect(atSdk!.body.messageID).toBe(ANCHOR);
    expect(atSdk!.rows).toEqual([expect.objectContaining({
      session_id: result.sessionId, sdk_user_message_id: ANCHOR, origin: 'delegation', route_authed: null,
      reason_code: 'g2_coding_workflow', outcome: 'pending',
    })]);
    expect(atSdk!.phases).toEqual(['prepare', 'prepare', 'before_sdk', 'sdk_exposure', 'final_sync']);

    const delegation = new AgentAsyncDelegationsRepository().findByChildSessionId(result.sessionId)!;
    const receipt = parseCodingWorkflowDispatchReceipt(result.workflowReceipt)!;
    expect(receipt).toEqual({
      schemaVersion: 1, adapter: 'coding_workflow_v1',
      authorization: { authorizationId: 'auth-1', ordinal: 1, workstreamId: 'ws-1', goalId: 'goal-1' },
      owner: { ownerUserId: 42, projectId: PROJECT, rootSessionId: parentId, rootSdkSessionId: 'sdk-parent' },
      delegation: {
        delegationId: delegation.id, managerSessionId: result.sessionId,
        managerSdkSessionId: 'sdk-child', nativeParentSdkSessionId: 'sdk-parent',
      },
      dispatch: { dispatchId: childDispatches()[0].id, sdkUserMessageId: ANCHOR, delivery: 'accepted' },
      engine: IDENTITY,
    });
    expect(childDispatches()).toEqual([expect.objectContaining({ outcome: 'accepted' })]);
    expect(delegation.status).toBe('dispatched');
  });

  it('leaves calls without the typed input exactly on the old path (no mint, no receipt, no reason code)', async () => {
    const parentId = seedParent();
    const result = await delegate(parentId);
    expect(result.workflowReceipt).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect(sdkPrompt.mock.calls[0][0].body.messageID).toBeUndefined();
    expect(childDispatches()).toEqual([expect.objectContaining({ reason_code: null, outcome: 'accepted' })]);
  });

  describe('missing or stale input holds before any SDK exposure', () => {
    it('a failed anchor mint sends nothing and writes no dispatch row', async () => {
      const parentId = seedParent();
      fetcher.mockResolvedValue({ ok: false, json: async () => ({}) });
      await expect(delegate(parentId, workflow())).rejects.toThrow(/enqueue/);
      expect(sdkPrompt).not.toHaveBeenCalled();
      expect(childDispatches()).toEqual([]);
      const child = new AgentSessionsRepository().findBySdkSessionId('sdk-child')!;
      expect(new AgentAsyncDelegationsRepository().findByChildSessionId(child.id)?.status).toBe('failed');
    });

    it('an unavailable engine identity sends nothing and writes no row', async () => {
      const parentId = seedParent();
      engine.getEngineIdentity.mockResolvedValue(null);
      await expect(delegate(parentId, workflow())).rejects.toThrow(/engine identity/);
      expect(sdkPrompt).not.toHaveBeenCalled();
      expect(childDispatches()).toEqual([]);
    });

    it('a mismatched project or a lost admission refuses before any child session is created', async () => {
      const parentId = seedParent();
      await expect(delegate(parentId, workflow({ expectedProjectId: 'other-project' }))).rejects.toThrow(/project scope/);
      await expect(delegate(parentId, workflow({ validate: () => false }))).rejects.toThrow(/admission is no longer current/);
      expect(createCalls).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(['before_sdk', 'sdk_exposure'] as const)('losing the admission at %s rejects the durable row and sends nothing', async (lost) => {
      const parentId = seedParent();
      await expect(delegate(parentId, workflow({ validate: (phase) => phase !== lost }))).rejects.toThrow(/enqueue/);
      expect(sdkPrompt).not.toHaveBeenCalled();
      expect(childDispatches()).toEqual([expect.objectContaining({ sdk_user_message_id: ANCHOR, outcome: 'rejected' })]);
    });

    it('a synchronous final proof that fails at the last instant sends nothing', async () => {
      const parentId = seedParent();
      await expect(delegate(parentId, workflow({ isCurrent: () => false }))).rejects.toThrow(/enqueue/);
      expect(sdkPrompt).not.toHaveBeenCalled();
      expect(childDispatches()).toEqual([expect.objectContaining({ outcome: 'rejected' })]);
    });

    it('a parent permission change during the awaited phases withholds the request', async () => {
      const parentId = seedParent();
      await expect(delegate(parentId, workflow({
        validate: (phase) => {
          if (phase === 'before_sdk') new AgentSessionsRepository().updatePermissionMode(parentId, 'plan');
          return true;
        },
      }))).rejects.toThrow();
      expect(sdkPrompt).not.toHaveBeenCalled();
    });
  });

  describe('delivery outcomes', () => {
    it('an engine error response is a definitive rejection: ordinary failure, receipt never exported', async () => {
      const parentId = seedParent();
      sdkPrompt.mockResolvedValue({ error: { message: 'bad model' } });
      await expect(delegate(parentId, workflow())).rejects.not.toBeInstanceOf(CodingWorkflowDeliveryUnknownError);
      expect(childDispatches()).toEqual([expect.objectContaining({ outcome: 'rejected' })]);
      const child = new AgentSessionsRepository().findBySdkSessionId('sdk-child')!;
      expect(new AgentAsyncDelegationsRepository().findByChildSessionId(child.id)?.status).toBe('failed');
    });

    it('a transport error after the request left is UNKNOWN: typed receipt, row unknown, delegation not failed', async () => {
      const parentId = seedParent();
      sdkPrompt.mockRejectedValue(new Error('socket hang up'));
      const error = await delegate(parentId, workflow()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CodingWorkflowDeliveryUnknownError);
      const receipt = parseCodingWorkflowDispatchReceipt((error as CodingWorkflowDeliveryUnknownError).receipt)!;
      expect(receipt.dispatch).toMatchObject({ sdkUserMessageId: ANCHOR, delivery: 'unknown' });
      expect(childDispatches()).toEqual([expect.objectContaining({ sdk_user_message_id: ANCHOR, outcome: 'unknown' })]);
      const child = new AgentSessionsRepository().findBySdkSessionId('sdk-child')!;
      expect(new AgentAsyncDelegationsRepository().findByChildSessionId(child.id)?.status).toBe('dispatched');
      expect(child.status).not.toBe('error');
    });

    it('the ordinary path keeps its before behavior: a transport error settles rejected and fails the delegation', async () => {
      const parentId = seedParent();
      sdkPrompt.mockRejectedValue(new Error('socket hang up'));
      await expect(delegate(parentId)).rejects.toThrow(/enqueue/);
      expect(childDispatches()).toEqual([expect.objectContaining({ outcome: 'rejected' })]);
    });
  });

  describe('first correction: fixed target and pre-worktree preflight', () => {
    const worktreeResult = { name: 'wt', directory: '/repo/.worktrees/wt', branch: null };
    const allowOtherSpecialist = () => {
      seedProfile('other-specialist');
      getDb().prepare('UPDATE agent_configs SET allowed_delegates_json=? WHERE id=?')
        .run(JSON.stringify(['workflow-orchestrator', 'other-specialist']), 'manager');
    };

    it('refuses another allowed target with an isolated worktree requested: no worktree, no child, no admission call, no SDK', async () => {
      const parentId = seedParent();
      allowOtherSpecialist();
      const phases: string[] = [];
      await expect(delegateToAgentAsync({
        authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'other-specialist',
        prompt: 'Synthetic bounded workflow task.', isolateWorktree: true, codingWorkflow: workflow({}, phases),
      })).rejects.toThrow(/fixed to the workflow-orchestrator/);
      expect(engine.createWorktree).not.toHaveBeenCalled();
      expect(engine.createSession).not.toHaveBeenCalled();
      expect(sdkPrompt).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(phases).toEqual([]);
    });

    it('keeps untyped delegation of another allowed specialist exactly as before (same arity, no receipt, no reason code)', async () => {
      const parentId = seedParent();
      allowOtherSpecialist();
      const result = await delegateToAgentAsync({
        authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'other-specialist', prompt: 'Read the plan.',
      });
      expect(result.workflowReceipt).toBeUndefined();
      expect(engine.promptAsync.mock.calls[0]).toHaveLength(8);
      expect(fetcher).not.toHaveBeenCalled();
      expect(childDispatches()).toEqual([expect.objectContaining({ reason_code: null, outcome: 'accepted' })]);
    });

    it('runs the project/admission preflight BEFORE the worktree and re-validates AFTER it, before any child session', async () => {
      const parentId = seedParent();
      const events: string[] = [];
      engine.createWorktree.mockImplementation(async () => { events.push('createWorktree'); return worktreeResult; });
      const createSession = engine.createSession.getMockImplementation()!;
      engine.createSession.mockImplementation(async (...args: unknown[]) => { events.push('createSession'); return createSession(...args); });
      const result = await delegateToAgentAsync({
        authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'workflow-orchestrator',
        prompt: 'Fix the login bug.', isolateWorktree: true,
        codingWorkflow: workflow({ validate: (phase) => { events.push(`validate:${phase}`); return true; } }),
      });
      expect(events.slice(0, 4)).toEqual(['validate:prepare', 'createWorktree', 'validate:prepare', 'createSession']);
      expect(result.workflowReceipt?.dispatch.delivery).toBe('accepted');
    });

    it('a project mismatch refuses before the worktree is created', async () => {
      const parentId = seedParent();
      await expect(delegate(parentId, workflow({ expectedProjectId: 'other-project' }))).rejects.toThrow(/project scope/);
      await expect(delegateToAgentAsync({
        authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'workflow-orchestrator',
        prompt: 'x', isolateWorktree: true, codingWorkflow: workflow({ expectedProjectId: 'other-project' }),
      })).rejects.toThrow(/project scope/);
      expect(engine.createWorktree).not.toHaveBeenCalled();
    });

    it('an admission lost at the preflight refuses before the worktree', async () => {
      const parentId = seedParent();
      await expect(delegateToAgentAsync({
        authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'workflow-orchestrator',
        prompt: 'x', isolateWorktree: true, codingWorkflow: workflow({ validate: () => false }),
      })).rejects.toThrow(/admission is no longer current/);
      expect(engine.createWorktree).not.toHaveBeenCalled();
      expect(engine.createSession).not.toHaveBeenCalled();
    });

    it('an admission lost DURING the awaited worktree creation refuses before the child session or any SDK request', async () => {
      const parentId = seedParent();
      let admitted = true;
      engine.createWorktree.mockImplementation(async () => { admitted = false; return worktreeResult; });
      await expect(delegateToAgentAsync({
        authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'workflow-orchestrator',
        prompt: 'x', isolateWorktree: true, codingWorkflow: workflow({ validate: () => admitted }),
      })).rejects.toThrow(/admission is no longer current/);
      expect(engine.createSession).not.toHaveBeenCalled();
      expect(sdkPrompt).not.toHaveBeenCalled();
      expect(childDispatches()).toEqual([]);
    });

    it('a root project change DURING the awaited worktree creation refuses before the child session', async () => {
      const parentId = seedParent();
      engine.createWorktree.mockImplementation(async () => {
        getDb().prepare('UPDATE agent_sessions SET project_id=NULL WHERE id=?').run(parentId);
        return worktreeResult;
      });
      await expect(delegateToAgentAsync({
        authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'workflow-orchestrator',
        prompt: 'x', isolateWorktree: true, codingWorkflow: workflow(),
      })).rejects.toThrow(/project scope/);
      expect(engine.createSession).not.toHaveBeenCalled();
      expect(sdkPrompt).not.toHaveBeenCalled();
    });
  });

  describe('SOL prepare-await current project', () => {
    it.each([['before worktree', 1], ['after worktree', 2]] as const)(
      'refuses a project change during the admission await %s before subsequent effects', async (_name, revokeOnPrepare) => {
        const parentId = seedParent();
        let prepareCount = 0;
        engine.createWorktree.mockResolvedValue({ name: 'isolated', directory: '/repo/worktree', branch: 'test-branch' });
        await expect(delegateToAgentAsync({
          authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'workflow-orchestrator',
          prompt: 'Synthetic bounded workflow task.', isolateWorktree: true,
          codingWorkflow: workflow({ validate: async (phase) => {
            await Promise.resolve();
            if (phase === 'prepare' && ++prepareCount === revokeOnPrepare) {
              getDb().prepare('UPDATE agent_sessions SET project_id=NULL WHERE id=?').run(parentId);
            }
            return true;
          } }),
        })).rejects.toThrow(/project scope/);
        expect(engine.createWorktree).toHaveBeenCalledTimes(revokeOnPrepare === 1 ? 0 : 1);
        expect(engine.createSession).not.toHaveBeenCalled();
        expect(sdkPrompt).not.toHaveBeenCalled();
        expect(childDispatches()).toEqual([]);
      },
    );
  });

  it('SOL final exposure refuses a root project change during sdk_exposure validation before the actual SDK request', async () => {
    const parentId = seedParent();
    await expect(delegate(parentId, workflow({ validate: async (phase) => {
      await Promise.resolve();
      if (phase === 'sdk_exposure') {
        getDb().prepare('UPDATE agent_sessions SET project_id=NULL WHERE id=?').run(parentId);
      }
      return true;
    } }))).rejects.toThrow();
    expect(sdkPrompt).not.toHaveBeenCalled();
    expect(childDispatches()).not.toContainEqual(expect.objectContaining({ outcome: 'accepted' }));
  });

  describe('G2 S2: durable hooks are required only AFTER the accepted preflight refusals', () => {
    const hookless = (over: Partial<CodingWorkflowDispatchInput> = {}): CodingWorkflowDispatchInput => {
      const full = workflow(over);
      delete full.workflowBinding; delete full.onPrepared; delete full.enroll; delete full.onOutcome;
      return full;
    };
    it('a hookless input still reports the accepted project/admission refusal reasons', async () => {
      const parentId = seedParent();
      await expect(delegate(parentId, hookless({ expectedProjectId: 'other-project' }))).rejects.toThrow(/project scope/);
      await expect(delegate(parentId, hookless({ validate: () => false }))).rejects.toThrow(/admission is no longer current/);
    });
    it('a current hookless input is refused by name before any worktree, child session or SDK request', async () => {
      const parentId = seedParent();
      engine.createWorktree.mockResolvedValue({ name: 'isolated', directory: '/repo/worktree', branch: 'test-branch' });
      await expect(delegateToAgentAsync({
        authenticatedUserId: 42, callerSessionId: parentId, targetAgentConfigId: 'workflow-orchestrator',
        prompt: 'x', isolateWorktree: true, codingWorkflow: hookless(),
      })).rejects.toThrow(/durable enrollment is unavailable/);
      expect(engine.createWorktree).not.toHaveBeenCalled();
      expect(createCalls).toBe(0);
      expect(sdkPrompt).not.toHaveBeenCalled();
      expect(childDispatches()).toEqual([]);
    });
  });
});
