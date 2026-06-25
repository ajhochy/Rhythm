import { describe, test, expect } from "bun:test"

/**
 * CONTRACT TEST for issue mcp-scope-02
 *
 * Tests the pure helper `filterMcpToolsByAllowlist` that will be extracted
 * from session/prompt.ts resolveTools MCP loop.
 *
 * This file is written BEFORE the helper exists. All tests must fail (red)
 * until the coding-agent implements the helper at:
 *   apps/opencode_fork/packages/opencode/src/session/mcp_allowlist.ts
 *
 * Regression it catches: if the allowlist gate is wired up but the
 * composedKey→serverName index is built by string-splitting on "_" instead of
 * from MCP.tools() metadata, tools from hyphenated server names like
 * "gmail-work" will be silently dropped or mis-bucketed regardless of the
 * allowlist value, causing wrong tool sets to be injected.
 */

import { filterMcpToolsByAllowlist } from "./mcp_allowlist"

// ---------------------------------------------------------------------------
// Fixtures — realistic sanitized keys from two hypothetical MCP servers
// ---------------------------------------------------------------------------

const toolKeys = ["srvA_tool1", "srvA_tool2", "srvB_tool1"]

// keyToServer maps each sanitized composedKey back to its raw clientName.
// This must be built from MCP.tools() metadata, NOT by splitting on "_".
const keyToServer: Record<string, string> = {
  srvA_tool1: "srvA",
  srvA_tool2: "srvA",
  srvB_tool1: "srvB",
}

// ---------------------------------------------------------------------------
// Criterion mcp-scope-02-c1
// tools allowlist by explicit key — include srvA_tool1, exclude the rest
// ---------------------------------------------------------------------------
describe("mcp-scope-02-c1: explicit tool key allowlist", () => {
  test("returns only srvA_tool1 when tools=['srvA_tool1'] and servers=[]", () => {
    const result = filterMcpToolsByAllowlist(toolKeys, keyToServer, {
      servers: [],
      tools: ["srvA_tool1"],
    })
    expect(result).toEqual(["srvA_tool1"])
    expect(result).not.toContain("srvA_tool2")
    expect(result).not.toContain("srvB_tool1")
  })
})

// ---------------------------------------------------------------------------
// Criterion mcp-scope-02-c2
// server-level allowlist — include all srvB_* tools, exclude all srvA_*
// ---------------------------------------------------------------------------
describe("mcp-scope-02-c2: server-level allowlist passes all server tools", () => {
  test("returns all srvB_* tools when servers=['srvB'] and tools=[]", () => {
    const result = filterMcpToolsByAllowlist(toolKeys, keyToServer, {
      servers: ["srvB"],
      tools: [],
    })
    expect(result).toEqual(["srvB_tool1"])
    expect(result).not.toContain("srvA_tool1")
    expect(result).not.toContain("srvA_tool2")
  })
})

// ---------------------------------------------------------------------------
// Criterion mcp-scope-02-c3
// both lists empty → zero tools in output
// ---------------------------------------------------------------------------
describe("mcp-scope-02-c3: empty allowlist returns no tools", () => {
  test("returns empty array when both servers and tools are empty", () => {
    const result = filterMcpToolsByAllowlist(toolKeys, keyToServer, {
      servers: [],
      tools: [],
    })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Criterion mcp-scope-02-c4
// undefined allowlist → back-compat: all tools pass through unchanged
// ---------------------------------------------------------------------------
describe("mcp-scope-02-c4: undefined allowlist returns all tools (back-compat)", () => {
  test("returns all tool keys when allowlist is undefined", () => {
    const result = filterMcpToolsByAllowlist(toolKeys, keyToServer, undefined)
    expect(result).toEqual(["srvA_tool1", "srvA_tool2", "srvB_tool1"])
  })
})

// ---------------------------------------------------------------------------
// Criterion mcp-scope-02-c5
// unknown key in tools list → silently absent, no throw
// ---------------------------------------------------------------------------
describe("mcp-scope-02-c5: unknown key in tools list is silently absent", () => {
  test("does not throw when tools contains a key that no server exposes", () => {
    expect(() =>
      filterMcpToolsByAllowlist(toolKeys, keyToServer, {
        servers: [],
        tools: ["nonexistent_tool"],
      }),
    ).not.toThrow()

    const result = filterMcpToolsByAllowlist(toolKeys, keyToServer, {
      servers: [],
      tools: ["nonexistent_tool"],
    })
    expect(result).toEqual([])
  })
})
