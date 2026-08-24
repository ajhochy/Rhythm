export type RhythmFrequency = 'weekly' | 'monthly' | 'annual';

export interface RhythmPerson {
  id: string;
  name: string;
  initials: string;
}

export interface RhythmStep {
  id: string;
  title: string;
  assigneeId: string;
  dayOfWeek: number;
  dayOfMonth: number;
  month: number;
}

export interface RhythmRule {
  id: string;
  title: string;
  frequency: RhythmFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
  month: number;
  sequential: boolean;
  enabled: boolean;
  ownerId: string;
  ownerName: string;
  collaborators: RhythmPerson[];
  steps: RhythmStep[];
  generatedCount: number;
  completedCount: number;
  remainingCount: number;
  waitingOn: string | null;
  nextDueDate: string | null;
  completionRatio: number;
  createdAt: string;
}

export const currentRhythmUserId = '1';

export const rhythmWorkspaceMembers: RhythmPerson[] = [
  { id: '1', name: 'AJ Hochhalter', initials: 'AJ' },
  { id: '2', name: 'Riley Chen', initials: 'RC' },
  { id: '3', name: 'Morgan Lee', initials: 'ML' },
  { id: '4', name: 'Jordan Patel', initials: 'JP' },
];

export const seededRhythms: RhythmRule[] = [
  {
    id: 'rhythm-weekend-service',
    title: 'Weekend service cadence',
    frequency: 'weekly',
    dayOfWeek: 0,
    dayOfMonth: 1,
    month: 1,
    sequential: true,
    enabled: true,
    ownerId: '1',
    ownerName: 'AJ Hochhalter',
    collaborators: [{ id: '3', name: 'Morgan Lee', initials: 'ML' }],
    steps: [{ id: 'weekend-step-1', title: 'Prepare service handoff', assigneeId: '3', dayOfWeek: 0, dayOfMonth: 1, month: 1 }],
    generatedCount: 4,
    completedCount: 3,
    remainingCount: 1,
    waitingOn: 'Morgan Lee',
    nextDueDate: '2026-08-16',
    completionRatio: 0.75,
    createdAt: '2026-07-05T09:00:00-07:00',
  },
  {
    id: 'rhythm-monthly-care',
    title: 'Monthly care follow-through',
    frequency: 'monthly',
    dayOfWeek: 1,
    dayOfMonth: 15,
    month: 1,
    sequential: false,
    enabled: false,
    ownerId: '1',
    ownerName: 'AJ Hochhalter',
    collaborators: [],
    steps: [],
    generatedCount: 6,
    completedCount: 4,
    remainingCount: 2,
    waitingOn: null,
    nextDueDate: null,
    completionRatio: 2 / 3,
    createdAt: '2026-07-12T10:30:00-07:00',
  },
  {
    id: 'rhythm-annual-safety',
    title: 'Annual facilities safety review',
    frequency: 'annual',
    dayOfWeek: 1,
    dayOfMonth: 1,
    month: 9,
    sequential: false,
    enabled: true,
    ownerId: '1',
    ownerName: 'AJ Hochhalter',
    collaborators: [{ id: '4', name: 'Jordan Patel', initials: 'JP' }],
    steps: [],
    generatedCount: 2,
    completedCount: 1,
    remainingCount: 1,
    waitingOn: 'Jordan Patel',
    nextDueDate: '2026-09-01',
    completionRatio: 0.5,
    createdAt: '2026-07-20T13:15:00-07:00',
  },
  {
    id: 'rhythm-shared-care',
    title: '礼拜准备节奏 🎵',
    frequency: 'weekly',
    dayOfWeek: 3,
    dayOfMonth: 1,
    month: 1,
    sequential: true,
    enabled: true,
    ownerId: '3',
    ownerName: 'Morgan Lee',
    collaborators: [{ id: '1', name: 'AJ Hochhalter', initials: 'AJ' }],
    steps: [{ id: 'shared-step-1', title: '确认多语言团队的交接信息', assigneeId: '1', dayOfWeek: 3, dayOfMonth: 1, month: 1 }],
    generatedCount: 8,
    completedCount: 5,
    remainingCount: 3,
    waitingOn: 'AJ Hochhalter',
    nextDueDate: '2026-08-19',
    completionRatio: 0.625,
    createdAt: '2026-08-01T08:45:00-07:00',
  },
];

export const initialRhythmReceipts = [
  'GET /recurring-rules → 200',
  'GET /workspaces/me/members → 200',
] as const;

export function cloneSeededRhythms() {
  return structuredClone(seededRhythms) as RhythmRule[];
}
