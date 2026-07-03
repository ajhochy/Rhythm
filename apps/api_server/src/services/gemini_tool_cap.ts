/**
 * gemini_tool_cap.ts — issue #884
 *
 * Gemini's `GenerateContentRequest` proto rejects requests with more than 512
 * function declarations ("At most 512 function declarations can be
 * specified."). Rhythm sessions can be handed an unscoped ("inherit-all" /
 * `Allow all`) MCP surface — or fall back from Claude to the `google`
 * provider via `ROUTE_FALLBACKS_BY_AGENT` — and exceed that cap, which the
 * engine surfaces as a raw 400 mid-run (sometimes an aborted run) instead of
 * a graceful degradation.
 *
 * This module is a PURE, deterministic guard: given an expanded
 * {@link McpAllowlist} (the same `{ servers, tools }` shape
 * `expandMcpAllowlist` produces) and the resolved provider ID for the
 * session/turn, it trims the allowlist down to (a safety margin under) the
 * cap when — and only when — the provider is `google`. Non-google providers
 * are returned completely untouched (no behavior change).
 *
 * Trim policy (deterministic, cheapest-first):
 *   1. Builtins (always present, not counted here — see `builtinReserve`)
 *      reserve headroom off the top of the cap.
 *   2. Explicit `tools[]` entries are kept first, in their existing order,
 *      up to the remaining budget — this is the ALREADY-SCOPED, most
 *      deliberately-chosen part of the surface (a profile's explicit
 *      allowlist), so it is preferred over blanket "inherit-all" servers.
 *   3. `servers[]` (inherit-all servers, whose real tool count is unknown —
 *      see `PER_SERVER_INHERIT_ALL_ESTIMATE`) are kept next, in order, each
 *      charged at the flat per-server estimate, until the budget runs out.
 *   4. Anything that doesn't fit is dropped. The function never throws and
 *      never silently succeeds without a flag: `trimmed` is true whenever
 *      anything was dropped, and `warning` carries a machine-readable,
 *      human-readable message the caller can log / surface as a
 *      statusMessage — the turn itself must still proceed with the trimmed
 *      set rather than fail outright (graceful degradation, per the issue's
 *      acceptance criteria).
 */

import type { McpAllowlist } from './mcp_allowlist_expander';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Gemini's hard proto limit on function declarations per request. */
export const GEMINI_MAX_FUNCTION_DECLARATIONS = 512;

/**
 * Safety margin below the hard cap to leave headroom for opencode's builtin
 * tools (bash, read, edit, …) and any provider-injected declarations that
 * aren't visible to this module. Target ceiling is documented in the issue
 * as "≤ ~500 including built-ins" — we reserve 12 slots (the current
 * `BUILTIN_TOOLS` list in `tool_surface_estimator.ts` has 13 entries; 12 is a
 * deliberately close-but-not-exact reservation so a future builtin addition
 * doesn't immediately blow the margin, without having to import that list
 * here and couple two independently-evolving modules).
 */
export const GEMINI_BUILTIN_RESERVE = 12;

/** Effective ceiling on MCP-derived (non-builtin) declarations. */
export const GEMINI_MCP_TOOL_BUDGET = GEMINI_MAX_FUNCTION_DECLARATIONS - GEMINI_BUILTIN_RESERVE;

/**
 * Flat per-server estimate for an "inherit-all" server entry (real count
 * unknown at this layer — mirrors `INHERIT_ALL_TOOL_COUNT_ESTIMATE` in
 * `tool_surface_estimator.ts`, duplicated rather than imported to keep this
 * guard's budget math independent/pure and because the two constants are
 * allowed to diverge if either module's calibration changes).
 */
const PER_SERVER_INHERIT_ALL_ESTIMATE = 25;

// ── Public types ──────────────────────────────────────────────────────────────

export interface GeminiToolCapResult {
  /** The (possibly trimmed) allowlist to actually push to the engine. */
  allowlist: McpAllowlist;
  /** True when anything was removed from the original allowlist. */
  trimmed: boolean;
  /** Estimated tool-declaration count BEFORE trimming (tools.length + servers.length * per-server estimate). */
  originalEstimatedCount: number;
  /** Estimated tool-declaration count AFTER trimming. */
  cappedEstimatedCount: number;
  /**
   * Machine-readable + human-readable warning, set only when `trimmed` is
   * true. Callers should log it and MAY surface it to the user as a
   * statusMessage — the turn must still proceed with the trimmed set.
   */
  warning: string | null;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Apply the Gemini function-declaration cap to an expanded allowlist.
 *
 * No-op (returns the input allowlist unchanged, `trimmed: false`) when:
 *   - `providerId` is not `'google'`, OR
 *   - the estimated count is already within {@link GEMINI_MCP_TOOL_BUDGET}.
 *
 * Never throws.
 */
export function capMcpAllowlistForProvider(
  allowlist: McpAllowlist,
  providerId: string | null | undefined,
): GeminiToolCapResult {
  const originalEstimatedCount = estimateCount(allowlist);

  if (providerId !== 'google') {
    return {
      allowlist,
      trimmed: false,
      originalEstimatedCount,
      cappedEstimatedCount: originalEstimatedCount,
      warning: null,
    };
  }

  if (originalEstimatedCount <= GEMINI_MCP_TOOL_BUDGET) {
    return {
      allowlist,
      trimmed: false,
      originalEstimatedCount,
      cappedEstimatedCount: originalEstimatedCount,
      warning: null,
    };
  }

  // Over budget — trim deterministically: explicit tools[] first (already
  // the most deliberately-scoped part of the surface), then inherit-all
  // servers[], each charged at the flat per-server estimate.
  const keptTools: string[] = [];
  let remaining = GEMINI_MCP_TOOL_BUDGET;

  for (const tool of allowlist.tools) {
    if (remaining <= 0) break;
    keptTools.push(tool);
    remaining -= 1;
  }

  const keptServers: string[] = [];
  for (const server of allowlist.servers) {
    if (remaining < PER_SERVER_INHERIT_ALL_ESTIMATE) break;
    keptServers.push(server);
    remaining -= PER_SERVER_INHERIT_ALL_ESTIMATE;
  }

  const droppedToolCount = allowlist.tools.length - keptTools.length;
  const droppedServerCount = allowlist.servers.length - keptServers.length;

  const cappedAllowlist: McpAllowlist = { servers: keptServers, tools: keptTools };
  const cappedEstimatedCount = estimateCount(cappedAllowlist);

  const warning =
    `[GeminiToolCap] tool surface exceeded Gemini's ${GEMINI_MAX_FUNCTION_DECLARATIONS}-function-declaration cap ` +
    `(estimated ${originalEstimatedCount}, budget ${GEMINI_MCP_TOOL_BUDGET} after builtin reserve) — trimmed to ` +
    `${cappedEstimatedCount} (dropped ${droppedToolCount} explicit tool(s), ${droppedServerCount} inherit-all server(s)).`;

  return {
    allowlist: cappedAllowlist,
    trimmed: true,
    originalEstimatedCount,
    cappedEstimatedCount,
    warning,
  };
}

function estimateCount(allowlist: McpAllowlist): number {
  return allowlist.tools.length + allowlist.servers.length * PER_SERVER_INHERIT_ALL_ESTIMATE;
}
