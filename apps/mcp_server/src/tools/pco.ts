import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, toolResult, toolError, RhythmApiError } from '../api_client.js';
import { registerTool } from './_tool.js';

function handleErr(err: unknown) {
  if (err instanceof RhythmApiError && err.status === 403) {
    return toolError(
      new Error(
        'Your Planning Center account lacks permission for this action. ' +
        'A PCO admin must grant the needed role/permission.',
      ),
    );
  }
  return toolError(err);
}

export function registerPcoTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_pco_list_service_types',
    'List Planning Center Services service types (e.g. "Sunday Morning"). Returns id and name for each.',
    {},
    async () => {
      try {
        const data = await apiGet<unknown>(apiUrl, apiToken, '/integrations/planning-center/api/service-types');
        return toolResult(JSON.stringify(data, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_list_plans',
    'List upcoming (future) Planning Center plans for a service type. Returns id, title, dates.',
    { service_type_id: z.string().describe('Service type id from rhythm_pco_list_service_types.') },
    async ({ service_type_id }: { service_type_id: string }) => {
      try {
        const data = await apiGet<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/service-types/${service_type_id}/plans`);
        return toolResult(JSON.stringify(data, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_get_plan_items',
    'List the items (songs, sermons, etc.) in a Planning Center plan. Returns id, title, type.',
    {
      service_type_id: z.string().describe('Service type id.'),
      plan_id: z.string().describe('Plan id from rhythm_pco_list_plans.'),
    },
    async ({ service_type_id, plan_id }: { service_type_id: string; plan_id: string }) => {
      try {
        const data = await apiGet<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/service-types/${service_type_id}/plans/${plan_id}/items`);
        return toolResult(JSON.stringify(data, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_list_needed_positions',
    'List unfilled/needed positions for a Planning Center plan. Returns id, teamPositionName, quantity.',
    {
      service_type_id: z.string().describe('Service type id.'),
      plan_id: z.string().describe('Plan id.'),
    },
    async ({ service_type_id, plan_id }: { service_type_id: string; plan_id: string }) => {
      try {
        const data = await apiGet<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/service-types/${service_type_id}/plans/${plan_id}/needed-positions`);
        return toolResult(JSON.stringify(data, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_update_plan_item',
    'Update a Planning Center plan item (e.g. its title). Requires PCO edit permission.',
    {
      service_type_id: z.string(),
      plan_id: z.string(),
      item_id: z.string(),
      title: z.string().describe('New item title.'),
    },
    async ({ service_type_id, plan_id, item_id, title }: { service_type_id: string; plan_id: string; item_id: string; title: string }) => {
      try {
        const data = await apiPatch<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/service-types/${service_type_id}/plans/${plan_id}/items/${item_id}`, { title });
        return toolResult(JSON.stringify(data, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_assign_person',
    'Assign a person to a position on a Planning Center plan. Requires PCO scheduling permission.',
    {
      plan_id: z.string(),
      person_id: z.string(),
      team_id: z.string(),
      position_name: z.string(),
    },
    async ({ plan_id, person_id, team_id, position_name }: { plan_id: string; person_id: string; team_id: string; position_name: string }) => {
      try {
        const data = await apiPost<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/plans/${plan_id}/team-members`, { personId: person_id, teamId: team_id, positionName: position_name });
        return toolResult(JSON.stringify(data, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_update_scheduled_person',
    "Update a scheduled person's status on a plan (e.g. confirm/decline). Requires PCO scheduling permission.",
    {
      plan_id: z.string(),
      member_id: z.string(),
      status: z.string().describe('New status, e.g. "C" (confirmed) or "D" (declined).'),
    },
    async ({ plan_id, member_id, status }: { plan_id: string; member_id: string; status: string }) => {
      try {
        const data = await apiPatch<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/plans/${plan_id}/team-members/${member_id}`, { status });
        return toolResult(JSON.stringify(data, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );
}
