import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiDelete, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerClaudeTriggerTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_pending_triggers',
    'List Rhythm tasks newly assigned to the Claude service account, awaiting pickup. Returns an array of {id, taskId, taskTitle, taskNotes, taskOwnerId, triggeredByUserId, createdAt}.',
    {},
    async () => {
      try {
        const triggers = await apiGet<unknown[]>(apiUrl, apiToken, '/claude-triggers');
        return toolResult(JSON.stringify(triggers, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_clear_pending_trigger',
    'Remove a pending trigger from the queue (call after picking up the task).',
    { id: z.number().describe('The trigger row ID returned by rhythm_list_pending_triggers.') },
    async ({ id }: { id: number }) => {
      try {
        await apiDelete(apiUrl, apiToken, `/claude-triggers/${id}`);
        return toolResult(`Trigger ${id} cleared.`);
      } catch (err) { return toolError(err); }
    },
  );
}
