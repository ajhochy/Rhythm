import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentKind } from '../models/agent_session';
import { delegateToAgent } from '../services/agent_delegation_service';
import { AgentDelegationController } from '../controllers/agent_delegation_controller';

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
}));

const { listCatalogMock } = vi.hoisted(() => ({ listCatalogMock: vi.fn() }));

vi.mock('../services/agent_runner', () => ({
  run: runMock,
}));

vi.mock('../routes/agents_models_routes', () => ({
  listAgentModelCatalog: listCatalogMock,
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedProfiles(repo: AgentConfigsRepository) {
  repo.insert({
    id: 'manager',
    label: 'Manager',
    icon: '',
    isManager: true,
    allowedDelegatesJson: JSON.stringify(['specialist']),
  });
  repo.insert({
    id: 'specialist',
    label: 'Specialist',
    icon: '',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    allowedMcpsJson: JSON.stringify(['rhythm']),
    allowedSkillsJson: JSON.stringify(['coding-agent']),
  });
  repo.insert({
    id: 'other-specialist',
    label: 'Other Specialist',
    icon: '',
  });
  repo.insert({
    id: 'non-manager',
    label: 'Non Manager',
    icon: '',
    isManager: false,
    allowedDelegatesJson: JSON.stringify(['specialist']),
  });
}

describe('manager delegation authorization contracts', () => {
  let sessionRepo: AgentSessionsRepository;

  function seedCallerSession(
    profileId = 'manager',
    opts: { depth?: number; ownerUserId?: number | null } = {},
  ): string {
    return sessionRepo.insert({
      agentKind: profileId as AgentKind,
      taskId: null,
      cwd: process.cwd(),
      name: `${profileId} session`,
      mcpRole: profileId,
      ownerUserId: opts.ownerUserId ?? 42,
      delegationDepth: opts.depth ?? 0,
    }).id;
  }

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    db.prepare(`INSERT INTO users (id, name, email) VALUES (42, 'Test User', 'test@example.com')`).run();
    const repo = new AgentConfigsRepository();
    seedProfiles(repo);
    sessionRepo = new AgentSessionsRepository();
    runMock.mockReset();
    runMock.mockResolvedValue({
      sessionId: 'delegate-session',
      status: 'done',
      result: 'delegated result',
    });
    listCatalogMock.mockResolvedValue([
      { provider: 'anthropic', modelId: 'claude-sonnet-4-5', authorized: true },
    ]);
  });

  it('issue-P4-manager-delegation-c3: allowed manager delegation invokes target profile', async () => {
    // Regression caught: delegation runs under the caller profile or bypasses the
    // runner, so the target profile's resolveProfileScope path is never used.
    const result = await delegateToAgent({
      authenticatedUserId: 42,
      callerSessionId: seedCallerSession('manager'),
      targetAgentConfigId: 'specialist',
      prompt: 'Implement the focused task.',
      callerAgentConfigId: 'manager',
    });

    expect(result).toMatchObject({
      sessionId: 'delegate-session',
      output: 'delegated result',
      targetAgentConfigId: 'specialist',
    });
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentConfigId: 'specialist',
        agentKind: 'specialist',
        prompt: 'Implement the focused task.',
        outputTarget: 'session',
        ownerUserId: 42,
        delegationDepth: 1,
      }),
    );
  });

  it('issue-001-c5: forwards a supplied model only as the runner override', async () => {
    // Regression caught: the delegation accepts model input but silently runs the
    // target profile default instead of forwarding the explicit override.
    await delegateToAgent({
      authenticatedUserId: 42,
      callerSessionId: seedCallerSession('manager'),
      targetAgentConfigId: 'specialist',
      prompt: 'Use the requested model.',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
    });

    expect(runMock).toHaveBeenCalledWith(expect.objectContaining({
      modelOverride: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
    }));
  });

  it('issue-001-c2: omitting model leaves the runner override absent', async () => {
    // Regression caught: an omitted selection is serialized as an override and
    // changes the target profile's normal model-resolution behavior.
    await delegateToAgent({
      authenticatedUserId: 42,
      callerSessionId: seedCallerSession('manager'),
      targetAgentConfigId: 'specialist',
      prompt: 'Use the target profile default.',
    });

    expect(runMock).toHaveBeenCalledWith(expect.not.objectContaining({ modelOverride: expect.anything() }));
  });

  it('issue-001-c6: rejects an unknown override rather than falling back', async () => {
    // Regression caught: an invalid selection is ignored and executes against
    // the target profile's default, misleading the caller about the model used.
    await expect(delegateToAgent({
      authenticatedUserId: 42,
      callerSessionId: seedCallerSession('manager'),
      targetAgentConfigId: 'specialist',
      prompt: 'Do not silently fall back.',
      model: { providerID: 'unknown', modelID: 'unknown-model' },
    })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('model') });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('issue-001-c6: rejects malformed and unauthorized overrides without running', async () => {
    // Regression caught: malformed or unauthenticated selections fall through
    // to the target profile default and run a task the caller did not request.
    const input = {
      authenticatedUserId: 42,
      callerSessionId: seedCallerSession('manager'),
      targetAgentConfigId: 'specialist',
      prompt: 'Do not fall back.',
    };
    await expect(delegateToAgent({ ...input, model: { providerID: 'anthropic' } }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('providerID and modelID') });
    listCatalogMock.mockResolvedValueOnce([
      // An engine-advertised Zen row must be rejected before the runner can
      // create a child; it has neither auth nor an opencode.json provider key.
      { provider: 'opencode', modelId: 'north-mini-code-free', authorized: false },
    ]);
    await expect(delegateToAgent({
      ...input,
      model: { providerID: 'opencode', modelID: 'north-mini-code-free' },
    })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('unknown or unauthorized') });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('issue-001-c6: controller forwards malformed model unchanged and reports 400 without a run', async () => {
    // Regression caught: controller coercion drops malformed input, allowing
    // service default-model delegation instead of returning a client error.
    const controller = new AgentDelegationController();
    const next = vi.fn();
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    const request = {
      body: {
        callerSessionId: seedCallerSession('manager'),
        targetAgentConfigId: 'specialist',
        prompt: 'Malformed model must stop here.',
        model: ['anthropic', 'claude-sonnet-4-5'],
      },
      auth: { user: { id: 42 } },
    };

    await controller.delegate(request as never, res as never, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: expect.stringContaining('providerID and modelID'),
    }));
    expect(res.json).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('issue-P4-manager-delegation-c4: rejects unauthorized and self calls from the resolved caller session', async () => {
    // Regression caught: fail-open authorization lets arbitrary profiles invoke
    // specialists, or delegated specialists recursively fan out.
    await expect(
      delegateToAgent({
        authenticatedUserId: 42,
        callerSessionId: seedCallerSession('manager'),
        targetAgentConfigId: 'other-specialist',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      delegateToAgent({
        authenticatedUserId: 42,
        callerSessionId: seedCallerSession('non-manager'),
        targetAgentConfigId: 'specialist',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      delegateToAgent({
        authenticatedUserId: 42,
        callerSessionId: seedCallerSession('manager'),
        targetAgentConfigId: 'manager',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(runMock).not.toHaveBeenCalled();
  });

  it('issue-914: resolves caller identity from the session row and rejects spoofed caller ids', async () => {
    await expect(
      delegateToAgent({
        authenticatedUserId: 42,
        callerSessionId: seedCallerSession('non-manager'),
        callerAgentConfigId: 'manager',
        targetAgentConfigId: 'specialist',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(runMock).not.toHaveBeenCalled();
  });

  it('issue-914: derives depth from the caller session row and enforces the cap', async () => {
    const result = await delegateToAgent({
      authenticatedUserId: 42,
      callerSessionId: seedCallerSession('manager', { depth: 1 }),
      targetAgentConfigId: 'specialist',
      prompt: 'Implement the task.',
    });
    expect(result).toMatchObject({
      sessionId: 'delegate-session',
      output: 'delegated result',
      targetAgentConfigId: 'specialist',
    });
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ delegationDepth: 2 }));
    runMock.mockClear();

    await expect(
      delegateToAgent({
        authenticatedUserId: 42,
        callerSessionId: seedCallerSession('manager', { depth: 2 }),
        targetAgentConfigId: 'specialist',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('issue-920: propagates delegated run error detail', async () => {
    runMock.mockResolvedValueOnce({
      sessionId: 'delegate-session',
      status: 'error',
      result: '',
      error: 'target MCP is not connected',
    });

    await expect(
      delegateToAgent({
        authenticatedUserId: 42,
        callerSessionId: seedCallerSession('manager'),
        targetAgentConfigId: 'specialist',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      message: 'target MCP is not connected',
    });
  });

  it('issue-1135-c5: rejects a security-locked delegate even if enabled drifts back to 1', async () => {
    const configsRepo = new AgentConfigsRepository();
    expect(
      configsRepo.lockForSecurity(
        'specialist',
        'security audit rejected privileged prompt',
        'security-reviewer',
      ),
    ).not.toBeNull();
    getDb()
      .prepare(`UPDATE agent_configs SET enabled = 1 WHERE id = 'specialist'`)
      .run();

    await expect(
      delegateToAgent({
        authenticatedUserId: 42,
        callerSessionId: seedCallerSession('manager'),
        targetAgentConfigId: 'specialist',
        prompt: 'Do not run this.',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('security-locked'),
    });
    expect(runMock).not.toHaveBeenCalled();
  });
});
