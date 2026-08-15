/**
 * Agent Profile Sync — consolidation (#agent-profiles)
 *
 * Mirrors the opencode engine's agent registry into `agent_configs` so every
 * opencode agent (built-in + custom from ~/.config/opencode/agents/*.md) also
 * exists as an Agent Profile. This unifies the three historical "agent"
 * concepts (agentKind / Agent Profile / opencode agent) under one table.
 *
 * Mapping per opencode agent:
 *   id                 = agent.name            (stable; agent_configs.id is the kind string)
 *   label              = Title Case of name    (only on first insert; user edits preserved)
 *   ocAgent            = agent.name            (routing target for the opencode SDK)
 *   sessionSelectable  = mode==='primary' OR mode==='all', AND not an
 *                        opencode-internal primary
 *                        EXCEPT: dev front-door de-dup overrides (see DEV_FRONT_DOOR_*)
 *
 * "session selectable" controls visibility in the composer AgentSelectorPill.
 * Subagents (coding-agent, verification-gate, …) and opencode internal
 * primaries (compaction/summary/title) are seeded with sessionSelectable=false
 * so they exist as profiles without cluttering the picker.
 *
 * Local SQLite only — production Postgres has no local opencode engine, so the
 * sync is a no-op there.
 */

import { opencodeClient } from './opencode_engine';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { normalizeDerivedAllowedMcps } from './mcp_name_alignment';
import {
  deleteAgentProfileFile,
  isAgentProfileFileMissing,
  isProjectableAgentConfig,
  isProjectableAgentConfigIgnoringEnabled,
  writeAgentProfileFile,
} from './opencode_agent_writer';
import { projectAgentProfileAfterWrite } from './agent_profile_projection_service';

/**
 * opencode primaries that drive background machinery, not user-facing sessions.
 * They are valid agents but must never appear in the session agent picker.
 */
const INTERNAL_PRIMARY = new Set(['compaction', 'summary', 'title']);

// ---------------------------------------------------------------------------
// Dev front-door de-duplication (P3 — importer profile hygiene)
//
// Several AI-Workflow agents are "dev front-doors" — entry-point orchestrators
// that a developer might open a session against. Only ONE should appear in the
// session picker (AgentSelectorPill) to avoid confusion. The canonical primary
// is `workflow-orchestrator` (documented in CLAUDE.md as the global entry
// point). The others are kept in the DB as profiles (for programmatic dispatch)
// but are hidden from the picker via sessionSelectable=false.
//
// This is IMPORTER-DRIVEN so the state survives every re-sync. A direct DB
// edit would be clobbered the next time syncOpencodeAgentProfiles runs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// is_manager: NOT set by the importer (intentional decoupling)
//
// The importer controls session_selectable (picker visibility) but must NEVER
// touch is_manager. That flag designates the delegator / default-agent role
// and is USER-CONTROLLED — any profile (e.g. Secretary) may hold it, and it
// must survive re-syncs unchanged.
//
// On INSERT  → is_manager defaults to false (DB column DEFAULT 0; the
//              AgentConfigInput field is omitted so repo.insert() writes 0).
// On UPDATE  → is_manager is never included in the patch object, so the
//              existing DB value is preserved exactly as the user left it.
//
// DO NOT add isManager to the INSERT input or the UPDATE patch here.
// Enforce this invariant with the tests in agent_profile_sync_hygiene.test.ts
// (see "is_manager decoupling" describe block).
// ---------------------------------------------------------------------------

/** The single dev front-door that should be session-selectable. */
const DEV_FRONT_DOOR_PRIMARY = 'workflow-orchestrator';

/**
 * Dev front-doors whose sessionSelectable must be forced to false so they do
 * not appear alongside the primary in the AgentSelectorPill. These are still
 * imported as profiles so the scheduler + programmatic callers can target them.
 */
const DEV_FRONT_DOOR_SECONDARY = new Set([
  'superpowers',
  'plan',
  // CLI / system agents that must stay hidden from the session picker across
  // every sync. They are still imported as profiles so programmatic callers
  // can target them, but they must never appear in the AgentSelectorPill.
  'build',
  'codex',
  'gemini-cli',
  'opencode',
]);

// ---------------------------------------------------------------------------
// Tier → model mapping (P3 — importer profile hygiene)
//
// Many AI-Workflow agents do not carry a model in their opencode registry
// entry. This mapping derives a concrete (provider, modelId) pair from the
// agent's tier label (e.g. "Tier 1", "Tier 2", "Tier 3") found anywhere in
// the agent's system prompt or description.
//
// Model IDs are taken from ROUTE_FALLBACKS_BY_AGENT in agent_model_resolver.ts
// (the first anthropic entry at each tier level). They must stay in sync with
// that catalog. Update here when the catalog changes.
//
//   Tier 1 — heavyweight orchestration/planning agents
//   Tier 2 — mid-weight coding/implementation agents (the team default)
//   Tier 3 — lightweight checkers/formatters
//
// If no tier is detectable the agent falls back to IMPORTER_DEFAULT_MODEL
// (Tier 2 — the safest choice for unknown agents, avoids excess cost).
//
// OPEN QUESTION: These model IDs are manually mirrored from the catalog. A
// future improvement would be to import the first anthropic entry at each tier
// directly from ROUTE_FALLBACKS_BY_AGENT to make the source-of-truth
// unambiguous.
// ---------------------------------------------------------------------------

