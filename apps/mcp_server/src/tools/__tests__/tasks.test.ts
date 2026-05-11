import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerTaskTools } from '../tasks.js';

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

describe('registerTaskTools — rhythm_list_tasks', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('(a) forwards scheduled_before as a query string param', async () => {
    const mockFetch = makeFetchOk([]);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTaskTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_list_tasks')!.handler({ scheduled_before: '2025-05-15' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('scheduled_before=2025-05-15');
  });

  it('(b) forwards overdue=true as a query string param when overdue is true', async () => {
    const mockFetch = makeFetchOk([]);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTaskTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_list_tasks')!.handler({ overdue: true });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('overdue=true');
  });

  it('(c) forwards overdue=false explicitly when overdue is false', async () => {
    const mockFetch = makeFetchOk([]);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTaskTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_list_tasks')!.handler({ overdue: false });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('overdue=false');
  });

  it('(d) omits overdue param when not provided', async () => {
    const mockFetch = makeFetchOk([]);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTaskTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_list_tasks')!.handler({ status: 'open' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('overdue');
  });

  it('(e) omits scheduled_before param when not provided', async () => {
    const mockFetch = makeFetchOk([]);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTaskTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_list_tasks')!.handler({ status: 'open' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('scheduled_before');
  });

  it('(f) still forwards existing due_before and search params alongside new params', async () => {
    const mockFetch = makeFetchOk([]);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTaskTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_list_tasks')!.handler({
      due_before: '2025-06-01',
      scheduled_before: '2025-05-20',
      overdue: true,
      search: 'bulletin',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('due_before=2025-06-01');
    expect(url).toContain('scheduled_before=2025-05-20');
    expect(url).toContain('overdue=true');
    expect(url).toContain('search=bulletin');
  });

  it('(g) returns isError: true on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTaskTools(server as any, API_URL, API_TOKEN);

    const res = await tools.get('rhythm_list_tasks')!.handler({});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Rhythm API error 500');
  });
});
