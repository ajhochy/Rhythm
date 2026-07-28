import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerAgentProfileTools } from '../agentProfiles.js';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';

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

const AGENT_URL = 'http://localhost:4001';
const SECURITY_EXTRA = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: 'sdk-agent-profiles-test',
      turnId: 'turn-agent-profiles-test',
      agentName: 'dev',
      toolCallId: 'call-agent-profiles-test',
    },
  },
};

function securityAwareFetch(
  ...responses: Array<{ ok: boolean; status: number; json: () => Promise<unknown> }>
) {
  let responseIndex = 0;
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/agent-approvals/consume')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ allowed: true, consumed: false }),
      };
    }
    if (url.endsWith('/agent-approvals/external-content/taint')) {
      return {
        ok: true,
        status: 201,
        json: async () => ({ taintId: 'profile-test-taint' }),
      };
    }
    return responses[responseIndex++];
  });
}

function apiCalls(mockFetch: ReturnType<typeof vi.fn>) {
  return mockFetch.mock.calls.filter(
    ([input]) => !String(input).includes('/agent-approvals/'),
  );
}

describe('registerAgentProfileTools', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /agent-configs with the given label, MCPs, skills, and model', async () => {
    const mockFetch = securityAwareFetch({
      ok: true,
      status: 201,
      json: async () => ({ id: 'cfg-1', label: 'Sunday Bulletin Assistant' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentProfileTools(server as any, AGENT_URL);

    const result = await tools.get('rhythm_create_agent_profile')!.handler(
      {
        label: 'Sunday Bulletin Assistant',
        systemPrompt: 'You help draft the Sunday bulletin.',
        allowedMcps: ['rhythm', 'pco-services'],
        allowedSkills: ['bulletin-formatting'],
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
      },
      SECURITY_EXTRA,
    );

    const [url, init] = apiCalls(mockFetch)[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_URL}/agent-configs`);
    const body = JSON.parse(init.body as string);
    expect(body.label).toBe('Sunday Bulletin Assistant');
    expect(body.allowedMcpsJson).toBe('["rhythm","pco-services"]');
    expect(body.allowedSkillsJson).toBe('["bulletin-formatting"]');
    expect(body.modelProvider).toBe('anthropic');
    expect(result.content[0].text).toContain('Sunday Bulletin Assistant');
    expect(result.content[0].text).toContain('cfg-1');
  });

  it('omits allowedMcpsJson/allowedSkillsJson when unrestricted (no lists given)', async () => {
    const mockFetch = securityAwareFetch({
      ok: true,
      status: 201,
      json: async () => ({ id: 'cfg-2', label: 'General Helper' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentProfileTools(server as any, AGENT_URL);

    await tools
      .get('rhythm_create_agent_profile')!
      .handler({ label: 'General Helper' }, SECURITY_EXTRA);

    const [, init] = apiCalls(mockFetch)[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.allowedMcpsJson).toBeUndefined();
    expect(body.allowedSkillsJson).toBeUndefined();
  });

  it('returns a tool error when the agent server rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      securityAwareFetch({
        ok: false,
        status: 400,
        json: async () => ({ error: 'label must be a non-empty string' }),
      }),
    );

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentProfileTools(server as any, AGENT_URL);

    const result = await tools
      .get('rhythm_create_agent_profile')!
      .handler({ label: '' }, SECURITY_EXTRA);

    expect(result.isError).toBe(true);
  });

  it('lists only permission fields for profile repair audits', async () => {
    vi.stubGlobal(
      'fetch',
      securityAwareFetch({
        ok: true,
        status: 200,
        json: async () => [{ id: 'config-doctor', label: 'Config Doctor', systemPrompt: 'secret-ish', corePermissionsJson: '{"bash":"ask"}' }],
      }),
    );

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentProfileTools(server as any, AGENT_URL);

    const result = await tools
      .get('rhythm_list_agent_profile_permissions')!
      .handler({}, SECURITY_EXTRA);

    expect(result.content[0].text).toContain('corePermissionsJson');
    expect(result.content[0].text).not.toContain('systemPrompt');
  });

  it('patches only supplied permission fields and resyncs the profile file', async () => {
    const mockFetch = securityAwareFetch(
      {
        ok: true,
        status: 200,
        json: async () => ({ id: 'Theological-Researcher', label: 'Theological Researcher', corePermissionsJson: '{"skill":"allow","read":"allow","bash":"ask"}' }),
      },
      { ok: true, status: 200, json: async () => ({}) },
    );
    vi.stubGlobal('fetch', mockFetch);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentProfileTools(server as any, AGENT_URL);

    const result = await tools.get('rhythm_update_agent_profile_permissions')!.handler(
      {
        id: 'Theological-Researcher',
        corePermissionsJson: '{"skill":"allow","read":"allow","bash":"ask"}',
      },
      SECURITY_EXTRA,
    );

    expect(mockFetch).toHaveBeenCalledWith(`${AGENT_URL}/agent-configs/Theological-Researcher`, expect.objectContaining({ method: 'PATCH' }));
    const [, init] = apiCalls(mockFetch)[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      corePermissionsJson: '{"skill":"allow","read":"allow","bash":"ask"}',
    });
    expect(mockFetch).toHaveBeenCalledWith(`${AGENT_URL}/agent-configs/Theological-Researcher/resync-agent-file`, { method: 'POST' });
    expect(result.content[0].text).toContain('corePermissionsJson');
  });
});
