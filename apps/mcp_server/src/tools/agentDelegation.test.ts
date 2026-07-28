import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAgentDelegationTools } from "./agentDelegation";
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from "../security/security_context.js";

type ToolHandler = (
  args: Record<string, unknown>,
  extra?: unknown,
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

describe("rhythm_delegate MCP tool", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("issue-P4-manager-delegation-c5: posts delegation request", async () => {
    // Regression caught: the tool is registered under the wrong name or posts to
    // the wrong local endpoint, so manager profiles cannot delegate live.
    const server = new FakeServer();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: "delegate-session",
        output: "delegated result",
        targetAgentConfigId: "coding-agent",
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ allowed: true, consumed: false }),
      })),
    );

    registerAgentDelegationTools(
      server as never,
      "http://localhost:4001",
      "token",
      fetchMock as never,
    );

    const handler = server.registered.get("rhythm_delegate");
    expect(handler).toBeDefined();

    const response = await handler!(
      {
        targetAgentConfigId: "coding-agent",
        prompt: "Handle this issue.",
        callerSessionId: "manager-session",
      },
      {
        _meta: {
          [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
            sdkSessionId: "sdk-delegation-test",
            turnId: "turn-delegation-test",
            agentName: "secretary",
            toolCallId: "call-delegation-test",
          },
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4001/agent-delegation/delegate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer token",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          targetAgentConfigId: "coding-agent",
          prompt: "Handle this issue.",
          callerSessionId: "manager-session",
        }),
      }),
    );
    expect(response).toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining("delegated result"),
        },
      ],
    });
  });
});
