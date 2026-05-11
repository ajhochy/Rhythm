import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, apiDelete, toolResult, toolError, decodeHtml } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerTaskTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_tasks',
    'List tasks with optional filters. Returns open tasks by default. ' +
    'Each task has two date fields with different semantics: scheduledDate is the intended work date — ' +
    'when the task should be started or completed in normal workflow; dueDate is the hard external deadline — ' +
    'a commitment to someone else or a fixed event. Use scheduled_before to answer "what should I be working ' +
    'on by date X"; use due_before only when you specifically need hard-deadline filtering. ' +
    'Results are sorted in the following canonical order: ' +
    '(1) overdue open tasks first (status != done AND COALESCE(scheduledDate, dueDate) < today), ' +
    '(2) then by COALESCE(scheduledDate, dueDate) ascending with NULLs last, ' +
    '(3) then by scheduledOrder ascending with NULLs last, ' +
    '(4) then by createdAt ascending. ' +
    'This surfaces already-broken items before the day\'s upcoming work. ' +
    'Fields returned per task: id, title, status, notes, ' +
    'scheduledDate (when the user plans to do it; drives overdue state), ' +
    'dueDate (hard external deadline; drives past-deadline state), ' +
    'createdAt, updatedAt.',
    {
      status: z.enum(['open', 'done', 'all']).optional().describe("Filter by status. Defaults to 'open'."),
      due_before: z.string().optional().describe('Return tasks where the HARD DEADLINE (dueDate) is on or before this YYYY-MM-DD date. Use only when you specifically need deadline-based filtering. For "what is due to be done by date X", use scheduled_before instead.'),
      scheduled_before: z.string().optional().describe('Return tasks where scheduledDate (or dueDate as fallback if no scheduledDate) is on or before this YYYY-MM-DD date. This is usually what you want — it answers "what should I be working on by date X".'),
      overdue: z.boolean().optional().describe('When true, returns only tasks that are overdue: status is not done AND scheduled date has passed.'),
      search: z.string().optional().describe('Case-insensitive substring match against task title.'),
    },
    async ({ status = 'open', due_before, scheduled_before, overdue, search }: { status?: string; due_before?: string; scheduled_before?: string; overdue?: boolean; search?: string }) => {
      try {
        const params = new URLSearchParams();
        if (status !== 'all') params.set('status', status);
        if (due_before) params.set('due_before', due_before);
        if (scheduled_before) params.set('scheduled_before', scheduled_before);
        if (overdue !== undefined) params.set('overdue', overdue ? 'true' : 'false');
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
    'Create a new task. ' +
    'Fields returned: id, title, status, notes, ' +
    'scheduledDate (when the user plans to do it; drives overdue state), ' +
    'dueDate (hard external deadline; drives past-deadline state), ' +
    'createdAt, updatedAt.',
    {
      title: z.string().describe('Task title.'),
      notes: z.string().optional().describe('Optional notes or description.'),
      due_date: z.string().optional().describe('Due date in YYYY-MM-DD format.'),
    },
    async ({ title, notes, due_date }: { title: string; notes?: string; due_date?: string }) => {
      try {
        const task = await apiPost<unknown>(apiUrl, apiToken, '/tasks', {
          title: decodeHtml(title),
          ...(notes !== undefined && { notes: decodeHtml(notes) }),
          ...(due_date !== undefined && { dueDate: due_date }),
        });
        return toolResult(JSON.stringify(task, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_update_task',
    'Update one or more fields of an existing task. ' +
    'Fields returned: id, title, status, notes, ' +
    'scheduledDate (when the user plans to do it; drives overdue state), ' +
    'dueDate (hard external deadline; drives past-deadline state), ' +
    'createdAt, updatedAt.',
    {
      id: z.string().describe('Task ID.'),
      title: z.string().optional().describe('New title.'),
      notes: z.string().optional().describe('New notes.'),
      due_date: z.string().nullable().optional().describe('New due date (YYYY-MM-DD) or null to clear it.'),
      status: z
        .enum(['open', 'in_progress', 'waiting_for_reply', 'done'])
        .optional()
        .describe('New status. Values: open, in_progress, waiting_for_reply, done.'),
    },
    async ({ id, title, notes, due_date, status }: { id: string; title?: string; notes?: string; due_date?: string | null; status?: string }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body.title = decodeHtml(title);
        if (notes !== undefined) body.notes = decodeHtml(notes);
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
    'Mark a task as done. Returns a confirmation string with the task title. ' +
    'Date fields on the task: scheduledDate (when the user planned to do it; drives overdue state), ' +
    'dueDate (hard external deadline; drives past-deadline state).',
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
