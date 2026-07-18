/**
 * #930 — Automatic model fallback chain when rate limits hit.
 *
 * Unit 1/2: a pure, unit-tested error classifier plus a configurable, ordered
 * fallback chain. This module does NOT wire any retry/re-dispatch behavior —
 * see agent_runner.ts / opencode_spillover_routes.ts for the consumers.
 *
 * Chain tiers, most to least preferred (per the issue):
 *   1. Team Claude       (anthropic, routed via the rhythm-anthropic-accounts
 *                         'team' account — see anthropic_accounts_service.ts)
 *   2. Personal Claude    (anthropic, 'personal' account)
 *   3. Codex              (openai)
 *   4. Gemini             (google)
 *   5. GLM-5.2            (glm — NO credential loader exists in this repo;
 *                         inert entry, see note below)
 *   6. OpenRouter free    (openrouter / model 'openrouter/free', the models.dev
 *                         "Free Models Router" — a REAL wired, authable tier)
 *
 * GLM-5.2 has no provider/auth integration anywhere in Rhythm today: there is
 * no `glm` credential loader, so `listAuthedProviders()` can never contain it
 * and `resolveAuthedFallbackChain` always filters it out. It exists in the
 * chain as data only; wiring real credentials for it is follow-up work.
 *
 * OpenRouter-free IS wired: `openrouter` is a built-in SDK auth loader
 * (see opencode_plugin_config.ts), authable via connectUrl
 * `/opencode/auth/openrouter`, and `openrouter/free` ("Free Models Router",
 * cost $0, tool-call capable) is a real model in the models.dev catalog. When
 * OpenRouter is authed it becomes the always-available last-resort tier; when
 * it is not, `resolveAuthedFallbackChain` drops it exactly like any other
 * unauthed tier — so wiring it is inert-when-unauthed, functional-when-authed.
 */

/** Canonical fallback chain, most to least preferred. */
export interface FallbackTier {
  /** Stable id for this tier (used in logs/events; also the env-override token). */
  id: string;
  /** Human label for status events / logs. */
  label: string;
  /** SDK provider id this tier maps to (matches opencodeClient.listAuthedProviders() entries). */
  providerID: string;
}

export const FALLBACK_CHAIN: FallbackTier[] = [
  { id: 'team-claude', label: 'Team Claude', providerID: 'anthropic' },
  { id: 'personal-claude', label: 'Personal Claude', providerID: 'anthropic' },
  { id: 'codex', label: 'Codex', providerID: 'openai' },
  { id: 'gemini', label: 'Gemini', providerID: 'google' },
  // ponytail: inert until a GLM credential loader exists — never matches an authed provider.
  { id: 'glm-5.2', label: 'GLM-5.2', providerID: 'glm' },
  // Wired: 'openrouter' is a real authable SDK provider; model resolved to
  // 'openrouter/free' ("Free Models Router") via DEFAULT_MODEL_BY_PROVIDER.
  { id: 'openrouter-free', label: 'OpenRouter free', providerID: 'openrouter' },
];

export type ProviderErrorClass = 'rate_limit' | 'auth' | 'other';

/**
 * Classify a provider HTTP response status (+ optional body) into the
 * category that drives fallback decisions. Only 'rate_limit' triggers a
 * fallback chain hop; 'auth' and 'other' are surfaced as normal errors.
 *
 * Mirrors the existing (informal) classifier in the vendored
 * rhythm-anthropic-accounts plugin (`status === 429 || status === 529`),
 * generalized to a shared, testable helper.
 */
