import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../../repositories/agent_configs_repository';

const state = vi.hoisted(() => ({ home: '' }));

vi.mock('os', () => {
  const homedir = () => state.home;
  return {
    default: { homedir },
    homedir,
  };
});

import { writeAgentProfileFile } from '../opencode_agent_writer';

const originalVitest = process.env.VITEST;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.VITEST = originalVitest;
  process.env.NODE_ENV = originalNodeEnv;
  if (state.home) rmSync(state.home, { recursive: true, force: true });
  state.home = '';
});

function workflowOrchestratorConfig(): AgentConfig {
  const now = new Date().toISOString();
  return {
    id: 'workflow-orchestrator',
    label: 'Workflow Orchestrator',
    icon: 'account_tree',
    enabled: true,
    isAgent: true,
    isManager: true,
    systemPrompt: 'You coordinate the coding workflow.',
    allowedMcpsJson: null,
    allowedSkillsJson: null,
    corePermissionsJson: null,
    allowedDelegatesJson: JSON.stringify(['coding-agent', 'verification-gate']),
    presetId: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    modelProvider: 'anthropic',
    modelId: 'claude-opus-4-8',
    ocAgent: 'workflow-orchestrator',
    sessionSelectable: true,
    modelTierHint: null,
    defaultAnthropicAccountId: null,
  };
}

function agentConfig(id: string, label = id): AgentConfig {
  return {
    ...workflowOrchestratorConfig(),
    id,
    label,
    isManager: false,
    allowedDelegatesJson: null,
    corePermissionsJson: id === 'Theological-Researcher'
      ? JSON.stringify({ skill: 'allow', read: 'allow', bash: 'ask' })
      : id === 'config-doctor'
        ? JSON.stringify({ bash: 'ask' })
        : null,
    ocAgent: id,
  };
}

describe('workflow-orchestrator file projection', () => {
  it('issue-0-c6: workflow-orchestrator projection grants write', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    const agentsDir = join(state.home, '.config', 'opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'workflow-orchestrator.md'),
      [
        '---',
        'name: workflow-orchestrator',
        'description: Existing orchestrator',
        'mode: primary',
        'permission:',
        '  read: allow',
        '  edit: allow',
        '---',
        'Existing prompt.',
        '',
      ].join('\n'),
      'utf8',
    );

    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';
    writeAgentProfileFile(workflowOrchestratorConfig());

    const projected = readFileSync(
      join(agentsDir, 'workflow-orchestrator.md'),
      'utf8',
    );
    expect(projected).toMatch(/permission:\n(?:  .+\n)*  write: allow\n/);
  });

  it('does not project disabled profile rows', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    const agentsDir = join(state.home, '.config', 'opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';
    writeAgentProfileFile({
      ...workflowOrchestratorConfig(),
      id: 'disabled-researcher',
      label: 'Disabled Researcher',
      enabled: false,
      ocAgent: 'disabled-researcher',
    });

    expect(() =>
      readFileSync(join(agentsDir, 'disabled-researcher.md'), 'utf8'),
    ).toThrow();
  });

  it('projects core bash/read permissions for Theological-Researcher', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile(agentConfig('Theological-Researcher', 'Theological Researcher'));

    const projected = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'Theological-Researcher.md'),
      'utf8',
    );
    expect(projected).toMatch(/permission:\n(?:  .+\n)*  skill: allow\n/);
    expect(projected).toMatch(/permission:\n(?:  .+\n)*  read: allow\n/);
    expect(projected).toMatch(/permission:\n(?:  .+\n)*  bash: ask\n/);
    expect(projected).not.toContain('filesystem: allow');
  });

  it('projects minimal repair permissions for Config Doctor only', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile(agentConfig('config-doctor', 'Config Doctor'));
    writeAgentProfileFile(agentConfig('ordinary-agent', 'Ordinary Agent'));

    const configDoctor = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'config-doctor.md'),
      'utf8',
    );
    expect(configDoctor).toMatch(/permission:\n(?:  .+\n)*  bash: ask\n/);
    expect(configDoctor).not.toContain('read: allow');
    expect(configDoctor).not.toContain('edit: allow');

    const ordinary = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'ordinary-agent.md'),
      'utf8',
    );
    expect(ordinary).not.toContain('bash: allow');
    expect(ordinary).not.toContain('read: allow');
    expect(ordinary).not.toContain('edit: allow');
  });
});
