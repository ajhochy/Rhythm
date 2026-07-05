import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

/**
 * #911 — lets an agent (specifically the "Rhythm Setup" interview agent, but
 * usable by any agent with this tool granted) actually create a new Agent
 * Profile, instead of only being able to describe one. POSTs to the same
 * /agent-configs endpoint the Flutter profile editor uses, on the local
 * agent server (agentUrl) — never the production API.
 */
export function registerAgentProfileTools(server: McpServer, agentUrl: string) {
  registerTool(
    server,
    'rhythm_create_agent_profile',
    'Create a new Rhythm Agent Profile with the given model, MCP servers, and skills. Use this after confirming the configuration with the user — do not create a profile without their explicit go-ahead. Returns the created profile id.',
    {
      label: z.string().max(100).describe('Display name for the profile, e.g. "Sunday Bulletin Assistant".'),
      systemPrompt: z.string().max(4000).optional().describe('The system prompt for this agent — its role, scope, and how it should behave.'),
      allowedMcps: z.array(z.string()).optional().describe('MCP server names this profile should have access to, e.g. ["rhythm", "pco-services"]. Omit for unrestricted access.'),
      allowedSkills: z.array(z.string()).optional().describe('Skill names this profile should have access to. Omit for unrestricted access.'),
      modelProvider: z.string().optional().describe('e.g. "anthropic", "google". Omit to use the instance default.'),
      modelId: z.string().optional().describe('e.g. "claude-sonnet-4-5". Omit to use the instance default.'),
    },
    async ({ label, systemPrompt, allowedMcps, allowedSkills, modelProvider, modelId }: {
      label: string;
      systemPrompt?: string;
      allowedMcps?: string[];
      allowedSkills?: string[];
      modelProvider?: string;
      modelId?: string;
    }) => {
      try {
        const res = await fetch(`${agentUrl}/agent-configs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label,
            isAgent: true,
            enabled: true,
            systemPrompt,
            allowedMcpsJson: allowedMcps ? JSON.stringify(allowedMcps) : undefined,
            allowedSkillsJson: allowedSkills ? JSON.stringify(allowedSkills) : undefined,
            modelProvider,
            modelId,
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(`Rhythm agent server returned ${res.status}: ${String(err.error ?? res.statusText)}`);
        }
        const data = (await res.json()) as { id: string; label: string };
        return toolResult(`Created agent profile "${data.label}" (id=${data.id}). It is now available in the agent profile picker.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
