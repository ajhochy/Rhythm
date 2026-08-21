import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FocusDialog } from '../../components/FocusDialog';
import { navigate } from '../../components/Shell';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import {
  createFixtureRhythmsGateway,
  RhythmsGatewayError,
  type RhythmRule as GatewayRhythmRule,
} from '../../gateway/rhythms';
import {
  cloneSeededRhythms,
  currentRhythmUserId,
  initialRhythmReceipts,
  rhythmWorkspaceMembers,
  type RhythmFrequency,
  type RhythmRule,
  type RhythmStep,
} from './fixtures';
import './styles.css';

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Canonical shape: RecurringTaskRule apps/api_server/src/models/recurring_task_rule.ts:29-44;
// steps apps/api_server/src/models/recurring_task_rule.ts:1-9; progress :18-27. ownerName/full
// person identity is not part of this response, so we show the numeric owner id rather than
// inventing a display name.
function mapGatewayRule(rule: GatewayRhythmRule): RhythmRule {
  return {
    id: rule.id,
    title: rule.title,
    frequency: rule.frequency,
    dayOfWeek: rule.dayOfWeek ?? 0,
    dayOfMonth: rule.dayOfMonth ?? 1,
    month: rule.month ?? 1,
    sequential: rule.sequential,
    enabled: rule.enabled,
    ownerId: rule.ownerId != null ? String(rule.ownerId) : '',
    ownerName: rule.ownerId != null ? `Member #${rule.ownerId}` : 'Unassigned',
    collaborators: rule.collaborators.map((person) => ({ id: String(person.userId), name: person.name, initials: initialsOf(person.name) })),
    steps: rule.steps.map((step) => ({
      id: step.id,
      title: step.title,
      assigneeId: step.assigneeId != null ? String(step.assigneeId) : '',
      dayOfWeek: step.dayOfWeek ?? rule.dayOfWeek ?? 0,
      dayOfMonth: step.dayOfMonth ?? rule.dayOfMonth ?? 1,
      month: step.month ?? rule.month ?? 1,
    })),
    generatedCount: rule.progress?.totalCount ?? 0,
    completedCount: rule.progress?.completedCount ?? 0,
    remainingCount: rule.progress?.remainingCount ?? 0,
    waitingOn: rule.progress?.waitingOnUserName ?? null,
    nextDueDate: rule.progress?.nextDueDate ?? null,
    completionRatio: rule.progress?.completionRatio ?? 0,
    createdAt: rule.createdAt,
  };
}

type RhythmsSurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type RuleDraft = Pick<RhythmRule, 'title' | 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'month' | 'sequential' | 'steps'>;

const supportedStates: RhythmsSurfaceState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function InspectorPortal({ selector, children }: { selector: string; children: ReactNode }) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => { setTarget(document.querySelector(selector)); }, [selector]);
  return target ? createPortal(children, target) : null;
}

function hashParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function initialSurfaceState(): RhythmsSurfaceState {
  const state = hashParams().get('state');
  return supportedStates.includes(state as RhythmsSurfaceState) ? state as RhythmsSurfaceState : 'ready';
}

function routeSelection(route: string) {
  const editorForm = route.match(/^\/rhythms\/rule\/([^/]+)(?:\/edit)?$/);
  if (editorForm) return decodeURIComponent(editorForm[1]);
  // Bare deep link: /rhythms/<ruleId> — same canonical RecurringTaskRule.id
  // (apps/api_server/src/models/recurring_task_rule.ts:29-30) as the /rhythms/rule/<id> editor
  // route above, just without the "/rule/" segment (post-m1-p3-c3c deep-link shape).
  const directForm = route.match(/^\/rhythms\/([^/]+)$/);
  return directForm ? decodeURIComponent(directForm[1]) : null;
}

function ordinal(day: number) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  return `${day}${day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'}`;
}

function patternDescription(rule: Pick<RhythmRule, 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'month'>) {
  if (rule.frequency === 'weekly') return `Every ${weekdays[rule.dayOfWeek] ?? 'Monday'}`;
  if (rule.frequency === 'monthly') return `Monthly on the ${ordinal(rule.dayOfMonth || 1)}`;
  return `Every ${months[(rule.month || 1) - 1] ?? 'January'} ${ordinal(rule.dayOfMonth || 1)}`;
}

function dateDescription(value: string | null) {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date(`${value}T12:00:00-07:00`));
}

function blankDraft(): RuleDraft {
  return { title: '', frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, month: 1, sequential: false, steps: [] };
}

function cloneDraft(rule: RhythmRule): RuleDraft {
  return structuredClone({ title: rule.title, frequency: rule.frequency, dayOfWeek: rule.dayOfWeek, dayOfMonth: rule.dayOfMonth, month: rule.month, sequential: rule.sequential, steps: rule.steps });
}

