import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { Timestamp } from '../../components/Timestamp';
import { ListInspector, useSelectedId, type ListInspectorItem } from '../../components/ListInspector';
import { navigate } from '../../components/Shell';
import { Icon } from '../../icons';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import type { IntegrationAccount } from '../../gateway/integrations';
import {
  AutomationsGatewayError,
  type AutomationActionCatalogItem,
  type AutomationActionType,
  type AutomationProviderCatalogItem,
  type AutomationRule as ServerAutomationRule,
  type AutomationsGateway,
  type AutomationTriggerCatalogItem,
  type AutomationTriggerKey,
  type ConditionOperator,
  type CreateAutomationInput,
} from '../../gateway/automations';
import {
  accounts,
  actionCatalog,
  allowedActions,
  automationIdForName,
  cloneSeededAutomationRules,
  conditionFields,
  initialAutomationReceipts,
  sourceLabels,
  sourceOrder,
  triggerCatalog,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule as FixtureAutomationRule,
  type AutomationSource,
} from './fixtures';
import './styles.css';

type TriggerOption = { key: string; label: string };
type ActionOption = { type: string; label: string };
type AccountOption = { id: string; label: string };
type AutomationRule = FixtureAutomationRule & { canonical?: ServerAutomationRule };

function stripSourcePrefix(triggerKey: string) {
  return triggerKey.replace(/^[a-z_]+\./, '');
}

// Phase 10 / post-m1-p10-c1a: the surface state vocabulary is exactly these seven literals. Bounded
// dependency detail (empty catalog, a rule referencing a stale trigger, a provider needing
// reconnect) is real information *within* ready/readonly, never a route-state literal of its own —
// see DependencyDetail below.
type SurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';

const supportedStates: SurfaceState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];
const stateLabels: Record<SurfaceState, string> = {
  ready: 'Ready', loading: 'Loading', empty: 'Empty', 'server-error': 'Server error', forbidden: 'Forbidden', unavailable: 'Unavailable',
  readonly: 'Read-only',
};

// Bounded dependency detail rendered while the page is otherwise ready/readonly. Live mode derives
// this from the real catalog/rule responses (see liveDependencyDetail below); fixture mode exposes
// the same three scenarios through a separate `?dependency=` param so demos never masquerade as an
// invented route state.
type DependencyDetail = 'none' | 'catalog-empty' | 'invalid-config' | 'provider-error';
const supportedDependencyDetails: DependencyDetail[] = ['none', 'catalog-empty', 'invalid-config', 'provider-error'];

function hashParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function initialSurfaceState(): SurfaceState {
  const value = hashParams().get('state');
  return supportedStates.includes(value as SurfaceState) ? value as SurfaceState : 'ready';
}

function initialDependencyDetail(): DependencyDetail {
  const value = hashParams().get('dependency');
  return supportedDependencyDetails.includes(value as DependencyDetail) ? value as DependencyDetail : 'none';
}

