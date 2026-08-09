import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerLiveArtifactTools } from "../liveArtifacts.js";
import { worshipCalendar } from "./fixtures/worshipCalendar.js";
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from "../../security/security_context.js";

type Handler = (args: Record<string, unknown>, extra?: { _meta?: Record<string, unknown> }) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}>;

function makeServer() {
  const tools = new Map<string, { shape: Record<string, unknown>; handler: Handler }>();
  return {
    tools,
    server: { tool(name: string, _description: string, shape: Record<string, unknown>, handler: Handler) { tools.set(name, { shape, handler }); } },
  };
}

const extra = { _meta: { [RHYTHM_SECURITY_CONTEXT_META_KEY]: { sdkSessionId: "sdk-av03", turnId: "turn-av03", agentName: "church-admin", toolCallId: "call-av03" } } };
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, statusText: "", json: async () => body });

describe("AV-03 live-artifact MCP contract", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("registers exactly the five focused tools", () => {
    // Regression: exposing a generic artifact executor or omitting one narrow tool.
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, "http://hosted", "token", "http://agent");
    expect([...tools.keys()]).toEqual([
      "rhythm_list_live_artifacts", "rhythm_get_live_artifact", "rhythm_create_live_artifact",
      "rhythm_update_live_artifact_state", "rhythm_update_live_artifact_bundle",
    ]);
  });

  it("uses only hosted API routing and user-bound bearer authorization", async () => {
    // Regression: tools accidentally target the agent server or disclose credentials.
    const fetch = vi.fn().mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok({ taintId: "taint" }));
    vi.stubGlobal("fetch", fetch);
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, "http://hosted", "secret-token", "http://agent");
    const result = await tools.get("rhythm_list_live_artifacts")!.handler({ search: "calendar" }, extra);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://hosted/live-artifacts?type=html&search=calendar");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-token" });
    expect(result.content[0].text).not.toContain("secret-token");
  });

  it("keeps only public schemas and independent CAS revisions", () => {
    // Regression: a tool accepts internal paths or drops one revision guard.
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, "http://hosted", "token", "http://agent");
    expect(Object.keys(tools.get("rhythm_create_live_artifact")!.shape)).toEqual(expect.arrayContaining(["title", "workspace_id", "bundle", "state", "visibility", "collaborators", "declared_capabilities"]));
    expect(Object.keys(tools.get("rhythm_update_live_artifact_state")!.shape)).toEqual(expect.arrayContaining(["id", "state", "expected_state_revision"]));
    expect(Object.keys(tools.get("rhythm_update_live_artifact_bundle")!.shape)).toEqual(expect.arrayContaining(["id", "bundle", "expected_bundle_revision"]));
    expect(Object.keys(tools.get("rhythm_create_live_artifact")!.shape)).not.toEqual(expect.arrayContaining(["path", "url", "method"]));
  });

  it("maps create and independent updates to the exact hosted routes", async () => {
    // Regression: a write silently reaches a wrong endpoint or verb.
    const fetch = vi.fn()
      .mockResolvedValueOnce(ok({ allowed: true })).mockResolvedValueOnce(ok({ id: "artifact-1" }, 201))
      .mockResolvedValueOnce(ok({ allowed: true })).mockResolvedValueOnce(ok({ id: "artifact-1", currentStateRevision: 2 }))
      .mockResolvedValueOnce(ok({ allowed: true })).mockResolvedValueOnce(ok({ id: "artifact-1", currentBundleRevision: 2 }));
    vi.stubGlobal("fetch", fetch);
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, "http://hosted", "token", "http://agent");
    await tools.get("rhythm_create_live_artifact")!.handler({ ...worshipCalendar, approval_id: "approval-create" }, extra);
    await tools.get("rhythm_update_live_artifact_state")!.handler({ id: "artifact-1", state: worshipCalendar.state, expected_state_revision: 1, approval_id: "approval-state" }, extra);
    await tools.get("rhythm_update_live_artifact_bundle")!.handler({ id: "artifact-1", bundle: worshipCalendar.bundle, expected_bundle_revision: 1, approval_id: "approval-bundle" }, extra);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => url)).toContain("http://hosted/live-artifacts");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url]) => url)).toEqual(expect.arrayContaining(["http://hosted/live-artifacts/artifact-1/state", "http://hosted/live-artifacts/artifact-1/bundle"]));
    expect(JSON.parse(String(fetch.mock.calls[3][1].body))).toEqual({ expectedStateRevision: 1, state: worshipCalendar.state });
  });

  it("preserves 404, 409 current revision, and 410 as failed results", async () => {
    // Regression: an agent receives a success-shaped error and overwrites state.
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, "http://hosted", "token", "http://agent");
    for (const [status, body] of [[404, { error: { code: "not_found", message: "not found" } }], [409, { error: { code: "revision_conflict", message: "conflict", currentStateRevision: 4 } }], [410, { error: { code: "artifact_deleted", message: "deleted" } }]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(body, status)));
      const result = await tools.get("rhythm_get_live_artifact")!.handler({ id: "artifact-1" }, extra);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(String(status));
      if (status === 409) expect(result.content[0].text).toContain("currentStateRevision");
    }
  });

  it("does not add capability execution, scheduling, sharing, or delete tools", () => {
    // Regression: AV-03 grows beyond the approved five-tool surface.
    const { server, tools } = makeServer();
    registerLiveArtifactTools(server as never, "http://hosted", "token", "http://agent");
    expect([...tools.keys()].join(" ")).not.toMatch(/capabilit|schedule|collaborator|delete/);
  });
});
