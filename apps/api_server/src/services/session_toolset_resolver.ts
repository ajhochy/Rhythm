/**
 * session_toolset_resolver.ts — #875 (setup-05): resolves a session's
 * connected/enabled toolset identifiers from live engine state, for
 * skill_visibility.ts's `isSkillVisible` gate.
 *
 * See skill_visibility.ts for the full documented toolset-identifier
 * namespace. This module owns the ONE place that namespace is derived from
 * reality:
 *
 *   - named MCP server ids   — verbatim from opencodeClient.listMcp(), filtered
 *                              to servers whose status is 'connected' (a
 *                              'failed'/'disabled'/'needs_auth' server is not
 *                              "connected" and must not make a fallback skill
 *                              disappear nor a requires_toolsets skill appear).
 *   - "mcp"                  — present iff at least one server is connected.
 *   - "web" / "browser"      — present iff any connected server id matches a
 *                              known naming convention for that capability
 *                              (curated list below; additive, documented so
 *                              adding a new server under an existing
 *                              convention doesn't require a code change here,
 *                              but a genuinely new naming pattern does).
 *   - "terminal"             — Rhythm has no per-session terminal on/off
 *                              toggle today (unlike MCP servers, the shell/bash
 *                              tool is a session-wide built-in) — defaults to
 *                              enabled, overridable via `opts.terminalEnabled`
 *                              for callers that DO have a scoping signal (e.g.
 *                              a future agent-profile permission).
 *
 * Fail-open on any listMcp() failure (engine not ready, etc.) — an outage
 * must never make requires_toolsets skills flicker visible/invisible in a
 * surprising way; it degrades to "no MCP-backed toolsets connected", the same
 * posture as `agent_profile_sync.ts`'s `liveMcpNames` fail-safe.
 */

import { opencodeClient } from './opencode_engine';
import { logger } from '../utils/logger';
import type { SessionToolsetConfig } from './skill_visibility';

/** MCP server id substrings that map to the "web" toolset identifier. */
const WEB_SERVER_PATTERNS = [/^web$/i, /firecrawl/i, /duckduckgo/i, /websearch/i];
/** MCP server id substrings that map to the "browser" toolset identifier. */
const BROWSER_SERVER_PATTERNS = [/^browser$/i, /chrome/i, /playwright/i, /puppeteer/i];

export interface ResolveSessionToolsetsOptions {
  /** Injectable MCP status reader (defaults to opencodeClient.listMcp). */
  listMcp?: () => Promise<Record<string, { status: string }>>;
  /**
   * Whether the session's terminal/shell tool is enabled. Rhythm has no
   * per-session scoping signal for this yet, so it defaults to true (the
   * de-facto current behavior — every session has shell access) rather than
   * silently hiding every `requires_toolsets: [terminal]` skill.
   */
  terminalEnabled?: boolean;
}

function matchesAny(id: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(id));
}

/**
 * Resolve the current session's connected toolset identifiers. Never throws.
 */
export async function resolveSessionToolsets(
  opts: ResolveSessionToolsetsOptions = {},
): Promise<SessionToolsetConfig> {
  const listMcp = opts.listMcp ?? (() => opencodeClient.listMcp());
  const terminalEnabled = opts.terminalEnabled ?? true;

  const toolsets = new Set<string>();
  if (terminalEnabled) toolsets.add('terminal');

  let statusMap: Record<string, { status: string }> = {};
  try {
    statusMap = await listMcp();
  } catch (err) {
    logger.warn(`[session-toolset-resolver] listMcp failed (non-fatal, fail-open): ${String(err)}`);
    return { toolsets };
  }

  const connectedIds = Object.entries(statusMap)
    .filter(([, entry]) => entry?.status === 'connected')
    .map(([id]) => id);

  for (const id of connectedIds) {
    toolsets.add(id);
    if (matchesAny(id, WEB_SERVER_PATTERNS)) toolsets.add('web');
    if (matchesAny(id, BROWSER_SERVER_PATTERNS)) toolsets.add('browser');
  }

  if (connectedIds.length > 0) toolsets.add('mcp');

  return { toolsets };
}