function ruleIdFromRoute(route: string) {
  const match = route.match(/^\/automations\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function writeState(route: string, state: SurfaceState) {
  const params = hashParams();
  params.set('state', state);
  history.replaceState(null, '', `#${route}?${params.toString()}`);
}

function dateTimeLabel(value: string | null) {
  return value ? <Timestamp value={value} /> : 'Never';
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
  accountId: string;
  triggerKey: string;
  pcoTriggerKeys: string[];
  actionType: AutomationAction;
  titleTemplate: string;
  messageTemplate: string;
  templateName: string;
  facilityId: string;
  gmailLabel: string;
  tag: string;
  notes: string;
  targetDay: string;
  conditions: AutomationCondition[];
}

// Fixture-mode builder options come straight from fixtures.ts (unchanged behavior). Live mode
// supplies its own catalog (below), sourced from GET /automation-catalog/* so the builder can
// never offer an invalid trigger/action literal to submit.
interface AutomationCatalog {
  triggers: Record<AutomationSource, TriggerOption[]>;
  actionsFor(source: AutomationSource): ActionOption[];
  accounts: Partial<Record<Exclude<AutomationSource, 'rhythm'>, AccountOption[]>>;
}
const fixtureCatalog: AutomationCatalog = { triggers: triggerCatalog, actionsFor: allowedActions, accounts: Object.fromEntries(Object.entries(accounts).map(([source, account]) => [source, [account]])) };

// Maps the server's canonical AutomationRule (apps/api_server/src/models/automation_rule.ts:45-63)
// onto this page's display view-model. Labels come from the loaded catalogs so the UI never
// re-derives them from invalid local literals.
function mapServerRuleToView(rule: ServerAutomationRule, triggers: AutomationTriggerCatalogItem[], actions: AutomationActionCatalogItem[], providers: AutomationProviderCatalogItem[]): AutomationRule {
  const triggerLabel = triggers.find((item) => item.key === rule.triggerKey)?.label ?? rule.triggerKey;
  const actionLabel = actions.find((item) => item.key === rule.actionType)?.label ?? rule.actionType;
  const providerLabel = providers.find((item) => item.source === rule.source)?.label ?? sourceLabels[rule.source];
  return {
    canonical: rule,
    id: rule.id, name: rule.name, source: rule.source, accountId: rule.sourceAccountId,
    accountLabel: rule.sourceAccountId ?? providerLabel,
    triggerKey: rule.triggerKey, triggerLabel,
    actionType: rule.actionType as AutomationAction, actionLabel,
    enabled: rule.enabled, createdAt: rule.createdAt,
    lastMatchedAt: rule.lastMatchedAt, lastEvaluatedAt: rule.lastEvaluatedAt, matchCountLastRun: rule.matchCountLastRun,
    previewSummary: `When ${triggerLabel}, ${actionLabel.toLocaleLowerCase()}.`,
    previewSample: rule.previewSample ? JSON.stringify(rule.previewSample) : null,
    conditions: (rule.conditions ?? []).map((condition) => ({ field: condition.field, operator: condition.operator, value: condition.value })),
    actionConfig: Object.fromEntries(Object.entries(rule.actionConfig ?? {}).map(([key, value]) => [key, String(value)])),
  };
}

function draftForRule(rule: AutomationRule | null, catalog: AutomationCatalog = fixtureCatalog): BuilderDraft {
  const source = rule?.source ?? 'rhythm';
  return {
    name: rule?.name ?? '', source, accountId: rule?.accountId ?? '', triggerKey: rule?.triggerKey ?? catalog.triggers[source][0]?.key ?? '',
    pcoTriggerKeys: rule?.source === 'planning_center' ? [rule.triggerKey] : catalog.triggers.planning_center[0] ? [catalog.triggers.planning_center[0].key] : [],
    actionType: (rule?.actionType ?? catalog.actionsFor(source)[0]?.type ?? 'create_task') as AutomationAction, titleTemplate: rule?.actionConfig.titleTemplate ?? '',
    messageTemplate: rule?.actionConfig.messageTemplate ?? '', templateName: rule?.actionConfig.templateName ?? '',
    facilityId: rule?.actionConfig.facilityId ?? '', gmailLabel: String(rule?.canonical?.triggerConfig?.label ?? 'any'),
    tag: rule?.actionConfig.tag ?? '', notes: rule?.actionConfig.notes ?? '', targetDay: rule?.actionConfig.targetDay ?? '', conditions: structuredClone(rule?.conditions ?? []),
  };
}

function BuilderDialog({ open, editing, onClose, onSubmit, catalog = fixtureCatalog }: { open: boolean; editing: AutomationRule | null; onClose(): void; onSubmit(draft: BuilderDraft): void; catalog?: AutomationCatalog }) {
  const [draft, setDraft] = useState<BuilderDraft>(() => draftForRule(editing, catalog));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(draftForRule(editing, catalog));
    setError('');
  }, [editing, open, catalog]);

  const updateSource = (source: AutomationSource) => {
    const accountId = source === 'rhythm' ? '' : catalog.accounts[source]?.[0]?.id ?? '';
    setDraft((current) => ({ ...current, source, accountId, triggerKey: catalog.triggers[source][0]?.key ?? '', actionType: (catalog.actionsFor(source)[0]?.type ?? 'create_task') as AutomationAction }));
    setError('');
  };
  const set = <K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const addCondition = () => setDraft((current) => ({ ...current, conditions: [...current.conditions, { field: conditionFields[current.source][0], operator: 'equals', value: '' }] }));
  const setCondition = (index: number, patch: Partial<AutomationCondition>) => setDraft((current) => ({ ...current, conditions: current.conditions.map((condition, conditionIndex) => conditionIndex === index ? { ...condition, ...patch } : condition) }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.actionType === 'create_project_from_template' && !draft.templateName.trim()) { setError('Choose a project template name before creating this automation.'); return; }
    if (draft.actionType === 'send_notification' && !draft.messageTemplate.trim()) { setError('Enter a message template before creating this automation.'); return; }
    if (draft.actionType === 'create_reservation' && !draft.facilityId) { setError('Pick a room before creating this reservation automation.'); return; }
    onSubmit({ ...draft, conditions: draft.conditions.filter((condition) => condition.value.trim()) });
  };
  const actions = catalog.actionsFor(draft.source);
  const reviewName = draft.name.trim() || suggestedName(draft.source);

  return <FocusDialog open={open} onClose={onClose} title={editing ? 'Edit automation' : 'New automation'} description="Choose a source signal, narrow it if needed, then decide what Rhythm should do." testId="automations-builder-dialog" wide>
    <form className="automation-builder" onSubmit={submit}>
      {error && <div className="automation-form-error" role="alert" data-testid="automation-builder-error">{error}</div>}
      <section className="builder-section" aria-labelledby="automation-source-heading"><header><span>1</span><div><h3 id="automation-source-heading">Source</h3><p>Where the signal begins.</p></div></header><div className="builder-grid">
        <label className="automation-field span-2">Automation name <span>Optional</span><input data-autofocus value={draft.name} onChange={(event) => set('name', event.target.value)} placeholder={suggestedName(draft.source)} data-testid="automation-name" /></label>
        <label className="automation-field">Provider<select value={draft.source} onChange={(event) => updateSource(event.target.value as AutomationSource)} data-testid="automation-source">{sourceOrder.map((source) => <option value={source} key={source}>{sourceLabels[source]}</option>)}</select></label>
        <label className="automation-field">Account<select value={draft.accountId} disabled={draft.source === 'rhythm'} onChange={(event) => set('accountId', event.target.value)} data-testid="automation-account"><option value="">{draft.source === 'rhythm' ? 'Internal Rhythm' : 'Choose account'}</option>{(catalog.accounts[draft.source as Exclude<AutomationSource, 'rhythm'>] ?? []).map((account) => <option value={account.id} key={account.id}>{account.label}</option>)}</select></label>
      </div></section>
      <section className="builder-section" aria-labelledby="automation-trigger-heading"><header><span>2</span><div><h3 id="automation-trigger-heading">Trigger</h3><p>The catalog event that starts this rule.</p></div></header>
        {draft.source === 'planning_center' ? <fieldset className="trigger-grid"><legend>Planning Center triggers</legend>{catalog.triggers.planning_center.map((trigger) => { const slug = stripSourcePrefix(trigger.key).replaceAll('_', '-'); return <label key={trigger.key}><input type="checkbox" checked={draft.pcoTriggerKeys.includes(trigger.key)} onChange={(event) => set('pcoTriggerKeys', event.target.checked ? [...draft.pcoTriggerKeys, trigger.key] : draft.pcoTriggerKeys.filter((key) => key !== trigger.key))} data-testid={`automation-trigger-pco-${slug}`} />{trigger.label}</label>; })}</fieldset> : <label className="automation-field">Trigger<select value={draft.triggerKey} onChange={(event) => set('triggerKey', event.target.value)} data-testid="automation-trigger">{catalog.triggers[draft.source].map((trigger) => <option value={trigger.key} key={trigger.key}>{trigger.label}</option>)}</select></label>}
        {draft.source === 'planning_center' && <div className="pco-options"><fieldset><legend>Teams</legend><label><input type="checkbox" data-testid="automation-pco-team-worship" />Worship</label><label><input type="checkbox" data-testid="automation-pco-team-production" />Production</label></fieldset><fieldset><legend>Positions</legend><label><input type="checkbox" data-testid="automation-pco-position-leader" />Leader</label><label><input type="checkbox" data-testid="automation-pco-position-operator" />Operator</label></fieldset></div>}
        {draft.source === 'gmail' && <label className="automation-field">Label<select value={draft.gmailLabel} onChange={(event) => set('gmailLabel', event.target.value)} data-testid="automation-gmail-label"><option value="any">Any label</option><option value="unread">Unread</option><option value="inbox">Inbox</option><option value="worship">Worship</option><option value="care">Pastoral care</option></select></label>}
      </section>
      <section className="builder-section" aria-labelledby="automation-conditions-heading"><header><span>3</span><div><h3 id="automation-conditions-heading">Conditions</h3><p>Optional rows with blank values are omitted.</p></div><button className="secondary-button" type="button" onClick={addCondition} data-testid="automation-add-condition"><Icon name="plus" size={14} />Add condition</button></header>
        <div className="conditions-list">{draft.conditions.map((condition, index) => <div className="condition-row" key={index}><label className="automation-field">Field<select value={condition.field} onChange={(event) => setCondition(index, { field: event.target.value })} data-testid={`automation-condition-field-${index}`}>{conditionFields[draft.source].map((field) => <option value={field} key={field}>{field}</option>)}</select></label><label className="automation-field">Operator<select value={condition.operator} onChange={(event) => setCondition(index, { operator: event.target.value })} data-testid={`automation-condition-operator-${index}`}><option value="equals">equals</option><option value="not_equals">not equals</option><option value="contains">contains</option><option value="not_contains">not contains</option><option value="greater_than">greater than</option><option value="less_than">less than</option></select></label><label className="automation-field">Value<input value={condition.value} onChange={(event) => setCondition(index, { value: event.target.value })} data-testid={`automation-condition-value-${index}`} /></label><button className="icon-button" type="button" aria-label={`Remove condition ${index + 1}`} onClick={() => set('conditions', draft.conditions.filter((_, row) => row !== index))} data-testid={`automation-condition-remove-${index}`}><Icon name="delete" size={15} /></button></div>)}</div>
      </section>
      <section className="builder-section" aria-labelledby="automation-action-heading"><header><span>4</span><div><h3 id="automation-action-heading">Action</h3><p>What Rhythm should do after a match.</p></div></header><div className="builder-grid">
        <label className="automation-field span-2">Action<select value={draft.actionType} onChange={(event) => { set('actionType', event.target.value as AutomationAction); setError(''); }} data-testid="automation-action">{actions.map((action) => <option value={action.type} key={action.type}>{action.label}</option>)}</select></label>
        {draft.actionType === 'create_project_from_template' && <label className="automation-field span-2">Project template name<select value={draft.templateName} onChange={(event) => set('templateName', event.target.value)} data-testid="automation-template-name"><option value="">Choose a template</option><option value="Sunday Service Launch">Sunday Service Launch</option><option value="Community Event">Community Event</option></select></label>}
        {draft.actionType === 'send_notification' && <label className="automation-field span-2">Message template<textarea rows={3} value={draft.messageTemplate} onChange={(event) => set('messageTemplate', event.target.value)} placeholder="Follow up with {{sender}}" data-testid="automation-message-template" /></label>}
        {draft.actionType === 'create_reservation' && <label className="automation-field span-2">Room<select value={draft.facilityId} onChange={(event) => set('facilityId', event.target.value)} data-testid="automation-facility"><option value="">Pick a room</option><option value="facility-fellowship-hall">Fellowship Hall</option><option value="facility-sanctuary">Sanctuary</option></select></label>}
        {['create_task', 'tag_task', 'auto_schedule_task', 'auto_schedule'].includes(draft.actionType) && <label className="automation-field span-2">Title template<input value={draft.titleTemplate} onChange={(event) => set('titleTemplate', event.target.value)} placeholder="Follow up: {{title}}" data-testid="automation-title-template" /></label>}
        {draft.actionType === 'tag_task' && <label className="automation-field">Tag<input value={draft.tag} onChange={(event) => set('tag', event.target.value)} data-testid="automation-tag" /></label>}
        {['auto_schedule_task', 'auto_schedule'].includes(draft.actionType) && <label className="automation-field">Target day<input value={draft.targetDay} onChange={(event) => set('targetDay', event.target.value)} placeholder="monday" data-testid="automation-target-day" /></label>}
        {draft.actionType === 'create_task' && <label className="automation-field span-2">Task notes<textarea value={draft.notes} onChange={(event) => set('notes', event.target.value)} data-testid="automation-notes" /></label>}
      </div></section>
      <section className="builder-review" aria-labelledby="automation-review-heading" data-testid="automation-review"><div><span>Review</span><h3 id="automation-review-heading">{reviewName}</h3></div><dl><div><dt>Provider</dt><dd>{sourceLabels[draft.source]}</dd></div><div><dt>Trigger</dt><dd>{draft.source === 'planning_center' ? `${Math.max(1, draft.pcoTriggerKeys.length)} selected` : catalog.triggers[draft.source].find((trigger) => trigger.key === draft.triggerKey)?.label}</dd></div><div><dt>Action</dt><dd>{actions.find((action) => action.type === draft.actionType)?.label}</dd></div></dl></section>
      <footer className="builder-actions"><button className="secondary-button" type="button" onClick={onClose} data-testid="automation-builder-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="automation-builder-submit">{editing ? 'Save automation' : 'Create automation'}</button></footer>
    </form>
  </FocusDialog>;
}

