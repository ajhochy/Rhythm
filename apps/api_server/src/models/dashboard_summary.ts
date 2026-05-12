import type { Task } from './task';

/** Concise task summary included in pastDeadlineTasks — no large fields. */
export interface PastDeadlineTaskSummary {
  id: string;
  title: string;
  dueDate: string | null;
  scheduledDate: string | null;
  sourceType: string | null;
}

export interface DashboardTaskSummary {
  openCount: number;
  pastDueCount: number;
  pastDeadlineCount: number;
  /** Tasks whose hard dueDate has passed but whose scheduledDate has not (mutually exclusive with pastDue). Sorted by dueDate ASC. */
  pastDeadlineTasks: PastDeadlineTaskSummary[];
  todayRemainingCount: number;
  todayTotalCount: number;
  thisWeekRemainingCount: number;
  thisWeekTotalCount: number;
  unscheduledCount: number;
  recent: Task[];
  pastDue: Task[];
  today: Task[];
  thisWeek: Task[];
  unscheduled: Task[];
}

export interface DashboardRhythmItem {
  id: string;
  title: string;
  subtitle: string;
  completedCount: number;
  totalCount: number;
}

export interface DashboardRhythmSummary {
  activeCount: number;
  items: DashboardRhythmItem[];
}

export interface DashboardProjectStepPreview {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  notes: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
}

export interface DashboardProjectItem {
  id: string;
  title: string;
  subtitle: string;
  completedCount: number;
  totalCount: number;
  nextDueDate: string | null;
  onDeckSteps: DashboardProjectStepPreview[];
  ownerId: number | null;
  collaboratorNames: string[];
}

export interface DashboardProjectSummary {
  activeCount: number;
  items: DashboardProjectItem[];
}

export interface DashboardUnreadPreview {
  threadId: number;
  threadTitle: string;
  senderName: string;
  preview: string;
  updatedAt: string;
  unreadCount: number;
}

export interface DashboardMessageSummary {
  threadCount: number;
  unreadPreviews: DashboardUnreadPreview[];
}

export interface DashboardSummary {
  tasks: DashboardTaskSummary;
  rhythms: DashboardRhythmSummary;
  projects: DashboardProjectSummary;
  messages: DashboardMessageSummary;
}
