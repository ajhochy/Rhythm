/**
 * Rhythm carried patch (mcp-scope): per-session MCP tool-schema allowlisting.
 *
 * Pure helper consumed by resolveTools in prompt.ts. Kept in its own module
 * so it can be unit-tested without pulling in the full Effect runtime.
 */

/**
 * Filter a list of composed MCP tool keys by a session's mcpAllowlist.
 *
 * @param toolKeys    All composed keys returned by mcp.tools() (e.g. "srvA_tool1").
 * @param keyToServer Map from each composedKey to its raw clientName, built from
 *                    MCP state metadata — NOT by string-splitting on "_" (which
 *                    would break hyphenated server names like "gmail-work").
 * @param mcpAllowlist The session's allowlist, or undefined (back-compat pass-through).
 * @returns The subset of toolKeys that pass the allowlist check.
 *
 * Filtering logic:
 *   - undefined allowlist → all keys pass (back-compat; criterion 4).
 *   - else keep key k iff:
 *       mcpAllowlist.tools.includes(k)           (explicit tool key match)
 *       || mcpAllowlist.servers.includes(keyToServer[k])  (server-level match)
 *   - An id in mcpAllowlist.tools that maps to no server is silently absent (criterion 5).
 */
export function filterMcpToolsByAllowlist(
  toolKeys: string[],
  keyToServer: Record<string, string>,
  mcpAllowlist: { servers: string[]; tools: string[] } | undefined,
): string[] {
  if (mcpAllowlist === undefined) {
    return toolKeys
  }

  return toolKeys.filter((k) => {
    if (mcpAllowlist.tools.includes(k)) return true
    const server = keyToServer[k]
    if (server !== undefined && mcpAllowlist.servers.includes(server)) return true
    return false
  })
}