function DirectAutomationEditor({ rule, disabled, onSave, catalog = fixtureCatalog }: { rule: AutomationRule; disabled: boolean; onSave(draft: BuilderDraft): void; catalog?: AutomationCatalog }) {
  const [draft, setDraft] = useState<BuilderDraft>(() => draftForRule(rule, catalog));
  const [error, setError] = useState('');
  useEffect(() => setDraft(draftForRule(rule, catalog)), [rule, catalog]);
  const set = <K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateSource = (source: AutomationSource) => {
    setDraft((current) => ({ ...current, source, accountId: source === 'rhythm' ? '' : catalog.accounts[source]?.[0]?.id ?? '', triggerKey: catalog.triggers[source][0]?.key ?? '', pcoTriggerKeys: source === 'planning_center' ? (catalog.triggers.planning_center[0] ? [catalog.triggers.planning_center[0].key] : []) : current.pcoTriggerKeys, actionType: (catalog.actionsFor(source)[0]?.type ?? 'create_task') as AutomationAction, conditions: [] }));
    setError('');
  };
  const setCondition = (index: number, patch: Partial<AutomationCondition>) => set('conditions', draft.conditions.map((condition, itemIndex) => itemIndex === index ? { ...condition, ...patch } : condition));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.actionType === 'create_project_from_template' && !draft.templateName.trim()) return setError('Choose a project template name.');
    if (draft.actionType === 'send_notification' && !draft.messageTemplate.trim()) return setError('Enter a message template.');
    if (draft.actionType === 'create_reservation' && !draft.facilityId) return setError('Choose a room.');
    setError('');
    onSave({ ...draft, conditions: draft.conditions.filter((condition) => condition.value.trim()) });
  };
  return <form className="automation-builder automation-direct-editor" onSubmit={submit} data-testid="automation-direct-editor">
    <fieldset disabled={disabled} aria-describedby={disabled ? 'automations-readonly-reason' : undefined}><legend className="sr-only">Automation details</legend>
      {error && <div className="automation-form-error" role="alert">{error}</div>}
      <div className="builder-grid">
        <label className="automation-field span-2">Automation name<input value={draft.name} onChange={(event) => set('name', event.target.value)} data-testid="automation-name" /></label>
        <label className="automation-field">Provider<select value={draft.source} onChange={(event) => updateSource(event.target.value as AutomationSource)} data-testid="automation-source">{sourceOrder.map((source) => <option value={source} key={source}>{sourceLabels[source]}</option>)}</select></label>
        <label className="automation-field">Account<select value={draft.accountId} disabled={draft.source === 'rhythm'} onChange={(event) => set('accountId', event.target.value)} data-testid="automation-account"><option value="">{draft.source === 'rhythm' ? 'Internal Rhythm' : 'Choose account'}</option>{(catalog.accounts[draft.source as Exclude<AutomationSource, 'rhythm'>] ?? []).map((account) => <option value={account.id} key={account.id}>{account.label}</option>)}</select></label>
      </div>
      <section className="builder-section" aria-labelledby="automation-direct-trigger"><header><div><h3 id="automation-direct-trigger">Trigger</h3><p>Signal that starts this rule.</p></div></header>
        {draft.source === 'planning_center' ? <fieldset className="trigger-grid"><legend>Planning Center triggers</legend>{catalog.triggers.planning_center.map((trigger) => <label key={trigger.key}><input type="checkbox" checked={draft.pcoTriggerKeys.includes(trigger.key)} onChange={(event) => set('pcoTriggerKeys', event.target.checked ? [...draft.pcoTriggerKeys, trigger.key] : draft.pcoTriggerKeys.filter((key) => key !== trigger.key))} />{trigger.label}</label>)}</fieldset> : <label className="automation-field">Trigger<select value={draft.triggerKey} onChange={(event) => set('triggerKey', event.target.value)} data-testid="automation-trigger">{catalog.triggers[draft.source].map((trigger) => <option value={trigger.key} key={trigger.key}>{trigger.label}</option>)}</select></label>}
        {draft.source === 'gmail' && <label className="automation-field">Label<select value={draft.gmailLabel} onChange={(event) => set('gmailLabel', event.target.value)} data-testid="automation-gmail-label"><option value="any">Any label</option><option value="unread">Unread</option><option value="inbox">Inbox</option><option value="worship">Worship</option><option value="care">Pastoral care</option></select></label>}
      </section>
      <section className="builder-section" aria-labelledby="automation-direct-conditions"><header><div><h3 id="automation-direct-conditions">Conditions</h3><p>Blank rows are omitted on save.</p></div><button className="secondary-button" type="button" onClick={() => set('conditions', [...draft.conditions, { field: conditionFields[draft.source][0], operator: 'equals', value: '' }])} data-testid="automation-add-condition">Add condition</button></header><div className="conditions-list">{draft.conditions.map((condition, index) => <div className="condition-row" key={index}><label className="automation-field">Field<select value={condition.field} onChange={(event) => setCondition(index, { field: event.target.value })}>{conditionFields[draft.source].map((field) => <option value={field} key={field}>{field}</option>)}</select></label><label className="automation-field">Operator<select value={condition.operator} onChange={(event) => setCondition(index, { operator: event.target.value })}><option value="equals">equals</option><option value="not_equals">not equals</option><option value="contains">contains</option><option value="not_contains">not contains</option></select></label><label className="automation-field">Value<input value={condition.value} onChange={(event) => setCondition(index, { value: event.target.value })} data-testid={`automation-condition-value-${index}`} /></label><button className="icon-button" type="button" aria-label={`Remove condition ${index + 1}`} onClick={() => set('conditions', draft.conditions.filter((_, itemIndex) => itemIndex !== index))}><Icon name="delete" size={15} /></button></div>)}</div></section>
      <section className="builder-section" aria-labelledby="automation-direct-action"><header><div><h3 id="automation-direct-action">Action</h3><p>What Rhythm does after a match.</p></div></header><div className="builder-grid"><label className="automation-field span-2">Action<select value={draft.actionType} onChange={(event) => { set('actionType', event.target.value as AutomationAction); setError(''); }} data-testid="automation-action">{catalog.actionsFor(draft.source).map((action) => <option value={action.type} key={action.type}>{action.label}</option>)}</select></label>{draft.actionType === 'create_project_from_template' && <label className="automation-field span-2">Project template<select value={draft.templateName} onChange={(event) => set('templateName', event.target.value)} data-testid="automation-template-name"><option value="">Choose a template</option><option value="Sunday Service Launch">Sunday Service Launch</option><option value="Community Event">Community Event</option></select></label>}{draft.actionType === 'send_notification' && <label className="automation-field span-2">Message template<textarea rows={3} value={draft.messageTemplate} onChange={(event) => set('messageTemplate', event.target.value)} data-testid="automation-message-template" /></label>}{draft.actionType === 'create_reservation' && <label className="automation-field span-2">Room<select value={draft.facilityId} onChange={(event) => set('facilityId', event.target.value)} data-testid="automation-facility"><option value="">Choose a room</option><option value="facility-fellowship-hall">Fellowship Hall</option><option value="facility-sanctuary">Sanctuary</option></select></label>}{['create_task', 'tag_task', 'auto_schedule_task', 'auto_schedule'].includes(draft.actionType) && <label className="automation-field span-2">Title template<input value={draft.titleTemplate} onChange={(event) => set('titleTemplate', event.target.value)} data-testid="automation-title-template" /></label>}{draft.actionType === 'tag_task' && <label className="automation-field">Tag<input value={draft.tag} onChange={(event) => set('tag', event.target.value)} data-testid="automation-tag" /></label>}{['auto_schedule_task', 'auto_schedule'].includes(draft.actionType) && <label className="automation-field">Target day<input value={draft.targetDay} onChange={(event) => set('targetDay', event.target.value)} data-testid="automation-target-day" /></label>}{draft.actionType === 'create_task' && <label className="automation-field span-2">Task notes<textarea value={draft.notes} onChange={(event) => set('notes', event.target.value)} data-testid="automation-notes" /></label>}</div></section>
      <footer className="builder-actions"><button className="primary-button" type="submit" data-testid="automation-builder-submit">Save automation</button></footer>
    </fieldset>
  </form>;
}

