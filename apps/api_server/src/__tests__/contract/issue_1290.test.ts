import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getById,
  insert,
  update,
  seedMarkerExists,
  recordSeedMarker,
  writeAgentProfileFile,
  projectAgentProfileAfterWrite,
} = vi.hoisted(() => ({
  getById: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  seedMarkerExists: vi.fn(),
  recordSeedMarker: vi.fn(),
  writeAgentProfileFile: vi.fn(),
  projectAgentProfileAfterWrite: vi.fn(),
}));

vi.mock('../../config/env', () => ({
  env: { agentExecutionEnabled: true, dbClient: 'sqlite' },
}));
vi.mock('../../repositories/agent_configs_repository', () => ({
  AgentConfigsRepository: class {
    getById = getById;
    insert = insert;
    update = update;
  },
}));
vi.mock('../../services/seed_once', () => ({ seedMarkerExists, recordSeedMarker }));
vi.mock('../../services/opencode_agent_writer', () => ({ writeAgentProfileFile }));
// The seed projects through the ONE boundary now, so that is the seam the
// contract asserts on — the boundary owns re-reading the latest row.
vi.mock('../../services/agent_profile_projection_service', () => ({ projectAgentProfileAfterWrite }));
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn() } }));

import {
  RESEARCH_AGENT_ID,
  RESEARCH_MCPS,
  RESEARCH_PROFILE_MARKER,
  RESEARCH_PROMPT,
  RESEARCH_SKILLS,
  seedResearchProfile,
} from '../../services/research_profile_seed';
import * as skillWiring from '../../services/agent_skill_wiring';

const requiredSkills = ['agent-reach', 'deep-research', 'archive-research-sources'];
const staleSkills = RESEARCH_SKILLS.filter((skill) => !requiredSkills.includes(skill));

function staleDefaultProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: RESEARCH_AGENT_ID,
    label: 'Researcher',
    icon: 'search',
    enabled: true,
    isAgent: true,
    isManager: false,
    systemPrompt: RESEARCH_PROMPT,
    allowedMcpsJson: JSON.stringify([...RESEARCH_MCPS]),
    allowedSkillsJson: JSON.stringify(staleSkills),
    allowedDelegatesJson: '[]',
    modelProvider: 'openai',
    modelId: 'gpt-5.6-terra',
    ocAgent: RESEARCH_AGENT_ID,
    sessionSelectable: false,
    schedulable: true,
    reasoningEffort: 'xhigh',
    ...overrides,
  };
}

describe('issue #1290 acceptance contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Production has the old v1 marker, but not the new repair marker yet.
    seedMarkerExists.mockImplementation((marker: string) => marker !== RESEARCH_PROFILE_MARKER);
  });

  it('issue-1290-c1: repairs the exact stale generic Researcher fingerprint with all required skills', () => {
    // Regression caught: v1's marker short-circuits before repairing an otherwise
    // untouched seeded profile whose workflow skill grants are stale.
    const stale = staleDefaultProfile();
    getById.mockReturnValue(stale);
    update.mockImplementation((_id, patch) => ({ ...stale, ...patch }));

    const result = seedResearchProfile();

    expect(result.repaired).toBe(true);
    const patch = update.mock.calls[0]?.[1] as { allowedSkillsJson: string };
    expect(JSON.parse(patch.allowedSkillsJson)).toEqual(expect.arrayContaining(requiredSkills));
  });

  it('issue-1290-c2: preserves a customized research profile even when required skills are absent', () => {
    // Regression caught: a broad "missing skills" repair overwrites user-owned
    // prompt/model/profile changes instead of matching the known seed fingerprint.
    const customized = staleDefaultProfile({
      label: 'My Private Researcher',
      systemPrompt: 'Use my approved sources only.',
      modelId: 'custom-model',
    });
    getById.mockReturnValue(customized);

    const result = seedResearchProfile();

    expect(result.config).toBe(customized);
    expect(result.repaired).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(projectAgentProfileAfterWrite).toHaveBeenCalledWith(customized, 'seed');
  });

  it('issue-1290-c3: reports channel degradation and never treats unavailable Gmail as granted', () => {
    // Regression caught: newsletter instructions silently imply inbox access even
    // when neither Gmail MCP is connected.
    const build = (skillWiring as Record<string, unknown>).buildResearchCapabilityDiagnostics;
    expect(build).toBeTypeOf('function');
    const report = (build as (input: unknown) => any)({
      requestedSkills: [...RESEARCH_SKILLS],
      availableSkills: ['agent-reach', 'deep-research', 'archive-research-sources'],
      requestedMcps: [...RESEARCH_MCPS, 'gmail-work', 'gmail-personal'],
      mcpStatuses: {
        exa: 'failed',
        'youtube-transcript': 'connected',
        'gmail-work': 'needs_auth',
      },
      vaultWritable: false,
    });

    expect(report.channels.gmail).toMatchObject({ available: false, action: 'skip' });
    expect(report.channels.exa).toMatchObject({ available: false, action: 'fallback' });
    expect(report.channels.youtube).toMatchObject({ available: true });
    expect(report.vaultWritable).toBe(false);
    const partition = skillWiring.partitionResearchMcpPreflight('research', [
      'exa',
      'gmail-work',
      'obsidian',
    ]);
    expect(partition).toEqual({
      degraded: ['exa', 'gmail-work'],
      blocking: ['obsidian'],
    });
    expect(
      skillWiring.partitionResearchMcpPreflight(
        'research',
        ['exa', 'gmail-work'],
        false,
      ),
    ).toEqual({ degraded: [], blocking: ['exa', 'gmail-work'] });
  });

  it('issue-1290-c4: leaves correctly wired specialist profiles without mismatches', () => {
    // Regression caught: richer diagnostics accidentally change the established
    // canonical skill-wiring decision for current specialist profiles.
    const specialists = [
      {
        id: 'AI-Trend-Researcher',
        systemPrompt: 'Use the `agent-reach` skill.',
        allowedSkills: ['agent-reach'],
      },
      {
        id: 'Theological-Researcher',
        systemPrompt: 'Use the `archive-research-sources` skill.',
        allowedSkills: ['archive-research-sources'],
      },
    ];
    expect(
      skillWiring.detectAgentSkillWiringMismatches(
        specialists,
        new Set(['agent-reach', 'archive-research-sources']),
      ),
    ).toEqual([]);
  });

  it('issue-1290-c5: emits serializable requested available unavailable and fallback diagnostics', () => {
    // Regression caught: preflight reports only mismatches and drops the channel
    // fallback decision, leaving nothing stable to persist in a run snapshot.
    const build = (skillWiring as Record<string, unknown>).buildResearchCapabilityDiagnostics;
    expect(build).toBeTypeOf('function');
    const report = (build as (input: unknown) => any)({
      requestedSkills: ['agent-reach', 'missing-skill'],
      availableSkills: ['agent-reach'],
      requestedMcps: ['exa', 'gmail-personal'],
      mcpStatuses: { exa: 'connected', 'gmail-personal': 'disabled' },
      vaultWritable: true,
    });

    expect(report.skills).toEqual({
      requested: ['agent-reach', 'missing-skill'],
      available: ['agent-reach'],
      unavailable: ['missing-skill'],
    });
    expect(report.mcps.unavailable).toEqual(['gmail-personal']);
    expect(report.channels.reddit.action).toBe('available');
    expect(report.channels.gmail.action).toBe('skip');
    expect(() => JSON.parse(JSON.stringify(report))).not.toThrow();
  });
});
