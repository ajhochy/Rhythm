import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerRhythmTools } from '../rhythms.js';

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

describe('registerRhythmTools', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  describe('rhythm_add_rhythm_step', () => {
    it('(a) issues POST to /recurring-rules/:id/steps with correct JSON body when day_of_week provided', async () => {
      const mockResponse = { id: 'step-1', title: 'Plan upcoming Sunday', day_of_week: 'Monday', sort_order: 0 };
      const mockFetch = makeFetchOk(mockResponse);
      vi.stubGlobal('fetch', mockFetch);

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerRhythmTools(server as any, API_URL, API_TOKEN);

      const res = await tools.get('rhythm_add_rhythm_step')!.handler({
        rhythm_id: 'r1',
        title: 'Plan upcoming Sunday',
        day_of_week: 'Monday',
        sort_order: 0,
      });

      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_URL}/recurring-rules/r1/steps`);
      expect(init.method).toBe('POST');

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({ title: 'Plan upcoming Sunday', day_of_week: 'Monday', sort_order: 0 });

      expect(res.content[0].text).toBe(JSON.stringify(mockResponse, null, 2));
    });

    it('(b) returns isError: true with "Rhythm API error 500" when fetch returns ok: false / status 500', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'boom' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerRhythmTools(server as any, API_URL, API_TOKEN);

      const res = await tools.get('rhythm_add_rhythm_step')!.handler({
        rhythm_id: 'r1',
        title: 'Plan upcoming Sunday',
        sort_order: 0,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Rhythm API error 500');
    });

    it('(c) omits day_of_week from request body when not provided', async () => {
      const mockResponse = { id: 'step-2', title: 'Review notes' };
      const mockFetch = makeFetchOk(mockResponse);
      vi.stubGlobal('fetch', mockFetch);

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerRhythmTools(server as any, API_URL, API_TOKEN);

      await tools.get('rhythm_add_rhythm_step')!.handler({
        rhythm_id: 'r2',
        title: 'Review notes',
        sort_order: 1,
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string);
      expect(Object.keys(parsedBody)).not.toContain('day_of_week');
    });
  });

  describe('rhythm_delete_rhythm_step', () => {
    it('(d) issues GET to fetch rhythm, then PATCH with filtered steps array that excludes removed step', async () => {
      const existingSteps = [
        { id: 'step-a', title: 'Step A', assigneeId: null, dayOfWeek: 1, dayOfMonth: null, month: null },
        { id: 'step-b', title: 'Step B', assigneeId: null, dayOfWeek: 2, dayOfMonth: null, month: null },
        { id: 'step-c', title: 'Step C', assigneeId: null, dayOfWeek: 3, dayOfMonth: null, month: null },
      ];

      const mockFetch = vi.fn()
        // First call: GET /recurring-rules/r1
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 'r1', steps: existingSteps }),
        })
        // Second call: PATCH /recurring-rules/r1
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 'r1', steps: [existingSteps[0], existingSteps[2]] }),
        });

      vi.stubGlobal('fetch', mockFetch);

      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerRhythmTools(server as any, API_URL, API_TOKEN);

      const res = await tools.get('rhythm_delete_rhythm_step')!.handler({
        rhythm_id: 'r1',
        step_id: 'step-b',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify GET call
      const [getUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(getUrl).toBe(`${API_URL}/recurring-rules/r1`);

      // Verify PATCH call
      const [patchUrl, patchInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(patchUrl).toBe(`${API_URL}/recurring-rules/r1`);
      expect(patchInit.method).toBe('PATCH');

      const patchBody = JSON.parse(patchInit.body as string);
      expect(patchBody.steps).toBeDefined();
      const stepIds = (patchBody.steps as Array<{ id: string }>).map(s => s.id);
      expect(stepIds).not.toContain('step-b');
      expect(stepIds).toContain('step-a');
      expect(stepIds).toContain('step-c');

      expect(res.content[0].text).toContain('step-b');
      expect(res.content[0].text).toContain('r1');
    });
  });
});
