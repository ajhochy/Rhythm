import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, toolResult, toolError } from '../api_client.js';

export function registerProjectTools(server: McpServer, apiUrl: string, apiToken: string) {
  // rhythm_list_project_templates
  server.tool(
    'rhythm_list_project_templates',
    'List all project templates, including their steps.',
    {},
    async () => {
      try {
        const templates = await apiGet<unknown[]>(apiUrl, apiToken, '/project-templates');
        return toolResult(JSON.stringify(templates, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_create_project_template
  server.tool(
    'rhythm_create_project_template',
    'Create a new project template (e.g. "Sunday Service Prep").',
    {
      name: z.string().describe('Template name.'),
      description: z.string().optional().describe('Optional description.'),
    },
    async ({ name, description }) => {
      try {
        const template = await apiPost<unknown>(apiUrl, apiToken, '/project-templates', {
          name,
          ...(description !== undefined && { description }),
        });
        return toolResult(JSON.stringify(template, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_add_project_step
  server.tool(
    'rhythm_add_project_step',
    'Add a step to a project template.',
    {
      template_id: z.string().describe('Project template ID.'),
      title: z.string().describe('Step title.'),
      offset_days: z.number().int().describe('Days relative to anchor date (negative = before, positive = after).'),
      offset_description: z.string().optional().describe('Human-readable timing label (e.g. "2 weeks before").'),
      sort_order: z.number().int().optional().describe('Display order (0-based).'),
    },
    async ({ template_id, title, offset_days, offset_description, sort_order }) => {
      try {
        const step = await apiPost<unknown>(apiUrl, apiToken, `/project-templates/${template_id}/steps`, {
          title,
          offsetDays: offset_days,
          ...(offset_description !== undefined && { offsetDescription: offset_description }),
          ...(sort_order !== undefined && { sortOrder: sort_order }),
        });
        return toolResult(JSON.stringify(step, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_create_project_instance
  server.tool(
    'rhythm_create_project_instance',
    'Instantiate a template as an active project with an anchor date.',
    {
      template_id: z.string().describe('Project template ID to instantiate.'),
      anchor_date: z.string().describe('Key event date in YYYY-MM-DD format.'),
      name: z.string().optional().describe('Custom name for this instance (defaults to template name).'),
    },
    async ({ template_id, anchor_date, name }) => {
      try {
        const instance = await apiPost<unknown>(apiUrl, apiToken, '/project-instances', {
          templateId: template_id,
          anchorDate: anchor_date,
          ...(name !== undefined && { name }),
        });
        return toolResult(JSON.stringify(instance, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_list_project_instances
  server.tool(
    'rhythm_list_project_instances',
    'List active projects with step progress. Defaults to active projects.',
    {
      status: z.enum(['active', 'completed', 'all']).optional().describe("Filter by status. Defaults to 'active'."),
    },
    async ({ status = 'active' }) => {
      try {
        const qs = status !== 'all' ? `?status=${status}` : '';
        const instances = await apiGet<unknown[]>(apiUrl, apiToken, `/project-instances${qs}`);
        return toolResult(JSON.stringify(instances, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // rhythm_update_project_step
  server.tool(
    'rhythm_update_project_step',
    'Mark a project step as done or update its notes.',
    {
      instance_id: z.string().describe('Project instance ID.'),
      step_id: z.string().describe('Step ID within the instance.'),
      status: z.enum(['open', 'done']).optional().describe('New status for the step.'),
      notes: z.string().nullable().optional().describe('Notes about the step, or null to clear.'),
    },
    async ({ instance_id, step_id, status, notes }) => {
      try {
        const body: Record<string, unknown> = {};
        if (status !== undefined) body.status = status;
        if (notes !== undefined) body.notes = notes;
        const step = await apiPatch<unknown>(apiUrl, apiToken, `/project-instances/${instance_id}/steps/${step_id}`, body);
        return toolResult(JSON.stringify(step, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
