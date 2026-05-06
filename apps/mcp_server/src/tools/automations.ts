import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, apiDelete, toolResult, toolError, decodeHtml } from '../api_client.js';
import { registerTool } from './_tool.js';

type AutomationCondition = {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than';
  value: string;
};

type AutomationRule = {
  id: string;
  enabled: boolean;
  [key: string]: unknown;
};

const conditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than']),
  value: z.string(),
});

export function registerAutomationTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_list_automations',
    'List automation rules for the authenticated user. Optionally filter to only enabled rules. Returns array of AutomationRule objects with id, name, source, triggerKey, actionType, enabled, and telemetry fields (lastEvaluatedAt, matchCountLastRun).',
    {
      enabled_only: z.boolean().optional().describe('If true, return only enabled automation rules.'),
    },
    async ({ enabled_only }: { enabled_only?: boolean }) => {
      try {
        const rules = await apiGet<AutomationRule[]>(apiUrl, apiToken, '/automation-rules');
        const filtered = enabled_only ? rules.filter((r) => r.enabled === true) : rules;
        return toolResult(JSON.stringify(filtered, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_get_automation',
    'Fetch a single automation rule by ID.',
    {
      id: z.string().describe('Automation rule UUID.'),
    },
    async ({ id }: { id: string }) => {
      try {
        const rule = await apiGet<unknown>(apiUrl, apiToken, `/automation-rules/${id}`);
        return toolResult(JSON.stringify(rule, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_create_automation',
    "Create a new automation rule. Call rhythm_list_automation_triggers and rhythm_list_automation_actions FIRST to discover valid triggerKey/actionType values and their required triggerConfig/actionConfig fields. The triggerKey must match the source (e.g. triggerKey 'planning_center.plan_upcoming' requires source 'planning_center').",
    {
      name: z.string().describe('Human-readable rule name.'),
      source: z.string().describe('Source provider. One of: rhythm, planning_center, google_calendar, gmail. Use rhythm_list_automation_providers to discover.'),
      trigger_key: z.string().describe('Trigger key matching the source. Use rhythm_list_automation_triggers to discover valid keys.'),
      trigger_config: z.record(z.unknown()).optional().describe('Trigger-specific config. Shape depends on triggerKey; use rhythm_list_automation_triggers to see configSchema.'),
      action_type: z.string().describe('Action type. One of: create_task, create_project_from_template, auto_schedule, send_notification, tag_task. Use rhythm_list_automation_actions for configSchema.'),
      action_config: z.record(z.unknown()).optional().describe('Action-specific config. Shape depends on actionType.'),
      conditions: z.array(conditionSchema).optional().describe('Optional post-trigger filters (AND logic) applied to signal payload.'),
      enabled: z.boolean().optional().describe('Whether the rule is enabled. Defaults to true server-side.'),
      source_account_id: z.string().optional().describe('Optional integration_accounts.id to scope rule to a specific OAuth account.'),
    },
    async ({ name, source, trigger_key, trigger_config, action_type, action_config, conditions, enabled, source_account_id }: { name: string; source: string; trigger_key: string; trigger_config?: Record<string, unknown>; action_type: string; action_config?: Record<string, unknown>; conditions?: AutomationCondition[]; enabled?: boolean; source_account_id?: string }) => {
      try {
        const body: Record<string, unknown> = {
          name: decodeHtml(name),
          source,
          triggerKey: trigger_key,
          actionType: action_type,
        };
        if (trigger_config !== undefined) body.triggerConfig = trigger_config;
        if (action_config !== undefined) body.actionConfig = action_config;
        if (conditions !== undefined) body.conditions = conditions;
        if (enabled !== undefined) body.enabled = enabled;
        if (source_account_id !== undefined) body.sourceAccountId = source_account_id;
        const rule = await apiPost<unknown>(apiUrl, apiToken, '/automation-rules', body);
        return toolResult(JSON.stringify(rule, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_update_automation',
    'Update fields on an automation rule. Only provided fields are changed.',
    {
      id: z.string().describe('Automation rule UUID.'),
      name: z.string().optional().describe('New rule name.'),
      source: z.string().optional().describe('New source provider.'),
      trigger_key: z.string().optional().describe('New trigger key.'),
      trigger_config: z.record(z.unknown()).nullable().optional().describe('New trigger config, or null to clear.'),
      action_type: z.string().optional().describe('New action type.'),
      action_config: z.record(z.unknown()).nullable().optional().describe('New action config, or null to clear.'),
      conditions: z.array(conditionSchema).nullable().optional().describe('New conditions, or null to clear.'),
      enabled: z.boolean().optional().describe('Enable or disable the rule.'),
      source_account_id: z.string().nullable().optional().describe('New source account id, or null to clear.'),
    },
    async ({ id, name, source, trigger_key, trigger_config, action_type, action_config, conditions, enabled, source_account_id }: { id: string; name?: string; source?: string; trigger_key?: string; trigger_config?: Record<string, unknown> | null; action_type?: string; action_config?: Record<string, unknown> | null; conditions?: AutomationCondition[] | null; enabled?: boolean; source_account_id?: string | null }) => {
      try {
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = decodeHtml(name);
        if (source !== undefined) body.source = source;
        if (trigger_key !== undefined) body.triggerKey = trigger_key;
        if (trigger_config !== undefined) body.triggerConfig = trigger_config;
        if (action_type !== undefined) body.actionType = action_type;
        if (action_config !== undefined) body.actionConfig = action_config;
        if (conditions !== undefined) body.conditions = conditions;
        if (enabled !== undefined) body.enabled = enabled;
        if (source_account_id !== undefined) body.sourceAccountId = source_account_id;
        const rule = await apiPatch<unknown>(apiUrl, apiToken, `/automation-rules/${id}`, body);
        return toolResult(JSON.stringify(rule, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_delete_automation',
    'Permanently delete an automation rule.',
    {
      id: z.string().describe('Automation rule UUID to delete.'),
    },
    async ({ id }: { id: string }) => {
      try {
        await apiDelete(apiUrl, apiToken, `/automation-rules/${id}`);
        return toolResult(`Automation rule ${id} deleted.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_preview_automation',
    'Inspect the last evaluation results for a rule, including the most recently matched signal payload (previewSample), match count from the last run, and a human-readable summary string.',
    {
      id: z.string().describe('Automation rule UUID.'),
    },
    async ({ id }: { id: string }) => {
      try {
        const preview = await apiGet<unknown>(apiUrl, apiToken, `/automation-rules/${id}/preview`);
        return toolResult(JSON.stringify(preview, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_resync_automation',
    'Manually re-evaluate a rule against fresh signals from its source. Returns counts: generatedSignalCount, matchedRuleCount, executedActionCount.',
    {
      id: z.string().describe('Automation rule UUID.'),
    },
    async ({ id }: { id: string }) => {
      try {
        const result = await apiPost<unknown>(apiUrl, apiToken, `/automation-rules/${id}/resync`, {});
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_list_automation_triggers',
    'List available automation trigger types, filtered to those whose source the user has connected (or rhythm built-ins). Each item has key, source, label, description, signalTypes, and configSchema describing required triggerConfig fields.',
    {},
    async () => {
      try {
        const triggers = await apiGet<unknown>(apiUrl, apiToken, '/automation-catalog/triggers');
        return toolResult(JSON.stringify(triggers, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_list_automation_actions',
    'List all available automation action types. Each item has key, label, description, and configSchema describing required actionConfig fields.',
    {},
    async () => {
      try {
        const actions = await apiGet<unknown>(apiUrl, apiToken, '/automation-catalog/actions');
        return toolResult(JSON.stringify(actions, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(server, 'rhythm_list_automation_providers',
    'List automation provider sources, filtered to those connected (plus rhythm). Each item has source, label, description, syncSupport, and triggerKeys available.',
    {},
    async () => {
      try {
        const providers = await apiGet<unknown>(apiUrl, apiToken, '/automation-catalog/providers');
        return toolResult(JSON.stringify(providers, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
