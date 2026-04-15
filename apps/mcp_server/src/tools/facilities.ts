import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerFacilityTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_facilities',
    'List all facilities.',
    {},
    async () => {
      try {
        const facilities = await apiGet<unknown[]>(apiUrl, apiToken, '/facilities');
        return toolResult(JSON.stringify(facilities, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_create_reservation',
    'Reserve a facility for a specific time window.',
    {
      facility_id: z.number().int().describe('Facility ID (integer) to reserve.'),
      title: z.string().describe('Purpose or name of the reservation.'),
      requester_name: z.string().describe('Name of the person making the reservation.'),
      start_time: z.string().describe('Start time in ISO 8601 format (e.g. "2026-04-19T09:00:00").'),
      end_time: z.string().describe('End time in ISO 8601 format (e.g. "2026-04-19T12:00:00").'),
      notes: z.string().optional().describe('Optional notes.'),
    },
    async ({ facility_id, title, requester_name, start_time, end_time, notes }: { facility_id: number; title: string; requester_name: string; start_time: string; end_time: string; notes?: string }) => {
      try {
        const reservation = await apiPost<unknown>(apiUrl, apiToken, `/facilities/${facility_id}/reservations`, {
          title,
          requesterName: requester_name,
          startTime: start_time,
          endTime: end_time,
          ...(notes !== undefined && { notes }),
        });
        return toolResult(JSON.stringify(reservation, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
