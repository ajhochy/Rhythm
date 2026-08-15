import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getById, insert, update, seedMarkerExists, recordSeedMarker, writeAgentProfileFile, projectAgentProfileAfterWrite } = vi.hoisted(() => ({
  getById: vi.fn(), insert: vi.fn(), update: vi.fn(), seedMarkerExists: vi.fn(), recordSeedMarker: vi.fn(), writeAgentProfileFile: vi.fn(), projectAgentProfileAfterWrite: vi.fn(),
}));

vi.mock('../../config/env', () => ({ env: { agentExecutionEnabled: true, dbClient: 'sqlite' } }));
vi.mock('../../repositories/agent_configs_repository', () => ({ AgentConfigsRepository: class { getById = getById; insert = insert; update = update; } }));
vi.mock('../seed_once', () => ({ seedMarkerExists, recordSeedMarker }));
vi.mock('../opencode_agent_writer', () => ({ writeAgentProfileFile }));
// The seed projects through the ONE boundary now, so that is the seam
// the contract asserts on — the boundary owns re-reading the latest row.
vi.mock('../agent_profile_projection_service', () => ({ projectAgentProfileAfterWrite }));
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn() } }));

import { RESEARCH_AGENT_ID, RESEARCH_MCPS, RESEARCH_PROFILE_MARKER, RESEARCH_PROMPT, RESEARCH_SKILLS, seedResearchProfile } from '../research_profile_seed';

const fresh = { id: RESEARCH_AGENT_ID, enabled: true };

describe('seedResearchProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getById.mockReturnValue(null);
    seedMarkerExists.mockReturnValue(false);
    insert.mockImplementation((value) => ({ ...value, id: RESEARCH_AGENT_ID }));
  });

  it('seeds and projects the exact durable generic Researcher defaults', () => {
    const result = seedResearchProfile();
    expect(result.created).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'research', label: 'Researcher', enabled: true, isManager: false, sessionSelectable: false, schedulable: true,
      modelProvider: 'openai', modelId: 'gpt-5.6-terra', reasoningEffort: 'xhigh', allowedDelegatesJson: '[]',
      allowedMcpsJson: JSON.stringify([...RESEARCH_MCPS]), allowedSkillsJson: JSON.stringify([...RESEARCH_SKILLS]),
    }));
    expect(RESEARCH_PROMPT).toContain('Areas/Research/General/Reports/<date>-<slug>.md');
    expect(projectAgentProfileAfterWrite).toHaveBeenCalledWith(result.config, 'seed');
    expect(recordSeedMarker).toHaveBeenCalledWith(RESEARCH_PROFILE_MARKER);
  });

  it('repairs the known disabled legacy default once', () => {
    getById.mockReturnValue({ id: 'research', label: 'Research', enabled: false });
    update.mockReturnValue(fresh);
    const result = seedResearchProfile();
    expect(result.repaired).toBe(true);
    expect(update).toHaveBeenCalledWith('research', expect.objectContaining({ label: 'Researcher', enabled: true, schedulable: true }));
  });

  it('adopts custom rows and preserves later user edits once marked', () => {
    const custom = { id: 'research', label: 'My Research', enabled: false, modelId: 'user-model' };
    getById.mockReturnValue(custom);
    const first = seedResearchProfile();
    expect(first.config).toBe(custom);
    expect(update).not.toHaveBeenCalled();

    seedMarkerExists.mockReturnValue(true);
    const second = seedResearchProfile();
    expect(second.config).toBe(custom);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(projectAgentProfileAfterWrite).toHaveBeenLastCalledWith(custom, 'seed');
  });
});
