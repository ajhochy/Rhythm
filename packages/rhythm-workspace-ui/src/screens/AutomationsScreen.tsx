// Ported from apps/web/src/pages/automations/index.tsx (593 lines) — see SOURCE_MAP.md for
// what carried over vs. what was deliberately dropped. The real page's trigger/action/provider
// catalogs come from a live GET /automation-catalog/* endpoint; this screen's AutomationsGateway
// has no catalog port, so the same catalog literals (apps/web/src/pages/automations/fixtures.ts)
// are kept as static, host-neutral data here instead. actionConfig customization (title/message
// templates, the create_reservation room picker), per-rule resync, and a separate readonly
// surface state are dropped: none of those has a home in the narrower RhythmAutomation/
// AutomationsGateway shape, and adding them would grow the gateway well past what this milestone
// needs. "Preview history" is reconstructed entirely from fields RhythmAutomation already
// carries (matchCountLastRun/lastMatchedAt/previewSummary) rather than a dedicated preview()
// call.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useRhythmDomainGateway, useRhythmHost } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { Icon } from '../components/Icon';
import { FocusDialog } from '../components/FocusDialog';
import {
  RhythmGatewayError,
  type AutomationCatalog,
  type AutomationActionType,
  type AutomationCondition,
  type AutomationSource,
  type RhythmAutomation,
} from '../domain/types';

type SurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';

const sourceOrder: AutomationSource[] = ['rhythm', 'planning_center', 'google_calendar', 'gmail'];
const sourceLabels: Record<AutomationSource, string> = { rhythm: 'Rhythm', planning_center: 'Planning Center', google_calendar: 'Google Calendar', gmail: 'Gmail' };

const triggerCatalog: Record<AutomationSource, Array<{ key: string; label: string }>> = {
  rhythm: [
    { key: 'rhythm.task_due', label: 'Task is approaching its due date' },
    { key: 'rhythm.project_step_due', label: 'Project step is approaching its due date' },
    { key: 'rhythm.plan_assembled', label: 'Plan is assembled' },
  ],
  planning_center: [
    { key: 'pco.plan_upcoming', label: 'Plan is upcoming' },
    { key: 'pco.volunteer_declined', label: 'Volunteer declined' },
    { key: 'pco.volunteer_confirmed', label: 'Volunteer confirmed' },
    { key: 'pco.position_open', label: 'Position is open' },
  ],
  google_calendar: [{ key: 'google_calendar.event_matches', label: 'Calendar event matches filter' }],
  gmail: [{ key: 'gmail.message_matches', label: 'Gmail message matches filter' }],
};

const actionCatalog: AutomationCatalog['actions'] = [
  { type: 'create_task', label: 'Create task' },
  { type: 'create_project_from_template', label: 'Create project from template' },
  { type: 'tag_task', label: 'Tag task' },
  { type: 'send_notification', label: 'Send notification' },
  { type: 'auto_schedule', label: 'Auto-schedule task' },
  { type: 'create_reservation', label: 'Create reservation' },
];

function allowedActions(source: AutomationSource) {
  if (source === 'planning_center') return actionCatalog.filter((action) => ['create_task', 'create_project_from_template'].includes(action.type));
  if (source === 'google_calendar') return actionCatalog;
  return actionCatalog.filter((action) => action.type !== 'create_reservation');
}

const conditionFields: Record<AutomationSource, string[]> = {
  rhythm: ['title', 'notes'],
  planning_center: ['title', 'serviceTypeName', 'teamName', 'positionName', 'planDate'],
  google_calendar: ['title', 'description', 'location', 'eventType'],
  gmail: ['subject', 'fromEmail', 'fromName', 'snippet', 'labelIds'],
};

function dateTimeLabel(value: string | null) {
  if (!value) return 'Never';
  return value.slice(0, 16).replace('T', ' ');
}

function suggestedName(source: AutomationSource) {
  if (source === 'gmail') return 'Gmail message matches filter';
  if (source === 'google_calendar') return 'Calendar event matches filter';
  if (source === 'planning_center') return 'Planning Center plan upcoming';
  return 'Rhythm task due';
}

