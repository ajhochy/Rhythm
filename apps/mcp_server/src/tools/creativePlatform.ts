import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolError, toolResult } from '../api_client.js';
import { authorizeOutboundAction } from '../security/external_content_boundary.js';
import {
  trustedSecurityCall,
  trustedSecurityContext,
} from '../security/security_context.js';
import { registerTool } from './_tool.js';

const capability = z.enum([
  'blender',
  'comfyui',
  'comfyui-model-pack',
  'openmontage',
  'obsidian',
  'document-tools',
  'media-tools',
]);

export function registerCreativePlatformTools(
  server: McpServer,
  agentUrl: string,
): void {
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${agentUrl}/creative-platform${path}`, init);
    if (!response.ok)
      throw new Error(`Rhythm agent server returned ${response.status}: ${response.statusText}`);
    return response.json();
  };
  const recordDesign = async (input: Record<string, unknown>) => {
    const response = await fetch(`${agentUrl}/agent-designs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok)
      throw new Error(`Rhythm agent server returned ${response.status}: ${response.statusText}`);
    return response.json();
  };
  registerTool(
    server,
    'rhythm_list_creative_capabilities',
    'List local creative capabilities and their install/health status.',
    {},
    async () => {
      try {
        return toolResult(JSON.stringify(await request('/'), null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
  registerTool(
    server,
    'rhythm_install_creative_capability',
    'Request or start a pinned local creative capability install. The first call creates a human approval bound to the trusted current session; call again only after the human approves it.',
    {
      id: capability,
      modelLicenseAccepted: z.boolean().optional(),
      approval_id: z
        .string()
        .optional()
        .describe('Security-bound approval id required only after reading untrusted content.'),
    },
    async (
      input: {
        id: string;
        modelLicenseAccepted?: boolean;
        approval_id?: string;
      },
      extra,
    ) => {
      const { approval_id, ...payload } = input;
      const context = trustedSecurityContext(extra);
      const gate = await authorizeOutboundAction({
        agentUrl,
        context,
        approvalId: approval_id,
        action: 'creative-capability.install',
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: gate.refusalMessage as string }],
          isError: true as const,
        };
      }
      try {
        const call = trustedSecurityCall(extra);
        return toolResult(
          JSON.stringify(
            await request(`/${input.id}/request-or-start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                trustedCall: call
                  ? { ...call, arguments: input }
                  : null,
              }),
            }),
            null,
            2,
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
  registerTool(
    server,
    'rhythm_creative_capability_status',
    'Get the current local status of one creative capability.',
    { id: capability },
    async ({ id }: { id: string }) => {
      try {
        return toolResult(JSON.stringify(await request(`/${id}/status`), null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
  registerTool(
    server,
    'rhythm_verify_creative_capability',
    'Re-check one creative capability after installation or local service startup.',
    { id: capability },
    async ({ id }: { id: string }) => {
      try {
        return toolResult(
          JSON.stringify(await request(`/${id}/verify`, { method: 'POST' }), null, 2),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
  registerTool(
    server,
    'rhythm_record_design',
    'Record a finished Creative Media artifact. Provide exactly one deliverable locator (localPath or HTTPS artifactUrl); optional HTTPS projectUrl is for the editable source. The API validates providers, titles, locations, and formats.',
    {
      title: z.string(),
      provider: z.string(),
      artifactType: z.string().optional(),
      localPath: z.string().optional(),
      artifactUrl: z.string().optional(),
      projectUrl: z.string().optional(),
      canvaUrl: z.string().optional(),
      sessionId: z.string().optional(),
      approval_id: z
        .string()
        .optional()
        .describe('Security-bound approval id required only after reading untrusted content.'),
    },
    async (input: Record<string, unknown>, extra) => {
      const { approval_id, ...payload } = input;
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: typeof approval_id === 'string' ? approval_id : undefined,
        action: 'creative-artifact.record',
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: gate.refusalMessage as string }],
          isError: true as const,
        };
      }
      try {
        return toolResult(JSON.stringify(await recordDesign(payload), null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
