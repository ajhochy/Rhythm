import type { GridCandidate, GridCategory, GridTier, RouterConfig, RouterGridView } from '../../gateway/sessions';

// Pure helpers for the Grid routing policy editor. The server file (router-grid.json) is the only
// ranking; these just build the PUT body for one edited category.

export const GRID_CATEGORIES: GridCategory[] = ['coding', 'design', 'knowledge'];
/** Easiest first, matching how the classifier scores (tier 4 = lowest bar, tier 1 = hardest). */
export const GRID_TIERS: GridTier[] = [4, 3, 2, 1];
// Same wording as the server's classifier question (router_grid_classifier.ts GRID_CLASSIFIER_QUESTIONS).
export const TIER_HINTS: Record<GridTier, string> = {
  4: 'Classify, extract, tag, reformat, short summaries, simple lookups',
  3: 'Single-file edits, routine emails/docs, straightforward Q&A, small UI tweaks',
  2: 'Multi-file features, research write-ups, standard UI pages, moderate analysis',
  1: 'Architecture, hard debugging, long agent work, polished deliverables, high stakes',
};
export const tierLabel = (tier: GridTier) => `Tier ${tier} · ${tier === 4 ? 'easiest' : tier === 1 ? 'hardest' : tier === 3 ? 'easier' : 'harder'}`;

/** Why a turn did not get a candidate: codes from router_grid_select.ts / router_grid_turn.ts. */
export const REASON_TEXT: Record<string, string> = {
  ok: 'Classifier answered',
  model_unavailable: 'Not in the live catalog (not enabled in Models curation, excluded, or provider not connected)',
  security_sensitive: 'Security-sensitive request: Anthropic models are skipped',
  openai_long_prompt: 'Prompt over 272K tokens: OpenAI models are skipped',
  long_prompt: 'Prompt over this model\'s long-prompt threshold',
  exhausted: 'Account quota exhausted or cooling down',
  reserve: 'Account at or below the reserve (tier 1 may still use it)',
  no_eligible_account: 'No usable account for this provider',
  weekday_peak: 'Peak-priced on weekdays: moved last',
  openrouter_unusable: 'OpenRouter not connected, out of credits, security-sensitive, or Free mode budget is 0',
  degraded_no_queue_v1: 'Hardest tier fell back to a degraded model (queuing is not implemented)',
  closed_accounts_unavailable: 'Anthropic/OpenAI accounts unavailable: used the OpenRouter fallback',
  no_usable_route: 'No candidate or fallback was usable: the request was not routed',
  account_exhausted: 'Re-routed because the session\'s account is exhausted',
  free_mode_queued: 'Held by Free mode until paid capacity returns',
  remote_consent_required: 'Classifier needs remote-data consent: rules fallback used',
  no_api_key: 'No OpenAI Decisions key: rules fallback used',
  request_failed: 'Classifier request failed: rules fallback used',
  malformed_response: 'Classifier answer unreadable: rules fallback used',
};
export const reasonText = (code: string | null | undefined) => (code ? REASON_TEXT[code] ?? code : '—');

export type GridEngineState = { engine: 'legacy' | 'grid'; mode: string; running: 'on' | 'shadow' | null; summary: string };
/** Mirrors the server gate (agent_runner / turn_routing): grid runs only when engine=grid AND the saved model_routing is on|shadow. */
export function gridEngineState(config: Pick<RouterConfig, 'features' | 'routing'>): GridEngineState {
  const engine = config.routing?.engine === 'grid' ? 'grid' : 'legacy';
  const mode = config.features?.model_routing ?? 'default';
  const running = engine === 'grid' && (mode === 'on' || mode === 'shadow') ? mode : null;
  const summary = engine === 'legacy' ? 'Legacy price-tier router'
    : running === 'on' ? 'Grid · on' : running === 'shadow' ? 'Grid · shadow (logs only)' : `Grid selected · not running (model routing ${mode})`;
  return { engine, mode, running, summary };
}

export function moveCandidate(list: GridCandidate[], index: number, delta: -1 | 1): GridCandidate[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Full 4-tier object for one category with one tier replaced (the server replaces whole categories). */
export function categoryPatch(grid: Pick<RouterGridView, 'routing'>, category: GridCategory, tier: GridTier, candidates: GridCandidate[]) {
  return { ...grid.routing[category], [tier]: candidates } as Record<GridTier, GridCandidate[]>;
}

/** Models the validator accepts as candidates: priced anthropic/openai entries in the grid's model table. */
export const candidateModels = (grid: Pick<RouterGridView, 'models'>) =>
  Object.keys(grid.models).filter((id) => /^(anthropic|openai)\//.test(id)).sort();
export const fallbackModels = (grid: Pick<RouterGridView, 'models'>) =>
  Object.keys(grid.models).filter((id) => id.startsWith('openrouter/')).sort();

/** A $0 catalog price on an OAuth/subscription route is unmetered metadata, not proof the work is free. */
export function priceLabel(usdPerM: number | null | undefined): string {
  if (typeof usdPerM !== 'number') return 'price unknown';
  if (usdPerM === 0) return '$0 listed (subscription/OAuth; not proven free)';
  return `$${Number(usdPerM.toFixed(4))}/M`;
}

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** Port of router_grid_turn.ts gridEffortVariant: highest engine variant at or below the requested effort. */
export function appliedEffort(requested: string, variants: readonly string[] | undefined): string | null {
  const supported = EFFORT_ORDER.filter((e) => variants?.includes(e));
  return supported.filter((e) => EFFORT_ORDER.indexOf(e) <= EFFORT_ORDER.indexOf(requested)).at(-1) ?? supported[0] ?? null;
}
