import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../../repositories/agent_configs_repository';

function parsePermissionYaml(text: string): Record<string, string> {
  const block = text.match(/^permission:\n((?:  .*\n?)*)/m)?.[1] ?? '';
  const permissions: Record<string, string> = {};

  for (const line of block.trimEnd().split('\n')) {
    // Nested maps (`task:`, `bash:`, `external_directory:`, …) and their indented
    // children are not scalar permissions — skip them. Since #1322 EVERY profile
    // carries a nested `task:` block, so this parser can no longer assume the
    // whole permission block is flat.
    if (/^  (?:"[^"]+"|[a-z_]+):$/.test(line)) continue;
    if (/^ {4}/.test(line)) continue;
    const match = line.match(/^  (?:"([^"]+)"|([a-z_]+)): (allow|ask|deny)$/);
    if (!match) throw new Error(`Invalid permission YAML: ${line}`);
    permissions[match[1] ?? match[2]] = match[3];
  }

  return permissions;
}

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

import { writeAgentProfileFile, syncAgentProfileFileForState } from '../opencode_agent_writer';

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

const NATIVE_TASK_BLOCK =
  '"*": deny\n    "explore": allow\n    "general": allow\n';

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
      expect(projected).toContain('  rhythm_delegate_async: allow');
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

    // #1322 — the engine-native subagents are projected first (read-only fan-out
    // inside the profile), then the explicit cross-profile roster.
    expect(secretary).toContain(
      '  task:\n    ' + NATIVE_TASK_BLOCK + '    "workflow-orchestrator": allow\n    "theologian": allow',
    );
    expect(theologian).toContain(
      '  task:\n    ' + NATIVE_TASK_BLOCK + '    "Theological-Researcher": allow',
    );
    expect(workflow).toContain(
      '  task:\n    ' + NATIVE_TASK_BLOCK + '    "coding-agent": allow\n    "verification-gate": allow',
    );
  });

  it('#1123 denies async delegation in non-manager and hidden/headless profile files', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    const specialist = agentConfig('specialist');
    const hiddenManager = managerConfig(
      'hidden-manager',
      'Hidden Manager',
      'Headless manager profile.',
      ['specialist'],
    );
    hiddenManager.sessionSelectable = false;

    writeAgentProfileFile(specialist);
    writeAgentProfileFile(hiddenManager);

    for (const id of ['specialist', 'hidden-manager']) {
      const projected = readFileSync(
        join(state.home, '.config', 'opencode', 'agents', `${id}.md`),
        'utf8',
      );
      expect(projected).toContain('  rhythm_delegate_async: deny');
    }
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

  // #1135 — PATCH must delete (not merely skip re-writing) a profile's
  // projected .md when it is disabled, so a disabled profile's stale
  // model/prompt/permissions can never be loaded by the running engine.
  it('#1135: syncAgentProfileFileForState deletes an existing projection when the profile becomes disabled, and fires reloadConfig', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    const agentsDir = join(state.home, '.config', 'opencode', 'agents');
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    const enabled = agentConfig('togglable-researcher', 'Togglable Researcher');
    syncAgentProfileFileForState(enabled);
    expect(readFileSync(join(agentsDir, 'togglable-researcher.md'), 'utf8')).toBeTruthy();
    mockReloadConfig.mockClear();

    syncAgentProfileFileForState({ ...enabled, enabled: false });

    expect(() => readFileSync(join(agentsDir, 'togglable-researcher.md'), 'utf8')).toThrow();
    expect(mockReloadConfig).toHaveBeenCalledOnce();
  });

  it('#1135: syncAgentProfileFileForState still writes (unchanged behavior) for an enabled projectable profile', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    const agentsDir = join(state.home, '.config', 'opencode', 'agents');
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    syncAgentProfileFileForState(agentConfig('still-enabled', 'Still Enabled'));

    expect(readFileSync(join(agentsDir, 'still-enabled.md'), 'utf8')).toBeTruthy();
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

  // #1118 — per-profile reasoning effort projected into options.effort.
  it('projects reasoningEffort into options.effort when set', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('effort-agent', 'Effort Agent'),
      reasoningEffort: 'high',
    });

    const projected = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'effort-agent.md'),
      'utf8',
    );
    const optionsLine = projected.split('\n').find((l) => l.startsWith('options:'));
    expect(optionsLine).toBeDefined();
    const options = JSON.parse(optionsLine!.slice('options: '.length));
    expect(options.effort).toBe('high');
  });

  it('omits options.effort (and the options: line) when reasoningEffort is null', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('no-effort-agent', 'No Effort Agent'),
      reasoningEffort: null,
    });

    const projected = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'no-effort-agent.md'),
      'utf8',
    );
    expect(projected.split('\n').some((l) => l.startsWith('options:'))).toBe(false);
  });

  it('projects reasoningEffort alongside mcpAllowlist into the same options: line', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('scoped-effort', 'Scoped Effort'),
      allowedMcpsJson: JSON.stringify(['rhythm']),
      reasoningEffort: 'medium',
    });

    const projected = readFileSync(
      join(state.home, '.config', 'opencode', 'agents', 'scoped-effort.md'),
      'utf8',
    );
    const optionsLine = projected.split('\n').find((l) => l.startsWith('options:'));
    expect(optionsLine).toBeDefined();
    const options = JSON.parse(optionsLine!.slice('options: '.length));
    expect(options.mcpAllowlist).toBeDefined();
    expect(options.effort).toBe('medium');
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

  // #1094 — OpenAI native image_generation capability grant.
  describe('image_generation capability projection (#1094)', () => {
    const readProjected = (id: string): string =>
      readFileSync(join(state.home, '.config', 'opencode', 'agents', `${id}.md`), 'utf8');

    it('projects permission.image_generation: allow when granted', () => {
      state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
      process.env.VITEST = 'false';
      process.env.NODE_ENV = 'development';

      writeAgentProfileFile({
        ...agentConfig('graphic-designer', 'Graphic Designer'),
        imageGenerationEnabled: true,
      });
      const projected = readProjected('graphic-designer');
      expect(projected).toMatch(/^\s*image_generation:\s*allow\s*$/m);
    });

    it('does not project image_generation when not granted', () => {
      state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
      process.env.VITEST = 'false';
      process.env.NODE_ENV = 'development';

      writeAgentProfileFile({
        ...agentConfig('no-image-gen-agent', 'No Image Gen Agent'),
        imageGenerationEnabled: false,
      });
      const projected = readProjected('no-image-gen-agent');
      expect(projected).not.toContain('image_generation');
    });

    it('does NOT add image_generation to the MCP allowlist (options.mcpAllowlist)', () => {
      state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
      process.env.VITEST = 'false';
      process.env.NODE_ENV = 'development';

      writeAgentProfileFile({
        ...agentConfig('image-gen-scoped', 'Image Gen Scoped'),
        imageGenerationEnabled: true,
        allowedMcpsJson: JSON.stringify(['rhythm']),
      });
      const projected = readProjected('image-gen-scoped');
      const optionsLine = projected.split('\n').find((l) => l.startsWith('options:'));
      expect(optionsLine).toBeDefined();
      const options = JSON.parse(optionsLine!.slice('options: '.length));
      expect(JSON.stringify(options.mcpAllowlist)).not.toContain('image_generation');
    });
   });
});

