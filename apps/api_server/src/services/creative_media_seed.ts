import { env } from "../config/env";
import {
  AgentConfigsRepository,
  type AgentConfig,
} from "../repositories/agent_configs_repository";
import { logger } from "../utils/logger";
import { projectAgentProfileAfterWrite } from "./agent_profile_projection_service";

export const CREATIVE_MEDIA_AGENT_ID = "creative-media";

export const CREATIVE_MEDIA_MCPS = [
  "comfyui-mcp",
  "blender-mcp",
  "openmontage",
  "canva",
  "rhythm",
  "memory",
  "obsidian",
] as const;

export const CREATIVE_MEDIA_SKILLS = [
  "document-creation",
  "humanizer",
  "claude-design",
  "baoyu-infographic",
  "popular-web-designs",
  "excalidraw",
  "design-md",
  "social-video-pipeline",
  "hallmark",
] as const;

export const CREATIVE_MEDIA_PROMPT = `You are Rhythm's Creative Media Agent.

Help users create church graphics, images, documents, presentations, video, and 3D media. Start by clarifying the audience, dimensions, deadline, style, brand requirements, and delivery format.

Use the creative capabilities available in the current session. Canva, Rhythm, and built-in image generation may be available immediately. ComfyUI, Blender, OpenMontage, Obsidian, and local media utilities may require optional setup. Never assume a machine-specific path or claim a capability is available without checking its tool status. If a requested capability is unavailable, explain what is missing and offer to launch the Rhythm Setup Agent to install and verify it with the user's approval.

Save local deliverables under ~/Downloads/Rhythm Studio. Never overwrite an existing artifact without approval. After creating a finished artifact, call rhythm_record_design with its title, normalized provider, artifact type, and exactly one local path or HTTPS artifact URL. Put editable Canva/workflow/project links in the optional project URL, never as deliverables. If the user chooses another local destination, do not register that file in Gallery until it has been moved under Rhythm Studio.`;

export interface CreativeMediaSeedResult {
  created: boolean;
  config: AgentConfig | null;
}

/** Seed only when missing. Existing rows are user-owned and are never changed. */
export function seedCreativeMediaProfile(): CreativeMediaSeedResult {
  if (!env.agentExecutionEnabled || env.dbClient === "postgres") {
    return { created: false, config: null };
  }

  const repo = new AgentConfigsRepository();
  const existing = repo.getById(CREATIVE_MEDIA_AGENT_ID);
  if (existing) {
    projectAgentProfileAfterWrite(existing, 'seed');
    return { created: false, config: existing };
  }

  const config = repo.insert({
    id: CREATIVE_MEDIA_AGENT_ID,
    label: "Creative Media Agent",
    icon: "palette",
    enabled: true,
    isAgent: true,
    isManager: false,
    systemPrompt: CREATIVE_MEDIA_PROMPT,
    allowedMcpsJson: JSON.stringify([...CREATIVE_MEDIA_MCPS]),
    allowedSkillsJson: JSON.stringify([...CREATIVE_MEDIA_SKILLS]),
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    sessionSelectable: true,
    schedulable: false,
    imageGenerationEnabled: true,
    reasoningEffort: "medium",
  });
  projectAgentProfileAfterWrite(config, 'seed');
  logger.info("[creative-media] seeded Creative Media Agent profile");
  return { created: true, config };
}
