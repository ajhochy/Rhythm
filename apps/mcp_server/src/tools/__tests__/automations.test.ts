import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../api_client.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  toolResult: (text: string) => ({ content: [{ type: 'text' as const, text }] }),
  toolError: (err: unknown) => ({
    content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true as const,
  }),
  decodeHtml: (s: string) =>
    s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'"),
}));

import { apiGet, apiPost, apiPatch, apiDelete } from '../../api_client.js';
import { registerAutomationTools } from '../automations.js';

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

const EXPECTED_TOOL_NAMES = [
  'rhythm_list_automations',
  'rhythm_get_automation',
  'rhythm_create_automation',
  'rhythm_update_automation',
  'rhythm_delete_automation',
  'rhythm_preview_automation',
  'rhythm_resync_automation',
  'rhythm_list_automation_triggers',
  'rhythm_list_automation_actions',
  'rhythm_list_automation_providers',
];

describe('registerAutomationTools', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPatch).mockReset();
    vi.mocked(apiDelete).mockReset();
  });

  it('registers all 10 automation tools', () => {
    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAutomationTools(server as any, API_URL, API_TOKEN);
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(tools.has(name), `expected tool ${name} to be registered`).toBe(true);
    }
    expect(tools.size).toBe(EXPECTED_TOOL_NAMES.length);
  });

  describe('rhythm_list_automations', () => {
    it('calls apiGet with /automation-rules', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockResolvedValueOnce([]);
      await tools.get('rhythm_list_automations')!.handler({});
      expect(apiGet).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-rules');
    });

    it('filters client-side when enabled_only is true', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockResolvedValueOnce([
        { id: '1', enabled: true },
        { id: '2', enabled: false },
        { id: '3', enabled: true },
      ]);
      const res = await tools.get('rhythm_list_automations')!.handler({ enabled_only: true });
      const text = res.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveLength(2);
      expect(parsed.map((r: { id: string }) => r.id)).toEqual(['1', '3']);
    });

    it('does not filter when enabled_only is omitted', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockResolvedValueOnce([
        { id: '1', enabled: true },
        { id: '2', enabled: false },
      ]);
      const res = await tools.get('rhythm_list_automations')!.handler({});
      expect(JSON.parse(res.content[0].text)).toHaveLength(2);
    });
  });

  describe('rhythm_get_automation', () => {
    it('calls apiGet with /automation-rules/:id', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockResolvedValueOnce({ id: 'abc-123' });
      await tools.get('rhythm_get_automation')!.handler({ id: 'abc-123' });
      expect(apiGet).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-rules/abc-123');
    });
  });

  describe('rhythm_create_automation', () => {
    it('posts correct camelCase body and decodes name', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiPost).mockResolvedValueOnce({ id: 'new' });
      await tools.get('rhythm_create_automation')!.handler({
        name: 'A &amp; B',
        source: 'planning_center',
        trigger_key: 'planning_center.plan_upcoming',
        trigger_config: { lookaheadDays: 7 },
        action_type: 'create_task',
        action_config: { title: 'Prep' },
        conditions: [{ field: 'foo', operator: 'equals', value: 'bar' }],
        enabled: true,
        source_account_id: 'acct-1',
      });
      expect(apiPost).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-rules', {
        name: 'A & B',
        source: 'planning_center',
        triggerKey: 'planning_center.plan_upcoming',
        actionType: 'create_task',
        triggerConfig: { lookaheadDays: 7 },
        actionConfig: { title: 'Prep' },
        conditions: [{ field: 'foo', operator: 'equals', value: 'bar' }],
        enabled: true,
        sourceAccountId: 'acct-1',
      });
    });

    it('omits optional fields when not provided', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiPost).mockResolvedValueOnce({ id: 'new' });
      await tools.get('rhythm_create_automation')!.handler({
        name: 'X',
        source: 'rhythm',
        trigger_key: 'rhythm.task_created',
        action_type: 'send_notification',
      });
      const body = vi.mocked(apiPost).mock.calls[0][3] as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['actionType', 'name', 'source', 'triggerKey'].sort());
    });
  });

  describe('rhythm_update_automation', () => {
    it('only includes provided fields in PATCH body (camelCased)', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiPatch).mockResolvedValueOnce({ id: 'abc-123' });
      await tools.get('rhythm_update_automation')!.handler({
        id: 'abc-123',
        name: 'New &amp; Improved',
        enabled: false,
      });
      expect(apiPatch).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-rules/abc-123', {
        name: 'New & Improved',
        enabled: false,
      });
    });

    it('passes null for nullable fields when explicitly set to null', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiPatch).mockResolvedValueOnce({ id: 'abc-123' });
      await tools.get('rhythm_update_automation')!.handler({
        id: 'abc-123',
        trigger_config: null,
        source_account_id: null,
      });
      expect(apiPatch).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-rules/abc-123', {
        triggerConfig: null,
        sourceAccountId: null,
      });
    });
  });

  describe('rhythm_delete_automation', () => {
    it('calls apiDelete and returns id in result', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiDelete).mockResolvedValueOnce(undefined);
      const res = await tools.get('rhythm_delete_automation')!.handler({ id: 'abc-123' });
      expect(apiDelete).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-rules/abc-123');
      expect(res.content[0].text).toContain('abc-123');
    });
  });

  describe('rhythm_preview_automation', () => {
    it('calls apiGet with preview path', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockResolvedValueOnce({});
      await tools.get('rhythm_preview_automation')!.handler({ id: 'abc-123' });
      expect(apiGet).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-rules/abc-123/preview');
    });
  });

  describe('rhythm_resync_automation', () => {
    it('calls apiPost with resync path', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiPost).mockResolvedValueOnce({});
      await tools.get('rhythm_resync_automation')!.handler({ id: 'abc-123' });
      expect(apiPost).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-rules/abc-123/resync', {});
    });
  });

  describe('catalog tools', () => {
    it('rhythm_list_automation_triggers calls /automation-catalog/triggers', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockResolvedValueOnce([]);
      await tools.get('rhythm_list_automation_triggers')!.handler({});
      expect(apiGet).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-catalog/triggers');
    });

    it('rhythm_list_automation_actions calls /automation-catalog/actions', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockResolvedValueOnce([]);
      await tools.get('rhythm_list_automation_actions')!.handler({});
      expect(apiGet).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-catalog/actions');
    });

    it('rhythm_list_automation_providers calls /automation-catalog/providers', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockResolvedValueOnce([]);
      await tools.get('rhythm_list_automation_providers')!.handler({});
      expect(apiGet).toHaveBeenCalledWith(API_URL, API_TOKEN, '/automation-catalog/providers');
    });
  });

  describe('error path', () => {
    it('returns isError when apiGet throws', async () => {
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAutomationTools(server as any, API_URL, API_TOKEN);
      vi.mocked(apiGet).mockRejectedValueOnce(new Error('boom'));
      const res = await tools.get('rhythm_list_automations')!.handler({});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('boom');
    });
  });
});
