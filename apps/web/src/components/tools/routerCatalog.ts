import type { RouterCatalog, RouterCatalogModel, RouterConfigInput, RouterTier, RouterTierMode, RouterTierSource, RouterTierThresholds } from '../../gateway/sessions';

// Pure draft logic for "Models the router chooses among"
// (docs/ai/plans/2026-09-29-local-decision-engine.md, "Addendum: Route among the LIVE model catalog").
// Displayed tiers are a cosmetic preview; the server is authoritative after save.

export const TIERS: RouterTier[] = ['cheap', 'standard', 'frontier'];
export type CatalogDraft = {
  mode: RouterTierMode;
  cheapMax: string;
  frontierMin: string;
  /** Touched models only: a chosen tier, or 'derived' to drop an override. */
  tiers: Record<string, RouterTier | 'derived'>;
  excluded: string[];
};
export type ThresholdResult = { ok: true; value: RouterTierThresholds } | { ok: false; message: string };

export const modelKey = (model: Pick<RouterCatalogModel, 'providerID' | 'modelID'>) => `${model.providerID}/${model.modelID}`;

export const toCatalogDraft = (catalog: RouterCatalog | null | undefined): CatalogDraft | null => catalog ? {
  mode: catalog.tiers?.mode === 'manual' ? 'manual' : 'auto',
  cheapMax: String(catalog.tiers?.cheapMaxOutputUsd ?? ''),
  frontierMin: String(catalog.tiers?.frontierMinOutputUsd ?? ''),
  tiers: {},
  excluded: (catalog.models ?? []).filter((model) => model.excluded).map(modelKey),
} : null;

export function parseThresholds(draft: Pick<CatalogDraft, 'cheapMax' | 'frontierMin'>): ThresholdResult {
  const cheap = draft.cheapMax.trim() === '' ? NaN : Number(draft.cheapMax);
  const frontier = draft.frontierMin.trim() === '' ? NaN : Number(draft.frontierMin);
  if (!Number.isFinite(cheap) || !Number.isFinite(frontier)) return { ok: false, message: 'Enter a price for both thresholds.' };
  if (cheap <= 0 || frontier <= 0) return { ok: false, message: 'Thresholds must be greater than 0.' };
  if (cheap >= frontier) return { ok: false, message: 'Cheap threshold must be lower than the frontier threshold.' };
  return { ok: true, value: { cheapMaxOutputUsd: cheap, frontierMinOutputUsd: frontier } };
}

export const tierForCost = (outputUsd: number, thresholds: RouterTierThresholds): RouterTier =>
  outputUsd <= thresholds.cheapMaxOutputUsd ? 'cheap' : outputUsd >= thresholds.frontierMinOutputUsd ? 'frontier' : 'standard';

export function effectiveTier(model: RouterCatalogModel, draft: CatalogDraft, serverTiers: RouterTierThresholds): { tier: RouterTier; source: RouterTierSource } {
  const parsed = parseThresholds(draft);
  // Local re-tiering preview exists only in manual mode; in auto the server's tiers stand.
  const preview = draft.mode === 'manual';
  const thresholds = parsed.ok ? parsed.value : serverTiers;
  const choice = draft.tiers[modelKey(model)];
  const hasCost = typeof model.costOutputUsd === 'number';
  if (choice && choice !== 'derived') return { tier: choice, source: 'override' };
  if (choice === 'derived') return hasCost ? { tier: tierForCost(model.costOutputUsd as number, thresholds), source: 'cost' } : { tier: model.tier, source: 'heuristic' };
  if (preview && model.tierSource === 'cost' && hasCost) return { tier: tierForCost(model.costOutputUsd as number, thresholds), source: 'cost' };
  return { tier: model.tier, source: model.tierSource };
}

/** Catalog part of the PUT body. Overrides = models the user changed plus those already overridden (minus resets). */
export function buildCatalogInput(catalog: RouterCatalog, draft: CatalogDraft): Pick<RouterConfigInput, 'tiers' | 'tierOverrides' | 'excludedModels'> {
  const out: Pick<RouterConfigInput, 'tiers' | 'tierOverrides' | 'excludedModels'> = {};
  if (draft.mode === 'auto') out.tiers = { mode: 'auto' };
  else { const parsed = parseThresholds(draft); if (parsed.ok) out.tiers = { mode: 'manual', ...parsed.value }; }
  // Nothing to edit (engine down): leave saved overrides/exclusions untouched instead of wiping them.
  if (catalog.models.length === 0) return out;
  const overrides: Record<string, RouterTier> = {};
  for (const model of catalog.models) {
    const key = modelKey(model);
    const choice = draft.tiers[key];
    if (choice === 'derived') continue;
    if (choice) overrides[key] = choice;
    else if (model.tierSource === 'override') overrides[key] = model.tier;
  }
  out.tierOverrides = overrides;
  out.excludedModels = catalog.models.map(modelKey).filter((key) => draft.excluded.includes(key));
  return out;
}

export const formatUsd = (value: number | null | undefined) => typeof value === 'number' ? `$${Number(value.toFixed(4))}` : '—';
export const formatContext = (value: number | null | undefined) => typeof value === 'number' && value > 0 ? (value >= 1_000_000 ? `${Number((value / 1_000_000).toFixed(2))}M` : `${Math.round(value / 1000)}K`) : '—';