const IMPORTER_PROVIDER = 'anthropic';

/** Tier 1 — highest capability; use the opus flagship. */
const IMPORTER_TIER1_MODEL_ID = 'claude-opus-4-7';

/**
 * Tier 2 — mid-weight default; matches the model already used by claude-code
 * in the preset seed and the env.ts AGENT_TEACHER_MODEL default.
 */
const IMPORTER_TIER2_MODEL_ID = 'claude-sonnet-4-6';

/** Tier 3 — lightweight; use haiku for speed + economy. */
const IMPORTER_TIER3_MODEL_ID = 'claude-haiku-4-5';

/**
 * Default model when no tier is detectable.
 * Tier 2 (sonnet) is the safest choice: capable enough for any agent, less
 * expensive than opus, and already the system-wide fallback for claude-code.
 */
const IMPORTER_DEFAULT_MODEL_ID = IMPORTER_TIER2_MODEL_ID;

/**
 * Curated default allowed_mcps_json for imported (sortOrder=100) generic
 * profiles — issue #842 (tokens-02, "scoped-by-default sessions").
 *
 * Scope: this constant ONLY affects a generic/non-roled profile whose
 * `allowed_mcps_json` column is still null on first insert. Agents
 * with a `.mcp-roles/<slug>.mcp.json` file (secretary, worship-planning, …)
 * are unaffected: they are scoped at session-create time via the separate
 * `mcpRole` mechanism (`agent_sessions_controller.ts`), and/or already carry
 * a non-null `allowed_mcps_json` from onboarding — the insert path here never
 * overwrites an existing value. This satisfies #842's AC3 ("NO behavior
 * change for existing roled agents").
 *
 * "rhythm" is the local Rhythm MCP server. "obsidian" is the user's
 * knowledge-vault MCP, granted at advertise-scope (server-name level) so
 * every imported agent can read/search the vault by default — the actual
 * obsidian TOOL surface a ROLED agent gets is still narrowed to read/search
 * by its own role file (the #736 dispatch backstop); array members here are
 * inherit-all only at the advertise layer.
 *
 * "pdf-tools" is added by #842 to widen the default beyond rhythm+obsidian to
 * a genuinely "common tasks" scope: a survey of the 13 existing
 * `.mcp-roles/*.mcp.json` files found pdf-tools granted in 4 of them
 * (secretary, research, theologian, worship-planning is not one of these —
 * secretary/research/theologian/… — see docs/ai/decisions for the exact
 * count), making it the next most broadly useful zero-auth local server after
 * rhythm/obsidian: reading PDF attachments (agendas, forms, contracts) is a
 * common task for a generic agent that neither rhythm nor obsidian covers.
 * Full/unscoped tool surface remains available by explicit opt-in — a caller
 * simply omits `mcpRole` and does not set `allowed_mcps_json` on session
 * create; nothing in this change removes that path (see
 * `agent_sessions_controller.ts#create`).
 *
 * Users can always widen/narrow an individual profile's scope in the
 * designer (the importer default is insert-time only — a user-set value,
 * including explicit null or an empty array, is never overwritten by a later
 * sync). All names are validated against the
 * live engine id set (#789 normalize → #788 validate) before persistence, so
 * an unavailable server (e.g. pdf-tools not yet connected) is silently
 * dropped from an individual row's persisted scope rather than persisted as
 * dead scope.
 */
const IMPORTER_DEFAULT_ALLOWED_MCPS_JSON = '["rhythm","obsidian","pdf-tools"]';

/**
 * #788 — validate an MCP allowlist JSON against the engine's LIVE server ids
 * (from GET /opencode/mcp / `listMcp()`) so a default/derived `allowed_mcps_json`
 * can never persist a name the engine won't enforce. Mirrors `filterAllowlistToLive`
 * for skills: under #765, a stored MCP name that does not exactly equal a live
 * engine id silently scopes a per-session allowlist to NOTHING (the #781 hazard:
 * `ableton` vs the live `ableton-mcp`, `nfl-mcp` vs `nfl_mcp`, or a leaked test
 * `foo`). A name absent from the live set is logged LOUDLY and dropped rather than
 * silently persisted as dead scope — and is caught by #785's names-alignment test.
 *
 *   - json === null      → null  (fail-open / unrestricted, unchanged)
 *   - liveMcpNames empty → json  (engine unavailable — do NOT nuke the default
 *                                  scope just because the engine was momentarily
 *                                  down; AC#4 boundary, mirrors the skill path)
 *   - else               → JSON of (names ∩ liveMcpNames); dead names dropped+warned
 *   - intersection empty but input was non-empty → null + warn (fail-open rather
 *     than lock the agent out of every MCP server)
 *
 * Pure + total: never throws (malformed JSON / non-array → returned unchanged so a
 * sync pass can never crash on a bad stored value).
 */
