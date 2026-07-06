import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerAgentApprovalTools } from '../agentApprovals.js';

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

const AGENT_URL = 'http://localhost:4001';

function makeFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => body,
  });
}

describe('registerAgentApprovalTools', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to /agent-approvals and tells the agent to stop when status is pending', async () => {
    const mockFetch = makeFetchOk({ id: 'appr-1', status: 'pending' });
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentApprovalTools(server as any, AGENT_URL);

    const result = await tools.get('rhythm_request_approval')!.handler({
      action: 'Schedule Jane Doe',
      preview: 'Add Jane to Worship Leader slot',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_URL}/agent-approvals`);
    expect(JSON.parse(init.body as string)).toMatchObject({ action: 'Schedule Jane Doe' });
    expect(result.content[0].text).toMatch(/pending/i);
    expect(result.content[0].text).toMatch(/stop/i);
  });

  it('tells the agent it may proceed when the profile auto-approved', async () => {
    const mockFetch = makeFetchOk({ id: 'appr-2', status: 'approved' });
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentApprovalTools(server as any, AGENT_URL);

    const result = await tools.get('rhythm_request_approval')!.handler({
      action: 'Send reminder email',
    });

    expect(result.content[0].text).toMatch(/approved automatically/i);
    expect(result.content[0].text).toMatch(/may proceed/i);
  });

  it('returns a tool error when the agent server responds with a non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'action is required' }),
      }),
    );

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentApprovalTools(server as any, AGENT_URL);

    const result = await tools.get('rhythm_request_approval')!.handler({ action: '' });

    expect(result.isError).toBe(true);
  });
});