export function classifyProviderError(error: unknown, body?: string): ProviderErrorClass {
  const obj =
    error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const data =
    obj?.data && typeof obj.data === 'object'
      ? (obj.data as Record<string, unknown>)
      : undefined;
  const status =
    typeof error === 'number'
      ? error
      : typeof data?.statusCode === 'number'
        ? data.statusCode
        : typeof obj?.statusCode === 'number'
          ? obj.statusCode
          : undefined;

  if (status === 429 || status === 529) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';

  const text = [
    body,
    typeof obj?.message === 'string' ? obj.message : undefined,
    typeof data?.message === 'string' ? data.message : undefined,
    typeof data?.responseBody === 'string' ? data.responseBody : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .toLowerCase();
  if (
    /rate[_ -]?limit|too many requests|resource[_ -]?exhausted|insufficient[_ -]?quota|quota (?:is )?exhausted|quota exceeded/.test(
      text,
    )
  ) {
    return 'rate_limit';
  }
  return 'other';
}

/**
 * Parse the AGENT_FALLBACK_CHAIN env override: a comma-separated list of tier
 * ids (e.g. "team-claude,codex,gemini"). Unknown ids are dropped. Empty,
 * absent, or entirely-unknown input returns `undefined` so the caller can
 * fail safe back to the default {@link FALLBACK_CHAIN} order — matches the
 * fail-safe parsing style already used for NEAR_BUDGET_REMAINING_THRESHOLD.
 */
export function parseFallbackChainEnv(raw: string | undefined): FallbackTier[] | undefined {
  const value = (raw ?? '').trim();
  if (!value) return undefined;
  const byId = new Map(FALLBACK_CHAIN.map((tier) => [tier.id, tier]));
  const parsed = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((id) => byId.get(id))
    .filter((tier): tier is FallbackTier => Boolean(tier));
  return parsed.length > 0 ? parsed : undefined;
}

/** The chain to use: AGENT_FALLBACK_CHAIN override if valid, else the default order. */
export function getConfiguredFallbackChain(): FallbackTier[] {
  return parseFallbackChainEnv(process.env.AGENT_FALLBACK_CHAIN) ?? FALLBACK_CHAIN;
}

/**
 * Resolve the fallback chain filtered down to tiers whose provider is
 * actually authed, per the existing global `listAuthedProviders()` gate
 * (product decision: no new per-profile allowlist — reuse this as the sole
 * "allowed providers" check). Preserves chain order. GLM-5.2 and
 * GLM remains filtered because no credential loader exists. OpenRouter-free
 * is included whenever the real `openrouter` auth entry is present.
 */
export function resolveAuthedFallbackChain(authedProviders: readonly string[]): FallbackTier[] {
  const authed = new Set(authedProviders);
  return getConfiguredFallbackChain().filter((tier) => authed.has(tier.providerID));
}

/**
 * Given the current tier id (or undefined if unknown/not yet on the chain),
 * return the next tier in the AUTHED chain to fall back to, or undefined if
 * there is none (chain exhausted).
 */
export function nextFallbackTier(
  currentTierId: string | undefined,
  authedProviders: readonly string[],
  visitedTierIds: readonly string[] = [],
): FallbackTier | undefined {
  const chain = getConfiguredFallbackChain();
  const authed = new Set(authedProviders);
  const visited = new Set(visitedTierIds);
  const idx = currentTierId ? chain.findIndex((tier) => tier.id === currentTierId) : -1;
  return chain
    .slice(idx + 1)
    .find((tier) => authed.has(tier.providerID) && !visited.has(tier.id));
}

// ── Unit 3 (scoped) — cross-provider handoff decision ───────────────────────
//
// This is the PURE "what's the next chain tier to re-dispatch on" decision.
// It intentionally does NOT touch a live opencode engine/session — the
// caller (opencode_spillover_routes.ts) is responsible for actually
// re-invoking agent_runner.run() with the resolved route, following the same
// `_isEscalation` recursion-guard shape as escalateAndCapture. See AGENTS.md
// note in opencode_spillover_routes.ts for why the vendored plugin's role
// stops at REPORTING exhaustion rather than performing the handoff itself.

/** Default one-model-per-tier per provider (a real model catalog choice lives in agent_model_resolver.ts's ROUTE_FALLBACKS_BY_AGENT; this is only the fallback used when that table has no entry for the target provider's default agent kind). */
export const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  // gpt-5.6-sol (general), NOT any `-codex` model: the specialized `-codex`
  // models are rejected for ChatGPT-account (OAuth) Codex auth — "not supported
  // when using Codex with a ChatGPT account" (live-smoke evidence, 2026-07-08).
  // sol is a GENERAL 5.6 variant (not `-codex`), served for both ChatGPT-account
  // and API-key auth, so it stays clear of that restriction. Smoke tool use on a
  // ChatGPT-plan token when validating a release (was gpt-5.4 through 2026-07-16).
  openai: 'gpt-5.6-sol',
  google: 'gemini-2.5-pro',
  // tier 6: the OpenRouter "Free Models Router" (cost $0, tool-call capable).
  openrouter: 'openrouter/free',
};

