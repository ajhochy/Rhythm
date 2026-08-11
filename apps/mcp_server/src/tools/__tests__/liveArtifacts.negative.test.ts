/**
 * AV-03 negatives — the write path must fail CLOSED.
 *
 * The happy-path suite (liveArtifacts.test.ts) proves the five tools reach the
 * right hosted routes. These prove the opposite direction: when approval is
 * denied, when the trusted session metadata is missing, or when the model sends
 * malformed arguments, no mutating API call is made and the bearer token never
 * reaches the model. Refusal is only safe if nothing was written first.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RHYTHM_SECURITY_CONTEXT_META_KEY } from "../../security/security_context.js";
import { worshipCalendar } from "./fixtures/worshipCalendar.js";
import { registerLiveArtifactTools } from "../liveArtifacts.js";

const API = "http://hosted";
const TOKEN = "secret-token";
const AGENT = "http://agent";

type Result = { content: Array<{ type: "text"; text: string }>; isError?: true };
type Handler = (args: Record<string, unknown>, extra?: { _meta?: Record<string, unknown> }) => Promise<Result>;

function makeServer() {
  const tools = new Map<string, Handler>();
  return {
    tools,
    server: {
      tool(name: string, _description: string, _shape: Record<string, unknown>, handler: Handler) {
        tools.set(name, handler);
      },
    },
  };
}

const extra = {
  _meta: {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
      sdkSessionId: "sdk-av03",
      turnId: "turn-av03",
      agentName: "church-admin",
      toolCallId: "call-av03",
    },
  },
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, statusText: "", json: async () => body });

/** Every fetch that would change hosted state (the approval probe is a POST to the agent). */
const mutations = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.filter(([url, init]) => String(url).startsWith(API) && ["POST", "PUT", "PATCH", "DELETE"].includes(String((init as RequestInit | undefined)?.method ?? "GET")));

const writes: Array<[string, Record<string, unknown>]> = [
  ["rhythm_create_live_artifact", { ...worshipCalendar, approval_id: "approval-create" }],
  ["rhythm_update_live_artifact_state", { id: "artifact-1", state: worshipCalendar.state, expected_state_revision: 1, approval_id: "approval-state" }],
  ["rhythm_update_live_artifact_bundle", { id: "artifact-1", bundle: worshipCalendar.bundle, expected_bundle_revision: 1, approval_id: "approval-bundle" }],
  ["rhythm_update_live_artifact_sharing", { id: "artifact-1", visibility: "shared", collaborators: ["bea@example.test"], approval_id: "approval-sharing" }],
];

