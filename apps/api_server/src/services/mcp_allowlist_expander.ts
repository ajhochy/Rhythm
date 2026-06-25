/**
 * mcp_allowlist_expander.ts — Issue mcp-scope-05
 *
 * Pure function that expands an McpRoleConfig into two flat lists:
 *   - servers[]: server names whose tools are fully inherited (allowedTools absent or empty)
 *   - tools[]:   "<server>_<tool>" pairs for servers that have an explicit allowedTools list
 *
 * Servers listed in disabledMcpServers are excluded from both lists.
 * All identifiers are sanitized: /[^a-zA-Z0-9_-]/ → '_' (applied independently
 * to the server segment and the tool segment).
 *
 * This is a PURE DATA function — no file I/O, no DB, no HTTP.
 */

import type { McpRoleConfig } from './agent_profile_scope';

// ── Public types ──────────────────────────────────────────────────────────────

export interface McpAllowlist {
  /** Server names (sanitized) whose tools are fully inherited (all tools allowed). */
  servers: string[];
  /** Explicit tool grants in "<sanitized-server>_<sanitized-tool>" format. */
  tools: string[];
}

// ── Canonical sanitize ────────────────────────────────────────────────────────

/**
 * Sanitize a server or tool name segment.
 * Preserves alphanumerics, underscores, and hyphens.
 * Replaces all other characters (dots, colons, slashes, spaces, …) with '_'.
 */
const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');

// ── Type for the internal per-server config shape ─────────────────────────────

interface PerServerConfig {
  allowedTools?: string[];
  [key: string]: unknown;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Expand an McpRoleConfig into a flat McpAllowlist.
 *
 * Rules:
 *  1. Servers present in `disabledMcpServers` are excluded from both lists.
 *  2. A server with empty or absent `allowedTools` → sanitized server name
 *     emitted into `servers[]` (inherit-all). NOT into tools[].
 *  3. A server with non-empty `allowedTools` → for each tool emit
 *     `sanitize(server) + "_" + sanitize(tool)` into `tools[]`.
 *  4. Empty/absent `mcpServers` → `{ servers: [], tools: [] }`.
 */
export function expandMcpAllowlist(roleConfig: McpRoleConfig): McpAllowlist {
  const servers: string[] = [];
  const tools: string[] = [];

  // Access mcpServers — may be null/undefined in practice even though the type
  // says Record<string, unknown>; guard defensively.
  const mcpServers = roleConfig.mcpServers as Record<string, unknown> | null | undefined;
  if (!mcpServers || typeof mcpServers !== 'object') {
    return { servers, tools };
  }

  // Build the disabled set for O(1) lookup.
  // disabledMcpServers is not in the TypeScript type but IS present in the JSON
  // fixtures and real runtime objects — access via casting.
  const rawConfig = roleConfig as unknown as { disabledMcpServers?: unknown };
  const disabledSet = new Set<string>(
    Array.isArray(rawConfig.disabledMcpServers)
      ? (rawConfig.disabledMcpServers as unknown[]).filter(
          (s): s is string => typeof s === 'string',
        )
      : [],
  );

  for (const [serverName, serverValue] of Object.entries(mcpServers)) {
    // Skip disabled servers before anything else.
    if (disabledSet.has(serverName)) {
      continue;
    }

    // Extract allowedTools from the per-server config object.
    const perServer = (
      serverValue !== null && typeof serverValue === 'object' ? serverValue : {}
    ) as PerServerConfig;

    const allowedTools: string[] = Array.isArray(perServer.allowedTools)
      ? (perServer.allowedTools as unknown[]).filter(
          (t): t is string => typeof t === 'string',
        )
      : [];

    if (allowedTools.length === 0) {
      // Inherit-all: emit the RAW server name into servers[].
      // The engine (mcp-scope-02) compares mcpAllowlist.servers against the raw
      // clientName (MCP.toolClientNames() maps the sanitized composed key → raw
      // clientName). The servers[] entry is a set-membership key for that match,
      // NOT a model-facing identifier, so it must stay raw. Only the composed
      // <server>_<tool> ids in tools[] are sanitized (on both engine + expander).
      servers.push(serverName);
    } else {
      // Explicit list: emit "<sanitize(server)>_<sanitize(tool)>" for each tool.
      const sanitizedServer = sanitize(serverName);
      for (const tool of allowedTools) {
        tools.push(`${sanitizedServer}_${sanitize(tool)}`);
      }
    }
  }

  return { servers, tools };
}
