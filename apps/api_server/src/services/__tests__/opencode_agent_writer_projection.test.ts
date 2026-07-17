import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../../repositories/agent_configs_repository';

const state = vi.hoisted(() => ({ home: '' }));
const { mockReloadConfig } = vi.hoisted(() => ({ mockReloadConfig: vi.fn() }));

vi.mock('os', () => {
  const homedir = () => state.home;
  return {
    default: { homedir },
    homedir,
  };
});

// #1039: writeAgentProfileFile fires opencodeClient.reloadConfig() after a write
// so the running engine re-scans the agent registry. Mock the engine so the test
// can assert the call without pulling in the real client service.
vi.mock('../opencode_engine', () => ({
  opencodeClient: { reloadConfig: mockReloadConfig },
  opencodeSessionMap: new Map<string, string>(),
}));

import { writeAgentProfileFile } from '../opencode_agent_writer';

const originalVitest = process.env.VITEST;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.VITEST = originalVitest;
  process.env.NODE_ENV = originalNodeEnv;
  if (state.home) rmSync(state.home, { recursive: true, force: true });
  state.home = '';
  mockReloadConfig.mockClear();
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

function managerConfig(
  id: string,
  label: string,
  systemPrompt: string,
  delegates: string[],
): AgentConfig {
  return {
    ...workflowOrchestratorConfig(),
    id,
    label,
    systemPrompt,
    allowedDelegatesJson: JSON.stringify(delegates),
    ocAgent: id,
  };
}