function PreviewDialog({ rule, open, onClose }: { rule: AutomationRule | null; open: boolean; onClose(): void }) {
  return <FocusDialog open={open && Boolean(rule)} onClose={onClose} title={rule?.name ?? 'Automation preview'} description="Historical rule metadata and the latest stored sample. Preview does not execute this automation." testId="automation-preview-dialog" wide>
    {rule && <div className="automation-preview"><div className="preview-path"><span>{sourceLabels[rule.source]}</span><Icon name="chevronRight" size={15} /><strong>{rule.actionLabel}</strong></div><p className="preview-summary">{rule.previewSummary}</p><dl><div><dt>Matches last run</dt><dd>{rule.matchCountLastRun} {rule.matchCountLastRun === 1 ? 'match' : 'matches'} last run</dd></div><div><dt>Last matched</dt><dd>{dateTimeLabel(rule.lastMatchedAt)}</dd></div><div><dt>Last evaluated</dt><dd>{dateTimeLabel(rule.lastEvaluatedAt)}</dd></div></dl>{rule.previewSample && <section className="preview-sample" aria-labelledby="preview-sample-title"><span id="preview-sample-title">Latest sample</span><p>{rule.previewSample}</p></section>}<div className="preview-actions"><button className="primary-button" type="button" data-autofocus onClick={onClose} data-testid="automation-preview-close">Close preview</button></div></div>}
  </FocusDialog>;
}

