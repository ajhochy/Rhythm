import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentKind } from '../models/agent_session';
import { delegateToAgent } from '../services/agent_delegation_service';

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
}));

vi.mock('../services/agent_runner', () => ({
  run: runMock,
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
