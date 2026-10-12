import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useGateway } from '../../gateway/context';
import { createGenerationGuard, type GridCategory, type RouterCatalogModel, type RouterConfig, type RouterGridInput, type RouterGridView, type RouterTier } from '../../gateway/sessions';
import { Icon } from '../../icons';
import type { BrowserColumn, ColumnItem } from '../ColumnBrowser';
import { useSelectedId } from '../ListInspector';
import { GridAccountsPanel, GridCategoryPanel, GridEnginePanel, GridLastDecisionPanel } from './GridRouting';
import { GRID_CATEGORIES, gridEngineState, priceLabel } from './gridPolicy';
import { RouterSettingsPanel } from './RouterSettingsPanel';
import { TIERS, buildCatalogInput, effectiveTier, formatContext, formatUsd, isEnabled, modelKey, parseThresholds, toCatalogDraft, type CatalogDraft } from './routerCatalog';

// Agent settings → Model routing, laid out like the Skills/Profiles editor:
// sections → routing groups → models (searchable, sortable) → model inspector.
// Grid groups edit router-grid.json (GET/PUT /agent-decisions/grid), the policy the Grid engine reads.
// Legacy groups are the price-band router; price is never a capability ranking.
// Model edits save immediately (PUT /agent-decisions/config merges partial bodies);
// "Enabled" writes Models curation (PATCH /agent-models/visibility), the router's gate.

export const CATALOG_UNAVAILABLE = 'Catalog unavailable — the engine is not running; the router will use the static fallback table';
export const NO_CURATED_MODELS = 'No models are enabled in Models curation — the router will keep each chat\'s current model until you enable some.';
export const NOT_ENABLED_LABEL = 'Not enabled in Models curation';

const GROUP_BACKEND = 'backend';
const GROUP_GRID_ENGINE = 'grid:engine';
const GROUP_GRID_LAST = 'grid:last';
const GROUP_GRID_ACCOUNTS = 'grid:accounts';
const GROUP_THRESHOLDS = 'thresholds';
const SORTS = [
  { id: 'name', label: 'Name A→Z' },
  { id: 'price-asc', label: 'Output price ↑' },
  { id: 'price-desc', label: 'Output price ↓' },
  { id: 'newest', label: 'Newest' },
  { id: 'provider', label: 'Provider' },
  { id: 'tier', label: 'Tier' },
] as const;
type SortId = typeof SORTS[number]['id'];
const TIER_RANK: Record<RouterTier, number> = { cheap: 0, standard: 1, frontier: 2 };
const title = (value: string) => value[0].toUpperCase() + value.slice(1);
const routable = (model: RouterCatalogModel) => isEnabled(model) && !model.excluded;

function groupModels(groupId: string, models: RouterCatalogModel[]): RouterCatalogModel[] {
  const [kind, value] = groupId.split(':');
  if (kind === 'all') return models;
  if (kind === 'routable') return models.filter(routable);
  if (kind === 'excluded') return models.filter((m) => isEnabled(m) && m.excluded);
  if (kind === 'disabled') return models.filter((m) => !isEnabled(m));
  if (kind === 'tier') return models.filter((m) => m.tier === value);
  if (kind === 'provider') return models.filter((m) => m.providerID === value);
  return [];
}