// #1138 — corePermissionsJson shape defensiveness + stale-key pruning.
describe('#1138: corePermissions projection is defensive and self-healing', () => {
  const agentsDirFor = () => join(state.home, '.config', 'opencode', 'agents');
  const readProjected = (id: string): string =>
    readFileSync(join(agentsDirFor(), `${id}.md`), 'utf8');

  it('skips a malformed indexed-list corePermissions shape instead of projecting garbage', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    // The exact corruption #1138 describes: an indexed list of rule objects,
    // one of which has "permission": "*" (a bare * is YAML alias syntax).
    writeAgentProfileFile({
      ...agentConfig('garbage-perms', 'Garbage Perms'),
      corePermissionsJson: JSON.stringify({
        '0': { permission: 'read', pattern: '*', action: 'allow' },
        '1': { permission: '*', pattern: 'git push*', action: 'ask' },
      }),
    });

    const projected = readProjected('garbage-perms');
    // None of the numbered garbage keys leak into frontmatter.
    expect(projected).not.toMatch(/^\s*"?0"?:/m);
    expect(projected).not.toMatch(/^\s*"?1"?:/m);
    // The invalid bare-* alias line must never be emitted.
    expect(projected).not.toMatch(/"permission":\s*\*/);
    expect(projected).not.toContain('"permission": read');
    // With every malformed entry skipped, only #1123's mandatory fail-closed
    // async-delegation deny remains.
    // #1322 — every profile now carries a `task` key. A non-manager used to get
    // none and inherited the engine default `"*": "allow"`, i.e. unrestricted
    // cross-profile delegation. Natives only here.
    expect(projected).toContain('permission:\n  task:\n    ' + NATIVE_TASK_BLOCK);
    expect(projected).toContain('rhythm_delegate_async: deny');
  });

  it('still projects a valid flat-map corePermissions shape', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('good-perms', 'Good Perms'),
      corePermissionsJson: JSON.stringify({
        read: 'allow',
        bash: { '*': 'allow', 'git push*': 'ask' },
      }),
    });

    const projected = readProjected('good-perms');
    expect(projected).toMatch(/permission:\n(?:  .+\n| {4}.+\n)*  read: allow\n/);
    expect(projected).toMatch(/ {4}"\*": allow\n/);
    expect(projected).toMatch(/ {4}"git push\*": ask\n/);
  });

  it('quotes wildcard scalar permission keys, parses them, and stays stable on re-projection', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    const config = {
      ...agentConfig('research', 'Research'),
      corePermissionsJson: JSON.stringify({ '*': 'allow', read: 'ask' }),
    };
    writeAgentProfileFile(config);
    const first = readProjected('research');

    expect(first).toContain('  "*": allow');
    expect(first).toContain('  read: ask');
    expect(parsePermissionYaml(first)).toEqual({
      '*': 'allow',
      read: 'ask',
      rhythm_delegate_async: 'deny',
    });

    writeAgentProfileFile(config);
    expect(readProjected('research')).toBe(first);
  });

  it('skips only the bad entries, keeping the valid ones in a mixed payload', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('mixed-perms', 'Mixed Perms'),
      corePermissionsJson: JSON.stringify({
        read: 'allow', // valid
        edit: 'banana', // invalid action → skipped
        '0': { permission: 'x', pattern: '*', action: 'allow' }, // garbage → skipped
      }),
    });

    const projected = readProjected('mixed-perms');
    expect(projected).toMatch(/  read: allow\n/);
    expect(projected).not.toContain('edit: banana');
    expect(projected).not.toMatch(/^\s*"?0"?:/m);
  });

  it('prunes stale permission keys on re-write so a corrected config converges', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    // 1st write: profile grants read + edit.
    writeAgentProfileFile({
      ...agentConfig('converge-perms', 'Converge Perms'),
      corePermissionsJson: JSON.stringify({ read: 'allow', edit: 'ask' }),
    });
    expect(readProjected('converge-perms')).toContain('edit: ask');

    // 2nd write: config corrected to read-only. The stale `edit` key must be
    // PRUNED, not left behind (the merge path used to only upsert).
    writeAgentProfileFile({
      ...agentConfig('converge-perms', 'Converge Perms'),
      corePermissionsJson: JSON.stringify({ read: 'allow' }),
    });
    const projected = readProjected('converge-perms');
    expect(projected).toContain('read: allow');
    expect(projected).not.toContain('edit: ask');
    expect(projected).not.toContain('edit:');
  });

  it('drops the empty permission header when every key is pruned', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('empties-perms', 'Empties Perms'),
      corePermissionsJson: JSON.stringify({ read: 'allow' }),
    });
    expect(readProjected('empties-perms')).toMatch(/^permission:/m);

    // Config clears all permissions → block must disappear entirely.
    writeAgentProfileFile({
      ...agentConfig('empties-perms', 'Empties Perms'),
      corePermissionsJson: null,
    });
    const projected = readProjected('empties-perms');
    // #1322 — every profile now carries a `task` key. A non-manager used to get
    // none and inherited the engine default `"*": "allow"`, i.e. unrestricted
    // cross-profile delegation. Natives only here.
    expect(projected).toContain('permission:\n  task:\n    ' + NATIVE_TASK_BLOCK);
    expect(projected).toContain('rhythm_delegate_async: deny');
    expect(projected).not.toContain('read: allow');
  });

  it('does not prune writer-injected keys (workflow-orchestrator write)', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    // workflow-orchestrator gets an injected `write: allow` not present in
    // corePermissionsJson; a re-write must not prune it.
    writeAgentProfileFile(workflowOrchestratorConfig());
    expect(readProjected('workflow-orchestrator')).toContain('write: allow');
    writeAgentProfileFile(workflowOrchestratorConfig());
    expect(readProjected('workflow-orchestrator')).toContain('write: allow');
  });
  it('issue-1162-c1: map to scalar replaces the complete permission subtree', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('map-to-scalar', 'Map To Scalar'),
      corePermissionsJson: JSON.stringify({
        read: 'allow',
        bash: { '*': 'allow', 'git push*': 'ask' },
      }),
    });
    writeAgentProfileFile({
      ...agentConfig('map-to-scalar', 'Map To Scalar'),
      corePermissionsJson: JSON.stringify({ read: 'allow', bash: 'deny' }),
    });

    const projected = readProjected('map-to-scalar');
    // Regression caught: replacing only `  bash:` leaves these child lines
    // under a scalar and makes the whole frontmatter invalid YAML.
    expect(projected).toContain('  bash: deny');
    expect(projected).not.toContain('    "*": allow');
    expect(projected).not.toContain('    "git push*": ask');
    expect(projected).toContain('  read: allow');
  });

  it('issue-1162-c2: scalar to map emits one valid nested permission subtree', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('scalar-to-map', 'Scalar To Map'),
      corePermissionsJson: JSON.stringify({ bash: 'ask' }),
    });
    writeAgentProfileFile({
      ...agentConfig('scalar-to-map', 'Scalar To Map'),
      corePermissionsJson: JSON.stringify({
        bash: { '*': 'allow', 'git push*': 'deny' },
      }),
    });

    const projected = readProjected('scalar-to-map');
    expect(projected.match(/^  bash:/gm)).toHaveLength(1);
    expect(projected).toContain(
      '  bash:\n    "*": allow\n    "git push*": deny',
    );
    expect(projected).not.toContain('  bash: ask');
  });

  it('issue-1162-c3: map to map replaces old patterns without duplication', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('map-to-map', 'Map To Map'),
      corePermissionsJson: JSON.stringify({
        external_directory: { '*': 'ask', '/old/*': 'allow' },
      }),
    });
    writeAgentProfileFile({
      ...agentConfig('map-to-map', 'Map To Map'),
      corePermissionsJson: JSON.stringify({
        external_directory: { '*': 'deny', '/tmp/*': 'allow' },
      }),
    });

    const projected = readProjected('map-to-map');
    expect(projected.match(/^  external_directory:/gm)).toHaveLength(1);
    expect(projected).toContain(
      '  external_directory:\n    "*": deny\n    "/tmp/*": allow',
    );
    expect(projected).not.toContain('"/old/*": allow');
    expect(projected).not.toContain('"*": ask');
  });

  it('issue-1162-c5: external_directory map to scalar removes its star child', () => {
    state.home = join('/tmp', `rhythm-agent-writer-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    writeAgentProfileFile({
      ...agentConfig('external-directory-scalar', 'External Directory Scalar'),
      corePermissionsJson: JSON.stringify({
        external_directory: { '*': 'allow' },
      }),
    });
    writeAgentProfileFile({
      ...agentConfig('external-directory-scalar', 'External Directory Scalar'),
      corePermissionsJson: JSON.stringify({ external_directory: 'allow' }),
    });

    const projected = readProjected('external-directory-scalar');
    expect(projected).toContain('  external_directory: allow');
    expect(projected).not.toContain('    "*": allow');
  });
});
