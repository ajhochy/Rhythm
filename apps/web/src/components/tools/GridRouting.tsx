import { useCallback, useEffect, useState } from 'react';
import { useGateway } from '../../gateway/context';
import type { GridCandidate, GridCategory, GridFallback, GridTier, RouterCatalogModel, RouterConfig, RouterConfigInput, RouterFeatureMode, RouterGridDecision, RouterGridInput, RouterGridView } from '../../gateway/sessions';
import {
  GRID_TIERS, TIER_HINTS, appliedEffort, candidateModels, categoryPatch, fallbackModels, gridEngineState, moveCandidate, priceLabel, reasonText, tierLabel,
} from './gridPolicy';

// Grid routing editor. Reads/writes GET/PUT /agent-decisions/grid (router-grid.json, the file the Grid
// engine loads every routed turn) and the engine switch in /agent-decisions/config.

type Save = (input: RouterGridInput) => Promise<void>;
const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
const title = (v: string) => v[0].toUpperCase() + v.slice(1);

export function GridEnginePanel({ config, grid, onConfig, save }: { config: RouterConfig; grid: RouterGridView; onConfig(c: RouterConfig): void; save: Save }) {
  const sessions = useGateway().domains.sessions;
  const state = gridEngineState(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [classifierModel, setClassifierModel] = useState(grid.classifier.model);
  useEffect(() => setClassifierModel(grid.classifier.model), [grid.classifier.model]);
  const write = async (input: RouterConfigInput) => {
    if (!sessions?.saveRouterConfig) return;
    setBusy(true); setError('');
    try { onConfig(await sessions.saveRouterConfig(input)); } catch (err) { setError(errorText(err, 'Engine setting could not be saved')); } finally { setBusy(false); }
  };
  const writeGrid = async (input: RouterGridInput) => { setBusy(true); setError(''); try { await save(input); } catch (err) { setError(errorText(err, 'Classifier setting could not be saved')); } finally { setBusy(false); } };
  const locked = config.lockedByEnv.includes('features.model_routing');
  return <div className="router-settings" data-testid="grid-engine-panel" aria-busy={busy}>
    <p className="router-settings-note" data-testid="grid-engine-summary"><strong>{state.summary}</strong></p>
    <fieldset className="router-settings-backends">
      <legend>Routing engine</legend>
      {(['grid', 'legacy'] as const).map((engine) => <label key={engine} className="router-settings-radio">
        <input type="radio" name="grid-engine" checked={state.engine === engine} disabled={busy} onChange={() => void write({ routing: { engine } })} data-testid={`grid-engine-${engine}`} />
        <span>{engine === 'grid' ? 'Grid' : 'Legacy'}<small>{engine === 'grid' ? 'Category × difficulty → ordered model/effort candidates, per-account quota.' : 'One price-band tier (cheap/standard/frontier) from the live catalog.'}</small></span>
      </label>)}
    </fieldset>
    <label>Model routing mode (saved setting the engine reads)
      <select value={state.mode} disabled={busy} onChange={(e) => void write({ features: { model_routing: e.target.value as RouterFeatureMode } })} data-testid="grid-engine-mode">
        {(['default', 'off', 'shadow', 'on'] as const).map((m) => <option key={m} value={m}>{m === 'shadow' ? 'Shadow (log only)' : title(m)}</option>)}
      </select>
    </label>
    {state.engine === 'grid' && !state.running && <p role="status" className="router-catalog-error" data-testid="grid-engine-not-running">Grid only runs when this mode is On or Shadow. Auto sessions keep their current model.</p>}
    {locked && <p className="router-settings-note">An AGENT_DECISION_MODEL_ROUTING env var also affects the legacy router; Grid reads the saved mode above.</p>}
    <h4>Difficulty classifier</h4>
    <p className="router-settings-note" data-testid="grid-classifier-status">
      OpenAI Decisions · key {config.openaiDecisions?.hasApiKey ? 'saved' : 'missing'} · remote-data consent {config.remoteDataConsent ? 'given' : 'not given'}.
      {(!config.openaiDecisions?.hasApiKey || !config.remoteDataConsent) && ' Until both are set, every turn uses the rules fallback.'}
    </p>
    <div className="router-settings-fields">
      <label>Classifier model
        <input value={classifierModel} disabled={busy} onChange={(e) => setClassifierModel(e.target.value)} onBlur={() => classifierModel.trim() && classifierModel !== grid.classifier.model && void writeGrid({ classifier: { model: classifierModel.trim() } })} data-testid="grid-classifier-model" />
      </label>
      <label>Rules fallback difficulty
        <select value={grid.classifier.rules_default_tier} disabled={busy} onChange={(e) => void writeGrid({ classifier: { rules_default_tier: Number(e.target.value) as GridTier } })} data-testid="grid-classifier-fallback-tier">
          {GRID_TIERS.map((t) => <option key={t} value={t}>{tierLabel(t)}</option>)}
        </select>
      </label>
    </div>
    <small className="router-settings-note">Fallback = keyword rules for category and security, this difficulty for every turn. Score cut-offs {grid.classifier.tier_thresholds.join(' / ')} are file-only.</small>
    {error && <p role="alert" data-testid="grid-engine-error">{error}</p>}
  </div>;
}

export function GridLastDecisionPanel() {
  const sessions = useGateway().domains.sessions;
  const [decision, setDecision] = useState<RouterGridDecision | null | undefined>(undefined);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!sessions?.lastGridDecision) return;
    try { setDecision(await sessions.lastGridDecision()); setError(''); } catch (err) { setError(errorText(err, 'Last decision unavailable')); }
  }, [sessions]);
  useEffect(() => { void load(); }, [load]);
  const refresh = <button className="secondary-button" type="button" onClick={() => void load()} data-testid="grid-last-refresh">Refresh</button>;
  if (error) return <p role="alert">{error} {refresh}</p>;
  if (decision === undefined) return <p className="router-settings-note" role="status">Loading…</p>;
  if (!decision) return <p className="router-settings-note" data-testid="grid-last-empty">No Grid routing decision recorded yet. {refresh}</p>;
  const d = decision;
  const servedId = d.served?.servedModelId;
  const servedDiffers = servedId && d.model && !d.model.endsWith(`/${servedId}`);
  return <div className="router-settings" data-testid="grid-last-decision">
    <p className="router-settings-note">{new Date(d.at).toLocaleString()} · {d.mode} · {d.applied ? 'applied' : 'not applied'} {refresh}</p>
    <dl className="router-catalog-facts">
      <div><dt>Category / difficulty</dt><dd>{d.category ?? '—'} · {d.tier ? tierLabel(d.tier as GridTier) : '—'}{d.tierUsed && d.tierUsed !== d.tier ? ` (stepped to tier ${d.tierUsed})` : ''}</dd></div>
      <div><dt>Classifier</dt><dd>{d.classifierSource === 'rules' ? 'Rules fallback' : d.classifierSource === 'decisions' ? 'OpenAI Decisions' : '—'} · {reasonText(d.classifierReason)}</dd></div>
      <div><dt>Requested</dt><dd data-testid="grid-last-requested">{d.model ?? 'none'}{d.effortRequested ? ` · effort ${d.effortRequested}` : ''}</dd></div>
      <div><dt>Applied effort</dt><dd>{d.effortApplied ?? (d.effortRequested ? 'engine default (no matching variant)' : '—')}</dd></div>
      <div><dt>Served</dt><dd data-testid="grid-last-served">{servedId ?? 'no served step recorded yet'}{servedDiffers ? ' (differs from requested)' : ''}</dd></div>
      <div><dt>Account</dt><dd>{d.accountId ?? '—'}{d.accountSource ? ` · ${d.accountSource === 'pinned' ? 'explicit pin' : 'automatic'}` : ''}</dd></div>
      <div><dt>Reason</dt><dd data-testid="grid-last-reason">{d.kind === 'router_state_unavailable' ? `Routing state unavailable (${d.errorName ?? 'error'}): request not sent` : reasonText(d.reason)}{d.degraded ? ' · degraded fallback' : ''}</dd></div>
    </dl>
    {d.trace.length > 0 && <details><summary>Walk ({d.trace.length} steps)</summary><ol className="router-settings-ranked">
      {d.trace.map((t, i) => <li key={i}>tier {t.tier} · {t.action}{t.model ? ` · ${t.model}` : ''}{t.accountId ? ` · ${t.accountId}` : ''}{t.reason ? ` · ${reasonText(t.reason)}` : ''}</li>)}
    </ol></details>}
  </div>;
}

