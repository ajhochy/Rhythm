import { opencodeClient } from './opencode_engine';
import { getUsageBudget } from './usage_budget_service';
import { logger } from '../utils/logger';

/**
 * OPC-M1-1: Server-side provider-to-agent-kind mapping.
 *
 * Maps SDK provider IDs to the Rhythm agent kind they back. This is derived
 * from ROUTE_FALLBACKS_BY_AGENT: each direct (non-aggregator) provider ID
 * maps to the agent kind it primarily supports. Aggregators (openrouter, etc.)
 * are intentionally omitted — they don't have a 1:1 agent mapping.
 *
 * Exposed via GET /agents/capabilities as `providerToAgentKind`.
 */
export const PROVIDER_TO_AGENT_KIND: Record<string, string> = {
  anthropic: 'claude-code',
  'github-copilot': 'claude-code',
  openai: 'codex',
  google: 'gemini-cli',
  ollama: 'opencode',
};

/**
 * Optional variant label rendered as a sub-label in the model picker.
 * Examples: "1M context", "Legacy", "Thinking".
 */
export interface ModelRoute {
  providerID: string;
  modelID: string;
  /** Optional human-readable variant label shown below the model ID in the picker. */
  variantLabel?: string;
}

/**
 * Ordered fallback list of ModelRoute entries per agentId.
 *
 * The SDK only successfully routes to providers with a built-in loader
 * (openrouter, openai, github-copilot, opencode) plus any community plugin
 * loaders the user has installed (anthropic via opencode-claude-auth,
 * google via opencode-gemini-auth, openai-codex via
 * opencode-openai-codex-auth).
 *
 * Routes are tried in order: first entry whose providerID is in the user's
 * `listAuthedProviders()` set wins. If nothing matches, the first entry is
 * returned and the SDK will surface the error (ProviderModelNotFoundError)
 * to the UI via the stream bridge — better than silent failure.
 */
