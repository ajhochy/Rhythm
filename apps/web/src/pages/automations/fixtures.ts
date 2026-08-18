export type AutomationSource = 'rhythm' | 'planning_center' | 'google_calendar' | 'gmail';
// 'auto_schedule' (no `_task` suffix) is the canonical live actionType — apps/api_server/src/models/automation_rule.ts:15-21.
// Widened additively so live-mapped rules can reuse this view-model type without touching fixture-mode's 'auto_schedule_task'.
export type AutomationAction = 'create_task' | 'create_project_from_template' | 'tag_task' | 'send_notification' | 'auto_schedule_task' | 'auto_schedule' | 'create_reservation';

export interface AutomationCondition {
  field: string;
  operator: string;
  value: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  source: AutomationSource;
  accountId: string | null;
  accountLabel: string;
  triggerKey: string;
  triggerLabel: string;
  actionType: AutomationAction;
  actionLabel: string;
  enabled: boolean;
  createdAt: string;
  lastMatchedAt: string | null;
  lastEvaluatedAt: string | null;
  matchCountLastRun: number;
  previewSummary: string;
  previewSample: string | null;
  conditions: AutomationCondition[];
  actionConfig: Record<string, string>;
}

export const sourceOrder: AutomationSource[] = ['rhythm', 'planning_center', 'google_calendar', 'gmail'];

export const sourceLabels: Record<AutomationSource, string> = {
  rhythm: 'Rhythm',
  planning_center: 'Planning Center',
  google_calendar: 'Google Calendar',
  gmail: 'Gmail',
};

export const sourceDescriptions: Record<AutomationSource, string> = {
  rhythm: 'Internal Rhythm rules',
  planning_center: 'Production Services · connected',
  google_calendar: 'Weekend Team Calendar · connected',
  gmail: 'Ministry Inbox · connected',
};

export const accounts: Record<Exclude<AutomationSource, 'rhythm'>, { id: string; label: string }> = {
  planning_center: { id: 'account-pco-production', label: 'Production Services' },
  google_calendar: { id: 'account-calendar-weekend', label: 'Weekend Team Calendar' },
  gmail: { id: 'account-gmail-ministry', label: 'Ministry Inbox' },
};

export const triggerCatalog: Record<AutomationSource, Array<{ key: string; label: string }>> = {
  rhythm: [
    { key: 'rhythm.task_due', label: 'Task is approaching its due date' },
    { key: 'rhythm.project_step_due', label: 'Project step is approaching its due date' },
    { key: 'rhythm.plan_assembled', label: 'Plan is assembled' },
  ],
  planning_center: [
    { key: 'pco.plan_upcoming', label: 'Plan is upcoming' },
    { key: 'pco.plan_updated', label: 'Plan is updated' },
    { key: 'pco.service_created', label: 'Service is created' },
    { key: 'pco.team_assigned', label: 'Team is assigned' },
    { key: 'pco.position_open', label: 'Position is open' },
    { key: 'pco.volunteer_confirmed', label: 'Volunteer confirmed' },
    { key: 'pco.volunteer_declined', label: 'Volunteer declined' },
    { key: 'pco.blockout_created', label: 'Blockout is created' },
  ],
  google_calendar: [{ key: 'google_calendar.event_matches', label: 'Calendar event matches filter' }],
  gmail: [{ key: 'gmail.message_matches', label: 'Gmail message matches filter' }],
};

export const actionCatalog: Array<{ type: AutomationAction; label: string }> = [
  { type: 'create_task', label: 'Create task' },
  { type: 'create_project_from_template', label: 'Create project from template' },
  { type: 'tag_task', label: 'Tag task' },
  { type: 'send_notification', label: 'Send notification' },
  { type: 'auto_schedule_task', label: 'Auto-schedule task' },
  { type: 'create_reservation', label: 'Create reservation' },
];

export const conditionFields: Record<AutomationSource, string[]> = {
  rhythm: ['title', 'notes'],
  planning_center: ['title', 'serviceTypeName', 'teamName', 'positionName', 'planDate'],
  google_calendar: ['title', 'description', 'location', 'eventType'],
  gmail: ['subject', 'fromEmail', 'fromName', 'snippet', 'labelIds'],
};

export const initialAutomationReceipts = [
  'GET /automation-rules → 200',
  'GET /automation-catalog/triggers → 200',
  'GET /automation-catalog/actions → 200',
  'GET /automation-catalog/providers → 200',
  'GET /integrations/accounts → 200',
  'GET /integrations/planning-center/task-options → 200',
  'GET /integrations/gmail/labels → 200',
  'GET /project-templates → 200',
] as const;

