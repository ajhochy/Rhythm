import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerMessageTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_message_threads',
    'List message threads. Optionally filter to only threads with unread messages.',
    {
      unread_only: z.boolean().optional().describe('If true, return only threads with unread messages.'),
    },
    async ({ unread_only }: { unread_only?: boolean }) => {
      try {
        const qs = unread_only ? '?unread=true' : '';
        const threads = await apiGet<unknown[]>(apiUrl, apiToken, `/message-threads${qs}`);
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
    },
    async ({ title, participant_ids, thread_type }: { title: string; participant_ids?: number[]; thread_type?: string }) => {
      try {
        const thread = await apiPost<unknown>(apiUrl, apiToken, '/message-threads', {
          title,
          ...(participant_ids !== undefined && { participantIds: participant_ids }),
          ...(thread_type !== undefined && { threadType: thread_type }),
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
        const message = await apiPost<unknown>(apiUrl, apiToken, `/message-threads/${thread_id}/messages`, { body });
        return toolResult(JSON.stringify(message, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