function validateMcpsAgainstLive(
  json: string | null,
  liveMcpNames: Set<string>,
  agentName: string,
): string | null {
  if (json === null) return null;
  if (liveMcpNames.size === 0) return json;
  let names: unknown;
  try {
    names = JSON.parse(json);
  } catch {
    return json;
  }
  if (!Array.isArray(names)) return json;
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const n of names) {
    if (typeof n !== 'string') continue;
    if (liveMcpNames.has(n)) kept.push(n);
    else dropped.push(n);
  }
  if (dropped.length > 0) {
    logger.warn(
      `[AgentProfileSync] ${agentName}: dropping ${dropped.length} MCP name(s) absent from the live engine server set: ${dropped.join(', ')}`,
    );
  }
  if (kept.length === 0) {
    logger.warn(
      `[AgentProfileSync] ${agentName}: default/derived MCP allowlist has no live matches — leaving unrestricted (fail-open) instead of locking out`,
    );
    return null;
  }
  return JSON.stringify(kept);
}

// ---------------------------------------------------------------------------
// Per-agent skill allowlists (P3 tightening)
//
// The opencode agent registry does NOT expose a `skills` field; each agent's
// frontmatter carries `permission: skill: allow` (a capability gate) but no
// enumerated skill list. We therefore derive the allowlist from the agent
// name, using the AI-Workflow chain structure documented in CLAUDE.md and the
// workflow-orchestrator skill as the canonical reference.
//
// Scheme:
//   workflow-orchestrator (dev front-door) → all workflow-chain skills it
//     routes to, plus its own skill.  This is intentionally BROAD because
//     the orchestrator must be able to invoke any downstream specialist skill.
//   Each specialist → its own skill name, plus any skills it is documented to
//     hand off to from within the chain.
//   superpowers / superpowers-* → their own skill family names.
//   Unknown agents → agent name if it matches a known skill, otherwise null
//     (full eligibility, fail-open for unrecognised agents).
//
// Null means "no restriction" (all eligible skills). '[]' means "no skills".
// Never use '[]' here — that would prevent the agent from loading any skill.
//
// Ordering within each array is alphabetical (stable across re-syncs).
// ---------------------------------------------------------------------------

/** All workflow-chain skill names the orchestrator routes to. */
const WORKFLOW_CHAIN_SKILLS = [
  'acceptance-contract',
  'coding-agent',
  'failure-postmortem',
  'failure-triage',
  'issue-writer',
  'planning-agent',
  'project-state-updater',
  'prompt-evolver',
  'smoke-test',
  'smoke-test-writer',
  'verification-gate',
  'workflow-orchestrator',
  'workflow-retrospective',
] as const;

const WORKFLOW_MANAGER_DELEGATES = WORKFLOW_CHAIN_SKILLS.filter(
  (skill) => skill !== DEV_FRONT_DOOR_PRIMARY,
);

function deriveAllowedDelegates(agentName: string): string | null {
  if (agentName !== DEV_FRONT_DOOR_PRIMARY) return null;
  return JSON.stringify(WORKFLOW_MANAGER_DELEGATES);
}

/**
 * Map from agent name → skills allowlist JSON string.
 * Keys must exactly match the agent `name` field from the registry.
 * Values are valid JSON arrays of skill-name strings.
 *
 * Absent keys fall through to `deriveSkillAllowlist()`.
 */
const AGENT_SKILL_ALLOWLIST_MAP: Readonly<Record<string, string>> = {
  // Dev front-door: needs to route to every workflow-chain skill.
  'workflow-orchestrator': JSON.stringify(WORKFLOW_CHAIN_SKILLS),

  // Specialist chain members: own skill + any immediate downstream hand-off.
  'planning-agent': JSON.stringify(['planning-agent']),
  'issue-writer': JSON.stringify(['issue-writer']),
  // coding-agent invokes acceptance-contract before coding.
  'coding-agent': JSON.stringify(['acceptance-contract', 'coding-agent', 'verification-gate']),
  // verification-gate hands off to failure-triage on failure.
  'verification-gate': JSON.stringify(['failure-triage', 'failure-postmortem', 'verification-gate']),
  // failure-triage may log a postmortem.
  'failure-triage': JSON.stringify(['failure-postmortem', 'failure-triage']),
  'smoke-test-writer': JSON.stringify(['smoke-test', 'smoke-test-writer']),
  'project-state-updater': JSON.stringify(['project-state-updater']),
  // workflow-retrospective runs prompt-evolver as part of the self-improvement loop.
  'workflow-retrospective': JSON.stringify(['prompt-evolver', 'workflow-retrospective']),

  // Superpowers family: orchestrator routes through its own four sub-skills.
  'superpowers': JSON.stringify([
    'superpowers:brainstorming',
    'superpowers:executing-plans',
    'superpowers:subagent-driven-development',
    'superpowers:using-superpowers',
    'superpowers:verification-before-completion',
    'superpowers:writing-plans',
  ]),
  'superpowers-code-reviewer': JSON.stringify(['superpowers:verification-before-completion']),
  'superpowers-implementer': JSON.stringify([
    'superpowers:executing-plans',
    'superpowers:subagent-driven-development',
  ]),
  'superpowers-plan-writer': JSON.stringify(['superpowers:writing-plans']),
  'superpowers-spec-writer': JSON.stringify(['superpowers:brainstorming']),
};

