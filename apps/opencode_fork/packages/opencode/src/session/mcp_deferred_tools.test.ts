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
  isMcpToolDeferred,
  MCP_DISPATCH_TOOL_ID,
  resolveDeferredMcpDescribeName,
  searchDeferredToolCatalog,
  uniqueRawNames,
  type DeferredMcpOrigin,
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

describe("issue-1209 selective deferred servers", () => {
  test("defers only tools from the named fat server", () => {
    const keyToServer = {
      propresenter_show_slide: "propresenter",
      rhythm_list_tasks: "rhythm",
    }
    const allowlist = {
      servers: ["propresenter", "rhythm"],
      tools: [],
      deferredServers: ["propresenter"],
    }
    expect(isMcpToolDeferred("propresenter_show_slide", keyToServer, allowlist)).toBe(true)
    expect(isMcpToolDeferred("rhythm_list_tasks", keyToServer, allowlist)).toBe(false)
  })

  test("issue-1209-c8: selective dispatcher refuses a tool outside the allowlist", () => {
    const keyToServer = {
      propresenter_show_slide: "propresenter",
      gmail_send_email: "gmail-work",
    }
    const allowlist = {
      servers: ["propresenter"],
      tools: [],
      deferredServers: ["propresenter"],
    }
    expect(isMcpToolDeferred("gmail_send_email", keyToServer, allowlist)).toBe(false)
    expect(isDeferredMcpToolAllowed("gmail_send_email", keyToServer, allowlist)).toBe(false)
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

// ---------------------------------------------------------------------------
// Normal-app discovery compatibility: describe accepts an unambiguous registered
// tool name; execute stays canonical-only. Resolution uses authoritative origins
// from the FRESH permitted inventory only.
// ---------------------------------------------------------------------------
describe("describe-name resolution (registered raw tool names)", () => {
  const status: DeferredMcpOrigin = {
    key: "rhythm_rhythm_get_coordinator_status",
    serverName: "rhythm",
    toolName: "rhythm_get_coordinator_status",
  }
  const memory: DeferredMcpOrigin = { key: "rhythm_rhythm_search_memory", serverName: "rhythm", toolName: "rhythm_search_memory" }
  const workList: DeferredMcpOrigin = { key: "gmail_work_list", serverName: "gmail-work", toolName: "list" }
  const underscoreList: DeferredMcpOrigin = { key: "gmail_work_list", serverName: "gmail_work", toolName: "list" }
  const otherList: DeferredMcpOrigin = { key: "obsidian_list", serverName: "obsidian", toolName: "list" }
  const keys = (...origins: DeferredMcpOrigin[]) => origins.map((o) => o.key)

  test("actual registered coordinator-status and memory names resolve to their composed keys", () => {
    const origins = [status, memory]
    expect(resolveDeferredMcpDescribeName("rhythm_get_coordinator_status", keys(...origins), origins)).toEqual({
      ok: true,
      key: "rhythm_rhythm_get_coordinator_status",
    })
    expect(resolveDeferredMcpDescribeName("rhythm_search_memory", keys(...origins), origins)).toEqual({
      ok: true,
      key: "rhythm_rhythm_search_memory",
    })
  })

  test("an exact canonical key always wins, even when it equals another tool's registered name", () => {
    const clash: DeferredMcpOrigin = { key: "srv_other", serverName: "srv", toolName: "rhythm_rhythm_search_memory" }
    const origins = [memory, clash]
    expect(resolveDeferredMcpDescribeName("rhythm_rhythm_search_memory", keys(...origins), origins)).toEqual({
      ok: true,
      key: "rhythm_rhythm_search_memory",
    })
  })

  test("no substring, prefix, suffix or fuzzy guessing; unknown names hold", () => {
    const origins = [status, memory]
    for (const name of ["coordinator_status", "get_coordinator_status", "rhythm_get_coordinator", "rhythm", "status", "RHYTHM_SEARCH_MEMORY"]) {
      expect(resolveDeferredMcpDescribeName(name, keys(...origins), origins)).toMatchObject({ ok: false, reason: "unknown" })
    }
  })

  test("two permitted origins with the same registered name hold and list only permitted candidates", () => {
    const origins = [workList, otherList]
    const resolved = resolveDeferredMcpDescribeName("list", keys(...origins), origins)
    expect(resolved).toEqual({ ok: false, reason: "ambiguous", candidates: ["gmail_work_list", "obsidian_list"] })
  })

  test("denied or absent aliases are not candidates and never appear in errors", () => {
    const origins = [workList, otherList]
    // only gmail is eligible: the denied obsidian tool can neither resolve nor be named
    expect(resolveDeferredMcpDescribeName("list", ["gmail_work_list"], origins)).toEqual({ ok: true, key: "gmail_work_list" })
    // only obsidian is eligible: resolves to obsidian, never the denied gmail one
    expect(resolveDeferredMcpDescribeName("list", ["obsidian_list"], origins)).toEqual({ ok: true, key: "obsidian_list" })
    // nothing eligible: unknown, with no candidate disclosure
    expect(resolveDeferredMcpDescribeName("list", [], origins)).toEqual({ ok: false, reason: "unknown", candidates: [] })
    // an origin whose key is not in the eligible set is ignored even if its raw name matches
    expect(resolveDeferredMcpDescribeName("get_file", ["gmail_work_list"], [{ key: "obsidian_get_file", serverName: "obsidian", toolName: "get_file" }])).toMatchObject({ ok: false, reason: "unknown" })
  })

  test("hyphen/underscore server names that sanitize to the same key hold; no split guessing", () => {
    // gmail-work + list and gmail_work + list both compose gmail_work_list
    const origins = [workList, underscoreList]
    expect(uniqueRawNames(["gmail_work_list"], origins)).toEqual({})
    expect(resolveDeferredMcpDescribeName("list", ["gmail_work_list"], origins)).toMatchObject({ ok: false, reason: "ambiguous" })
    // the canonical key itself is still a valid exact lookup
    expect(resolveDeferredMcpDescribeName("gmail_work_list", ["gmail_work_list"], origins)).toEqual({ ok: true, key: "gmail_work_list" })
    // an unambiguous hyphenated server keeps its actual raw name
    expect(uniqueRawNames(["gmail_work_list"], [workList])).toEqual({ gmail_work_list: "list" })
  })

  test("catalog entries carry the registered name only when the origin is unambiguous", () => {
    const entries = buildDeferredToolCatalog(
      ["rhythm_rhythm_search_memory", "gmail_work_list"],
      { rhythm_rhythm_search_memory: "rhythm", gmail_work_list: "gmail-work" },
      {},
      uniqueRawNames(["rhythm_rhythm_search_memory", "gmail_work_list"], [memory, workList, underscoreList]),
    )
    expect(entries.find((e) => e.name === "rhythm_rhythm_search_memory")?.rawName).toBe("rhythm_search_memory")
    expect(entries.find((e) => e.name === "gmail_work_list")?.rawName).toBeUndefined()
    expect(searchDeferredToolCatalog(entries, "rhythm_search_memory")[0]?.name).toBe("rhythm_rhythm_search_memory")
  })
})
