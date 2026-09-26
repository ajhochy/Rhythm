import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { RhythmGatewayError } from '../domain/types';
import { defaultRhythmTokens, mapHostTokens, RHYTHM_ROOT_CLASS } from '../host/theme';
import type { RhythmViewport } from '../host/types';
import { FocusDialog } from '../components/FocusDialog';
import { ListInspector } from '../components/ListInspector';
import {
  CONFIRMED_EDIT_FIELDS,
  PRESENTATION_EDIT_FIELDS,
  type SharedAgent,
  type SharedAgentChanges,
  type SharedAgentEditableField,
  type SharedAgentEditableValue,
  type SharedAgentReadiness,
  type SharedAgentsPort,
} from './types';

export interface SharedAgentsScreenProps {
  port: SharedAgentsPort;
  readOnly?: boolean;
  viewport?: RhythmViewport;
}

const EDITABLE_FIELDS = [...PRESENTATION_EDIT_FIELDS, ...CONFIRMED_EDIT_FIELDS] as const;
const BOOLEAN_FIELDS = ['enabled', 'isAgent', 'isManager', 'sessionSelectable', 'schedulable', 'imageGenerationEnabled', 'autoApproveActions'] as const;
const JSON_FIELDS = ['allowedMcpsJson', 'allowedSkillsJson', 'corePermissionsJson', 'allowedDelegatesJson'] as const;
const NULLABLE_TEXT_FIELDS = ['modelProvider', 'modelId', 'ocAgent', 'modelTierHint', 'defaultAnthropicAccountId', 'reasoningEffort'] as const;

const fieldLabels: Record<SharedAgentEditableField, string> = {
  label: 'Label', icon: 'Icon', enabled: 'Enabled', isAgent: 'Can run as agent', isManager: 'Can delegate',
  systemPrompt: 'Instructions', allowedMcpsJson: 'Allowed MCPs JSON', allowedSkillsJson: 'Allowed skills JSON',
  corePermissionsJson: 'Core permissions JSON', allowedDelegatesJson: 'Allowed delegates JSON',
  modelProvider: 'Model provider', modelId: 'Model id', ocAgent: 'OpenCode agent',
  sessionSelectable: 'Interactive launch', schedulable: 'Schedulable', imageGenerationEnabled: 'Image generation',
  modelTierHint: 'Model tier hint', defaultAnthropicAccountId: 'Default Anthropic account id',
  reasoningEffort: 'Reasoning effort', autoApproveActions: 'Auto-approve actions',
};

function editableValue(agent: SharedAgent, field: SharedAgentEditableField): SharedAgentEditableValue {
  const value = agent.canonical[field];
  return typeof value === 'string' || typeof value === 'boolean' || value === null ? value : null;
}

function initialDraft(agent: SharedAgent): Record<SharedAgentEditableField, SharedAgentEditableValue> {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, editableValue(agent, field)])) as Record<SharedAgentEditableField, SharedAgentEditableValue>;
}

function title(agent: SharedAgent) {
  const label = typeof agent.canonical.label === 'string' && agent.canonical.label.trim() ? agent.canonical.label : agent.id;
  return `${label} (${agent.id})`;
}

function readinessLabel(value: SharedAgentReadiness) {
  return value.split('-').map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(' ');
}

