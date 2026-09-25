import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../icons';
import { useGateway } from '../../gateway/context';
import { createGenerationGuard, type ModelCatalogEntry } from '../../gateway/sessions';
import { useFixtures } from '../../store';
import { ProviderConnectCard, ProviderAuthFlowForm, providerCatalog, type ProviderCatalogEntry, type ProviderAuthFlow } from './AgentSettingsTool';

// #1580 S2 — Electron AI settings: provider-first model curation, modeled after Hermes
// Desktop's model-visibility-dialog (searchable, grouped-by-provider, collapsible, tri-state
// all/none, per-model switches) but built on Rhythm's own catalog/visibility endpoints — see
// apps/api_server/src/routes/agents_models_routes.ts (GET /agents/models/catalog/full) and
// agent_model_visibility_routes.ts (GET/PATCH /agent-models/visibility).

type ProviderStatus = 'connected' | 'needs-login' | 'unavailable';

type ProviderGroup = {
  provider: string;
  label: string;
  status: ProviderStatus;
  catalogEntry?: ProviderCatalogEntry;
  rows: ModelCatalogEntry[];
};

const statusLabel: Record<ProviderStatus, string> = { connected: 'Connected', 'needs-login': 'Needs login or key', unavailable: 'Unavailable' };
const visibilityKey = (row: { provider: string; modelId: string }) => `${row.provider}\0${row.modelId}`;

