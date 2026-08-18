import type { GatewayMode } from '.';
import type { CreateProjectTemplateInput, CreateProjectTemplateStepInput, ProjectTemplate, ProjectTemplateStep } from './projects';
import type { CreateRhythmInput, RhythmRule } from './rhythms';
import type { CreateTaskInput, Task } from './planner';

export type IntegrationProvider = 'google_calendar' | 'gmail' | 'planning_center';
export type IntegrationAuthorization = 'google' | 'google_agent' | 'planning_center';
export interface IntegrationAccount { id: string; provider: IntegrationProvider; providerDisplayName: string; availableTriggerFamilies: string[]; syncSupportMode: 'manual' | 'scheduled' | 'push_capable'; status: 'connected' | 'needs_reauth' | 'error' | 'disconnected'; needsReauth: boolean; accountLabel: string | null; email: string | null; displayName: string | null; expiresAt: string | null; lastSyncedAt: string | null; errorMessage: string | null; scope: string | null }
export interface GoogleCalendarOption { id: string; name: string; isPrimary: boolean; isSelected: boolean }
export interface GoogleCalendarSettings { calendars: GoogleCalendarOption[]; selectedCalendarIds: string[] }
export interface GoogleCalendarPreferences { selectedCalendarIds: string[] }
export interface GmailSignal { id: string; ownerId: number | null; externalId: string; threadId: string; fromName: string | null; fromEmail: string | null; subject: string | null; snippet: string | null; receivedAt: string | null; isUnread: boolean; createdAt: string; updatedAt: string }
export interface PlanningCenterTaskPreferences { teamIds: string[]; positionNames: string[] }
export interface PlanningCenterTeamOption { id: string; name: string; serviceTypeId: string; serviceTypeName: string }
export interface PlanningCenterTaskOptions { teams: PlanningCenterTeamOption[]; positionsByTeamId: Record<string, string[]> }

export interface IntegrationsGateway {
  readonly mode: GatewayMode;
  accounts(): Promise<IntegrationAccount[]>;
  authorizationUrl(kind: IntegrationAuthorization): string;
  syncGoogleCalendar(): Promise<unknown>;
  syncGmail(): Promise<unknown>;
  syncPlanningCenter(): Promise<unknown>;
  syncAll(): Promise<unknown>;
  googleCalendarSettings(): Promise<GoogleCalendarSettings>;
  saveGoogleCalendarPreferences(input: GoogleCalendarPreferences): Promise<GoogleCalendarPreferences>;
  gmailSignals(): Promise<GmailSignal[]>;
  gmailLabels(): Promise<unknown>;
  planningCenterTaskPreferences(): Promise<PlanningCenterTaskPreferences>;
  savePlanningCenterTaskPreferences(input: PlanningCenterTaskPreferences): Promise<PlanningCenterTaskPreferences>;
  planningCenterTaskOptions(): Promise<PlanningCenterTaskOptions>;
  importTask(input: CreateTaskInput): Promise<Task>;
  importRhythm(input: CreateRhythmInput): Promise<RhythmRule>;
  importProjectTemplate(input: CreateProjectTemplateInput): Promise<ProjectTemplate>;
  addImportedProjectStep(templateId: string, input: CreateProjectTemplateStepInput): Promise<ProjectTemplateStep>;
}

export class IntegrationsGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const failureText = (status: number, operation: string) => ({ 0: 'Integrations service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Integration record not found' })[status] ?? `${operation} failed (${status})`;
async function response<T>(operation: string, pending: Promise<Response>): Promise<T> { try { const result = await pending; if (!result.ok) throw new IntegrationsGatewayError(result.status, failureText(result.status, operation)); return result.status === 204 ? undefined as T : await result.json() as T; } catch (error) { if (error instanceof IntegrationsGatewayError) throw error; throw new IntegrationsGatewayError(0, failureText(0, operation)); } }