export const ROUTE_FALLBACKS_BY_AGENT: Record<string, ModelRoute[]> = {
  'claude-code': [
    { providerID: 'anthropic', modelID: 'claude-opus-4-7' },
    { providerID: 'anthropic', modelID: 'claude-opus-4-7-1m', variantLabel: '1M context' },
    { providerID: 'anthropic', modelID: 'claude-opus-4-6-legacy', variantLabel: 'Legacy' },
    { providerID: 'anthropic', modelID: 'claude-opus-4-5' },
    { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
    { providerID: 'anthropic', modelID: 'claude-haiku-4-5' },
    { providerID: 'github-copilot', modelID: 'claude-opus-4-7' },
    { providerID: 'github-copilot', modelID: 'claude-sonnet-4-6' },
    { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-opus-4.7' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-opus-4.7:extended', variantLabel: '1M context' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-opus-4.5' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4.6' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-haiku-4.5' },
  ],
  codex: [
    { providerID: 'openai', modelID: 'gpt-5.3-codex' },
    { providerID: 'openai', modelID: 'gpt-5.4' },
    { providerID: 'openai', modelID: 'gpt-5.4-mini' },
    { providerID: 'github-copilot', modelID: 'gpt-5-mini' },
    { providerID: 'openrouter', modelID: 'openai/gpt-5.3-codex' },
    { providerID: 'openrouter', modelID: 'openai/gpt-5.4' },
    { providerID: 'openrouter', modelID: 'openai/gpt-5.4-mini' },
  ],
  // Direct `google` routes come FIRST so the agent uses the user's own Google
  // account (free Gemini Code Assist via the opencode-gemini-auth plugin) before
  // spending OpenRouter credits. The plugin only registers the `google` provider
  // when a Code Assist projectId is resolvable (set via
  // provider.google.options.projectId in opencode.json — required for Workspace
  // accounts); when it isn't, `google` is absent from the engine and the resolver
  // falls through to the OpenRouter routes below. Model IDs MUST match the
  // plugin's catalog (verify with `opencode models google`); the older
  // `gemini-3-pro-preview`/`gemini-3-flash` ids do NOT exist.
  'gemini-cli': [
    { providerID: 'google', modelID: 'gemini-2.5-pro' },
    { providerID: 'google', modelID: 'gemini-2.5-flash' },
    { providerID: 'google', modelID: 'gemini-3.1-pro-preview' },
    // OpenRouter fallback when the google provider isn't registered.
    {
      providerID: 'openrouter',
      modelID: 'google/gemini-3.1-pro-preview-customtools',
    },
    { providerID: 'openrouter', modelID: 'google/gemini-3-flash-preview' },
  ],
  // Keep the cloud route first for unscoped generic sessions: the complete
  // Rhythm tool surface is too large for practical local-model prefill. Ollama
  // remains directly selectable and is the fallback when no cloud route exists.
  opencode: [
    { providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4.6' },
    {
      providerID: 'ollama',
      modelID: 'qwen3.6-work',
      variantLabel: 'Local',
    },
  ],
};

/** Pick the first authed route for the given agent, or the first route if none authed. */
export async function resolveModelForAgent(
  agentId: string,
): Promise<ModelRoute | undefined> {
  const routes = ROUTE_FALLBACKS_BY_AGENT[agentId];
  if (!routes || routes.length === 0) return undefined;
  const authed = new Set(await opencodeClient.listAuthedProviders());
  for (const route of routes) {
    if (authed.has(route.providerID)) return route;
  }
  return routes[0];
}

/**
 * #602 — Returns every route across all agents, annotated with the auth state.
 *
 * Each entry carries:
 *   agent       — the agent kind (claude-code, codex, gemini-cli, opencode)
 *   provider    — provider ID (anthropic, openai, github-copilot, openrouter, …)
 *   modelId     — model identifier
 *   displayName — human-readable label (same as existing ModelRoute fields)
 *   variantLabel — optional sub-label
 *   route       — 'direct' | 'aggregator'
 *   authorized  — true when the provider is in the authed set
 *   authProvider — canonical provider string used to look up the auth start URL
 *   connectUrl  — relative URL to open in a browser to connect this provider
 */
export interface CatalogEntry extends ModelRoute {
  agent: string;
  route: 'direct' | 'aggregator';
  authorized: boolean;
  authProvider: string;
  connectUrl?: string;
}

/** Mapping from provider ID → OAuth start path. */
const PROVIDER_CONNECT_URL: Record<string, string> = {
  anthropic: '/opencode/auth/anthropic/authorize',
  openai: '/opencode/auth/openai/authorize',
  google: '/opencode/auth/google/authorize',
  'github-copilot': '/opencode/auth/github-copilot/device-start',
  openrouter: '/opencode/auth/openrouter',
};

const AGGREGATOR_IDS = new Set(['openrouter', 'together', 'groq']);

/**
 * Returns the full cross-agent catalog with authorization state.
 * Callers may pass a pre-loaded authedSet to avoid redundant I/O.
 */
export async function listAllRoutes(
  authedSet?: Set<string>,
): Promise<CatalogEntry[]> {
  const authSet =
    authedSet ?? new Set(await opencodeClient.listAuthedProviders());

  const entries: CatalogEntry[] = [];
  for (const [agent, routes] of Object.entries(ROUTE_FALLBACKS_BY_AGENT)) {
    for (const route of routes) {
      const isAggregator = AGGREGATOR_IDS.has(route.providerID);
      entries.push({
        ...route,
        agent,
        route: isAggregator ? 'aggregator' : 'direct',
        authorized: authSet.has(route.providerID),
        authProvider: route.providerID,
        connectUrl: PROVIDER_CONNECT_URL[route.providerID],
      });
    }
  }
  return entries;
}

/**
 * M2-2 precedence helper. Resolve the model for one turn of a session.
 *
 * Order:
 *   1. Per-turn `modelOverride` field on the WS `session.input` payload (not
 *      persisted; applies to this prompt only).
 *   2. Session row's persisted `providerId` + `modelId` from M2-1.
 *   3. `resolveModelForAgent(agentId)` fallback list.
 */
export async function resolveModelForSessionTurn(opts: {
  agentId: string;
  sessionProviderId: string | null;
  sessionModelId: string | null;
  perTurnOverride?: { providerId?: string; modelId?: string } | null;
}): Promise<ModelRoute | undefined> {
  const override = opts.perTurnOverride;
  if (override?.providerId && override.modelId) {
    return { providerID: override.providerId, modelID: override.modelId };
  }
  if (opts.sessionProviderId && opts.sessionModelId) {
    return { providerID: opts.sessionProviderId, modelID: opts.sessionModelId };
  }
  return resolveModelForAgent(opts.agentId);
}

// ─────────────────────────────────────────────────────────────────────────
// #844 (tokens-04) — Tiered model routing
//
// Routes work to the CHEAPEST ADEQUATE tier automatically: mechanical stages
// (triage, formatting, extraction, summarization) run on cheap models;
// planning/judgment stages run on frontier models. This is a POLICY layer on
// top of the existing route/auth resolution above — it never changes
// `resolveModelForAgent` / `resolveModelForSessionTurn` behavior; callers opt
// in via `resolveTieredModel`.
//
// Precedence (highest wins):
//   1. `modelOverride` — an explicit caller-supplied {providerID, modelID}.
//      ALWAYS wins, over both the tier policy AND any budget-based downgrade
//      (maintainer policy: explicit user override ALWAYS wins).
//   2. `explicitTierHint` — an explicit tier (e.g. a profile's configured
//      `model_tier_hint` column). Wins over the task-kind default.
//   3. `taskKind` → `TASK_KIND_TIER_POLICY` default tier.
//   4. Fallback tier: 'standard'.
//
// Budget awareness (AC2): once a target tier is chosen, if the route's
// provider is near its usage budget (per usage_budget_service), the resolver
// downgrades to the next cheaper tier available for that agent and marks
// `downgradedForBudget: true` with a human-readable `reason`. An explicit
// `modelOverride` bypasses this entirely — never downgraded.
//
// Every decision is logged as ONE structured `[ModelRouting]` line (model
// chosen + why) so the #819 org audit can measure cost per outcome. The
// logged payload carries only routing metadata — never prompt/response text.
// ─────────────────────────────────────────────────────────────────────────

/** Coarse cost/capability tier. Ordered cheapest → most capable. */
export type ModelTier = 'cheap' | 'standard' | 'frontier';

const TIER_ORDER: ModelTier[] = ['cheap', 'standard', 'frontier'];

/** One step cheaper than `tier`, or `tier` itself when already the cheapest. */
function cheaperTier(tier: ModelTier): ModelTier {
  const idx = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, idx - 1)];
}

/**
 * Default tier policy by task kind. Mechanical, low-judgment stages default
 * to 'cheap'; planning/judgment stages default to 'frontier'. Any task kind
 * not listed here (or no task kind at all) defaults to 'standard'.
 *
 * This is a DEFAULT, not a hard rule — `explicitTierHint` (e.g. a profile's
 * `model_tier_hint`) and `modelOverride` both take precedence (see
 * {@link resolveModelTier}, {@link resolveTieredModel}).
 */
export const TASK_KIND_TIER_POLICY: Record<string, ModelTier> = {
  triage: 'cheap',
  formatting: 'cheap',
  extraction: 'cheap',
  summarization: 'cheap',
  planning: 'frontier',
  judgment: 'frontier',
};

export interface TierDecision {
  tier: ModelTier;
  /** True when `explicitTierHint` was supplied and won over the task-kind default. */
  overrideApplied: boolean;
  reason: string;
}

/**
 * Resolve the target tier for a unit of work, BEFORE budget awareness or a
 * hard model override are applied.
 *
 * Precedence: `explicitTierHint` (e.g. a profile's `model_tier_hint` column)
 * wins over the `taskKind` default; an unrecognized/absent `taskKind` with no
 * hint falls back to 'standard'.
 */
export function resolveModelTier(opts: {
  taskKind?: string | null;
  explicitTierHint?: ModelTier | null;
}): TierDecision {
  if (opts.explicitTierHint) {
    return {
      tier: opts.explicitTierHint,
      overrideApplied: true,
      reason: `explicit tier hint '${opts.explicitTierHint}'`,
    };
  }
  const taskKind = opts.taskKind ?? undefined;
  const policyTier = taskKind ? TASK_KIND_TIER_POLICY[taskKind] : undefined;
  if (policyTier) {
    return {
      tier: policyTier,
      overrideApplied: false,
      reason: `task kind '${taskKind}' -> ${policyTier} tier`,
    };
  }
  return {
    tier: 'standard',
    overrideApplied: false,
    reason: taskKind
      ? `unrecognized task kind '${taskKind}' -> standard tier (default)`
      : 'no task kind supplied -> standard tier (default)',
  };
}

/**
 * Classify a concrete {@link ModelRoute} into a {@link ModelTier} by model id.
 * Substring match is intentionally loose — model ids drift across provider
 * catalogs (e.g. 'claude-haiku-4-5', 'gpt-5.4-mini', 'gemini-2.5-flash') far
 * faster than a hand-maintained exact list would stay current.
 *
 * Order matters: 'opus' is checked before the more general fallback so e.g.
 * 'claude-opus-4-7-1m' is never mistaken for a cheap/standard tier.
 */
export function classifyRouteTier(route: ModelRoute): ModelTier {
  const id = route.modelID.toLowerCase();
  if (id.includes('opus') || id.includes('gpt-5.3-codex') || id.includes('pro')) {
    return 'frontier';
  }
  if (
    id.includes('haiku') ||
    id.includes('mini') ||
    id.includes('flash') ||
    id.includes('qwen')
  ) {
    return 'cheap';
  }
  return 'standard';
}

/**
 * Near-budget threshold: a provider is considered "near budget" when its
 * lowest reported `remainingFraction` across all usage-budget items drops
 * below this value. Overridable via AGENT_MODEL_ROUTING_NEAR_BUDGET_FRACTION
 * (0..1) for tuning without a code change.
 */
export const NEAR_BUDGET_REMAINING_THRESHOLD = (() => {
  const raw = Number(process.env.AGENT_MODEL_ROUTING_NEAR_BUDGET_FRACTION);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.15;
})();

/**
 * True when `providerId`'s usage-budget snapshot reports ANY item at or below
 * {@link NEAR_BUDGET_REMAINING_THRESHOLD} remaining. Providers with no budget
 * data (unavailable / null remainingFraction items only) are treated as
 * healthy — we only downgrade on a POSITIVE signal of scarcity, never on the
 * absence of data (fail-open, matching usage_budget_service's own posture of
 * never faking numbers).
 *
 * Never throws: a usage_budget_service failure is treated as "not near
 * budget" so a transient probe failure never silently forces every run onto
 * the cheap tier.
 */
async function isProviderNearBudget(providerId: string): Promise<boolean> {
  try {
    const snapshot = await getUsageBudget();
    const provider = snapshot.providers.find((p) => p.provider === providerId);
    if (!provider) return false;
    return provider.items.some(
      (item) =>
        typeof item.remainingFraction === 'number' &&
        item.remainingFraction <= NEAR_BUDGET_REMAINING_THRESHOLD,
    );
  } catch (err) {
    logger.warn(`[ModelRouting] budget probe failed for ${providerId} (non-fatal): ${String(err)}`);
    return false;
  }
}

/** Pick the best-authed route for `agentId` at exactly `tier`, or undefined if none. */
function pickRouteAtTier(
  agentId: string,
  tier: ModelTier,
  authed: Set<string>,
): ModelRoute | undefined {
  const routes = ROUTE_FALLBACKS_BY_AGENT[agentId] ?? [];
  const atTier = routes.filter((r) => classifyRouteTier(r) === tier);
  return atTier.find((r) => authed.has(r.providerID)) ?? atTier[0];
}

export interface TieredModelDecision {
  /** The resolved {providerID, modelID} for this run/turn. */
  route: ModelRoute;
  /** The FINAL tier actually used (post budget-downgrade). */
  tier: ModelTier;
  /** True when a budget-based downgrade moved the route to a cheaper tier. */
  downgradedForBudget: boolean;
  /** True when an explicit modelOverride or explicitTierHint won. */
  overrideApplied: boolean;
  /** Human-readable explanation of the decision, included in the log line. */
  reason: string;
}

/**
 * #844 — Resolve a model for one unit of work using the tiered routing
 * policy: task-kind / explicit-tier-hint policy, budget-aware downgrade, and
 * an explicit override that always wins over both. Emits exactly one
 * structured `[ModelRouting]` log line per call (model chosen + why; no
 * prompt/response payloads) so the #819 org audit can measure cost per
 * outcome.
 *
 * Cloud-first stands: this function only chooses AMONG the existing
 * `ROUTE_FALLBACKS_BY_AGENT` routes (already cloud-first / OpenRouter-ahead-
 * of-Ollama ordered) — it never introduces a new provider ordering, it only
 * narrows the existing list to a tier.
 */
export async function resolveTieredModel(opts: {
  agentId: string;
  taskKind?: string | null;
  explicitTierHint?: ModelTier | null;
  /** Explicit caller-supplied model — ALWAYS wins (user override). */
  modelOverride?: ModelRoute | null;
}): Promise<TieredModelDecision> {
  const authed = new Set(await opencodeClient.listAuthedProviders());

  // Precedence 1: explicit override always wins — never downgraded for budget.
  if (opts.modelOverride) {
    const decision: TieredModelDecision = {
      route: opts.modelOverride,
      tier: classifyRouteTier(opts.modelOverride),
      downgradedForBudget: false,
      overrideApplied: true,
      reason: 'explicit model override supplied — tier policy and budget downgrade bypassed',
    };
    logDecision(decision, opts);
    return decision;
  }

  // Precedence 2/3/4: tier policy (explicit hint > task kind > default).
  const tierDecision = resolveModelTier({
    taskKind: opts.taskKind,
    explicitTierHint: opts.explicitTierHint,
  });

  let tier = tierDecision.tier;
  let route = pickRouteAtTier(opts.agentId, tier, authed);
  let downgradedForBudget = false;
  let reason = tierDecision.reason;

  // Budget awareness: if the chosen route's provider is near budget, step
  // down one tier at a time (down to 'cheap') looking for an available route.
  if (route && (await isProviderNearBudget(route.providerID))) {
    const cheaper = cheaperTier(tier);
    const cheaperRoute = pickRouteAtTier(opts.agentId, cheaper, authed);
    if (cheaper !== tier && cheaperRoute) {
      reason = `${reason}; downgraded ${tier} -> ${cheaper} tier: provider '${route.providerID}' is near its usage budget`;
      tier = cheaper;
      route = cheaperRoute;
      downgradedForBudget = true;
    } else {
      reason = `${reason}; provider '${route.providerID}' is near its usage budget but no cheaper tier route is available — keeping ${tier}`;
    }
  }

  // Fallback: no route found at the target tier for this agent — use the
  // agent's normal (untiered) resolution so a run never silently hangs.
  if (!route) {
    const fallback = ROUTE_FALLBACKS_BY_AGENT[opts.agentId]?.[0];
    if (!fallback) {
      throw new Error(`resolveTieredModel: no routes configured for agent '${opts.agentId}'`);
    }
    route = fallback;
    tier = classifyRouteTier(fallback);
    reason = `${reason}; no route available at the target tier for agent '${opts.agentId}' — using default route`;
  }

  const decision: TieredModelDecision = {
    route,
    tier,
    downgradedForBudget,
    overrideApplied: tierDecision.overrideApplied,
    reason,
  };
  logDecision(decision, opts);
  return decision;
}

/**
 * Emit the single structured audit log line for a routing decision (#844
 * AC3). Deliberately carries ONLY routing metadata — provider/model/tier/
 * task-kind/reason/flags — never prompt or response text, so it is always
 * safe to log at info level and safe for the #819 org audit to scan.
 */
function logDecision(
  decision: TieredModelDecision,
  opts: { agentId: string; taskKind?: string | null },
): void {
  const payload = {
    agentId: opts.agentId,
    provider: decision.route.providerID,
    modelID: decision.route.modelID,
    tier: decision.tier,
    taskKind: opts.taskKind ?? null,
    reason: decision.reason,
    downgradedForBudget: decision.downgradedForBudget,
    overrideApplied: decision.overrideApplied,
  };
  logger.info(`[ModelRouting] ${JSON.stringify(payload)}`);
}
