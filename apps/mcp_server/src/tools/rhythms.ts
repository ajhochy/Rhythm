import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, apiDelete, toolResult, toolError } from '../api_client.js';

export function registerRhythmTools(server: McpServer, apiUrl: string, apiToken: string) {
  // rhythm_list_rhythms
  server.tool(
    'rhythm_list_rhythms',
    'List all recurring rules (rhythms).',
    {
      enabled_only: z.boolean().optional().describe('If true, return only enabled rhythms.'),
    },
    async ({ enabled_only }) => {
      try {
        const qs = enabled_only ? '?enabled=true' : '';
        const rhythms = await apiGet<unknown[]>(apiUrl, apiToken, `/recurring-rules${qs}`);
        return toolResult(JSON.stringify(rhythms, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_create_rhythm
  server.tool(
    'rhythm_create_rhythm',
    "Create a new recurring rule. Use frequency 'annual' (not 'yearly').",
    {
      title: z.string().describe('Rhythm name.'),
      frequency: z.enum(['weekly', 'monthly', 'annual']).describe("Recurrence frequency: 'weekly', 'monthly', or 'annual'."),
      day_of_week: z.string().optional().describe("Day for weekly rhythms (e.g. 'Sunday', 'Monday')."),
      day_of_month: z.number().int().min(1).max(31).optional().describe('Day of month for monthly/annual rhythms.'),
      month: z.number().int().min(1).max(12).optional().describe('Month (1–12) for annual rhythms only.'),
    },
    async ({ title, frequency, day_of_week, day_of_month, month }) => {
      try {
        const rhythm = await apiPost<unknown>(apiUrl, apiToken, '/recurring-rules', {
          title,
          frequency,
          ...(day_of_week !== undefined && { dayOfWeek: day_of_week }),
          ...(day_of_month !== undefined && { dayOfMonth: day_of_month }),
          ...(month !== undefined && { month }),
        });
        return toolResult(JSON.stringify(rhythm, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_update_rhythm
  server.tool(
    'rhythm_update_rhythm',
    'Update an existing recurring rule.',
    {
      id: z.string().describe('Rhythm ID.'),
      title: z.string().optional().describe('New title.'),
      frequency: z.enum(['weekly', 'monthly', 'annual']).optional().describe('New frequency.'),
      day_of_week: z.string().optional().describe('New day of week.'),
      day_of_month: z.number().int().nullable().optional().describe('New day of month, or null to clear.'),
      month: z.number().int().nullable().optional().describe('New month, or null to clear.'),
      enabled: z.boolean().optional().describe('Enable or disable the rhythm.'),
    },
    async ({ id, title, frequency, day_of_week, day_of_month, month, enabled }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body.title = title;
        if (frequency !== undefined) body.frequency = frequency;
        if (day_of_week !== undefined) body.dayOfWeek = day_of_week;
        if (day_of_month !== undefined) body.dayOfMonth = day_of_month;
        if (month !== undefined) body.month = month;
        if (enabled !== undefined) body.enabled = enabled;
        const rhythm = await apiPatch<unknown>(apiUrl, apiToken, `/recurring-rules/${id}`, body);
        return toolResult(JSON.stringify(rhythm, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_delete_rhythm
  server.tool(
    'rhythm_delete_rhythm',
    'Permanently delete a recurring rule.',
    {
      id: z.string().describe('Rhythm ID to delete.'),
    },
    async ({ id }) => {
      try {
        await apiDelete(apiUrl, apiToken, `/recurring-rules/${id}`);
        return toolResult(`Rhythm ${id} deleted.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
