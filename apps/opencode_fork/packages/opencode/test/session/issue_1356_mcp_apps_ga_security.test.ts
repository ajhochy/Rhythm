import { describe, expect, test } from "bun:test"
import { createMcpAppExecutionGate } from "../../src/session/mcp-app-execution"

describe("issue #1356 engine proof hardening", () => {
  test("proof replay, expiry, and oversized input execute zero additional MCP calls", async () => {
    let now = 1_000
    let executes = 0
    const gate = createMcpAppExecutionGate({
      secret: "issue-1356-test-secret-at-least-32-bytes",
      now: () => now,
      nonce: () => "one-use-proof",
    })
    const origin = {
      sessionID: "session",
      callID: "call",
      serverName: "pilot",
      resourceUri: "ui://pilot/view",
      cwd: "/workspace",
    }
    const proof = gate.issueProof({
      ...origin,
      contentHash: `sha256:${"a".repeat(64)}`,
      expiresAt: 2_000,
    })
    const deps = {
      appTools: async () => ({
        pilot_action: {
          key: "pilot_action",
          client: "pilot",
          name: "action",
          visibility: ["app"] as const,
          inputSchema: {},
        },
      }),
      isAllowed: async () => true,
      validateInput: async () => true,
      approve: async () => {},
      before: async () => {},
      execute: async () => {
        executes++
        return { content: [{ type: "text", text: "ok" }] }
      },
      after: async () => {},
    }
    const request = {
      proof,
      sessionID: "session",
      callID: "call",
      toolKey: "pilot_action",
      input: { value: "ok" },
    }
    await gate.execute(request, deps)
    await expect(gate.execute(request, deps)).rejects.toThrow("app_execution_denied")
    expect(executes).toBe(1)

    const fresh = createMcpAppExecutionGate({
      secret: "issue-1356-test-secret-at-least-32-bytes",
      now: () => now,
      nonce: () => "oversized-proof",
    })
    const oversizedProof = fresh.issueProof({
      ...origin,
      contentHash: `sha256:${"b".repeat(64)}`,
      expiresAt: 2_000,
    })
    await expect(
      fresh.execute({ ...request, proof: oversizedProof, input: { value: "x".repeat(65 * 1024) } }, deps),
    ).rejects.toThrow("app_execution_denied")
    expect(executes).toBe(1)

    const expiring = createMcpAppExecutionGate({
      secret: "different-issue-1356-secret-32-bytes",
      now: () => now,
      nonce: () => "expired-proof",
    })
    const expiringProof = expiring.issueProof({
      ...origin,
      contentHash: `sha256:${"c".repeat(64)}`,
      expiresAt: 1_001,
    })
    now = 1_001
    await expect(expiring.execute({ ...request, proof: expiringProof }, deps)).rejects.toThrow(
      "app_execution_denied",
    )
    expect(executes).toBe(1)
  })
})
