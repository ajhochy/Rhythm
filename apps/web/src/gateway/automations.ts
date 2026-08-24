import type { GatewayMode } from '.';

export type ConditionOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than';
export interface AutomationCondition { field: string; operator: ConditionOperator; value: string }
export type AutomationActionType = 'create_task' | 'create_project_from_template' | 'auto_schedule' | 'send_notification' | 'tag_task' | 'create_reservation';
export type AutomationRuleSource = 'rhythm' | 'planning_center' | 'google_calendar' | 'gmail';
export type AutomationTriggerKey =
  | 'rhythm.project_step_due'
  | 'rhythm.task_due'
  | 'rhythm.plan_assembly'
  | 'planning_center.plan_upcoming'
  | 'planning_center.plan_published'
  | 'planning_center.plan_person_declined'
  | 'planning_center.plan_person_unconfirmed'
  | 'planning_center.needed_position_open'
  | 'planning_center.special_service_candidate'
  | 'planning_center.service_item_updated'
  | 'google_calendar.event_matching_filter'
  | 'google_calendar.all_day_event'
  | 'gmail.message_matching_filter'
  | 'gmail.unread_message_matching_filter';

export interface AutomationRule { id: string; name: string; source: AutomationRuleSource; triggerKey: AutomationTriggerKey; triggerConfig: Record<string, unknown> | null; actionType: AutomationActionType; actionConfig: Record<string, unknown> | null; conditions: AutomationCondition[] | null; enabled: boolean; ownerId: number | null; sourceAccountId: string | null; lastEvaluatedAt: string | null; lastMatchedAt: string | null; matchCountLastRun: number; previewSample: Record<string, unknown> | null; createdAt: string; updatedAt: string }
export interface AutomationTriggerCatalogItem { key: AutomationTriggerKey; source: AutomationRuleSource; label: string; description: string; signalTypes: string[]; configSchema: Record<string, unknown> }
export interface AutomationActionCatalogItem { key: AutomationActionType; label: string; description: string; configSchema: Record<string, unknown> }
export interface AutomationProviderCatalogItem { source: AutomationRuleSource; label: string; description: string; syncSupport: 'manual' | 'scheduled' | 'push_capable'; triggerKeys: AutomationTriggerKey[] }
export interface AutomationPreview { ruleId: string; previewSample: Record<string, unknown> | null; lastMatchedAt: string | null; lastEvaluatedAt: string | null; matchCountLastRun: number; summary: string }
export interface CreateAutomationInput { name: string; source: AutomationRuleSource; triggerKey: AutomationTriggerKey; triggerConfig?: Record<string, unknown>; actionType: AutomationActionType; actionConfig?: Record<string, unknown>; conditions?: AutomationCondition[] | null; enabled?: boolean; ownerId?: number | null; sourceAccountId?: string | null }
export type UpdateAutomationInput = Partial<Omit<CreateAutomationInput, 'triggerConfig' | 'actionConfig'>> & { triggerConfig?: Record<string, unknown> | null; actionConfig?: Record<string, unknown> | null };

export interface AutomationsGateway {
  readonly mode: GatewayMode;
  triggers(): Promise<AutomationTriggerCatalogItem[]>;
  actions(): Promise<AutomationActionCatalogItem[]>;
  providers(): Promise<AutomationProviderCatalogItem[]>;
  rules(): Promise<AutomationRule[]>;
  detail(id: string): Promise<AutomationRule>;
  preview(id: string): Promise<AutomationPreview>;
  create(input: CreateAutomationInput): Promise<AutomationRule>;
  update(id: string, input: UpdateAutomationInput): Promise<AutomationRule>;
  delete(id: string): Promise<void>;
  resync(id: string): Promise<unknown>;
}

export class AutomationsGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const failureText = (status: number, operation: string) => ({ 0: 'Automations service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Automation rule not found' })[status] ?? `${operation} failed (${status})`;
async function response<T>(operation: string, pending: Promise<Response>): Promise<T> { try { const result = await pending; if (!result.ok) throw new AutomationsGatewayError(result.status, failureText(result.status, operation)); return result.status === 204 ? undefined as T : await result.json() as T; } catch (error) { if (error instanceof AutomationsGatewayError) throw error; throw new AutomationsGatewayError(0, failureText(0, operation)); } }

export function createFixtureAutomationsGateway(_fetcher?: typeof fetch): AutomationsGateway {
  const unsupported = async (..._args: unknown[]): Promise<never> => { throw new AutomationsGatewayError(0, 'Fixture automations gateway is unsupported'); };
  return { mode: 'fixture', triggers: unsupported, actions: unsupported, providers: unsupported, rules: unsupported, detail: unsupported, preview: unsupported, create: unsupported, update: unsupported, delete: unsupported, resync: unsupported };
}

export function createLiveAutomationsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): AutomationsGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit automations token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const json = (value: unknown) => JSON.stringify(value);
  return {
    mode: 'live',
    // apps/api_server/src/routes/automation_catalog_routes.ts:9-11
    triggers: () => response<AutomationTriggerCatalogItem[]>('Load automation triggers', request('/automation-catalog/triggers')),
    actions: () => response<AutomationActionCatalogItem[]>('Load automation actions', request('/automation-catalog/actions')),
    providers: () => response<AutomationProviderCatalogItem[]>('Load automation providers', request('/automation-catalog/providers')),
    // apps/api_server/src/routes/automation_rules_routes.ts:9-15
    rules: () => response<AutomationRule[]>('Load automation rules', request('/automation-rules')),
    detail: (id) => response<AutomationRule>('Load automation rule', request(`/automation-rules/${encodeURIComponent(id)}`)),
    preview: (id) => response<AutomationPreview>('Preview automation rule', request(`/automation-rules/${encodeURIComponent(id)}/preview`)),
    create: (input) => response<AutomationRule>('Create automation rule', request('/automation-rules', { method: 'POST', body: json(input) })),
    update: (id, input) => response<AutomationRule>('Update automation rule', request(`/automation-rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(input) })),
    delete: (id) => response<void>('Delete automation rule', request(`/automation-rules/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    resync: (id) => response<unknown>('Resync automation rule', request(`/automation-rules/${encodeURIComponent(id)}/resync`, { method: 'POST' })),
  };
}