export function createFixtureIntegrationsGateway(_fetcher?: typeof fetch): IntegrationsGateway {
  const unsupported = async (..._args: unknown[]): Promise<never> => { throw new IntegrationsGatewayError(0, 'Fixture integrations gateway is unsupported'); };
  const unsupportedUrl = (..._args: unknown[]): string => { throw new IntegrationsGatewayError(0, 'Fixture integrations gateway is unsupported'); };
  return { mode: 'fixture', accounts: unsupported, authorizationUrl: unsupportedUrl, syncGoogleCalendar: unsupported, syncGmail: unsupported, syncPlanningCenter: unsupported, syncAll: unsupported, googleCalendarSettings: unsupported, saveGoogleCalendarPreferences: unsupported, gmailSignals: unsupported, gmailLabels: unsupported, planningCenterTaskPreferences: unsupported, savePlanningCenterTaskPreferences: unsupported, planningCenterTaskOptions: unsupported, importTask: unsupported, importRhythm: unsupported, importProjectTemplate: unsupported, addImportedProjectStep: unsupported };
}

export function createLiveIntegrationsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): IntegrationsGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit integrations token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const json = (value: unknown) => JSON.stringify(value);
  return {
    mode: 'live',
    // apps/api_server/src/routes/integrations_routes.ts:9
    accounts: () => response<IntegrationAccount[]>('Load integration accounts', request('/integrations/accounts')),
    // apps/api_server/src/routes/auth_routes.ts:20,23-25. These navigation endpoints require sessionToken by query contract rather than Authorization.
    authorizationUrl: (kind) => {
      const params = new URLSearchParams({ sessionToken: token });
      if (kind === 'google_agent') params.set('intent', 'agent');
      const path = kind === 'planning_center' ? '/auth/planning-center/begin' : '/auth/google/begin';
      return `${apiBase}${path}?${params.toString()}`;
    },
    // apps/api_server/src/routes/integrations_routes.ts:10-14,23,26-29
    syncGoogleCalendar: () => response<unknown>('Sync Google Calendar', request('/integrations/google-calendar/sync', { method: 'POST' })),
    syncGmail: () => response<unknown>('Sync Gmail', request('/integrations/gmail/sync', { method: 'POST' })),
    syncPlanningCenter: () => response<unknown>('Sync Planning Center', request('/integrations/planning-center/sync', { method: 'POST' })),
    syncAll: () => response<unknown>('Sync integrations', request('/integrations/sync-all', { method: 'POST' })),
    // apps/api_server/src/routes/integrations_routes.ts:15-22
    googleCalendarSettings: () => response<GoogleCalendarSettings>('Load Google Calendar settings', request('/integrations/google-calendar/settings')),
    saveGoogleCalendarPreferences: (input) => response<GoogleCalendarPreferences>('Save Google Calendar preferences', request('/integrations/google-calendar/preferences', { method: 'PUT', body: json(input) })),
    // apps/api_server/src/routes/integrations_routes.ts:24-25
    gmailSignals: () => response<GmailSignal[]>('Load Gmail signals', request('/integrations/gmail/signals')),
    gmailLabels: () => response<unknown>('Load Gmail labels', request('/integrations/gmail/labels')),
    // apps/api_server/src/routes/integrations_routes.ts:30-41
    planningCenterTaskPreferences: () => response<PlanningCenterTaskPreferences>('Load Planning Center preferences', request('/integrations/planning-center/task-preferences')),
    savePlanningCenterTaskPreferences: (input) => response<PlanningCenterTaskPreferences>('Save Planning Center preferences', request('/integrations/planning-center/task-preferences', { method: 'PUT', body: json(input) })),
    planningCenterTaskOptions: () => response<PlanningCenterTaskOptions>('Load Planning Center options', request('/integrations/planning-center/task-options')),
    // AI import persists through the canonical record routes shown by the existing React import receipts: tasks_routes.ts:11, recurring_rules_routes.ts:11, project_templates_routes.ts:14,17.
    importTask: (input) => response<Task>('Import task', request('/tasks', { method: 'POST', body: json(input) })),
    importRhythm: (input) => response<RhythmRule>('Import rhythm', request('/recurring-rules', { method: 'POST', body: json(input) })),
    importProjectTemplate: (input) => response<ProjectTemplate>('Import project template', request('/project-templates', { method: 'POST', body: json(input) })),
    addImportedProjectStep: (templateId, input) => response<ProjectTemplateStep>('Import project template step', request(`/project-templates/${encodeURIComponent(templateId)}/steps`, { method: 'POST', body: json(input) })),
  };
}
