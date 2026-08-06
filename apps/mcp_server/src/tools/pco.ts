import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, toolResult, toolError, RhythmApiError } from '../api_client.js';
import { registerTool } from './_tool.js';
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
  type ExternalContentSource,
} from '../security/external_content_boundary.js';
import { trustedSecurityContext } from '../security/security_context.js';

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

export function registerPcoTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  agentUrl = process.env.RHYTHM_AGENT_URL ?? 'http://127.0.0.1:4001',
) {
  const externalResult = async (
    data: unknown,
    source: ExternalContentSource,
    label: string,
    extra: Parameters<typeof trustedSecurityContext>[0],
  ) => {
    const ingress = await scanContextContentAndRecordExternalContentTaint({
      agentUrl,
      context: trustedSecurityContext(extra),
      source,
      label,
      rawContent: JSON.stringify(data, null, 2),
    });
    return ingress.blocked
      ? { content: [{ type: 'text' as const, text: ingress.text }], isError: true as const }
      : toolResult(ingress.text);
  };

  registerTool(server, 'rhythm_pco_list_service_types',
    'List Planning Center Services service types (e.g. "Sunday Morning"). Returns id and name for each.',
    {},
    async (_args, extra) => {
      try {
        const data = await apiGet<unknown>(apiUrl, apiToken, '/integrations/planning-center/api/service-types');
        return await externalResult(
          data,
          'pco.service-types',
          'Planning Center service types',
          extra,
        );
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_list_plans',
    'List Planning Center plans for a service type. Returns id, title, dates. ' +
    'Defaults to upcoming (future) plans; pass filter="past" for plans that ' +
    'have already happened, newest first — that is what a song-usage or ' +
    'service-history sync needs. Returns at most 100 plans per call.',
    {
      service_type_id: z.string().describe('Service type id from rhythm_pco_list_service_types.'),
      filter: z.enum(['future', 'past']).optional().describe(
        'Which side of today to list. "future" (default) for upcoming plans, "past" for plans already held, newest first.',
      ),
    },
    async ({ service_type_id, filter }: { service_type_id: string; filter?: 'future' | 'past' }, extra) => {
      try {
        const query = filter ? `?filter=${filter}` : '';
        const data = await apiGet<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/service-types/${service_type_id}/plans${query}`);
        return await externalResult(data, 'pco.plans', 'Planning Center plans', extra);
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_get_plan_items',
    'List the items (songs, sermons, etc.) in a Planning Center plan. Returns id, title, type.',
    {
      service_type_id: z.string().describe('Service type id.'),
      plan_id: z.string().describe('Plan id from rhythm_pco_list_plans.'),
    },
    async ({ service_type_id, plan_id }: { service_type_id: string; plan_id: string }, extra) => {
      try {
        const data = await apiGet<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/service-types/${service_type_id}/plans/${plan_id}/items`);
        return await externalResult(data, 'pco.plan-items', 'Planning Center plan items', extra);
      } catch (err) { return handleErr(err); }
    },
  );

  registerTool(server, 'rhythm_pco_list_needed_positions',
    'List unfilled/needed positions for a Planning Center plan. Returns id, teamPositionName, quantity.',
    {
      service_type_id: z.string().describe('Service type id.'),
      plan_id: z.string().describe('Plan id.'),
    },
    async ({ service_type_id, plan_id }: { service_type_id: string; plan_id: string }, extra) => {
      try {
        const data = await apiGet<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/service-types/${service_type_id}/plans/${plan_id}/needed-positions`);
        return await externalResult(
          data,
          'pco.needed-positions',
          'Planning Center needed positions',
          extra,
        );
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
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval — required if this session has read untrusted external content.'),
    },
    async ({ service_type_id, plan_id, item_id, title, approval_id }: { service_type_id: string; plan_id: string; item_id: string; title: string; approval_id?: string }, extra) => {
      const payload = {
        serviceTypeId: service_type_id,
        planId: plan_id,
        itemId: item_id,
        title,
      };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: 'pco.plan-item.update',
        payload,
      });
      if (!gate.allowed) {
        return { content: [{ type: 'text' as const, text: gate.refusalMessage as string }], isError: true as const };
      }
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
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval — required if this session has read untrusted external content.'),
    },
    async ({ plan_id, person_id, team_id, position_name, approval_id }: { plan_id: string; person_id: string; team_id: string; position_name: string; approval_id?: string }, extra) => {
      const payload = {
        planId: plan_id,
        personId: person_id,
        teamId: team_id,
        positionName: position_name,
      };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: 'pco.person.assign',
        payload,
      });
      if (!gate.allowed) {
        return { content: [{ type: 'text' as const, text: gate.refusalMessage as string }], isError: true as const };
      }
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
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval — required if this session has read untrusted external content.'),
    },
    async ({ plan_id, member_id, status, approval_id }: { plan_id: string; member_id: string; status: string; approval_id?: string }, extra) => {
      const payload = { planId: plan_id, memberId: member_id, status };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: 'pco.scheduled-person.update',
        payload,
      });
      if (!gate.allowed) {
        return { content: [{ type: 'text' as const, text: gate.refusalMessage as string }], isError: true as const };
      }
      try {
        const data = await apiPatch<unknown>(apiUrl, apiToken, `/integrations/planning-center/api/plans/${plan_id}/team-members/${member_id}`, { status });
        return toolResult(JSON.stringify(data, null, 2));
      } catch (err) { return handleErr(err); }
    },
  );
}