function Editor({ agent, port, onSaved, onClose }: { agent: SharedAgent; port: SharedAgentsPort; onSaved(agent: SharedAgent): void; onClose(): void }) {
  const [draft, setDraft] = useState(() => initialDraft(agent));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const setField = (field: SharedAgentEditableField, value: SharedAgentEditableValue) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const changes = useMemo(() => Object.fromEntries(EDITABLE_FIELDS.flatMap((field) => (
    Object.is(draft[field], editableValue(agent, field)) ? [] : [[field, draft[field]]]
  ))) as SharedAgentChanges, [agent, draft]);
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setStatus('Saving changes…');
    try {
      const saved = await port.save(agent.id, agent.revision, changes, {
        onConfirmationRequired: () => setStatus('Waiting for confirmation in Rhythm'),
      });
      onSaved(saved);
      onClose();
    } catch (error) {
      if (error instanceof RhythmGatewayError && error.kind === 'conflict') setStatus('Changed elsewhere, reload');
      else if (error instanceof RhythmGatewayError && error.kind === 'forbidden') setStatus('Confirmation was not approved. Your draft is unchanged.');
      else setStatus(error instanceof Error ? error.message : 'Changes could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    setSaving(true);
    setStatus('Reloading current values…');
    try {
      const current = await port.get(agent.id);
      onSaved(current);
      setDraft(initialDraft(current));
      setStatus('Current values loaded.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Current values could not be loaded.');
    } finally {
      setSaving(false);
    }
  };

  return <FocusDialog open title={`Edit ${title(agent)}`} description="Only fields changed in this draft are sent when you save." onClose={onClose} testId="shared-agent-editor" wide>
    <form className="shared-agent-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {PRESENTATION_EDIT_FIELDS.map((field, index) => <label key={field} className="shared-agent-field">{fieldLabels[field]}
        <input data-autofocus={index === 0 ? '' : undefined} data-testid={`shared-agent-field-${field}`} value={String(draft[field] ?? '')} onChange={(event) => setField(field, event.target.value)} />
      </label>)}
      {BOOLEAN_FIELDS.map((field) => <label key={field} className="shared-agent-check">
        <input data-testid={`shared-agent-field-${field}`} type="checkbox" checked={draft[field] === true} onChange={(event) => setField(field, event.target.checked)} />
        <span>{fieldLabels[field]}</span>
      </label>)}
      <label className="shared-agent-field shared-agent-span">{fieldLabels.systemPrompt}
        <textarea data-testid="shared-agent-field-systemPrompt" rows={5} value={String(draft.systemPrompt ?? '')} onChange={(event) => setField('systemPrompt', event.target.value === '' ? null : event.target.value)} />
      </label>
      {NULLABLE_TEXT_FIELDS.map((field) => <label key={field} className="shared-agent-field">{fieldLabels[field]}
        <input data-testid={`shared-agent-field-${field}`} value={String(draft[field] ?? '')} onChange={(event) => setField(field, event.target.value === '' ? null : event.target.value)} />
      </label>)}
      {JSON_FIELDS.map((field) => <label key={field} className="shared-agent-field shared-agent-span">{fieldLabels[field]}
        <textarea className="shared-agent-json" data-testid={`shared-agent-field-${field}`} rows={4} spellCheck={false} value={String(draft[field] ?? '')} onChange={(event) => setField(field, event.target.value === '' ? null : event.target.value)} />
      </label>)}
      <div className="shared-agent-editor-footer shared-agent-span">
        <p role="status" aria-live="polite" data-testid="shared-agent-save-status">{status}</p>
        <div className="shared-agent-actions">
          {status.includes('reload') && <button type="button" onClick={() => void reload()} disabled={saving}>Reload current values</button>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" data-testid="shared-agent-save" disabled={!dirty || saving}>Save changes</button>
        </div>
      </div>
    </form>
  </FocusDialog>;
}

