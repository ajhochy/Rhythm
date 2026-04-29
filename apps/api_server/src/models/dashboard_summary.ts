import type { Task } from './task';

export interface DashboardTaskSummary {
  openCount: number;
  pastDueCount: number;
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

export interface DashboardProjectItem {
  id: string;
  title: string;
  subtitle: string;
  completedCount: number;
  totalCount: number;
  nextDueDate: string | null;
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
