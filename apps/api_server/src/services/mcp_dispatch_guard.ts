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
 * Does `toolName` belong to `serverName`? Shared by both allowlist shapes — the
 * array-of-server-names inherit-all path (#812) and the object-map inherit-all
 * path (#736) — so server-membership is decided in exactly one place.
 *
 * `mcpServerRaw` is the server segment of an incoming `mcp__server__tool` name
 * (or undefined when the name isn't in that form).
 */
const toolBelongsToServer = (
  toolName: string,
  serverName: string,
  mcpServerRaw: string | undefined,
): boolean => {
  const sanitizedServer = sanitize(serverName);
  return (
    toolName === sanitizedServer ||
    toolName === serverName ||
    toolName.startsWith(`${sanitizedServer}_`) ||
    toolName.startsWith(`${serverName}_`) ||
    (mcpServerRaw != null &&
      (mcpServerRaw === serverName || sanitize(mcpServerRaw) === sanitizedServer))
  );
};

/**
 * Decide whether `toolName` is permitted by the session's persisted allowlist.
 *
 * Contract:
 *  - `allowedToolsJson === null` → the session is NOT role-scoped → ALWAYS
 *    allowed (full pass-through, #736 criterion 2). The caller is responsible
 *    for only invoking this guard when the session actually carries an
 *    mcp_role; this null short-circuit is a second belt.
 *  - Otherwise parse the JSON. TWO shapes are accepted, because the writers
 *    (agent_profile_scope, agent_runner) persist the array form while
 *    POST /agent-sessions can persist the object map:
 *      1. ARRAY of server names, e.g. `["rhythm","pco-services"]` (#812) →
 *         each named server is granted inherit-all (every tool of that server
 *         is allowed; a tool of an unlisted server is denied). Non-string
 *         members are ignored.
 *      2. OBJECT map `Record<serverName, string[]>` (#736) →
 *         - `tools` empty `[]`  → inherit-all for that server.
 *         - `tools` non-empty   → only the listed tools (matched bare, composed,
 *           or mcp__-prefixed) are allowed.
 *  - An empty array `[]` or empty object `{}` grants no servers → deny all.
 *  - A genuinely malformed shape (not array/object, unparseable, null) is
 *    treated as "deny everything" — a malformed allowlist must never silently
 *    widen access (fail-closed).
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

  let raw: unknown;
  try {
    raw = JSON.parse(allowedToolsJson) as unknown;
  } catch {
    // Unparseable allowlist → fail closed; never widen access on bad data.
    return false;
  }

  // Normalize an incoming mcp__server__tool form to its server/tool segments
  // for comparison, while keeping the original for bare-name checks.
  const mcpMatch = /^mcp__([^_].*?)__(.+)$/.exec(toolName);
  const mcpServerRaw = mcpMatch?.[1];
  const mcpToolRaw = mcpMatch?.[2];

  // ── Shape 1: array of server names → each granted inherit-all (#812). ──
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      if (toolBelongsToServer(toolName, entry, mcpServerRaw)) return true;
    }
    // Empty array, or no listed server owns this tool → deny.
    return false;
  }

  // ── Shape 2: object map { server: tools[] } (#736). ──
  if (raw == null || typeof raw !== 'object') {
    // Malformed / unexpected shape → fail closed.
    return false;
  }
  const parsed = raw as Record<string, unknown>;

  // An empty allowlist object means "no servers granted" → deny all.
  const serverNames = Object.keys(parsed);
  if (serverNames.length === 0) return false;

  for (const serverName of serverNames) {
    const tools = parsed[serverName];
    if (!Array.isArray(tools)) continue;
    const sanitizedServer = sanitize(serverName);

    if (tools.length === 0) {
      // Inherit-all for this server: allowed iff the tool belongs to it.
      if (toolBelongsToServer(toolName, serverName, mcpServerRaw)) return true;
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
