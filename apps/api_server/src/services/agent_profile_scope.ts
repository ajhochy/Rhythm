/**
 * P1a — Shared profile scope builder
 *
 * Extracts the inline model + MCP config + profile metadata that was previously
 * duplicated across `agent_runner._runOnce` (scheduled path) and missing from
 * `ws_gateway.handleInputFrame` (interactive path).
 *
 * Both paths call `resolveProfileScope(agentConfigId, opts?)` to get a
 * consistent { model, mcpRoleConfig, allowedSkillsJson, systemPrompt, ocAgent }
 * tuple. The helper is DATA-ONLY — it never touches the opencode SDK or the WS
 * connection. Each call site keeps its own send mechanics.
 *
 * P1b seam: `allowedSkillsJson` is returned but skills filtering is applied by
 * the caller (ws_gateway / agent_runner) — the helper simply exposes the raw
 * JSON string so P1b can slot in without re-reading the profile.
 *
 * P2 seam: `systemPrompt` and `ocAgent` are returned but not yet forwarded to
 * the SDK (no per-session systemPrompt param in the current SDK). P2 can wire
 * them without changing the helper signature.
 */

import { logger } from '../utils/logger';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { resolveRunModel } from './agent_runner';
import { expandMcpAllowlist, type McpAllowlist } from './mcp_allowlist_expander';
import { perServerToolGrants } from './mcp_dispatch_guard';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpRoleConfig {
  role: string;
  mcpServers: Record<string, unknown>;
  allowedToolsJson: string;
}

export interface ProfileScope {
  /** Resolved { providerID, modelID } for this run/turn. */
  model: { providerID: string; modelID: string };
  /**
   * MCP role config to pass to createSession.
   * null when no MCP scoping applies (profile has no allowed_mcps_json and no
   * override was provided — all servers are accessible). A present empty array
   * is an explicit deny-all scope.
   */
  mcpRoleConfig: McpRoleConfig | null;
  /**
   * Raw JSON string of allowed skill IDs from the profile.
   * P1b will use this to filter the skills injection preface.
   * null when the profile has no skill restriction. A present empty array is
   * an explicit deny-all scope.
   */
  allowedSkillsJson: string | null;
  /**
   * Profile-level system prompt (not yet forwarded to the SDK; P2 seam).
   * null when the profile has no system prompt.
   */
  systemPrompt: string | null;
  /**
   * OpenCode built-in agent mode from the profile (e.g. 'build', 'plan').
   * null means "use opencode default".
   */
  ocAgent: string | null;
  /**
   * #844 — profile's tier preference ('cheap' | 'standard' | 'frontier'), fed
   * to agent_model_resolver.resolveModelTier()/resolveTieredModel() as the
   * `explicitTierHint`. null when the profile has no tier preference (the
   * task-kind default policy applies instead).
   *
   * NOTE: this does NOT change `model` above — `model` remains the existing
   * resolveRunModel() cascade so every current caller (ws_gateway,
   * agentSchedulerService, agent_runner) is unaffected by this field's
   * addition. Callers that want budget-aware tiered routing call
   * resolveTieredModel() themselves with this hint (see agent_runner._runOnce).
   */
  modelTierHint: string | null;
}

