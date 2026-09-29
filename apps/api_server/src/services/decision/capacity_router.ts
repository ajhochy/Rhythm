import {
  getDecisionCapacityCrossAgent,
  getDecisionCapacityLowFraction,
  getEffectiveDecisionMode,
} from '../../config/env';
import type { DecisionMode } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  PROVIDER_TO_AGENT_KIND,
  ROUTE_FALLBACKS_BY_AGENT,
  classifyRouteTier,
  type ModelRoute,
  type ModelTier,
} from '../agent_model_resolver';
import { getUsageBudget } from '../usage_budget_service';
import { comparePreference, getRoutableModels, type CatalogSource, type RoutableModel } from './model_catalog';
import type { UsageBudgetProvider, UsageBudgetSnapshot } from '../usage_budget_service';
import { recordDecision } from './decision_log';

/**
 * Usage-capacity routing. Evaluates the remaining usage of every connected
 * account (from the CACHED usage-budget snapshot, never a network probe),
 * prefers the account with the most headroom, and when everything is low picks
 * the lowest-cost route that is still capable enough for the job.
 *
 * `chooseCapacityRoute` and friends are pure. `applyCapacityRouting` is the
 * off/shadow/on wrapper and, like the rest of the decision engine, never throws.
 */

type UsageProviderId = UsageBudgetProvider['provider'];

export interface AccountHeadroom {
  provider: UsageProviderId;
  accountId: string | null;
  /** Min remainingFraction over items with a known value; null when none known. */
  headroom: number | null;
  soonestResetAt: string | null;
  isDefault: boolean;
}

const TIER_RANK: Record<ModelTier, number> = { cheap: 0, standard: 1, frontier: 2 };

/** Zero-cost local providers. They are only ever capable of the cheap tier. */
const LOCAL_PROVIDER_IDS = new Set(['ollama', 'omlx']);

/** Route providerID -> usage-budget provider. Unlisted providers expose no usage data. */
const ROUTE_TO_USAGE_PROVIDER: Record<string, UsageProviderId> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'gemini',
  openrouter: 'openrouter',
};

/** Below this gap a known-good current account is kept (avoids flip-flopping). */
const STICKY_MARGIN = 0.1;

export function usageProviderFor(providerID: string): UsageProviderId | null {
  return ROUTE_TO_USAGE_PROVIDER[providerID] ?? null;
}

export function accountHeadroom(snapshot: UsageBudgetSnapshot): AccountHeadroom[] {
  const out: AccountHeadroom[] = [];
  for (const p of snapshot.providers ?? []) {
    if (p.kind === 'unavailable') continue;
    let headroom: number | null = null;
    let soonest: string | null = null;
    for (const item of p.items ?? []) {
      if (typeof item.remainingFraction === 'number' && Number.isFinite(item.remainingFraction)) {
        headroom =
          headroom === null ? item.remainingFraction : Math.min(headroom, item.remainingFraction);
      }
      if (item.resetAt && (soonest === null || Date.parse(item.resetAt) < Date.parse(soonest))) {
        if (Number.isFinite(Date.parse(item.resetAt))) soonest = item.resetAt;
      }
    }
    out.push({
      provider: p.provider,
      accountId: p.accountId ?? null,
      headroom,
      soonestResetAt: soonest,
      isDefault: p.isDefault === true,
    });
  }
  return out;
}

function isLow(h: AccountHeadroom, lowFraction: number): boolean {
  return h.headroom !== null && h.headroom <= lowFraction;
}

/** 0 = known non-low, 1 = unknown, 2 = low. */
function category(h: AccountHeadroom, lowFraction: number): number {
  if (h.headroom === null) return 1;
  return isLow(h, lowFraction) ? 2 : 0;
}

/** Best entry first: category, then most headroom, then default, then stable. */
function rankEntries(entries: AccountHeadroom[], lowFraction: number): AccountHeadroom[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ca = category(a.e, lowFraction);
      const cb = category(b.e, lowFraction);
      if (ca !== cb) return ca - cb;
      if (ca !== 1 && a.e.headroom !== b.e.headroom) {
        return (b.e.headroom as number) - (a.e.headroom as number);
      }
      if (a.e.isDefault !== b.e.isDefault) return a.e.isDefault ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.e);
}

/** The account id with the most headroom for `provider` (null when none / no id). */
export function pickAccount(
  provider: UsageProviderId,
  snapshot: UsageBudgetSnapshot,
  lowFraction: number = getDecisionCapacityLowFraction(),
): string | null {
  const entries = accountHeadroom(snapshot).filter((h) => h.provider === provider);
  return rankEntries(entries, lowFraction)[0]?.accountId ?? null;
}

