import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerPcoTools } from '../pco.js';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';

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
    tool(name: string, description: string, shape: Record<string, unknown>, handler: ToolHandler) {
      tools.set(name, { name, description, shape, handler });
    },
  };
  return { server, tools };
}

const API_URL = 'http://x';
const API_TOKEN = 'tok';
const AGENT_URL = 'http://agent';
const EXTRA = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: 'sdk-pco-test',
      turnId: 'turn-pco-test',
      agentName: 'church-admin',
      toolCallId: 'call-pco-test',
    },
  },
};

function makeFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

function makeFetch403() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ error: 'Forbidden' }),
  });
}

describe('registerPcoTools — rhythm_pco_list_plans', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the correct broker URL with Bearer token and returns JSON as tool text', async () => {
    const plans = [{ id: '1', title: 'June 22 Service' }];
    const mockFetch = makeFetchOk(plans);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerPcoTools(server as any, API_URL, API_TOKEN, AGENT_URL);

    const res = await tools.get('rhythm_pco_list_plans')!.handler({ service_type_id: '123' }, EXTRA);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url, init] = mockFetch.mock.calls.find(([candidate]) =>
      String(candidate).includes('/integrations/planning-center/api/service-types/123/plans')) as [string, RequestInit];
    expect(url).toBe('http://x/integrations/planning-center/api/service-types/123/plans');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain('June 22 Service');
  });

  it('returns a friendly isError result when the API responds with HTTP 403', async () => {
    const mockFetch = makeFetch403();
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerPcoTools(server as any, API_URL, API_TOKEN, AGENT_URL);

    const res = await tools.get('rhythm_pco_list_plans')!.handler({ service_type_id: '123' });

    expect(res.isError).toBe(true);
    expect(res.content[0].text.toLowerCase()).toContain('planning center');
    // Should NOT surface a raw stack or "Rhythm API error 403" verbatim
    expect(res.content[0].text).not.toContain('Rhythm API error 403');
  });
});

describe('registerPcoTools — rhythm_pco_list_service_types', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the service-types broker endpoint and returns results', async () => {
    const serviceTypes = [{ id: '5', name: 'Sunday Morning' }];
    const mockFetch = makeFetchOk(serviceTypes);
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerPcoTools(server as any, API_URL, API_TOKEN, AGENT_URL);

    const res = await tools.get('rhythm_pco_list_service_types')!.handler({}, EXTRA);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url] = mockFetch.mock.calls.find(([candidate]) =>
      String(candidate).includes('/integrations/planning-center/api/service-types')) as [string, RequestInit];
    expect(url).toBe('http://x/integrations/planning-center/api/service-types');

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain('Sunday Morning');
  });
});
