import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiDelete, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerClaudeTriggerTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_pending_triggers',
    `List pending agent triggers — both human-assigned tasks and scheduler/webhook-originated jobs.
Returns an array of objects with:
  id              — trigger row ID (use with rhythm_clear_pending_trigger)
  taskId          — task UUID when triggered from the Agents tab; null for scheduled/webhook/research jobs
  taskTitle       — task title (null for non-task triggers)
  taskNotes       — task notes (null for non-task triggers)
  taskOwnerId     — owner user ID (null for non-task triggers)
  prompt          — structured prompt for scheduled/webhook/research triggers; null for task triggers
  scheduledTaskId — ID of the agent_scheduled_tasks row that fired this trigger (if scheduled)
  webhookEndpointId — ID of the agent_webhook_endpoints row (if webhook-triggered)
  allowedMcps     — array of MCP server names this run may use, or null = unrestricted
  allowedSkills   — array of skill names this run may use, or null = unrestricted
  triggeredByUserId
  createdAt`,
    {},
    async () => {
      try {
        const triggers = await apiGet<unknown[]>(apiUrl, apiToken, '/claude-triggers');
        return toolResult(JSON.stringify(triggers, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_clear_pending_trigger',
    'Remove a pending trigger from the queue (call after completing the task or job).',
    { id: z.number().describe('The trigger row ID returned by rhythm_list_pending_triggers.') },
    async ({ id }: { id: number }) => {
      try {
        await apiDelete(apiUrl, apiToken, `/claude-triggers/${id}`);
        return toolResult(`Trigger ${id} cleared.`);
      } catch (err) { return toolError(err); }
    },
  );
}
