import { useCallback, useEffect, useRef, useState } from 'react';
import { useGateway } from '../../gateway/context';
import {
  createGenerationGuard,
  type RouterBackend, type RouterConfig, type RouterConfigInput, type RouterFeatureKey, type RouterFeatureMode, type RouterScoreScale, type RouterTestResult,
} from '../../gateway/sessions';

// Router model settings — GET/PUT /agent-decisions/config and POST /agent-decisions/config/test
// (docs/ai/plans/2026-09-29-local-decision-engine.md, "Router backend settings"). API keys are
// write-only: the server only reports `hasApiKey`, so a key is sent only when the user types one
// (or explicitly clears the saved one with '').

type Draft = {
  backend: RouterBackend;
  local: { baseUrl: string; model: string; scoreScale: RouterScoreScale };
  jev: { model: string };
  custom: { baseUrl: string; model: string; scoreScale: RouterScoreScale };
  systemone: { baseUrl: string; model: string };
  openaiDecisions: { baseUrl: string; model: string };
  apiKey: { jev: string; custom: string; systemone: string; openaiDecisions: string };
  clearKey: { jev: boolean; custom: boolean; systemone: boolean; openaiDecisions: boolean };
  timeoutMs: string;
  consent: boolean;
  features: Record<RouterFeatureKey, RouterFeatureMode>;
};

const BACKENDS: Array<{ id: RouterBackend; label: string; hint: string }> = [
  { id: 'local', label: 'Local (this Mac)', hint: 'A reranker running on this computer.' },
  { id: 'jev', label: 'Jev (TypeSafe API)', hint: 'Hosted by TypeSafe; needs an API key.' },
  { id: 'custom', label: 'Custom (network or other server)', hint: 'Any compatible reranker, for example on another computer.' },
  { id: 'systemone', label: 'System One (Kev / Jev)', hint: 'One typed tier question per first prompt. Tools and memories stay on the local reranker.' },
  { id: 'openai_decisions', label: 'OpenAI Decisions (GPT-6 Luna)', hint: 'One scored question per first prompt via OpenAI. Sends the prompt to OpenAI; needs an API key and remote-data consent. Tools and memories stay on the local reranker.' },
];
const SYSTEMONE_DEFAULT_TIMEOUT_MS = '1000';
const KEV_START = 'uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009';
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
  systemone: { baseUrl: config.systemone?.baseUrl ?? 'http://127.0.0.1:8009', model: config.systemone?.model ?? 'kev-latest' },
  openaiDecisions: { baseUrl: config.openaiDecisions?.baseUrl ?? 'https://api.openai.com', model: config.openaiDecisions?.model ?? 'gpt-6-luna' },
  apiKey: { jev: '', custom: '', systemone: '', openaiDecisions: '' },
  clearKey: { jev: false, custom: false, systemone: false, openaiDecisions: false },
  timeoutMs: String(config.timeoutMs),
  consent: config.remoteDataConsent,
  features: { ...config.features },
});

const isLoopback = (url: string) => {
  try { const host = new URL(url).hostname; return host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host); } catch { return false; }
};