export interface ResolveProfileScopeOptions {
  /**
   * When provided, overrides the profile's own allowed_mcps_json for the
   * mcpRoleConfig build. This is the scheduled-task path: the scheduled-task
   * row's allowedMcpsJson (a tools-map) takes precedence over the profile's
   * server-name list. Pass null explicitly to force no scoping (unrestricted).
   * When undefined (default), the profile's own allowed_mcps_json is used.
   */
  allowedMcpsJsonOverride?: string | null;
  /**
   * When provided, overrides the profile's own allowed_skills_json for the
   * returned `allowedSkillsJson` (the scope-inheritance change — task-level skill allowlist
   * override). Same precedence semantics as allowedMcpsJsonOverride: an
   * explicit value (or explicit null) wins over the profile; undefined
   * (default) inherits the profile's own allowed_skills_json.
   */
  allowedSkillsJsonOverride?: string | null;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Resolve the run scope for a given agent profile.
 *
 * Resolution rules:
 *  - `model`: from `resolveRunModel(agentConfigId)` — same 3-step cascade as
 *    the existing agent_runner path (profile → MRU → hardcoded default).
 *  - `mcpRoleConfig`:
 *      • If `opts.allowedMcpsJsonOverride !== undefined` → use override (the
 *        scheduled-task path supplies the task row's allowedMcpsJson here).
 *      • Otherwise → derive from the profile's `allowed_mcps_json` column.
 *      • When the effective JSON is null/absent → return null (no restriction).
 *      • When the effective JSON is present but empty/malformed → deny all.
 *      • Server-name array format `["server1","server2"]` → builds mcpServers
 *        with each server mapped to `{ allowedTools: [] }` (server present, all
 *        tools allowed within that server).
 *      • Tools-map format `{"server":["tool1"]}` → existing _parseMcpServersFromJson
 *        logic (exact allowlist).
 *  - `allowedSkillsJson`, `systemPrompt`, `ocAgent`: taken from the profile
 *    row. All null when no profile is found.
 *
 * Never throws. Returns sensible defaults (hardcoded model, null MCP config)
 * when `agentConfigId` is null, unknown, or the DB is unavailable.
 */
export async function resolveProfileScope(
  agentConfigId: string | null | undefined,
  opts: ResolveProfileScopeOptions = {},
): Promise<ProfileScope> {
  // Step 1 — resolve model (never throws)
  const model = resolveRunModel(agentConfigId);

  // Step 2 — load profile (non-fatal)
  let profile: import('../repositories/agent_configs_repository').AgentConfig | null = null;
  if (agentConfigId) {
    try {
      profile = new AgentConfigsRepository().getById(agentConfigId);
      if (profile) {
        logger.info(
          `[resolveProfileScope] profile=${agentConfigId}: systemPrompt=${profile.systemPrompt ? 'set' : 'none'} ocAgent=${profile.ocAgent ?? 'default'} allowedMcps=${profile.allowedMcpsJson ? 'set' : 'none'}`,
        );
      } else {
        logger.warn(`[resolveProfileScope] profile not found: ${agentConfigId}`);
      }
    } catch (err) {
      logger.warn(`[resolveProfileScope] profile lookup failed (non-fatal): ${String(err)}`);
    }
  }

  // Step 3 — determine which allowedMcpsJson to use
  //   opts.allowedMcpsJsonOverride !== undefined → explicit override (may be null)
  //   otherwise → profile's own column (may be null if no profile or no MCP list)
  const effectiveAllowedMcpsJson: string | null =
    opts.allowedMcpsJsonOverride !== undefined
      ? opts.allowedMcpsJsonOverride
      : (profile?.allowedMcpsJson ?? null);

  // #931 — a scope-resolution failure (malformed/deny-all) must be legible in
  // the logs by human name too, not just id. Pass the name for LOG lines only;
  // the roleLabel (== agentConfigId) stays the identity persisted as `mcpRole`,
  // so this stays diagnostic-only with no behavior change.
  const roleLabel = agentConfigId ?? 'profile';
  const profileName = profile?.label ?? null;

  // Step 4 — build mcpRoleConfig
  const mcpRoleConfig = effectiveAllowedMcpsJson !== null
    ? _buildMcpRoleConfig(effectiveAllowedMcpsJson, roleLabel, profileName)
    : null;

  // Step 5 — resolve allowedSkillsJson with the same override-or-inherit rule.
  //   opts.allowedSkillsJsonOverride !== undefined → explicit override (may be null)
  //   otherwise → profile's own column (may be null)
  const rawAllowedSkillsJson: string | null =
    opts.allowedSkillsJsonOverride !== undefined
      ? opts.allowedSkillsJsonOverride
      : (profile?.allowedSkillsJson ?? null);
  const effectiveAllowedSkillsJson = _normalizeAllowedSkillsJson(
    rawAllowedSkillsJson,
    roleLabel,
    profileName,
  );

  return {
    model,
    mcpRoleConfig,
    allowedSkillsJson: effectiveAllowedSkillsJson,
    systemPrompt: profile?.systemPrompt ?? null,
    ocAgent: profile?.ocAgent ?? null,
    modelTierHint: profile?.modelTierHint ?? null,
  };
}

/**
 * #1012 — Expand a profile's `allowedMcpsJson` into the `{servers, tools}`
 * session-allowlist shape, using the SAME `_buildMcpRoleConfig` + expander that
 * top-level sessions use. Sync/pure (no engine call). Returns null for an
 * unscoped profile (`allowedMcpsJson === null`) so callers omit the allowlist
 * and preserve the engine's back-compat "all tools" default.
 *
 * Used by `writeAgentProfileFile` to bake the allowlist into the agent `.md`
 * frontmatter under `options.mcpAllowlist`, so the engine loads it into
 * `agent.options.mcpAllowlist` and the `task` tool can scope subagent sessions
 * spawned via delegation (the task path never round-trips through this service).
 */
export function expandProfileMcpAllowlist(
  allowedMcpsJson: string | null,
  roleLabel: string,
  profileName: string | null,
): McpAllowlist | null {
  if (allowedMcpsJson === null) return null;
  try {
    const roleConfig = _buildMcpRoleConfig(allowedMcpsJson, roleLabel, profileName);
    if (!roleConfig) return null;
    return expandMcpAllowlist(roleConfig);
  } catch (err) {
    logger.warn(`[expandProfileMcpAllowlist] ${roleLabel}: expansion failed (non-fatal): ${String(err)}`);
    return null;
  }
}

/** Which stored shape a profile's `allowed_mcps_json` used. */
export type ProfileMcpScopeShape = 'unrestricted' | 'servers' | 'tools-map' | 'invalid';

export interface ResolvedProfileMcpScope {
  /**
   * 'unrestricted' — `allowed_mcps_json` is NULL: no MCP restriction at all.
   * 'servers'      — server-name array `["rhythm"]` (inherit-all per server).
   * 'tools-map'    — object map `{"rhythm":["rhythm_ping"],"gitnexus":null}`.
   * 'invalid'      — present but unparseable/neither shape → deny-all.
   */
  shape: ProfileMcpScopeShape;
  /** MCP SERVER names the profile grants. Empty for 'unrestricted' (everything) and 'invalid' (nothing). */
  servers: string[];
  /**
   * server → its explicit per-tool grants. An EMPTY array means "every tool of
   * that server" (the `null` / `[]` / server-name-array grant), NEVER "no tools".
   */
  toolsByServer: Record<string, string[]>;
}

/**
 * Resolve a profile's `allowed_mcps_json` into the server names (and per-server
 * tool grants) it actually grants — the read-side companion to
 * {@link resolveProfileScope}, for callers that need to ANSWER "what is in this
 * profile's scope?" rather than build a session config.
 *
 * Interpretation is delegated to {@link _buildMcpRoleConfig} and
 * {@link perServerToolGrants}, the same code the enforcing paths use, so a
 * reader can never disagree with the runtime about what a stored value means.
 * The org optimizer's audit used to parse this column with its own
 * `JSON.parse + Array.isArray` helper, which returned `[]` for BOTH the
 * tools-map shape and NULL — reporting live, fully-scoped profiles as having no
 * MCP access at all and grounding false "missing scope" proposals on it.
 */
export function resolveProfileMcpScope(
  allowedMcpsJson: string | null,
  roleLabel = 'profile',
  profileName: string | null = null,
): ResolvedProfileMcpScope {
  if (allowedMcpsJson === null) {
    return { shape: 'unrestricted', servers: [], toolsByServer: {} };
  }

  // Shape classification only — the VALUE interpretation below is
  // _buildMcpRoleConfig's, never re-derived here.
  let shape: ProfileMcpScopeShape = 'invalid';
  try {
    const parsed: unknown = JSON.parse(allowedMcpsJson);
    if (Array.isArray(parsed)) shape = 'servers';
    else if (parsed !== null && typeof parsed === 'object') shape = 'tools-map';
  } catch {
    shape = 'invalid';
  }

  const roleConfig = _buildMcpRoleConfig(allowedMcpsJson, roleLabel, profileName);
  const toolsByServer: Record<string, string[]> = {};
  for (const [server, value] of Object.entries(roleConfig?.mcpServers ?? {})) {
    toolsByServer[server] = perServerToolGrants(value);
  }
  return { shape, servers: Object.keys(toolsByServer), toolsByServer };
}

/**
 * Expand a profile's allowed_skills_json into the fork's skillAllowlist shape
 * ({skills:[...]}) for projection into an agent .md `options` block. null
 * (unrestricted) → undefined so the writer omits the key. Mirrors
 * expandProfileMcpAllowlist. Reuses _normalizeAllowedSkillsJson so the
 * null/malformed/deny-all contract stays identical to the per-turn path.
 */
export function expandProfileSkillAllowlist(
  allowedSkillsJson: string | null,
): { skills: string[] } | undefined {
  const normalized = _normalizeAllowedSkillsJson(allowedSkillsJson, 'profile');
  if (normalized === null) return undefined;
  const parsed = JSON.parse(normalized) as unknown;
  if (!Array.isArray(parsed)) return { skills: [] };
  return { skills: parsed.filter((s): s is string => typeof s === 'string') };
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Build an mcpRoleConfig object from a JSON string.
 *
 * Two input formats are supported:
 *
 *  1. Server-name array (profile format): `["rhythm","gmail-personal"]`
 *     → Each named server is included with `allowedTools: []` (all tools
 *       accessible for that server, just the server scope is enforced).
 *
 *  2. Tools-map (scheduled-task/override format):
 *     `{"rhythm":["rhythm_list_tasks"],"github":["github_list_repos"]}`
 *     → Each server is mapped to its explicit allowedTools list.
 *     (Mirrors the existing `_parseMcpServersFromJson` logic in agent_runner.)
 *
 * Contract: NULL is unrestricted and handled by the caller before this helper.
 * Any present malformed, empty, or non-list/non-map value is deny-all, never
 * fail-open. Deny-all is represented as an empty mcpServers map, which expands
 * to { servers: [], tools: [] } in the opencode session allowlist.
 */
function _buildMcpRoleConfig(
  allowedMcpsJson: string,
  roleLabel: string,
  // #931 — human name for LOG lines only; roleLabel stays the persisted `role`.
  profileName: string | null = null,
): McpRoleConfig | null {
  const logLabel = profileName ? `${roleLabel} "${profileName}"` : roleLabel;
  let parsed: unknown;
  try {
    parsed = JSON.parse(allowedMcpsJson);
  } catch {
    logger.error(
      `[resolveProfileScope] profile=${logLabel}: invalid allowedMcpsJson JSON; denying all MCP tools. offendingValue=`,
      allowedMcpsJson,
    );
    return {
      role: roleLabel,
      mcpServers: {},
      allowedToolsJson: '[]',
    };
  }

  const mcpServers: Record<string, unknown> = {};

  if (Array.isArray(parsed)) {
    // Format 1: server-name array — include each named server, all tools
    for (const entry of parsed) {
      if (typeof entry === 'string' && entry.trim()) {
        mcpServers[entry.trim()] = { allowedTools: [] };
      }
    }
  } else if (parsed !== null && typeof parsed === 'object') {
    // Format 2: tools-map — mirror _parseMcpServersFromJson logic
    for (const [serverName, tools] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(tools)) {
        mcpServers[serverName] = { allowedTools: tools };
      } else {
        // Already in expanded form (e.g. { allowedTools: [...] }) — pass through
        mcpServers[serverName] = tools;
      }
    }
  } else {
    logger.error(
      `[resolveProfileScope] profile=${logLabel}: allowedMcpsJson is neither an array nor an object; denying all MCP tools. offendingValue=`,
      allowedMcpsJson,
    );
    return {
      role: roleLabel,
      mcpServers: {},
      allowedToolsJson: '[]',
    };
  }

  // #931 — deny-all is a valid but degraded state: the profile resolves to an
  // empty server set, so the agent gets NO MCP tools this run. It used to be
  // silent (only malformed JSON logged); surface it with id+name+kind so the
  // operator can tell "deliberately locked down" from "silently broken".
  if (Object.keys(mcpServers).length === 0) {
    logger.warn(
      `[resolveProfileScope] profile=${logLabel}: MCP scope is deny-all ([]) — agent has NO MCP tools this run`,
    );
  }

  return {
    role: roleLabel,
    mcpServers,
    allowedToolsJson: allowedMcpsJson,
  };
}

/**
 * Normalize profile/task skill scope JSON under the same contract as MCP scope:
 * null means unrestricted; any present malformed/non-array value denies all.
 */
function _normalizeAllowedSkillsJson(
  allowedSkillsJson: string | null,
  roleLabel: string,
  // #931 — human name for LOG lines only (skills scope carries no persisted id).
  profileName: string | null = null,
): string | null {
  if (allowedSkillsJson === null) return null;

  const logLabel = profileName ? `${roleLabel} "${profileName}"` : roleLabel;
  let parsed: unknown;
  try {
    parsed = JSON.parse(allowedSkillsJson);
  } catch {
    logger.error(
      `[resolveProfileScope] profile=${logLabel}: invalid allowedSkillsJson JSON; denying all skills. offendingValue=`,
      allowedSkillsJson,
    );
    return '[]';
  }

  if (!Array.isArray(parsed)) {
    logger.error(
      `[resolveProfileScope] profile=${logLabel}: allowedSkillsJson is not an array; denying all skills. offendingValue=`,
      allowedSkillsJson,
    );
    return '[]';
  }

  const skillNames = parsed
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
  // #931 — deny-all skills is a valid but degraded state (empty array): the
  // agent gets NO skills this run. Was silent; surface it with id+name+kind.
  if (skillNames.length === 0) {
    logger.warn(
      `[resolveProfileScope] profile=${logLabel}: skill scope is deny-all ([]) — agent has NO skills this run`,
    );
  }
  if (skillNames.length !== parsed.length) {
    return JSON.stringify(skillNames);
  }
  return allowedSkillsJson;
}
