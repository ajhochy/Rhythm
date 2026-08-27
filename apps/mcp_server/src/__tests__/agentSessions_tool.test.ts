/**
 * UNIT TEST — issue #806 (memory epic #801): rhythm_list_sessions MCP tool.
 *
 * The seeded "Memory Consolidation" task tells the agent to call
 * rhythm_list_sessions to read the past day's session messages. This tool must:
 *   AC1: list the LOCAL agent server's sessions (id, name, agentKind,
 *        lastActivityAt); given a sessionId, return that session's messages
 *        (id, role, body, createdAt) — matching :4001
 *        GET /agent-sessions(/:id/messages).
 *   AC2: resolve its base to localhost:4001 (the agent base it was registered
 *        with) — never the prod Settings URL.
 *
 * Real handler + a stub McpServer; fetch is stubbed so we can assert the URL
 * the tool actually hits and the shape it returns. No network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerAgentSessionTools } from "../tools/agentSessions.js";
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from "../security/security_context.js";
import {
  UNTRUSTED_FENCE_CLOSE,
  UNTRUSTED_FENCE_OPEN,
} from "../untrusted_context.js";

type ToolHandler = (
  args: Record<string, unknown>,
  extra?: unknown,
) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}>;

interface RegisteredTool {
  name: string;
  description: string;
  shape: Record<string, unknown>;
  handler: ToolHandler;
}

function makeStubServer(): {
  server: unknown;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(
      name: string,
      description: string,
      shape: Record<string, unknown>,
      handler: ToolHandler,
    ) {
      tools.set(name, { name, description, shape, handler });
    },
  };
  return { server, tools };
}

/** A fetch stub that records the URL it was called with and returns `body`. */
function makeFetchSpy(body: unknown) {
  const calls: string[] = [];
  const taintCalls: string[] = [];
  const fn = vi.fn((url: string) => {
    if (url.endsWith("/agent-approvals/external-content/taint")) {
      taintCalls.push(url);
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({ taintId: "test-taint" }),
      });
    }
    calls.push(url);
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
  return { fn, calls, taintCalls };
}

function parseFencedJson(text: string): unknown {
  const start = text.indexOf(UNTRUSTED_FENCE_OPEN);
  const end = text.indexOf(UNTRUSTED_FENCE_CLOSE);
  return JSON.parse(
    text.slice(start + UNTRUSTED_FENCE_OPEN.length, end).trim(),
  );
}

// The LOCAL agent base the tool is registered with in index.ts (#806).
const AGENT_URL = "http://localhost:4001";
const AGENT_TOKEN = "tok";
// A deliberately different prod URL to prove the tool never hits it.
const PROD_URL = "https://api.vcrcapps.com";
const SECURITY_EXTRA = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: "sdk-session-tool-test",
      turnId: "turn-session-tool-test",
      agentName: "org-optimizer",
      toolCallId: "call-session-tool-test",
    },
  },
};

