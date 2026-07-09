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
export function classifyProviderError(status: number, _body?: string): ProviderErrorClass {
  if (status === 429 || status === 529) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
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
 * OpenRouter-free are never authed today, so they are always filtered out
 * here — this is what makes them "inert" entries rather than a code gap.
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
): FallbackTier | undefined {
  const chain = resolveAuthedFallbackChain(authedProviders);
  if (!currentTierId) return chain[0];
  const idx = chain.findIndex((tier) => tier.id === currentTierId);
  if (idx === -1) return chain[0];
  return chain[idx + 1];
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
  // gpt-5.4 (general), NOT gpt-5.3-codex: the `-codex` specialized models are
  // rejected for ChatGPT-account (OAuth) Codex auth — "not supported when using
  // Codex with a ChatGPT account" (live-smoke evidence, 2026-07-08). gpt-5.4 is
  // served for both ChatGPT-account and API-key auth, so it's the safe default.
  openai: 'gpt-5.4',
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
  const tier = resolveAuthedFallbackChain(authedProviders).find(
    (t) => t.id !== 'openrouter-free' && t.providerID !== 'openrouter',
  );
  if (!tier) return undefined;
  const modelID = DEFAULT_MODEL_BY_PROVIDER[tier.providerID];
  if (!modelID) return undefined;
  return { tier, providerID: tier.providerID, modelID };
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
  const chain = resolveAuthedFallbackChain(authedProviders);
  const tier = chain.find((t) => t.providerID !== exhaustedProviderID);
  if (!tier) return undefined;
  const modelID = DEFAULT_MODEL_BY_PROVIDER[tier.providerID];
  if (!modelID) return undefined; // no known default model for this provider — decline rather than guess
  return { tier, providerID: tier.providerID, modelID };
}