function deterministicRuleId(title: string) {
  const slug = title.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 52);
  return `rhythm-${slug || 'created-rule'}`;
}

function StatePanel({ state, onRetry, onCreate }: { state: Exclude<RhythmsSurfaceState, 'ready' | 'readonly' | 'forbidden'>; onRetry(): void; onCreate(): void }) {
  if (state === 'loading') return <section className="rhythms-state" role="status" aria-live="polite" aria-busy="true" data-testid="page-state-loading"><span className="rhythms-state-mark" aria-hidden="true">◌</span><span className="eyebrow">Recurring work</span><h2>Loading rhythms</h2><p>Gathering recurring rules and workspace members.</p><div className="rhythms-skeleton" aria-hidden="true"><span /><span /><span /></div></section>;
  if (state === 'empty') return <section className="rhythms-state" role="status" data-testid="page-state-empty"><span className="rhythms-state-mark" aria-hidden="true">＋</span><span className="eyebrow">A clear cadence</span><h2>No recurring rules yet</h2><p>Create a rhythm to generate the next useful tasks on schedule.</p><button className="primary-button" type="button" onClick={onCreate} data-testid="rhythms-empty-create">New rule</button></section>;
  if (state === 'server-error') return <section className="rhythms-state danger" role="alert" data-testid="page-state-server-error"><span className="rhythms-state-code">503</span><span className="eyebrow">Retryable server error</span><h2>Rhythms could not be loaded</h2><p>The recurring-rule service returned a temporary error. No local changes were lost.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  return <section className="rhythms-state warning" role="status" data-testid="page-state-unavailable"><span className="rhythms-state-mark" aria-hidden="true">◇</span><span className="eyebrow">Service prerequisite</span><h2>Rhythms are unavailable</h2><p>Reconnect authentication and the recurring-rule service before loading or changing rhythms.</p></section>;
}

function ScheduleFields({ prefix, suffix = '', frequency, dayOfWeek, dayOfMonth, month, onChange }: { prefix: string; suffix?: string; frequency: RhythmFrequency; dayOfWeek: number; dayOfMonth: number; month: number; onChange(patch: Partial<Pick<RuleDraft, 'dayOfWeek' | 'dayOfMonth' | 'month'>>): void }) {
  const dayOfWeekId = `${prefix}-day-of-week${suffix}`;
  const dayOfMonthId = `${prefix}-day-of-month${suffix}`;
  const monthId = `${prefix}-month${suffix}`;
  return <div className="rhythm-schedule-fields">
    {frequency === 'weekly' && <label className="field" htmlFor={dayOfWeekId}>Day of week<select id={dayOfWeekId} value={dayOfWeek} onChange={(event) => onChange({ dayOfWeek: Number(event.target.value) })} data-testid={dayOfWeekId}>{weekdays.map((weekday, index) => <option key={weekday} value={index}>{weekday}</option>)}</select></label>}
    {(frequency === 'monthly' || frequency === 'annual') && <label className="field" htmlFor={dayOfMonthId}>Day of month<input id={dayOfMonthId} type="number" min="1" max="31" required value={dayOfMonth} aria-invalid={dayOfMonth < 1 || dayOfMonth > 31 ? 'true' : undefined} onChange={(event) => onChange({ dayOfMonth: Number(event.target.value) })} data-testid={dayOfMonthId} /></label>}
    {frequency === 'annual' && <label className="field" htmlFor={monthId}>Month<select id={monthId} value={month} onChange={(event) => onChange({ month: Number(event.target.value) })} data-testid={monthId}>{months.map((monthName, index) => <option key={monthName} value={index + 1}>{monthName}</option>)}</select></label>}
  </div>;
}

