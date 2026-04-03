import type {
  AutomationActionCatalogItem,
  AutomationProviderCatalogItem,
  AutomationTriggerCatalogItem,
} from '../models/automation_catalog';
import type { IntegrationAccount } from '../models/integration_account';
import type { AutomationActionType, AutomationTriggerKey } from '../models/automation_rule';

const TRIGGERS: AutomationTriggerCatalogItem[] = [
  {
    key: 'rhythm.task_due',
    source: 'rhythm',
    label: 'Task is due',
    description: 'Run when a Rhythm task approaches its due date.',
    signalTypes: [],
    configSchema: { fields: ['daysBeforeDue'] },
  },
  {
    key: 'rhythm.project_step_due',
    source: 'rhythm',
    label: 'Project step is due',
    description: 'Run when a Rhythm project step approaches its due date.',
    signalTypes: [],
    configSchema: { fields: ['daysBeforeDue'] },
  },
  {
    key: 'rhythm.plan_assembly',
    source: 'rhythm',
    label: 'Weekly plan is assembled',
    description: 'Run during weekly plan assembly.',
    signalTypes: [],
    configSchema: { fields: [] },
  },
  {
    key: 'planning_center.plan_person_declined',
    source: 'planning_center',
    label: 'Volunteer declined',
    description: 'Match Planning Center team members who declined a plan invitation.',
    signalTypes: ['team_member_declined'],
    configSchema: { fields: ['serviceType', 'teamId', 'positionName', 'leadDays'] },
  },
  {
    key: 'planning_center.plan_person_unconfirmed',
    source: 'planning_center',
    label: 'Volunteer unconfirmed',
    description: 'Match unconfirmed Planning Center team members close to a service date.',
    signalTypes: ['team_member_unconfirmed'],
    configSchema: { fields: ['serviceType', 'teamId', 'positionName', 'leadDays'] },
  },
  {
    key: 'planning_center.needed_position_open',
    source: 'planning_center',
    label: 'Needed position open',
    description: 'Match open needed positions from Planning Center plans.',
    signalTypes: ['needed_position_open'],
    configSchema: { fields: ['serviceType', 'teamId', 'positionName', 'leadDays'] },
  },
  {
    key: 'planning_center.special_service_candidate',
    source: 'planning_center',
    label: 'Special service candidate',
    description: 'Match non-Sunday plans that should create a project.',
    signalTypes: ['special_service_candidate'],
    configSchema: { fields: ['serviceType', 'leadDays'] },
  },
  {
    key: 'google_calendar.event_matching_filter',
    source: 'google_calendar',
    label: 'Calendar event matches filter',
    description: 'Match Google Calendar events by metadata filters.',
    signalTypes: ['calendar_event_seen', 'calendar_event_today'],
    configSchema: {
      fields: ['textQuery', 'eventType', 'allDayOnly', 'dateWindowDays'],
    },
  },
  {
    key: 'google_calendar.all_day_event',
    source: 'google_calendar',
    label: 'All-day calendar event',
    description: 'Match all-day Google Calendar events in a time window.',
    signalTypes: ['calendar_event_today', 'calendar_event_seen'],
    configSchema: { fields: ['textQuery', 'dateWindowDays'] },
  },
  {
    key: 'gmail.message_matching_filter',
    source: 'gmail',
    label: 'Gmail message matches filter',
    description: 'Match Gmail metadata by sender, subject, and recency.',
    signalTypes: ['gmail_message_seen', 'gmail_message_from_sender'],
    configSchema: { fields: ['sender', 'subjectContains', 'label', 'hoursSinceReceived'] },
  },
  {
    key: 'gmail.unread_message_matching_filter',
    source: 'gmail',
    label: 'Unread Gmail message matches filter',
    description: 'Match unread Gmail messages by sender and subject.',
    signalTypes: ['gmail_unread_message_seen', 'gmail_message_from_sender'],
    configSchema: { fields: ['sender', 'subjectContains', 'label', 'hoursSinceReceived'] },
  },
];