interface ProviderState {
  entries: AccountHeadroom[];
  best: AccountHeadroom | null;
  /** True only on a positive signal: entries exist and every one is known-low. */
  low: boolean;
  /** Best headroom fraction (null when unknown / no data). */
  headroom: number | null;
}

function providerState(
  providerID: string,
  headrooms: AccountHeadroom[],
  lowFraction: number,
): ProviderState {
  const usage = usageProviderFor(providerID);
  const entries = usage ? headrooms.filter((h) => h.provider === usage) : [];
  const ranked = rankEntries(entries, lowFraction);
  const best = ranked[0] ?? null;
  return {
    entries,
    best,
    low: best !== null && category(best, lowFraction) === 2,
    headroom: best?.headroom ?? null,
  };
}

export interface CapacityRouteInput {
  agentId: string;
  requiredTier: ModelTier;
  baseRoute: ModelRoute;
  snapshot: UsageBudgetSnapshot;
  /** When set, only routes whose providerID is in this set are candidates. */
  authedProviders?: Iterable<string>;
  lowFraction?: number;
  /**
   * Live-catalog candidates (already connected/filtered/tiered). When set they replace
   * the ROUTE_FALLBACKS_BY_AGENT tables, and a candidate's tier is its catalog tier.
   */
  candidates?: readonly RoutableModel[];
}

export interface CapacityRouteResult {
  route: ModelRoute;
  accountId: string | null;
  allLow: boolean;
  reason: string;
  /** True when the chosen route came from another agent's fallback table. */
  crossAgent?: boolean;
}

interface Candidate {
  route: ModelRoute;
  tier: ModelTier;
  state: ProviderState;
  order: number;
}

function sameRoute(a: ModelRoute, b: ModelRoute): boolean {
  return a.providerID === b.providerID && a.modelID === b.modelID;
}

/** Known headroom first (most first), unknown after. */
function headroomCmp(a: ProviderState, b: ProviderState): number {
  if (a.headroom === null && b.headroom === null) return 0;
  if (a.headroom === null) return 1;
  if (b.headroom === null) return -1;
  return b.headroom - a.headroom;
}

