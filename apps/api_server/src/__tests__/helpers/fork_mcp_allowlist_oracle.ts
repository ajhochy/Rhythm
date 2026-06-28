/**
 * Issue #765 — vendored copy of the fork's per-session MCP tool gate.
 *
 * This is a VERBATIM copy of the enforcement function the running fork uses to
 * decide which MCP tool schemas are injected into model context:
 *   apps/opencode_fork/packages/opencode/src/session/prompt.ts (resolveTools)
 *   → apps/opencode_fork/packages/opencode/src/session/mcp_allowlist.ts
 *
 * Why vendored instead of imported: the api_server TS project sets
 * `rootDir: src`, so a cross-package import of the fork source fails
 * `tsc --noEmit` (TS6059) even though the vitest/esbuild runtime resolves it.
 * To keep the end-to-end test tsc-clean AND faithful, we copy the function
 * here and add a DRIFT GUARD test (issue_secretary_profile_scope.test.ts) that
 * reads the fork source at runtime and asserts the bodies are identical. If the
 * fork's filter ever changes, the guard goes red — so this copy can never
 * silently diverge from the real enforcement code.
 *
 * Keep this body byte-for-byte identical to the fork's exported function body.
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
