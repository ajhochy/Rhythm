/**
 * tool_surface_estimator.ts — issue #841 (tokens-01)
 *
 * Pure, deterministic estimate of the tool-surface cost of an agent session:
 * tool count + estimated schema tokens per MCP server + builtins, and a
 * session total. No I/O beyond reading a `.mcp-roles/<role>.mcp.json` file
 * when a role is given (mirrors the same file the session-create path in
 * `agent_sessions_controller.ts#resolveMcpRole` already reads at init time —
 * this is a read-only, side-effect-free re-read for reporting purposes).
 *
 * WHY `.mcp-roles` files and not a live SDK tool-schema call: the opencode SDK
 * exposes `client.tool.list()` (GET /experimental/tool), but it is
 * engine-global — filtered only by provider+model, not by a session's
 * resolved MCP allowlist — so it cannot answer "what did THIS session's scope
 * actually advertise" without re-deriving the per-session filter anyway. The
 * `.mcp-roles/<role>.mcp.json` file (and a session's persisted
 * `mcp_allowed_tools_json`) IS the source of truth for what was advertised at
 * session-create time (see `agent_sessions_controller.ts` `resolveMcpRole` /
 * `mcpRoleConfig`), so estimating from it is both accurate to what actually
 * happened and avoids a live per-tool-schema engine round trip on every
 * report request.
 *
 * ESTIMATION METHOD (chars/4 — comparability over precision, per the issue):
 * for each server, the "schema payload" stand-in is the JSON-stringified
 * per-server role-file entry (its allowedTools array, or a fixed one-tool
 * inherit-all placeholder when the server is unscoped) PLUS a fixed per-tool
 * overhead constant representing the average real MCP tool schema size (name +
 * description + JSON Schema for parameters). The per-tool overhead constant is
 * calibrated from real observed tool schemas being roughly 400-600 chars each
 * when stringified (name + description + input schema); we use 500 chars/tool
 * as the flat estimate unit, matching the issue's explicit "comparability over
 * precision" mandate. Builtins use the same per-tool constant.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ToolSurfaceServerEntry {
  name: string;
  toolCount: number;
  estimatedTokens: number;
}

export interface ToolSurfaceReport {
  /** Role slug used to compute this report, or null for an unscoped session. */
  mcpRole: string | null;
  servers: ToolSurfaceServerEntry[];
  builtins: ToolSurfaceServerEntry;
  totalToolCount: number;
  totalEstimatedTokens: number;
}

