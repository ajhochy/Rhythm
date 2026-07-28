import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, toolResult, toolError, decodeHtml } from '../api_client.js';
import { registerTool } from './_tool.js';
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
} from '../security/external_content_boundary.js';
import { trustedSecurityContext } from '../security/security_context.js';
// The centralized ingress calls scanContextContent, then
// recordExternalContentTaint, then untrustedContext; raw message text never
// reaches toolResult before that sequence succeeds.

export function registerMessageTools(server: McpServer, apiUrl: string, apiToken: string, agentUrl: string) {
  registerTool(server, 'rhythm_list_message_threads',
    'List message threads. Optionally filter to only threads with unread messages.',
    {
      unread_only: z.boolean().optional().describe('If true, return only threads with unread messages.'),
      task_id: z.string().optional().describe('Filter to threads linked to this task ID.'),
    },
    async ({ unread_only, task_id }: { unread_only?: boolean; task_id?: string }, extra) => {
      try {
        const params = new URLSearchParams();
        if (task_id) params.set('task_id', task_id);
        if (unread_only) params.set('unread_only', 'true');
        const qs = params.toString();
        const threads = await apiGet<unknown[]>(apiUrl, apiToken, `/message-threads${qs ? `?${qs}` : ''}`);
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: 'message-thread.list',
          label: 'shared message threads',
          rawContent: JSON.stringify(threads, null, 2),
        });
        return ingress.blocked
          ? { content: [{ type: 'text' as const, text: ingress.text }], isError: true as const }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_create_message_thread',
    'Create a new message thread. After external content was read, request human approval ' +
    'with security_action="message-thread.create" and the exact normalized payload, then retry once.',
    {
      title: z.string().describe('Thread title.'),
      participant_ids: z.array(z.number().int()).optional().describe('User IDs to include as participants.'),
      thread_type: z.enum(['direct', 'group']).optional().describe("Thread type: 'direct' or 'group'. Defaults to 'group'."),
      task_id: z.string().optional().describe('Optional task ID to link this thread to. Useful when discussing a specific task.'),
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval — required if this session has read untrusted external content.'),
    },
    async ({ title, participant_ids, thread_type, task_id, approval_id }: { title: string; participant_ids?: number[]; thread_type?: string; task_id?: string; approval_id?: string }, extra) => {
      const payload = {
        title: decodeHtml(title),
        ...(participant_ids !== undefined && { participantIds: participant_ids }),
        ...(thread_type !== undefined && { threadType: thread_type }),
        ...(task_id !== undefined && { taskId: task_id }),
      };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: 'message-thread.create',
        payload,
      });
      if (!gate.allowed) {
        return { content: [{ type: 'text' as const, text: gate.refusalMessage as string }], isError: true as const };
      }
      try {
        const thread = await apiPost<unknown>(apiUrl, apiToken, '/message-threads', payload);
        return toolResult(JSON.stringify(thread, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_send_message',
    'Send a message to an existing thread. After external content was read, request human approval ' +
    'with security_action="message.send" and security_payload={threadId,body}, then retry once.',
    {
      thread_id: z.number().int().describe('Thread ID to send the message to.'),
      body: z.string().describe('Message text.'),
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval — required if this session has read untrusted external content.'),
    },
    async ({ thread_id, body, approval_id }: { thread_id: number; body: string; approval_id?: string }, extra) => {
      const payload = { threadId: thread_id, body: decodeHtml(body) };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: 'message.send',
        payload,
      });
      if (!gate.allowed) {
        return { content: [{ type: 'text' as const, text: gate.refusalMessage as string }], isError: true as const };
      }
      try {
        const message = await apiPost<unknown>(apiUrl, apiToken, `/message-threads/${thread_id}/messages`, { body: payload.body });
        return toolResult(JSON.stringify(message, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_get_task_thread',
    'Find the message thread linked to a specific task. Returns the thread object or null.',
    { task_id: z.string().describe('The task ID to look up.') },
    async ({ task_id }: { task_id: string }, extra) => {
      try {
        const threads = await apiGet<unknown[]>(
          apiUrl,
          apiToken,
          `/message-threads?task_id=${encodeURIComponent(task_id)}`,
        );
        const thread = Array.isArray(threads) && threads.length > 0 ? threads[0] : null;
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: 'message-thread.task',
          label: 'task-linked message thread',
          rawContent: JSON.stringify(thread, null, 2),
        });
        return ingress.blocked
          ? { content: [{ type: 'text' as const, text: ingress.text }], isError: true as const }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
