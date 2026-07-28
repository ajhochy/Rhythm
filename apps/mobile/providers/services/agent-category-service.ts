import type {
  ActivityItem,
  ActivityStatus,
} from '@/providers/services/activity-service';

export type AgentCategory = 'chats' | 'scheduled' | 'background';
export type AgentActivityStatusFilter = ActivityStatus | 'all';

export function getAgentCategoryCounts(
  chats: unknown[],
  activities: ActivityItem[],
): Record<AgentCategory, number> {
  return {
    chats: chats.length,
    scheduled: activities.filter((item) => item.source === 'scheduler').length,
    background: activities.filter((item) => item.source === 'optimizer').length,
  };
}

export function filterAgentActivities(
  activities: ActivityItem[],
  {
    category,
    query,
    status,
  }: {
    category: Exclude<AgentCategory, 'chats'>;
    query: string;
    status: AgentActivityStatusFilter;
  },
): ActivityItem[] {
  const source = category === 'scheduled' ? 'scheduler' : 'optimizer';
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return activities.filter((item) => {
    if (item.source !== source) return false;
    if (status !== 'all' && item.status !== status) return false;
    if (!normalizedQuery) return true;
    return [item.title, item.summary, item.status]
      .filter((value): value is string => typeof value === 'string')
      .some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
  });
}