export interface EstimateToolSurfaceOptions {
  /** Role slug (e.g. "secretary"), or null/undefined for an unscoped session. */
  mcpRole?: string | null;
  /**
   * Directory containing `<role>.mcp.json` files. Defaults to the repo-root
   * `.mcp-roles/` directory (same default resolution as
   * `agent_sessions_controller.ts`'s `MCP_ROLES_DIR`, override-able via the
   * `MCP_ROLES_DIR` env var for bundled deployments).
   */
  mcpRolesDir?: string;
  /**
   * Server names connected/available to an UNSCOPED session (no mcpRole).
   * When omitted for an unscoped session, defaults to `[]` (builtins-only
   * floor) — callers with a live `listMcp()` status map should pass its keys.
   */
  connectedServerNames?: string[];
  /**
   * Pre-resolved per-server allowedTools map (e.g. a session's persisted
   * `mcp_allowed_tools_json`), used INSTEAD of re-reading the role file when
   * provided. Takes precedence over `mcpRole` + `mcpRolesDir` when set.
   */
  resolvedAllowedTools?: Record<string, string[]> | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Standard opencode built-in tools available to every session regardless of
 * MCP scoping (the "bare" tool names referenced in `mcp_dispatch_guard.ts`'s
 * tool-name-forms doc comment: `read`, `bash`, `edit`, etc.). Rhythm does not
 * hardcode this set anywhere else today (confirmed: no existing "builtin
 * tools" list in src/ — see docs/ai/runs for #841 research) — this is the
 * first canonical list and should be extended if opencode adds new built-ins.
 */
export const BUILTIN_TOOLS: readonly string[] = [
  'bash',
  'read',
  'write',
  'edit',
  'multiedit',
  'glob',
  'grep',
  'list',
  'patch',
  'todowrite',
  'todoread',
  'task',
  'webfetch',
];

/**
 * Flat per-tool character estimate (name + description + JSON Schema for
 * parameters), used for BOTH MCP tools and builtins. Calibrated against
 * typical MCP tool schema sizes (roughly 400-600 stringified chars per tool);
 * 500 is the round, documented estimate. This is a deliberate approximation —
 * the issue explicitly asks for chars/4 comparability, not per-tool schema
 * fidelity.
 */
const CHARS_PER_TOOL_ESTIMATE = 500;

/** chars/4 estimation, per the issue's explicit acceptance criterion. */
const CHARS_PER_TOKEN = 4;

function tokensForToolCount(toolCount: number): number {
  return Math.round((toolCount * CHARS_PER_TOOL_ESTIMATE) / CHARS_PER_TOKEN);
}

// ── Role-file reading ─────────────────────────────────────────────────────────

interface McpRoleFileShape {
  mcpServers?: Record<string, { allowedTools?: string[]; [k: string]: unknown }>;
  disabledMcpServers?: string[];
}

function defaultMcpRolesDir(): string {
  return (
    process.env.MCP_ROLES_DIR ??
    path.join(__dirname, '..', '..', '..', '..', '.mcp-roles')
  );
}

/**
 * Read a `.mcp-roles/<role>.mcp.json` file. Returns null on any failure
 * (missing file, bad JSON, missing mcpServers) rather than throwing — a
 * reporting endpoint must never 500 because a role file is momentarily
 * unreadable; the caller treats null the same as "no server breakdown
 * available" and still returns a builtins-only report.
 */
function readRoleFile(role: string, mcpRolesDir: string): McpRoleFileShape | null {
  // Same slug validation as agent_sessions_controller.ts#resolveMcpRole —
  // reject path-traversal-shaped input defensively even though callers here
  // are expected to pass an already-validated, persisted role slug.
  if (!/^[a-z0-9-]+$/.test(role)) return null;

  const resolved = path.resolve(mcpRolesDir, `${role}.mcp.json`);
  const resolvedDir = path.resolve(mcpRolesDir);
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) return null;
  if (!existsSync(resolved)) return null;

  try {
    const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'mcpServers' in parsed &&
      typeof (parsed as Record<string, unknown>).mcpServers === 'object'
    ) {
      return parsed as McpRoleFileShape;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Estimated tool count for an "inherit-all" server entry — i.e. a server with
 * no explicit `allowedTools` restriction (absent/empty array, or the literal
 * `["*"]` sentinel used by dev.mcp.json), or any server an UNSCOPED session
 * simply has connected with no allowlist at all.
 *
 * The true count is unknowable without a live per-server tool-schema fetch
 * (see the module doc comment on why we don't do that), so this is a
 * calibrated typical-server estimate rather than a bare floor of 1 — a floor
 * of 1 would make inherit-all/unscoped servers look CHEAPER than an
 * explicitly-scoped allowlist, which inverts the entire point of #841/#842
 * (unscoped access should read as materially MORE expensive, not less).
 * Calibrated against real observed MCP servers in this environment (e.g. the
 * `rhythm` server alone exposes 60+ tools; `propresenter` exposes 150+); 25 is
 * a conservative typical-server estimate, not a worst case.
 */
const INHERIT_ALL_TOOL_COUNT_ESTIMATE = 25;
export const FAT_SERVER_TOOL_COUNT = 30;

function toolCountForServerEntry(entry: { allowedTools?: string[] } | string[] | undefined): number {
  const allowedTools = Array.isArray(entry) ? entry : entry?.allowedTools;
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return INHERIT_ALL_TOOL_COUNT_ESTIMATE;
  }
  if (allowedTools.length === 1 && allowedTools[0] === '*') {
    return INHERIT_ALL_TOOL_COUNT_ESTIMATE;
  }
  return allowedTools.length;
}

/** Derive per-server counts from the same role config used by the allowlist expander. */
export function toolCountsForRoleConfig(
  mcpServers: Record<string, unknown>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, value]) => [
      name,
      toolCountForServerEntry(
        value && typeof value === 'object'
          ? (value as { allowedTools?: string[] })
          : undefined,
      ),
    ]),
  );
}