interface BuilderDraft {
  name: string;
  source: AutomationSource;
  triggerKey: string;
  actionType: AutomationActionType;
  conditions: AutomationCondition[];
  actionConfig: Record<string, string>;
  sourceAccountId: string | null;
}

function draftForRule(rule: RhythmAutomation | null, catalog: AutomationCatalog): BuilderDraft {
  const source = rule?.source ?? 'rhythm';
  const triggers = catalog.triggers[source] ?? triggerCatalog[source];
  const actions = catalog.actions.length ? catalog.actions : actionCatalog;
  return {
    name: rule?.name ?? '',
    source,
    triggerKey: rule?.triggerKey ?? triggers[0]?.key ?? '',
    actionType: rule?.actionType ?? (actions.find((action) => allowedActions(source).some((allowed) => allowed.type === action.type))?.type ?? 'create_task'),
    conditions: structuredClone(rule?.conditions ?? []),
    actionConfig: { ...(rule?.actionConfig ?? {}) },
    sourceAccountId: rule?.sourceAccountId ?? catalog.providers.find((provider) => provider.source === source)?.accountId ?? null,
  };
}

const fallbackCatalog: AutomationCatalog = { providers: [], triggers: triggerCatalog, actions: actionCatalog };

function StatePanel({ state, onRetry, onCreate }: { state: Exclude<SurfaceState, 'ready'>; onRetry(): void; onCreate(): void }) {
  if (state === 'loading') return <section className="automations-state" role="status" aria-live="polite" data-testid="page-state-loading"><h2>Loading automations</h2><p>Gathering rules and the current automation catalog.</p></section>;
  if (state === 'empty') return <section className="automations-state" role="status" data-testid="page-state-empty"><h2>No automations yet</h2><p>Turn a repeated handoff into a dependable Rhythm rule.</p><button className="primary-button" type="button" onClick={onCreate} data-testid="automations-empty-create"><Icon name="plus" size={15} />Create automation</button></section>;
  if (state === 'server_error') return <section className="automations-state danger" role="alert" data-testid="page-state-server-error"><h2>Automations could not be loaded</h2><p>The automation service returned a temporary error.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="automations-state warning" role="alert" data-testid="page-state-forbidden"><h2>Workspace access required</h2><p>Ask a workspace owner to grant access to owned automation rules.</p></section>;
  return <section className="automations-state warning" role="status" data-testid="page-state-unavailable"><h2>Automations are unavailable</h2><p>Reconnect the automation service before rules can be loaded or changed.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

function BuilderDialog({ open, editing, catalog, canMutate, onClose, onSubmit }: { open: boolean; editing: RhythmAutomation | null; catalog: AutomationCatalog; canMutate: boolean; onClose(): void; onSubmit(draft: BuilderDraft): void }) {
  const [draft, setDraft] = useState<BuilderDraft>(() => draftForRule(editing, catalog));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(draftForRule(editing, catalog));
    setError('');
  }, [editing, open, catalog]);

  const updateSource = (source: AutomationSource) => {
    const triggers = catalog.triggers[source] ?? triggerCatalog[source];
    const provider = catalog.providers.find((item) => item.source === source);
    setDraft((current) => ({ ...current, source, triggerKey: triggers[0]?.key ?? '', actionType: allowedActions(source)[0]?.type ?? 'create_task', conditions: [], actionConfig: {}, sourceAccountId: provider?.accountId ?? null }));
    setError('');
  };
  const addCondition = () => setDraft((current) => ({ ...current, conditions: [...current.conditions, { field: conditionFields[current.source][0] ?? '', operator: 'equals', value: '' }] }));
  const setCondition = (index: number, patch: Partial<AutomationCondition>) => setDraft((current) => ({ ...current, conditions: current.conditions.map((condition, itemIndex) => (itemIndex === index ? { ...condition, ...patch } : condition)) }));
  const removeCondition = (index: number) => setDraft((current) => ({ ...current, conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index) }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({ ...draft, conditions: draft.conditions.filter((condition) => condition.value.trim()) });
  };

  const actions = (catalog.actions.length ? catalog.actions : actionCatalog).filter((action) => allowedActions(draft.source).some((allowed) => allowed.type === action.type));
  const triggers = catalog.triggers[draft.source] ?? triggerCatalog[draft.source];
  const action = actions.find((item) => item.type === draft.actionType);
  const provider = catalog.providers.find((item) => item.source === draft.source);
  const providerReady = !provider || provider.status === 'connected';
  const reviewName = draft.name.trim() || suggestedName(draft.source);

  return (
    <FocusDialog open={open} onClose={onClose} title={editing ? 'Edit automation' : 'New automation'} description="Choose a source signal, narrow it if needed, then decide what Rhythm should do." testId="automations-builder-dialog" wide>
      <form className="automation-builder" onSubmit={submit}>
        <fieldset disabled={!canMutate} aria-describedby={!canMutate ? 'automations-read-only' : undefined}>
        {error && <div className="automation-form-error" role="alert" data-testid="automation-builder-error">{error}</div>}
        <section className="builder-section" aria-labelledby="automation-source-heading">
          <h3 id="automation-source-heading">Source</h3>
          <div className="builder-grid">
            <label className="automation-field span-2">Automation name<input data-autofocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={suggestedName(draft.source)} data-testid="automation-name" /></label>
            <label className="automation-field">Provider
              <select value={draft.source} onChange={(event) => updateSource(event.target.value as AutomationSource)} data-testid="automation-source">
                {sourceOrder.map((source) => <option value={source} key={source}>{sourceLabels[source]}</option>)}
              </select>
            </label>
            {draft.source !== 'rhythm' && <p className="automation-provider-state" role="status" data-testid="automation-provider-state">{provider?.accountLabel ?? 'No provider account'} · {provider?.status ?? 'catalog unavailable'}</p>}
          </div>
        </section>

        <section className="builder-section" aria-labelledby="automation-trigger-heading">
          <h3 id="automation-trigger-heading">Trigger</h3>
          <label className="automation-field">Trigger
            <select value={draft.triggerKey} onChange={(event) => setDraft((current) => ({ ...current, triggerKey: event.target.value }))} data-testid="automation-trigger">
              {triggers.map((trigger) => <option value={trigger.key} key={trigger.key}>{trigger.label}</option>)}
            </select>
          </label>
        </section>

        <section className="builder-section" aria-labelledby="automation-conditions-heading">
          <header><h3 id="automation-conditions-heading">Conditions</h3><button className="secondary-button" type="button" onClick={addCondition} data-testid="automation-add-condition"><Icon name="plus" size={14} />Add condition</button></header>
          <div className="conditions-list">
            {draft.conditions.map((condition, index) => (
              <div className="condition-row" key={index}>
                <label className="automation-field">Field
                  <select value={condition.field} onChange={(event) => setCondition(index, { field: event.target.value })} data-testid={`automation-condition-field-${index}`}>
                    {conditionFields[draft.source].map((field) => <option value={field} key={field}>{field}</option>)}
                  </select>
                </label>
                <label className="automation-field">Operator
                  <select value={condition.operator} onChange={(event) => setCondition(index, { operator: event.target.value as AutomationCondition['operator'] })} data-testid={`automation-condition-operator-${index}`}>
                    <option value="equals">equals</option><option value="not_equals">not equals</option><option value="contains">contains</option><option value="not_contains">not contains</option>
                  </select>
                </label>
                <label className="automation-field">Value<input value={condition.value} onChange={(event) => setCondition(index, { value: event.target.value })} data-testid={`automation-condition-value-${index}`} /></label>
                <button className="icon-button" type="button" aria-label={`Remove condition ${index + 1}`} onClick={() => removeCondition(index)} data-testid={`automation-condition-remove-${index}`}><Icon name="delete" size={15} /></button>
              </div>
            ))}
          </div>
        </section>

        <section className="builder-section" aria-labelledby="automation-action-heading">
          <h3 id="automation-action-heading">Action</h3>
          <label className="automation-field span-2">Action
            <select value={draft.actionType} onChange={(event) => setDraft((current) => ({ ...current, actionType: event.target.value as AutomationActionType }))} data-testid="automation-action">
              {actions.map((action) => <option value={action.type} key={action.type}>{action.label}</option>)}
            </select>
          </label>
          {action?.configFields?.map((field) => <label className="automation-field span-2" key={field.key}>{field.label}<input value={draft.actionConfig[field.key] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, actionConfig: { ...current.actionConfig, [field.key]: event.target.value } }))} data-testid={`automation-action-config-${field.key}`} /></label>)}
        </section>

        <section className="builder-review" aria-labelledby="automation-review-heading" data-testid="automation-review">
          <h3 id="automation-review-heading">{reviewName}</h3>
          <dl><div><dt>Provider</dt><dd>{provider?.accountLabel ?? sourceLabels[draft.source]}</dd></div><div><dt>Trigger</dt><dd>{triggers.find((trigger) => trigger.key === draft.triggerKey)?.label}</dd></div><div><dt>Action</dt><dd>{actions.find((action) => action.type === draft.actionType)?.label}</dd></div></dl>
        </section>

        {!providerReady && <p role="alert" data-testid="automation-provider-write-blocked">Reconnect {provider?.accountLabel ?? sourceLabels[draft.source]} before creating or updating this automation.</p>}

        <footer className="builder-actions">
          <button className="secondary-button" type="button" onClick={onClose} data-testid="automation-builder-cancel">Cancel</button>
          <button className="primary-button" type="submit" disabled={!providerReady} data-testid="automation-builder-submit">{editing ? 'Save automation' : 'Create automation'}</button>
        </footer>
        </fieldset>
      </form>
    </FocusDialog>
  );
}