describe('workflow-orchestrator file projection', () => {
  it('projects direct-first routing for Secretary, Theologian, and Coding Workflow', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    const profiles = [
      managerConfig(
        'secretary',
        'Secretary',
        'Handle daily administrative tasks directly. Coding and development work is ' +
          'outside your role and routes to workflow-orchestrator.',
        ['workflow-orchestrator', 'theologian'],
      ),
      managerConfig(
        'theologian',
        'Theologian',
        'Perform theology, study, and synthesis directly. Escalate to ' +
          'Theological-Researcher when new-source discovery is required.',
        ['Theological-Researcher'],
      ),
      managerConfig(
        'workflow-orchestrator',
        'Coding Workflow',
        'Perform in-scope orchestration directly. Work in the required sandbox and use ' +
          'the mandatory independent verification-gate before a draft PR.',
        ['coding-agent', 'verification-gate'],
      ),
    ];

    for (const profile of profiles) writeAgentProfileFile(profile);

    const readProjected = (id: string) =>
      readFileSync(join(state.home, '.config', 'opencode', 'agents', `${id}.md`), 'utf8');
    const secretary = readProjected('secretary');
    const theologian = readProjected('theologian');
    const workflow = readProjected('workflow-orchestrator');

    for (const projected of [secretary, theologian, workflow]) {
      expect(projected).toContain(
        'Handle the request directly when it fits your own role, system prompt, granted ' +
          'skills, tools, and permissions.',
      );
      expect(projected).not.toContain('Do not attempt domain or coding work yourself');
      expect(projected).not.toContain('Only handle trivial admin yourself');
    }

    expect(secretary).toContain(
      'Coding and development work is outside your role and routes to workflow-orchestrator.',
    );
    expect(theologian).toContain('Perform theology, study, and synthesis directly.');
    expect(theologian).toContain(
      'Theological-Researcher when new-source discovery is required.',
    );
    expect(workflow).toContain('Perform in-scope orchestration directly.');
    expect(workflow).toContain('mandatory independent verification-gate before a draft PR');

    expect(secretary).toContain(
      '  task:\n    "*": deny\n    "workflow-orchestrator": allow\n    "theologian": allow',
    );
    expect(theologian).toContain(
      '  task:\n    "*": deny\n    "Theological-Researcher": allow',
    );
    expect(workflow).toContain(
      '  task:\n    "*": deny\n    "coding-agent": allow\n    "verification-gate": allow',
    );
  });

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

  it('#1039: reloads the engine config after writing an agent file', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile(agentConfig('ai-trend-researcher', 'AI Trend Researcher'));

    // The written .md must be made visible to the running engine's cached
    // agent registry — otherwise `agent: <id>` throws "Agent not found" live.
    expect(mockReloadConfig).toHaveBeenCalledOnce();
    expect(mockReloadConfig).toHaveBeenCalledWith(process.cwd());
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

  it('projects both mcpAllowlist and skillAllowlist into one options: line when the profile declares both', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('scoped-both', 'Scoped Both'),
      allowedMcpsJson: JSON.stringify(['rhythm']),
      allowedSkillsJson: JSON.stringify(['skill-a', 'skill-b']),
    });

    const projected = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'scoped-both.md'),
      'utf8',
    );
    const optionsLine = projected.split('\n').find((l) => l.startsWith('options:'));
    expect(optionsLine).toBeDefined();
    const options = JSON.parse(optionsLine!.slice('options: '.length));
    expect(options.mcpAllowlist).toBeDefined();
    expect(options.skillAllowlist).toEqual({ skills: ['skill-a', 'skill-b'] });
  });

  it('projects only skillAllowlist when only allowedSkillsJson is scoped', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('scoped-skills-only', 'Scoped Skills Only'),
      allowedMcpsJson: null,
      allowedSkillsJson: JSON.stringify(['skill-a']),
    });

    const projected = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'scoped-skills-only.md'),
      'utf8',
    );
    const optionsLine = projected.split('\n').find((l) => l.startsWith('options:'));
    expect(optionsLine).toBeDefined();
    const options = JSON.parse(optionsLine!.slice('options: '.length));
    expect(options.mcpAllowlist).toBeUndefined();
    expect(options.skillAllowlist).toEqual({ skills: ['skill-a'] });
  });

  it('omits the options: line entirely when neither allowlist is scoped', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('unscoped-agent', 'Unscoped Agent'),
      allowedMcpsJson: null,
      allowedSkillsJson: null,
    });

    const projected = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'unscoped-agent.md'),
      'utf8',
    );
    expect(projected.split('\n').some((l) => l.startsWith('options:'))).toBe(false);
  });

  // #1088 — schedulability decoupled from picker visibility (sessionSelectable).
  describe('mode projection honors schedulable independent of sessionSelectable', () => {
    const readMode = (id: string): string => {
      const content = readFileSync(join(state.home, '.config', 'opencode', 'agents', `${id}.md`), 'utf8');
      const match = content.match(/^mode:\s*(\S+)\s*$/m);
      return match![1];
    };

    it('a hidden profile with no override still writes mode:subagent (unchanged default)', () => {
      state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
      process.env.VITEST = 'false';
      process.env.NODE_ENV = 'development';

      writeAgentProfileFile({
        ...agentConfig('hidden-default', 'Hidden Default'),
        sessionSelectable: false,
      });
      expect(readMode('hidden-default')).toBe('subagent');
    });

    it('a hidden profile with schedulable=true writes mode:all (top-level runnable + delegatable)', () => {
      state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
      process.env.VITEST = 'false';
      process.env.NODE_ENV = 'development';

      writeAgentProfileFile({
        ...agentConfig('hidden-schedulable', 'Hidden Schedulable'),
        sessionSelectable: false,
        schedulable: true,
      });
      expect(readMode('hidden-schedulable')).toBe('all');
    });

    it('a visible profile with schedulable=false writes mode:subagent', () => {
      state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
      process.env.VITEST = 'false';
      process.env.NODE_ENV = 'development';

      writeAgentProfileFile({
        ...agentConfig('visible-not-schedulable', 'Visible Not Schedulable'),
        sessionSelectable: true,
        schedulable: false,
      });
      expect(readMode('visible-not-schedulable')).toBe('subagent');
    });
  });
});
