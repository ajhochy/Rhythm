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
});
