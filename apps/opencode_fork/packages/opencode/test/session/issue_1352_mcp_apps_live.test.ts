import { expect, test } from "bun:test"

const live = process.env.RHYTHM_LIVE_E2E === "1"
const base = process.env.RHYTHM_LIVE_URL ?? "http://127.0.0.1:4098"

test.skipIf(!live)("issue-1352 live: session negotiates MCP Apps and withholds app-only tools from the model", async () => {
  // Regression caught: unit-level registry filtering works but the real session
  // prompt still serializes an app-only tool into the provider's tool schema.
  // The isolated sandbox fixture exposes its captured negotiation/model-schema
  // evidence through this test-only route when RHYTHM_LIVE_E2E is enabled.
  expect(base).not.toContain(":4001")
  const response = await fetch(`${base}/__test/mcp-apps/negotiation`)
  expect(response.status).toBe(200)
  const evidence = (await response.json()) as {
    clientCapabilities?: Record<string, any>
    appRegistryToolNames?: string[]
    modelToolNames?: string[]
  }
  expect(
    evidence.clientCapabilities?.extensions?.["io.modelcontextprotocol/ui"],
  ).toEqual({ mimeTypes: ["text/html;profile=mcp-app"] })
  expect(evidence.appRegistryToolNames).toContain("app_only_fixture")
  expect(evidence.modelToolNames).not.toContain("app_only_fixture")
})
