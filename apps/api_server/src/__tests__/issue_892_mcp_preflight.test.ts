/**
 * #892 — AgentRunner MCP-auth preflight
 *
 * A specialist whose required MCP backend isn't authenticated (e.g.
 * worship-planning's all-pco-services toolset with no PCO OAuth configured)
 * used to hang all the way to the createSession/prompt() timeout race (up to
 * AGENT_RUN_TIMEOUT_MS, 600s default) before failing with a generic
 * UND_ERR_HEADERS_TIMEOUT. AgentRunner now checks the live MCP status map for
 * every server the run's role requires and fails fast with a clear message —
 * before createSession is ever called.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockCreateSession,
  mockPrompt,
  mockAbortSession,
  mockListMcp,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
  mockListMcp: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    abortSession: mockAbortSession,
    listMcp: mockListMcp,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { run } from '../services/agent_runner';

function makePromptResponse(text: string) {
  return {
    info: { sessionID: 'sess-1' },
    parts: [{ type: 'text', text }],
  };
}

describe('#892 — AgentRunner MCP-auth preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1' });
    mockPrompt.mockResolvedValue(makePromptResponse('Hello from agent'));
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails fast without creating a session when a required MCP server needs auth', async () => {
    mockListMcp.mockResolvedValue({ 'pco-services': { status: 'needs_auth' } });

    const result = await run({
      prompt: 'Check staffing',
      mcpRole: 'worship-planning',
      allowedMcpsJson: '{"pco-services":["get_plans"]}',
    });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/pco-services/);
    expect(result.error).toMatch(/connect it in Integrations/i);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('proceeds normally when all required MCP servers are authenticated', async () => {
    mockListMcp.mockResolvedValue({ 'pco-services': { status: 'connected' } });

    const result = await run({
      prompt: 'Check staffing',
      mcpRole: 'worship-planning',
      allowedMcpsJson: '{"pco-services":["get_plans"]}',
    });

    expect(result.status).toBe('done');
    expect(mockCreateSession).toHaveBeenCalledOnce();
  });

  it('fails open (does not block the run) when the readiness check itself throws', async () => {
    mockListMcp.mockRejectedValue(new Error('engine unavailable'));

    const result = await run({
      prompt: 'Check staffing',
      mcpRole: 'worship-planning',
      allowedMcpsJson: '{"pco-services":["get_plans"]}',
    });

    expect(result.status).toBe('done');
    expect(mockCreateSession).toHaveBeenCalledOnce();
  });

  it('does not call listMcp for a run with no MCP role/scope', async () => {
    await run({ prompt: 'Plain run, no role' });

    expect(mockListMcp).not.toHaveBeenCalled();
    expect(mockCreateSession).toHaveBeenCalledOnce();
  });
});
