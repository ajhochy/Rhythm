import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiGet, toolResult, toolError } from '../api_client.js';
import { scanContextContentAndRecordExternalContentTaint } from '../security/external_content_boundary.js';
import { trustedSecurityContext } from '../security/security_context.js';
import { registerTool } from './_tool.js';

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

export function registerDashboardTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  agentUrl = process.env.RHYTHM_AGENT_URL ?? 'http://127.0.0.1:4001',
) {
  // registerTool, not server.tool: registerTool is what runs the handler
  // inside runWithTrustedSecurityCall, which puts the engine's signed proof in
  // async-local scope. A tool registered with the raw SDK call still receives
  // `extra._meta` (so trustedSecurityContext works and the identity guard
  // passes) but currentTrustedSecurityCall() returns null, so every taint POST
  // it makes is unsigned and the agent server refuses it 403. That was #1094.
  registerTool(
    server,
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
    async (_args, extra) => {
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

        const raw = JSON.stringify(dashboard, null, 2);
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: 'dashboard.message-preview',
          label: 'dashboard including shared message previews',
          rawContent: raw,
        });
        return ingress.blocked
          ? { content: [{ type: 'text' as const, text: ingress.text }], isError: true as const }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
