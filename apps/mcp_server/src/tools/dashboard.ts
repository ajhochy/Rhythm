import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiGet, toolResult, toolError } from '../api_client.js';

interface PastDeadlineTaskSummary {
  id: string;
  title: string;
  dueDate: string | null;
  scheduledDate: string | null;
  sourceType: string | null;
}

interface DashboardTaskSummary {
  openCount: number;
  pastDueCount: number;
  pastDeadlineCount: number;
  pastDeadlineTasks: PastDeadlineTaskSummary[];
  todayRemainingCount: number;
  todayTotalCount: number;
  thisWeekRemainingCount: number;
  thisWeekTotalCount: number;
  unscheduledCount: number;
  recent: Array<{ id: string; title: string; scheduledDate?: string | null; dueDate?: string | null }>;
  pastDue: Array<{ id: string; title: string; scheduledDate?: string | null; dueDate?: string | null }>;
  today: Array<{ id: string; title: string; scheduledDate?: string | null; dueDate?: string | null }>;
  thisWeek: Array<{ id: string; title: string; scheduledDate?: string | null; dueDate?: string | null }>;
  unscheduled: Array<{ id: string; title: string }>;
}

interface DashboardRhythmSummary {
  activeCount: number;
  items: Array<{ id: string; title: string; subtitle: string; completedCount: number; totalCount: number }>;
}

interface DashboardProjectSummary {
  activeCount: number;
  items: Array<{
    id: string;
    title: string;
    subtitle: string;
    completedCount: number;
    totalCount: number;
    nextDueDate: string | null;
    onDeckSteps: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  }>;
}

interface DashboardMessageSummary {
  threadCount: number;
  unreadPreviews: Array<{
    threadId: number;
    threadTitle: string;
    senderName: string;
    preview: string;
    updatedAt: string;
    unreadCount: number;
  }>;
}

interface DashboardSummary {
  tasks: DashboardTaskSummary;
  rhythms: DashboardRhythmSummary;
  projects: DashboardProjectSummary;
  messages: DashboardMessageSummary;
}

export function registerDashboardTools(server: McpServer, apiUrl: string, apiToken: string) {
  server.tool(
    'rhythm_get_dashboard',
    'Get a summary snapshot of open tasks, active rhythms, active projects, and recent message threads. ' +
    'Task counts and lists are based on scheduledDate (when you plan to do the work); if scheduledDate is ' +
    'absent, dueDate is used as the fallback. ' +
    'Fields returned — task counts: ' +
    'pastDueCount (tasks overdue by scheduledDate — the user is behind on planned work); ' +
    'pastDeadlineCount (open tasks whose hard dueDate has passed even if scheduledDate has not — a deadline was missed); ' +
    'todayRemainingCount, thisWeekRemainingCount, unscheduledCount. ' +
    'pastDeadlineTasks: concise summaries ({ id, title, dueDate, scheduledDate, sourceType }) for every task in ' +
    'pastDeadlineCount, sorted by dueDate ASC (most-overdue first), mutually exclusive with tasksPastDue. ' +
    'Task list items include operativeDate = scheduledDate ?? dueDate for easy sorting. ' +
    'Project on-deck steps include scheduledDate (when step is planned) and dueDate (step hard deadline). ' +
    'Useful for giving Claude context at the start of a session.',
    {},
    async () => {
      try {
        const summary = await apiGet<DashboardSummary>(apiUrl, apiToken, '/dashboard/summary');

        const { tasks, rhythms, projects, messages } = summary;

        // Build a compact representation for the briefing consumer.
        // We surface scheduledDate ?? dueDate as the operative date for each task list item.
        const mapTaskItem = (t: { id: string; title: string; scheduledDate?: string | null; dueDate?: string | null }) => ({
          id: t.id,
          title: t.title,
          scheduledDate: t.scheduledDate ?? null,
          dueDate: t.dueDate ?? null,
          operativeDate: t.scheduledDate ?? t.dueDate ?? null,
        });

        const dashboard = {
          // ── Tasks ───────────────────────────────────────────────────────────
          openTaskCount: tasks.openCount,
          pastDueCount: tasks.pastDueCount,
          // pastDeadlineCount: open tasks whose hard dueDate has passed even
          // though their scheduledDate has not (i.e. the user intends to do it
          // later but a deadline was already missed).
          pastDeadlineCount: tasks.pastDeadlineCount,
          // pastDeadlineTasks: concise summaries for every task in pastDeadlineCount,
          // sorted by dueDate ASC (most-overdue deadline first). Mutually exclusive
          // with tasksPastDue — a task appears in at most one of the two lists.
          pastDeadlineTasks: tasks.pastDeadlineTasks ?? [],
          todayRemainingCount: tasks.todayRemainingCount,
          thisWeekRemainingCount: tasks.thisWeekRemainingCount,
          unscheduledCount: tasks.unscheduledCount,
          // tasksDueThisWeek kept for backward-compat with existing consumers;
          // populated from thisWeek (scheduled-priority date, not raw dueDate).
          tasksDueThisWeek: (tasks.thisWeek ?? []).slice(0, 10).map(mapTaskItem),
          tasksPastDue: (tasks.pastDue ?? []).slice(0, 10).map(mapTaskItem),
          tasksToday: (tasks.today ?? []).slice(0, 10).map(mapTaskItem),
          // ── Rhythms ─────────────────────────────────────────────────────────
          activeRhythmCount: rhythms.activeCount,
          rhythms: rhythms.items,
          // ── Projects ────────────────────────────────────────────────────────
          activeProjects: projects.items.map((p) => ({
            id: p.id,
            name: p.title,
            subtitle: p.subtitle,
            nextDueDate: p.nextDueDate,
            onDeckSteps: p.onDeckSteps,
          })),
          // ── Messages ────────────────────────────────────────────────────────
          recentThreads: messages.unreadPreviews.map((u) => ({
            id: u.threadId,
            title: u.threadTitle,
            unreadCount: u.unreadCount,
            lastActivity: u.updatedAt,
          })),
        };

        return toolResult(JSON.stringify(dashboard, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