/**
 * #947 — the canonical set of skill names Rhythm's built-in agents depend on:
 * the workflow chain plus every name any entry in {@link AGENT_SKILL_ALLOWLIST_MAP}
 * references. The skill seed importer uses this to decide which ~/.claude/skills
 * to import into the sole managed dir — agent-referenced skills are preserved;
 * unreferenced Claude Code skills are no longer blanket auto-pulled. Kept here,
 * beside the allowlists that actually gate the agents, so the two can never
 * drift.
 */
export function canonicalAgentSkillNames(): Set<string> {
  const names = new Set<string>(WORKFLOW_CHAIN_SKILLS);
  for (const json of Object.values(AGENT_SKILL_ALLOWLIST_MAP)) {
    try {
      const arr = JSON.parse(json) as unknown;
      if (Array.isArray(arr)) {
        for (const n of arr) if (typeof n === 'string') names.add(n);
      }
    } catch {
      /* map values are authored JSON — a parse failure would be a code bug */
    }
  }
  return names;
}

/**
 * Derive allowed_skills_json for an imported agent profile.
 *
 * Priority:
 *   1. Explicit entry in AGENT_SKILL_ALLOWLIST_MAP → use it.
 *   2. Agent name matches a known skill exactly → single-entry allowlist.
 *   3. No match → null (all skills eligible; fail-open for unknown agents).
 *
 * This is intentionally conservative: agents only get the skills they are
 * documented to use in the chain. Users can widen the allowlist in the
 * designer; the importer never narrows a user-edited value (see update path).
 */
function deriveSkillAllowlist(agentName: string): string | null {
  // 1. Explicit map entry takes priority
  if (Object.prototype.hasOwnProperty.call(AGENT_SKILL_ALLOWLIST_MAP, agentName)) {
    return AGENT_SKILL_ALLOWLIST_MAP[agentName];
  }
  // 2. Agent name is itself a known skill name (covers future agents whose name
  //    matches a skill without needing a map entry)
  const knownSkills = new Set<string>(WORKFLOW_CHAIN_SKILLS);
  if (knownSkills.has(agentName)) {
    return JSON.stringify([agentName]);
  }
  // 3. Unknown agent — fail-open
  return null;
}

/**
 * Unify-3 — intersect a derived allowlist JSON against the fork's LIVE skill
 * names (from GET /skill) so a stored `allowed_skills_json` can never contain a
 * name the fork won't enforce. Without this, the hand-kept `WORKFLOW_CHAIN_SKILLS`
 * / `AGENT_SKILL_ALLOWLIST_MAP` can drift from the discovered skill set and a
 * dead name silently scopes a profile to nothing (#775 hazard).
 *
 *   - json === null        → null  (fail-open, unchanged)
 *   - liveSkillNames empty → json  (engine unavailable — do NOT nuke scopes)
 *   - else                 → JSON of (names ∩ liveSkillNames); dead names dropped
 *   - intersection empty but input was non-empty → null + warn (fail-open rather
 *     than lock the agent out of every skill).
 */
function filterAllowlistToLive(
  json: string | null,
  liveSkillNames: Set<string>,
  agentName: string,
): string | null {
  if (json === null) return null;
  if (liveSkillNames.size === 0) return json;
  let names: unknown;
  try {
    names = JSON.parse(json);
  } catch {
    return json;
  }
  if (!Array.isArray(names)) return json;
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const n of names) {
    if (typeof n !== 'string') continue;
    if (liveSkillNames.has(n)) kept.push(n);
    else dropped.push(n);
  }
  if (dropped.length > 0) {
    logger.warn(
      `[AgentProfileSync] ${agentName}: dropping ${dropped.length} skill name(s) absent from the live fork skill set: ${dropped.join(', ')}`,
    );
  }
  if (kept.length === 0) {
    logger.warn(
      `[AgentProfileSync] ${agentName}: derived skill allowlist has no live matches — leaving unrestricted (fail-open) instead of locking out`,
    );
    return null;
  }
  return JSON.stringify(kept);
}

