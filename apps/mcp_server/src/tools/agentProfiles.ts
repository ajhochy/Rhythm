import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
} from '../security/external_content_boundary.js';
import { trustedSecurityContext } from '../security/security_context.js';

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
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval — required after reading untrusted content.'),
    },
    async ({ label, systemPrompt, allowedMcps, allowedSkills, modelProvider, modelId, approval_id }: {
      label: string;
      systemPrompt?: string;
      allowedMcps?: string[];
      allowedSkills?: string[];
      modelProvider?: string;
      modelId?: string;
      approval_id?: string;
    }, extra) => {
      const payload: Record<string, unknown> = {
        label,
        isAgent: true,
        enabled: true,
      };
      if (systemPrompt !== undefined) payload.systemPrompt = systemPrompt;
      if (allowedMcps !== undefined) payload.allowedMcpsJson = JSON.stringify(allowedMcps);
      if (allowedSkills !== undefined) payload.allowedSkillsJson = JSON.stringify(allowedSkills);
      if (modelProvider !== undefined) payload.modelProvider = modelProvider;
      if (modelId !== undefined) payload.modelId = modelId;
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: 'agent-profile.create',
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: gate.refusalMessage as string }],
          isError: true as const,
        };
      }
      try {
        const res = await fetch(`${agentUrl}/agent-configs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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

  registerTool(
    server,
    'rhythm_list_agent_profile_permissions',
    'List Rhythm agent profiles with only their permission-related fields. Use for config repair audits; does not expose prompts or secrets.',
    {},
    async (_args, extra) => {
      try {
        const res = await fetch(`${agentUrl}/agent-configs`);
        if (!res.ok) throw new Error(`Rhythm agent server returned ${res.status}: ${res.statusText}`);
        const profiles = (await res.json()) as Array<Record<string, unknown>>;
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: 'agent-profile.permissions.list',
          label: 'user-authored agent profile permissions',
          rawContent: JSON.stringify(profiles.map(permissionSummary), null, 2),
        });
        return ingress.blocked
          ? { content: [{ type: 'text' as const, text: ingress.text }], isError: true as const }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    'rhythm_get_agent_profile_permissions',
    'Get one Rhythm agent profile permission summary by id. Returns only permission-related fields.',
    { id: z.string().describe('Agent profile id, e.g. "config-doctor".') },
    async ({ id }: { id: string }, extra) => {
      try {
        const res = await fetch(`${agentUrl}/agent-configs/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`Rhythm agent server returned ${res.status}: ${res.statusText}`);
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: 'agent-profile.permissions.get',
          label: 'user-authored agent profile permissions',
          rawContent: JSON.stringify(permissionSummary(await res.json() as Record<string, unknown>), null, 2),
        });
        return ingress.blocked
          ? { content: [{ type: 'text' as const, text: ingress.text }], isError: true as const }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    'rhythm_update_agent_profile_permissions',
    'Update only permission fields on a Rhythm agent profile, then ask Rhythm to re-project its opencode agent file. Null clears/unrestricts; omit a field for no change.',
    {
      id: z.string().describe('Agent profile id, e.g. "Theological-Researcher".'),
      allowedMcpsJson: z.string().nullable().optional().describe('JSON MCP allowlist string or null. Do not put core tools like bash/read here.'),
      allowedSkillsJson: z.string().nullable().optional().describe('JSON skill allowlist string or null.'),
      corePermissionsJson: z.string().nullable().optional().describe('JSON opencode core permission object string or null, e.g. {"bash":"ask"}.'),
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval — required after reading untrusted content.'),
    },
    async ({ id, allowedMcpsJson, allowedSkillsJson, corePermissionsJson, approval_id }: {
      id: string;
      allowedMcpsJson?: string | null;
      allowedSkillsJson?: string | null;
      corePermissionsJson?: string | null;
      approval_id?: string;
    }, extra) => {
      try {
        const patch = Object.fromEntries(
          Object.entries({ allowedMcpsJson, allowedSkillsJson, corePermissionsJson })
            .filter(([, value]) => value !== undefined),
        );
        const gate = await authorizeOutboundAction({
          agentUrl,
          context: trustedSecurityContext(extra),
          approvalId: approval_id,
          action: 'agent-profile.permissions.update',
          payload: { id, ...patch },
        });
        if (!gate.allowed) {
          return {
            content: [{ type: 'text' as const, text: gate.refusalMessage as string }],
            isError: true as const,
          };
        }
        const res = await fetch(`${agentUrl}/agent-configs/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(`Rhythm agent server returned ${res.status}: ${String(err.error ?? res.statusText)}`);
        }
        const resync = await fetch(`${agentUrl}/agent-configs/${encodeURIComponent(id)}/resync-agent-file`, { method: 'POST' });
        if (!resync.ok) throw new Error(`Rhythm agent server resync returned ${resync.status}: ${resync.statusText}`);
        return toolResult(JSON.stringify(permissionSummary(await res.json() as Record<string, unknown>), null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

function permissionSummary(profile: Record<string, unknown>) {
  return {
    id: profile.id,
    label: profile.label,
    allowedMcpsJson: profile.allowedMcpsJson ?? null,
    allowedSkillsJson: profile.allowedSkillsJson ?? null,
    corePermissionsJson: profile.corePermissionsJson ?? null,
  };
}