export function chooseCapacityRoute(input: CapacityRouteInput): CapacityRouteResult {
  const low = input.lowFraction ?? getDecisionCapacityLowFraction();
  const headrooms = accountHeadroom(input.snapshot);
  const authed = input.authedProviders ? new Set(input.authedProviders) : null;
  const requiredRank = TIER_RANK[input.requiredTier];
  const base = input.baseRoute;

  const baseState = providerState(base.providerID, headrooms, low);
  if (!baseState.low) {
    return {
      route: base,
      accountId: baseState.best?.accountId ?? null,
      allLow: false,
      reason: 'base_provider_has_capacity',
    };
  }

  const candidates: Candidate[] = [];
  const crossAgentOn = getDecisionCapacityCrossAgent();
  let isCross: (r: ModelRoute) => boolean;
  if (input.candidates) {
    // Live catalog: cross-provider equivalence is by tier band (price), not by name.
    // With cross-agent off only this agent's own providers (and aggregators) qualify.
    const ownProvider = (providerID: string): boolean =>
      providerID === base.providerID ||
      PROVIDER_TO_AGENT_KIND[providerID] === input.agentId ||
      !PROVIDER_TO_AGENT_KIND[providerID];
    isCross = (r) => crossAgentOn && !ownProvider(r.providerID);
    // Same-tier ties: lowest output cost first, then newest release (stable over catalog order).
    [...input.candidates].sort(comparePreference).forEach((m, order) => {
      if (!crossAgentOn && !ownProvider(m.providerID)) return;
      const route: ModelRoute = { providerID: m.providerID, modelID: m.modelID };
      if (TIER_RANK[m.tier] < requiredRank) return;
      if (LOCAL_PROVIDER_IDS.has(route.providerID) && m.tier !== 'cheap') return;
      candidates.push({ route, tier: m.tier, state: providerState(route.providerID, headrooms, low), order });
    });
  } else {
    const ownRoutes = ROUTE_FALLBACKS_BY_AGENT[input.agentId] ?? [];
    // The agent's own table first (it wins ties), then every other agent's routes,
    // so a low Anthropic base can reach an equivalent-tier OpenAI route.
    const routes = [...ownRoutes];
    if (crossAgentOn) {
      for (const [agent, list] of Object.entries(ROUTE_FALLBACKS_BY_AGENT)) {
        if (agent === input.agentId) continue;
        for (const r of list) if (!routes.some((x) => sameRoute(x, r))) routes.push(r);
      }
    }
    isCross = (r) =>
      crossAgentOn && !ownRoutes.some((x) => sameRoute(x, r)) && !sameRoute(r, base);
    routes.forEach((route, order) => {
      if (authed && !authed.has(route.providerID)) return;
      const tier = classifyRouteTier(route);
      if (TIER_RANK[tier] < requiredRank) return;
      if (LOCAL_PROVIDER_IDS.has(route.providerID) && tier !== 'cheap') return;
      candidates.push({ route, tier, state: providerState(route.providerID, headrooms, low), order });
    });
  }
  // The base route always stays a candidate for the all-low fallback, even when
  // it is not in the agent's fallback table.
  if (!candidates.some((c) => sameRoute(c.route, base))) {
    candidates.push({
      route: base,
      tier: input.candidates
        ? input.candidates.find((m) => m.providerID === base.providerID && m.modelID === base.modelID)?.tier ??
          classifyRouteTier(base)
        : classifyRouteTier(base),
      state: baseState,
      order: -1,
    });
  }

  // Step 2: another provider with capacity and enough capability.
  const withCapacity = candidates
    .filter((c) => c.route.providerID !== base.providerID && !c.state.low)
    .filter((c) => TIER_RANK[c.tier] >= requiredRank)
    .sort((a, b) => {
      // Known non-low headroom always beats unknown (no usage data).
      const knownA = a.state.headroom === null ? 1 : 0;
      const knownB = b.state.headroom === null ? 1 : 0;
      if (knownA !== knownB) return knownA - knownB;
      const exactA = TIER_RANK[a.tier] === requiredRank ? 0 : 1;
      const exactB = TIER_RANK[b.tier] === requiredRank ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      if (a.tier !== b.tier) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
      const h = headroomCmp(a.state, b.state);
      if (h !== 0) return h;
      return a.order - b.order;
    });
  if (withCapacity.length > 0) {
    const c = withCapacity[0];
    return {
      route: c.route,
      accountId: c.state.best?.accountId ?? null,
      allLow: false,
      reason: `base_provider_low_switched_to_${c.route.providerID}`,
      ...(isCross(c.route) ? { crossAgent: true } : {}),
    };
  }

  // Step 3: everything is low — lowest cost that is still capable enough.
  const cost = (c: Candidate): number =>
    LOCAL_PROVIDER_IDS.has(c.route.providerID) ? 0 : 1 + TIER_RANK[c.tier];
  const cheapest = candidates
    .filter((c) => TIER_RANK[c.tier] >= requiredRank)
    .sort((a, b) => {
      const d = cost(a) - cost(b);
      if (d !== 0) return d;
      // Unknown is not low: it beats a known-low provider at the same cost.
      const lowA = a.state.low ? 1 : 0;
      const lowB = b.state.low ? 1 : 0;
      if (lowA !== lowB) return lowA - lowB;
      const h = headroomCmp(a.state, b.state);
      if (h !== 0) return h;
      return a.order - b.order;
    })[0];
  const chosen = cheapest ?? { route: base, state: baseState };
  return {
    route: chosen.route,
    accountId: chosen.state.best?.accountId ?? null,
    allLow: true,
    reason: sameRoute(chosen.route, base) ? 'all_low_keep_base' : 'all_low_cheapest_capable',
    ...(isCross(chosen.route) ? { crossAgent: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Auto-picked account sessions (in-memory; lost on restart, which is
// intentionally conservative: an unknown session is never switched).
// ---------------------------------------------------------------------------

const autoAccountSessions = new Set<string>();

/** With `provider`, only that provider's account counts as auto-picked. */
export function markAutoAccountSession(sessionId: string, provider?: 'anthropic' | 'openai'): void {
  autoAccountSessions.add(provider ? `${sessionId}:${provider}` : sessionId);
}

export function isAutoAccountSession(sessionId: string, provider?: 'anthropic' | 'openai'): boolean {
  return (
    autoAccountSessions.has(sessionId) ||
    (provider !== undefined && autoAccountSessions.has(`${sessionId}:${provider}`))
  );
}

export function clearAutoAccountSessionsForTests(): void {
  autoAccountSessions.clear();
}

/** A cached snapshot older than this (or missing) triggers a background refresh. */
const CACHE_REFRESH_AFTER_MS = 5 * 60_000;
let refreshInFlight = false;

/**
 * Fire-and-forget refresh of the usage cache (one Anthropic probe request per
 * refresh). Never awaited on the turn path, at most one in flight, errors swallowed.
 */
function primeUsageCache(): void {
  if (refreshInFlight) return;
  refreshInFlight = true;
  void Promise.resolve()
    .then(() => getUsageBudget())
    .catch(() => undefined)
    .finally(() => {
      refreshInFlight = false;
    });
}

export function resetCapacityRefreshForTests(): void {
  refreshInFlight = false;
}

/** Cached snapshot (never a probe). Missing/stale (>5 min) also primes a background refresh. */
async function readCachedSnapshot(): Promise<UsageBudgetSnapshot | null> {
  const snapshot = await getUsageBudget({ cachedOnly: true });
  const usable = !!snapshot && Array.isArray(snapshot.providers) && snapshot.providers.length > 0;
  const fetchedAt = usable ? Date.parse(snapshot.fetchedAt) : NaN;
  if (!usable || !Number.isFinite(fetchedAt) || Date.now() - fetchedAt > CACHE_REFRESH_AFTER_MS) {
    primeUsageCache();
  }
  return usable ? snapshot : null;
}

/**
 * Session-create helper: account with the most headroom for the provider, only
 * when capacity routing is 'on' and the usage cache is warm. Never throws.
 */
export async function autoPickAccountId(
  provider: 'anthropic' | 'openai',
  opts: { sessionAuto?: boolean } = {},
): Promise<string | null> {
  try {
    if (getEffectiveDecisionMode('capacity_routing', { sessionAuto: opts.sessionAuto }) !== 'on') {
      return null;
    }
    const snapshot = await readCachedSnapshot();
    return snapshot ? pickAccount(provider, snapshot) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

export interface ApplyCapacityInput {
  agentId: string;
  baseRoute: ModelRoute;
  requiredTier: ModelTier;
  requestedSource: string;
  sessionId?: string;
  /** Account the session currently uses for the route's provider (for baseline/stickiness). */
  currentAccountId?: string | null;
  authedProviders?: Iterable<string>;
  /** True for Auto (router) sessions: an unset env var then means 'on'. */
  sessionAuto?: boolean;
  /** Test/caller override of the effective mode (wins over env and sessionAuto). */
  modeOverride?: DecisionMode;
}

export interface CapacityDecision extends CapacityRouteResult {
  /** True when `route` differs from the base route. */
  routeChanged: boolean;
}

const MODEL_REROUTE_SOURCES = new Set(['agent_default', 'tier', 'auto']);

const fmt = (r: ModelRoute, account: string | null | undefined): string =>
  `${r.providerID}/${r.modelID}@${account ?? 'default'}`;

/**
 * Off -> null without reading anything. Reads only the cached usage snapshot
 * (a missing/stale one starts a background refresh, never awaited).
 * shadow -> logs and returns null. on -> returns the decision. Only
 * 'agent_default'/'tier'/'auto' sources may change the MODEL; pinned sources keep
 * their model and only get the best account for their provider. Never throws.
 */
export async function applyCapacityRouting(
  input: ApplyCapacityInput,
): Promise<CapacityDecision | null> {
  try {
    const mode =
      input.modeOverride ??
      getEffectiveDecisionMode('capacity_routing', { sessionAuto: input.sessionAuto });
    if (mode === 'off') return null;
    const snapshot = await readCachedSnapshot();
    if (!snapshot) return null;

    const low = getDecisionCapacityLowFraction();
    let authed = input.authedProviders;
    if (!authed) {
      try {
        const { opencodeClient } = await import('../opencode_engine');
        authed = await opencodeClient.listAuthedProviders();
      } catch {
        authed = undefined;
      }
    }

    const pinned = !MODEL_REROUTE_SOURCES.has(input.requestedSource);
    // Live catalog candidates (only for turns that may change the model); the static
    // table is used only when the engine catalog is empty/unreachable.
    let catalog: CatalogSource = 'static';
    let candidates: RoutableModel[] | undefined;
    if (!pinned) {
      try {
        const routable = await getRoutableModels({
          agentId: input.agentId,
          baseRoute: input.baseRoute,
          ...(input.authedProviders ? { authed: input.authedProviders } : {}),
        });
        catalog = routable.source;
        if (routable.source === 'live') candidates = routable.models;
      } catch {
        catalog = 'static';
      }
    }
    let result: CapacityRouteResult;
    if (pinned) {
      const state = providerState(input.baseRoute.providerID, accountHeadroom(snapshot), low);
      result = {
        route: input.baseRoute,
        accountId: state.best?.accountId ?? null,
        allLow: state.low,
        reason: 'pinned_source',
      };
    } else {
      result = chooseCapacityRoute({
        agentId: input.agentId,
        requiredTier: input.requiredTier,
        baseRoute: input.baseRoute,
        snapshot,
        authedProviders: authed,
        lowFraction: low,
        ...(candidates ? { candidates } : {}),
      });
    }

    // Stickiness: keep a healthy current account unless another one is clearly better.
    const headrooms = accountHeadroom(snapshot);
    const usage = usageProviderFor(result.route.providerID);
    if (usage && input.currentAccountId && result.accountId && result.accountId !== input.currentAccountId) {
      const cur = headrooms.find((h) => h.provider === usage && h.accountId === input.currentAccountId);
      const best = headrooms.find((h) => h.provider === usage && h.accountId === result.accountId);
      if (
        cur &&
        cur.headroom !== null &&
        !isLow(cur, low) &&
        best &&
        best.headroom !== null &&
        best.headroom - cur.headroom < STICKY_MARGIN
      ) {
        result = { ...result, accountId: input.currentAccountId };
      }
    }

    const routeChanged = !sameRoute(result.route, input.baseRoute);
    const accountChanged =
      !!result.accountId && !!input.currentAccountId && result.accountId !== input.currentAccountId;
    const decision: CapacityDecision = { ...result, routeChanged };

    // Pinned turns that need no account change are not worth a log row.
    if (!(pinned && !accountChanged)) {
      recordDecision({
        feature: 'capacity_routing',
        mode,
        sessionId: input.sessionId ?? null,
        status: 'ok',
        applied: mode === 'on' && (routeChanged || accountChanged),
        chosen: fmt(result.route, result.accountId),
        baseline: fmt(input.baseRoute, input.currentAccountId),
        detail: {
          headrooms,
          allLow: result.allLow,
          reason: result.reason,
          requiredTier: input.requiredTier,
          requestedSource: input.requestedSource,
          catalog,
          ...(result.crossAgent ? { crossAgent: true } : {}),
        },
      });
    }

    return mode === 'on' ? decision : null;
  } catch (err) {
    logger.warn(`[CapacityRouting] failed (non-fatal): ${String(err)}`);
    return null;
  }
}

/**
 * Turn-time account switch, ONLY for sessions whose account was auto-picked at
 * create time (never a user/profile choice). Returns true when it changed the
 * session's account. Uses the same writes as PATCH /agent-sessions/:id
 * (session row + accounts routing file). Never throws.
 */
export async function switchAutoSessionAccount(opts: {
  sessionId: string;
  providerID: string;
  accountId: string | null;
  /** True for Auto (router) sessions: an unset env var then means 'on'. */
  sessionAuto?: boolean;
  modeOverride?: DecisionMode;
}): Promise<boolean> {
  try {
    if (!opts.accountId) return false;
    const mode =
      opts.modeOverride ??
      getEffectiveDecisionMode('capacity_routing', { sessionAuto: opts.sessionAuto });
    if (mode !== 'on') return false;
    const usage = usageProviderFor(opts.providerID);
    if (usage !== 'anthropic' && usage !== 'openai') return false;
    if (!isAutoAccountSession(opts.sessionId, usage)) return false;
    const { AgentSessionsRepository } = await import('../../repositories/agent_sessions_repository');
    const repo = new AgentSessionsRepository();
    const session = repo.findById(opts.sessionId);
    if (!session) return false;
    if (usage === 'anthropic') {
      const { anthropicAccountsService } = await import('../anthropic_accounts_service');
      if (!anthropicAccountsService.getAccount(opts.accountId)) return false;
      if (session.anthropicAccountId === opts.accountId) return false;
      repo.setAnthropicAccountId(session.id, opts.accountId);
      if (session.sdkSessionId) anthropicAccountsService.setRouting(session.sdkSessionId, opts.accountId);
    } else {
      const { openaiAccountsService } = await import('../openai_accounts_service');
      if (!openaiAccountsService.getAccount(opts.accountId)) return false;
      if (session.openaiAccountId === opts.accountId) return false;
      repo.setOpenaiAccountId(session.id, opts.accountId);
      if (session.sdkSessionId) openaiAccountsService.setRouting(session.sdkSessionId, opts.accountId);
    }
    return true;
  } catch (err) {
    logger.warn(`[CapacityRouting] account switch failed (non-fatal): ${String(err)}`);
    return false;
  }
}
