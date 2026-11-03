import { expect, test } from "bun:test"
import { AppInitializeResultSchema } from "../../src/mcp/index"

const result = (ui: unknown) => ({
  protocolVersion: "2025-06-18",
  capabilities: { tools: {}, extensions: { "io.modelcontextprotocol/ui": ui } },
  serverInfo: { name: "s", version: "1" },
})

// FastMCP 3.2.x and minutes advertise the UI extension as `{}`; rejecting it failed the whole handshake.
test("initialize accepts a UI extension without mimeTypes", () => {
  expect(AppInitializeResultSchema.safeParse(result({})).success).toBe(true)
})

test("initialize keeps advertised mimeTypes and still bounds them", () => {
  const parsed = AppInitializeResultSchema.parse(result({ mimeTypes: ["text/html;profile=mcp-app"] }))
  expect(parsed.capabilities.extensions?.["io.modelcontextprotocol/ui"]?.mimeTypes).toEqual([
    "text/html;profile=mcp-app",
  ])
  expect(AppInitializeResultSchema.safeParse(result({ mimeTypes: Array(9).fill("x") })).success).toBe(false)
})
