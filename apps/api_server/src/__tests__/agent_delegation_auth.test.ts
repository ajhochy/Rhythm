import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
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
  beforeEach(() => {
    setDb(makeDb());
    const repo = new AgentConfigsRepository();
    seedProfiles(repo);
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
      callerAgentConfigId: 'manager',
      targetAgentConfigId: 'specialist',
      prompt: 'Implement the focused task.',
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
      }),
    );
  });

  it('issue-P4-manager-delegation-c4: rejects unauthorized, self, and nested calls', async () => {
    // Regression caught: fail-open authorization lets arbitrary profiles invoke
    // specialists, or delegated specialists recursively fan out.
    await expect(
      delegateToAgent({
        callerAgentConfigId: 'manager',
        targetAgentConfigId: 'other-specialist',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      delegateToAgent({
        callerAgentConfigId: 'non-manager',
        targetAgentConfigId: 'specialist',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      delegateToAgent({
        callerAgentConfigId: 'manager',
        targetAgentConfigId: 'manager',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      delegateToAgent({
        callerAgentConfigId: 'manager',
        targetAgentConfigId: 'specialist',
        prompt: 'Do this.',
        depth: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(runMock).not.toHaveBeenCalled();
  });
});
