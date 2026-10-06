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
    if (url.endsWith("/agent-approvals/consume")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ allowed: true }) });
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

const SIGNED_SECURITY_EXTRA = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: "sdk-session-tool-test",
      turnId: "turn-session-tool-test",
      agentName: "org-optimizer",
      toolCallId: "call-session-tool-test",
      proof: {
        version: 1 as const,
        algorithm: "Ed25519" as const,
        keyId: "fixture-key",
        issuedAt: Date.now(),
        nonce: "fixture-nonce",
        toolName: "rhythm_prompt_session",
        argumentsHash: "fixture-hash",
        signature: "fixture-signature",
      },
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
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(`${AGENT_URL}/agent-sessions?scope=chats&limit=25`);
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

  it("coordinator-sessions-c1: default view includes bounded recent rows and the trusted caller's nested blockers", async () => {
    const calls: string[] = [];
    const current = {
      id: "local-secretary", sdkSessionId: "sdk-session-tool-test", name: "Rhythm Coordinator",
      agentKind: "secretary", status: "working", parentSessionId: null,
      lastActivityAt: "2026-10-06T19:00:00.000Z",
    };
    const manager = {
      id: "local-manager", sdkSessionId: "sdk-manager", name: "Workflow Manager",
      agentKind: "workflow-orchestrator", status: "working", parentSessionId: current.id,
      lastActivityAt: "2026-10-06T19:01:00.000Z",
    };
    const planner = {
      id: "local-planner", sdkSessionId: "sdk-planner", name: "Planning Agent",
      agentKind: "planning-agent", status: "working", parentSessionId: manager.id,
      lastActivityAt: "2026-10-06T19:02:00.000Z",
    };
    const failedExplore = {
      id: "local-explore", sdkSessionId: "sdk-explore", name: "Explore child",
      agentKind: "explore", status: "error", parentSessionId: planner.id,
      lastActivityAt: "2026-10-06T19:03:00.000Z",
    };
    const page = (sessions: unknown[], hasMore = false) => ({
      sessions, ancestors: [],
      pageInfo: { limit: 25, hasMore, nextCursor: null, expiresAt: "2026-10-06T20:00:00.000Z" },
    });
    const fn = vi.fn(async (rawUrl: string) => {
      calls.push(rawUrl);
      const url = new URL(rawUrl);
      let body: unknown;
      if (url.pathname !== "/agent-sessions") body = {};
      else if (url.searchParams.get("search") === "sdk-session-tool-test") body = page([current]);
      else if (url.searchParams.get("parentId") === current.id) body = page([manager]);
      else if (url.searchParams.get("parentId") === manager.id) body = page([planner]);
      else if (url.searchParams.get("parentId") === planner.id) body = page([failedExplore]);
      else if (url.searchParams.get("parentId") === failedExplore.id) body = page([]);
      else body = page([{
        id: "recent-root", sdkSessionId: "sdk-recent", name: "Recent work",
        agentKind: "claude-code", status: "idle", parentSessionId: null,
        lastActivityAt: "2026-10-06T18:00:00.000Z",
      }]);
      return { ok: true, status: 200, json: async () => body };
    });
    vi.stubGlobal("fetch", fn);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);
    const res = await tools.get("rhythm_list_sessions")!.handler({}, SECURITY_EXTRA);
    expect(res.isError).toBeUndefined();

    const parsed = parseFencedJson(res.content[0].text) as {
      sessions: Array<Record<string, unknown>>;
      currentWork: { state: string; truncated: boolean; sessions: Array<Record<string, unknown>> };
    };
    expect(parsed.sessions.map((row) => row.id)).toContain("recent-root");
    expect(parsed.currentWork).toMatchObject({ state: "available", truncated: false });
    expect(parsed.currentWork.sessions.map((row) => row.id)).toEqual([
      "local-secretary", "local-manager", "local-planner", "local-explore",
    ]);
    expect(parsed.currentWork.sessions.at(-1)).toMatchObject({
      status: "error", parentSessionId: "local-planner", sdkSessionId: "sdk-explore",
    });
    expect(calls.some((url) => new URL(url).searchParams.get("search") === "sdk-session-tool-test")).toBe(true);
    expect(calls.some((url) => new URL(url).searchParams.get("parentId") === "local-planner")).toBe(true);
  });

  it("coordinator-sessions-c2: bounded search preserves ancestors, status, and cursor metadata", async () => {
    const calls: string[] = [];
    const fn = vi.fn(async (rawUrl: string) => {
      calls.push(rawUrl);
      const url = new URL(rawUrl);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sessions: [{
            id: "matching-child", sdkSessionId: "sdk-match", name: "Planning Agent",
            agentKind: "planning-agent", status: "error", parentSessionId: "matching-parent",
            lastActivityAt: "2026-10-06T19:02:00.000Z",
          }],
          ancestors: [{
            id: "matching-parent", sdkSessionId: "sdk-parent", name: "Workflow Manager",
            agentKind: "workflow-orchestrator", status: "working", parentSessionId: null,
            lastActivityAt: "2026-10-06T19:01:00.000Z",
          }],
          pageInfo: { limit: 5, hasMore: true, nextCursor: "next-page", expiresAt: "2026-10-06T20:00:00.000Z" },
        }),
      };
    });
    vi.stubGlobal("fetch", fn);
    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);

    const res = await tools.get("rhythm_list_sessions")!.handler(
      { search: "Planning Agent", limit: 5, cursor: "prior-page" }, SECURITY_EXTRA,
    );
    expect(res.isError).toBeUndefined();
    const parsed = parseFencedJson(res.content[0].text) as {
      sessions: Array<Record<string, unknown>>;
      pageInfo: { hasMore: boolean; nextCursor: string | null };
    };
    expect(parsed.sessions.map((row) => row.id)).toEqual(["matching-parent", "matching-child"]);
    expect(parsed.sessions[1]).toMatchObject({ status: "error", parentSessionId: "matching-parent" });
    expect(parsed.pageInfo).toEqual(expect.objectContaining({ hasMore: true, nextCursor: "next-page" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("search=Planning+Agent");
    expect(calls[0]).toContain("limit=5");
    expect(calls[0]).toContain("cursor=prior-page");
  });

  it("coordinator-sessions-c3: a partial child page reports that current work is incomplete", async () => {
    const fn = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      const sessions = url.searchParams.get("search") === "sdk-session-tool-test"
        ? [{
          id: "local-secretary", sdkSessionId: "sdk-session-tool-test", projectId: null,
          name: "Rhythm Coordinator", agentKind: "secretary", status: "working",
          parentSessionId: null, hasChildren: true, childCount: 4,
        }]
        : url.searchParams.get("parentId") === "local-secretary"
          ? [{
            id: "local-manager", sdkSessionId: "sdk-manager", projectId: null,
            name: "Workflow Manager", agentKind: "workflow-orchestrator", status: "working",
            parentSessionId: "local-secretary",
          }]
          : [];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sessions,
          ancestors: [],
          pageInfo: {
            limit: url.searchParams.get("parentId") ? 1 : 25,
            hasMore: url.searchParams.get("parentId") === "local-secretary",
            nextCursor: null,
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fn);
    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);

    const res = await tools.get("rhythm_list_sessions")!.handler({}, SECURITY_EXTRA);
    const parsed = parseFencedJson(res.content[0].text) as {
      currentWork: { state: string; truncated: boolean; hasMore: boolean; sessions: Array<Record<string, unknown>> };
    };
    expect(parsed.currentWork).toMatchObject({ state: "available", truncated: true, hasMore: true });
    expect(parsed.currentWork.sessions.map((row) => row.id)).toEqual(["local-secretary", "local-manager"]);
  });

  it("coordinator-sessions-c4: an empty recent page still returns the trusted caller's child", async () => {
    const fn = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      const sessions = url.searchParams.get("search") === "sdk-session-tool-test"
        ? [{
          id: "local-secretary", sdkSessionId: "sdk-session-tool-test", projectId: null,
          name: "Rhythm Coordinator", agentKind: "secretary", status: "working", parentSessionId: null,
        }]
        : url.searchParams.get("parentId") === "local-secretary"
          ? [{
            id: "local-manager", sdkSessionId: "sdk-manager", projectId: null,
            name: "Workflow Manager", agentKind: "workflow-orchestrator", status: "working",
            parentSessionId: "local-secretary", hasChildren: false, childCount: 0,
          }]
          : [];
      return { ok: true, status: 200, json: async () => ({ sessions, ancestors: [], pageInfo: { hasMore: false } }) };
    });
    vi.stubGlobal("fetch", fn);
    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);

    const res = await tools.get("rhythm_list_sessions")!.handler({}, SECURITY_EXTRA);
    const parsed = parseFencedJson(res.content[0].text) as {
      sessions: unknown[];
      currentWork: { state: string; sessions: Array<Record<string, unknown>> };
    };
    expect(parsed.sessions).toEqual([]);
    expect(parsed.currentWork.state).toBe("available");
    expect(parsed.currentWork.sessions.map((row) => row.id)).toEqual(["local-secretary", "local-manager"]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("coordinator-sessions-c5: a child read failure is explicit and retains partial evidence", async () => {
    const fn = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.searchParams.get("parentId") === "local-secretary") {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      const sessions = url.searchParams.get("search") === "sdk-session-tool-test"
        ? [{
          id: "local-secretary", sdkSessionId: "sdk-session-tool-test", projectId: null,
          name: "Rhythm Coordinator", agentKind: "secretary", status: "working", parentSessionId: null,
        }]
        : [];
      return { ok: true, status: 200, json: async () => ({ sessions, ancestors: [], pageInfo: { hasMore: false } }) };
    });
    vi.stubGlobal("fetch", fn);
    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);

    const res = await tools.get("rhythm_list_sessions")!.handler({}, SECURITY_EXTRA);
    const parsed = parseFencedJson(res.content[0].text) as {
      currentWork: { state: string; truncated: boolean; hasMore: boolean; sessions: Array<Record<string, unknown>> };
    };
    expect(parsed.currentWork).toMatchObject({ state: "read_failed", truncated: true, hasMore: true });
    expect(parsed.currentWork.sessions.map((row) => row.id)).toEqual(["local-secretary"]);
  });

  it("coordinator-sessions-c6: depth and session caps both mark current work incomplete", async () => {
    const makeTreeFetch = (fanout: number) => vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      const parentId = url.searchParams.get("parentId");
      if (url.searchParams.get("search") === "sdk-session-tool-test") {
        return {
          ok: true, status: 200,
          json: async () => ({ sessions: [{
            id: "node-0", sdkSessionId: "sdk-session-tool-test", projectId: null,
            name: "Secretary", agentKind: "secretary", status: "working", parentSessionId: null,
            hasChildren: true, childCount: fanout === 1 ? 1 : fanout,
          }], pageInfo: { hasMore: false } }),
        };
      }
      const current = Number(parentId?.slice("node-".length) ?? -1);
      if (fanout === 1 && current >= 0 && current < 6) {
        return {
          ok: true, status: 200,
          json: async () => ({ sessions: [{
            id: `node-${current + 1}`, sdkSessionId: `sdk-${current + 1}`, projectId: null,
            name: `Child ${current + 1}`, agentKind: "workflow-orchestrator", status: "working",
            parentSessionId: `node-${current}`, hasChildren: true,
            childCount: 1,
          }], pageInfo: { hasMore: false } }),
        };
      }
      if (fanout > 1 && parentId === "node-0") {
        return {
          ok: true, status: 200,
          json: async () => ({
            sessions: Array.from({ length: fanout }, (_, index) => ({
              id: `child-${index}`, sdkSessionId: `sdk-child-${index}`, projectId: null,
              name: `Child ${index}`, agentKind: "explore", status: "idle", parentSessionId: "node-0",
            })),
            pageInfo: { hasMore: true },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ sessions: [], pageInfo: { hasMore: false } }) };
    });
    const run = async (fetchImpl: ReturnType<typeof makeTreeFetch>) => {
      vi.stubGlobal("fetch", fetchImpl);
      const { server, tools } = makeStubServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);
      const res = await tools.get("rhythm_list_sessions")!.handler({}, SECURITY_EXTRA);
      return parseFencedJson(res.content[0].text) as {
        currentWork: { truncated: boolean; hasMore: boolean; sessions: Array<Record<string, unknown>> };
      };
    };

    const depthLimited = await run(makeTreeFetch(1));
    expect(depthLimited.currentWork.sessions).toHaveLength(7);
    expect(depthLimited.currentWork).toMatchObject({ truncated: true, hasMore: true });

    const capped = await run(makeTreeFetch(100));
    expect(capped.currentWork.sessions).toHaveLength(100);
    expect(capped.currentWork).toMatchObject({ truncated: true, hasMore: true });
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
      .handler({ sessionId: "ses-1", limit: 100 }, SECURITY_EXTRA);
    expect(res.isError).toBeUndefined();

    // AC2: both the recent page and caller lookup hit the local :4001 API, not prod.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${AGENT_URL}/agent-sessions/ses-1/messages?limit=100`);
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
      expect(calls[0].startsWith(`${AGENT_URL}/agent-sessions?`)).toBe(true);
      expect(calls[0]).not.toContain(PROD_URL);
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
      expect(calls[0].startsWith(`${PROD_URL}/agent-sessions?`)).toBe(true);
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
    expect(calls).toHaveLength(2);
  });
});