const ACTIONS: AutomationActionCatalogItem[] = [
  {
    key: 'create_task',
    label: 'Create task',
    description: 'Create a follow-up task in Rhythm when the trigger matches.',
    configSchema: { fields: ['titleTemplate', 'notesTemplate', 'dueDaysOffset'] },
  },
  {
    key: 'create_project_from_template',
    label: 'Create project from template',
    description: 'Generate a project instance from an existing Rhythm template.',
    configSchema: { fields: ['templateId', 'templateName', 'projectNameTemplate'] },
  },
  {
    key: 'tag_task',
    label: 'Tag task',
    description: 'Create a follow-up task and include a tag marker in its notes.',
    configSchema: { fields: ['tag', 'titleTemplate', 'notesTemplate'] },
  },
  {
    key: 'send_notification',
    label: 'Send notification',
    description: 'Send a direct Rhythm message notification to the rule owner.',
    configSchema: { fields: ['messageTemplate'] },
  },
  {
    key: 'auto_schedule',
    label: 'Auto-schedule task',
    description: 'Create or update a task with a scheduled weekday.',
    configSchema: { fields: ['titleTemplate', 'targetDay', 'dueDaysOffset'] },
  },
];

const PROVIDERS: AutomationProviderCatalogItem[] = [
  {
    source: 'rhythm',
    label: 'Rhythm',
    description: 'Internal Rhythm planning triggers.',
    syncSupport: 'scheduled',
    triggerKeys: TRIGGERS.filter((item) => item.source === 'rhythm').map((item) => item.key),
  },
  {
    source: 'planning_center',
    label: 'Planning Center',
    description: 'Sync-derived staffing and plan signals from Planning Center.',
    syncSupport: 'push_capable',
    triggerKeys: TRIGGERS.filter((item) => item.source === 'planning_center').map((item) => item.key),
  },
  {
    source: 'google_calendar',
    label: 'Google Calendar',
    description: 'Metadata-driven calendar event triggers.',
    syncSupport: 'push_capable',
    triggerKeys: TRIGGERS.filter((item) => item.source === 'google_calendar').map((item) => item.key),
  },
  {
    source: 'gmail',
    label: 'Gmail',
    description: 'Metadata-driven Gmail message triggers.',
    syncSupport: 'push_capable',
    triggerKeys: TRIGGERS.filter((item) => item.source === 'gmail').map((item) => item.key),
  },
];

export class AutomationCatalogService {
  getTriggers(): AutomationTriggerCatalogItem[] {
    return TRIGGERS;
  }

  getTriggersForAccounts(accounts: IntegrationAccount[]): AutomationTriggerCatalogItem[] {
    const enabledSources = new Set([
      'rhythm',
      ...accounts
        .filter((account) => account.status === 'connected')
        .map((account) => account.provider),
    ]);
    return TRIGGERS.filter((item) => enabledSources.has(item.source));
  }

  getActions(): AutomationActionCatalogItem[] {
    return ACTIONS;
  }

  getProviders(): AutomationProviderCatalogItem[] {
    return PROVIDERS;
  }

  getProvidersForAccounts(accounts: IntegrationAccount[]): AutomationProviderCatalogItem[] {
    const enabledSources = new Set([
      'rhythm',
      ...accounts
        .filter((account) => account.status === 'connected')
        .map((account) => account.provider),
    ]);
    return PROVIDERS.filter((item) => enabledSources.has(item.source));
  }

  findTrigger(key: string): AutomationTriggerCatalogItem | null {
    return TRIGGERS.find((item) => item.key === key) ?? null;
  }

  isValidTriggerKey(key: string): key is AutomationTriggerKey {
    return this.findTrigger(key) != null;
  }

  isValidActionType(key: string): key is AutomationActionType {
    return ACTIONS.some((item) => item.key === key);
  }
}
