import { afterEach, describe, expect, it, vi } from 'vitest';

import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { registerAgentApprovalTools } from '../../tools/agentApprovals.js';
import { registerAgentDelegationTools } from '../../tools/agentDelegation.js';

type ToolHandler = (
  args: Record<string, unknown>,
  extra: { _meta?: Record<string, unknown> },
) => Promise<unknown>;

class FakeServer {
  registered = new Map<string, ToolHandler>();

  tool(
    name: string,
    _description: string,
    _schema: unknown,
    handler: ToolHandler,
  ) {
    this.registered.set(name, handler);
  }
}

const toolExtra = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: 'sdk-interactive-bypass',
      turnId: 'turn-bypass-write',
      agentName: 'manager',
      toolCallId: 'call-bypass-write',
    },
  },
};

describe('issue #1392 MCP bypass approval behavior', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('issue-1392-c12: not_required approval result proceeds to async delegation without approval_id', async () => {
    // Regression caught: even after the authoritative API exempts bypass mode,
    // the MCP surface can still stop or invent an approval token rather than
    // proceeding with the original delegation arguments.
    const gateFetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/agent-approvals')) {
        return new Response(
          JSON.stringify({ status: 'not_required', reason: 'permission_mode_bypass' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/agent-approvals/consume')) {
        return new Response(
          JSON.stringify({ allowed: true, consumed: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', gateFetch);

    const approvalServer = new FakeServer();
    registerAgentApprovalTools(approvalServer as never, 'http://agent');
    const approvalResult = await approvalServer.registered.get(
      'rhythm_request_approval',
    )!(
      {
        action: 'Delegate verification',
        security_action: 'delegation.start-async',
        security_payload: {
          targetAgentConfigId: 'failure-triage',
          prompt: 'Re-run verification.',
        },
      },
      toolExtra,
    );
    expect(approvalResult).toMatchObject({
      content: [
        {
          text: expect.stringMatching(/No approval is required.*proceed/i),
        },
      ],
    });

    const delegatePost = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: 'child-bypass', status: 'dispatched' }),
    });
    const delegationServer = new FakeServer();
    registerAgentDelegationTools(
      delegationServer as never,
      'http://agent',
      'token',
      delegatePost as never,
    );
    const result = await delegationServer.registered.get(
      'rhythm_delegate_async',
    )!(
      {
        targetAgentConfigId: 'failure-triage',
        prompt: 'Re-run verification.',
      },
      toolExtra,
    );

    expect(delegatePost).toHaveBeenCalledOnce();
    const posted = JSON.parse(
      String(delegatePost.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(posted).not.toHaveProperty('approval_id');
    expect(posted).toMatchObject({
      targetAgentConfigId: 'failure-triage',
      prompt: 'Re-run verification.',
      callerSdkSessionId: 'sdk-interactive-bypass',
    });
    expect(result).not.toMatchObject({ isError: true });
  });
});
