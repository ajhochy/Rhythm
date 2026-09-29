import { useCallback, useEffect, useRef, useState } from 'react';
import { useGateway } from '../../gateway/context';
import {
  createGenerationGuard,
  type RouterBackend, type RouterConfig, type RouterConfigInput, type RouterFeatureKey, type RouterFeatureMode, type RouterScoreScale, type RouterTestResult,
} from '../../gateway/sessions';
import { RouterCatalogSection } from './RouterCatalogSection';
import { buildCatalogInput, parseThresholds, toCatalogDraft, type CatalogDraft } from './routerCatalog';

// Router model settings — GET/PUT /agent-decisions/config and POST /agent-decisions/config/test
// (docs/ai/plans/2026-09-29-local-decision-engine.md, "Router backend settings"). API keys are
// write-only: the server only reports `hasApiKey`, so a key is sent only when the user types one
// (or explicitly clears the saved one with '').

type Draft = {
  backend: RouterBackend;
  local: { baseUrl: string; model: string; scoreScale: RouterScoreScale };
  jev: { model: string };
  custom: { baseUrl: string; model: string; scoreScale: RouterScoreScale };
  apiKey: { jev: string; custom: string };
  clearKey: { jev: boolean; custom: boolean };
  timeoutMs: string;
  consent: boolean;
  features: Record<RouterFeatureKey, RouterFeatureMode>;
  catalog: CatalogDraft | null;
};

const BACKENDS: Array<{ id: RouterBackend; label: string; hint: string }> = [
  { id: 'local', label: 'Local (this Mac)', hint: 'A reranker running on this computer.' },
  { id: 'jev', label: 'Jev (TypeSafe API)', hint: 'Hosted by TypeSafe; needs an API key.' },
  { id: 'custom', label: 'Custom (network or other server)', hint: 'Any compatible reranker, for example on another computer.' },
];
const FEATURES: Array<{ key: RouterFeatureKey; label: string; hint: string }> = [
  { key: 'model_routing', label: 'Model routing', hint: 'Picks which model answers each turn in Auto sessions.' },
  { key: 'tool_ranking', label: 'Tool ranking', hint: 'Orders available tools by relevance to the request.' },
  { key: 'memory_ranking', label: 'Memory ranking', hint: 'Chooses which saved memories to include in the prompt.' },
  { key: 'capacity_routing', label: 'Capacity routing', hint: 'Moves turns to another model when one is rate-limited or full.' },
];
const MODES: Array<{ id: RouterFeatureMode; label: string }> = [
  { id: 'default', label: 'Default' }, { id: 'off', label: 'Off' }, { id: 'shadow', label: 'Shadow (log only)' }, { id: 'on', label: 'On' },
];
const SCALES: RouterScoreScale[] = ['auto', 'probability', 'logit'];

const toDraft = (config: RouterConfig): Draft => ({
  backend: config.backend,
  local: { ...config.local },
  jev: { model: config.jev.model },
  custom: { baseUrl: config.custom.baseUrl, model: config.custom.model, scoreScale: config.custom.scoreScale },
  apiKey: { jev: '', custom: '' },
  clearKey: { jev: false, custom: false },
  timeoutMs: String(config.timeoutMs),
  consent: config.remoteDataConsent,
  features: { ...config.features },
  catalog: toCatalogDraft(config.catalog),
});

const isLoopback = (url: string) => {
  try { const host = new URL(url).hostname; return host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host); } catch { return false; }
};

