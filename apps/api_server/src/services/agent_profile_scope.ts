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
   * override was provided — all servers are accessible).
   */
  mcpRoleConfig: McpRoleConfig | null;
  /**
   * Raw JSON string of allowed skill IDs from the profile.
   * P1b will use this to filter the skills injection preface.
   * null when the profile has no skill restriction.
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

  // Step 4 — build mcpRoleConfig
  const mcpRoleConfig = effectiveAllowedMcpsJson
    ? _buildMcpRoleConfig(effectiveAllowedMcpsJson, agentConfigId ?? 'profile')
    : null;

  // Step 5 — resolve allowedSkillsJson with the same override-or-inherit rule.
  //   opts.allowedSkillsJsonOverride !== undefined → explicit override (may be null)
  //   otherwise → profile's own column (may be null)
  const effectiveAllowedSkillsJson: string | null =
    opts.allowedSkillsJsonOverride !== undefined
      ? opts.allowedSkillsJsonOverride
      : (profile?.allowedSkillsJson ?? null);

  return {
    model,
    mcpRoleConfig,
    allowedSkillsJson: effectiveAllowedSkillsJson,
    systemPrompt: profile?.systemPrompt ?? null,
    ocAgent: profile?.ocAgent ?? null,
    modelTierHint: profile?.modelTierHint ?? null,
  };
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
 * Returns null on parse failure so the caller can treat a broken JSON string
 * as "no restriction" rather than crashing the run.
 */
function _buildMcpRoleConfig(
  allowedMcpsJson: string,
  roleLabel: string,
): McpRoleConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(allowedMcpsJson);
  } catch {
    logger.warn(`[resolveProfileScope] invalid allowedMcpsJson JSON — ignoring MCP scope`);
    return null;
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
    logger.warn(`[resolveProfileScope] allowedMcpsJson is neither an array nor an object — ignoring MCP scope`);
    return null;
  }

  if (Object.keys(mcpServers).length === 0) {
    // Parsed fine but empty — treat as no restriction
    return null;
  }

  return {
    role: roleLabel,
    mcpServers,
    allowedToolsJson: allowedMcpsJson,
  };
}