describe("issue-1577: rhythm_prompt_session trusted envelope", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("issue-1577-c8: forwards the current signed envelope and never sends a prompt without trusted context", async () => {
    // Regression: sending bare model args makes the API treat untrusted data as
    // an MCP identity; missing context must fail closed before any HTTP request.
    const { fn, calls } = makeFetchSpy({ accepted: true });
    vi.stubGlobal("fetch", fn);
    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAgentSessionTools(server as any, AGENT_URL, AGENT_TOKEN);
    const args = { sessionId: "target-session", prompt: "signed instruction", approval_id: "approved" };
    // Regression: an agent override in the public tool schema bypasses the target's stored profile.
    expect(Object.keys(tools.get("rhythm_prompt_session")!.shape).sort()).toEqual(["approval_id", "prompt", "sessionId"]);

    const signed = await tools.get("rhythm_prompt_session")!.handler(args, SIGNED_SECURITY_EXTRA);
    expect(signed.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    const request = (fn.mock.calls.find(([url]) => url.endsWith('/agent-sessions/target-session/prompt'))![1] as RequestInit);
    expect(JSON.parse(String(request.body))).toEqual({
      trustedCall: expect.objectContaining({
        context: expect.objectContaining({ sdkSessionId: "sdk-session-tool-test" }),
        arguments: args,
      }),
    });

    calls.length = 0;
    const fetchCount = fn.mock.calls.length;
    const missing = await tools.get("rhythm_prompt_session")!.handler(args, undefined);
    expect(missing.isError).toBe(true);
    expect(calls).toHaveLength(0);
    expect(fn).toHaveBeenCalledTimes(fetchCount);
  });
});
