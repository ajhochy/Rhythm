import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, toolResult, toolError } from '../api_client.js';

export function registerMessageTools(server: McpServer, apiUrl: string, apiToken: string) {
  // rhythm_list_message_threads
  server.tool(
    'rhythm_list_message_threads',
    'List message threads. Optionally filter to only threads with unread messages.',
    {
      unread_only: z.boolean().optional().describe('If true, return only threads with unread messages.'),
    },
    async ({ unread_only }) => {
      try {
        const qs = unread_only ? '?unread=true' : '';
        const threads = await apiGet<unknown[]>(apiUrl, apiToken, `/message-threads${qs}`);
        return toolResult(JSON.stringify(threads, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_create_message_thread
  server.tool(
    'rhythm_create_message_thread',
    "Create a new message thread.",
    {
      title: z.string().describe('Thread title.'),
      participant_ids: z.array(z.number().int()).optional().describe('User IDs to include as participants.'),
      thread_type: z.enum(['direct', 'group']).optional().describe("Thread type: 'direct' or 'group'. Defaults to 'group'."),
    },
    async ({ title, participant_ids, thread_type }) => {
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

  // rhythm_send_message
  server.tool(
    'rhythm_send_message',
    'Send a message to an existing thread.',
    {
      thread_id: z.number().int().describe('Thread ID to send the message to.'),
      body: z.string().describe('Message text.'),
    },
    async ({ thread_id, body }) => {
      try {
        const message = await apiPost<unknown>(apiUrl, apiToken, `/message-threads/${thread_id}/messages`, { body });
        return toolResult(JSON.stringify(message, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
