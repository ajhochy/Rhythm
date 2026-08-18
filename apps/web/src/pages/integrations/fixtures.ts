export type ProviderId = 'google-calendar' | 'gmail' | 'planning-center';
export type AccountStatus = 'connected' | 'disconnected' | 'needs_reauth' | 'error';

export type IntegrationAccount = {
  id: ProviderId;
  name: string;
  monogram: string;
  status: AccountStatus;
  identity?: string;
  lastSyncedAt?: string;
  errorMessage?: string;
};

export type CalendarSource = {
  id: string;
  name: string;
  description: string;
  primary?: boolean;
};

export type GmailSignal = {
  id: string;
  threadId: string;
  subject?: string;
  sender?: string;
  snippet?: string;
  unread: boolean;
};

export type PlanningTeam = {
  id: string;
  name: string;
  positions: string[];
};

export const FIXTURE_TIMESTAMP = '2026-08-12T15:48:00-07:00';

export const readyAccounts: IntegrationAccount[] = [
  { id: 'google-calendar', name: 'Google Calendar', monogram: 'GC', status: 'connected', identity: 'aj@example.test', lastSyncedAt: 'Today at 3:32 PM' },
  { id: 'gmail', name: 'Gmail', monogram: 'GM', status: 'connected', identity: 'aj@example.test', lastSyncedAt: 'Today at 3:35 PM' },
  { id: 'planning-center', name: 'Planning Center', monogram: 'PC', status: 'connected', identity: 'Rhythm Community Church', lastSyncedAt: 'Today at 3:21 PM' },
];

export const accountStateAccounts: IntegrationAccount[] = [
  readyAccounts[0],
  { id: 'gmail', name: 'Gmail', monogram: 'GM', status: 'needs_reauth', identity: 'aj@example.test', errorMessage: 'Google authorization expired. Reconnect Google to restore inbox signals.' },
  { id: 'planning-center', name: 'Planning Center', monogram: 'PC', status: 'error', identity: 'Rhythm Community Church', errorMessage: 'Refresh token rejected' },
];

export const disconnectedAccounts: IntegrationAccount[] = readyAccounts.map((account) => ({
  id: account.id,
  name: account.name,
  monogram: account.monogram,
  status: 'disconnected',
}));

export const calendarSources: CalendarSource[] = [
  { id: 'cal-primary', name: 'AJ Hochhalter', description: 'Primary account calendar', primary: true },
  { id: 'cal-team', name: '礼拝チーム予定 🗓️ · Calendar', description: 'Worship team planning and rehearsals' },
  { id: 'cal-community', name: 'Community Care - multilingual / متعدد اللغات', description: 'Care nights and neighborhood events' },
];

export const selectedCalendarIds = ['cal-primary', 'cal-team'];

export const gmailSignals: GmailSignal[] = [
  { id: 'signal-weekend-1', threadId: 'thread-weekend-team', subject: '礼拝チーム予定 🗓️', sender: 'Mina Park', snippet: 'The bilingual welcome team is confirmed for Sunday.', unread: true },
  { id: 'signal-weekend-duplicate', threadId: 'thread-weekend-team', subject: 'Re: 礼拝チーム予定 🗓️', sender: 'Alex Chen', snippet: 'Duplicate message in the same thread.', unread: true },
  { id: 'signal-care', threadId: 'thread-community-care', subject: 'Community care launch', sender: 'Sam Rivera', snippet: 'Can we add two more volunteer stations?', unread: true },
  { id: 'signal-no-subject', threadId: 'thread-no-subject', snippet: 'Attached is the revised access plan.', unread: false },
  { id: 'signal-rehearsal', threadId: 'thread-rehearsal', subject: 'Thursday rehearsal', sender: 'Taylor Reed', snippet: 'Keys will arrive at 6:15.', unread: true },
  { id: 'signal-captions', threadId: 'thread-captions', subject: 'Captioning fallback', sender: 'Jordan Lee', snippet: 'The backup operator confirmed availability.', unread: false },
];

export const planningTeams: PlanningTeam[] = [
  { id: 'team-vocals', name: 'Worship Vocals', positions: ['Vocalist', 'Worship Leader'] },
  { id: 'team-production', name: 'Production', positions: ['FOH Engineer', 'Lighting Director'] },
  { id: 'team-hospitality', name: 'Hospitality / 欢迎', positions: ['Greeter', 'Usher'] },
];

export const importPrompt = `Return ONLY valid JSON. Do not include commentary.

Use this schema:
{
  "tasks": [{ "title": "string", "notes": "string?", "dueDate": "YYYY-MM-DD?", "preferredAgent": "string?" }],
  "rhythms": [{ "title": "string", "frequency": "weekly|monthly|annual", "dayOfWeek": 1 }],
  "projects": [{ "name": "string", "description": "string?", "steps": [{ "title": "string", "offsetDays": 0, "offsetDescription": "string?" }] }]
}

Legacy arrays with task, recurring_rule, and project item types are also accepted.`;

export const initialReadyReceipts = [
  'GET /integrations/accounts → 200',
  'GET /integrations/google-calendar/settings → 200',
  'GET /integrations/gmail/signals → 200',
  'GET /integrations/planning-center/task-preferences → 200',
];
