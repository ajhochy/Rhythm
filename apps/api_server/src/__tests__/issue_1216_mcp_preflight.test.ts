/**
 * Contract for #1216. Regressions caught here:
 * - required failed/disabled/missing MCPs must not reach session creation;
 * - optional unhealthy MCPs must not block a run;
 * - failures must tell an operator how to remediate the specific state.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createSession, prompt, abortSession, listMcp } = vi.hoisted(() => ({
  createSession: vi.fn(),
  prompt: vi.fn(),
  abortSession: vi.fn(),
  listMcp: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession,
    prompt,
    abortSession,
    listMcp,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { run } from '../services/agent_runner';

describe('#1216 required-MCP scheduled-run preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSession.mockResolvedValue({ id: 'sdk-session-1216' });
    prompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-1216' },
      parts: [{ type: 'text', text: 'done' }],
    });
    abortSession.mockResolvedValue(true);
  });

  it.each([
    ['failed', /failed.*check.*server configuration|server configuration.*failed/i],
    ['disabled', /disabled.*enable|enable.*disabled/i],
  ])(
    'issue-1216-c1: rejects a required MCP whose live status is %s before session creation',
    async (status, remediation) => {
      listMcp.mockResolvedValue({
        rhythm: { status: 'connected' },
        'pco-services': { status, error: 'test-only backend detail' },
      });

      const result = await run({
        prompt: 'Prepare the service',
        scheduledTaskId: 'scheduled-1216',
        allowedMcpsJson: JSON.stringify(['rhythm', 'pco-services']),
      });

      expect(result.status).toBe('error');
      expect(result.error).toMatch(/pco-services/);
      expect(result.error).toMatch(remediation);
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('issue-1216-c2: rejects a required MCP missing from the live status map with configuration remediation', async () => {
    listMcp.mockResolvedValue({ rhythm: { status: 'connected' } });

    const result = await run({
      prompt: 'Prepare the service',
      scheduledTaskId: 'scheduled-1216',
      allowedMcpsJson: JSON.stringify(['rhythm', 'missing-server']),
    });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/missing-server/);
    expect(result.error).toMatch(/add|configure/i);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('issue-1216-c3: ignores an unhealthy optional MCP that is not required by the run scope', async () => {
    listMcp.mockResolvedValue({
      rhythm: { status: 'connected' },
      'optional-mail': { status: 'failed', error: 'not used by this run' },
    });

    const result = await run({
      prompt: 'Run without mail',
      scheduledTaskId: 'scheduled-1216',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    expect(result.status).toBe('done');
    expect(createSession).toHaveBeenCalledOnce();
  });
});
