/**
 * CONTRACT TESTS — production-trigger path parity (issue A).
 *
 * The LOCAL path (env.agentLocal === true) already resolves per-task model
 * override + profile scope inheritance via resolveProfileScope (see
 * scheduler_dispatch_contract.test.ts). The PRODUCTION path
 * (env.agentLocal === false) inserts a pending_claude_triggers row and was
 * forwarding the task's RAW allowlists with no model. This file locks in that
 * the production INSERT now carries the EFFECTIVE scope + model, resolved
 * through the SAME helper, with precedence task override > profile > default.
 *
 * Strategy mirrors scheduler_dispatch_contract.test.ts: mock the DB so the
 * INSERT bind params are captured (mockDbRun), and mock resolveProfileScope so
 * the effective scope/model are controllable. Then assert (a) the helper is
 * called with the override-or-inherit value resolveTaskScopeOverride produces,
 * and (b) the captured INSERT params carry the effective values.
 *
 * Each test names the regression it guards.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockRun,
  mockFindDueAsync,
  mockUpdateNextRunAsync,
  mockDbRun,
  mockResetStaleRunning,
  mockResolveProfileScope,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockFindDueAsync: vi.fn(),
  mockUpdateNextRunAsync: vi.fn().mockResolvedValue(undefined),
  mockDbRun: vi.fn(),
  mockResetStaleRunning: vi.fn().mockReturnValue(0),
  mockResolveProfileScope: vi.fn(),
}));

vi.mock('../services/agent_runner', () => ({
  run: mockRun,
  _activeRunCount: () => 0,
}));

vi.mock('../services/agent_profile_scope', () => ({
  resolveProfileScope: mockResolveProfileScope,
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-sess-1' }),
    promptAsync: vi.fn().mockResolvedValue(true),
    abortSession: vi.fn().mockResolvedValue(true),
    listMessages: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../database/db', () => ({
  getDb: () => ({ prepare: () => ({ run: mockDbRun }) }),
  getPostgresPool: vi.fn(),
}));

vi.mock('../repositories/agent_scheduled_tasks_repository', () => ({
  AgentScheduledTasksRepository: class {
    findDueAsync = mockFindDueAsync;
    updateNextRunAsync = mockUpdateNextRunAsync;
  },
}));

vi.mock('../repositories/agent_sessions_repository', () => ({
  AgentSessionsRepository: class {
    resetStaleRunning = mockResetStaleRunning;
    findMostRecentlyUsedModel = vi.fn().mockReturnValue(null);
  },
}));

import { startAgentSchedulerJob } from '../services/agentSchedulerService';
import { env } from '../config/env';

function makeDueTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-uuid-1',
    name: 'Test Task',
    description: null,
    prompt: 'Do something useful',
    allowedMcpsJson: null as string | null,
    allowedSkillsJson: null as string | null,
    modelProvider: null as string | null,
    modelId: null as string | null,
    scheduleType: 'daily',
    scheduledTime: '09:00',
    scheduledDay: null,
    cronExpression: null,
    runAt: null,
    timezone: 'America/Los_Angeles',
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    agentKind: 'opencode',
    agentConfigId: 'profile-1',
    enabled: true,
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Run one scheduler tick on the PRODUCTION path and return captured state. */
async function dispatchProd(task: Record<string, unknown>): Promise<{
  insertArgs: unknown[];
  scopeArgs: [unknown, Record<string, unknown>] | undefined;
}> {
  mockFindDueAsync.mockResolvedValue([task]);
  const cronTask = startAgentSchedulerJob();
  cronTask.stop();
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  // Production path must NOT invoke AgentRunner.run — it inserts a trigger.
  expect(mockRun).not.toHaveBeenCalled();
  expect(mockDbRun).toHaveBeenCalledOnce();
  return {
    insertArgs: mockDbRun.mock.calls[0] as unknown[],
    scopeArgs: mockResolveProfileScope.mock.calls[0] as
      | [unknown, Record<string, unknown>]
      | undefined,
  };
}