describe("AV-03 live-artifact write path fails closed", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it.each(writes)("%s refuses a denied approval without mutating the API", async (name, args) => {
    // Regression: a denied approval still lets the write through to hosted state.
    const fetch = vi.fn().mockResolvedValue(json({ allowed: false, error: { message: "approval denied by user" } }, 403));
    vi.stubGlobal("fetch", fetch);
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, API, TOKEN, AGENT);

    const result = await tools.get(name)!(args, extra);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Blocked/);
    expect(mutations(fetch)).toEqual([]);
    expect(result.content[0].text).not.toContain(TOKEN);
  });

  it.each(writes)("%s refuses when trusted session metadata is absent", async (name, args) => {
    // Regression: a model-driven call without engine-injected identity writes anyway.
    const fetch = vi.fn().mockResolvedValue(json({ allowed: true }));
    vi.stubGlobal("fetch", fetch);
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, API, TOKEN, AGENT);

    const result = await tools.get(name)!(args, {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/trusted Rhythm session\/turn metadata is unavailable/);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain(TOKEN);
  });

  it("rejects malformed tool arguments at the MCP boundary before any fetch", async () => {
    // Regression: bad model JSON reaches the handler and is coerced into a write.
    // Uses the REAL McpServer so the SDK's schema validation actually runs —
    // the hand-rolled stub above skips it by design.
    const fetch = vi.fn().mockResolvedValue(json({ allowed: true }));
    vi.stubGlobal("fetch", fetch);
    const server = new McpServer({ name: "rhythm", version: "0.0.0-test" });
    registerLiveArtifactTools(server, API, TOKEN, AGENT);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const malformed: Array<[string, Record<string, unknown>]> = [
      // Revisions are positive ints: 0 and "1" must not be coerced into a CAS write.
      ["rhythm_update_live_artifact_state", { id: "artifact-1", state: {}, expected_state_revision: 0 }],
      ["rhythm_update_live_artifact_bundle", { id: "artifact-1", bundle: worshipCalendar.bundle, expected_bundle_revision: "1" }],
      // A bundle missing `js` is not a partial bundle — it is an invalid one.
      ["rhythm_create_live_artifact", { title: "x", workspace_id: 1, bundle: { html: "<p/>", css: "" }, state: {} }],
      // Undeclared capabilities must not pass through.
      ["rhythm_create_live_artifact", { ...worshipCalendar, declared_capabilities: ["pco.services.write"] }],
    ];

    try {
      for (const [name, args] of malformed) {
        const outcome = await client
          .callTool({ name, arguments: args })
          .then((value) => value as Result)
          .catch((error: unknown) => ({ content: [{ type: "text" as const, text: String(error) }], isError: true as const }));
        expect(outcome.isError, `${name} accepted ${JSON.stringify(args)}`).toBe(true);
        // Must be SCHEMA rejection (-32602, handler never entered), not the
        // downstream "trusted metadata unavailable" refusal — otherwise this
        // test would pass even if validation were removed entirely.
        expect(outcome.content[0].text, `${name} reached the handler`).toMatch(/-32602: Input validation error/);
        expect(outcome.content[0].text).not.toMatch(/trusted Rhythm session/);
        expect(JSON.stringify(outcome)).not.toContain(TOKEN);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it.each([
    ["unknown", [{ id: 2, name: "Bea", email: "bea@example.test" }], /unknown collaborator/i, "Nobody"],
    ["ambiguous", [{ id: 2, name: "Bea One", email: "bea.one@example.test" }, { id: 3, name: "Bea Two", email: "bea.two@example.test" }], /candidates.*Bea One.*Bea Two/i, "Bea"],
  ])("rejects %s collaborator identity before any hosted mutation", async (_kind, users, message, identity) => {
    // Regression: an unresolved identity changes visibility or collaborator membership.
    const fetch = vi.fn().mockResolvedValueOnce(json({ allowed: true })).mockResolvedValueOnce(json(users));
    vi.stubGlobal("fetch", fetch);
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, API, TOKEN, AGENT);
    const result = await tools.get("rhythm_update_live_artifact_sharing")!({ id: "artifact-1", visibility: "shared", collaborators: [identity], approval_id: "approval-sharing" }, extra);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(message);
    expect(mutations(fetch)).toEqual([]);
  });

  it("passes a non-owner hosted 403 through without attempting later mutations", async () => {
    // Regression: owner authorization failure is swallowed or the tool continues with membership writes.
    const fetch = vi.fn().mockResolvedValueOnce(json({ allowed: true })).mockResolvedValueOnce(json([{ id: 2, name: "Bea", email: "bea@example.test" }])).mockResolvedValueOnce(json({ error: { message: "owner only" } }, 403));
    vi.stubGlobal("fetch", fetch);
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, API, TOKEN, AGENT);
    const result = await tools.get("rhythm_update_live_artifact_sharing")!({ id: "artifact-1", visibility: "shared", collaborators: ["bea@example.test"], approval_id: "approval-sharing" }, extra);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("403");
    expect(mutations(fetch)).toEqual([]);
  });

  it("does not mutate an already matching sharing configuration", async () => {
    // Regression: a no-op share edit still sends PATCH/POST/DELETE requests.
    const fetch = vi.fn().mockResolvedValueOnce(json({ allowed: true })).mockResolvedValueOnce(json([{ id: 2, name: "Bea", email: "bea@example.test" }])).mockResolvedValueOnce(json({ id: "artifact-1", visibility: "shared" })).mockResolvedValueOnce(json([{ userId: 2 }]));
    vi.stubGlobal("fetch", fetch);
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, API, TOKEN, AGENT);
    const result = await tools.get("rhythm_update_live_artifact_sharing")!({ id: "artifact-1", visibility: "shared", collaborators: ["bea@example.test"], approval_id: "approval-sharing" }, extra);
    expect(result.isError).toBeUndefined();
    expect(mutations(fetch)).toEqual([]);
  });
});