function RuleForm({ mode, initial, disabled = false, describedBy, onCancel, onSave }: { mode: 'create' | 'edit'; initial: RuleDraft; disabled?: boolean; describedBy?: string; onCancel(): void; onSave(draft: RuleDraft): void }) {
  const [draft, setDraft] = useState<RuleDraft>(() => structuredClone(initial));
  const prefix = `rhythm-${mode}`;
  const titleId = `${prefix}-title`;
  const frequencyId = `${prefix}-frequency`;
  const sequentialId = `${prefix}-sequential`;
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const addStep = () => setDraft((current) => ({ ...current, steps: [...current.steps, { id: `${mode}-step-${current.steps.length + 1}`, title: '', assigneeId: '', dayOfWeek: current.dayOfWeek, dayOfMonth: current.dayOfMonth, month: current.month }] }));
  const patchStep = (index: number, patch: Partial<RhythmStep>) => setDraft((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const title = draft.title.trim();
    if (!title) return;
    onSave({ ...draft, title, steps: draft.steps.filter((step) => step.title.trim()).map((step) => ({ ...step, title: step.title.trim() })) });
  };
  return <form className="rhythm-rule-form" onSubmit={submit}>
    <fieldset className="rhythm-rule-fields" disabled={disabled} aria-describedby={disabled ? describedBy : undefined}><legend className="sr-only">{mode === 'create' ? 'New rhythm fields' : 'Rhythm details'}</legend>
    <div className="rhythm-form-grid">
      <label className="field rhythm-form-title" htmlFor={titleId}>Title<input id={titleId} data-autofocus required value={draft.title} onChange={(event) => set('title', event.target.value)} data-testid={titleId} /></label>
      <label className="field" htmlFor={frequencyId}>Frequency<select id={frequencyId} value={draft.frequency} onChange={(event) => set('frequency', event.target.value as RhythmFrequency)} data-testid={frequencyId}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
      <ScheduleFields prefix={prefix} frequency={draft.frequency} dayOfWeek={draft.dayOfWeek} dayOfMonth={draft.dayOfMonth} month={draft.month} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
    </div>
    <section className="rhythm-step-section" aria-labelledby={`${prefix}-steps-heading`}>
      <header><div><h3 id={`${prefix}-steps-heading`}>Workflow steps</h3><p>Optional task templates generated by this rhythm.</p></div><button className="secondary-button" type="button" onClick={addStep} data-testid="rhythm-add-step">Add step</button></header>
      {draft.steps.length === 0 && <p className="rhythm-step-empty">No workflow steps. The rhythm can still generate its own task.</p>}
      {draft.steps.map((step, index) => { const stepTitleId = `rhythm-step-title-${index}`; const stepAssigneeId = `rhythm-step-assignee-${index}`; return <fieldset className="rhythm-step" key={step.id}><legend>Step {index + 1}</legend><div className="rhythm-step-grid"><label className="field rhythm-step-title" htmlFor={stepTitleId}>Task title<input id={stepTitleId} value={step.title} onChange={(event) => patchStep(index, { title: event.target.value })} data-testid={stepTitleId} /></label><label className="field" htmlFor={stepAssigneeId}>Assignee<select id={stepAssigneeId} value={step.assigneeId} onChange={(event) => patchStep(index, { assigneeId: event.target.value })} data-testid={stepAssigneeId}><option value="">None</option>{rhythmWorkspaceMembers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><ScheduleFields prefix="rhythm-step" suffix={`-${index}`} frequency={draft.frequency} dayOfWeek={step.dayOfWeek} dayOfMonth={step.dayOfMonth} month={step.month} onChange={(patch) => patchStep(index, patch)} /><button className="text-danger-button" type="button" onClick={() => setDraft((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }))} data-testid={`rhythm-remove-step-${index}`}>Remove step</button></div></fieldset>; })}
      {draft.steps.length > 1 && <label className="rhythm-sequential" htmlFor={sequentialId}><input id={sequentialId} type="checkbox" checked={draft.sequential} onChange={(event) => set('sequential', event.target.checked)} data-testid={sequentialId} /><span><strong>Sequential</strong><small>Generate each step after the previous one completes.</small></span></label>}
    </section>
    <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onCancel} data-testid={`${prefix}-cancel`}>Cancel</button><button className="primary-button" type="submit" data-testid={`${prefix}-submit`}>{mode === 'create' ? 'Create rule' : 'Save rule'}</button></footer>
    </fieldset>
  </form>;
}

