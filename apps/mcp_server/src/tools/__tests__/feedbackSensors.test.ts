import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerFeedbackSensorTools } from '../feedbackSensors.js';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { UNTRUSTED_FENCE_OPEN } from '../../untrusted_context.js';

type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}>;

interface RegisteredTool {
  handler: ToolHandler;
}

function makeStubServer(): { server: unknown; tools: Map<string, RegisteredTool> } {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(name: string, _description: string, _shape: Record<string, unknown>, handler: ToolHandler) {
      tools.set(name, { handler });
    },
  };
  return { server, tools };
}

const API_URL = 'http://x';
const API_TOKEN = 'tok';
const SECURITY_EXTRA = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: 'sdk-feedback-test',
      turnId: 'turn-feedback-test',
      agentName: 'church-admin',
      toolCallId: 'call-feedback-test',
    },
  },
};

function makeFetchOk(body: unknown) {
  return vi.fn(async (input: string | URL) =>
    String(input).endsWith('/agent-approvals/external-content/taint')
      ? {
          ok: true,
          status: 201,
          json: async () => ({ taintId: 'feedback-test-taint' }),
        }
      : { ok: true, status: 200, json: async () => body },
  );
}

describe('registerFeedbackSensorTools', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  describe('rhythm_verify_pco_staffing', () => {
    it('PASSes when needed-positions is empty', async () => {
      vi.stubGlobal('fetch', makeFetchOk([]));
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerFeedbackSensorTools(server as any, API_URL, API_TOKEN);

      const result = await tools.get('rhythm_verify_pco_staffing')!.handler(
        {
          service_type_id: 'st1',
          plan_id: 'p1',
        },
        SECURITY_EXTRA,
      );

      expect(result.content[0].text).toContain(UNTRUSTED_FENCE_OPEN);
      expect(result.content[0].text).toContain('PASS:');
    });

    it('FAILs and lists unfilled positions when needed-positions is non-empty', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetchOk([{ teamPositionName: 'Worship Leader', quantity: 1 }]),
      );
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerFeedbackSensorTools(server as any, API_URL, API_TOKEN);

      const result = await tools.get('rhythm_verify_pco_staffing')!.handler(
        {
          service_type_id: 'st1',
          plan_id: 'p1',
        },
        SECURITY_EXTRA,
      );

      expect(result.content[0].text).toContain('FAIL:');
      expect(result.content[0].text).toContain('Worship Leader');
    });
  });

  describe('rhythm_verify_email_sent', () => {
    it('PASSes when a matching sent message is found', async () => {
      const mockFetch = makeFetchOk({ messages: [{ id: 'm1' }] });
      vi.stubGlobal('fetch', mockFetch);
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerFeedbackSensorTools(server as any, API_URL, API_TOKEN);

      const result = await tools
        .get('rhythm_verify_email_sent')!
        .handler({ query: 'Sunday reminder' }, SECURITY_EXTRA);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('in%3Asent');
      expect(result.content[0].text).toContain('PASS:');
    });

    it('FAILs when no matching sent message is found', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ messages: [] }));
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerFeedbackSensorTools(server as any, API_URL, API_TOKEN);

      const result = await tools
        .get('rhythm_verify_email_sent')!
        .handler({ query: 'nope' }, SECURITY_EXTRA);

      expect(result.content[0].text).toContain('FAIL:');
    });
  });

  describe('rhythm_verify_task_complete', () => {
    it('PASSes when the task status is done', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ status: 'done', title: 'Print bulletins' }));
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerFeedbackSensorTools(server as any, API_URL, API_TOKEN);

      const result = await tools
        .get('rhythm_verify_task_complete')!
        .handler({ task_id: 't1' }, SECURITY_EXTRA);

      expect(result.content[0].text).toContain('PASS:');
    });

    it('FAILs when the task status is not done', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ status: 'open', title: 'Print bulletins' }));
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerFeedbackSensorTools(server as any, API_URL, API_TOKEN);

      const result = await tools
        .get('rhythm_verify_task_complete')!
        .handler({ task_id: 't1' }, SECURITY_EXTRA);

      expect(result.content[0].text).toContain('FAIL:');
    });
  });
});
