/**
 * mcp_dispatch_guard.ts — Issue #736 (Layer 2: WS-gateway dispatch backstop)
 *
 * Runtime, dispatch-time tool-gating. C1 (PR #734) persists `mcp_role` and
 * `mcp_allowed_tools_json` on the agent_sessions row but does NOT enforce them
 * when a tool actually fires. This module is the enforcement: a pure predicate
 * that decides whether a given tool name is permitted by a session's persisted
 * allowlist, used by the OpencodeStreamBridge to reject out-of-allowlist tool
 * calls before they execute/complete.
 *
 * This is the Rhythm analog of Odysseus's `_execute_tool_block_impl` policy
 * backstop — defense-in-depth behind Layer 1 (#765), which scopes the servers
 * advertised at session-creation time. Layer 1 can fail (advertise-time bug,
 * a hidden/model-emitted tool, a server that ignores the filter); Layer 2
 * re-checks at the moment of dispatch.
 *
 * PURE: no I/O. The caller supplies the session's persisted
 * `mcpAllowedToolsJson` string (or null) read from the DB row.
 */

/**
 * Sanitize a server or tool name segment the same way the allowlist expander
 * and the engine do — preserve [A-Za-z0-9_-], replace everything else with '_'.
 * Keeps the composed `<server>_<tool>` comparison consistent with the ids the
 * opencode engine actually emits.
 */
const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Decide whether `toolName` is permitted by the session's persisted allowlist.
 *
 * Contract:
 *  - `allowedToolsJson === null` → the session is NOT role-scoped → ALWAYS
 *    allowed (full pass-through, #736 criterion 2). The caller is responsible
 *    for only invoking this guard when the session actually carries an
 *    mcp_role; this null short-circuit is a second belt.
 *  - Otherwise parse the JSON as `Record<serverName, string[]>` (the exact
 *    shape POST /agent-sessions persists):
 *      - `tools` empty `[]`  → inherit-all: any tool belonging to that server
 *        is allowed (matched by server prefix).
 *      - `tools` non-empty   → only the listed tools (matched bare, composed,
 *        or mcp__-prefixed) are allowed.
 *  - A parse failure is treated as "deny everything" — a malformed allowlist
 *    must never silently widen access (fail-closed).
 *
 * Tool-name forms handled (the opencode engine composes MCP tool ids as
 * `<sanitized-server>_<sanitized-tool>`; builtins arrive bare like `bash`,
 * `read`, `edit`; Claude-style `mcp__<server>__<tool>` is also accepted
 * defensively):
 *   - bare builtin:        `read`, `bash`
 *   - composed MCP:        `rhythm_list_tasks`, `gmail-work_search_emails`
 *   - mcp__ prefixed:      `mcp__rhythm__rhythm_list_tasks`
 */
export function isToolAllowed(
  toolName: string,
  allowedToolsJson: string | null | undefined,
): boolean {
  // Not role-scoped → unrestricted.
  if (allowedToolsJson == null) return true;

  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(allowedToolsJson) as unknown;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      // Malformed / unexpected shape → fail closed.
      return false;
    }
    parsed = raw as Record<string, unknown>;
  } catch {
    // Unparseable allowlist → fail closed; never widen access on bad data.
    return false;
  }

  // An empty allowlist object means "no servers granted" → deny all.
  const serverNames = Object.keys(parsed);
  if (serverNames.length === 0) return false;

  // Normalize an incoming mcp__server__tool form to the composed server_tool
  // shape for comparison, while keeping the original for bare-name checks.
  const mcpMatch = /^mcp__([^_].*?)__(.+)$/.exec(toolName);
  const mcpServerRaw = mcpMatch?.[1];
  const mcpToolRaw = mcpMatch?.[2];

  for (const serverName of serverNames) {
    const tools = parsed[serverName];
    if (!Array.isArray(tools)) continue;
    const sanitizedServer = sanitize(serverName);

    // Does this incoming tool even belong to this server?
    const belongsToServer =
      toolName === sanitizedServer ||
      toolName === serverName ||
      toolName.startsWith(`${sanitizedServer}_`) ||
      toolName.startsWith(`${serverName}_`) ||
      (mcpServerRaw != null &&
        (mcpServerRaw === serverName || sanitize(mcpServerRaw) === sanitizedServer));

    if (tools.length === 0) {
      // Inherit-all for this server: allowed iff the tool belongs to it.
      if (belongsToServer) return true;
      continue;
    }

    // Explicit per-tool list: allowed iff the incoming name matches one grant.
    for (const t of tools) {
      if (typeof t !== 'string') continue;
      const sanitizedTool = sanitize(t);
      const composed = `${sanitizedServer}_${sanitizedTool}`;
      if (
        toolName === t ||
        toolName === sanitizedTool ||
        toolName === composed ||
        // mcp__server__tool form: compare the tool segment.
        (mcpToolRaw != null &&
          (mcpToolRaw === t || sanitize(mcpToolRaw) === sanitizedTool))
      ) {
        return true;
      }
    }
  }

  return false;
}