export function applySelectiveDeferral<T extends { servers: string[]; tools: string[] }>(
  allowlist: T,
  toolCounts: Record<string, number>,
  _providerId?: string | null,
): T & { deferredServers?: string[] } {
  const deferredServers = Object.entries(toolCounts)
    .filter(([name, count]) => {
      const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const authorized =
        allowlist.servers.includes(name) ||
        allowlist.tools.some((tool) => tool.startsWith(`${sanitizedName}_`));
      return authorized && count >= FAT_SERVER_TOOL_COUNT;
    })
    .map(([name]) => name)
    .sort();
  return deferredServers.length === 0 ? allowlist : { ...allowlist, deferredServers };
}

export function estimateSelectiveDeferral(
  report: ToolSurfaceReport,
  deferredServers: string[],
): { beforeEstimatedTokens: number; afterEstimatedTokens: number; savedEstimatedTokens: number } {
  const deferred = new Set(deferredServers);
  const eagerServerTokens = report.servers
    .filter((server) => !deferred.has(server.name))
    .reduce((sum, server) => sum + server.estimatedTokens, 0);
  const dispatcherTokens = deferred.size > 0 ? tokensForToolCount(1) : 0;
  const afterEstimatedTokens = report.builtins.estimatedTokens + eagerServerTokens + dispatcherTokens;
  return {
    beforeEstimatedTokens: report.totalEstimatedTokens,
    afterEstimatedTokens,
    savedEstimatedTokens: report.totalEstimatedTokens - afterEstimatedTokens,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Estimate the tool-surface cost of a session.
 *
 * Resolution order for the per-server breakdown:
 *   1. `resolvedAllowedTools` (session's persisted map) if provided.
 *   2. `mcpRole` → read `<mcpRolesDir>/<mcpRole>.mcp.json` and derive from its
 *      `mcpServers` map (respecting `disabledMcpServers`).
 *   3. Neither → unscoped session: use `connectedServerNames` (default `[]`)
 *      as an inherit-all-per-server list (each counted at the floor).
 *
 * Builtins are always counted (every session gets the standard opencode
 * built-in tools regardless of MCP scoping).
 */
export function estimateToolSurface(options: EstimateToolSurfaceOptions): ToolSurfaceReport {
  const mcpRolesDir = options.mcpRolesDir ?? defaultMcpRolesDir();
  const servers: ToolSurfaceServerEntry[] = [];

  if (options.resolvedAllowedTools && Object.keys(options.resolvedAllowedTools).length > 0) {
    for (const [serverName, tools] of Object.entries(options.resolvedAllowedTools)) {
      const toolCount = toolCountForServerEntry(tools);
      servers.push({ name: serverName, toolCount, estimatedTokens: tokensForToolCount(toolCount) });
    }
  } else if (options.mcpRole) {
    const roleFile = readRoleFile(options.mcpRole, mcpRolesDir);
    if (roleFile?.mcpServers) {
      const disabled = new Set(roleFile.disabledMcpServers ?? []);
      for (const [serverName, serverCfg] of Object.entries(roleFile.mcpServers)) {
        if (disabled.has(serverName)) continue;
        const toolCount = toolCountForServerEntry(serverCfg);
        servers.push({ name: serverName, toolCount, estimatedTokens: tokensForToolCount(toolCount) });
      }
    }
  } else if (options.connectedServerNames && options.connectedServerNames.length > 0) {
    // Unscoped session: every connected server is inherit-all, estimated at
    // INHERIT_ALL_TOOL_COUNT_ESTIMATE each — see #842 (scoped-by-default),
    // which surfaces this same "unscoped is materially more expensive" signal
    // as a reason to prefer scoped sessions by default.
    for (const serverName of options.connectedServerNames) {
      const toolCount = INHERIT_ALL_TOOL_COUNT_ESTIMATE;
      servers.push({ name: serverName, toolCount, estimatedTokens: tokensForToolCount(toolCount) });
    }
  }

  const builtinsCount = BUILTIN_TOOLS.length;
  const builtins: ToolSurfaceServerEntry = {
    name: 'builtins',
    toolCount: builtinsCount,
    estimatedTokens: tokensForToolCount(builtinsCount),
  };

  const totalToolCount = servers.reduce((acc, s) => acc + s.toolCount, 0) + builtins.toolCount;
  const totalEstimatedTokens =
    servers.reduce((acc, s) => acc + s.estimatedTokens, 0) + builtins.estimatedTokens;

  return {
    mcpRole: options.mcpRole ?? null,
    servers,
    builtins,
    totalToolCount,
    totalEstimatedTokens,
  };
}
