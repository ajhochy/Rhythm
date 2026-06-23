/**
 * MCP tools for the Agent Scheduler (Feature A).
 *
 * rhythm_create_scheduled_task  — Create a new recurring or one-time agent task
 * rhythm_list_scheduled_tasks   — List all scheduled tasks
 * rhythm_cancel_scheduled_task  — Disable a scheduled task
 * rhythm_trigger_now            — Force a scheduled task to fire immediately
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, apiDelete, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerAgentScheduleTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_create_scheduled_task',
    `Create a new agent scheduled task. The scheduler fires the task at the computed time and inserts a pending trigger so the agent picks it up automatically.

scheduleType options:
  "daily"   — runs once per day at scheduledTime (HH:MM)
  "weekly"  — runs once per week; scheduledDay = 0 (Sun) … 6 (Sat)
  "monthly" — runs once per month; scheduledDay = 1 … 28
  "cron"    — runs on a standard 5-field cron expression
  "once"    — runs once at the ISO datetime in runAt

allowedMcps / allowedSkills narrow what the agent may use for this run (leave null for no restrictions).`,
    {
      name: z.string().describe('Human-readable name for this task.'),
      prompt: z.string().describe('The prompt the agent receives when this task fires.'),
      scheduleType: z.enum(['daily', 'weekly', 'monthly', 'cron', 'once']),
      scheduledTime: z.string().optional().describe('HH:MM for daily/weekly/monthly.'),
      scheduledDay: z.number().optional().describe('Day of week (0-6) for weekly, or day of month (1-28) for monthly.'),
      cronExpression: z.string().optional().describe('5-field cron expression e.g. "0 8 * * 1-5"'),
      runAt: z.string().optional().describe('ISO 8601 datetime for once-off tasks.'),
      timezone: z.string().optional().describe('IANA timezone, default America/Los_Angeles.'),
      allowedMcps: z.array(z.string()).optional().describe('MCP server names allowed for this run.'),
      allowedSkills: z.array(z.string()).optional().describe('Skill names allowed for this run.'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await apiPost(apiUrl, apiToken, '/agent-schedules', args);
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_list_scheduled_tasks',
    'List all agent scheduled tasks with their next_run_at, enabled status, and last_run_status.',
    {},
    async () => {
      try {
        const tasks = await apiGet(apiUrl, apiToken, '/agent-schedules');
        return toolResult(JSON.stringify(tasks, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_cancel_scheduled_task',
    'Disable a scheduled task so it no longer fires. Pass enabled: true to re-enable.',
    {
      id: z.string().describe('The scheduled task UUID.'),
      enabled: z.boolean().optional().describe('Set to true to re-enable a previously disabled task. Default: false (disable).'),
    },
    async ({ id, enabled = false }: { id: string; enabled?: boolean }) => {
      try {
        const result = await apiPatch(apiUrl, apiToken, `/agent-schedules/${id}`, { enabled });
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_trigger_now',
    'Force a scheduled task to fire immediately regardless of its next_run_at time.',
    { id: z.string().describe('The scheduled task UUID.') },
    async ({ id }: { id: string }) => {
      try {
        const result = await apiPost(apiUrl, apiToken, `/agent-schedules/${id}/trigger-now`, {});
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) { return toolError(err); }
    },
  );
}
