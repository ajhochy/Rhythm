import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { registerDashboardTools } from '../dashboard.js';

describe('issue #1355 dashboard MCP App pilot', () => {
  it('keeps one existing tool, adds stable UI descriptor/resource, and useful fallbacks', async () => {
    const tools = new Map<string, any>();
    const resources = new Map<string, any>();
    const server = {
      registerTool(name: string, config: any, handler: any) {
        tools.set(name, { config, handler });
      },
      registerResource(name: string, uri: string, config: any, handler: any) {
        resources.set(uri, { name, config, handler });
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tasks: {
            openCount: 3,
            pastDueCount: 1,
            pastDeadlineCount: 0,
            pastDeadlineTasks: [],
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
          },
          rhythms: { activeCount: 2, items: [] },
          projects: { activeCount: 0, items: [] },
          messages: {
            threadCount: 1,
            unreadPreviews: [
              {
                threadId: 1,
                threadTitle: 'untrusted-title-must-stay-fenced',
                senderName: 'x',
                preview: 'x',
                updatedAt: '2026-08-10T00:00:00Z',
                unreadCount: 1,
              },
            ],
          },
        }),
      }),
    );
    registerDashboardTools(server as never, 'http://api', 'token', 'http://agent');
    expect([...tools.keys()]).toEqual(['rhythm_get_dashboard']);
    const tool = tools.get('rhythm_get_dashboard');
    expect(tool.config._meta).toEqual({
      ui: {
        resourceUri: 'ui://rhythm/dashboard',
        visibility: ['model', 'app'],
      },
    });
    expect([...resources.keys()]).toEqual(['ui://rhythm/dashboard']);
    expect(resources.get('ui://rhythm/dashboard').config.mimeType).toBe('text/html;profile=mcp-app');
    const resource = await resources.get('ui://rhythm/dashboard').handler(new URL('ui://rhythm/dashboard'));
    expect(resource.contents).toHaveLength(1);
    const html = resource.contents[0];
    expect(html).toMatchObject({
      uri: 'ui://rhythm/dashboard',
      mimeType: 'text/html;profile=mcp-app',
    });
    expect(html.text).toContain('ui/notifications/tool-result');
    expect(html.text).not.toMatch(/https?:\/\/|open design/i);

    const result = await tool.handler(
      {},
      {
        _meta: {
          'com.vcrc.rhythm/security-context': {
            sdkSessionId: 'sdk-dashboard-app',
            turnId: 'turn-dashboard-app',
            agentName: 'secretary',
            toolCallId: 'call-dashboard-app',
          },
        },
      },
    );
    expect(result.content[0].text).toMatch(/openTaskCount|dashboard/i);
    expect(result.structuredContent).toMatchObject({
      openTaskCount: 3,
      activeRhythmCount: 2,
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain('untrusted-title-must-stay-fenced');
    const host = readFileSync(
      resolve(__dirname, '../../../../desktop_flutter/lib/features/agents/mcp_apps/mcp_app_readonly_host.dart'),
      'utf8',
    );
    expect(host.toLowerCase()).not.toContain('dashboard');
  });
});
