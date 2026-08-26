import { taskDensitySeeds } from '../../taskDensityFixtures';

export type TaskStatus = 'open' | 'in_progress' | 'waiting_for_reply' | 'done' | 'deferred';
export type TaskBucket = 'past-due' | 'today' | 'week' | 'month' | 'no-due' | 'completed';

export interface TaskCollaborator {
  id: string;
  name: string;
  initials: string;
}

export interface TaskFixture {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  bucket: TaskBucket;
  priority: 0 | 1 | 2 | 3;
  tags: string[];
  scheduledDate?: string;
  dueDate?: string;
  createdAt: string;
  sourceName?: string;
  // Widened from a 3-value union: the live API's Task.sourceType is `string | null`
  // (apps/api_server/src/models/task.ts:19) and includes 'project_step', 'recurring_rule',
  // and 'automation_rule' in addition to the fixture-era 'manual'/'calendar_shadow_event'/
  // 'prod_mirror' — gateway/tasks.ts must pass the server value through truthfully rather
  // than coercing every unrecognized source into 'manual'.
  sourceType?: string;
  createdBy: string;
  ownerId: string;
  /** API-owned visibility signal; absent for deterministic fixture compatibility. */
  isShared?: boolean;
  preferredAgent: '' | 'claude-code' | 'codex';
  energy: '' | '🔥' | '⚡' | '🌱';
  collaborators: TaskCollaborator[];
}

export const currentUserId = '1';

export const workspaceMembers: TaskCollaborator[] = [
  { id: '1', name: 'AJ Hochhalter', initials: 'AJ' },
  { id: '2', name: 'Morgan Lee', initials: 'ML' },
  { id: '7', name: 'Visalia CRC', initials: 'VC' },
  { id: '8', name: 'Riley Chen', initials: 'RC' },
];

export const denseTaskFixtures: TaskFixture[] = taskDensitySeeds.map(({ id, title, notes, date, taskIndex, projectStep }) => ({
  id,
  title,
  notes,
  status: 'open',
  bucket: date < '2026-08-12' ? 'past-due' : date === '2026-08-12' ? 'today' : 'week',
  priority: ((taskIndex % 3) + 1) as 1 | 2 | 3,
  tags: projectStep ? ['project'] : ['operations'],
  scheduledDate: date,
  dueDate: date,
  createdAt: '2026-08-10T08:00:00-07:00',
  sourceName: projectStep ? 'Weekend service rollout' : undefined,
  sourceType: 'manual',
  createdBy: 'AJ Hochhalter',
  ownerId: currentUserId,
  preferredAgent: '',
  energy: '',
  collaborators: taskIndex % 7 === 0 ? [workspaceMembers[taskIndex % 2 === 0 ? 3 : 1]] : [],
}));

export const seededTasks: TaskFixture[] = [
  {
    id: 'task-archive-runbook',
    title: 'Archive obsolete stage runbook',
    notes: 'Keep the active safety notes in the replacement runbook.',
    status: 'waiting_for_reply',
    bucket: 'past-due',
    priority: 2,
    tags: ['operations'],
    scheduledDate: '2026-08-11',
    dueDate: '2026-08-11',
    createdAt: '2026-08-08T10:12:00-07:00',
    sourceType: 'manual',
    createdBy: 'AJ Hochhalter',
    ownerId: '1',
    preferredAgent: '',
    energy: '🌱',
    collaborators: [],
  },
  {
    id: 'task-service-handoff',
    title: 'Prepare Sunday service handoff',
    notes: 'Confirm the final run sheet and coverage notes.',
    status: 'open',
    bucket: 'today',
    priority: 3,
    tags: ['worship', 'handoff'],
    scheduledDate: '2026-08-12',
    dueDate: '2026-08-12',
    createdAt: '2026-08-10T09:20:00-07:00',
    sourceName: 'Sunday service rollout',
    sourceType: 'manual',
    createdBy: 'AJ Hochhalter',
    ownerId: '1',
    preferredAgent: 'claude-code',
    energy: '🔥',
    collaborators: [{ id: '2', name: 'Morgan Lee', initials: 'ML' }],
  },
  {
    id: 'task-cjk-handoff',
    title: '准备礼拜交接 🎵',
    notes: '确认多语言团队的交接信息。',
    status: 'in_progress',
    bucket: 'no-due',
    priority: 1,
    tags: ['community'],
    createdAt: '2026-08-12T08:30:00-07:00',
    sourceType: 'manual',
    createdBy: 'AJ Hochhalter',
    ownerId: '1',
    preferredAgent: '',
    energy: '⚡',
    collaborators: [],
  },
  {
    id: 'task-livestream-fallback',
    title: 'Review livestream fallback',
    notes: 'Verify the fallback encoder before the volunteer rehearsal.',
    status: 'open',
    bucket: 'week',
    priority: 2,
    tags: ['media'],
    scheduledDate: '2026-08-14',
    dueDate: '2026-08-14',
    createdAt: '2026-08-09T14:05:00-07:00',
    sourceName: 'Weekend media plan',
    sourceType: 'manual',
    createdBy: 'AJ Hochhalter',
    ownerId: '1',
    preferredAgent: 'codex',
    energy: '',
    collaborators: [],
  },
  {
    id: 'task-shared-with-me',
    title: 'Verify shared volunteer roster',
    notes: 'Morgan shared this task for final edits and completion.',
    status: 'open',
    bucket: 'no-due',
    priority: 2,
    tags: ['people'],
    createdAt: '2026-08-12T11:14:00-07:00',
    sourceName: 'Volunteer coordination',
    sourceType: 'manual',
    createdBy: 'Morgan Lee',
    ownerId: '2',
    isShared: true,
    preferredAgent: '',
    energy: '🌱',
    collaborators: [{ id: '1', name: 'AJ Hochhalter', initials: 'AJ' }],
  },
  {
    id: 'task-calendar-shadow',
    title: '完成日历影子归档',
    notes: 'This task mirrors the shared calendar event.',
    status: 'done',
    bucket: 'completed',
    priority: 1,
    tags: ['calendar'],
    scheduledDate: '2026-08-15',
    createdAt: '2026-08-07T15:40:00-07:00',
    sourceName: 'Weekend team calendar',
    sourceType: 'calendar_shadow_event',
    createdBy: 'Calendar sync',
    ownerId: '1',
    preferredAgent: '',
    energy: '',
    collaborators: [],
  },
  ...denseTaskFixtures,
];

export const initialTaskReceipts = ['GET /tasks → 200'] as const;

export const taskStatusLabels: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_for_reply: 'Waiting for reply',
  done: 'Done',
  deferred: 'Deferred',
};

export const taskBucketLabels: Record<TaskBucket, string> = {
  'past-due': 'Past Due',
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  'no-due': 'No Due Date',
  completed: 'Completed',
};

export const taskBucketOrder: TaskBucket[] = ['past-due', 'today', 'week', 'month', 'no-due', 'completed'];

export function cloneSeededTasks() {
  return structuredClone(seededTasks) as TaskFixture[];
}
