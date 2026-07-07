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
 *   6. OpenRouter free    (openrouter-free — NO credential loader exists in
 *                         this repo; inert entry, see note below)
 *
 * GLM-5.2 and OpenRouter-free have no provider/auth integration anywhere in
 * Rhythm today. Per product decision, this issue does NOT add one — those two
 * tiers exist in the chain as data only, and `listAuthedProviders()` will
 * never contain their provider ids, so `resolveAuthedFallbackChain` always
 * filters them out. Wiring real credentials for them is follow-up work.
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
  // ponytail: inert until an OpenRouter-free credential loader exists — never matches an authed provider.
  { id: 'openrouter-free', label: 'OpenRouter free', providerID: 'openrouter-free' },
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
