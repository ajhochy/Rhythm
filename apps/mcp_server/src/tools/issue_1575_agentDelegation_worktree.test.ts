import { describe, expect, it, vi } from 'vitest';
import { registerAgentDelegationTools } from './agentDelegation';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../security/security_context.js';

type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<unknown>;
class FakeServer {
  registered = new Map<string, ToolHandler>();
  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler) {
    this.registered.set(name, handler);
  }
}

describe('issue #1575 — async delegation MCP worktree contract', () => {
  it('issue-1575-c1: forwards isolateWorktree and optional worktreeName unchanged to the server', async () => {
    // Regression caught: the model can request isolation but the MCP boundary
    // drops either field before the server can create the worktree.
    const server = new FakeServer();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'dispatched' }) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ allowed: true }) }));
    registerAgentDelegationTools(server as never, 'http://127.0.0.1:4298', 'token', fetchMock as never);

    await server.registered.get('rhythm_delegate_async')!(
      { targetAgentConfigId: 'specialist', prompt: 'Inspect cwd.', isolateWorktree: true, worktreeName: 'issue-1575-child' },
      { _meta: { [RHYTHM_SECURITY_CONTEXT_META_KEY]: { sdkSessionId: 'sdk-parent', turnId: 'turn', agentName: 'manager', toolCallId: 'call' } } },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      isolateWorktree: true,
      worktreeName: 'issue-1575-child',
      callerSdkSessionId: 'sdk-parent',
    });
  });
});
