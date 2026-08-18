import { taskDensitySeeds } from '../../taskDensityFixtures';

export type PlannerTask = {
  id: string;
  source: 'task' | 'project-step';
  title: string;
  notes: string;
  status: 'open' | 'done';
  scheduledDate?: string;
  dueDate?: string;
  scheduledOrder: number;
  energy?: '🔥' | '⚡' | '🌱';
  projectName?: string;
  collaborators?: Array<{ id: string; name: string }>;
};

export type PlannerEvent = {
  id: string;
  title: string;
  date: string;
  timeLabel: string;
  notes: string;
  allDay?: boolean;
};

export const PLANNER_FIXED_NOW = '2026-08-12T15:48:00-07:00';
export const PLANNER_CURRENT_WEEK = '2026-W33';

export const plannerMembers = [
  { id: 'workspace-user-2', name: 'Riley Chen' },
  { id: 'workspace-user-3', name: 'Morgan Lee' },
  { id: 'workspace-user-7', name: 'Visalia CRC' },
] as const;

export const plannerDensityTasks: PlannerTask[] = taskDensitySeeds.map(({ id, title, notes, date, dayIndex, taskIndex, projectStep }) => {
    return {
      id,
      source: projectStep ? 'project-step' : 'task',
      title,
      notes,
      status: 'open',
      scheduledDate: date,
      dueDate: date,
      scheduledOrder: 1000 + (dayIndex * 100) + taskIndex,
      ...(projectStep
        ? { projectName: 'Weekend service rollout' }
        : { energy: (['🌱', '⚡', '🔥'] as const)[taskIndex % 3], collaborators: [] }),
    } satisfies PlannerTask;
  });

export const plannerTasks: PlannerTask[] = [
  {
    id: 'task-wed',
    source: 'task',
    title: 'Prepare Sunday service handoff',
    notes: 'Bring the latest service plan.',
    status: 'open',
    scheduledDate: '2026-08-12',
    dueDate: '2026-08-12',
    scheduledOrder: 100,
    energy: '⚡',
    collaborators: [{ id: 'workspace-user-2', name: 'Riley Chen' }],
  },
  {
    id: 'step-thu',
    source: 'project-step',
    title: 'Confirm volunteer stations',
    notes: 'Review entrances and welcome desk coverage.',
    status: 'open',
    scheduledDate: '2026-08-13',
    dueDate: '2026-08-13',
    scheduledOrder: 200,
    projectName: 'Weekend service rollout',
  },
  {
    id: 'task-fri',
    source: 'task',
    title: 'Publish livestream fallback',
    notes: 'Confirm the backup encoder and operator.',
    status: 'open',
    scheduledDate: '2026-08-14',
    dueDate: '2026-08-14',
    scheduledOrder: 300,
    energy: '🔥',
    collaborators: [],
  },
  {
    id: 'task-done',
    source: 'task',
    title: 'Print welcome desk roster',
    notes: 'Roster delivered to the lobby team.',
    status: 'done',
    scheduledDate: '2026-08-11',
    dueDate: '2026-08-11',
    scheduledOrder: 80,
    energy: '🌱',
    collaborators: [],
  },
  {
    id: 'task-backlog',
    source: 'task',
    title: '跟进供应商 · Vendor equipment follow-up',
    notes: 'Confirm the delivery window.',
    status: 'open',
    scheduledOrder: 400,
    energy: '🌱',
    collaborators: [],
  },
  {
    id: 'step-overdue',
    source: 'project-step',
    title: 'Verify supply pickup',
    notes: 'This source-owned step predates the visible week.',
    status: 'open',
    dueDate: '2026-08-07',
    scheduledOrder: 500,
    projectName: 'Weekend service rollout',
  },
  ...plannerDensityTasks,
];

export const partialLongTask: PlannerTask = {
  id: 'long-title',
  source: 'task',
  title: 'خطة تسليم طويلة لفريق نهاية الأسبوع - 日本語の引き継ぎと長いタイトル 🌏✨',
  notes: '',
  status: 'open',
  scheduledDate: '2026-08-10',
  scheduledOrder: 50,
};

export const plannerEvents: PlannerEvent[] = [
  {
    id: 'calendar-wed',
    title: 'Operations stand-up',
    date: '2026-08-12',
    timeLabel: '9:30 AM',
    notes: 'Calendar context synchronized from the workspace calendar.',
  },
  {
    id: 'calendar-sat',
    title: 'Community weekend',
    date: '2026-08-15',
    timeLabel: 'All day',
    notes: 'Read-only all-day calendar context.',
    allDay: true,
  },
];

export const initialPlannerReceipts = ['GET /weekly-plan?week=2026-W33 → 200'] as const;
