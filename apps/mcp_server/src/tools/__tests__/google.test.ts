import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerGoogleTools } from '../google.js';

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

function makeFetch409() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ error: 'scope upgrade needed' }),
  });
}

describe('registerGoogleTools — rhythm_list_calendar_events', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('(a) GETs /integrations/google/calendar/events with calendarId=primary by default', async () => {
    const mockFetch = makeFetchOk([]);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerGoogleTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_list_calendar_events')!.handler({});

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/integrations/google/calendar/events?calendarId=primary`);
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${API_TOKEN}`);
  });

  it('(b) passes a custom calendar_id when provided', async () => {
    const mockFetch = makeFetchOk([]);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerGoogleTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_list_calendar_events')!.handler({ calendar_id: 'work@example.com' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('calendarId=work%40example.com');
  });

  it('(c) returns JSON text on success', async () => {
    const events = [{ id: '1', summary: 'Staff Meeting' }];
    const mockFetch = makeFetchOk(events);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerGoogleTools(server as any, API_URL, API_TOKEN);

    const res = await tools.get('rhythm_list_calendar_events')!.handler({});

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain('Staff Meeting');
  });

  it('(d) returns isError with "Enable Google tools" message on HTTP 409', async () => {
    const mockFetch = makeFetch409();
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerGoogleTools(server as any, API_URL, API_TOKEN);

    const res = await tools.get('rhythm_list_calendar_events')!.handler({});

    expect(res.isError).toBe(true);
    expect(res.content[0].text.toLowerCase()).toContain('google tools');
    expect(res.content[0].text.toLowerCase()).toContain('enable');
  });

  it('(e) returns isError (not 409 message) on other non-ok responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerGoogleTools(server as any, API_URL, API_TOKEN);

    const res = await tools.get('rhythm_list_calendar_events')!.handler({});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Rhythm API error 500');
  });
});

describe('registerGoogleTools — rhythm_search_gmail', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('(a) GETs /integrations/google/gmail/search with encoded query', async () => {
    const mockFetch = makeFetchOk({ messages: [] });
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerGoogleTools(server as any, API_URL, API_TOKEN);

    await tools.get('rhythm_search_gmail')!.handler({ query: 'from:boss is:unread' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/integrations/google/gmail/search');
    expect(url).toContain('from%3Aboss');
  });

  it('(b) returns isError with "Enable Google tools" message on HTTP 409', async () => {
    const mockFetch = makeFetch409();
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerGoogleTools(server as any, API_URL, API_TOKEN);

    const res = await tools.get('rhythm_search_gmail')!.handler({ query: 'test' });

    expect(res.isError).toBe(true);
    expect(res.content[0].text.toLowerCase()).toContain('google tools');
    expect(res.content[0].text.toLowerCase()).toContain('enable');
  });
});
