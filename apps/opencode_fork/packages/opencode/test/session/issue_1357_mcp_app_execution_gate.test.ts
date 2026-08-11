import { describe, expect, test } from "bun:test"
import { createMcpAppExecutionGate } from "../../src/session/mcp-app-execution"

const now = 1_000
const origin = { sessionID: "s", callID: "call", serverName: "origin", resourceUri: "ui://origin/view", cwd: "/w" }
const tool = {
  key: "origin_do",
  client: "origin",
  name: "do",
  visibility: ["app"] as const,
  inputSchema: {
    type: "object",
    required: ["value"],
    properties: { value: { type: "string" } },
    additionalProperties: false,
  },
}

function setup() {
  const events: string[] = []
  let executes = 0
  const gate = createMcpAppExecutionGate({
    secret: "test-secret-at-least-32-bytes-long",
    now: () => now,
    nonce: () => "proof-1",
  })
  const proof = gate.issueProof({ ...origin, contentHash: "sha256:" + "a".repeat(64), expiresAt: 2_000 })
  const deps = {
    appTools: async () => ({
      origin_do: tool,
      origin_model: { ...tool, key: "origin_model", visibility: ["model"] as const },
      other_do: { ...tool, key: "other_do", client: "other" },
    }),
    isAllowed: async (key: string) => key === "origin_do",
    validateInput: async (_: unknown, input: unknown) => typeof (input as any)?.value === "string",
    approve: async () => {
      events.push("approve")
    },
    before: async () => {
      events.push("before")
    },
    execute: async () => {
      events.push("execute")
      executes++
      return { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true }, _meta: { secret: "strip" } }
    },
    after: async () => {
      events.push("after")
    },
  }
  return {
    gate,
    proof,
    deps,
    events,
    get executes() {
      return executes
    },
  }
}

describe("issue #1357 MCP App execution gate", () => {
  test("issue-1357-c1-c4: valid signed same-server app tool uses approval and hooks", async () => {
    const s = setup()
    const result = await s.gate.execute(
      { proof: s.proof, sessionID: "s", callID: "call", toolKey: "origin_do", input: { value: "x" } },
      s.deps,
    )
    expect(s.events).toEqual(["before", "approve", "execute", "after"])
    expect(s.executes).toBe(1)
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } })
  })
  test("issue-1357-c2-c5: scope/schema/visibility/server/proof/replay/expiry fail before MCP", async () => {
    const cases = [
      { name: "cross-server", patch: { toolKey: "other_do" } },
      { name: "model-only", patch: { toolKey: "origin_model" } },
      { name: "out-of-scope", patch: { toolKey: "missing" } },
      { name: "bad-schema", patch: { input: { value: 1 } } },
      { name: "wrong-session", patch: { sessionID: "other" } },
      { name: "invalid-proof", patch: { proof: "bad" } },
    ]
    for (const item of cases) {
      const s = setup()
      await expect(
        s.gate.execute(
          {
            proof: s.proof,
            sessionID: "s",
            callID: "call",
            toolKey: "origin_do",
            input: { value: "x" },
            ...item.patch,
          },
          s.deps,
        ),
      ).rejects.toThrow("app_execution_denied")
      expect(s.executes, item.name).toBe(0)
      expect(s.events, item.name).toEqual([])
    }
    const denied = setup()
    await expect(
      denied.gate.execute(
        { proof: denied.proof, sessionID: "s", callID: "call", toolKey: "origin_do", input: { value: "x" } },
        {
          ...denied.deps,
          approve: async () => {
            denied.events.push("approve")
            throw new Error("denied")
          },
        },
      ),
    ).rejects.toThrow("denied")
    expect(denied.executes).toBe(0)
    expect(denied.events).toEqual(["before", "approve"])
    const replay = setup()
    const request = { proof: replay.proof, sessionID: "s", callID: "call", toolKey: "origin_do", input: { value: "x" } }
    await replay.gate.execute(request, replay.deps)
    await expect(replay.gate.execute(request, replay.deps)).rejects.toThrow("app_execution_denied")
    expect(replay.executes).toBe(1)
    const expired = createMcpAppExecutionGate({
      secret: "test-secret-at-least-32-bytes-long",
      now: () => 2_000,
      nonce: () => "proof-1",
    })
    await expect(
      expired.execute(
        { proof: setup().proof, sessionID: "s", callID: "call", toolKey: "origin_do", input: { value: "x" } },
        setup().deps,
      ),
    ).rejects.toThrow("app_execution_denied")
  })
})