describe("issue-806: rhythm_list_sessions lists sessions from the local agent base", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  // Regression caught: the tool returns the local agent server's sessions in
  // the documented field set. A handler that dropped the list / wrong fields
  // would fail.
  it("AC1: returns sessions (id, name, agentKind, lastActivityAt) from :4001", async () => {
    const { fn, calls } = makeFetchSpy({
      sessions: [
        {
          id: "ses-1",
          name: "Refactor tasks",
          agentKind: "claude-code",
          lastActivityAt: "2026-06-28T10:00:00.000Z",
          // Extra prod-y fields must be projected away.
          cwd: "/secret/path",
          sdkSessionId: "sdk-abc",
          children: [{
            id: "ses-child",
            name: "Delegated child",
            agentKind: "research",
            lastActivityAt: "2026-06-28T10:01:00.000Z",
          }],
        },
      ],
      resumable: [],
    });
    vi.stubGlobal("fetch", fn);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);

    const res = await tools
      .get("rhythm_list_sessions")!
      .handler({}, SECURITY_EXTRA);
    expect(res.isError).toBeUndefined();

    // AC2: the base is :4001, not prod.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${AGENT_URL}/agent-sessions`);
    expect(calls[0].startsWith("http://localhost:4001")).toBe(true);
    expect(calls[0]).not.toContain(PROD_URL);

    const parsed = parseFencedJson(res.content[0].text) as {
      sessions: Array<Record<string, unknown>>;
    };
    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.sessions[0]).toEqual({
      id: "ses-1",
      name: "Refactor tasks",
      agentKind: "claude-code",
      lastActivityAt: "2026-06-28T10:00:00.000Z",
    });
    // Private fields must not leak into the projection.
    expect(parsed.sessions[0]).not.toHaveProperty("cwd");
    expect(parsed.sessions[0]).not.toHaveProperty("sdkSessionId");
    expect(parsed.sessions[1]).toEqual({
      id: "ses-child",
      name: "Delegated child",
      agentKind: "research",
      lastActivityAt: "2026-06-28T10:01:00.000Z",
    });
  });

  // Regression caught: given a sessionId the tool must hit the messages
  // sub-route and return message bodies (the consolidation read).
  it("AC1: given a sessionId, returns that session's messages (id, role, body, createdAt)", async () => {
    const { fn, calls } = makeFetchSpy({
      messages: [
        {
          id: 1,
          sessionId: "ses-1",
          role: "input",
          rawText: "raw question",
          strippedText: "What time is rehearsal?",
          createdAt: "2026-06-28T09:00:00.000Z",
        },
        {
          id: 2,
          sessionId: "ses-1",
          role: "output",
          rawText: "Rehearsal is at 6pm.",
          strippedText: "",
          createdAt: "2026-06-28T09:00:05.000Z",
        },
      ],
    });
    vi.stubGlobal("fetch", fn);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);

    const res = await tools
      .get("rhythm_list_sessions")!
      .handler({ sessionId: "ses-1" }, SECURITY_EXTRA);
    expect(res.isError).toBeUndefined();

    // AC2: hits the :4001 messages sub-route, not prod.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${AGENT_URL}/agent-sessions/ses-1/messages`);
    expect(calls[0].startsWith("http://localhost:4001")).toBe(true);
    expect(calls[0]).not.toContain(PROD_URL);

    const parsed = parseFencedJson(res.content[0].text) as {
      sessionId: string;
      messages: Array<Record<string, unknown>>;
    };
    expect(parsed.sessionId).toBe("ses-1");
    expect(parsed.messages).toHaveLength(2);
    // strippedText preferred as the body; rawText falls back when stripped empty.
    expect(parsed.messages[0]).toEqual({
      id: 1,
      role: "input",
      body: "What time is rehearsal?",
      createdAt: "2026-06-28T09:00:00.000Z",
    });
    expect(parsed.messages[1].body).toBe("Rehearsal is at 6pm.");
  });

  // FALSIFICATION: if the tool were coupled to the prod Settings URL (the bug
  // #804 fixed for memory and this issue must avoid for sessions), registering
  // it with the prod base would make it hit prod. We register with :4001 and
  // assert the call target is :4001 — and additionally prove that registering
  // with a prod base would change the target (so the assertion is meaningful).
  it("FALSIFY: the resolved base is whatever it is registered with — :4001 here, provably not prod", async () => {
    // Registered with the local agent base → call must hit :4001.
    {
      const { fn, calls } = makeFetchSpy({ sessions: [] });
      vi.stubGlobal("fetch", fn);
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);
      await tools.get("rhythm_list_sessions")!.handler({}, SECURITY_EXTRA);
      expect(calls[0]).toBe(`${AGENT_URL}/agent-sessions`);
    }
    // Control: registered with prod → would hit prod. Proves the call target
    // tracks the injected base, so the :4001 assertion above is load-bearing.
    {
      const { fn, calls } = makeFetchSpy({ sessions: [] });
      vi.stubGlobal("fetch", fn);
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAgentSessionTools(server as any, PROD_URL, AGENT_TOKEN);
      await tools.get("rhythm_list_sessions")!.handler({}, SECURITY_EXTRA);
      expect(calls[0]).toBe(`${PROD_URL}/agent-sessions`);
    }
    // index.ts wires registerAgentSessionTools(server, RHYTHM_AGENT_URL, ...),
    // and RHYTHM_AGENT_URL defaults to http://localhost:4001 — so production
    // wiring uses the local base.
  });

  // #1302 — rhythm_list_sessions reads Rhythm's own session transcripts
  // (first-party data), not genuinely external content. It must still fence
  // the result for the model (defense in depth), but must NOT arm the
  // outbound-write approval gate the way gmail/web/PCO reads do — that gate
  // being armed unconditionally is exactly what stalled Memory Consolidation
  // every night with nobody awake to approve it.
  it("#1302: fences the result but does not record an external-content taint", async () => {
    const { fn, calls, taintCalls } = makeFetchSpy({
      sessions: [
        {
          id: "ses-1",
          name: "Refactor tasks",
          agentKind: "claude-code",
          lastActivityAt: "2026-06-28T10:00:00.000Z",
        },
      ],
      resumable: [],
    });
    vi.stubGlobal("fetch", fn);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);

    const res = await tools
      .get("rhythm_list_sessions")!
      .handler({}, SECURITY_EXTRA);
    expect(res.isError).toBeUndefined();

    // Still fenced for the model — defense in depth is unchanged.
    expect(res.content[0].text).toContain(UNTRUSTED_FENCE_OPEN);
    expect(res.content[0].text).toContain(UNTRUSTED_FENCE_CLOSE);

    // But no approval-gate taint was recorded for this read.
    expect(taintCalls).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });
});
