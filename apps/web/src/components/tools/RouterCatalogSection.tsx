import type { RouterCatalog, RouterTier } from '../../gateway/sessions';
import { TIERS, effectiveTier, isEnabled, formatContext, formatUsd, modelKey, parseThresholds, type CatalogDraft } from './routerCatalog';

export const CATALOG_UNAVAILABLE = 'Catalog unavailable — the engine is not running; the router will use the static fallback table';
export const NO_CURATED_MODELS = 'No models are enabled in Models curation — the router will keep each chat\'s current model until you enable some.';
export const NOT_ENABLED_LABEL = 'Not enabled in Models curation';
const jumpToCuration = () => document.querySelector('[data-testid="model-curation-panel"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const SOURCE_HINT = { cost: 'cost', heuristic: 'heuristic', override: 'override' } as const;

export function RouterCatalogSection({ catalog, draft, onChange }: { catalog: RouterCatalog | null | undefined; draft: CatalogDraft | null; onChange: (draft: CatalogDraft) => void }) {
  const models = catalog?.models ?? [];
  const auto = draft?.mode !== 'manual';
  const thresholds = draft && !auto ? parseThresholds(draft) : null;
  const patch = (next: Partial<CatalogDraft>) => draft && onChange({ ...draft, ...next });
  return <section className="router-catalog" data-testid="router-catalog" aria-labelledby="router-catalog-title">
    <h4 id="router-catalog-title">Models the router chooses among</h4>
    {((catalog && models.length > 0) || catalog?.reason) && <p className="router-catalog-count" data-testid="router-catalog-count">Routing among {catalog?.curatedCount ?? models.filter(isEnabled).length} enabled models</p>}
    {catalog?.reason === 'no_curated_models' && <div className="router-catalog-callout" role="status" data-testid="router-catalog-no-curated">
      <span>{NO_CURATED_MODELS}</span>
      <button className="text-button" type="button" onClick={jumpToCuration} data-testid="router-catalog-open-curation">Go to Models curation</button>
    </div>}
    {catalog && draft && catalog.tiers && <div className="router-catalog-thresholds" role="group" aria-label="Tier thresholds">
      <fieldset className="router-catalog-mode">
        <legend>Tier thresholds</legend>
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
      <small className="router-settings-note" data-testid="router-catalog-mode-hint">{auto ? `Derived from ${catalog.tiers.derivedFromModels ?? 0} catalog prices` : 'Manual cutoffs: changing them previews models tiered by cost; the server decides after you save.'}</small>
    </div>}
    {(!catalog || models.length === 0 || !draft) ? <p className="router-settings-note" data-testid="router-catalog-empty">{CATALOG_UNAVAILABLE}</p> : <>
      {catalog.fetchedAt && <small className="router-settings-note">Catalog fetched {new Date(catalog.fetchedAt).toLocaleString()}</small>}
      {TIERS.map((tier) => {
        const rows = models.map((model) => ({ model, eff: effectiveTier(model, draft, catalog.tiers) })).filter((row) => row.eff.tier === tier);
        if (rows.length === 0) return null;
        return <div key={tier} className="router-catalog-group" data-testid={`router-catalog-group-${tier}`} role="group" aria-labelledby={`router-catalog-group-${tier}-title`}>
          <h5 id={`router-catalog-group-${tier}-title`}>{tier[0].toUpperCase() + tier.slice(1)} <span>({rows.length})</span></h5>
          <ul>
            {rows.map(({ model, eff }) => {
              const key = modelKey(model);
              const enabled = isEnabled(model);
              const excluded = enabled && draft.excluded.includes(key);
              const overridden = eff.source === 'override';
              return <li key={key} className={!enabled ? 'router-catalog-row disabled' : excluded ? 'router-catalog-row excluded' : 'router-catalog-row'} data-testid={`router-model-row-${key}`}>
                <div className="router-catalog-name"><strong>{model.name}</strong><small>{model.providerID} · {model.modelID}</small>{!enabled && <span className="router-catalog-badge" data-testid={`router-model-not-enabled-${key}`}>{NOT_ENABLED_LABEL}</span>}</div>
                <div className="router-catalog-tier">
                  <label><span className="router-catalog-sr">Tier for {model.name}</span>
                    <select value={eff.tier} disabled={!enabled} onChange={(event) => patch({ tiers: { ...draft.tiers, [key]: event.target.value as RouterTier } })} data-testid={`router-model-tier-${key}`}>
                      {TIERS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <small data-testid={`router-model-source-${key}`}>{SOURCE_HINT[eff.source]}</small>
                  {enabled && overridden && <button className="secondary-button" type="button" aria-label={`Reset ${model.name} to derived tier`} onClick={() => patch({ tiers: { ...draft.tiers, [key]: 'derived' } })} data-testid={`router-model-reset-${key}`}>Reset to derived</button>}
                </div>
                <dl className="router-catalog-facts">
                  <div><dt>Out</dt><dd>{formatUsd(model.costOutputUsd)}/M</dd></div>
                  <div><dt>In</dt><dd>{formatUsd(model.costInputUsd)}/M</dd></div>
                  <div><dt>Released</dt><dd>{model.releaseDate || '—'}</dd></div>
                  <div><dt>Context</dt><dd>{formatContext(model.contextLimit)}</dd></div>
                </dl>
                <label className="router-catalog-exclude"><input type="checkbox" role="switch" disabled={!enabled} checked={excluded} onChange={(event) => patch({ excluded: event.target.checked ? [...draft.excluded, key] : draft.excluded.filter((entry) => entry !== key) })} data-testid={`router-model-exclude-${key}`} aria-label={`Exclude ${model.name}`} /><span>Exclude</span></label>
              </li>;
            })}
          </ul>
        </div>;
      })}
    </>}
  </section>;
}