export function AutomationsPage({ route }: { route: string }) {
  const { notify } = useFixtures();
  const rendererGateway = useGateway();
  const isLive = rendererGateway.mode === 'live';
  const requestedRuleId = ruleIdFromRoute(route);
  const [surfaceState, setSurfaceState] = useState<SurfaceState>(() => isLive ? 'loading' : initialSurfaceState());
  const [fixtureDependency] = useState<DependencyDetail>(() => isLive ? 'none' : initialDependencyDetail());
  // No fixture fallback in live mode: rules/receipts start empty and are only ever populated
  // from a real /automation-rules response (see loadLiveAutomations below).
  const [rules, setRules] = useState<AutomationRule[]>(() => isLive ? [] : cloneSeededAutomationRules());
  const [receipts, setReceipts] = useState<string[]>(() => isLive ? [] : [...initialAutomationReceipts]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(() => requestedRuleId);
  const [storedSelectedRuleId, setSelectedRuleId] = useSelectedId('automationId');
  const selectedRuleId = requestedRuleId ?? storedSelectedRuleId;
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const [resyncResults, setResyncResults] = useState<Record<string, string>>({});
  const [liveTriggers, setLiveTriggers] = useState<AutomationTriggerCatalogItem[]>([]);
  const [liveActions, setLiveActions] = useState<AutomationActionCatalogItem[]>([]);
  const [liveProviders, setLiveProviders] = useState<AutomationProviderCatalogItem[]>([]);
  const [liveAccounts, setLiveAccounts] = useState<IntegrationAccount[]>([]);
  const [mutationPending, setMutationPending] = useState(false);
  // The renderer gateway (useGateway()) is composed once in main.tsx and shares one bearer across
  // every domain (apps/web/src/gateway/index.ts:87-106) — this page only ever reads
  // rendererGateway.domains.automations, never constructs its own instance or token.
  const liveGateway = rendererGateway.domains.automations ?? null;

  const liveCatalog = useMemo<AutomationCatalog>(() => {
    const triggersBySource: Record<AutomationSource, TriggerOption[]> = { rhythm: [], planning_center: [], google_calendar: [], gmail: [] };
    liveTriggers.forEach((trigger) => { triggersBySource[trigger.source].push({ key: trigger.key, label: trigger.label }); });
    sourceOrder.forEach((source) => { if (!triggersBySource[source].length) triggersBySource[source] = [{ key: '', label: 'No triggers available' }]; });
    const accountOptions = Object.fromEntries(sourceOrder.filter((source) => source !== 'rhythm').map((source) => [source, liveAccounts.filter((account) => account.provider === source).map((account) => ({ id: account.id, label: account.accountLabel ?? account.email ?? account.displayName ?? account.providerDisplayName }))]));
    return { triggers: triggersBySource, actionsFor: () => liveActions.map((action) => ({ type: action.key, label: action.label })), accounts: accountOptions };
  }, [liveTriggers, liveActions, liveAccounts]);
  const activeCatalog = isLive ? liveCatalog : fixtureCatalog;

  const selectedRule = rules.find((rule) => rule.id === previewRuleId) ?? null;
  const inspectorRule = rules.find((rule) => rule.id === selectedRuleId) ?? null;
  const requestedRuleExists = !requestedRuleId || rules.some((rule) => rule.id === requestedRuleId);
  const isReadonly = surfaceState === 'readonly';
  const showsRules = ['ready', 'readonly'].includes(surfaceState);
  // Real, live-derived dependency detail (post-m1-p10-c5g): an empty catalog or a rule whose stored
  // triggerKey is absent from the loaded live catalog is bounded detail on an otherwise-ready page,
  // never a fixture toggle. There is no live signal for provider connection health on this page yet
  // (AutomationProviderCatalogItem carries no status field), so live mode never reports
  // 'provider-error' here — ponytail: add when the catalog gains a real status field.
  const liveCatalogEmpty = isLive && liveTriggers.length === 0 && liveActions.length === 0 && liveProviders.length === 0;
  const liveInvalidConfigRule = isLive && liveTriggers.length > 0 ? rules.find((rule) => !liveTriggers.some((trigger) => trigger.key === rule.triggerKey)) : undefined;
  const dependencyDetail: DependencyDetail = isLive
    ? (liveCatalogEmpty ? 'catalog-empty' : liveInvalidConfigRule ? 'invalid-config' : 'none')
    : fixtureDependency;
  const groupedRules = useMemo(() => sourceOrder.map((source) => ({ source, rules: rules.filter((rule) => rule.source === source) })).filter((group) => group.rules.length), [rules]);
  const listItems = useMemo<ListInspectorItem[]>(() => rules.map((rule) => ({
    id: `automation-rule-${rule.id}`,
    title: rule.name,
    subtitle: sourceLabels[rule.source],
    meta: rule.triggerLabel,
    badge: rule.enabled ? 'Enabled' : 'Paused',
    group: rule.source,
  })), [rules]);
  const listGroups = useMemo(() => groupedRules.map((group) => ({ id: group.source, label: sourceLabels[group.source] })), [groupedRules]);
  const enabledCount = rules.filter((rule) => rule.enabled).length;

  const appendReceipt = (receipt: string) => setReceipts((current) => [...current, receipt]);

  const recordAutomationsError = (method: string, path: string, error: unknown) => {
    const status = error instanceof AutomationsGatewayError ? error.status : 0;
    appendReceipt(`${method} ${path} → ${status || 'network error'}`);
    setSurfaceState(status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'unavailable' : 'server-error');
  };

  const loadLiveAutomations = async (gateway: AutomationsGateway) => {
    setSurfaceState('loading');
    try {
      const [triggers, actionsList, providers, serverRules, integrationAccounts] = await Promise.all([gateway.triggers(), gateway.actions(), gateway.providers(), gateway.rules(), rendererGateway.domains.integrations?.accounts() ?? []]);
      setLiveTriggers(triggers); setLiveActions(actionsList); setLiveProviders(providers);
      setLiveAccounts(integrationAccounts);
      appendReceipt('GET /automation-catalog/triggers → 200');
      appendReceipt('GET /automation-catalog/actions → 200');
      appendReceipt('GET /automation-catalog/providers → 200');
      appendReceipt('GET /automation-rules → 200');
      setRules(serverRules.map((rule) => mapServerRuleToView(rule, triggers, actionsList, providers)));
      setSurfaceState(serverRules.length ? 'ready' : 'empty');
    } catch (error) { recordAutomationsError('GET', '/automation-rules', error); }
  };

  useEffect(() => {
    if (!isLive) return;
    if (!liveGateway) { setSurfaceState('unavailable'); return; }
    void loadLiveAutomations(liveGateway);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, liveGateway]);

  useEffect(() => {
    if (!requestedRuleId && storedSelectedRuleId === null && showsRules && rules[0]) setSelectedRuleId(rules[0].id);
  }, [requestedRuleId, rules, setSelectedRuleId, showsRules, storedSelectedRuleId]);

  const retryLiveLoad = () => { if (liveGateway) void loadLiveAutomations(liveGateway); };

  useEffect(() => {
    // Fixture-only: simulates the deep-linked preview receipt. Live mode's preview receipt is
    // appended by openPreview/loadLiveAutomations from a real response, never fabricated here.
    if (isLive || !requestedRuleId || !requestedRuleExists) return;
    setReceipts((current) => current.some((receipt) => receipt === `GET /automation-rules/${requestedRuleId}/preview → 200`) ? current : [...current, `GET /automation-rules/${requestedRuleId}/preview → 200`]);
  }, [isLive, requestedRuleExists, requestedRuleId]);

  const chooseState = (state: SurfaceState) => { setSurfaceState(state); writeState(route, state); };
  const openBuilder = (rule: AutomationRule | null = null) => { setEditingRule(rule); setBuilderOpen(true); if (!isLive) appendReceipt('GET /facilities → 200'); };
  const closeBuilder = () => { setBuilderOpen(false); setEditingRule(null); };
  const openPreview = (rule: AutomationRule) => {
    setSelectedRuleId(rule.id);
    setPreviewRuleId(rule.id);
    if (isLive) {
      if (!liveGateway) return;
      void liveGateway.preview(rule.id).then((preview) => {
        appendReceipt(`GET /automation-rules/${rule.id}/preview → 200`);
        setRules((current) => current.map((item) => item.id === rule.id ? {
          ...item,
          previewSample: preview.previewSample ? JSON.stringify(preview.previewSample) : item.previewSample,
          matchCountLastRun: preview.matchCountLastRun, lastMatchedAt: preview.lastMatchedAt, lastEvaluatedAt: preview.lastEvaluatedAt,
          previewSummary: preview.summary || item.previewSummary,
        } : item));
      }).catch((error) => recordAutomationsError('GET', `/automation-rules/${rule.id}/preview`, error));
      return;
    }
    appendReceipt(`GET /automation-rules/${rule.id}/preview → 200`);
  };
  const closePreview = () => {
    setPreviewRuleId(null);
    if (requestedRuleId) {
      const params = hashParams();
      params.set('automationId', requestedRuleId);
      navigate(`/automations?${params.toString()}`);
    }
  };

  // Canonical literal sets used below for live create/update payloads:
  // source/triggerKey — apps/api_server/src/models/automation_rule.ts:23-43;
  // actionType — apps/api_server/src/models/automation_rule.ts:15-21;
  // sourceAccountId/conditions — apps/api_server/src/models/automation_rule.ts:65-76.
  const liveAutomationPayload = (draft: BuilderDraft, triggerKey: string, original?: ServerAutomationRule): CreateAutomationInput => {
    const actionEdits = Object.fromEntries(Object.entries({ titleTemplate: draft.titleTemplate, messageTemplate: draft.messageTemplate, templateName: draft.templateName, facilityId: draft.facilityId, tag: draft.tag, notes: draft.notes, targetDay: draft.targetDay })
      .filter(([key, value]) => !original || value !== String(original.actionConfig?.[key] ?? '')));
    return {
      name: draft.name.trim() || suggestedName(draft.source),
      source: draft.source,
      triggerKey: triggerKey as AutomationTriggerKey,
      actionType: draft.actionType as AutomationActionType,
      sourceAccountId: draft.accountId || null,
      enabled: original?.enabled ?? true,
      triggerConfig: draft.source === 'gmail' ? { ...original?.triggerConfig, label: draft.gmailLabel } : original?.triggerConfig ?? undefined,
      conditions: original && JSON.stringify(draft.conditions) === JSON.stringify(original.conditions ?? []) ? original.conditions : draft.conditions.length ? draft.conditions.map((condition) => ({ field: condition.field, operator: condition.operator as ConditionOperator, value: condition.value })) : null,
      // Keep canonical values (including unexposed/nested fields); only replace edited inputs.
      actionConfig: Object.keys(actionEdits).length ? { ...original?.actionConfig, ...actionEdits } : original?.actionConfig ?? undefined,
    };
  };

  const submitBuilder = async (draft: BuilderDraft) => {
    const triggerKey = draft.source === 'planning_center' ? draft.pcoTriggerKeys[0] ?? activeCatalog.triggers.planning_center[0]?.key ?? draft.triggerKey : draft.triggerKey;
    if (isLive) {
      if (!liveGateway) return;
      setMutationPending(true);
      const payload = liveAutomationPayload(draft, triggerKey, editingRule?.canonical);
      try {
        if (editingRule) {
          const updated = await liveGateway.update(editingRule.id, payload);
          setRules((current) => current.map((rule) => rule.id === editingRule.id ? mapServerRuleToView(updated, liveTriggers, liveActions, liveProviders) : rule));
          appendReceipt(`PATCH /automation-rules/${editingRule.id} {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,conditions} → 200`);
          notify(`${payload.name} saved`);
        } else {
          const created = await liveGateway.create(payload);
          setRules((current) => [...current, mapServerRuleToView(created, liveTriggers, liveActions, liveProviders)]);
          setSelectedRuleId(created.id);
          appendReceipt('POST /automation-rules {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,enabled,conditions} → 201');
          notify(`${payload.name} created`);
        }
        closeBuilder();
      } catch (error) { recordAutomationsError(editingRule ? 'PATCH' : 'POST', editingRule ? `/automation-rules/${editingRule.id}` : '/automation-rules', error); }
      finally { setMutationPending(false); }
      return;
    }
    const name = draft.name.trim() || suggestedName(draft.source);
    const triggerLabel = triggerCatalog[draft.source].find((trigger) => trigger.key === triggerKey)?.label ?? triggerCatalog[draft.source][0].label;
    const actionLabel = actionCatalog.find((action) => action.type === draft.actionType)?.label ?? 'Create task';
    const actionConfig = { titleTemplate: draft.titleTemplate, messageTemplate: draft.messageTemplate, templateName: draft.templateName, facilityId: draft.facilityId };
    if (editingRule) {
      setRules((current) => current.map((rule) => rule.id === editingRule.id ? { ...rule, name, source: draft.source, accountId: draft.accountId || null, accountLabel: draft.source === 'rhythm' ? 'Internal Rhythm rules' : accounts[draft.source].label, triggerKey, triggerLabel, actionType: draft.actionType, actionLabel, conditions: draft.conditions, actionConfig } : rule));
      appendReceipt(`PATCH /automation-rules/${editingRule.id} {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,conditions} → 200`);
      notify(`${name} saved`);
    } else {
      const id = automationIdForName(name);
      const created: AutomationRule = { id, name, source: draft.source, accountId: draft.accountId || null, accountLabel: draft.source === 'rhythm' ? 'Internal Rhythm rules' : accounts[draft.source].label, triggerKey, triggerLabel, actionType: draft.actionType, actionLabel, enabled: true, createdAt: '2026-08-12T15:48:00-07:00', lastMatchedAt: null, lastEvaluatedAt: null, matchCountLastRun: 0, previewSummary: `When ${triggerLabel}, ${actionLabel.toLocaleLowerCase()}.`, previewSample: null, conditions: draft.conditions, actionConfig };
      setRules((current) => [...current, created]);
      setSelectedRuleId(id);
      appendReceipt('POST /automation-rules {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,enabled,conditions} → 201');
      notify(`${name} created`);
    }
    closeBuilder();
  };

  const saveInspector = async (draft: BuilderDraft) => {
    if (!inspectorRule || isReadonly) return;
    const triggerKey = draft.source === 'planning_center' ? draft.pcoTriggerKeys[0] ?? activeCatalog.triggers.planning_center[0]?.key ?? draft.triggerKey : draft.triggerKey;
    if (isLive) {
      if (!liveGateway) return;
      setMutationPending(true);
      const payload = liveAutomationPayload(draft, triggerKey, inspectorRule.canonical);
      try {
        const updated = await liveGateway.update(inspectorRule.id, payload);
        setRules((current) => current.map((rule) => rule.id === inspectorRule.id ? mapServerRuleToView(updated, liveTriggers, liveActions, liveProviders) : rule));
        appendReceipt(`PATCH /automation-rules/${inspectorRule.id} {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,conditions} → 200`);
        notify(`${payload.name} saved`);
      } catch (error) { recordAutomationsError('PATCH', `/automation-rules/${inspectorRule.id}`, error); }
      finally { setMutationPending(false); }
      return;
    }
    const name = draft.name.trim() || suggestedName(draft.source);
    const triggerLabel = triggerCatalog[draft.source].find((trigger) => trigger.key === triggerKey)?.label ?? triggerCatalog[draft.source][0].label;
    const actionLabel = actionCatalog.find((action) => action.type === draft.actionType)?.label ?? 'Create task';
    const actionConfig = { titleTemplate: draft.titleTemplate, messageTemplate: draft.messageTemplate, templateName: draft.templateName, facilityId: draft.facilityId };
    setRules((current) => current.map((rule) => rule.id === inspectorRule.id ? { ...rule, name, source: draft.source, accountId: draft.accountId || null, accountLabel: draft.source === 'rhythm' ? 'Internal Rhythm rules' : accounts[draft.source].label, triggerKey, triggerLabel, actionType: draft.actionType, actionLabel, conditions: draft.conditions, actionConfig } : rule));
    appendReceipt(`PATCH /automation-rules/${inspectorRule.id} {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,conditions} → 200`);
    notify(`${name} saved`);
  };

  const toggleRule = async (rule: AutomationRule, enabled: boolean) => {
    if (isLive) {
      if (!liveGateway) return;
      setMutationPending(true);
      try {
        const updated = await liveGateway.update(rule.id, { enabled });
        setRules((current) => current.map((item) => item.id === rule.id ? mapServerRuleToView(updated, liveTriggers, liveActions, liveProviders) : item));
        appendReceipt(`PATCH /automation-rules/${rule.id} {enabled} → 200`);
        notify(`${rule.name} ${enabled ? 'enabled' : 'paused'}`);
      } catch (error) { recordAutomationsError('PATCH', `/automation-rules/${rule.id}`, error); }
      finally { setMutationPending(false); }
      return;
    }
    setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled } : item));
    appendReceipt(`PATCH /automation-rules/${rule.id} {enabled} → 200`);
    notify(`${rule.name} ${enabled ? 'enabled' : 'paused'}`);
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (isLive) {
      if (!liveGateway) return;
      setMutationPending(true);
      try {
        await liveGateway.delete(deleteTarget.id);
        setRules((current) => current.filter((rule) => rule.id !== deleteTarget.id));
        appendReceipt(`DELETE /automation-rules/${deleteTarget.id} → 204`);
        notify(`${deleteTarget.name} deleted`);
        setDeleteTarget(null);
      } catch (error) { recordAutomationsError('DELETE', `/automation-rules/${deleteTarget.id}`, error); }
      finally { setMutationPending(false); }
      return;
    }
    setRules((current) => current.filter((rule) => rule.id !== deleteTarget.id));
    appendReceipt(`DELETE /automation-rules/${deleteTarget.id} → 204`);
    notify(`${deleteTarget.name} deleted`);
    setDeleteTarget(null);
  };
  const resyncRule = (rule: AutomationRule) => {
    setResyncingId(rule.id);
    setResyncResults((current) => ({ ...current, [rule.id]: '' }));
    if (isLive) {
      if (!liveGateway) { setResyncingId(null); return; }
      void liveGateway.resync(rule.id)
        .then(() => liveGateway.detail(rule.id))
        .then((detail) => {
          appendReceipt(`POST /automation-rules/${rule.id}/resync → 200`);
          const mapped = mapServerRuleToView(detail, liveTriggers, liveActions, liveProviders);
          setRules((current) => current.map((item) => item.id === rule.id ? mapped : item));
          setResyncResults((current) => ({ ...current, [rule.id]: `${mapped.matchCountLastRun} matched last run` }));
          setResyncingId(null);
          notify(`${rule.name} resynced`);
        })
        .catch((error) => { recordAutomationsError('POST', `/automation-rules/${rule.id}/resync`, error); setResyncingId(null); });
      return;
    }
    window.setTimeout(() => {
      appendReceipt(`POST /automation-rules/${rule.id}/resync → 200`);
      setReceipts((current) => [...current, ...initialAutomationReceipts]);
      setResyncResults((current) => ({ ...current, [rule.id]: '2 matched · 1 action executed' }));
      setResyncingId(null);
      notify(`${rule.name} resynced`);
    }, 180);
  };

  const listError = surfaceState === 'server-error'
    ? <div className="automations-list-state danger" data-testid="page-state-server-error"><strong>503 · Automations could not be loaded</strong><p>The automation service returned a temporary error. Existing rules remain unchanged.</p><button className="primary-button" type="button" onClick={() => { if (isLive) retryLiveLoad(); else chooseState('ready'); }} data-testid="page-retry"><Icon name="refresh" size={15} />Retry</button></div>
    : surfaceState === 'forbidden'
      ? <div className="automations-list-state warning" data-testid="page-state-forbidden"><strong>403 · Workspace access required</strong><p>Ask a workspace owner to grant access to owned automation rules. Restricted rules are not exposed or changed here.</p></div>
      : surfaceState === 'unavailable'
        ? <div className="automations-list-state warning" data-testid="page-state-unavailable"><strong>Automations are unavailable</strong><p>Reconnect the local Rhythm API before rules can be loaded or changed.</p></div>
        : undefined;
  const selectedItemId = showsRules && selectedRuleId ? `automation-rule-${selectedRuleId}` : null;

  return <section className="page-shell pg-automations" data-testid="page-automations" aria-labelledby="automations-title" aria-busy={surfaceState === 'loading'} {...(selectedRuleId ? { 'data-selected-stable-id': selectedRuleId } : {})}>
    <header className="automations-header"><div className="automations-heading"><div className="automations-mark" aria-hidden="true"><Icon name="spark" size={22} /></div><div><h1 id="automations-title">Automations</h1><p>Create and inspect rules that turn incoming signals into tasks, schedules, or notifications.</p></div></div><div className="automations-header-controls"><label className="automations-state-picker">View state<select value={surfaceState} onChange={(event) => chooseState(event.target.value as SurfaceState)} data-testid="automations-state-select">{supportedStates.map((state) => <option value={state} key={state}>{stateLabels[state]}</option>)}</select></label></div></header>

    {surfaceState === 'readonly' && <div className="automations-banner" role="status" id="automations-readonly-reason" data-testid="page-state-readonly"><Icon name="review" size={16} /><span><strong>Workspace is read-only.</strong> Rules and historical previews remain available; creating, editing, running, toggling, and deleting are disabled.</span></div>}

    <section className="automations-overview" aria-label="Automation summary"><dl><div><dt>Rules</dt><dd data-testid="automations-rule-count">{showsRules ? rules.length : 0}</dd></div><div><dt>Enabled</dt><dd data-testid="automations-enabled-count">{showsRules ? enabledCount : 0}</dd></div></dl></section>

    {showsRules && dependencyDetail === 'catalog-empty' && <div className="automations-dependency" role="alert" id="automations-catalog-reason" data-testid="automations-catalog-empty"><Icon name="background" size={17} /><span><strong>The automation catalog is unavailable.</strong> Existing rules remain inspectable, but a trigger and action catalog is required to create another.</span></div>}
    {showsRules && dependencyDetail === 'invalid-config' && <div className="automations-dependency" role="alert" id="automations-invalid-reason" data-testid="automation-invalid-config"><Icon name="background" size={17} /><span><strong>One rule references a trigger that is no longer in the provider catalog.</strong> Edit the rule to choose a supported trigger before running it.</span><button className="secondary-button" type="button" disabled data-testid="automation-invalid-run">Run unavailable</button><button className="secondary-button" type="button" disabled={isReadonly} onClick={() => openBuilder(liveInvalidConfigRule ?? rules[0])} data-testid="automation-invalid-edit">Edit rule</button></div>}
    {showsRules && dependencyDetail === 'provider-error' && <div className="automations-dependency" role="alert" id="automations-provider-reason" data-testid="automation-provider-error"><Icon name="background" size={17} /><span><strong>Google Calendar needs attention.</strong> Reconnect the provider before its rules can resync.</span><button className="secondary-button" type="button" disabled aria-describedby="automations-provider-reason" data-testid="automation-provider-resync">Resync unavailable</button><button className="text-button" type="button" onClick={() => navigate('/integrations')} data-testid="automations-open-integrations">Open Integrations</button></div>}

    <main className="automation-workspace" aria-label="Automation rules and inspector" data-testid={surfaceState === 'loading' ? 'page-state-loading' : undefined}>
      <ListInspector
        label="Automation rules"
        items={showsRules ? listItems : []}
        groups={showsRules ? listGroups : []}
        selectedId={selectedItemId}
        onSelect={(itemId) => {
          const ruleId = itemId.replace(/^automation-rule-/, '');
          if (!requestedRuleId) { setSelectedRuleId(ruleId); return; }
          const params = hashParams();
          params.set('automationId', ruleId);
          navigate(`/automations?${params.toString()}`);
        }}
        toolbar={<button className="primary-button" type="button" onClick={() => openBuilder()} disabled={isReadonly || dependencyDetail === 'catalog-empty' || surfaceState === 'loading' || Boolean(listError)} aria-describedby={dependencyDetail === 'catalog-empty' ? 'automations-catalog-reason' : isReadonly ? 'automations-readonly-reason' : undefined} data-testid={surfaceState === 'empty' ? 'automations-empty-create' : 'automations-new'}><Icon name="plus" size={15} />New automation</button>}
        searchable={showsRules}
        searchPlaceholder="Search automation rules"
        loading={surfaceState === 'loading'}
        error={listError}
        emptyState={<div className="automations-list-state" data-testid="page-state-empty"><strong>No automations yet</strong><p>Turn a repeated handoff into a dependable Rhythm rule.</p></div>}
        listFooter={showsRules ? <span>{rules.length} {rules.length === 1 ? 'rule' : 'rules'} · {enabledCount} enabled</span> : undefined}
        inspector={(item) => {
          const rule = item ? rules.find((candidate) => `automation-rule-${candidate.id}` === item.id) ?? null : null;
          if (!rule) return <div className="automation-inspector-empty"><strong>Select an automation</strong><p>Choose a rule to inspect its trigger, action, account, and latest match evidence.</p></div>;
          const isResyncing = resyncingId === rule.id;
          const providerBlocked = dependencyDetail === 'provider-error' && rule.source === 'google_calendar';
          const triggerInvalid = isLive && liveTriggers.length > 0 && !liveTriggers.some((trigger) => trigger.key === rule.triggerKey);
          const resyncBlocked = providerBlocked || triggerInvalid;
          return <div className="automation-inspector-content" data-testid="automation-inspector">
            <p className="automation-inspector-summary">{rule.previewSummary}</p>
            <dl><div><dt>Status</dt><dd>{rule.enabled ? 'Enabled' : 'Paused'}</dd></div><div><dt>Account</dt><dd>{rule.accountLabel}</dd></div><div><dt>Trigger</dt><dd>{rule.triggerLabel}</dd></div><div><dt>Action</dt><dd>{rule.actionLabel}</dd></div><div><dt>Conditions</dt><dd>{rule.conditions.length ? rule.conditions.map((condition) => `${condition.field} ${condition.operator.replaceAll('_', ' ')} ${condition.value}`).join(' · ') : 'None'}</dd></div><div><dt>Matches last run</dt><dd>{rule.matchCountLastRun}</dd></div><div><dt>Last matched</dt><dd>{dateTimeLabel(rule.lastMatchedAt)}</dd></div><div><dt>Last evaluated</dt><dd>{dateTimeLabel(rule.lastEvaluatedAt)}</dd></div></dl>
            {rule.previewSample && <section className="automation-inspector-sample"><span>Latest sample</span><p>{rule.previewSample}</p></section>}
            <div className="automation-inspector-actions">
              <fieldset disabled={isReadonly || mutationPending} aria-disabled={isReadonly ? 'true' : undefined} aria-describedby={isReadonly ? 'automations-readonly-reason' : undefined} data-testid="automations-mutations"><legend className="sr-only">Automation actions</legend>
                <button className="secondary-button" type="button" onClick={() => openBuilder(rule)} data-testid={`automation-edit-${rule.id}`}><Icon name="rename" size={14} />Edit</button>
                <label className="automation-toggle"><span className="sr-only">{rule.enabled ? 'Pause' : 'Enable'} {rule.name}</span><input type="checkbox" checked={rule.enabled} onChange={(event) => { void toggleRule(rule, event.target.checked); }} data-testid={`automation-enabled-${rule.id}`} /></label>
                <button className="secondary-button" type="button" onClick={() => resyncRule(rule)} disabled={isResyncing || resyncBlocked} aria-describedby={providerBlocked ? 'automations-provider-reason' : triggerInvalid ? 'automations-invalid-reason' : undefined} data-testid={`automation-resync-${rule.id}`}>{isResyncing ? <Icon name="refresh" className="spin" size={14} /> : <Icon name={rule.source === 'rhythm' ? 'resume' : 'refresh'} size={14} />}{rule.source === 'rhythm' ? 'Trigger' : 'Resync'}</button>
                <button className="secondary-button danger-control" type="button" onClick={() => setDeleteTarget(rule)} data-testid={`automation-delete-${rule.id}`}><Icon name="delete" size={15} />Delete</button>
              </fieldset>
              <button className="secondary-button" type="button" onClick={() => openPreview(rule)} data-testid={`automation-inspect-${rule.id}`}><Icon name="search" size={14} />Preview history</button>
            </div>
            {isResyncing && <div className="rule-progress" role="status" aria-live="polite" data-testid={`automation-resync-progress-${rule.id}`}><span />Refreshing provider signals and automation catalogs…</div>}
            {resyncResults[rule.id] && <div className="rule-result" role="status" aria-live="polite" data-testid={`automation-resync-result-${rule.id}`}><Icon name="check" size={14} />{resyncResults[rule.id]}</div>}
            <DirectAutomationEditor rule={rule} disabled={isReadonly || mutationPending} onSave={saveInspector} catalog={activeCatalog} />
          </div>;
        }}
      />
    </main>
    <aside className="page-trace" aria-label="Automation endpoint receipts" tabIndex={0} data-testid="page-trace"><span>Endpoint ledger</span><ol>{receipts.map((receipt, index) => <li key={`${receipt}-${index}`}>{receipt}</li>)}</ol></aside>

    <BuilderDialog open={builderOpen} editing={editingRule} onClose={closeBuilder} onSubmit={(draft) => { void submitBuilder(draft); }} catalog={activeCatalog} />
    <PreviewDialog rule={selectedRule} open={Boolean(selectedRule) && requestedRuleExists} onClose={closePreview} />
    <FocusDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete automation?'} description={deleteTarget ? `This removes “${deleteTarget.name}” from this workspace. This action cannot be undone.` : undefined} testId="automation-delete-dialog"><div className="delete-confirm-copy"><p>The rule will stop responding to future signals. Its historical preview is not an execution log.</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)} data-testid="automation-delete-cancel">Cancel</button><button className="danger-button" type="button" disabled={mutationPending} onClick={() => { void confirmDelete(); }} data-testid="automation-delete-confirm">Delete automation</button></div></div></FocusDialog>
  </section>;
}
