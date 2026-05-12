import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerDashboardTools } from '../dashboard.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}>;

interface RegisteredTool {
  name: string;
  description: string;
  shape: Record<string, unknown>;
  handler: ToolHandler;
}

function makeStubServer(): { server: unknown; tools: Map<string, RegisteredTool> } {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(name: string, description: string, shape: Record<string, unknown>, handler: ToolHandler) {
      tools.set(name, { name, description, shape, handler });
    },
  };
  return { server, tools };
}

const API_URL = 'http://x';
const API_TOKEN = 'tok';

function makeFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

/** Build a minimal DashboardSummary fixture. */
function makeSummary(overrides: Partial<{
  tasks: unknown;
  rhythms: unknown;
  projects: unknown;
  messages: unknown;
}> = {}) {
  return {
    tasks: {
      openCount: 3,
      pastDueCount: 1,
      pastDeadlineCount: 0,
      todayRemainingCount: 1,
      todayTotalCount: 1,
      thisWeekRemainingCount: 2,
      thisWeekTotalCount: 2,
      unscheduledCount: 0,
      recent: [],
      pastDue: [],
      today: [],
      thisWeek: [],
      unscheduled: [],
      ...(typeof overrides.tasks === 'object' && overrides.tasks != null ? overrides.tasks : {}),
    },
    rhythms: { activeCount: 2, items: [] },
    projects: { activeCount: 0, items: [] },
    messages: { threadCount: 0, unreadPreviews: [] },
    ...overrides,
  };
}

describe('registerDashboardTools', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  describe('rhythm_get_dashboard', () => {
    it('(a) calls GET /dashboard/summary in a single round-trip', async () => {
      const mockFetch = makeFetchOk(makeSummary());
      vi.stubGlobal('fetch', mockFetch);

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerDashboardTools(server as any, API_URL, API_TOKEN);

      await tools.get('rhythm_get_dashboard')!.handler({});

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_URL}/dashboard/summary`);
    });

    it('(b) output JSON includes pastDeadlineCount', async () => {
      const summary = makeSummary({ tasks: { pastDeadlineCount: 4 } });
      vi.stubGlobal('fetch', makeFetchOk(summary));

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerDashboardTools(server as any, API_URL, API_TOKEN);

      const res = await tools.get('rhythm_get_dashboard')!.handler({});
      const output = JSON.parse(res.content[0].text);
      expect(output.pastDeadlineCount).toBe(4);
    });

    it(
      '(c) a task with scheduledDate 5 days from now and dueDate 2 days ago appears in ' +
      'tasksDueThisWeek (not tasksPastDue) and increments pastDeadlineCount',
      async () => {
        const now = new Date();
        const in5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const minus2Days = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const task = {
          id: 'task-1',
          title: 'Deferred task',
          scheduledDate: in5Days,
          dueDate: minus2Days,
          status: 'open',
        };

        const summary = makeSummary({
          tasks: {
            openCount: 1,
            pastDueCount: 0,
            // Backend determined this task misses its hard deadline but isn't "pastDue"
            // because scheduledDate is in the future.
            pastDeadlineCount: 1,
            todayRemainingCount: 0,
            todayTotalCount: 0,
            thisWeekRemainingCount: 1,
            thisWeekTotalCount: 1,
            unscheduledCount: 0,
            recent: [task],
            pastDue: [],      // NOT in pastDue — scheduledDate is in the future
            today: [],
            thisWeek: [task], // IS in thisWeek — scheduledDate falls within 7 days
            unscheduled: [],
          },
        });

        vi.stubGlobal('fetch', makeFetchOk(summary));

        const { server, tools } = makeStubServer();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        registerDashboardTools(server as any, API_URL, API_TOKEN);

        const res = await tools.get('rhythm_get_dashboard')!.handler({});
        const output = JSON.parse(res.content[0].text);

        // Must be in tasksDueThisWeek (scheduled-priority date window)
        const thisWeekIds = (output.tasksDueThisWeek as Array<{ id: string }>).map((t) => t.id);
        expect(thisWeekIds).toContain('task-1');

        // Must NOT be in tasksPastDue
        const pastDueIds = (output.tasksPastDue as Array<{ id: string }>).map((t) => t.id);
        expect(pastDueIds).not.toContain('task-1');

        // pastDeadlineCount must be 1
        expect(output.pastDeadlineCount).toBe(1);

        // operativeDate must reflect scheduledDate, not dueDate
        const taskInWeek = (output.tasksDueThisWeek as Array<{ id: string; operativeDate: string }>)
          .find((t) => t.id === 'task-1')!;
        expect(taskInWeek.operativeDate).toBe(in5Days);
      },
    );

    it('(d) tool description mentions both scheduledDate state and pastDeadlineCount', () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerDashboardTools(server as any, API_URL, API_TOKEN);

      const tool = tools.get('rhythm_get_dashboard')!;
      expect(tool.description.toLowerCase()).toContain('scheduleddate');
      expect(tool.description.toLowerCase()).toContain('pastdeadlinecount');
    });

    it('(e) returns isError: true when backend returns 500', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'internal server error' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerDashboardTools(server as any, API_URL, API_TOKEN);

      const res = await tools.get('rhythm_get_dashboard')!.handler({});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Rhythm API error 500');
    });

    it('(f) backward-compat: output JSON still includes openTaskCount and recentThreads', async () => {
      const summary = makeSummary({
        messages: {
          threadCount: 2,
          unreadPreviews: [
            {
              threadId: 7,
              threadTitle: 'Team chat',
              senderName: 'Alice',
              preview: 'Hello',
              updatedAt: '2025-01-01T10:00:00Z',
              unreadCount: 3,
            },
          ],
        },
      });
      vi.stubGlobal('fetch', makeFetchOk(summary));

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerDashboardTools(server as any, API_URL, API_TOKEN);

      const res = await tools.get('rhythm_get_dashboard')!.handler({});
      const output = JSON.parse(res.content[0].text);

      expect(output).toHaveProperty('openTaskCount');
      expect(output).toHaveProperty('recentThreads');
      expect((output.recentThreads as Array<{ id: number }>)[0].id).toBe(7);
    });
  });
});