function AutomationRuleRow({ rule, onSelect, onToggle, onPreview, onEdit, onDelete, canMutate, canWrite }: {
  rule: RhythmAutomation;
  onSelect(): void;
  onToggle(enabled: boolean): void;
  onPreview(): void;
  onEdit(): void;
  onDelete(): void;
  canMutate: boolean;
  canWrite: boolean;
}) {
  const labelId = useId();
  return (
    <section className="automation-rule" data-testid={`automation-rule-${rule.id}`}>
      <button className="rule-select" type="button" onClick={onSelect} data-testid={`automation-select-${rule.id}`}>
        <span className="rule-title-line"><strong>{rule.name}</strong><span className={`rule-status ${rule.enabled ? 'active' : ''}`}>{rule.enabled ? 'Enabled' : 'Paused'}</span></span>
        <small>{rule.triggerLabel} → {rule.actionLabel}</small>
        <em>{rule.accountLabel}</em>
      </button>
      <div className="rule-actions">
        <label className="automation-toggle">
          <span className="sr-only" id={labelId}>{rule.enabled ? 'Disable' : 'Enable'} {rule.name}</span>
          <input type="checkbox" disabled={!canWrite} checked={rule.enabled} aria-labelledby={labelId} onChange={(event) => onToggle(event.target.checked)} data-testid={`automation-toggle-${rule.id}`} />
        </label>
        <button className="secondary-button" type="button" disabled={!canWrite} onClick={onEdit} data-testid={`automation-edit-${rule.id}`}>Edit</button>
        <button className="icon-button danger-control" type="button" disabled={!canMutate} aria-label={`Delete ${rule.name}`} onClick={onDelete} data-testid={`automation-delete-${rule.id}`}><Icon name="delete" size={15} /></button>
      </div>
      <button className="rule-inspect" type="button" onClick={onPreview} data-testid={`automation-preview-${rule.id}`}><Icon name="search" size={14} />Preview history</button>
    </section>
  );
}

