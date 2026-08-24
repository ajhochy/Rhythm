import { taskDensitySeeds } from '../../taskDensityFixtures';

export type DashboardTask = {
  id: string;
  title: string;
  notes: string;
  status: 'open' | 'done';
  bucket: 'past-due' | 'today' | 'week' | 'unscheduled';
  scheduledDate?: string;
  dueDate?: string;
  dueLabel: string;
  collaborator?: string;
};

export type DashboardProjectStep = {
  id: string;
  title: string;
  status: 'open' | 'done';
  dueLabel: string;
};

export type DashboardProject = {
  id: string;
  title: string;
  owner: string;
  dueLabel: string;
  nextStep: DashboardProjectStep;
  steps: DashboardProjectStep[];
};

export type DashboardThread = {
  id: 'thread-weekend-team';
  title: string;
  preview: string;
  unreadLabel: string;
};

export const DASHBOARD_FIXED_NOW = '2026-08-12T15:48:00-07:00';

export const dashboardDensityTasks: DashboardTask[] = taskDensitySeeds.map(({ id, title, notes, date, day, taskIndex }) => ({
  id,
  title,
  notes,
  status: 'open',
  bucket: date < '2026-08-12' ? 'past-due' : date === '2026-08-12' ? 'today' : 'week',
  scheduledDate: date,
  dueLabel: date < '2026-08-12' ? (date === '2026-08-11' ? '1 day overdue' : '2 days overdue') : date === '2026-08-12' ? 'Today' : day,
  collaborator: taskIndex % 7 === 0 ? (taskIndex % 2 === 0 ? 'Riley Chen' : 'Morgan Lee') : undefined,
}));

export const dashboardTasks: DashboardTask[] = [
  { id: 'task-team-briefing', title: 'Team briefing ✅', notes: 'Confirm owners and the livestream fallback.', status: 'open', bucket: 'today', scheduledDate: '2026-08-12', dueLabel: 'Today · 4:30 PM', collaborator: 'Riley Chen' },
  { id: 'task-morning-setup', title: 'Morning setup', notes: 'Rooms and welcome desk are ready.', status: 'done', bucket: 'today', scheduledDate: '2026-08-12', dueLabel: 'Today · 9:00 AM' },
  { id: 'task-finalize-launch-notes', title: 'Finalize launch notes 📝', notes: 'Publish the concise service handoff.', status: 'open', bucket: 'week', scheduledDate: '2026-08-14', dueLabel: 'Friday' },
  { id: 'task-volunteer-email', title: 'Volunteer confirmation email', notes: 'The final roster was sent.', status: 'done', bucket: 'week', scheduledDate: '2026-08-13', dueLabel: 'Tomorrow' },
  { id: 'task-review-av-inventory', title: 'Review AV inventory', notes: 'Check the backup audio path.', status: 'open', bucket: 'past-due', scheduledDate: '2026-08-11', dueLabel: '1 day overdue' },
  { id: 'task-follow-vendor', title: '跟进供应商', notes: '确认周末设备交付时间。', status: 'open', bucket: 'unscheduled', dueLabel: 'Not scheduled' },
  { id: 'task-community-recap', title: 'Community recap - צוות / チーム 🌿', notes: 'Prepare the multilingual recap for collaborators.', status: 'open', bucket: 'week', scheduledDate: '2026-08-15', dueLabel: 'Saturday', collaborator: 'Morgan Lee' },
  ...dashboardDensityTasks,
];

const projectSteps: DashboardProjectStep[] = [
  { id: 'step-site-plan', title: 'Confirm site plan', status: 'done', dueLabel: 'Complete' },
  { id: 'step-host-roster', title: 'Publish host roster', status: 'done', dueLabel: 'Complete' },
  { id: 'step-supply-check', title: 'Verify supply pickup', status: 'done', dueLabel: 'Complete' },
  { id: 'step-volunteer-check-in', title: 'Volunteer check-in', status: 'open', dueLabel: 'Saturday · 8:00 AM' },
];

export const dashboardProject: DashboardProject = {
  id: 'weekend-service',
  title: 'Weekend service',
  owner: 'AJ Hochhalter',
  dueLabel: 'Sunday · Aug 16',
  nextStep: projectSteps[3],
  steps: projectSteps,
};

export const dashboardThread: DashboardThread = {
  id: 'thread-weekend-team',
  title: 'Weekend team',
  preview: 'Riley: The final volunteer stations are mapped.',
  unreadLabel: '6 unread',
};

export const dashboardCollaborators = [
  { id: 'workspace-user-2', name: 'Riley Chen' },
  { id: 'workspace-user-3', name: 'Morgan Lee' },
] as const;

export const initialDashboardReceipts = [
  'GET /dashboard/summary → 200',
  'GET /project-instances → 200',
] as const;
