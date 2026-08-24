import { beforeEach, describe, expect, it, vi } from "vitest";

const { getById, insert, writeAgentProfileFile, projectAgentProfileAfterWrite } = vi.hoisted(() => ({
  getById: vi.fn(),
  insert: vi.fn(),
  writeAgentProfileFile: vi.fn(), projectAgentProfileAfterWrite: vi.fn(),
}));

vi.mock("../../config/env", () => ({
  env: { agentExecutionEnabled: true, dbClient: "sqlite" },
}));
vi.mock("../../repositories/agent_configs_repository", () => ({
  AgentConfigsRepository: class {
    getById = getById;
    insert = insert;
  },
}));
vi.mock("../opencode_agent_writer", () => ({ writeAgentProfileFile }));
// The seed projects through the ONE boundary now, so that is the seam
// the contract asserts on — the boundary owns re-reading the latest row.
vi.mock("../agent_profile_projection_service", () => ({ projectAgentProfileAfterWrite }));
vi.mock("../../utils/logger", () => ({ logger: { info: vi.fn() } }));

import {
  CREATIVE_MEDIA_AGENT_ID,
  CREATIVE_MEDIA_MCPS,
  CREATIVE_MEDIA_PROMPT,
  CREATIVE_MEDIA_SKILLS,
  seedCreativeMediaProfile,
} from "../creative_media_seed";

describe("seedCreativeMediaProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getById.mockReturnValue(null);
    insert.mockImplementation((value) => ({
      ...value,
      id: CREATIVE_MEDIA_AGENT_ID,
    }));
  });

  it("creates and projects the complete creative profile when missing", () => {
    const result = seedCreativeMediaProfile();

    expect(result.created).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CREATIVE_MEDIA_AGENT_ID,
        modelProvider: "anthropic",
        modelId: "claude-opus-4-8",
        imageGenerationEnabled: true,
        allowedMcpsJson: JSON.stringify([...CREATIVE_MEDIA_MCPS]),
        allowedSkillsJson: JSON.stringify([...CREATIVE_MEDIA_SKILLS]),
      }),
    );
    expect(projectAgentProfileAfterWrite).toHaveBeenCalledWith(result.config, 'seed');
  });

  it("preserves and re-projects an existing user-edited profile", () => {
    const existing = { id: CREATIVE_MEDIA_AGENT_ID, modelId: "user-model" };
    getById.mockReturnValue(existing);

    const result = seedCreativeMediaProfile();

    expect(result).toEqual({ created: false, config: existing });
    expect(insert).not.toHaveBeenCalled();
    expect(projectAgentProfileAfterWrite).toHaveBeenCalledWith(existing, 'seed');
  });

  it("ships a path-agnostic prompt", () => {
    expect(CREATIVE_MEDIA_PROMPT).not.toContain("/Users/");
    expect(CREATIVE_MEDIA_PROMPT).not.toContain("Google Drive");
    expect(CREATIVE_MEDIA_PROMPT).toContain("Rhythm Setup Agent");
  });
});
