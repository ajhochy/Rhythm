import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiGet, toolResult, toolError } from '../api_client.js';

interface Task {
  id: string;
  title: string;
  dueDate?: string | null;
  status: string;
}

interface ProjectInstance {
  id: string;
  name: string;
  anchorDate?: string;
  steps?: Array<{ id: string; title: string; status: string; dueDate?: string | null }>;
}

interface RecurringRule {
  id: string;
  enabled: boolean;
}

interface MessageThread {
  id: number;
  title: string;
  unreadCount?: number;
  updatedAt?: string;
}

export function registerDashboardTools(server: McpServer, apiUrl: string, apiToken: string) {
  server.tool(
    'rhythm_get_dashboard',
    'Get a summary snapshot of open tasks, active rhythms, active projects, and recent message threads. Useful for giving Claude context at the start of a session.',
    {},
    async () => {
      try {
        const [tasks, rhythms, instances, threads] = await Promise.all([
          apiGet<Task[]>(apiUrl, apiToken, '/tasks?status=open'),
          apiGet<RecurringRule[]>(apiUrl, apiToken, '/recurring-rules'),
          apiGet<ProjectInstance[]>(apiUrl, apiToken, '/project-instances?status=active'),
          apiGet<MessageThread[]>(apiUrl, apiToken, '/message-threads'),
        ]);

        // Tasks due within the next 7 days
        const now = new Date();
        const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const tasksDueThisWeek = tasks
          .filter((t) => t.dueDate && new Date(t.dueDate) <= in7Days)
          .slice(0, 10)
          .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate }));

        // Active rhythms count
        const activeRhythmCount = rhythms.filter((r) => r.enabled).length;

        // Active projects with next open step
        const activeProjects = instances.map((inst) => {
          const nextStep = (inst.steps ?? []).find((s) => s.status === 'open');
          return {
            id: inst.id,
            name: inst.name,
            anchorDate: inst.anchorDate,
            nextStep: nextStep ? { id: nextStep.id, title: nextStep.title, dueDate: nextStep.dueDate } : null,
          };
        });

        // Most recent 5 threads
        const recentThreads = [...threads]
          .sort((a, b) => {
            const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return db - da;
          })
          .slice(0, 5)
          .map((t) => ({ id: t.id, title: t.title, unreadCount: t.unreadCount ?? 0, lastActivity: t.updatedAt }));

        const dashboard = {
          openTaskCount: tasks.length,
          tasksDueThisWeek,
          activeRhythmCount,
          activeProjects,
          recentThreads,
        };

        return toolResult(JSON.stringify(dashboard, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
