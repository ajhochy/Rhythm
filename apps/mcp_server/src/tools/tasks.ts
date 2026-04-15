import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, apiDelete, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerTaskTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_tasks',
    'List tasks with optional filters. Returns open tasks by default.',
    {
      status: z.enum(['open', 'done', 'all']).optional().describe("Filter by status. Defaults to 'open'."),
      due_before: z.string().optional().describe('Return tasks due on or before this ISO 8601 date (YYYY-MM-DD).'),
      search: z.string().optional().describe('Case-insensitive substring match against task title.'),
    },
    async ({ status = 'open', due_before, search }: { status?: string; due_before?: string; search?: string }) => {
      try {
        const params = new URLSearchParams();
        if (status !== 'all') params.set('status', status);
        if (due_before) params.set('due_before', due_before);
        if (search) params.set('search', search);
        const qs = params.toString();
        const tasks = await apiGet<unknown[]>(apiUrl, apiToken, `/tasks${qs ? `?${qs}` : ''}`);
        return toolResult(JSON.stringify(tasks, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_create_task',
    'Create a new task.',
    {
      title: z.string().describe('Task title.'),
      notes: z.string().optional().describe('Optional notes or description.'),
      due_date: z.string().optional().describe('Due date in YYYY-MM-DD format.'),
    },
    async ({ title, notes, due_date }: { title: string; notes?: string; due_date?: string }) => {
      try {
        const task = await apiPost<unknown>(apiUrl, apiToken, '/tasks', {
          title,
          ...(notes !== undefined && { notes }),
          ...(due_date !== undefined && { dueDate: due_date }),
        });
        return toolResult(JSON.stringify(task, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_update_task',
    'Update one or more fields of an existing task.',
    {
      id: z.string().describe('Task ID.'),
      title: z.string().optional().describe('New title.'),
      notes: z.string().optional().describe('New notes.'),
      due_date: z.string().nullable().optional().describe('New due date (YYYY-MM-DD) or null to clear it.'),
      status: z.enum(['open', 'done']).optional().describe('New status.'),
    },
    async ({ id, title, notes, due_date, status }: { id: string; title?: string; notes?: string; due_date?: string | null; status?: string }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body.title = title;
        if (notes !== undefined) body.notes = notes;
        if (due_date !== undefined) body.dueDate = due_date;
        if (status !== undefined) body.status = status;
        const task = await apiPatch<unknown>(apiUrl, apiToken, `/tasks/${id}`, body);
        return toolResult(JSON.stringify(task, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_complete_task',
    'Mark a task as done.',
    {
      id: z.string().describe('Task ID to mark as done.'),
    },
    async ({ id }: { id: string }) => {
      try {
        const task = await apiPatch<{ title?: string }>(apiUrl, apiToken, `/tasks/${id}`, { status: 'done' });
        return toolResult(`Task marked as done: ${task.title ?? id}`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_delete_task',
    'Permanently delete a task.',
    {
      id: z.string().describe('Task ID to delete.'),
    },
    async ({ id }: { id: string }) => {
      try {
        await apiDelete(apiUrl, apiToken, `/tasks/${id}`);
        return toolResult(`Task ${id} deleted.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
