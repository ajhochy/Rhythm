import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';
import { authorizeOutboundAction } from '../security/external_content_boundary.js';
import { trustedSecurityContext } from '../security/security_context.js';

export function registerNotificationTools(server: McpServer, agentUrl: string) {
  registerTool(
    server,
    'rhythm_notify',
    'Send a notification to the Rhythm app user. Use this when you have finished a task or have something important to report. The notification appears as a macOS system alert when Rhythm is in the background, and as an in-app badge when it is foregrounded.',
    {
      title: z.string().max(200).describe('Short headline, e.g. "Refactor complete".'),
      body: z.string().max(200).describe('One or two sentences of detail about what you did or found.'),
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval — required after reading untrusted content.'),
    },
    async ({ title, body, approval_id }: { title: string; body: string; approval_id?: string }, extra) => {
      const payload = { title, body };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: 'notification.send',
        payload,
      });
      if (!gate.allowed) {
        return { content: [{ type: 'text' as const, text: gate.refusalMessage as string }], isError: true as const };
      }
      try {
        const res = await fetch(`${agentUrl}/notifications/agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(`Rhythm agent server returned ${res.status}: ${String(err.error ?? res.statusText)}`);
        }
        const data = await res.json() as { id: number };
        return toolResult(`Notification sent (id=${data.id}). The user has been alerted in Rhythm.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