/** Split an opencode 'provider/model-id' string into [provider, modelId]. */
function parseModel(model?: string | null): [string | null, string | null] {
  if (!model || typeof model !== 'string' || !model.includes('/')) {
    return [null, null];
  }
  const idx = model.indexOf('/');
  return [model.slice(0, idx), model.slice(idx + 1)];
}

/** 'workflow-orchestrator' → 'Workflow Orchestrator'. */
function titleCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Detect the tier number (1 | 2 | 3) from an agent's prompt/description text.
 *
 * Looks for the literal strings "Tier 1", "Tier 2", "Tier 3" (case-insensitive)
 * anywhere in the text. Returns the first match, or null when undetectable.
 *
 * This is intentionally simple: AI-Workflow skill files use a consistent
 * "Tier N" annotation in their opening line (e.g. "Model tier: Tier 2.").
 */
function detectTier(text: string | null | undefined): 1 | 2 | 3 | null {
  if (!text) return null;
  const match = text.match(/\bTier\s+([123])\b/i);
  if (!match) return null;
  return Number(match[1]) as 1 | 2 | 3;
}

/**
 * Resolve the (modelProvider, modelId) pair for an imported agent.
 *
 * Priority:
 *   1. Registry entry carries an explicit model string ("provider/modelId") →
 *      parse and use directly (preserves registry intent).
 *   2. Tier label detected in prompt → map to the tier constant above.
 *   3. No tier detectable → fall back to IMPORTER_DEFAULT_MODEL_ID (Tier 2).
 */
function resolveImporterModel(
  registryModelStr: string | null | undefined,
  prompt: string | null | undefined,
): [string, string] {
  // 1. Registry model string takes priority
  if (registryModelStr) {
    const parsed = parseModel(registryModelStr);
    if (parsed[0] && parsed[1]) return [parsed[0], parsed[1]];
  }
  // 2. Tier detection
  const tier = detectTier(prompt);
  const modelId =
    tier === 1 ? IMPORTER_TIER1_MODEL_ID
    : tier === 2 ? IMPORTER_TIER2_MODEL_ID
    : tier === 3 ? IMPORTER_TIER3_MODEL_ID
    : IMPORTER_DEFAULT_MODEL_ID; // No tier found → Tier 2 default
  return [IMPORTER_PROVIDER, modelId];
}

/**
 * #1073 (OCU-32) — normalize the engine's resolved `agent.permission` block
 * (an arbitrary map of key → 'allow'|'ask'|'deny' string OR a pattern-map
 * object) into the exact JSON shape `core_permissions_json` already stores
 * and `opencode_agent_writer.setPermissionValue` already serializes generically
 * for ANY key — not just the historically-typed edit/bash/webfetch. Returns
 * null when the block is absent/empty so callers never persist `'{}'` as a
 * false "the user configured zero permissions".
 */