export interface CrossProviderHandoffDecision {
  tier: FallbackTier;
  providerID: string;
  modelID: string;
}

export interface ReliableFallbackModelDecision {
  tier: FallbackTier;
  providerID: string;
  modelID: string;
}

/** Resolve the next unvisited, authenticated tier with a known default model. */
export function resolveNextFallbackHandoff(
  currentTierId: string | undefined,
  authedProviders: readonly string[],
  visitedTierIds: readonly string[] = [],
): CrossProviderHandoffDecision | undefined {
  const visited = new Set(visitedTierIds);
  let cursor = currentTierId;
  while (true) {
    const tier = nextFallbackTier(cursor, authedProviders, [...visited]);
    if (!tier) return undefined;
    const modelID = DEFAULT_MODEL_BY_PROVIDER[tier.providerID];
    if (modelID) return { tier, providerID: tier.providerID, modelID };
    visited.add(tier.id);
    cursor = tier.id;
  }
}

/**
 * All reliable authed background models in configured order, de-duplicated by
 * provider. Team/personal Claude share one provider credential surface, so a
 * failed Anthropic prompt should advance to OpenAI/Google rather than retrying
 * the same provider under a second tier label.
 */
export function resolveReliableAuthedFallbackModels(
  authedProviders: readonly string[],
): ReliableFallbackModelDecision[] {
  const seenProviders = new Set<string>();
  const decisions: ReliableFallbackModelDecision[] = [];
  for (const tier of resolveAuthedFallbackChain(authedProviders)) {
    if (tier.id === 'openrouter-free' || tier.providerID === 'openrouter') continue;
    if (seenProviders.has(tier.providerID)) continue;
    const modelID = DEFAULT_MODEL_BY_PROVIDER[tier.providerID];
    if (!modelID) continue;
    seenProviders.add(tier.providerID);
    decisions.push({ tier, providerID: tier.providerID, modelID });
  }
  return decisions;
}

/**
 * Resolve a reliable authed model for background judge/refiner calls.
 *
 * This reuses #930's configured fallback chain order and default-model table,
 * but deliberately excludes the last-resort OpenRouter-free tier. That router
 * is useful as an interactive spillover destination, but it is not a safe
 * unattended judge tier because it can hang without an error frame.
 */
export function resolveReliableAuthedFallbackModel(
  authedProviders: readonly string[],
): ReliableFallbackModelDecision | undefined {
  return resolveReliableAuthedFallbackModels(authedProviders)[0];
}

/**
 * Given a rate-limit exhaustion signal reported for `exhaustedProviderID`
 * (the provider that has no more usable accounts/options left — e.g.
 * 'anthropic' when both Team and Personal Claude are rate-limited), resolve
 * the first authed tier for a DIFFERENT provider, including a default model
 * id. This deliberately skips every tier that shares `exhaustedProviderID`
 * (e.g. both 'team-claude' and 'personal-claude' are skipped together, since
 * the plugin only reports exhaustion once it has tried every account on that
 * provider). Returns undefined when no cross-provider tier is authed — the
 * caller must then surface the original error rather than silently drop the
 * run.
 */
export function resolveCrossProviderHandoff(
  exhaustedProviderID: string,
  authedProviders: readonly string[],
): CrossProviderHandoffDecision | undefined {
  const providerTiers = getConfiguredFallbackChain().filter(
    (tier) => tier.providerID === exhaustedProviderID,
  );
  return resolveNextFallbackHandoff(
    providerTiers.at(-1)?.id,
    authedProviders,
    providerTiers.map((tier) => tier.id),
  );
}

/**
 * #1108 — when the fallback cascade is fully exhausted (no further authed
 * tier available), the finalized error must identify WHICH provider/model/
 * account was last attempted rather than a bare generic string — otherwise
 * the user has no actionable lead on which limit was actually reached.
 * Any argument may be omitted (unknown); omitted fields are simply left out
 * of the parenthetical rather than rendered as "undefined".
 */
export function formatFallbackExhaustedMessage(
  providerID?: string | null,
  modelID?: string | null,
  accountId?: string | null,
): string {
  const parts = [
    providerID ? `provider=${providerID}` : null,
    modelID ? `model=${modelID}` : null,
    accountId ? `account=${accountId}` : null,
  ].filter((v): v is string => v !== null);
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `All configured fallback options are exhausted${detail} — connect another provider or wait for the rate limit to reset.`;
}
