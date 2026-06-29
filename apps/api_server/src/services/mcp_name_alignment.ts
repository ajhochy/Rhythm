/**
 * mcp_name_alignment.ts — Issue #789 (mcp-unify-05; subsumes #781)
 *
 * Name-drift reconciliation for MCP server names that are used as a #765
 * per-session scope. Under #765 the fork enforces a scope by membership:
 * `mcpAllowlist.servers.includes(keyToServer[toolKey])`, where `keyToServer`
 * maps each tool back to its RAW live engine id (the `GET /opencode/mcp` /
 * `listMcp()` key). A scope name that does not EXACTLY equal a live engine id
 * therefore matches NOTHING — it silently scopes the session to zero tools.
 * That is the #781 hazard: a `ableton` display name vs the live `ableton-mcp`
 * id, or `nfl-mcp` (hyphen) vs the live `nfl_mcp` (underscore) id.
 *
 * This module is the single, DOCUMENTED place that reconciles that drift for
 * DERIVED/DEFAULT names (the importer default and any agent_profile_sync output).
 * It is a PURE DATA helper — no file I/O, no DB, no HTTP — mirroring
 * mcp_allowlist_expander.ts.
 *
 * ── Resolution rule (candidate name → live id) ───────────────────────────────
 *
 *   1. EXACT MATCH — candidate is itself a live id → return it unchanged.
 *      (Exact always wins, so a real `nfl_mcp` is never re-mapped.)
 *   2. CANONICAL MATCH — canonicalize the candidate and every live id with
 *      `canonicalizeMcpName()` (lowercase, drop `[-_]` separators, then drop a
 *      single trailing `mcp` token). If EXACTLY ONE live id shares the
 *      candidate's canonical form → resolve to that live id. This is what maps
 *      `ableton` → `ableton-mcp` and `nfl-mcp` → `nfl_mcp`.
 *   3. AMBIGUOUS — the canonical form matches >1 live id → leave UNRESOLVED.
 *      The helper never guesses between two real servers.
 *   4. NO MATCH — leave UNRESOLVED (matched: false). The caller surfaces it as
 *      stale and (for derived names) drops it. A name is NEVER invented into a
 *      real scope, so a leaked test-only `foo` can never be normalized into one.
 *
 * USER-ENTERED persisted names are intentionally NOT routed through the
 * normalize-and-drop path here — they are reconciled read-only (matched=false
 * surfaces them as stale via the #785 alignment guard) and never silently
 * rewritten. Only DERIVED/DEFAULT names go through
 * `normalizeDerivedAllowedMcps()`.
 */

// ── Canonical form ──────────────────────────────────────────────────────────

/**
 * Reduce a server name to its drift-insensitive canonical form:
 *   - lowercase
 *   - remove `-` and `_` separators
 *   - drop a single trailing `mcp` token (the optional `-mcp` / `_mcp` suffix)
 *
 * Examples (all collide, which is the point):
 *   'ableton'      → 'ableton'
 *   'ableton-mcp'  → 'ableton'      (suffix dropped)
 *   'nfl-mcp'      → 'nfl'
 *   'nfl_mcp'      → 'nfl'          (separator + suffix)
 *   'mcp'          → 'mcp'          (never reduced to empty)
 */
export function canonicalizeMcpName(name: string): string {
  const collapsed = name.toLowerCase().replace(/[-_]/g, '');
  // Drop a single trailing "mcp" token, but never reduce the whole name to ''.
  if (collapsed.length > 3 && collapsed.endsWith('mcp')) {
    return collapsed.slice(0, -3);
  }
  return collapsed;
}

// ── Single-name alignment ─────────────────────────────────────────────────────

export interface McpNameAlignment {
  /**
   * The aligned name: a live id when matched, otherwise the original candidate
   * unchanged. (Never an invented/guessed id.)
   */
  resolved: string;
  /** True iff the candidate resolved to a real live id (exact or canonical). */
  matched: boolean;
}

/**
 * Align a single candidate MCP name to the live engine id set.
 * See the module header for the full rule. Returns `{ resolved, matched }`.
 */
export function alignMcpName(
  candidate: string,
  liveNames: Set<string>,
): McpNameAlignment {
  // 1. Exact match — always wins.
  if (liveNames.has(candidate)) {
    return { resolved: candidate, matched: true };
  }
  // Empty live set (engine unavailable) → never invent; leave unresolved.
  if (liveNames.size === 0) {
    return { resolved: candidate, matched: false };
  }
  // 2/3. Canonical match — resolve only when UNAMBIGUOUS.
  const canon = canonicalizeMcpName(candidate);
  const hits: string[] = [];
  for (const live of liveNames) {
    if (canonicalizeMcpName(live) === canon) hits.push(live);
  }
  if (hits.length === 1) {
    return { resolved: hits[0], matched: true };
  }
  // 4. No (or ambiguous) match → unresolved.
  return { resolved: candidate, matched: false };
}

// ── Derived-allowlist normalization ───────────────────────────────────────────

/**
 * Normalize a DERIVED/DEFAULT `allowed_mcps_json` array string against the live
 * engine id set, before it is persisted or used as a #765 scope.
 *
 *   - json === null        → null   (fail-open, unchanged)
 *   - liveNames empty       → json   (engine unavailable — do NOT rewrite/empty)
 *   - non-array JSON        → json   (tools-map / malformed: not our shape — leave it)
 *   - invalid JSON          → json   (never crash scoping)
 *   - else                  → JSON of the matched live ids, in input order,
 *                             de-duplicated. UNMATCHED names (incl. a leaked
 *                             `foo`) are DROPPED — never invented into a scope.
 *
 * NOTE — unlike the skill path (`filterAllowlistToLive`), an all-dead derived
 * MCP array collapses to `[]`, NOT to null. An empty MCP scope is a valid #765
 * scope (scopes the session to no MCP tools); failing it open to "unrestricted"
 * would silently WIDEN a derived scope, which is the opposite of the drift fix.
 *
 * This is for DERIVED names only. User-authored rows must NOT be passed here —
 * they are reconciled read-only (surfaced as stale) and never silently rewritten.
 */
export function normalizeDerivedAllowedMcps(
  json: string | null,
  liveNames: Set<string>,
): string | null {
  if (json === null) return null;
  if (liveNames.size === 0) return json;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  // Only the server-name ARRAY form is a derived MCP scope. A tools-map object
  // or any other shape is not ours to rewrite.
  if (!Array.isArray(parsed)) return json;

  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    if (name === '') continue;
    const { resolved, matched } = alignMcpName(name, liveNames);
    if (!matched) continue; // drop dead/leaked derived names
    if (seen.has(resolved)) continue; // de-dup after normalization
    seen.add(resolved);
    out.push(resolved);
  }
  return JSON.stringify(out);
}
