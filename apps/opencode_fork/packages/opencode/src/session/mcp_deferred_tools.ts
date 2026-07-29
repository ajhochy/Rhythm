/**
 * Rhythm carried patch (tokens-03, #843): deferred MCP tool schema loading.
 *
 * Prior art: this mirrors the skill-scope pattern already carried in this fork
 * (session/skill_allowlist.ts + tool/skill.ts, #775) — the model is offered a
 * cheap NAME + description catalog up front (here: for MCP tools instead of
 * skills) plus ONE dispatcher tool schema; the full per-tool JSON Schema is
 * resolved and the underlying tool executed only when the model actually
 * dispatches a call by name. Upstream sst/opencode has no native per-session
 * or lazy MCP schema loading (see docs/ai/decisions/2026-06-25-per-session-mcp-scoping-investigation.md,
 * Q3 — upstream issues #5373/#3756/#3612/#2888/#1101 are all open, unresolved,
 * and describe the same "schemas stay in context regardless of gating" gap).
 * No upstream lazy-loading implementation exists to mirror; this module is a
 * new-but-minimal pattern deliberately shaped like the existing skill-tool
 * dispatcher so it stays easy to reconcile with any future upstream fix.
 *
 * Pure helpers only — kept dependency-free (no Effect, no MCP client) so they
 * are unit-testable in isolation, exactly like mcp_allowlist.ts and
 * skill_allowlist.ts.
 */

/** The single dispatcher tool's id. Chosen to sort near other builtins and to
 * read unambiguously in tool-call transcripts. */
export const MCP_DISPATCH_TOOL_ID = "mcp_dispatch"

export interface DeferredMcpToolEntry {
  /** The composed key the model must pass to mcp_dispatch (e.g. "rhythm_ping"). */
  name: string
  /** Raw MCP server/client name the tool belongs to. */
  server: string
  /** The tool's own description (short — this is the cheap part). */
  description: string
}

/**
 * Build the names-only catalog of MCP tools available to a session, already
 * filtered by the session's mcpAllowlist (reusing the exact same allowlist
 * semantics as filterMcpToolsByAllowlist — see mcp_allowlist.ts — so
 * deferred-mode catalogs and eager-mode schema injection can never diverge on
 * which tools are in scope).
 *
 * @param toolKeys        All composed keys returned by mcp.tools().
 * @param keyToServer     composedKey -> raw clientName (see mcp_allowlist.ts).
 * @param descriptions    composedKey -> tool description (from MCP tool defs).
 * @param allowedKeys     The already-allowlist-filtered set of keys to include
 *                        (callers pass the output of filterMcpToolsByAllowlist
 *                        so the allowlist gate is applied exactly once, in one
 *                        place, for both eager and deferred modes).
 */
export function buildDeferredToolCatalog(
  allowedKeys: Iterable<string>,
  keyToServer: Record<string, string>,
  descriptions: Record<string, string>,
): DeferredMcpToolEntry[] {
  const entries: DeferredMcpToolEntry[] = []
  for (const key of allowedKeys) {
    entries.push({
      name: key,
      server: keyToServer[key] ?? "unknown",
      description: descriptions[key] ?? "",
    })
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Render the names-only catalog as the system-prompt block the model reads
 * to learn which MCP tools exist, mirroring Skill.fmt's <available_skills>
 * shape (session/system.ts / skill/index.ts fmt()).
 */
export function formatDeferredToolCatalog(entries: DeferredMcpToolEntry[]): string {
  if (entries.length === 0) return "No MCP tools are currently available."
  return [
    "<available_mcp_tools>",
    ...entries.flatMap((e) => [
      "  <mcp_tool>",
      `    <name>${e.name}</name>`,
      `    <server>${e.server}</server>`,
      `    <description>${e.description}</description>`,
      "  </mcp_tool>",
    ]),
    "</available_mcp_tools>",
  ].join("\n")
}

/**
 * Execute-time guard for the mcp_dispatch tool: is `name` still permitted
 * under the session's mcpAllowlist? Mirrors tool/skill.ts's isSkillAllowed
 * execute-time guard (#775) — the catalog already excludes out-of-scope
 * tools, but a model could still try to dispatch an out-of-scope name it
 * hallucinates or remembers from an earlier turn, so this must be re-checked
 * at call time, not just at listing time.
 *
 * Delegates to the exact same allowlist semantics as filterMcpToolsByAllowlist
 * (undefined allowlist = unrestricted; explicit tool key OR server-level
 * match) so the dispatch-time gate can never be more permissive than the
 * listing-time gate.
 */
export function isDeferredMcpToolAllowed(
  name: string,
  keyToServer: Record<string, string>,
  mcpAllowlist: { servers: string[]; tools: string[] } | undefined,
): boolean {
  if (mcpAllowlist === undefined) return true
  if (mcpAllowlist.tools.includes(name)) return true
  const server = keyToServer[name]
  if (server !== undefined && mcpAllowlist.servers.includes(server)) return true
  return false
}

/** Whether an allowlisted key belongs in the dispatcher rather than eager schemas. */
export function isMcpToolDeferred(
  name: string,
  keyToServer: Record<string, string>,
  mcpAllowlist:
    | { deferred?: boolean; deferredServers?: string[] }
    | undefined,
): boolean {
  if (mcpAllowlist?.deferred === true) return true
  const server = keyToServer[name]
  return server !== undefined && (mcpAllowlist?.deferredServers ?? []).includes(server)
}