/** Router backend + feature modes. Tier thresholds and per-model routing live in ModelRouting. */
export function RouterSettingsPanel({ onSaved }: { onSaved?(config: RouterConfig): void } = {}) {
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
  const systemoneUrl = draft.systemone.baseUrl.trim();
  const needsConsent = backend === 'jev' || backend === 'openai_decisions'
    || (backend === 'custom' && !isLoopback(customUrl))
    || (backend === 'systemone' && !isLoopback(systemoneUrl));
  const consentBlocked = needsConsent && !draft.consent;
  const lockedConsent = locked('remoteDataConsent');

  const buildInput = (): RouterConfigInput => {
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
    if (config.systemone) {
      const systemoneKey = draft.apiKey.systemone ? draft.apiKey.systemone : draft.clearKey.systemone ? '' : undefined;
      input.systemone = {
        ...(locked('systemone.baseUrl') ? {} : { baseUrl: systemoneUrl }),
        ...(locked('systemone.model') ? {} : { model: draft.systemone.model.trim() }),
        ...(systemoneKey !== undefined ? { apiKey: systemoneKey } : {}),
      };
    }
    if (config.openaiDecisions) {
      const key = draft.apiKey.openaiDecisions || (draft.clearKey.openaiDecisions ? '' : undefined);
      input.openaiDecisions = {
        ...(locked('openaiDecisions.baseUrl') ? {} : { baseUrl: draft.openaiDecisions.baseUrl.trim() }),
        ...(locked('openaiDecisions.model') ? {} : { model: draft.openaiDecisions.model.trim() }),
        ...(key !== undefined ? { apiKey: key } : {}),
      };
    }
    const timeout = Number(draft.timeoutMs);
    if (!locked('timeoutMs') && Number.isFinite(timeout) && timeout > 0) input.timeoutMs = Math.round(timeout);
    if (!lockedConsent) input.remoteDataConsent = draft.consent;
    input.features = Object.fromEntries(FEATURES.filter(({ key }) => !locked(key, `features.${key}`)).map(({ key }) => [key, draft.features[key]]));
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
    if (!sessions?.saveRouterConfig || consentBlocked) return;
    setState('saving'); setSaveError(''); setNotice('');
    try {
      const next = await sessions.saveRouterConfig(buildInput());
      setConfig(next); setDraft(toDraft(next)); setNotice('Router settings saved'); onSaved?.(next);
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Router settings could not be saved'); }
    finally { setState('idle'); }
  };

  const envNote = (...names: string[]) => locked(...names) ? <small className="router-settings-locked">set by environment</small> : null;
  const keyField = (id: 'jev' | 'custom' | 'systemone' | 'openaiDecisions', label: string) => {
    const saved = Boolean(config[id]?.hasApiKey);
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
      {BACKENDS.filter((option) => (option.id !== 'systemone' || config.systemone) && (option.id !== 'openai_decisions' || config.openaiDecisions)).map((option) => <label key={option.id} className="router-settings-radio">
        <input type="radio" name="router-backend" value={option.id} checked={backend === option.id} onChange={() => update({
          backend: option.id,
          // An untouched timeout follows the backend default (System One: 1000 ms).
          ...((option.id === 'systemone' || option.id === 'openai_decisions') && config.backend !== option.id && draft.timeoutMs === String(config.timeoutMs) ? { timeoutMs: SYSTEMONE_DEFAULT_TIMEOUT_MS } : {}),
        })} data-testid={`router-backend-${option.id}`} />
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
      {backend === 'openai_decisions' && <>
        <div className="router-settings-field"><label>Base URL<input value={draft.openaiDecisions.baseUrl} disabled={locked('openaiDecisions.baseUrl')} placeholder="https://api.openai.com" onChange={(event) => update({ openaiDecisions: { ...draft.openaiDecisions, baseUrl: event.target.value } })} data-testid="router-openaiDecisions-url" /></label>{envNote('openaiDecisions.baseUrl')}</div>
        <div className="router-settings-field"><label>Model<input value={draft.openaiDecisions.model} disabled={locked('openaiDecisions.model')} placeholder="gpt-6-luna" onChange={(event) => update({ openaiDecisions: { ...draft.openaiDecisions, model: event.target.value } })} data-testid="router-openaiDecisions-model" /></label>{envNote('openaiDecisions.model')}</div>
        {keyField('openaiDecisions', 'API key')}
      </>}
      {backend === 'systemone' && <>
        <div className="router-settings-field"><label>Base URL<input value={draft.systemone.baseUrl} disabled={locked('systemone.baseUrl')} placeholder="http://127.0.0.1:8009" onChange={(event) => update({ systemone: { ...draft.systemone, baseUrl: event.target.value } })} data-testid="router-systemone-url" /></label>{envNote('systemone.baseUrl')}</div>
        <div className="router-settings-field"><label>Model<input value={draft.systemone.model} disabled={locked('systemone.model')} placeholder="kev-latest" onChange={(event) => update({ systemone: { ...draft.systemone, model: event.target.value } })} data-testid="router-systemone-model" /></label>{envNote('systemone.model')}</div>
        {keyField('systemone', 'API key (optional for local Kev)')}
        <small className="router-settings-note" data-testid="router-systemone-help">Start Kev locally: <code>{KEV_START}</code>. For hosted Jev use https://api.typesafe.ai with model jev-latest.</small>
      </>}
      <div className="router-settings-field"><label>Timeout (ms)<input type="number" min="1" step="1" value={draft.timeoutMs} disabled={locked('timeoutMs')} onChange={(event) => update({ timeoutMs: event.target.value })} data-testid="router-timeout" /></label>{envNote('timeoutMs')}</div>
    </div>
    {needsConsent && <label className="router-settings-consent">
      <input type="checkbox" checked={draft.consent} disabled={lockedConsent} onChange={(event) => update({ consent: event.target.checked })} data-testid="router-consent" />
      <span>{backend === 'systemone' || backend === 'openai_decisions' ? 'Session prompts will be sent to this server to pick a model tier (never memories).' : 'Prompts, tool names and memories will be sent to this server to rank them.'} {envNote('remoteDataConsent')}</span>
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
    <div className="router-settings-actions">
      <button className="secondary-button" type="button" onClick={() => void runTest()} disabled={state !== 'idle'} data-testid="router-test">{state === 'testing' ? 'Testing…' : 'Test connection'}</button>
      <button className="primary-button" type="button" onClick={() => void save()} disabled={state !== 'idle' || consentBlocked} data-testid="router-save">{state === 'saving' ? 'Saving…' : 'Save'}</button>
      {consentBlocked && <small className="router-settings-note" data-testid="router-consent-hint">Confirm data sharing above to save.</small>}
    </div>
    <div className="router-settings-results" aria-live="polite" data-testid="router-results">
      {notice && <p role="status" data-testid="router-notice">{notice}</p>}
      {saveError && <p role="alert" data-testid="router-save-error">{saveError}</p>}
      {testError && <p role="alert" data-testid="router-test-error">{testError}</p>}
      {test && (test.ok
        ? <div data-testid="router-test-result"><p><strong>Connected</strong> · {test.model ?? (backend === 'openai_decisions' ? draft.openaiDecisions.model : draft[backend].model)}{test.tier ? <> · tier <strong data-testid="router-test-tier">{test.tier}</strong></> : null} · {test.latencyMs ?? '?'} ms</p>
          {test.ranked && test.ranked.length > 0 && <ol className="router-settings-ranked">{test.ranked.map((row, index) => <li key={index}><span>{row.text}</span><code>{Number(row.score).toFixed(3)}</code></li>)}</ol>}</div>
        : <p role="alert" data-testid="router-test-result">Test failed{test.message ? `: ${test.message}` : ''}</p>)}
    </div>
  </section>;
}