export const seededAutomationRules: AutomationRule[] = [
  {
    id: 'rule-rhythm-due-reminder', name: 'Nudge owners before tasks are due', source: 'rhythm', accountId: null,
    accountLabel: 'Internal Rhythm rules', triggerKey: 'rhythm.task_due', triggerLabel: 'Task is approaching its due date',
    actionType: 'send_notification', actionLabel: 'Send notification', enabled: true, createdAt: '2026-07-19T09:12:00-07:00',
    lastMatchedAt: '2026-08-12T14:35:00-07:00', lastEvaluatedAt: '2026-08-12T15:40:00-07:00', matchCountLastRun: 3,
    previewSummary: 'When a Rhythm task is due within two days, notify its owner.', previewSample: 'Prepare Sunday service handoff', conditions: [],
    actionConfig: { messageTemplate: '{{title}} is due soon' },
  },
  {
    id: 'rule-rhythm-project-follow-up', name: 'Open a follow-up after project steps', source: 'rhythm', accountId: null,
    accountLabel: 'Internal Rhythm rules', triggerKey: 'rhythm.project_step_due', triggerLabel: 'Project step is approaching its due date',
    actionType: 'create_task', actionLabel: 'Create task', enabled: true, createdAt: '2026-07-24T11:28:00-07:00',
    lastMatchedAt: '2026-08-11T16:20:00-07:00', lastEvaluatedAt: '2026-08-12T15:40:00-07:00', matchCountLastRun: 1,
    previewSummary: 'When a project step approaches its due date, create a follow-up task.', previewSample: 'Finalize the run sheet', conditions: [],
    actionConfig: { titleTemplate: 'Follow up: {{title}}' },
  },
  {
    id: 'rule-pco-volunteer-decline', name: 'Follow up on declined positions', source: 'planning_center', accountId: 'account-pco-production',
    accountLabel: 'Production Services', triggerKey: 'pco.volunteer_declined', triggerLabel: 'Volunteer declined', actionType: 'create_task',
    actionLabel: 'Create task', enabled: true, createdAt: '2026-07-29T08:45:00-07:00', lastMatchedAt: '2026-08-12T13:05:00-07:00',
    lastEvaluatedAt: '2026-08-12T15:42:00-07:00', matchCountLastRun: 1,
    previewSummary: 'When a Planning Center volunteer declines, create a coverage task.', previewSample: 'Camera operator · 9:00 service',
    conditions: [{ field: 'teamName', operator: 'equals', value: 'Worship' }], actionConfig: { titleTemplate: 'Cover {{positionName}}' },
  },
  {
    id: 'rule-calendar-room', name: 'Book a room for calendar events · 会場 📅', source: 'google_calendar', accountId: 'account-calendar-weekend',
    accountLabel: 'Weekend Team Calendar', triggerKey: 'google_calendar.event_matches', triggerLabel: 'Calendar event matches filter',
    actionType: 'create_reservation', actionLabel: 'Create reservation', enabled: true, createdAt: '2026-08-02T10:10:00-07:00',
    lastMatchedAt: '2026-08-12T14:08:00-07:00', lastEvaluatedAt: '2026-08-12T15:44:00-07:00', matchCountLastRun: 2,
    previewSummary: 'When Calendar event matches filter, create a room reservation.', previewSample: '会場: Fellowship Hall · 📅 Rehearsal',
    conditions: [{ field: 'title', operator: 'contains', value: 'Rehearsal' }], actionConfig: { facilityId: 'facility-fellowship-hall' },
  },
  {
    id: 'rule-gmail-follow-up', name: 'Follow up on ministry inbox requests', source: 'gmail', accountId: 'account-gmail-ministry',
    accountLabel: 'Ministry Inbox', triggerKey: 'gmail.message_matches', triggerLabel: 'Gmail message matches filter', actionType: 'create_task',
    actionLabel: 'Create task', enabled: false, createdAt: '2026-08-05T13:30:00-07:00', lastMatchedAt: '2026-08-11T11:18:00-07:00',
    lastEvaluatedAt: '2026-08-12T15:45:00-07:00', matchCountLastRun: 0,
    previewSummary: 'When a Gmail message matches the ministry inbox filter, create a follow-up task.', previewSample: 'Community meal volunteer question',
    conditions: [{ field: 'labelIds', operator: 'contains', value: 'Worship' }], actionConfig: { titleTemplate: 'Reply to {{subject}}' },
  },
];

export function cloneSeededAutomationRules() {
  return structuredClone(seededAutomationRules) as AutomationRule[];
}

export function allowedActions(source: AutomationSource) {
  if (source === 'planning_center') return actionCatalog.filter((action) => ['create_task', 'create_project_from_template'].includes(action.type));
  if (source === 'google_calendar') return actionCatalog;
  return actionCatalog.filter((action) => action.type !== 'create_reservation');
}

export function automationIdForName(name: string) {
  const slug = name.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56);
  return `rule-${slug || 'automation'}`;
}