function CatalogScreen({ catalog, port, readOnly, viewport, onRefresh }: { catalog: Awaited<ReturnType<SharedAgentsPort['list']>>; port: SharedAgentsPort; readOnly: boolean; viewport: RhythmViewport; onRefresh(): void }) {
  const [agents, setAgents] = useState(catalog.agents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [launchStatus, setLaunchStatus] = useState('');
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const editing = agents.find((agent) => agent.id === editingId) ?? null;
  const items = agents.map((agent) => ({
    id: agent.id,
    title: title(agent),
    subtitle: `OpenCode: ${readinessLabel(agent.runtimes.opencode.readiness)} · Hermes: ${readinessLabel(agent.runtimes.hermes.readiness)}`,
    testId: `shared-agent-${agent.id}`,
  }));

  useEffect(() => setAgents(catalog.agents), [catalog.agents]);

  const updateAgent = useCallback((saved: SharedAgent) => {
    setAgents((current) => current.map((agent) => agent.id === saved.id ? saved : agent));
  }, []);

  const launch = async (agent: SharedAgent) => {
    if (!port.launch) return;
    setLaunchStatus('Launching…');
    try {
      const result = await port.launch(agent.id, agent.revision);
      setLaunchStatus(result.ok ? 'Agent launched.' : result.reason);
    } catch (error) {
      setLaunchStatus(error instanceof Error ? error.message : 'Agent could not be launched.');
    }
  };

  return <main
    className={`${RHYTHM_ROOT_CLASS} shared-agents-screen`}
    aria-label="Shared Agents"
    data-testid="shared-agents-screen"
    data-rhythm-viewport={viewport}
    data-rhythm-theme={defaultRhythmTokens.mode}
    data-catalog-scope={catalog.scope}
    style={mapHostTokens(defaultRhythmTokens) as CSSProperties}
  >
    <header className="shared-agents-header"><div><p className="shared-agents-eyebrow">Canonical agent catalog</p><h1>Shared Agents</h1><p>Inspect how each canonical Rhythm agent maps to OpenCode and Hermes.</p></div><button type="button" onClick={onRefresh} data-testid="shared-agents-refresh">Refresh</button></header>
    {readOnly && <p className="shared-agents-banner" role="status">Read-only mode</p>}
    <ListInspector
      identityKey={catalog.scope}
      label="Shared agents"
      items={items}
      selectedId={selectedId}
      onSelect={(id) => { setSelectedId(id); setLaunchStatus(''); }}
      searchable
      searchPlaceholder="Search shared agents"
      emptyState={<p>No shared agents are available.</p>}
      emptySelection={<p>Select an agent to inspect its runtime readiness and editable canonical fields.</p>}
      inspector={() => selected ? <div className="shared-agent-inspector">
        <p className="shared-agent-id"><strong>Canonical id</strong><code>{selected.id}</code></p>
        <div className="shared-agent-readiness-grid">
          {(['opencode', 'hermes'] as const).map((runtime) => {
            const projection = selected.runtimes[runtime];
            return <section key={runtime} className={`shared-agent-readiness readiness-${projection.readiness}`} data-testid={`shared-agent-readiness-${runtime}`}>
              <header><strong>{runtime === 'opencode' ? 'OpenCode' : 'Hermes'}</strong><span>{readinessLabel(projection.readiness)}</span></header>
              {projection.reasons.length > 0 ? <ul>{projection.reasons.map((reason, index) => <li key={`${reason.code}-${index}`}><code>{reason.code}</code><span>{reason.message}</span></li>)}</ul> : <p>No readiness restrictions.</p>}
            </section>;
          })}
        </div>
        <dl className="shared-agent-summary">
          <div><dt>Revision</dt><dd>{selected.revision}</dd></div>
          <div><dt>Model</dt><dd>{String(selected.canonical.modelProvider ?? 'Not set')} / {String(selected.canonical.modelId ?? 'Not set')}</dd></div>
          <div><dt>Interactive</dt><dd>{selected.runtimes[port.hostRuntime].launchKinds.interactive ? 'Allowed' : 'Not allowed'}</dd></div>
        </dl>
        <div className="shared-agent-actions">
          <button type="button" onClick={() => setEditingId(selected.id)} disabled={readOnly} data-testid="shared-agent-edit">Edit canonical fields</button>
          <button type="button" onClick={() => void launch(selected)} disabled={readOnly || !port.launch || selected.runtimes[port.hostRuntime].readiness !== 'supported' || !selected.runtimes[port.hostRuntime].launchKinds.interactive} data-testid="shared-agent-launch">Launch in {port.hostRuntime === 'opencode' ? 'OpenCode' : 'Hermes'}</button>
        </div>
        <p role="status" aria-live="polite">{launchStatus}</p>
      </div> : null}
    />
    {editing && <Editor agent={editing} port={port} onSaved={updateAgent} onClose={() => setEditingId(null)} />}
  </main>;
}

export function SharedAgentsScreen({ port, readOnly = false, viewport = 'regular' }: SharedAgentsScreenProps) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<SharedAgentsPort['list']>> | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    void port.list().then((value) => { if (active) setCatalog(value); }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Shared agents could not be loaded.');
    });
    return () => { active = false; };
  }, [port, reloadKey]);

  if (error) return <main className={`${RHYTHM_ROOT_CLASS} shared-agents-screen`} data-testid="shared-agents-screen" data-rhythm-viewport={viewport} style={mapHostTokens(defaultRhythmTokens) as CSSProperties}><p role="alert">{error}</p><button type="button" onClick={() => setReloadKey((value) => value + 1)}>Try again</button></main>;
  if (!catalog) return <main className={`${RHYTHM_ROOT_CLASS} shared-agents-screen`} data-testid="shared-agents-screen" data-rhythm-viewport={viewport} style={mapHostTokens(defaultRhythmTokens) as CSSProperties}><p role="status">Loading shared agents…</p></main>;
  return <CatalogScreen key={catalog.scope} catalog={catalog} port={port} readOnly={readOnly} viewport={viewport} onRefresh={() => setReloadKey((value) => value + 1)} />;
}
