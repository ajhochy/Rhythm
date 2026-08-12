import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerDashboardTools } from '../dashboard.js';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { UNTRUSTED_FENCE_CLOSE, UNTRUSTED_FENCE_OPEN } from '../../untrusted_context.js';

type ToolHandler = (args: Record<string, unknown>, extra?: { _meta?: Record<string, unknown> }) => Promise<{
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
    registerTool(
      name: string,
      config: { description: string; inputSchema: Record<string, unknown> },
      handler: ToolHandler,
    ) {
      tools.set(name, {
        name,
        description: config.description,
        shape: config.inputSchema,
        handler,
      });
    },
    registerResource() {},
  };
  return { server, tools };
}

const API_URL = 'http://x';
const API_TOKEN = 'tok';
const AGENT_URL = 'http://agent';
const EXTRA = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: 'sdk-dashboard-test',
      turnId: 'turn-dashboard-test',
      agentName: 'secretary',
      toolCallId: 'call-dashboard-test',
    },
  },
};

/**
 * #1094: the engine signs every MCP call and puts the proof in request _meta.
 * `EXTRA` above deliberately omits it (identity only), so it exercises the
 * shape-check path. This one carries the full signed envelope, which is what
 * the taint endpoint actually verifies.
 */
const EXTRA_SIGNED = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: 'sdk-dashboard-signed',
      turnId: 'turn-dashboard-signed',
      agentName: 'secretary',
      toolCallId: 'call-dashboard-signed',
      proof: {
        version: 1,
        algorithm: 'Ed25519',
        keyId: 'test-key',
        issuedAt: 1_785_889_857_000,
        nonce: 'nonce-dashboard-signed',
        toolName: 'rhythm_get_dashboard',
        argumentsHash: 'test-arguments-hash',
        signature: 'test-signature',
      },
    },
  },
};

function parseFencedJson(text: string): Record<string, unknown> {
  const start = text.indexOf(UNTRUSTED_FENCE_OPEN);
  const end = text.indexOf(UNTRUSTED_FENCE_CLOSE);
  return JSON.parse(
    text.slice(start + UNTRUSTED_FENCE_OPEN.length, end).trim(),
  ) as Record<string, unknown>;
}

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
      registerDashboardTools(server as any, API_URL, API_TOKEN, AGENT_URL);

      await tools.get('rhythm_get_dashboard')!.handler({}, EXTRA);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [url] = mockFetch.mock.calls.find(([candidate]) =>
        String(candidate).includes('/dashboard/summary')) as [string, RequestInit];
      expect(url).toBe(`${API_URL}/dashboard/summary`);
    });

    it('(b) output JSON includes pastDeadlineCount', async () => {
      const summary = makeSummary({ tasks: { pastDeadlineCount: 4 } });
      vi.stubGlobal('fetch', makeFetchOk(summary));

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerDashboardTools(server as any, API_URL, API_TOKEN, AGENT_URL);

      const res = await tools.get('rhythm_get_dashboard')!.handler({}, EXTRA);
      const output = parseFencedJson(res.content[0].text);
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
        registerDashboardTools(server as any, API_URL, API_TOKEN, AGENT_URL);

        const res = await tools.get('rhythm_get_dashboard')!.handler({}, EXTRA);
        const output = parseFencedJson(res.content[0].text);

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
      registerDashboardTools(server as any, API_URL, API_TOKEN, AGENT_URL);

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
      registerDashboardTools(server as any, API_URL, API_TOKEN, AGENT_URL);

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
      registerDashboardTools(server as any, API_URL, API_TOKEN, AGENT_URL);

      const res = await tools.get('rhythm_get_dashboard')!.handler({}, EXTRA);
      const output = parseFencedJson(res.content[0].text);

      expect(output).toHaveProperty('openTaskCount');
      expect(output).toHaveProperty('recentThreads');
      expect((output.recentThreads as Array<{ id: number }>)[0].id).toBe(7);
    });

    /**
     * #1094 regression. `dashboard.message-preview` arms the approval gate, so
     * this read must record a taint — and the taint endpoint only accepts a
     * signed engine proof. This tool was registered with the raw
     * `server.tool()` instead of `registerTool()`, so the proof never entered
     * async-local scope, `trustedCall` went out as `null`, and every scheduled
     * run that called it died on "agent server refused external-content taint
     * (403)".
     */
    it('(h) forwards the engine-signed trusted call to the taint endpoint', async () => {
      const taints: Array<Record<string, unknown>> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL, init?: RequestInit) => {
          if (String(input).endsWith('/agent-approvals/external-content/taint')) {
            taints.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return { ok: true, status: 201, json: async () => ({ taintId: 't-1094' }) };
          }
          return { ok: true, status: 200, json: async () => makeSummary() };
        }),
      );

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerDashboardTools(server as any, API_URL, API_TOKEN, AGENT_URL);

      const res = await tools.get('rhythm_get_dashboard')!.handler({}, EXTRA_SIGNED);

      expect(res.isError).toBeUndefined();
      expect(taints).toHaveLength(1);
      expect(taints[0].trustedCall).toEqual({
        context: {
          sdkSessionId: 'sdk-dashboard-signed',
          turnId: 'turn-dashboard-signed',
          agentName: 'secretary',
          toolCallId: 'call-dashboard-signed',
        },
        proof: expect.objectContaining({ toolName: 'rhythm_get_dashboard' }),
        arguments: {},
      });
    });

    /**
     * The refusal used to arrive as a bare status code, which is why #1094 took
     * a transcript archaeology session to diagnose. The server already computes
     * a precise reason; surface it.
     */
    it('(i) surfaces the agent server refusal reason, not just the status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          if (String(input).endsWith('/agent-approvals/external-content/taint')) {
            return {
              ok: false,
              status: 403,
              json: async () => ({
                error: {
                  code: 'FORBIDDEN',
                  message:
                    'trusted Rhythm MCP caller is required for rhythm_get_dashboard: trusted MCP call is missing',
                },
              }),
            };
          }
          return { ok: true, status: 200, json: async () => makeSummary() };
        }),
      );

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerDashboardTools(server as any, API_URL, API_TOKEN, AGENT_URL);

      const res = await tools.get('rhythm_get_dashboard')!.handler({}, EXTRA_SIGNED);

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('dashboard.message-preview');
      expect(res.content[0].text).toContain('trusted MCP call is missing');
    });
  });
});
