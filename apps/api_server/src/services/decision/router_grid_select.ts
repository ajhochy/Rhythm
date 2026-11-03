import { accountHeadroom } from './capacity_router';
import type { UsageBudgetSnapshot } from '../usage_budget_service';
import type { GridClassification } from './router_grid_classifier';
import type { ClosedProvider, GridTier, RouterGridConfig } from './router_grid_config';
import type { GridExhaustion } from './router_grid_exhaustion';

export interface GridAccount {
  id: string; provider: ClosedProvider; quotaRemainingPct: number | null;
  resetsAt: number | null; exhaustedUntil: number | null;
}
export interface GridTrace {
  action: 'skip_rule' | 'skip_account' | 'pick_account' | 'route' | 'step_up' | 'fallback' | 'reorder' | 'none';
  tier: GridTier; model?: string; accountId?: string; reason?: string; canQueue?: boolean;
}
export type GridRouteResult =
  | { kind: 'route'; model: string; effort: string | null; provider: ClosedProvider | 'openrouter'; accountId: string | null; degraded: boolean; tierUsed: GridTier; trace: GridTrace[] }
  | { kind: 'none'; reason: string; trace: GridTrace[] };
export interface GridRouteInput {
  classification: GridClassification; config: RouterGridConfig; accounts: readonly GridAccount[];
  /** Full provider/model IDs from the live catalog; caller must not use static guesses. */
  availableModels: ReadonlySet<string>; openrouterUsable: boolean; now: number;
  /** Caller supplies weekday peak status; pricing hours/timezone are not guessed here. */
  weekdayPeak: boolean;
}

export function accountsFromSnapshot(snapshot: UsageBudgetSnapshot, exhaustion: readonly GridExhaustion[] = []): GridAccount[] {
  return accountHeadroom(snapshot).flatMap(h => {
    if ((h.provider !== 'anthropic' && h.provider !== 'openai') || !h.accountId) return [];
    return [{ id: h.accountId, provider: h.provider, quotaRemainingPct: h.headroom === null ? null : Math.min(100, Math.max(0, h.headroom * 100)),
      resetsAt: h.soonestResetAt ? Date.parse(h.soonestResetAt) : null,
      exhaustedUntil: exhaustion.find(e => e.provider === h.provider && e.accountId === h.accountId)?.exhaustedUntil ?? null }];
  });
}

export function pickGridAccount(provider: ClosedProvider, tier: GridTier, accounts: readonly GridAccount[], reservePct: number, now: number, trace: GridTrace[] = []): GridAccount | null {
  const eligible = accounts.filter(a => {
    if (a.provider !== provider) return false;
    const reason = a.exhaustedUntil !== null && a.exhaustedUntil > now ? 'exhausted'
      : a.quotaRemainingPct !== null && Number.isFinite(a.quotaRemainingPct) && a.quotaRemainingPct <= 0 ? 'exhausted'
      : tier !== 1 && a.quotaRemainingPct !== null && a.quotaRemainingPct <= reservePct ? 'reserve' : null;
    if (reason) trace.push({ action: 'skip_account', tier, accountId: a.id, reason });
    return !reason;
  }).sort((a, b) => (b.quotaRemainingPct ?? -1) - (a.quotaRemainingPct ?? -1) || (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity));
  const account = eligible[0] ?? null;
  if (account) trace.push({ action: 'pick_account', tier, accountId: account.id });
  return account;
}

/** Pure ordered grid walk; never queues, mutates inputs, probes usage, or logs prompt bodies. */
export function selectRoute(input: GridRouteInput): GridRouteResult {
  const { classification: c, config, accounts, availableModels, now } = input;
  const trace: GridTrace[] = [];
  let tier = c.tier;
  for (;;) {
    let ruleSkipped = false;
    const candidates = [...config.routing[c.category][tier]];
    if (c.category === 'coding' && tier === 1 && config.coding_t1_prefer_astra) candidates.sort((a, b) => Number(b.model === 'openai/gpt-6-astra') - Number(a.model === 'openai/gpt-6-astra'));
    for (const cand of candidates) {
      const provider = cand.model.split('/')[0] as ClosedProvider;
      const threshold = config.models[cand.model].long_prompt_threshold;
      const reason = !availableModels.has(cand.model) ? 'model_unavailable'
        : c.securitySensitive && provider === 'anthropic' ? 'security_sensitive'
        : provider === 'openai' && c.estInputTokens > 272000 ? 'openai_long_prompt'
        : threshold !== undefined && c.estInputTokens > threshold ? 'long_prompt' : null;
      if (reason) { trace.push({ action: 'skip_rule', tier, model: cand.model, reason }); ruleSkipped = true; continue; }
      const account = pickGridAccount(provider, tier, accounts, config.reserve_pct, now, trace);
      if (!account) { trace.push({ action: 'skip_account', tier, model: cand.model, reason: 'no_eligible_account' }); continue; }
      trace.push({ action: 'route', tier, model: cand.model, accountId: account.id });
      return { kind: 'route', model: cand.model, effort: cand.effort, provider, accountId: account.id, degraded: false, tierUsed: tier, trace };
    }
    // Resolved rules_only: normal account/rule walk at stepped tier, including tier-1 reserve exemption.
    if (!ruleSkipped || tier === 1) break;
    tier = (tier - 1) as GridTier;
    trace.push({ action: 'step_up', tier });
  }
  const fb = config.openrouter_fallback[c.category][c.tier];
  const degraded = 'action' in fb;
  const models = degraded ? [fb.degraded_model] : [...fb.models];
  if (input.weekdayPeak) {
    for (const model of models) if (config.models[model].peak === 'weekday') trace.push({ action: 'reorder', tier: c.tier, model, reason: 'weekday_peak' });
    models.sort((a, b) => Number(config.models[a].peak === 'weekday') - Number(config.models[b].peak === 'weekday'));
  }
  for (const model of models) {
    if (!input.openrouterUsable || !availableModels.has(model)) {
      trace.push({ action: 'skip_rule', tier: c.tier, model, reason: !input.openrouterUsable ? 'openrouter_unusable' : 'model_unavailable' }); continue;
    }
    trace.push({ action: 'fallback', tier: c.tier, model, canQueue: c.canQueue, reason: degraded ? 'degraded_no_queue_v1' : 'closed_accounts_unavailable' });
    return { kind: 'route', model, effort: null, provider: 'openrouter', accountId: null, degraded, tierUsed: c.tier, trace };
  }
  trace.push({ action: 'none', tier: c.tier, reason: 'no_usable_route' });
  return { kind: 'none', reason: 'no_usable_route', trace };
}
