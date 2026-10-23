import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig } from '../../repositories/agent_configs_repository';

const binding = vi.hoisted(() => ({ root: '', configFile: '' }));
vi.mock('../qualification_fixture_authority', () => ({
  loadQualificationFixtureAuthority: () => ({ fixtureRoot: binding.root }),
}));
vi.mock('../../config/env', () => ({ env: { dbClient: 'sqlite' },
  opencodeConfigFile: () => binding.configFile,
}));
vi.mock('../opencode_engine', () => ({ opencodeClient: { reloadConfig: async () => {} } }));

describe('qualification profile projection uses the engine configuration directory', () => {
  const previous = { VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV };
  afterEach(() => {
    process.env.VITEST = previous.VITEST; process.env.NODE_ENV = previous.NODE_ENV;
    if (binding.root) rmSync(binding.root, { recursive: true, force: true });
  });
  it.each(['native', 'web-sandbox'])('makes a saved profile discoverable in %s configuration', async layout => {
    binding.root = mkdtempSync('/private/tmp/rhythm-profile-projection-');
    const engineConfig = layout === 'native' ? join(binding.root, 'opencode-config')
      : join(binding.root, 'home/.config/opencode');
    binding.configFile = join(engineConfig, 'opencode.json');
    process.env.VITEST = 'false'; process.env.NODE_ENV = 'development';
    const { writeAgentProfileFile, deleteAgentProfileFile } = await import('../opencode_agent_writer');
    const profile = { id: 'coding-agent', label: 'Synthetic coding agent', enabled: true, isAgent: true,
      ocAgent: 'coding-agent', systemPrompt: 'Work inside the disposable workspace.',
      sessionSelectable: true, schedulable: true, allowedMcpsJson: '[]', allowedSkillsJson: '[]',
      corePermissionsJson: '{}', allowedDelegatesJson: '[]', modelProvider: 'openai', modelId: 'gpt-6-luna',
    } as AgentConfig;
    writeAgentProfileFile(profile);
    const projected = join(engineConfig, 'agents/coding-agent.md');
    expect(existsSync(projected), 'engine must discover the profile after it is saved').toBe(true);
    expect(readFileSync(projected, 'utf8')).toContain('Work inside the disposable workspace.');
    if (layout === 'web-sandbox') expect(existsSync(join(binding.root, 'opencode-config/agents/coding-agent.md'))).toBe(false);
    deleteAgentProfileFile(profile.id);
    expect(existsSync(projected)).toBe(false);
  });
});
