import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { MessageV2 } from "../../src/session/message-v2"

describe("issue #1342 MCP result envelope schema", () => {
  test("preserves structuredContent, _meta, and isError when a completed tool state is decoded", () => {
    // Regression caught: the session schema accepts a completed tool part but
    // strips unknown MCP CallToolResult fields during decode/persistence. The
    // mcpResult assertion fails until the additive envelope is part of the
    // real ToolStateCompleted schema.
    const decoded = Schema.decodeUnknownSync(MessageV2.ToolStateCompleted)({
      status: "completed",
      input: {},
      output: "Readable fallback text",
      title: "",
      metadata: {},
      mcpResult: {
        structuredContent: { kind: "issue-1342-contract", count: 2 },
        _meta: { source: "contract-mcp-server", nested: { retained: true } },
        isError: false,
      },
      time: { start: 1, end: 2 },
    }) as Record<string, unknown>

    expect(decoded).toMatchObject({
      output: "Readable fallback text",
      mcpResult: {
        structuredContent: { kind: "issue-1342-contract", count: 2 },
        _meta: { source: "contract-mcp-server", nested: { retained: true } },
        isError: false,
      },
    })
  })
})