export function GridCategoryPanel({ category, grid, catalog, save }: { category: GridCategory; grid: RouterGridView; catalog: RouterCatalogModel[]; save: Save }) {
  const alias = grid.aliases[category];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (input: RouterGridInput) => { setBusy(true); setError(''); try { await save(input); } catch (err) { setError(errorText(err, 'Routing policy could not be saved')); } finally { setBusy(false); } };
  const live = new Map(catalog.map((m) => [`${m.providerID}/${m.modelID}`, m]));
  const saveTier = (tier: GridTier, candidates: GridCandidate[]) => void run({ routing: { [category]: categoryPatch(grid, category, tier, candidates) } });
  const saveFallback = (tier: GridTier, fb: GridFallback) => void run({ openrouter_fallback: { [category]: { ...grid.openrouter_fallback[category], [tier]: fb } } });
  const models = candidateModels(grid);
  const fallbacks = fallbackModels(grid);
  return <div className="router-settings" data-testid={`grid-category-${category}`} aria-busy={busy}>
    <p className="router-settings-note">The router walks each difficulty's candidates top to bottom and takes the first one whose model is live and has a usable account. If a model is skipped by a rule (security, long prompt, unavailable) it steps up one difficulty; if every account is out, it uses the OpenRouter fallback.</p>
    {category !== 'coding' && <label className="router-settings-consent">
      <input type="checkbox" checked={alias === 'coding'} disabled={busy} data-testid={`grid-alias-${category}`}
        onChange={(e) => void run({ routing: { [category]: e.target.checked ? 'SAME_AS:coding' : grid.routing[category] } })} />
      <span>Same candidates as Coding<small>{alias ? `Follows ${alias}; untick to edit ${category} separately.` : 'Tick to follow Coding edits.'}</small></span>
    </label>}
    {error && <p role="alert" data-testid="grid-category-error">{error}</p>}
    {GRID_TIERS.map((tier) => {
      const list = grid.routing[category][tier];
      const fb = grid.openrouter_fallback[category][tier];
      return <section key={tier} className="router-settings-features" data-testid={`grid-tier-${category}-${tier}`}>
        <h3>{tierLabel(tier)}</h3>
        <small className="router-settings-note">{TIER_HINTS[tier]}</small>
        <ol className="grid-candidates">
          {list.map((c, i) => {
            const m = live.get(c.model);
            const applied = m?.variants?.length ? appliedEffort(c.effort, m.variants) : null;
            const replace = (patch: Partial<GridCandidate>) => saveTier(tier, list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return <li key={`${c.model}-${i}`} className="grid-candidate" data-testid={`grid-candidate-${category}-${tier}-${i}`}>
              <select aria-label={`Model ${i + 1}`} value={c.model} disabled={busy || !!alias} onChange={(e) => replace({ model: e.target.value })}>{models.map((id) => <option key={id} value={id}>{id}</option>)}</select>
              <select aria-label={`Effort ${i + 1}`} value={c.effort} disabled={busy || !!alias} onChange={(e) => replace({ effort: e.target.value })}>{grid.efforts.map((e) => <option key={e} value={e}>{e}</option>)}</select>
              <button type="button" className="secondary-button" aria-label="Move up" disabled={busy || !!alias || i === 0} onClick={() => saveTier(tier, moveCandidate(list, i, -1))}>↑</button>
              <button type="button" className="secondary-button" aria-label="Move down" disabled={busy || !!alias || i === list.length - 1} onClick={() => saveTier(tier, moveCandidate(list, i, 1))}>↓</button>
              <button type="button" className="secondary-button" aria-label="Remove" disabled={busy || !!alias} onClick={() => saveTier(tier, list.filter((_, j) => j !== i))}>Remove</button>
              <small className="router-settings-note">
                {!m ? 'Not in the live catalog: skipped as unavailable' : applied && applied !== c.effort ? `Engine has no "${c.effort}" variant: runs at ${applied}` : m.variants?.length ? `Variants: ${m.variants.join(', ')}` : 'No effort variants reported'}
                {' · '}{c.cost_per_task ? `est. $${c.cost_per_task}/task` : 'no cost estimate'} · list {priceLabel(grid.models[c.model]?.price_out)} out
              </small>
            </li>;
          })}
        </ol>
        {!alias && <button type="button" className="secondary-button" disabled={busy || !models.length} data-testid={`grid-add-${category}-${tier}`}
          onClick={() => saveTier(tier, [...list, { model: models[0], effort: 'medium', cost_per_task: 0 }])}>Add candidate</button>}
        <div className="router-settings-field" data-testid={`grid-fallback-${category}-${tier}`}>
          <h4>When no Anthropic/OpenAI account can take it</h4>
          {'action' in fb
            ? <label>Degrade to (no queue yet)
              <select value={fb.degraded_model} disabled={busy} onChange={(e) => saveFallback(tier, { action: 'queue_or_degrade', degraded_model: e.target.value })}>{fallbacks.map((id) => <option key={id} value={id}>{id}</option>)}</select>
            </label>
            : <>
              <small className="router-settings-note">OpenRouter, in order: {fb.models.join(' → ')}</small>
              <div className="router-settings-actions">
                {fb.models.map((id) => <button key={id} type="button" className="secondary-button" disabled={busy || fb.models.length === 1} onClick={() => saveFallback(tier, { models: fb.models.filter((x) => x !== id) })}>Remove {id.slice('openrouter/'.length)}</button>)}
                <select aria-label="Add fallback" value="" disabled={busy} onChange={(e) => e.target.value && saveFallback(tier, { models: [...fb.models, e.target.value] })}>
                  <option value="">Add fallback…</option>{fallbacks.filter((id) => !fb.models.includes(id)).map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>
            </>}
          <small className="router-settings-note">Skipped when OpenRouter is not connected, out of credits, or the request is security-sensitive. Nothing usable → the request is not routed (no_usable_route).</small>
        </div>
      </section>;
    })}
  </div>;
}

export function GridAccountsPanel({ grid, save }: { grid: RouterGridView; save: Save }) {
  const [reserve, setReserve] = useState(String(grid.reserve_pct));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setReserve(String(grid.reserve_pct)), [grid.reserve_pct]);
  const run = async (input: RouterGridInput) => { setBusy(true); setError(''); try { await save(input); } catch (err) { setError(errorText(err, 'Account policy could not be saved')); } finally { setBusy(false); } };
  const exhaustedUntil = (provider: string, id: string) => grid.exhaustion.find((e) => e.provider === provider && e.accountId === id)?.exhaustedUntil;
  return <div className="router-settings" data-testid="grid-accounts-panel" aria-busy={busy}>
    <p className="router-settings-note"><strong>Automatic:</strong> for each candidate the router picks the provider account with the most remaining quota (soonest reset breaks ties), skipping exhausted accounts and, below the hardest difficulty, accounts at or under the reserve.</p>
    <p className="router-settings-note"><strong>Explicit pin:</strong> choosing an account in a conversation's settings pins it; Grid then only considers that account for that provider and never moves the conversation off it.</p>
    <label>Reserve (% quota kept for the hardest difficulty)
      <input type="number" min="0" max="100" step="1" value={reserve} disabled={busy} onChange={(e) => setReserve(e.target.value)}
        onBlur={() => { const n = Number(reserve); if (reserve.trim() !== '' && Number.isFinite(n) && n !== grid.reserve_pct) void run({ reserve_pct: n }); }} data-testid="grid-reserve" />
    </label>
    <label className="router-settings-consent">
      <input type="checkbox" checked={grid.coding_t1_prefer_astra} disabled={busy} onChange={(e) => void run({ coding_t1_prefer_astra: e.target.checked })} data-testid="grid-prefer-astra" />
      <span>Coding, hardest difficulty: try openai/gpt-6-astra first</span>
    </label>
    {error && <p role="alert">{error}</p>}
    <h4>Accounts Grid can use</h4>
    {grid.accounts.length === 0 ? <p className="router-settings-note">No Anthropic/OpenAI accounts connected.</p> : <ul className="router-settings-ranked" data-testid="grid-accounts">
      {grid.accounts.map((a) => { const until = exhaustedUntil(a.provider, a.id); return <li key={`${a.provider}/${a.id}`}>
        {a.provider} · {a.label ?? a.id} · {a.status !== 'ok' ? `not usable (${a.status ?? 'unknown'})` : until ? `exhausted until ${new Date(until).toLocaleString()}` : 'available'}
      </li>; })}
    </ul>}
  </div>;
}
