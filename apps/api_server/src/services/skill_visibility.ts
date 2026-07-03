/**
 * skill_visibility.ts — #875 (setup-05): conditional skill activation by
 * connected toolsets.
 *
 * A skill's SKILL.md can declare (under `metadata.rhythm`, parsed by
 * skill_frontmatter.ts):
 *
 *   requires_toolsets: [terminal]   — hidden unless EVERY listed toolset is connected
 *   fallback_for_toolsets: [web]    — hidden if ANY listed toolset IS connected
 *
 * `isSkillVisible` is a pure predicate: (frontmatter, SessionToolsetConfig) -> boolean.
 * A skill declaring neither field is always visible (no regression for existing skills).
 *
 * SCOPE (composes with, does not replace, #775's allowlist): this is a
 * DISCOVERY/LISTING filter only, applied by callers alongside — not instead
 * of — the existing `allowed_skills_json` profile allowlist
 * (agent_profile_scope.ts -> resolveProfileScope -> ws_gateway/agent_runner's
 * `wsSkillNames` -> opencodeClient.updateSessionSkillAllowlist, which is what
 * the fork actually enforces at prompt/execute time via
 * apps/opencode_fork/.../session/skill_allowlist.ts). A skill can pass the
 * allowlist gate but still be hidden by toolset visibility, and vice versa —
 * both gates must pass for a skill to be listed/injected. Per the issue, this
 * does NOT prevent directly invoking a hidden skill by name if the caller
 * already knows it — only list/discovery is filtered here.
 *
 * TOOLSET IDENTIFIER NAMESPACE (documented per the issue's requirement that it
 * not be implicit):
 *   - "terminal" — the session's built-in shell/bash tool is enabled
 *   - "web"      — a general-purpose web-search/fetch capability is enabled
 *                  (a curated "web" MCP server, e.g. Firecrawl-style, OR the
 *                  built-in web fetch/search tool)
 *   - "browser"  — a browser-automation capability is enabled (Chrome/CDP-style
 *                  MCP servers, e.g. claude-in-chrome, superpowers-chrome)
 *   - "mcp"      — shorthand meaning "at least one MCP server is connected",
 *                  for skills that only care that SOME external tool exists
 *   - any other string — treated as a literal MCP server id (e.g.
 *                  "ableton-mcp", "nfl_mcp") and checked against the
 *                  session's connected MCP server set
 *
 * `SessionToolsetConfig.toolsets` is the resolved, session-scoped set of
 * identifiers from this namespace that are currently connected/enabled — see
 * `resolveSessionToolsets` in session_toolset_resolver.ts for how it's built
 * from live engine state.
 */

import type { SkillFrontmatter } from './skill_frontmatter';

export interface SessionToolsetConfig {
  /** The resolved set of toolset identifiers connected/enabled for this session. */
  toolsets: Set<string>;
}

/** True iff every id in `ids` is present in `config.toolsets`. Vacuously true for an empty list. */
function allConnected(ids: string[], config: SessionToolsetConfig): boolean {
  return ids.every((id) => config.toolsets.has(id));
}

/** True iff at least one id in `ids` is present in `config.toolsets`. False for an empty list. */
function anyConnected(ids: string[], config: SessionToolsetConfig): boolean {
  return ids.some((id) => config.toolsets.has(id));
}

/**
 * Evaluate whether a skill should be visible (listed/injected) for a session
 * given its resolved toolset config.
 *
 *   - No requiresToolsets AND no fallbackForToolsets → always visible.
 *   - requiresToolsets non-empty → visible only if ALL are connected.
 *   - fallbackForToolsets non-empty → visible only if NONE are connected.
 *   - Both present → both conditions must hold (AND).
 */
export function isSkillVisible(
  frontmatter: Pick<SkillFrontmatter, 'requiresToolsets' | 'fallbackForToolsets'>,
  config: SessionToolsetConfig,
): boolean {
  const requires = frontmatter.requiresToolsets ?? [];
  const fallbackFor = frontmatter.fallbackForToolsets ?? [];

  if (requires.length === 0 && fallbackFor.length === 0) return true;

  const requiresOk = requires.length === 0 || allConnected(requires, config);
  const fallbackOk = fallbackFor.length === 0 || !anyConnected(fallbackFor, config);

  return requiresOk && fallbackOk;
}
