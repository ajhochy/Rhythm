import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiGet, toolResult, toolError } from '../api_client.js';
import { scanContextContentAndRecordExternalContentTaint } from '../security/external_content_boundary.js';
import { trustedSecurityContext } from '../security/security_context.js';
import { registerAppTool } from './_tool.js';

const DASHBOARD_APP_URI = 'ui://rhythm/dashboard';
const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
const DASHBOARD_APP_HTML = `<main id="dashboard" aria-live="polite"><style>:root{color-scheme:light dark;font:14px system-ui,sans-serif}body{margin:0}#dashboard{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px}.card{border:1px solid currentColor;border-radius:10px;padding:12px}.value{display:block;font-size:24px;font-weight:700;margin-top:4px}</style><p>Dashboard data is loading…</p></main><script>(()=>{'use strict';const root=document.getElementById('dashboard');const fields=[['Open tasks','openTaskCount'],['Past due','pastDueCount'],['Due today','todayRemainingCount'],['Active rhythms','activeRhythmCount']];window.addEventListener('message',event=>{const message=event.data;if(!message||message.method!=='ui/notifications/tool-result')return;const result=message.params&&message.params.result;const value=result&&result.structuredContent?result.structuredContent:result;if(!value||typeof value!=='object'||Array.isArray(value))return;root.replaceChildren();for(const [label,key] of fields){const card=document.createElement('section');card.className='card';const title=document.createElement('span');title.textContent=label;const amount=document.createElement('strong');amount.className='value';amount.textContent=Number.isFinite(value[key])?String(value[key]):'—';card.append(title,amount);root.append(card)}})})();</script>`;

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
  // registerAppTool, not the raw SDK call: the helper runs the handler inside
  // runWithTrustedSecurityCall, which puts the engine's signed proof in
  // async-local scope. A tool registered with the raw SDK call still receives
  // `extra._meta` (so trustedSecurityContext works and the identity guard
  // passes) but currentTrustedSecurityCall() returns null, so every taint POST
  // it makes is unsigned and the agent server refuses it 403. That was #1094.
  registerAppTool(
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
    {
      ui: {
        resourceUri: DASHBOARD_APP_URI,
        visibility: ['model', 'app'],
      },
    },
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
        const structuredDashboard = {
          openTaskCount: dashboard.openTaskCount,
          pastDueCount: dashboard.pastDueCount,
          pastDeadlineCount: dashboard.pastDeadlineCount,
          todayRemainingCount: dashboard.todayRemainingCount,
          thisWeekRemainingCount: dashboard.thisWeekRemainingCount,
          unscheduledCount: dashboard.unscheduledCount,
          activeRhythmCount: dashboard.activeRhythmCount,
          activeProjectCount: projects.activeCount,
          unreadThreadCount: messages.threadCount,
        };
        return ingress.blocked
          ? { content: [{ type: 'text' as const, text: ingress.text }], isError: true as const }
          : { ...toolResult(ingress.text), structuredContent: structuredDashboard };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerResource(
    'Rhythm dashboard',
    DASHBOARD_APP_URI,
    { mimeType: MCP_APP_MIME_TYPE },
    async () => ({
      contents: [{ uri: DASHBOARD_APP_URI, mimeType: MCP_APP_MIME_TYPE, text: DASHBOARD_APP_HTML }],
    }),
  );
}
