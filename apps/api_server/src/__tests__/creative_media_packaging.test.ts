import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURATED_MCP_SERVERS } from "../config/curated_mcp_servers";

const SKILLS = [
  "document-creation",
  "humanizer",
  "claude-design",
  "baoyu-infographic",
  "popular-web-designs",
  "excalidraw",
  "design-md",
  "social-video-pipeline",
  "hallmark",
];

describe("creative-media package assets", () => {
  it("ships every creative skill for offline first run", () => {
    const root = join(__dirname, "..", "..", "config_seeds", "skills");
    for (const skill of SKILLS) {
      expect(existsSync(join(root, skill, "SKILL.md")), skill).toBe(true);
    }
  });

  it("materializes all external creative MCP adapters", () => {
    const ids = new Set(CURATED_MCP_SERVERS.map((server) => server.id));
    for (const id of [
      "canva",
      "comfyui-mcp",
      "blender-mcp",
      "openmontage",
      "obsidian",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
