import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerNotificationTools(server: McpServer, agentUrl: string) {
  registerTool(
    server,
    'rhythm_notify',
    'Send a notification to the Rhythm app user. Use this when you have finished a task or have something important to report. The notification appears as a macOS system alert when Rhythm is in the background, and as an in-app badge when it is foregrounded.',
    {
      title: z.string().max(200).describe('Short headline, e.g. "Refactor complete".'),
      body: z.string().max(200).describe('One or two sentences of detail about what you did or found.'),
    },
    async ({ title, body }: { title: string; body: string }) => {
      try {
        const res = await fetch(`${agentUrl}/notifications/agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body }),
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
