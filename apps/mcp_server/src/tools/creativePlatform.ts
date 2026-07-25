import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolError, toolResult } from '../api_client.js';
import { registerTool } from './_tool.js';

const capability = z.enum(['blender', 'comfyui', 'comfyui-model-pack', 'openmontage', 'obsidian', 'document-tools', 'media-tools']);

export function registerCreativePlatformTools(server: McpServer, agentUrl: string): void {
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${agentUrl}/creative-platform${path}`, init);
    if (!response.ok) throw new Error(`Rhythm agent server returned ${response.status}: ${response.statusText}`);
    return response.json();
  };
  registerTool(server, 'rhythm_list_creative_capabilities', 'List local creative capabilities and their install/health status.', {}, async () => {
    try { return toolResult(JSON.stringify(await request('/'), null, 2)); } catch (error) { return toolError(error); }
  });
  registerTool(server, 'rhythm_install_creative_capability', 'Start a pinned local creative capability install only after rhythm_request_approval has approved install_creative_dependency:<id> for this session.', { id: capability, sessionId: z.string().optional(), modelLicenseAccepted: z.boolean().optional() }, async (input: { id: string; sessionId?: string; modelLicenseAccepted?: boolean }) => {
    try { return toolResult(JSON.stringify(await request(`/${input.id}/request-or-start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }), null, 2)); } catch (error) { return toolError(error); }
  });
  registerTool(server, 'rhythm_creative_capability_status', 'Get the current local status of one creative capability.', { id: capability }, async ({ id }: { id: string }) => {
    try { return toolResult(JSON.stringify(await request(`/${id}/status`), null, 2)); } catch (error) { return toolError(error); }
  });
  registerTool(server, 'rhythm_verify_creative_capability', 'Re-check one creative capability after installation or local service startup.', { id: capability }, async ({ id }: { id: string }) => {
    try { return toolResult(JSON.stringify(await request(`/${id}/verify`, { method: 'POST' }), null, 2)); } catch (error) { return toolError(error); }
  });
}