function resolvePermissionsJsonFromAgent(
  agent: import('@opencode-ai/sdk').SdkAgent,
): string | null {
  const permission = (agent as unknown as { permission?: Record<string, unknown> }).permission;
  if (!permission || typeof permission !== 'object') return null;
  const entries = Object.entries(permission).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

/**
 * Sync opencode agents into agent_configs. Idempotent: existing rows have their
 * ocAgent + sessionSelectable refreshed (so re-runs track engine changes) while
 * user-set label / model / systemPrompt are preserved. Never throws — failures
 * degrade to a logged warning and { synced: 0 }.
 */
export async function syncOpencodeAgentProfiles(
  prefetched?: import('@opencode-ai/sdk').SdkAgent[],
): Promise<{ synced: number }> {
  if (env.dbClient === 'postgres') return { synced: 0 };

  let agents: import('@opencode-ai/sdk').SdkAgent[];
  if (prefetched) {
    // Caller already fetched the registry (e.g. the listAgents controller) —
    // reuse it so we don't double-hit the engine.
    agents = prefetched;
  } else {
    if (!opencodeClient.isReady) return { synced: 0 };
    try {
      agents = await opencodeClient.listAgents();
    } catch (err) {
      logger.warn(`[AgentProfileSync] listAgents failed: ${String(err)}`);
      return { synced: 0 };
    }
  }

  const repo = new AgentConfigsRepository();
  let synced = 0;

  // Unify-3 — fetch the fork's live skill names ONCE so every derived allowlist
  // is validated against what the fork can actually enforce. An empty set
  // (engine not ready / unavailable) means validation is skipped (fail-safe:
  // never empty an existing scope just because the engine was momentarily down).
  const liveSkillNames = new Set(
    (await opencodeClient.listSkills()).map((s) => s.name),
  );

  // #789 + #788 — fetch the engine's live MCP server ids ONCE, then for the
  // DERIVED default we (a) normalize aliases to the exact live id (#789, the
  // #781 drift fix), then (b) validate the normalized value against the live id
  // set so a dead name is never persisted as scope (#788). Fail-safe contract,
  // same as liveSkillNames: any failure (engine not ready — listMcp() throws,
  // unlike listSkills) yields an EMPTY set; an empty set means
  // normalizeDerivedAllowedMcps skips normalization AND validateMcpsAgainstLive
  // skips validation, so a momentary outage never rewrites or empties a scope.
  let liveMcpNames = new Set<string>();
  try {
    liveMcpNames = new Set(Object.keys(await opencodeClient.listMcp()));
  } catch (err) {
    logger.warn(`[AgentProfileSync] listMcp failed (non-fatal; skipping MCP normalize+validate): ${String(err)}`);
  }

  // The importer default ("rhythm"), normalized to live ids (#789). When the
  // engine is unavailable (empty live set) this is identical to the raw default.
  // Each persistence site additionally runs validateMcpsAgainstLive on this
  // normalized value (#788) so no dead name is backfilled.
  const importerDefaultAllowedMcpsJson =
    normalizeDerivedAllowedMcps(IMPORTER_DEFAULT_ALLOWED_MCPS_JSON, liveMcpNames) ??
    IMPORTER_DEFAULT_ALLOWED_MCPS_JSON;

  // #788 observability — #789 normalization silently drops a default name that
  // doesn't align to any live id, so emit the loud warning here when the default
  // fails to survive against a non-empty live set. The #785 names-alignment guard
  // relies on a dead name never being silently persisted as scope.
  if (liveMcpNames.size > 0) {
    try {
      const rawDefault = JSON.parse(IMPORTER_DEFAULT_ALLOWED_MCPS_JSON) as unknown;
      const survivors = JSON.parse(importerDefaultAllowedMcpsJson) as unknown;
      if (
        Array.isArray(rawDefault) &&
        rawDefault.length > 0 &&
        Array.isArray(survivors) &&
        survivors.length === 0
      ) {
        logger.warn(
          `[AgentProfileSync] MCP name(s) absent from the live engine server set — ` +
            `dropping from the importer-default scope (leaving rows unrestricted): ` +
            `${(rawDefault as string[]).join(', ')}`,
        );
      }
    } catch {
      // default is always a JSON array literal; parse failure is not actionable.
    }
  }


  for (const agent of agents) {
    const name = agent.name;
    if (!name) continue;

    // Base selectability — used at INSERT time only (see the update-path
    // comment below: session_selectable is user-owned once the row exists).
    // primary/all + non-internal → true; everything else false. #1039
    // (opencode_agent_writer.ts) writes `mode: 'all'` — not just 'primary' —
    // for any profile with sessionSelectable=true, so a promoted profile
    // stays BOTH runnable as a top-level session AND a delegation target.
    // This reader must recognize 'all' too, or the seeded default for a
    // promoted profile would be wrong on first import.
    // Dev front-door de-dup overrides this below (insert-time default only).
    let selectable =
      (agent.mode === 'primary' || agent.mode === 'all') && !INTERNAL_PRIMARY.has(name);

    // Dev front-door de-dup: force exactly one entry-point agent into the
    // picker. Secondary front-doors are kept in the DB but hidden from the
    // session selector so only the canonical primary is ever presented.
    if (name === DEV_FRONT_DOOR_PRIMARY) {
      selectable = true;
    } else if (DEV_FRONT_DOOR_SECONDARY.has(name)) {
      selectable = false;
    }

    try {
      // opencode exposes the agent's prompt body + model on the registry entry.
      const a = agent as unknown as {
        prompt?: string | null;
        model?: string | null;
      };
      const prompt = typeof a.prompt === 'string' && a.prompt.trim() !== '' ? a.prompt : null;
      const allowedDelegatesJson = deriveAllowedDelegates(name);
      // #1073 — the engine's resolved permission block, read back so a
      // hand-edited .md's permission keys (or an engine-side default) are
      // reflected in the profile designer. Backfill-only (see below) —
      // never clobbers a value the user set via PATCH /agent-configs.
      const resolvedPermissionsJson = resolvePermissionsJsonFromAgent(agent);

      // Resolve model: registry string → tier detection → Tier 2 default.
      // For sortOrder=100 imports this guarantees a non-null model; the
      // fallback is never left null as the old code did.
      const [resolvedProvider, resolvedModelId] = resolveImporterModel(a.model, prompt);

      const existing = repo.getById(name);
      if (existing) {
        // session_selectable is USER-OWNED after first insert. The engine's
        // mode seeds it at INSERT below, but the update path must never
        // recompute it: the DB is the single authority for user-editable
        // profile fields, the .md file is a projection of the DB (the writer
        // emits mode:'all'/'subagent' FROM sessionSelectable), and reading
        // that projection back on every picker refresh is exactly what
        // silently reverted user promotions/demotions (#1039 family — the
        // dev-front-door force had the same revert effect on those seven
        // agents). The front-door de-dup therefore applies at insert only.
        // Backfill prompt/model ONLY when the profile has none yet — never
        // clobber values the user edited in the designer (the source of
        // truth for model/prompt).
        //
        // is_manager is intentionally absent — see comment block above the
        // DEV_FRONT_DOOR_PRIMARY constant. That flag is user-controlled and
        // must survive re-syncs unchanged.
        const patch: Parameters<typeof repo.update>[1] = {};
        if (existing.ocAgent !== name) patch.ocAgent = name;
        if (!existing.systemPrompt && prompt) patch.systemPrompt = prompt;
        if (!existing.modelProvider && !existing.modelId) {
          patch.modelProvider = resolvedProvider;
          patch.modelId = resolvedModelId;
        }
        // USER-OWNED overlay allowlists — allowed_mcps_json, allowed_skills_json,
        // and allowed_delegates_json are owned by the designer, not the engine.
        // The sync must NEVER overwrite a value the user set. MCP + skill
        // defaults are INSERT-ONLY so an explicit NULL survives re-sync as
        // unrestricted; delegate seeding remains null-backfill-on-update because
        // its NULL state is not the runtime "unrestricted" sentinel.
        //
        // Live bug this guards against: re-syncing was nulling/regenerating these
        // columns, so e.g. Secretary silently lost its allowed_mcps_json scope and
        // had to be re-PATCHed. allowedDelegatesJson was the worst offender — it
        // was written unconditionally, clobbering user overrides on every sync.
        if (existing.allowedDelegatesJson === null && allowedDelegatesJson !== null) {
          patch.allowedDelegatesJson = allowedDelegatesJson;
        }
        // #1073 — same backfill-only discipline: only seed from the engine
        // when the profile has no permission scope yet. A user who PATCHed
        // corePermissionsJson via the designer keeps their exact value across
        // every re-sync.
        if (existing.corePermissionsJson === null && resolvedPermissionsJson !== null) {
          patch.corePermissionsJson = resolvedPermissionsJson;
        }
        if (Object.keys(patch).length > 0) {
          repo.update(name, patch);
        }
      } else {
        repo.insert({
          id: name,
          label: titleCase(name),
          icon: 'assets/agents/opencode.png',
          isAgent: true,
          enabled: true,
          // is_manager is intentionally NOT set here. The delegator/manager role
          // is user-controlled and must never be assigned by the importer.
          // Omitting the field lets repo.insert() write the DB DEFAULT (0/false).
          // See "is_manager decoupling" comment block above and
          // agent_profile_sync_hygiene.test.ts for the enforcement tests.
          ocAgent: name,
          sessionSelectable: selectable,
          systemPrompt: prompt,
          modelProvider: resolvedProvider,
          modelId: resolvedModelId,
          // Default MCP scope: "rhythm" local server — #789-normalized to the
          // exact live engine id, then #788-validated against the live set so no
          // dead name is persisted. null = unrestricted (no live match / engine
          // unavailable with no default surviving).
          allowedMcpsJson: validateMcpsAgainstLive(
            importerDefaultAllowedMcpsJson,
            liveMcpNames,
            name,
          ),
          // Derive per-agent skill allowlist from name, then intersect with the
          // fork's live skill names so no dead name is persisted (Unify-3). null =
          // all eligible (fail-open for agents not in the map).
          allowedSkillsJson: filterAllowlistToLive(
            deriveSkillAllowlist(name),
            liveSkillNames,
            name,
          ),
          // is_manager is intentionally NOT set here — see comment block above.
          allowedDelegatesJson,
          // #1073 — seed from the engine's resolved permission block on first
          // import; null when the engine reports none (existing behavior).
          corePermissionsJson: resolvedPermissionsJson,
          sortOrder: 100,
        });
      }
      synced++;
    } catch (err) {
      logger.warn(`[AgentProfileSync] upsert failed for "${name}": ${String(err)}`);
    }
  }

  logger.info(`[AgentProfileSync] synced ${synced} opencode agent profile(s)`);

  // #858 — repair rows whose oc_agent is not the reliable engine handle.
  //
  // The loop above only reaches rows whose `id` equals a NAME the engine
  // reported via listAgents(). Profiles created directly via POST
  // /agent-configs (the designer, or an org-optimizer create-agent proposal
  // that predates this fix) get a random UUID `id` from
  // AgentConfigsRepository.insert() and are NEVER visited by that loop —
  // the engine has no agent literally named "<uuid>" until
  // opencode_agent_writer.writeAgentProfileFile() projects the profile to
  // ~/.config/opencode/agents/<id>.md and the engine reloads it. Until that
  // round-trip completes (or for rows the round-trip never reaches, e.g. the
  // engine was down when the profile was saved), oc_agent is stuck at
  // whatever the caller happened to pass — often null, and issue #858 also
  // surfaced rows where it held a different row's UUID by mistake.
  //
  // Both agent_sessions_controller (session-create/resume) and
  // resolveProfileScope/ws_gateway treat oc_agent as the reliable engine
  // routing target, falling back to `id` only when oc_agent is empty. Since
  // writeAgentProfileFile always names the projected file after `id`, `id`
  // IS the eventual engine-registered name for these rows — so self-healing
  // oc_agent to `id` here is always correct, never a guess, and idempotent.
  //
  // Scope: only rows isProjectableAgentConfig() considers real opencode
  // agents (excludes CLI model-selector presets and opencode builtins, which
  // are intentionally never opencode agents) and only enabled rows. A row
  // whose oc_agent already matches `id` is left alone (no-op write). Uses the
  // pure predicate (not shouldWriteAgentFile) so the backfill also runs
  // under vitest — this pass never touches the filesystem, only the DB.
  try {
    const repoAll = repo.list();
    for (const config of repoAll) {
      if (!config.enabled) continue;
      if (!isProjectableAgentConfig(config)) continue;
      if (config.ocAgent === config.id) continue;
      repo.update(config.id, { ocAgent: config.id });
      logger.warn(
        `[AgentProfileSync] #858 backfilled stale oc_agent for "${config.id}" (was "${config.ocAgent ?? 'null'}") → "${config.id}"`,
      );
    }
  } catch (err) {
    logger.warn(`[AgentProfileSync] #858 oc_agent backfill pass failed (non-fatal): ${String(err)}`);
  }

  // #900 — self-heal any enabled/projectable profile whose ~/.config/opencode/agents/<id>.md
  // is missing. This happens for rows inserted into agent_configs by a path that never
  // called writeAgentProfileFile (e.g. a direct DB insert) — the opencode engine has no
  // agent registered under that id, so any session routed to it fails with a confusing
  // "UnknownError: UnknownError" (agent-registry lookup, not a provider/network failure).
  // isAgentProfileFileMissing no-ops under postgres/test, same gating as the write itself.
  try {
    for (const config of repo.list()) {
      if (!config.enabled) continue;
      if (!isAgentProfileFileMissing(config)) continue;
      projectAgentProfileAfterWrite(config, 'sync');
      logger.warn(
        `[AgentProfileSync] #900 self-healed missing agent file for orphaned profile "${config.id}"`,
      );
    }
  } catch (err) {
    logger.warn(`[AgentProfileSync] #900 orphaned-profile self-heal pass failed (non-fatal): ${String(err)}`);
  }

  // #1135 — belt-and-braces: delete a stale ~/.config/opencode/agents/<id>.md
  // left over for a row that is now DISABLED. The PATCH path
  // (syncAgentProfileFileForState) deletes on the enable→false transition
  // going forward, but this reconcile pass catches rows already stale on disk
  // (disabled before this fix shipped, or disabled by a path that bypassed the
  // PATCH controller). deleteAgentProfileFile is idempotent and no-ops (its
  // own postgres/test gate, plus a no-op when the file doesn't exist) so it's
  // safe to call for every disabled row on every sync.
  try {
    for (const config of repo.list()) {
      if (agentConfigExecutionBlockReason(config) === null) continue;
      if (!isProjectableAgentConfigIgnoringEnabled(config)) continue;
      deleteAgentProfileFile(config.id);
    }
  } catch (err) {
    logger.warn(`[AgentProfileSync] #1135 stale-file reconcile pass failed (non-fatal): ${String(err)}`);
  }

  // #883 — reconcile the secretary row's is_manager / allowed_delegates_json
  // against .mcp-roles/secretary.mcp.json's isManager/allowedDelegates fields.
  // Runs here (after the main loop, alongside the #858 repair pass above) so
  // the reconciliation applies as soon as the secretary row exists — not just
  // at server boot — since this function is also invoked on-demand via
  // GET /agent-sessions/agents (fire-and-forget) and POST
  // /agent-configs/sync-opencode. Backfill-only; never overwrites a value a
  // human already set in the designer. Never throws.
  try {
    const { seedSecretaryDelegation } = await import('./secretary_delegation_seed');
    await seedSecretaryDelegation();
    // #889: the reconcile above only touches the DB row. The engine reads the
    // projected `~/.config/opencode/agents/secretary.md`, NOT the DB — so
    // re-project it here so the reconciled roster and the hub routing preamble
    // (rhythm_delegate for domain work) actually reach the running agent.
    // Without this the .md stays stale (pre-#889 preamble) and Secretary never
    // delegates. writeAgentProfileFile no-ops under postgres/test.
    const secretary = repo.getById('secretary');
    if (secretary) projectAgentProfileAfterWrite(secretary, 'sync');
  } catch (err) {
    logger.warn(`[AgentProfileSync] #883 secretary delegation seed failed (non-fatal): ${String(err)}`);
  }

  return { synced };
}
