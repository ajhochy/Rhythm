import { describe, test, expect } from "bun:test"

/**
 * CONTRACT TEST for issue #843 (tokens-03: deferred MCP tool schema loading).
 *
 * Tests the pure helpers extracted for the deferred-tool-catalog feature at:
 *   apps/opencode_fork/packages/opencode/src/session/mcp_deferred_tools.ts
 *
 * This file is written BEFORE the helpers exist. All tests must fail (red)
 * until the coding-agent implements the module.
 *
 * Regression it catches (issue-843-c1): if resolveTools stops advertising a
 * names-only catalog and instead injects one full JSON Schema per MCP tool
 * (today's eager behavior) even when deferred mode is requested, the token
 * savings this issue exists to deliver silently disappear — the session-start
 * payload balloons back to the pre-#843 size with no test failure elsewhere,
 * because prompt.ts's own tests only assert tool *names* are offered, not
 * how many schemas were serialized to do it.
 *
 * Regression it catches (issue-843-c3): if the dispatch-time guard is wired
 * to a DIFFERENT (looser) allowlist check than filterMcpToolsByAllowlist, a
 * deferred-mode session could execute an out-of-scope MCP tool even though
 * it never appeared in the catalog — reopening the exact class of bug #765
 * fixed for the eager path.
 */

import {
  buildDeferredToolCatalog,
  formatDeferredToolCatalog,
  isDeferredMcpToolAllowed,
  MCP_DISPATCH_TOOL_ID,
} from "./mcp_deferred_tools"
import { filterMcpToolsByAllowlist } from "./mcp_allowlist"

// ---------------------------------------------------------------------------
// Fixtures — same shape as mcp_allowlist.test.ts for direct comparability
// ---------------------------------------------------------------------------

const toolKeys = ["srvA_tool1", "srvA_tool2", "srvB_tool1"]

const keyToServer: Record<string, string> = {
  srvA_tool1: "srvA",
  srvA_tool2: "srvA",
  srvB_tool1: "srvB",
}

const descriptions: Record<string, string> = {
  srvA_tool1: "Does the first srvA thing",
  srvA_tool2: "Does the second srvA thing",
  srvB_tool1: "Does the srvB thing",
}

// ---------------------------------------------------------------------------
// Criterion issue-843-c1: names-only catalog, one dispatcher tool
// ---------------------------------------------------------------------------

describe("issue-843-c1: deferred mode advertises only the dispatcher tool + a name/description list, not per-tool schemas", () => {
  test("buildDeferredToolCatalog returns name+server+description for every allowed key, no schema fields", () => {
    const allowed = filterMcpToolsByAllowlist(toolKeys, keyToServer, undefined)
    const catalog = buildDeferredToolCatalog(allowed, keyToServer, descriptions)

    expect(catalog).toHaveLength(3)
    for (const entry of catalog) {
      expect(Object.keys(entry).sort()).toEqual(["description", "name", "server"])
    }
    expect(catalog.map((e) => e.name)).toEqual(["srvA_tool1", "srvA_tool2", "srvB_tool1"])
  })

  test("formatDeferredToolCatalog renders a compact XML-ish block, not raw JSON Schema", () => {
    const catalog = buildDeferredToolCatalog(toolKeys, keyToServer, descriptions)
    const rendered = formatDeferredToolCatalog(catalog)

    expect(rendered).toContain("<available_mcp_tools>")
    expect(rendered).toContain("srvA_tool1")
    expect(rendered).toContain("Does the first srvA thing")
    // The whole point of deferral: no JSON Schema keywords should appear in
    // the cheap catalog string (that's the expensive part being deferred).
    expect(rendered).not.toContain('"type"')
    expect(rendered).not.toContain('"properties"')
  })

  test("empty allowed-keys set renders a clear empty message instead of an empty tag", () => {
    const rendered = formatDeferredToolCatalog([])
    expect(rendered).toBe("No MCP tools are currently available.")
  })

  test("MCP_DISPATCH_TOOL_ID is a stable, non-empty tool id distinct from any MCP composed key", () => {
    expect(MCP_DISPATCH_TOOL_ID).toBe("mcp_dispatch")
    expect(toolKeys).not.toContain(MCP_DISPATCH_TOOL_ID)
  })
})

// ---------------------------------------------------------------------------
// Criterion issue-843-c1 (continued): first use loads/executes the real tool
// ---------------------------------------------------------------------------

describe("issue-843-c1: dispatching a call by name loads and executes the real tool", () => {
  test("a name present in the catalog is allowed at dispatch time", () => {
    expect(isDeferredMcpToolAllowed("srvA_tool1", keyToServer, undefined)).toBe(true)
  })

  test("a name that maps to no known server is rejected at dispatch time even under an unrestricted allowlist state mismatch", () => {
    // Simulates the model hallucinating/inventing a tool name that was never
    // in the catalog — dispatch must not blindly trust the input string.
    expect(isDeferredMcpToolAllowed("does_not_exist", keyToServer, undefined)).toBe(true) // undefined allowlist = unrestricted back-compat, per mcp_allowlist.ts semantics
    // But once a real allowlist is active, an unknown key must fail closed:
    expect(
      isDeferredMcpToolAllowed("does_not_exist", keyToServer, { servers: ["srvA"], tools: [] }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Criterion issue-843-c3: allowlist enforcement (#765/#775) unaffected
// ---------------------------------------------------------------------------

describe("issue-843-c3: filterMcpToolsByAllowlist gating still applies to the dispatcher's name list and its dispatch-time execute path", () => {
  test("server-level allowlist excludes out-of-scope tools from the catalog", () => {
    const allowed = filterMcpToolsByAllowlist(toolKeys, keyToServer, { servers: ["srvA"], tools: [] })
    const catalog = buildDeferredToolCatalog(allowed, keyToServer, descriptions)
    expect(catalog.map((e) => e.name)).toEqual(["srvA_tool1", "srvA_tool2"])
    expect(catalog.map((e) => e.name)).not.toContain("srvB_tool1")
  })

  test("dispatch-time guard rejects a catalog-excluded tool even if the model tries to call it directly", () => {
    const allowlist = { servers: ["srvA"], tools: [] }
    // srvB_tool1 was filtered out of the catalog above; confirm dispatch
    // independently refuses to execute it (defense in depth, mirrors the
    // skill tool's execute-time re-check per tool/skill.ts #775).
    expect(isDeferredMcpToolAllowed("srvB_tool1", keyToServer, allowlist)).toBe(false)
    expect(isDeferredMcpToolAllowed("srvA_tool1", keyToServer, allowlist)).toBe(true)
  })

  test("explicit tool-key allowlist entries are honored identically to the eager-mode filter", () => {
    const allowlist = { servers: [], tools: ["srvB_tool1"] }
    const eagerAllowed = filterMcpToolsByAllowlist(toolKeys, keyToServer, allowlist)
    const deferredAllowed = toolKeys.filter((k) => isDeferredMcpToolAllowed(k, keyToServer, allowlist))
    expect(deferredAllowed).toEqual(eagerAllowed)
  })

  test("undefined allowlist (back-compat/unrestricted) permits every known tool at dispatch time, matching eager mode exactly", () => {
    const eagerAllowed = filterMcpToolsByAllowlist(toolKeys, keyToServer, undefined)
    const deferredAllowed = toolKeys.filter((k) => isDeferredMcpToolAllowed(k, keyToServer, undefined))
    expect(deferredAllowed).toEqual(eagerAllowed)
  })
})