export function ModelCurationPanel({
  authProviders, providersCurrent, providerFlow, providerDraft, onApiKeyChange, onCodeChange,
  startProviderAuth, completeProviderAuth, checkProviderAuth, saveProviderApiKey,
  providerPending, providerActionError, providerNotice, onReloadLocalConfig, localConfigPending,
}: {
  authProviders: string[] | null;
  providersCurrent: boolean;
  providerFlow: ProviderAuthFlow | null;
  providerDraft: { code: string; apiKey: Record<string, string> };
  onApiKeyChange(providerId: string, value: string): void;
  onCodeChange(value: string): void;
  startProviderAuth(provider: ProviderCatalogEntry): Promise<void>;
  completeProviderAuth(event: FormEvent): Promise<void>;
  checkProviderAuth(): Promise<void>;
  saveProviderApiKey(event: FormEvent, provider: ProviderCatalogEntry): Promise<void>;
  providerPending: boolean;
  providerActionError: string;
  providerNotice: string;
  onReloadLocalConfig(): void;
  localConfigPending: boolean;
}) {
  const gateway = useGateway();
  const { refreshModels } = useFixtures();
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [visibilityError, setVisibilityError] = useState('');
  // A stale response (e.g. from before the desktop process reconnected to a different
  // gateway) must never overwrite a fresher one — same fencing store.refreshModels() uses.
  const guard = useRef(createGenerationGuard());

  const load = useCallback(async () => {
    const token = guard.current.begin();
    setLoading(true);
    try {
      const rows = await gateway.domains.sessions?.modelCatalogFull?.() ?? [];
      if (guard.current.isCurrent(token)) { setCatalog(rows); setLoadError(''); }
    } catch (err) {
      if (guard.current.isCurrent(token)) setLoadError(err instanceof Error ? err.message : 'Model catalog unavailable');
    } finally {
      if (guard.current.isCurrent(token)) setLoading(false);
    }
  }, [gateway]);

  // Re-reads the full catalog whenever the parent's connected-provider list changes — i.e.
  // right after a provider Connect/API-key/re-check completes — so a freshly connected
  // provider's real models appear here without a manual refresh (acceptance: "on completion
  // the catalog and provider status re-fetch"). Keyed on content, not array identity: every
  // successful providers reload creates a new `authProviders` array even when the authorized
  // set is unchanged, which would otherwise refetch the catalog on every retry/refresh.
  const authProvidersKey = authProviders === null ? null : authProviders.join(',');
  useEffect(() => { void load(); }, [load, authProvidersKey]);

  const groups = useMemo<ProviderGroup[]>(() => {
    const byProvider = new Map<string, ModelCatalogEntry[]>();
    for (const row of catalog) {
      // Anthropic accounts are a separate, already-shipped OAuth flow in the Accounts
      // section (per-account login, not a single provider connect/API key) — this screen
      // deliberately does not duplicate or relabel that as an "opencode.json" provider.
      if (row.provider === 'anthropic') continue;
      if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);
      // A provider the engine has never loaded surfaces only as a modelId:'' placeholder
      // row (server: agents_models_routes.ts ~342-358) — keep the group (for its Connect
      // action) without adding a fake model row.
      if (row.modelId) byProvider.get(row.provider)!.push(row);
    }
    // A known connect-flow provider with zero rows at all (not even a placeholder, e.g. the
    // engine snapshot omitted it) must still be offered so it can be connected from here.
    for (const entry of providerCatalog) if (!byProvider.has(entry.id)) byProvider.set(entry.id, []);
    return [...byProvider.entries()].map(([provider, rows]) => {
      const catalogEntry = providerCatalog.find((entry) => entry.id === provider);
      const anyAuthorized = catalog.some((row) => row.provider === provider && row.authorized);
      const status: ProviderStatus = anyAuthorized ? 'connected' : catalogEntry ? 'needs-login' : 'unavailable';
      return { provider, label: catalogEntry?.label ?? provider, status, catalogEntry, rows: [...rows].sort((a, b) => a.displayName.localeCompare(b.displayName)) };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog]);

  const term = search.trim().toLocaleLowerCase();
  const visibleGroups = term ? groups
    .map((group) => {
      const providerMatches = group.label.toLocaleLowerCase().includes(term) || group.provider.toLocaleLowerCase().includes(term);
      const rows = providerMatches ? group.rows : group.rows.filter((row) => row.modelId.toLocaleLowerCase().includes(term) || row.displayName.toLocaleLowerCase().includes(term));
      return { ...group, rows };
    })
    .filter((group) => group.rows.length > 0)
    : groups;

  const setRowVisibility = async (updates: { provider: string; modelId: string; visible: boolean }[]) => {
    if (!updates.length || !gateway.domains.sessions?.setModelVisibility) return;
    const keys = updates.map(visibilityKey);
    setPending((current) => new Set([...current, ...keys]));
    setVisibilityError('');
    try {
      await gateway.domains.sessions.setModelVisibility(updates);
      const byKey = new Map(updates.map((update) => [visibilityKey(update), update.visible]));
      setCatalog((current) => current.map((row) => byKey.has(visibilityKey(row)) ? { ...row, visible: byKey.get(visibilityKey(row))! } : row));
      // Every open Composer/Profiles/AgentsWorkspace picker reads `models` from the same
      // FixtureProvider state — refreshing it here is what makes the change appear immediately.
      await refreshModels();
    } catch (err) {
      setVisibilityError(err instanceof Error ? err.message : 'Model visibility could not be saved');
    } finally {
      setPending((current) => { const next = new Set(current); for (const key of keys) next.delete(key); return next; });
    }
  };

  const toggleModel = (row: ModelCatalogEntry) => void setRowVisibility([{ provider: row.provider, modelId: row.modelId, visible: !row.visible }]);
  const toggleGroup = (group: ProviderGroup, next: boolean) => void setRowVisibility(group.rows.filter((row) => row.visible !== next).map((row) => ({ provider: row.provider, modelId: row.modelId, visible: next })));

  return <div className="model-curation" data-testid="model-curation-panel">
    {loadError && <p role="alert">{loadError} <button className="text-button" type="button" onClick={() => void load()}>Retry</button></p>}
    {visibilityError && <p role="alert" data-testid="model-curation-visibility-error">{visibilityError}</p>}
    {providerActionError && <p role="alert">{providerActionError}</p>}
    {providerNotice && <p role="status">{providerNotice}</p>}
    <label className="list-inspector-search model-curation-search"><span className="sr-only">Search models</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by provider, model id, or name" data-testid="model-curation-search" /></label>
    {loading && <p role="status">Loading model catalog…</p>}
    {!loading && !loadError && visibleGroups.length === 0 && <div className="agent-settings-empty" role="status"><strong>No matching models</strong><p>Try a different provider, model id, or name.</p></div>}
    <div className="model-curation-groups">
      {!loading && visibleGroups.map((group) => {
        const expanded = term ? true : !collapsed[group.provider];
        const visibleCount = group.rows.filter((row) => row.visible).length;
        const allSelected = group.rows.length > 0 && visibleCount === group.rows.length;
        const mixed = visibleCount > 0 && !allSelected;
        const togglable = group.status === 'connected';
        const groupPending = group.rows.some((row) => pending.has(visibilityKey(row)));
        return <section key={group.provider} className="model-curation-group" data-testid={`model-curation-group-${group.provider}`}>
          <button type="button" className="model-curation-group-header" aria-expanded={expanded} onClick={() => setCollapsed((current) => ({ ...current, [group.provider]: !current[group.provider] }))} data-testid={`model-curation-group-toggle-${group.provider}`}>
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} aria-hidden="true" />
            <span className="model-curation-group-title">{group.label}</span>
            <span className={`kind-badge model-curation-status-${group.status}`}>{statusLabel[group.status]}</span>
          </button>
          {expanded && <div className="model-curation-group-body">
            {group.rows.length > 0 && <label className="switch-label model-curation-all-none">
              <input type="checkbox" aria-checked={mixed ? 'mixed' : allSelected} checked={allSelected}
                ref={(element) => { if (element) element.indeterminate = mixed; }}
                disabled={!togglable || groupPending} onChange={() => toggleGroup(group, !allSelected)}
                aria-label={`Show all ${group.label} models`} data-testid={`model-curation-all-${group.provider}`} />
              <span />All / none
            </label>}
            {group.rows.length === 0 && <p className="model-curation-empty">No models reported for this provider yet.</p>}
            {group.rows.map((row) => {
              const busy = pending.has(visibilityKey(row));
              return <label key={row.modelId} className="switch-label model-curation-row" data-testid={`model-curation-model-${group.provider}-${row.modelId}`}>
                <input type="checkbox" role="switch" checked={row.visible} disabled={!togglable || busy} onChange={() => toggleModel(row)} aria-label={`Show ${row.displayName} in model pickers`} />
                <span />
                <span className="model-curation-row-label">
                  <strong>{row.displayName}</strong>
                  <small>{row.modelId}{row.available === 'unknown' ? ' · Unverified' : row.available === false ? ` · ${row.availabilityReason.replace(/_/g, ' ')}` : ''}</small>
                </span>
              </label>;
            })}
            {group.status === 'needs-login' && group.catalogEntry && <ProviderConnectCard
              provider={group.catalogEntry} connected={false} statusKnown={authProviders !== null}
              confirmed={providersCurrent && authProviders !== null} pending={providerPending}
              badge={authProviders === null ? 'Status unknown' : 'Not connected'}
              apiKeyValue={providerDraft.apiKey[group.catalogEntry.id] ?? ''}
              onApiKeyChange={(value) => onApiKeyChange(group.catalogEntry!.id, value)}
              onAuthorize={() => void startProviderAuth(group.catalogEntry!)}
              onSaveKey={(event) => void saveProviderApiKey(event, group.catalogEntry!)} />}
            {group.status === 'needs-login' && providerFlow?.id === group.provider && <ProviderAuthFlowForm
              flow={providerFlow} code={providerDraft.code} pending={providerPending} onCodeChange={onCodeChange}
              onSubmit={completeProviderAuth} onCheck={() => void checkProviderAuth()} />}
            {group.status === 'unavailable' && <p className="model-curation-local-note">Configured through <code>opencode.json</code>, not through this screen. Reload the local runtime after editing it.
              <button className="text-button" type="button" disabled={localConfigPending} onClick={onReloadLocalConfig} data-testid={`model-curation-reload-${group.provider}`}>{localConfigPending ? 'Reloading…' : 'Reload local config'}</button>
            </p>}
          </div>}
        </section>;
      })}
    </div>
  </div>;
}