export function RouterSettingsPanel() {
  const gateway = useGateway();
  const sessions = gateway.domains.sessions;
  const supported = Boolean(sessions?.getRouterConfig && sessions.saveRouterConfig && sessions.testRouterConfig);
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState('');
  const [state, setState] = useState<'idle' | 'testing' | 'saving'>('idle');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [test, setTest] = useState<RouterTestResult | null>(null);
  const [testError, setTestError] = useState('');
  const guard = useRef(createGenerationGuard());

  const load = useCallback(async () => {
    if (!sessions?.getRouterConfig) return;
    const token = guard.current.begin();
    try {
      const next = await sessions.getRouterConfig();
      if (!guard.current.isCurrent(token)) return;
      setConfig(next); setDraft(toDraft(next)); setLoadError('');
    } catch (error) {
      if (guard.current.isCurrent(token)) setLoadError(error instanceof Error ? error.message : 'Router settings unavailable');
    }
  }, [sessions]);
  useEffect(() => { void load(); }, [load]);

  if (!supported) {
    return <section className="router-settings" data-testid="router-settings" aria-labelledby="router-settings-title">
      <h3 id="router-settings-title">Router model</h3>
      <p className="router-settings-note" data-testid="router-settings-unavailable">Router settings are only available when Rhythm is connected to the local agent service.</p>
    </section>;
  }
  if (!config || !draft) {
    return <section className="router-settings" data-testid="router-settings" aria-labelledby="router-settings-title" aria-busy={!loadError}>
      <h3 id="router-settings-title">Router model</h3>
      {loadError ? <p role="alert" data-testid="router-settings-error">{loadError} <button className="secondary-button" type="button" onClick={() => void load()}>Retry</button></p> : <p className="router-settings-note" role="status">Loading router settings…</p>}
    </section>;
  }

  const locked = (...names: string[]) => names.some((name) => config.lockedByEnv.some((entry) => entry === name || entry.endsWith(`.${name}`) || entry === name.replace(/\./g, '_')));
  const update = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setNotice(''); setTest(null); setTestError(''); };
  const backend = draft.backend;
  const customUrl = draft.custom.baseUrl.trim();
  const needsConsent = backend === 'jev' || (backend === 'custom' && !isLoopback(customUrl));
  const consentBlocked = needsConsent && !draft.consent;
  const lockedConsent = locked('remoteDataConsent');

  const catalogInvalid = Boolean(draft.catalog && config.catalog?.tiers && draft.catalog.mode === 'manual' && !parseThresholds(draft.catalog).ok);
  const buildInput = (withCatalog = false): RouterConfigInput => {
    const input: RouterConfigInput = {};
    if (!locked('backend')) input.backend = draft.backend;
    input.local = {
      ...(locked('local.baseUrl') ? {} : { baseUrl: draft.local.baseUrl.trim() }),
      ...(locked('local.model') ? {} : { model: draft.local.model.trim() }),
      ...(locked('local.scoreScale') ? {} : { scoreScale: draft.local.scoreScale }),
    };
    const jevKey = draft.apiKey.jev ? draft.apiKey.jev : draft.clearKey.jev ? '' : undefined;
    input.jev = { ...(locked('jev.model') ? {} : { model: draft.jev.model.trim() }), ...(jevKey !== undefined ? { apiKey: jevKey } : {}) };
    const customKey = draft.apiKey.custom ? draft.apiKey.custom : draft.clearKey.custom ? '' : undefined;
    input.custom = {
      ...(locked('custom.baseUrl') ? {} : { baseUrl: customUrl }),
      ...(locked('custom.model') ? {} : { model: draft.custom.model.trim() }),
      ...(locked('custom.scoreScale') ? {} : { scoreScale: draft.custom.scoreScale }),
      ...(customKey !== undefined ? { apiKey: customKey } : {}),
    };
    const timeout = Number(draft.timeoutMs);
    if (!locked('timeoutMs') && Number.isFinite(timeout) && timeout > 0) input.timeoutMs = Math.round(timeout);
    if (!lockedConsent) input.remoteDataConsent = draft.consent;
    input.features = Object.fromEntries(FEATURES.filter(({ key }) => !locked(key, `features.${key}`)).map(({ key }) => [key, draft.features[key]]));
    if (withCatalog && draft.catalog && config.catalog) Object.assign(input, buildCatalogInput(config.catalog, draft.catalog));
    return input;
  };

  const runTest = async () => {
    if (!sessions?.testRouterConfig) return;
    setState('testing'); setTest(null); setTestError('');
    try { setTest(await sessions.testRouterConfig(buildInput())); }
    catch (error) { setTestError(error instanceof Error ? error.message : 'Connection test failed'); }
    finally { setState('idle'); }
  };
  const save = async () => {
    if (!sessions?.saveRouterConfig || consentBlocked || catalogInvalid) return;
    setState('saving'); setSaveError(''); setNotice('');
    try {
      const next = await sessions.saveRouterConfig(buildInput(true));
      setConfig(next); setDraft(toDraft(next)); setNotice('Router settings saved');
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Router settings could not be saved'); }
    finally { setState('idle'); }
  };

  const envNote = (...names: string[]) => locked(...names) ? <small className="router-settings-locked">set by environment</small> : null;
  const keyField = (id: 'jev' | 'custom', label: string) => {
    const saved = id === 'jev' ? config.jev.hasApiKey : config.custom.hasApiKey;
    const cleared = draft.clearKey[id];
    return <div className="router-settings-field">
      <label>{label}<input type="password" autoComplete="off" value={draft.apiKey[id]} disabled={locked(`${id}.apiKey`)} placeholder={saved && !cleared ? 'Leave blank to keep the saved key' : ''} onChange={(event) => update({ apiKey: { ...draft.apiKey, [id]: event.target.value }, clearKey: { ...draft.clearKey, [id]: false } })} data-testid={`router-${id}-key`} /></label>
      {saved && <span className="router-settings-key-state">
        <span data-testid={`router-${id}-key-saved`}>{cleared ? 'Key will be removed on save' : 'Key saved'}</span>
        <button className="secondary-button" type="button" onClick={() => update({ clearKey: { ...draft.clearKey, [id]: !cleared }, apiKey: { ...draft.apiKey, [id]: '' } })} data-testid={`router-${id}-key-clear`}>{cleared ? 'Keep key' : 'Clear key'}</button>
      </span>}
      {envNote(`${id}.apiKey`)}
    </div>;
  };
  const scaleField = (id: 'local' | 'custom') => <div className="router-settings-field"><label>Score scale
    <select value={draft[id].scoreScale} disabled={locked(`${id}.scoreScale`)} onChange={(event) => update({ [id]: { ...draft[id], scoreScale: event.target.value as RouterScoreScale } } as Partial<Draft>)} data-testid={`router-${id}-scale`}>
      {SCALES.map((scale) => <option key={scale} value={scale}>{scale === 'auto' ? 'Auto-detect' : scale === 'probability' ? 'Probability (0–1)' : 'Logit'}</option>)}
    </select></label>{envNote(`${id}.scoreScale`)}</div>;

  return <section className="router-settings" data-testid="router-settings" aria-labelledby="router-settings-title">
    <h3 id="router-settings-title">Router model</h3>
    <p className="router-settings-note">The small model that ranks candidates for Auto model routing, tools, and memories. Effective now: <strong data-testid="router-effective">{config.effective ? `${config.effective.backend} · ${config.effective.model}` : config.backend}</strong></p>
    <fieldset className="router-settings-backends" disabled={locked('backend')}>
      <legend>Backend {envNote('backend')}</legend>
      {BACKENDS.map((option) => <label key={option.id} className="router-settings-radio">
        <input type="radio" name="router-backend" value={option.id} checked={backend === option.id} onChange={() => update({ backend: option.id })} data-testid={`router-backend-${option.id}`} />
        <span><strong>{option.label}</strong><small>{option.hint}</small></span>
      </label>)}
    </fieldset>
    <div className="router-settings-fields">
      {backend === 'local' && <>
        <div className="router-settings-field"><label>Base URL<input value={draft.local.baseUrl} disabled={locked('local.baseUrl')} placeholder="http://127.0.0.1:8012" onChange={(event) => update({ local: { ...draft.local, baseUrl: event.target.value } })} data-testid="router-local-url" /></label>{envNote('local.baseUrl')}</div>
        <div className="router-settings-field"><label>Model<input value={draft.local.model} disabled={locked('local.model')} onChange={(event) => update({ local: { ...draft.local, model: event.target.value } })} data-testid="router-local-model" /></label>{envNote('local.model')}</div>
        {scaleField('local')}
      </>}
      {backend === 'jev' && <>
        {keyField('jev', 'API key')}
        <div className="router-settings-field"><label>Model<input value={draft.jev.model} disabled={locked('jev.model')} placeholder="jev-latest" onChange={(event) => update({ jev: { model: event.target.value } })} data-testid="router-jev-model" /></label>{envNote('jev.model')}</div>
      </>}
      {backend === 'custom' && <>
        <div className="router-settings-field"><label>Base URL<input value={draft.custom.baseUrl} disabled={locked('custom.baseUrl')} placeholder="http://192.168.1.20:8012" onChange={(event) => update({ custom: { ...draft.custom, baseUrl: event.target.value } })} data-testid="router-custom-url" /></label>{envNote('custom.baseUrl')}</div>
        <div className="router-settings-field"><label>Model<input value={draft.custom.model} disabled={locked('custom.model')} onChange={(event) => update({ custom: { ...draft.custom, model: event.target.value } })} data-testid="router-custom-model" /></label>{envNote('custom.model')}</div>
        {keyField('custom', 'API key (optional)')}
        {scaleField('custom')}
      </>}
      <div className="router-settings-field"><label>Timeout (ms)<input type="number" min="1" step="1" value={draft.timeoutMs} disabled={locked('timeoutMs')} onChange={(event) => update({ timeoutMs: event.target.value })} data-testid="router-timeout" /></label>{envNote('timeoutMs')}</div>
    </div>
    {needsConsent && <label className="router-settings-consent">
      <input type="checkbox" checked={draft.consent} disabled={lockedConsent} onChange={(event) => update({ consent: event.target.checked })} data-testid="router-consent" />
      <span>Prompts, tool names and memories will be sent to this server to rank them. {envNote('remoteDataConsent')}</span>
    </label>}
    <div className="router-settings-features" role="group" aria-label="Router features">
      <h4>Where the router is used</h4>
      {FEATURES.map((feature) => {
        const isLocked = locked(feature.key, `features.${feature.key}`);
        const hintId = `router-feature-${feature.key}-hint`;
        return <div className="router-settings-feature" key={feature.key}>
          <label>{feature.label}
            <select value={draft.features[feature.key]} disabled={isLocked} aria-describedby={hintId} onChange={(event) => update({ features: { ...draft.features, [feature.key]: event.target.value as RouterFeatureMode } })} data-testid={`router-feature-${feature.key}`}>
              {MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
          </label>
          <small id={hintId}>{feature.hint}{isLocked && <> · <span className="router-settings-locked">set by environment</span></>}</small>
        </div>;
      })}
    </div>
    <RouterCatalogSection catalog={config.catalog} draft={draft.catalog} onChange={(catalog) => update({ catalog })} />
    <div className="router-settings-actions">
      <button className="secondary-button" type="button" onClick={() => void runTest()} disabled={state !== 'idle'} data-testid="router-test">{state === 'testing' ? 'Testing…' : 'Test connection'}</button>
      <button className="primary-button" type="button" onClick={() => void save()} disabled={state !== 'idle' || consentBlocked || catalogInvalid} data-testid="router-save">{state === 'saving' ? 'Saving…' : 'Save'}</button>
      {consentBlocked && <small className="router-settings-note" data-testid="router-consent-hint">Confirm data sharing above to save.</small>}
    </div>
    <div className="router-settings-results" aria-live="polite" data-testid="router-results">
      {notice && <p role="status" data-testid="router-notice">{notice}</p>}
      {saveError && <p role="alert" data-testid="router-save-error">{saveError}</p>}
      {testError && <p role="alert" data-testid="router-test-error">{testError}</p>}
      {test && (test.ok
        ? <div data-testid="router-test-result"><p><strong>Connected</strong> · {test.model ?? draft[backend === 'jev' ? 'jev' : backend].model} · {test.latencyMs ?? '?'} ms</p>
          {test.ranked && test.ranked.length > 0 && <ol className="router-settings-ranked">{test.ranked.map((row, index) => <li key={index}><span>{row.text}</span><code>{Number(row.score).toFixed(3)}</code></li>)}</ol>}</div>
        : <p role="alert" data-testid="router-test-result">Test failed{test.message ? `: ${test.message}` : ''}</p>)}
    </div>
  </section>;
}