export function RhythmsPage({ route }: { route: string }) {
  const { notify } = useFixtures();
  const gatewayCtx = useGateway();
  const live = gatewayCtx.mode === 'live';
  const routeRuleId = routeSelection(route);
  const [surfaceState, setSurfaceState] = useState<RhythmsSurfaceState>(initialSurfaceState);
  const [rules, setRules] = useState<RhythmRule[]>(() => live ? [] : cloneSeededRhythms());
  const [selectedId, setSelectedId] = useState<string | null>(() => routeRuleId ?? (live ? null : cloneSeededRhythms()[0]?.id ?? null));
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RhythmRule | null>(null);
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [receipts, setReceipts] = useState<string[]>(() => live ? [] : surfaceState === 'server-error' ? ['GET /recurring-rules → 503'] : [...initialRhythmReceipts]);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const selected = rules.find((rule) => rule.id === selectedId) ?? null;
  const routeNotFound = Boolean(routeRuleId && !selected);
  const isReadonly = surfaceState === 'readonly';
  const showsWorkspace = surfaceState === 'ready' || surfaceState === 'readonly' || surfaceState === 'forbidden';
  const ownerOnlyReasonId = 'rhythms-owner-only-reason';
  const readonlyReasonId = 'rhythms-readonly-reason';

  // Client-side ownership is UX sugar only; the API is the real authority (rule.ownerId !== actorId
  // → 403, apps/api_server/src/controllers/recurring_rules_controller.ts:217,242). Live mode has no
  // local notion of "the signed-in user's id" without a gateway this unit cannot add, so it never
  // blocks the attempt client-side and lets a genuine 403 flip the page to the bounded "forbidden" state.
  const isOwnerOf = (ownerId: string) => live || ownerId === currentRhythmUserId;

  // apps/web/src/gateway/index.ts:98 — every domain shares the one bearer from the signed-in
  // session; Rhythms must not build its own gateway from a build-time/test-only env value.
  const rhythmsGateway = useMemo(
    () => (live ? gatewayCtx.domains.rhythms! : createFixtureRhythmsGateway()),
    [live, gatewayCtx],
  );

  const handleGatewayError = (method: string, path: string, error: unknown) => {
    const status = error instanceof RhythmsGatewayError ? error.status : 0;
    appendReceipt(`${method} ${path} → ${status || 'network error'}`);
    setSurfaceState(status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'unavailable' : 'server-error');
  };

  const loadRules = async (active: () => boolean = () => true) => {
    if (!rhythmsGateway) { setSurfaceState('unavailable'); return; }
    setSurfaceState('loading');
    try {
      // apps/api_server/src/routes/recurring_rules_routes.ts:9 GET /recurring-rules
      const loaded = await rhythmsGateway.list();
      if (!active()) return;
      const mapped = loaded.map(mapGatewayRule);
      setRules(mapped);
      appendReceipt('GET /recurring-rules → 200');
      setSurfaceState(mapped.length ? 'ready' : 'empty');
    } catch (error) {
      if (!active()) return;
      handleGatewayError('GET', '/recurring-rules', error);
    }
  };

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void loadRules(() => !cancelled);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, rhythmsGateway]);

  const writeUrl = (nextSelectedId: string | null, state = surfaceState) => {
    const path = nextSelectedId ? `/rhythms/rule/${encodeURIComponent(nextSelectedId)}` : '/rhythms';
    const params = hashParams();
    params.set('state', state);
    const query = params.toString();
    history.replaceState(null, '', `#${path}${query ? `?${query}` : ''}`);
  };
  const appendReceipt = (receipt: string) => setReceipts((current) => [...current, receipt]);
  const openCreate = () => setCreateOpen(true);
  const inspect = (rule: RhythmRule) => { setSelectedId(rule.id); writeUrl(rule.id); };
  const closeSelection = () => { setSelectedId(null); writeUrl(null); };
  const retry = () => {
    if (live) { void loadRules(); return; }
    setRules(cloneSeededRhythms()); setReceipts([...initialRhythmReceipts]); setSurfaceState('ready'); writeUrl(selectedId, 'ready'); notify('Rhythms reconnected');
  };

  // Canonical create body: CreateRecurringTaskRuleDto apps/api_server/src/models/recurring_task_rule.ts:46-57.
  // Steps replace wholesale (server assigns ids for any without one — normalizeStep in
  // apps/api_server/src/controllers/recurring_rules_controller.ts:366-399), so the per-step
  // addStep endpoint (recurring_rules_routes.ts:14) isn't separately exercised by this page.
  const scheduleFieldsFor = (frequency: RhythmFrequency, dayOfWeek: number, dayOfMonth: number, month: number) => ({
    dayOfWeek: frequency === 'weekly' ? dayOfWeek : null,
    dayOfMonth: frequency !== 'weekly' ? dayOfMonth : null,
    month: frequency === 'annual' ? month : null,
  });

  const createRule = async (draft: RuleDraft) => {
    if (live) {
      if (!rhythmsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        const created = await rhythmsGateway.create({
          title: draft.title,
          frequency: draft.frequency,
          sequential: draft.sequential,
          ...scheduleFieldsFor(draft.frequency, draft.dayOfWeek, draft.dayOfMonth, draft.month),
          steps: draft.steps.map((step) => ({
            id: '',
            title: step.title,
            assigneeId: step.assigneeId ? Number(step.assigneeId) : null,
            ...scheduleFieldsFor(draft.frequency, step.dayOfWeek, step.dayOfMonth, step.month),
          })),
        });
        const mapped = mapGatewayRule(created);
        setRules((current) => [...current, mapped]);
        setSelectedId(mapped.id); setCreateOpen(false); writeUrl(mapped.id);
        appendReceipt('POST /recurring-rules {title,frequency,dayOfWeek,dayOfMonth,month,sequential,steps} → 201');
        notify(`${mapped.title} created`);
      } catch (error) { handleGatewayError('POST', '/recurring-rules', error); } finally { setMutationPending(false); }
      return;
    }
    const id = deterministicRuleId(draft.title);
    const rule: RhythmRule = { ...draft, id, enabled: true, ownerId: currentRhythmUserId, ownerName: 'AJ Hochhalter', collaborators: [], generatedCount: draft.steps.length || 1, completedCount: 0, remainingCount: draft.steps.length || 1, waitingOn: null, nextDueDate: '2026-08-20', completionRatio: 0, createdAt: '2026-08-12T15:48:00-07:00' };
    setRules((current) => current.some((item) => item.id === id) ? current.map((item) => item.id === id ? rule : item) : [...current, rule]);
    setSelectedId(id); setCreateOpen(false); writeUrl(id);
    const scheduleKeys = draft.frequency === 'weekly' ? 'dayOfWeek' : draft.frequency === 'monthly' ? 'dayOfMonth' : 'dayOfMonth,month';
    appendReceipt(`POST /recurring-rules {title,frequency,${scheduleKeys},sequential,steps} → 201`);
    notify(`${draft.title} created`);
  };

  // Canonical update body: UpdateRecurringTaskRuleDto apps/api_server/src/models/recurring_task_rule.ts:59-70.
  const saveRule = async (draft: RuleDraft) => {
    if (!selected) return;
    if (live) {
      if (!rhythmsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        const originalStepIds = new Set(selected.steps.map((step) => step.id));
        const updated = await rhythmsGateway.update(selected.id, {
          title: draft.title,
          frequency: draft.frequency,
          sequential: draft.sequential,
          ...scheduleFieldsFor(draft.frequency, draft.dayOfWeek, draft.dayOfMonth, draft.month),
          steps: draft.steps.map((step) => ({
            id: originalStepIds.has(step.id) ? step.id : '',
            title: step.title,
            assigneeId: step.assigneeId ? Number(step.assigneeId) : null,
            ...scheduleFieldsFor(draft.frequency, step.dayOfWeek, step.dayOfMonth, step.month),
          })),
        });
        const mapped = mapGatewayRule(updated);
        setRules((current) => current.map((rule) => rule.id === mapped.id ? mapped : rule));
        appendReceipt(`PATCH /recurring-rules/${selected.id} {title,frequency,dayOfWeek,dayOfMonth,month,sequential,steps} → 200`);
        writeUrl(mapped.id); notify(`${mapped.title} updated`);
      } catch (error) { handleGatewayError('PATCH', `/recurring-rules/${selected.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setRules((current) => current.map((rule) => rule.id === selected.id ? { ...rule, ...draft, generatedCount: draft.steps.length || rule.generatedCount, remainingCount: draft.steps.length || rule.remainingCount, nextDueDate: rule.enabled ? rule.nextDueDate : null } : rule));
    const scheduleKeys = draft.frequency === 'weekly' ? 'dayOfWeek' : draft.frequency === 'monthly' ? 'dayOfMonth' : 'dayOfMonth,month';
    appendReceipt(`PATCH /recurring-rules/${selected.id} {title,frequency,${scheduleKeys},sequential,steps} → 200`);
    writeUrl(selected.id); notify(`${draft.title} updated`);
  };

  const toggleEnabled = async (rule: RhythmRule, enabled: boolean) => {
    if (!isOwnerOf(rule.ownerId) || isReadonly || mutationPending) return;
    if (live) {
      if (!rhythmsGateway) return;
      setMutationPending(true);
      try {
        const updated = await rhythmsGateway.update(rule.id, { enabled });
        setRules((current) => current.map((item) => item.id === rule.id ? mapGatewayRule(updated) : item));
        appendReceipt(`PATCH /recurring-rules/${rule.id} {enabled:${enabled}} → 200`);
        notify(enabled ? `${rule.title} enabled` : `${rule.title} paused`);
      } catch (error) { handleGatewayError('PATCH', `/recurring-rules/${rule.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled, nextDueDate: enabled ? (item.nextDueDate ?? '2026-08-16') : null } : item));
    appendReceipt(`PATCH /recurring-rules/${rule.id} {enabled:${enabled}} → 200`);
    notify(enabled ? `${rule.title} enabled` : `${rule.title} paused`);
  };

  const addCollaborator = async (personId: string) => {
    if (!selected || !isOwnerOf(selected.ownerId) || isReadonly || mutationPending) return;
    const person = rhythmWorkspaceMembers.find((member) => member.id === personId);
    if (!person) return;
    if (live) {
      if (!rhythmsGateway) return;
      setMutationPending(true);
      try {
        // apps/api_server/src/models/recurring_task_rule.ts:11-16 RhythmCollaborator { userId, name, email, photoUrl }
        const collaborators = await rhythmsGateway.addCollaborator(selected.id, Number(personId));
        setRules((current) => current.map((rule) => rule.id === selected.id ? { ...rule, collaborators: collaborators.map((c) => ({ id: String(c.userId), name: c.name, initials: initialsOf(c.name) })) } : rule));
        appendReceipt(`POST /recurring-rules/${selected.id}/collaborators {userId} → 200`);
        setCollaboratorPickerOpen(false); notify(`${person.name} added`);
      } catch (error) { handleGatewayError('POST', `/recurring-rules/${selected.id}/collaborators`, error); } finally { setMutationPending(false); }
      return;
    }
    setRules((current) => current.map((rule) => rule.id === selected.id ? { ...rule, collaborators: [...rule.collaborators, person] } : rule));
    appendReceipt(`POST /recurring-rules/${selected.id}/collaborators {userId} → 200`);
    setCollaboratorPickerOpen(false); notify(`${person.name} added`);
  };

  const removeCollaborator = async (personId: string) => {
    if (!selected || !isOwnerOf(selected.ownerId) || isReadonly || mutationPending) return;
    if (live) {
      if (!rhythmsGateway) return;
      setMutationPending(true);
      try {
        await rhythmsGateway.removeCollaborator(selected.id, Number(personId));
        setRules((current) => current.map((rule) => rule.id === selected.id ? { ...rule, collaborators: rule.collaborators.filter((person) => person.id !== personId) } : rule));
        appendReceipt(`DELETE /recurring-rules/${selected.id}/collaborators/${personId} → 204`);
        notify('Collaborator removed');
      } catch (error) { handleGatewayError('DELETE', `/recurring-rules/${selected.id}/collaborators/${personId}`, error); } finally { setMutationPending(false); }
      return;
    }
    setRules((current) => current.map((rule) => rule.id === selected.id ? { ...rule, collaborators: rule.collaborators.filter((person) => person.id !== personId) } : rule));
    appendReceipt(`DELETE /recurring-rules/${selected.id}/collaborators/${personId} → 204`);
    notify('Collaborator removed');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (live) {
      if (!rhythmsGateway || mutationPending) return;
      setMutationPending(true);
      try {
        await rhythmsGateway.delete(deleteTarget.id);
        setRules((current) => current.filter((rule) => rule.id !== deleteTarget.id));
        appendReceipt(`DELETE /recurring-rules/${deleteTarget.id} → 204`);
        if (selectedId === deleteTarget.id) { setSelectedId(null); writeUrl(null); }
        notify(`${deleteTarget.title} deleted`); setDeleteTarget(null);
      } catch (error) { handleGatewayError('DELETE', `/recurring-rules/${deleteTarget.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setRules((current) => current.filter((rule) => rule.id !== deleteTarget.id));
    appendReceipt(`DELETE /recurring-rules/${deleteTarget.id} → 204`);
    if (selectedId === deleteTarget.id) { setSelectedId(null); writeUrl(null); }
    notify(`${deleteTarget.title} deleted; generated tasks preserved`); setDeleteTarget(null);
  };

  const candidates = useMemo(() => selected ? rhythmWorkspaceMembers.filter((person) => person.id !== selected.ownerId && !selected.collaborators.some((collaborator) => collaborator.id === person.id)) : [], [selected]);
  const statePanel = !showsWorkspace ? <StatePanel state={surfaceState as Exclude<RhythmsSurfaceState, 'ready' | 'readonly' | 'forbidden'>} onRetry={retry} onCreate={openCreate} /> : null;

  return <section className="page-shell pg-rhythms" data-testid="page-rhythms" aria-labelledby="rhythms-title" {...(selectedId ? { 'data-selected-stable-id': selectedId } : {})}>
    <header className="rhythms-header"><div><span className="eyebrow">Recurring work</span><h1 id="rhythms-title">Rhythms</h1><p>Manage recurring rules, owners, generated tasks, and the next scheduled run.</p></div><fieldset className="rhythms-header-actions" disabled={isReadonly || surfaceState !== 'ready'} aria-disabled={isReadonly || surfaceState !== 'ready' ? 'true' : 'false'} data-testid="rhythms-mutations"><legend className="sr-only">Rhythm mutations</legend><button ref={createTriggerRef} className="primary-button" type="button" onClick={openCreate} aria-describedby={isReadonly ? readonlyReasonId : undefined} data-testid="rhythms-new-rule">New rule</button></fieldset></header>
    <span className="sr-only" id={ownerOnlyReasonId}>Only the rhythm owner can edit, pause, delete, or manage collaborators.</span><span className="sr-only" id={readonlyReasonId}>Make changes in the synchronized source of truth.</span>
    <main className="rhythms-main" aria-busy={surfaceState === 'loading'}>
      {surfaceState === 'forbidden' && <div className="rhythms-banner warning" role="status" data-testid="page-state-forbidden"><strong>Owner controls unavailable.</strong> Only the rhythm owner can manage collaborators. Shared rhythms are inspect-only.</div>}
      {isReadonly && <div className="rhythms-banner" role="status" data-testid="page-state-readonly"><strong>Read-only workspace.</strong> Inspect rhythms here; make changes in the synchronized source of truth.</div>}
      {statePanel}
      {showsWorkspace && <div className="rhythms-layout">
        <section className="rhythms-collection" aria-labelledby="rhythms-list-title"><header><div><span className="eyebrow">Rule collection</span><h2 id="rhythms-list-title">Recurring rules</h2></div><output aria-live="polite">{rules.length} rules</output></header><div className="rhythms-list">{rules.map((rule) => { const isOwner = isOwnerOf(rule.ownerId); const mutationsDisabled = isReadonly || !isOwner || mutationPending; return <article className={`rhythm-card ${selectedId === rule.id ? 'selected' : ''} ${rule.enabled ? '' : 'paused'}`} key={rule.id} data-testid={`rhythm-card-${rule.id}`}><div className="rhythm-progress-ring" style={{ '--rhythm-progress': `${Math.round(rule.completionRatio * 100) * 3.6}deg` } as React.CSSProperties} aria-hidden="true"><span>{Math.round(rule.completionRatio * 100)}</span></div><div className="rhythm-card-copy"><span className="eyebrow" data-testid={`rhythm-status-${rule.id}`}>{rule.enabled ? 'Enabled' : 'Paused'}</span><h3 data-testid="rhythm-title">{rule.title}</h3><p data-testid={`rhythm-pattern-${rule.id}`}>{patternDescription(rule)}</p><span className="sr-only" data-testid={`rhythm-progress-${rule.id}`}>{Math.round(rule.completionRatio * 100)}%</span></div><div className="rhythm-card-actions"><button className="secondary-button" type="button" aria-label={`Inspect ${rule.title}`} onClick={() => inspect(rule)} data-testid={`rhythm-inspect-${rule.id}`}>Inspect</button><label className="rhythm-enabled-toggle" title={!isOwner ? 'Shared rhythms are inspect-only' : isReadonly ? 'Make changes in the synchronized source of truth' : undefined}><input type="checkbox" checked={rule.enabled} disabled={mutationsDisabled} aria-label={`${rule.enabled ? 'Enabled' : 'Paused'} - ${rule.title}`} aria-describedby={!isOwner ? ownerOnlyReasonId : isReadonly ? readonlyReasonId : undefined} onChange={(event) => toggleEnabled(rule, event.target.checked)} data-testid={`rhythm-enabled-${rule.id}`} /><span aria-hidden="true" /><b>{rule.enabled ? 'Enabled' : 'Paused'}</b></label><button className="text-danger-button" type="button" disabled={mutationsDisabled} aria-label={`Delete ${rule.title}`} aria-describedby={!isOwner ? ownerOnlyReasonId : isReadonly ? readonlyReasonId : undefined} onClick={() => setDeleteTarget(rule)} data-testid={`rhythm-delete-${rule.id}`}>Delete</button></div></article>; })}</div></section>
        <aside className="rhythms-detail-column" aria-label="Selected rhythm">{routeNotFound ? <section className="rhythm-not-found" role="status" data-testid="rhythm-not-found"><span className="eyebrow">Unknown rule</span><h2>Rhythm not found</h2><p>The requested rule is not in the current collection.</p><button className="secondary-button" type="button" onClick={() => { closeSelection(); navigate('/rhythms'); }} data-testid="rhythm-not-found-back">Back to rhythms</button></section> : selected ? <section className="rhythm-detail" aria-labelledby="rhythm-detail-title" data-testid="rhythm-detail"><header><div><span className="eyebrow">{selected.enabled ? 'Enabled rhythm' : 'Paused rhythm'}</span><h2 id="rhythm-detail-title">{selected.title}</h2><p>{patternDescription(selected)}</p></div><button className="text-button" type="button" onClick={closeSelection} data-testid="rhythm-detail-close">Close</button></header><dl className="rhythm-metrics"><div><dt>Owner</dt><dd data-testid="rhythm-owner">{selected.ownerName}</dd></div><div><dt>Generated</dt><dd data-testid="rhythm-generated-count">{selected.generatedCount} generated tasks</dd></div><div><dt>Completed</dt><dd data-testid="rhythm-completed-count">{selected.completedCount} completed</dd></div><div><dt>Remaining</dt><dd data-testid="rhythm-remaining-count">{selected.remainingCount} remaining</dd></div></dl><section className="rhythm-next"><span className="eyebrow">Next due</span><strong data-testid="rhythm-next-due">{selected.enabled ? dateDescription(selected.nextDueDate) : 'Paused - no next generation'}</strong><p data-testid="rhythm-waiting-on">{selected.waitingOn ? `Waiting on ${selected.waitingOn}` : 'No person is blocking the next task'}</p></section><section className="rhythm-collaborators" aria-labelledby="rhythm-collaborators-title"><header><div><h3 id="rhythm-collaborators-title">Collaborators</h3><p>People who can inspect this rhythm.</p></div><button className="secondary-button" type="button" disabled={isReadonly || !isOwnerOf(selected.ownerId) || surfaceState === 'forbidden'} aria-describedby={!isOwnerOf(selected.ownerId) || surfaceState === 'forbidden' ? ownerOnlyReasonId : isReadonly ? readonlyReasonId : undefined} onClick={() => setCollaboratorPickerOpen(true)} data-testid="rhythm-add-collaborator">Add collaborator</button></header><div className="rhythm-people">{selected.collaborators.length ? selected.collaborators.map((person) => <div className="rhythm-person" key={person.id} data-testid={`rhythm-collaborator-${person.id}`}><span aria-hidden="true">{person.initials}</span><strong>{person.name}</strong><button type="button" disabled={isReadonly || !isOwnerOf(selected.ownerId) || surfaceState === 'forbidden'} aria-describedby={!isOwnerOf(selected.ownerId) || surfaceState === 'forbidden' ? ownerOnlyReasonId : isReadonly ? readonlyReasonId : undefined} aria-label={`Remove ${person.name}`} onClick={() => removeCollaborator(person.id)} data-testid={`rhythm-remove-collaborator-${person.id}`}>Remove</button></div>) : <p>No collaborators yet.</p>}</div></section>{selected.steps.length > 0 && <section className="rhythm-detail-steps"><h3>Workflow steps</h3><ol>{selected.steps.map((step) => <li key={step.id}><strong>{step.title}</strong><span>{rhythmWorkspaceMembers.find((person) => person.id === step.assigneeId)?.name ?? 'Unassigned'} · {patternDescription({ ...selected, ...step })}</span></li>)}</ol></section>}</section> : <section className="rhythm-detail-empty" aria-labelledby="rhythm-detail-empty-title"><span className="rhythms-state-mark" aria-hidden="true">◒</span><h2 id="rhythm-detail-empty-title">Select a rhythm</h2><p>Inspect ownership, generated work, and the next due task without leaving the collection.</p></section>}</aside>
      </div>}
    </main>
    {selected && <InspectorPortal selector="[data-testid='rhythm-detail']"><section className="rhythm-direct-editor" aria-label="Edit selected rhythm" data-testid="rhythm-direct-editor"><RuleForm key={selected.id} mode="edit" initial={cloneDraft(selected)} disabled={isReadonly || surfaceState === 'forbidden' || !isOwnerOf(selected.ownerId)} describedBy={!isOwnerOf(selected.ownerId) || surfaceState === 'forbidden' ? ownerOnlyReasonId : readonlyReasonId} onCancel={closeSelection} onSave={saveRule} /></section></InspectorPortal>}
    <section className="rhythms-trace" aria-labelledby="rhythms-trace-title"><header><span className="eyebrow" id="rhythms-trace-title">Fixture API ledger</span><strong>{receipts.length} receipts</strong></header><output aria-live="polite" data-testid="page-trace">{receipts.map((receipt, index) => <code key={`${receipt}-${index}`}>{receipt}</code>)}</output></section>
    <FocusDialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Recurring Rule" description="Create a recurring rule with optional workflow steps." testId="rhythm-create-dialog" wide><RuleForm mode="create" initial={blankDraft()} onCancel={() => setCreateOpen(false)} onSave={createRule} /></FocusDialog>
    <FocusDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={deleteTarget ? `Delete "${deleteTarget.title}"?` : 'Delete rhythm?'} description="This will not remove already-generated tasks." testId="rhythm-delete-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)} data-testid="rhythm-delete-cancel">Cancel</button><button className="danger-button" type="button" onClick={confirmDelete} data-testid="rhythm-delete-confirm">Delete rule</button></div></FocusDialog>
    <FocusDialog open={collaboratorPickerOpen && Boolean(selected)} onClose={() => setCollaboratorPickerOpen(false)} title="Add collaborator" description="Owner and existing collaborators are excluded." testId="rhythm-collaborator-picker"><div className="rhythm-candidate-list" role="listbox" aria-label="Available workspace members">{candidates.length ? candidates.map((person) => <button className="rhythm-candidate" role="option" aria-selected="false" type="button" key={person.id} onClick={() => addCollaborator(person.id)} data-testid={`rhythm-collaborator-option-${person.id}`}><span aria-hidden="true">{person.initials}</span><strong>{person.name}</strong></button>) : <p>No eligible workspace members.</p>}</div></FocusDialog>
  </section>;
}
