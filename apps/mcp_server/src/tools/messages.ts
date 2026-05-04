import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, toolResult, toolError, decodeHtml } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerMessageTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_message_threads',
    'List message threads. Optionally filter to only threads with unread messages.',
    {
      unread_only: z.boolean().optional().describe('If true, return only threads with unread messages.'),
      task_id: z.string().optional().describe('Filter to threads linked to this task ID.'),
    },
    async ({ unread_only, task_id }: { unread_only?: boolean; task_id?: string }) => {
      try {
        const params = new URLSearchParams();
        if (task_id) params.set('task_id', task_id);
        if (unread_only) params.set('unread_only', 'true');
        const qs = params.toString();
        const threads = await apiGet<unknown[]>(apiUrl, apiToken, `/message-threads${qs ? `?${qs}` : ''}`);
        return toolResult(JSON.stringify(threads, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_create_message_thread',
    "Create a new message thread.",
    {
      title: z.string().describe('Thread title.'),
      participant_ids: z.array(z.number().int()).optional().describe('User IDs to include as participants.'),
      thread_type: z.enum(['direct', 'group']).optional().describe("Thread type: 'direct' or 'group'. Defaults to 'group'."),
      task_id: z.string().optional().describe('Optional task ID to link this thread to. Useful when discussing a specific task.'),
    },
    async ({ title, participant_ids, thread_type, task_id }: { title: string; participant_ids?: number[]; thread_type?: string; task_id?: string }) => {
      try {
        const thread = await apiPost<unknown>(apiUrl, apiToken, '/message-threads', {
          title: decodeHtml(title),
          ...(participant_ids !== undefined && { participantIds: participant_ids }),
          ...(thread_type !== undefined && { threadType: thread_type }),
          ...(task_id !== undefined && { taskId: task_id }),
        });
        return toolResult(JSON.stringify(thread, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_send_message',
    'Send a message to an existing thread.',
    {
      thread_id: z.number().int().describe('Thread ID to send the message to.'),
      body: z.string().describe('Message text.'),
    },
    async ({ thread_id, body }: { thread_id: number; body: string }) => {
      try {
        const message = await apiPost<unknown>(apiUrl, apiToken, `/message-threads/${thread_id}/messages`, { body: decodeHtml(body) });
        return toolResult(JSON.stringify(message, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_get_task_thread',
    'Find the message thread linked to a specific task. Returns the thread object or null.',
    { task_id: z.string().describe('The task ID to look up.') },
    async ({ task_id }: { task_id: string }) => {
      try {
        const threads = await apiGet<unknown[]>(
          apiUrl,
          apiToken,
          `/message-threads?task_id=${encodeURIComponent(task_id)}`,
        );
        const thread = Array.isArray(threads) && threads.length > 0 ? threads[0] : null;
        return toolResult(JSON.stringify(thread, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