function sortModels(models: RouterCatalogModel[], sort: SortId): RouterCatalogModel[] {
  const price = (m: RouterCatalogModel) => typeof m.costOutputUsd === 'number' ? m.costOutputUsd : null;
  const byName = (a: RouterCatalogModel, b: RouterCatalogModel) => a.name.localeCompare(b.name);
  return [...models].sort((a, b) => {
    switch (sort) {
      case 'price-asc':
      case 'price-desc': {
        const pa = price(a); const pb = price(b);
        if (pa === pb) return byName(a, b);
        if (pa === null) return 1; // unknown price last either way
        if (pb === null) return -1;
        return sort === 'price-asc' ? pa - pb : pb - pa;
      }
      case 'newest': return (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || byName(a, b);
      case 'provider': return a.providerID.localeCompare(b.providerID) || byName(a, b);
      case 'tier': return TIER_RANK[a.tier] - TIER_RANK[b.tier] || byName(a, b);
      default: return byName(a, b);
    }
  });
}

export function useModelRouting({ active, onOpenCuration }: { active: boolean; onOpenCuration(): void }) {
  const gateway = useGateway();
  const sessions = gateway.domains.sessions;
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [grid, setGrid] = useState<RouterGridView | null>(null);
  const [gridError, setGridError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [groupId, setGroupId] = useSelectedId('settingsItem');
  const [modelId, setModelId] = useSelectedId('settingsModel');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortId>('name');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const guard = useRef(createGenerationGuard());

  const load = useCallback(async () => {
    if (!sessions?.getRouterConfig) return;
    const token = guard.current.begin();
    try {
      const next = await sessions.getRouterConfig();
      if (guard.current.isCurrent(token)) { setConfig(next); setLoadError(''); }
    } catch (err) {
      if (guard.current.isCurrent(token)) setLoadError(err instanceof Error ? err.message : 'Router settings unavailable');
    }
    if (!sessions.getRouterGrid) return;
    try {
      const next = await sessions.getRouterGrid();
      if (guard.current.isCurrent(token)) { setGrid(next); setGridError(''); }
    } catch (err) {
      if (guard.current.isCurrent(token)) setGridError(err instanceof Error ? err.message : 'Grid policy unavailable');
    }
  }, [sessions]);
  const saveGrid = async (input: RouterGridInput) => {
    if (!sessions?.saveRouterGrid) throw new Error('Grid policy editing needs the local agent service');
    setGrid(await sessions.saveRouterGrid(input));
  };
  useEffect(() => { if (active) void load(); }, [active, load]);

  const catalog = config?.catalog ?? null;
  const models = catalog?.models ?? [];

  /** Save one model's tier choice and/or exclusion; the full override/exclusion sets go in the PUT. */
  const saveModel = async (model: RouterCatalogModel, change: { tier?: RouterTier | 'derived'; excluded?: boolean }) => {
    if (!catalog || !sessions?.saveRouterConfig) return;
    const key = modelKey(model);
    const draft = toCatalogDraft(catalog) as CatalogDraft;
    if (change.tier) draft.tiers[key] = change.tier;
    if (change.excluded !== undefined) draft.excluded = change.excluded ? [...draft.excluded, key] : draft.excluded.filter((entry) => entry !== key);
    const { tierOverrides, excludedModels } = buildCatalogInput(catalog, draft);
    setPending(key); setError('');
    try { setConfig(await sessions.saveRouterConfig({ tierOverrides, excludedModels })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Router settings could not be saved'); }
    finally { setPending(null); }
  };
  const setEnabled = async (model: RouterCatalogModel, visible: boolean) => {
    if (!sessions?.setModelVisibility) return;
    const key = modelKey(model);
    setPending(key); setError('');
    try { await sessions.setModelVisibility([{ provider: model.providerID, modelId: model.modelID, visible }]); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Model visibility could not be saved'); }
    finally { setPending(null); }
  };

  const columns = (): BrowserColumn[] => {
    const panel = (key: string, label: string, children: ReactNode): BrowserColumn => ({ kind: 'panel', key, label, testId: 'settings-column-inspector', bodyTestId: 'list-inspector-detail', children });
    if (!sessions?.getRouterConfig) return [panel('inspector', 'Model routing', <p className="router-settings-note" data-testid="router-settings-unavailable">Router settings are only available when Rhythm is connected to the local agent service.</p>)];
    if (!config) return [panel('inspector', 'Model routing', loadError
      ? <p role="alert" data-testid="router-settings-error">{loadError} <button className="secondary-button" type="button" onClick={() => void load()}>Retry</button></p>
      : <p className="router-settings-note" role="status">Loading router settings…</p>)];

    const count = (list: RouterCatalogModel[]) => String(list.length);
    const providers = [...new Set(models.map((m) => m.providerID))].sort();
    const tiers = catalog?.tiers;
    const engine = gridEngineState(config);
    const gridGroups: ColumnItem[] = [
      { id: GROUP_GRID_ENGINE, title: 'Engine & classifier', subtitle: engine.summary, group: 'Model routing', testId: 'router-group-grid-engine' },
      { id: GROUP_GRID_LAST, title: 'Last decision', subtitle: 'Requested vs served, account, reason', group: 'Model routing', testId: 'router-group-grid-last' },
      ...(grid ? [
        ...GRID_CATEGORIES.map((c) => ({ id: `grid:${c}`, title: title(c), subtitle: grid.aliases[c] ? `Same as ${grid.aliases[c]}` : '4 difficulties · ordered candidates', group: 'Grid policy', testId: `router-group-grid-${c}` })),
        { id: GROUP_GRID_ACCOUNTS, title: 'Accounts & exhaustion', subtitle: `Automatic vs pinned · reserve ${grid.reserve_pct}%`, group: 'Grid policy', testId: 'router-group-grid-accounts' },
      ] : []),
    ];
    const live = (id: string) => models.length ? groupModels(id, models) : [];
    const groups: ColumnItem[] = [
      ...gridGroups,
      ...(models.length ? [
        { id: 'all', title: 'All models', badge: count(models), group: 'Live models (both engines)', testId: 'router-group-all' },
        { id: 'routable', title: 'Routable', subtitle: 'Enabled and not excluded', badge: count(models.filter(routable)), group: 'Live models (both engines)', testId: 'router-group-routable' },
        ...providers.map((provider) => ({ id: `provider:${provider}`, title: provider, badge: count(live(`provider:${provider}`)), group: 'By provider', testId: `router-group-provider-${provider}` })),
        { id: 'excluded', title: 'Excluded', badge: count(live('excluded')), group: 'Needs attention', testId: 'router-group-excluded' },
        { id: 'disabled', title: 'Not enabled', subtitle: 'Off in Models curation', badge: count(live('disabled')), group: 'Needs attention', testId: 'router-group-disabled' },
      ] : []),
      // Legacy engine only: price bands, not capability. Grid ignores these.
      { id: GROUP_THRESHOLDS, group: 'Legacy engine · price bands', title: 'Tier thresholds', subtitle: tiers ? `${tiers.mode === 'manual' ? 'Manual' : 'Auto'} · cheap ≤ ${formatUsd(tiers.cheapMaxOutputUsd)} · frontier ≥ ${formatUsd(tiers.frontierMinOutputUsd)}` : 'Catalog unavailable', testId: 'router-group-thresholds' },
      ...(models.length ? TIERS.map((tier) => ({ id: `tier:${tier}`, title: title(tier), badge: count(live(`tier:${tier}`)), group: 'Legacy engine · price bands', testId: `router-group-tier-${tier}` })) : []),
      { id: GROUP_BACKEND, title: 'Reranker backend', subtitle: `Tools, memory & legacy classifier · ${config.effective ? `${config.effective.backend} · ${config.effective.model}` : config.backend}`, group: 'Tool & memory reranker', testId: 'router-group-backend' },
    ];
    const selectedGroup = groups.some((g) => g.id === groupId) ? groupId! : GROUP_GRID_ENGINE;
    const curatedCount = catalog?.curatedCount ?? models.filter(isEnabled).length;
    const groupColumn: BrowserColumn = {
      kind: 'list', key: 'items', label: 'Model routing', testId: 'settings-column-items', items: groups,
      selectedId: selectedGroup, onSelect: (id) => { setGroupId(id); setModelId(null); },
      header: <div className="router-routing-header">
        {(models.length > 0 || catalog?.reason) && <small data-testid="router-catalog-count">Routing among {curatedCount} enabled models</small>}
        {catalog?.reason === 'no_curated_models' && <div className="router-catalog-callout" role="status" data-testid="router-catalog-no-curated">
          <span>{NO_CURATED_MODELS}</span>
          <button className="text-button" type="button" onClick={onOpenCuration} data-testid="router-catalog-open-curation">Go to Models curation</button>
        </div>}
        {!models.length && <small className="router-settings-note" data-testid="router-catalog-empty">{CATALOG_UNAVAILABLE}</small>}
      </div>,
    };

    if (selectedGroup.startsWith('grid:')) {
      if (selectedGroup === GROUP_GRID_LAST) return [groupColumn, panel('inspector', 'Last decision', <GridLastDecisionPanel />)];
      if (!grid) return [groupColumn, panel('inspector', 'Grid policy', gridError
        ? <p role="alert" data-testid="grid-policy-error">{gridError} <button className="secondary-button" type="button" onClick={() => void load()}>Retry</button></p>
        : <p className="router-settings-note" role="status">Loading Grid policy…</p>)];
      const gridNotice = grid.source === 'defaults_after_invalid_file'
        ? <p role="alert" className="router-catalog-error" data-testid="grid-policy-invalid">router-grid.json is invalid ({grid.invalidReason}); the router is using built-in defaults.</p> : null;
      if (selectedGroup === GROUP_GRID_ENGINE) return [groupColumn, panel('inspector', 'Engine & classifier', <>{gridNotice}<GridEnginePanel config={config} grid={grid} onConfig={setConfig} save={saveGrid} /></>)];
      if (selectedGroup === GROUP_GRID_ACCOUNTS) return [groupColumn, panel('inspector', 'Accounts & exhaustion', <>{gridNotice}<GridAccountsPanel grid={grid} save={saveGrid} /></>)];
      const category = selectedGroup.slice(5) as GridCategory;
      return [groupColumn, panel('inspector', title(category), <>{gridNotice}<GridCategoryPanel category={category} grid={grid} catalog={models} save={saveGrid} /></>)];
    }
    if (selectedGroup === GROUP_BACKEND) return [groupColumn, panel('inspector', 'Reranker backend', <RouterSettingsPanel onSaved={setConfig} />)];
    if (selectedGroup === GROUP_THRESHOLDS) return [groupColumn, panel('inspector', 'Tier thresholds', <RouterThresholds config={config} onSaved={setConfig} />)];

    const query = search.trim().toLowerCase();
    const shown = sortModels(groupModels(selectedGroup, models), sort)
      .filter((m) => !query || `${m.name} ${m.providerID} ${m.modelID} ${m.family ?? ''}`.toLowerCase().includes(query));
    const selectedModel = shown.find((m) => modelKey(m) === modelId) ?? shown[0] ?? null;
    const modelColumn: BrowserColumn = {
      kind: 'list', key: 'models', label: groups.find((g) => g.id === selectedGroup)?.title ?? 'Models', testId: 'settings-column-models', stackedRows: true,
      resizeKey: 'layout.agent-settings.router-models',
      items: shown.map((m) => ({
        id: modelKey(m), title: m.name, subtitle: `${m.providerID} · ${priceLabel(m.costOutputUsd)} out`,
        badge: !isEnabled(m) ? 'Not enabled' : m.excluded ? 'Excluded' : m.tier, muted: !routable(m), testId: `router-model-row-${modelKey(m)}`,
      })),
      selectedId: selectedModel ? modelKey(selectedModel) : null, onSelect: setModelId,
      header: <div className="router-model-tools">
        <label className="column-checklist-filter"><span className="sr-only">Search models</span><Icon name="search" size={13} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, id, provider" data-testid="router-model-search" /></label>
        <label><span className="sr-only">Sort models</span><select value={sort} onChange={(event) => setSort(event.target.value as SortId)} aria-label="Sort models" data-testid="router-model-sort">{SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      </div>,
      emptyState: query ? 'No matching models.' : 'No models in this group.',
    };
    return [groupColumn, modelColumn, panel('inspector', selectedModel?.name ?? 'Model', selectedModel
      ? <ModelInspector model={selectedModel} pending={pending === modelKey(selectedModel)} error={error} canToggleCuration={Boolean(sessions?.setModelVisibility)} onSave={(change) => void saveModel(selectedModel, change)} onEnabled={(visible) => void setEnabled(selectedModel, visible)} />
      : <p className="router-settings-note">Select a model.</p>)];
  };

  return { columns, subtitle: config ? `${gridEngineState(config).summary}${config.catalog ? ` · ${config.catalog.curatedCount ?? config.catalog.models.filter(isEnabled).length} routable` : ''}` : undefined };
}

function ModelInspector({ model, pending, error, canToggleCuration, onSave, onEnabled }: {
  model: RouterCatalogModel; pending: boolean; error: string; canToggleCuration: boolean;
  onSave(change: { tier?: RouterTier | 'derived'; excluded?: boolean }): void; onEnabled(visible: boolean): void;
}) {
  const key = modelKey(model);
  const enabled = isEnabled(model);
  const status = !enabled ? NOT_ENABLED_LABEL : model.excluded ? 'Excluded from routing' : 'Routable';
  return <div className="router-model-inspector" data-testid={`router-model-inspector-${key}`} aria-busy={pending}>
    <p className="router-model-id"><code>{model.providerID}/{model.modelID}</code></p>
    <p className={`router-model-status${enabled && !model.excluded ? ' ok' : ''}`} data-testid={`router-model-status-${key}`}>{status}</p>
    {error && <p role="alert" data-testid="router-model-error">{error}</p>}
    <label className="router-model-switch"><input type="checkbox" role="switch" checked={enabled} disabled={pending || !canToggleCuration} onChange={(event) => onEnabled(event.target.checked)} data-testid={`router-model-enabled-${key}`} aria-label={`Enable ${model.name} in Models curation`} /><span><strong>Enabled in Models curation</strong><small>Shown in model pickers and eligible for routing.</small></span></label>
    <label className="router-model-switch"><input type="checkbox" role="switch" checked={enabled && model.excluded} disabled={pending || !enabled} onChange={(event) => onSave({ excluded: event.target.checked })} data-testid={`router-model-exclude-${key}`} aria-label={`Exclude ${model.name}`} /><span><strong>Exclude from routing</strong><small>Still selectable by hand; the router never picks it.</small></span></label>
    <div className="router-model-tier">
      <label>Legacy price band
        <select value={model.tier} disabled={pending || !enabled} onChange={(event) => onSave({ tier: event.target.value as RouterTier })} data-testid={`router-model-tier-${key}`} aria-label={`Tier for ${model.name}`}>
          {TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
        </select>
      </label>
      <small data-testid={`router-model-source-${key}`}>{model.tierSource}</small>
      {enabled && model.tierSource === 'override' && <button className="secondary-button" type="button" disabled={pending} onClick={() => onSave({ tier: 'derived' })} data-testid={`router-model-reset-${key}`} aria-label={`Reset ${model.name} to derived tier`}>Reset to derived</button>}
    </div>
    <dl className="router-catalog-facts">
      <div><dt>Output</dt><dd>{priceLabel(model.costOutputUsd)}</dd></div>
      <div><dt>Input</dt><dd>{priceLabel(model.costInputUsd)}</dd></div>
      {model.variants?.length ? <div><dt>Effort variants</dt><dd>{model.variants.join(', ')}</dd></div> : null}
      <div><dt>Released</dt><dd>{model.releaseDate || '—'}</dd></div>
      <div><dt>Context</dt><dd>{formatContext(model.contextLimit)}</dd></div>
      {model.family && <div><dt>Family</dt><dd>{model.family}</dd></div>}
    </dl>
  </div>;
}

function RouterThresholds({ config, onSaved }: { config: RouterConfig; onSaved(config: RouterConfig): void }) {
  const sessions = useGateway().domains.sessions;
  const catalog = config.catalog;
  const [draft, setDraft] = useState<CatalogDraft | null>(() => toCatalogDraft(catalog));
  const [state, setState] = useState<'idle' | 'saving'>('idle');
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  useEffect(() => { setDraft(toCatalogDraft(catalog)); }, [catalog]);
  if (!catalog?.tiers || !draft) return <p className="router-settings-note" data-testid="router-catalog-empty">{CATALOG_UNAVAILABLE}</p>;
  const auto = draft.mode !== 'manual';
  const thresholds = auto ? null : parseThresholds(draft);
  const patch = (next: Partial<CatalogDraft>) => { setDraft({ ...draft, ...next }); setNotice(''); };
  const preview = TIERS.map((tier) => [tier, catalog.models.filter((m) => isEnabled(m) && effectiveTier(m, draft, catalog.tiers).tier === tier).length] as const);
  const save = async () => {
    if (!sessions?.saveRouterConfig || thresholds?.ok === false) return;
    setState('saving'); setSaveError('');
    try { onSaved(await sessions.saveRouterConfig({ tiers: buildCatalogInput({ ...catalog, models: [] }, draft).tiers })); setNotice('Tier thresholds saved'); }
    catch (err) { setSaveError(err instanceof Error ? err.message : 'Tier thresholds could not be saved'); }
    finally { setState('idle'); }
  };
  return <div className="router-catalog-thresholds" role="group" aria-label="Tier thresholds">
    <p className="router-settings-note">Models are tiered by output price. Auto derives the cutoffs from the catalog; Manual lets you set them.</p>
    <fieldset className="router-catalog-mode">
      <legend>Mode</legend>
      {(['auto', 'manual'] as const).map((mode) => <label key={mode} className="router-settings-radio">
        <input type="radio" name="router-tier-mode" checked={draft.mode === mode} onChange={() => patch({ mode })} data-testid={`router-catalog-mode-${mode}`} />
        <span>{mode === 'auto' ? 'Auto' : 'Manual'}</span>
      </label>)}
    </fieldset>
    <label>Cheap: up to $/M output
      <input type="number" min="0" step="any" inputMode="decimal" value={draft.cheapMax} readOnly={auto} aria-readonly={auto} aria-invalid={thresholds?.ok === false} aria-describedby="router-catalog-threshold-error" onChange={(event) => patch({ cheapMax: event.target.value })} data-testid="router-catalog-cheap-max" />
    </label>
    <label>Frontier: from $/M output
      <input type="number" min="0" step="any" inputMode="decimal" value={draft.frontierMin} readOnly={auto} aria-readonly={auto} aria-invalid={thresholds?.ok === false} aria-describedby="router-catalog-threshold-error" onChange={(event) => patch({ frontierMin: event.target.value })} data-testid="router-catalog-frontier-min" />
    </label>
    <p id="router-catalog-threshold-error" className="router-catalog-error" role={thresholds?.ok === false ? 'alert' : undefined} data-testid="router-catalog-threshold-error" hidden={thresholds?.ok !== false}>{thresholds?.ok === false ? thresholds.message : ''}</p>
    <small className="router-settings-note" data-testid="router-catalog-mode-hint">{auto ? `Derived from ${catalog.tiers.derivedFromModels ?? 0} catalog prices` : 'Manual cutoffs: the preview re-tiers cost-priced models; the server decides after you save.'}</small>
    <p className="router-settings-note" data-testid="router-catalog-preview">{preview.map(([tier, n]) => `${title(tier)} ${n}`).join(' · ')}</p>
    <div className="router-settings-actions">
      <button className="primary-button" type="button" onClick={() => void save()} disabled={state !== 'idle' || thresholds?.ok === false} data-testid="router-thresholds-save">{state === 'saving' ? 'Saving…' : 'Save'}</button>
    </div>
    <div aria-live="polite">
      {notice && <p role="status" data-testid="router-thresholds-notice">{notice}</p>}
      {saveError && <p role="alert" data-testid="router-thresholds-error">{saveError}</p>}
    </div>
  </div>;
}