describe('production-trigger parity — model override + profile scope inheritance', () => {
  let agentLocalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateNextRunAsync.mockResolvedValue(undefined);
    // Production path: agentLocal=false → scheduler inserts a pending trigger.
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(false);
    // Default effective scope/model returned by the (mocked) shared helper.
    // The profile's effective MCP allowlist is echoed via mcpRoleConfig.allowedToolsJson.
    mockResolveProfileScope.mockResolvedValue({
      model: { providerID: 'profile-prov', modelID: 'profile-model' },
      mcpRoleConfig: {
        role: 'profile-1',
        mcpServers: { rhythm: { allowedTools: [] } },
        allowedToolsJson: JSON.stringify(['rhythm', 'gmail-personal']),
      },
      allowedSkillsJson: JSON.stringify(['profile-skill']),
      systemPrompt: null,
      ocAgent: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_LOCAL;
  });

  // Regression: scheduler keeps forwarding the RAW null allowlist → the trigger
  // row never inherits the profile's MCP scope on the production path.
  it('AC1: task with null allowed_mcps_json → helper called with override=undefined (inherit) and row carries profile MCP allowlist', async () => {
    const { insertArgs, scopeArgs } = await dispatchProd(makeDueTask({ allowedMcpsJson: null }));
    expect(mockResolveProfileScope).toHaveBeenCalledOnce();
    expect(scopeArgs?.[0]).toBe('profile-1');
    expect(scopeArgs?.[1].allowedMcpsJsonOverride).toBeUndefined();
    expect(scopeArgs?.[1].allowedSkillsJsonOverride).toBeUndefined();
    // Effective values from the profile are persisted into the trigger row.
    expect(insertArgs).toContain(JSON.stringify(['rhythm', 'gmail-personal']));
    expect(insertArgs).toContain(JSON.stringify(['profile-skill']));
  });

  it('AC1b: task with empty allowed_mcps_json array → helper called with override=undefined (inherit)', async () => {
    const { scopeArgs } = await dispatchProd(makeDueTask({ allowedMcpsJson: '[]' }));
    expect(scopeArgs?.[1].allowedMcpsJsonOverride).toBeUndefined();
  });

  // Regression: an explicit task allowlist stops overriding the profile on the
  // production path.
  it('AC2: task with explicit allowed_mcps_json → helper called with that override and row carries it', async () => {
    // Helper echoes the override back through mcpRoleConfig.allowedToolsJson.
    mockResolveProfileScope.mockResolvedValueOnce({
      model: { providerID: 'profile-prov', modelID: 'profile-model' },
      mcpRoleConfig: {
        role: 'profile-1',
        mcpServers: { rhythm: { allowedTools: [] } },
        allowedToolsJson: JSON.stringify(['rhythm']),
      },
      allowedSkillsJson: JSON.stringify(['skill-a']),
      systemPrompt: null,
      ocAgent: null,
    });
    const { insertArgs, scopeArgs } = await dispatchProd(
      makeDueTask({
        allowedMcpsJson: JSON.stringify(['rhythm']),
        allowedSkillsJson: JSON.stringify(['skill-a']),
      }),
    );
    expect(scopeArgs?.[1].allowedMcpsJsonOverride).toBe(JSON.stringify(['rhythm']));
    expect(scopeArgs?.[1].allowedSkillsJsonOverride).toBe(JSON.stringify(['skill-a']));
    expect(insertArgs).toContain(JSON.stringify(['rhythm']));
    expect(insertArgs).toContain(JSON.stringify(['skill-a']));
  });

  // Regression: the production trigger carries no model → a per-task model
  // override is silently dropped on the prod-drained path.
  it('AC3: task with model_provider+model_id → row carries that exact model', async () => {
    const { insertArgs } = await dispatchProd(
      makeDueTask({ modelProvider: 'anthropic', modelId: 'claude-opus-4-1' }),
    );
    expect(insertArgs).toContain('anthropic');
    expect(insertArgs).toContain('claude-opus-4-1');
  });

  // Regression: a task without a model override writes nothing → the drain
  // can't even fall back to the profile model without re-resolving.
  it('AC4: task without model columns → row carries the profile-resolved model', async () => {
    const { insertArgs } = await dispatchProd(makeDueTask());
    expect(insertArgs).toContain('profile-prov');
    expect(insertArgs).toContain('profile-model');
  });
});
