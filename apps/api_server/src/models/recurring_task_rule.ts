export interface RecurringTaskRuleStep {
  id: string;
  title: string;
  assigneeId: number | null;
  assigneeName?: string | null;
}

export interface RhythmCollaborator {
  userId: number;
  name: string;
  email: string;
  photoUrl: string | null;
}

export interface RecurringTaskRuleProgress {
  totalCount: number;
  completedCount: number;
  remainingCount: number;
  personalRemainingCount: number;
  waitingOnUserId: number | null;
  waitingOnUserName: string | null;
  nextDueDate: string | null;
  completionRatio: number;
}

export interface RecurringTaskRule {
  id: string;
  title: string;
  frequency: 'weekly' | 'monthly' | 'annual';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  month: number | null;
  enabled: boolean;
  sequential: boolean;
  ownerId: number | null;
  steps: RecurringTaskRuleStep[];
  collaborators: RhythmCollaborator[];
  progress?: RecurringTaskRuleProgress;
  createdAt: string;
}

export interface CreateRecurringTaskRuleDto {
  title: string;
  frequency: 'weekly' | 'monthly' | 'annual';
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  month?: number | null;
  enabled?: boolean;
  sequential?: boolean;
  ownerId?: number | null;
  steps?: RecurringTaskRuleStep[];
}

export interface UpdateRecurringTaskRuleDto {
  title?: string;
  frequency?: 'weekly' | 'monthly' | 'annual';
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  month?: number | null;
  enabled?: boolean;
  sequential?: boolean;
  ownerId?: number | null;
  steps?: RecurringTaskRuleStep[];
}