export function AutomationsScreen() {
  const { automations: gateway } = useRhythmDomainGateway();
  const host = useRhythmHost();
  const [surfaceState, setSurfaceState] = useState<SurfaceState>('loading');
  const [rules, setRules] = useState<RhythmAutomation[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RhythmAutomation | null>(null);
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RhythmAutomation | null>(null);
  const [catalogStatus, setCatalogStatus] = useState('');
  const [catalog, setCatalog] = useState<AutomationCatalog>(fallbackCatalog);
  const [fetchedPreview, setFetchedPreview] = useState<{ id: string; summary: string; matchedAt: string | null; matchCount: number } | null>(null);
  const [resyncStatus, setResyncStatus] = useState('');
  const [mutationPending, setMutationPending] = useState(false);
  const canMutate = host.currentUser.capabilities?.includes('automations.write') ?? false;

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    setSurfaceState('loading');
    try {
      const loaded = await gateway.list();
      setRules(loaded);
      setSurfaceState(loaded.length ? 'ready' : 'empty');
    } catch (error) {
      handleError(error);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [gateway]);
  useEffect(() => {
    if (!gateway.catalog) return;
    let active = true;
    void gateway.catalog().then((loaded) => { if (active) { setCatalog(loaded); setCatalogStatus(loaded.providers.some((provider) => provider.status === 'stale') ? 'A provider catalog is stale; reconnect or resync before changing dependent rules.' : ''); } }).catch(() => { if (active) setCatalogStatus('Catalog unavailable. Existing rules remain available to inspect.'); });
    return () => { active = false; };
  }, [gateway]);

  const showsRules = surfaceState === 'ready';
  const groupedRules = sourceOrder.map((source) => ({ source, rules: rules.filter((rule) => rule.source === source) })).filter((group) => group.rules.length);
  const enabledCount = rules.filter((rule) => rule.enabled).length;
  const inspectorRule = rules.find((rule) => rule.id === selectedRuleId) ?? null;
  const previewRule = rules.find((rule) => rule.id === previewRuleId) ?? null;
  const providerReady = (source: AutomationSource) => {
    const provider = catalog.providers.find((item) => item.source === source);
    return !provider || provider.status === 'connected';
  };

  const openBuilder = (rule: RhythmAutomation | null = null) => {
    setEditingRule(rule);
    setBuilderOpen(true);
  };
  const closeBuilder = () => {
    setBuilderOpen(false);
    setEditingRule(null);
  };

  const submitBuilder = async (draft: BuilderDraft) => {
    if (!canMutate || !providerReady(draft.source)) return;
    const name = draft.name.trim() || suggestedName(draft.source);
    const triggerLabel = (catalog.triggers[draft.source] ?? triggerCatalog[draft.source]).find((trigger) => trigger.key === draft.triggerKey)?.label ?? '';
    const actionLabel = (catalog.actions.length ? catalog.actions : actionCatalog).find((action) => action.type === draft.actionType)?.label ?? '';
    setMutationPending(true);
    try {
      if (editingRule) {
        const updated = await gateway.update(editingRule.id, { name, source: draft.source, sourceAccountId: draft.sourceAccountId, triggerKey: draft.triggerKey, triggerLabel, actionType: draft.actionType, actionLabel, actionConfig: draft.actionConfig, enabled: editingRule.enabled, conditions: draft.conditions });
        setRules((current) => current.map((rule) => (rule.id === updated.id ? updated : rule)));
      } else {
        const created = await gateway.create({ name, source: draft.source, sourceAccountId: draft.sourceAccountId, triggerKey: draft.triggerKey, triggerLabel, actionType: draft.actionType, actionLabel, actionConfig: draft.actionConfig, conditions: draft.conditions, enabled: true });
        setRules((current) => [...current, created]);
        setSelectedRuleId(created.id);
      }
      closeBuilder();
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const toggleRule = async (rule: RhythmAutomation, enabled: boolean) => {
    if (!canMutate || !providerReady(rule.source)) return;
    setMutationPending(true);
    try {
      const updated = await gateway.update(rule.id, { enabled });
      setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (!canMutate) return;
    setMutationPending(true);
    try {
      await gateway.delete(deleteTarget.id);
      setRules((current) => current.filter((rule) => rule.id !== deleteTarget.id));
      if (selectedRuleId === deleteTarget.id) setSelectedRuleId(null);
      setDeleteTarget(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const openPreview = (rule: RhythmAutomation) => {
    setPreviewRuleId(rule.id);
    setFetchedPreview(null);
    if (!gateway.preview) return;
    void gateway.preview(rule.id).then((preview) => setFetchedPreview({ id: rule.id, summary: preview.summary, matchedAt: preview.matchedAt, matchCount: preview.matchCount })).catch(() => setFetchedPreview({ id: rule.id, summary: 'Preview could not be refreshed. Historical details remain available.', matchedAt: rule.lastMatchedAt, matchCount: rule.matchCountLastRun }));
  };

  const resyncRule = async (rule: RhythmAutomation) => {
    if (!canMutate || !gateway.resync) return;
    setResyncStatus(`Resyncing ${rule.name}…`);
    try {
      const updated = await gateway.resync(rule.id);
      setRules((current) => current.map((item) => item.id === updated.id ? updated : item));
      setResyncStatus(`${rule.name} resynced. ${updated.matchCountLastRun} matched last run.`);
    } catch {
      setResyncStatus(`${rule.name} could not resync. Reconnect its provider and retry.`);
    }
  };

  return (
    <ScreenRoot screenName="Automations" testId="rhythm-automations-screen">
      <section className="page-shell pg-automations" aria-busy={surfaceState === 'loading'}>
        <header className="automations-header">
          <div className="automations-heading"><h1>Automations</h1><p>Create and inspect rules that turn incoming signals into tasks, schedules, or notifications.</p></div>
        </header>
        {catalogStatus && <p role="status" data-testid="automation-catalog-status">{catalogStatus}</p>}
        {!canMutate && <p role="status" data-testid="automations-read-only">You can inspect automations, but this account cannot create, edit, pause, or delete rules.</p>}

        {!showsRules && <StatePanel state={surfaceState} onRetry={() => void load()} onCreate={() => openBuilder()} />}

        {showsRules && (
          <>
            <section className="automations-overview" aria-label="Automation summary">
              <dl>
                <div><dt>Rules</dt><dd data-testid="automations-rule-count">{rules.length}</dd></div>
                <div><dt>Enabled</dt><dd data-testid="automations-enabled-count">{enabledCount}</dd></div>
              </dl>
              <button className="primary-button" type="button" onClick={() => openBuilder()} disabled={mutationPending || !canMutate} data-testid="automations-new"><Icon name="plus" size={15} />New automation</button>
            </section>

            <div className="automation-workspace" aria-label="Automation rules and inspector">
              <div className="automation-groups" tabIndex={0} aria-label="Automation rule groups">
                {groupedRules.map((group) => (
                  <section className="automation-group" key={group.source} data-testid={`automation-group-${group.source}`} aria-labelledby={`automation-group-${group.source}-title`}>
                    <header><h2 id={`automation-group-${group.source}-title`}>{sourceLabels[group.source]}</h2><span>{group.rules.length} {group.rules.length === 1 ? 'rule' : 'rules'}</span></header>
                    <div className="automation-rule-list">
                      {group.rules.map((rule) => (
                        <AutomationRuleRow
                          key={rule.id}
                          rule={rule}
                          onSelect={() => setSelectedRuleId(rule.id)}
                          onToggle={(enabled) => void toggleRule(rule, enabled)}
                          onPreview={() => openPreview(rule)}
                          onEdit={() => openBuilder(rule)}
                          onDelete={() => setDeleteTarget(rule)}
                          canMutate={canMutate}
                          canWrite={canMutate && providerReady(rule.source)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <aside className="automation-inspector" aria-label="Automation inspector" data-testid="automation-inspector">
                {inspectorRule ? (
                  <div className="automation-inspector-content">
                    <header><span>{sourceLabels[inspectorRule.source]}</span><h2>{inspectorRule.name}</h2><p>{inspectorRule.previewSummary}</p></header>
                    <dl>
                      <div><dt>Status</dt><dd>{inspectorRule.enabled ? 'Enabled' : 'Paused'}</dd></div>
                      <div><dt>Account</dt><dd>{inspectorRule.accountLabel}</dd></div>
                      <div><dt>Trigger</dt><dd>{inspectorRule.triggerLabel}</dd></div>
                      <div><dt>Action</dt><dd>{inspectorRule.actionLabel}</dd></div>
                      <div><dt>Conditions</dt><dd>{inspectorRule.conditions.length || 'None'}</dd></div>
                      <div><dt>Matches last run</dt><dd>{inspectorRule.matchCountLastRun}</dd></div>
                      <div><dt>Last matched</dt><dd>{dateTimeLabel(inspectorRule.lastMatchedAt)}</dd></div>
                    </dl>
                    {catalog.providers.find((provider) => provider.source === inspectorRule.source)?.status === 'stale' && <p role="alert" data-testid="automation-provider-stale">This provider is stale. Reconnect it before depending on new matches.</p>}
                    {gateway.resync && <button className="secondary-button" type="button" disabled={!canMutate || mutationPending} onClick={() => void resyncRule(inspectorRule)} data-testid="automation-resync">Resync rule</button>}
                    {resyncStatus && <p role="status" aria-live="polite" data-testid="automation-resync-status">{resyncStatus}</p>}
                  </div>
                ) : (
                  <div className="automation-inspector-empty"><strong>Select an automation</strong><p>Choose a rule to inspect its trigger, action, account, and latest match evidence.</p></div>
                )}
              </aside>
            </div>
          </>
        )}
      </section>

      <BuilderDialog open={builderOpen} editing={editingRule} catalog={catalog} canMutate={canMutate} onClose={closeBuilder} onSubmit={(draft) => void submitBuilder(draft)} />

      <FocusDialog open={Boolean(previewRule)} onClose={() => setPreviewRuleId(null)} title={previewRule?.name ?? 'Automation preview'} description="Historical rule metadata. Preview does not execute this automation." testId="automation-preview-dialog" wide>
        {previewRule && (
          <div className="automation-preview">
            <div className="preview-path"><span>{sourceLabels[previewRule.source]}</span><Icon name="chevronRight" size={15} /><strong>{previewRule.actionLabel}</strong></div>
            <p className="preview-summary" data-testid="automation-preview-summary">{fetchedPreview?.id === previewRule.id ? fetchedPreview.summary : previewRule.previewSummary}</p>
            <dl>
              <div><dt>Matches last run</dt><dd>{fetchedPreview?.id === previewRule.id ? fetchedPreview.matchCount : previewRule.matchCountLastRun} {(fetchedPreview?.id === previewRule.id ? fetchedPreview.matchCount : previewRule.matchCountLastRun) === 1 ? 'match' : 'matches'} last run</dd></div>
              <div><dt>Last matched</dt><dd>{dateTimeLabel(fetchedPreview?.id === previewRule.id ? fetchedPreview.matchedAt : previewRule.lastMatchedAt)}</dd></div>
            </dl>
            <div className="preview-actions"><button className="primary-button" type="button" data-autofocus onClick={() => setPreviewRuleId(null)} data-testid="automation-preview-close">Close preview</button></div>
          </div>
        )}
      </FocusDialog>

      <FocusDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete automation?'} description="This removes the rule from this workspace. This cannot be undone." testId="automation-delete-dialog">
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)} data-testid="automation-delete-cancel">Cancel</button>
          <button className="danger-button" type="button" disabled={mutationPending} onClick={() => void confirmDelete()} data-testid="automation-delete-confirm">Delete automation</button>
        </div>
      </FocusDialog>
    </ScreenRoot>
  );
}
