// Ported from apps/web/src/pages/rhythms/index.tsx (434 lines) + fixtures.ts. Carried over: the
// list/detail layout, cadence pattern description, generated/completed/remaining/waiting-on
// metrics, enable/pause toggle, delete confirmation, collaborator add/remove, and the create/edit
// rule form's conditional schedule fields (weekly day-of-week, monthly day-of-month, annual
// month+day) and workflow-step editing. Deliberately dropped at the host-neutral boundary: the
// hash-based deep-link route and "rhythm not found" panel, the fixture-only `?state=readonly`
// demo mode (no real gateway signal backs a distinct readonly state), the API-receipt ledger, and
// the detail-pane-portal indirection (this package fully owns its render tree, so the edit form
// renders inline in the detail pane instead of portaling into it). Workflow-step *removal* isn't
// carried over: RhythmsGateway only exposes addStep, matching the production step-replace-on-save
// semantics being out of scope for this narrower contract — see domain/types.ts.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRhythmDomainGateway, useRhythmHost } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { FocusDialog } from '../components/FocusDialog';
import { RhythmGatewayError, type RhythmCadence, type RhythmRhythm, type RhythmStep, type RhythmWorkspaceMember } from '../domain/types';
import type { RhythmWorkspaceOperationConfirmation } from '../host/types';

type RhythmsSurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';
type RuleDraft = { title: string; frequency: RhythmCadence; dayOfWeek: number; dayOfMonth: number; month: number; sequential: boolean; steps: Array<{ title: string; assigneeId: string }> };
type RhythmOperation = Extract<RhythmWorkspaceOperationConfirmation['operation'], `rhythms.${string}`>;
type RhythmOperationTarget = { operation: RhythmOperation; entityId: string; payload: Record<string, string | number | boolean | null | Array<Record<string, string | null>>>; generation: string; mutate(): Promise<void> };

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(day: number) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  return `${day}${day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'}`;
}

function patternDescription(rule: Pick<RhythmRhythm, 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'month'>) {
  if (rule.frequency === 'weekly') return `Every ${weekdays[rule.dayOfWeek] ?? 'Monday'}`;
  if (rule.frequency === 'monthly') return `Monthly on the ${ordinal(rule.dayOfMonth || 1)}`;
  return `Every ${months[(rule.month || 1) - 1] ?? 'January'} ${ordinal(rule.dayOfMonth || 1)}`;
}

function blankDraft(): RuleDraft {
  return { title: '', frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, month: 1, sequential: false, steps: [] };
}

function StatePanel({ state, onRetry, onCreate }: { state: Exclude<RhythmsSurfaceState, 'ready'>; onRetry(): void; onCreate(): void }) {
  if (state === 'loading') return <section className="rhythms-state" role="status" aria-live="polite" data-testid="page-state-loading"><span className="eyebrow">Recurring work</span><h2>Loading rhythms</h2><p>Gathering recurring rules and workspace members.</p><div className="rhythms-skeleton" aria-hidden="true"><span /><span /><span /></div></section>;
  if (state === 'empty') return <section className="rhythms-state" role="status" data-testid="page-state-empty"><span className="eyebrow">A clear cadence</span><h2>No recurring rules yet</h2><p>Create a rhythm to generate the next useful tasks on schedule.</p><button className="primary-button" type="button" onClick={onCreate} data-testid="rhythms-empty-create">New rule</button></section>;
  if (state === 'server_error') return <section className="rhythms-state danger" role="alert" data-testid="page-state-server-error"><span className="eyebrow">Retryable server error</span><h2>Rhythms could not be loaded</h2><p>The recurring-rule service returned a temporary error. No local changes were lost.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="rhythms-state warning" role="alert" data-testid="page-state-forbidden"><span className="eyebrow">Workspace permission required</span><h2>Rhythms access is restricted</h2><p>Ask a workspace administrator for rhythm access.</p></section>;
  return <section className="rhythms-state warning" role="status" data-testid="page-state-unavailable"><span className="eyebrow">Service prerequisite</span><h2>Rhythms are unavailable</h2><p>Reconnect the recurring-rule service before loading or changing rhythms.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

function ScheduleFields({ idPrefix, frequency, dayOfWeek, dayOfMonth, month, disabled = false, onChange }: {
  idPrefix: string; frequency: RhythmCadence; dayOfWeek: number; dayOfMonth: number; month: number; disabled?: boolean;
  onChange(patch: Partial<Pick<RuleDraft, 'dayOfWeek' | 'dayOfMonth' | 'month'>>): void;
}) {
  return (
    <div className="rhythm-schedule-fields">
      {frequency === 'weekly' && (
        <label>Day of week<select disabled={disabled} value={dayOfWeek} onChange={(event) => onChange({ dayOfWeek: Number(event.target.value) })} data-testid={`${idPrefix}-day-of-week`}>
          {weekdays.map((weekday, index) => <option key={weekday} value={index}>{weekday}</option>)}
        </select></label>
      )}
      {(frequency === 'monthly' || frequency === 'annual') && (
        <label>Day of month<input type="number" disabled={disabled} min="1" max="31" required value={dayOfMonth} onChange={(event) => onChange({ dayOfMonth: Number(event.target.value) })} data-testid={`${idPrefix}-day-of-month`} /></label>
      )}
      {frequency === 'annual' && (
        <label>Month<select disabled={disabled} value={month} onChange={(event) => onChange({ month: Number(event.target.value) })} data-testid={`${idPrefix}-month`}>
          {months.map((monthName, index) => <option key={monthName} value={index + 1}>{monthName}</option>)}
        </select></label>
      )}
    </div>
  );
}

function RuleForm({ idPrefix, initial, members, showStepsBuilder = true, disabled = false, onCancel, onSave }: {
  idPrefix: string; initial: RuleDraft; members: RhythmWorkspaceMember[]; showStepsBuilder?: boolean; disabled?: boolean; onCancel(): void; onSave(draft: RuleDraft): void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(() => structuredClone(initial));
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const addStep = () => setDraft((current) => ({ ...current, steps: [...current.steps, { title: '', assigneeId: '' }] }));
  const patchStep = (index: number, patch: Partial<{ title: string; assigneeId: string }>) =>
    setDraft((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)) }));
  const removeStep = (index: number) => setDraft((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }));
  const moveStep = (index: number, direction: -1 | 1) => setDraft((current) => {
    const destination = index + direction;
    if (destination < 0 || destination >= current.steps.length) return current;
    const steps = [...current.steps];
    [steps[index], steps[destination]] = [steps[destination]!, steps[index]!];
    return { ...current, steps };
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    onSave({ ...draft, title, steps: draft.steps.filter((step) => step.title.trim()).map((step) => ({ ...step, title: step.title.trim() })) });
  };

  return (
    <form className="rhythm-rule-form" onSubmit={submit}>
      <label>Title<input data-autofocus required disabled={disabled} value={draft.title} onChange={(event) => set('title', event.target.value)} data-testid={`${idPrefix}-title`} /></label>
      <label>Frequency<select disabled={disabled} value={draft.frequency} onChange={(event) => set('frequency', event.target.value as RhythmCadence)} data-testid={`${idPrefix}-frequency`}>
        <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="annual">Annual</option>
      </select></label>
      <ScheduleFields idPrefix={idPrefix} frequency={draft.frequency} dayOfWeek={draft.dayOfWeek} dayOfMonth={draft.dayOfMonth} month={draft.month} disabled={disabled} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
      {showStepsBuilder && (
        <section className="rhythm-step-section" aria-labelledby={`${idPrefix}-steps-heading`}>
          <header><h3 id={`${idPrefix}-steps-heading`}>Workflow steps</h3><button className="secondary-button" type="button" disabled={disabled} onClick={addStep} data-testid={`${idPrefix}-add-step`}>Add step</button></header>
          {draft.steps.length === 0 && <p className="rhythm-step-empty">No workflow steps. The rhythm can still generate its own task.</p>}
          {draft.steps.map((step, index) => (
            <fieldset className="rhythm-step" key={index}>
              <legend>Step {index + 1}</legend>
              <label>Task title<input disabled={disabled} value={step.title} onChange={(event) => patchStep(index, { title: event.target.value })} data-testid={`${idPrefix}-step-title-${index}`} /></label>
              <label>Assignee<select disabled={disabled} value={step.assigneeId} onChange={(event) => patchStep(index, { assigneeId: event.target.value })} data-testid={`${idPrefix}-step-assignee-${index}`}>
                <option value="">None</option>{members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select></label>
              <button className="text-danger-button" type="button" disabled={disabled} onClick={() => removeStep(index)} data-testid={`${idPrefix}-remove-step-${index}`}>Remove step</button>
              <button className="text-button" type="button" disabled={disabled || index === 0} onClick={() => moveStep(index, -1)} data-testid={`${idPrefix}-move-step-up-${index}`}>Move up</button>
              <button className="text-button" type="button" disabled={disabled || index === draft.steps.length - 1} onClick={() => moveStep(index, 1)} data-testid={`${idPrefix}-move-step-down-${index}`}>Move down</button>
            </fieldset>
          ))}
          {draft.steps.length > 1 && (
            <label className="rhythm-sequential"><input type="checkbox" disabled={disabled} checked={draft.sequential} onChange={(event) => set('sequential', event.target.checked)} data-testid={`${idPrefix}-sequential`} />
              <span><strong>Sequential</strong><small>Generate each step after the previous one completes.</small></span>
            </label>
          )}
        </section>
      )}
      {!showStepsBuilder && draft.steps.length > 1 && (
        <label className="rhythm-sequential"><input type="checkbox" disabled={disabled} checked={draft.sequential} onChange={(event) => set('sequential', event.target.checked)} data-testid={`${idPrefix}-sequential`} />
          <span><strong>Sequential</strong><small>Generate each step after the previous one completes.</small></span>
        </label>
      )}
      <footer className="dialog-actions">
        <button className="secondary-button" type="button" onClick={onCancel} data-testid={`${idPrefix}-cancel`}>Cancel</button>
        <button className="primary-button" type="submit" disabled={disabled} data-testid={`${idPrefix}-submit`}>{idPrefix === 'rhythm-create' ? 'Create rule' : 'Save rule'}</button>
      </footer>
    </form>
  );
}

export function RhythmsScreen() {
  const { rhythms: gateway } = useRhythmDomainGateway();
  const host = useRhythmHost();
  const capabilities = host.currentUser.capabilities ?? [];
  const can = (operation: RhythmOperation) => capabilities.includes('rhythms.write') || capabilities.includes(operation);
  const isOwner = (rule: RhythmRhythm) => Boolean(host.currentUser.id && host.currentUser.id === rule.ownerId);
  const [surfaceState, setSurfaceState] = useState<RhythmsSurfaceState>('loading');
  const [rules, setRules] = useState<RhythmRhythm[]>([]);
  const [members, setMembers] = useState<RhythmWorkspaceMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [stepTitle, setStepTitle] = useState('');
  const [stepAssignee, setStepAssignee] = useState('');
  const [mutationPending, setMutationPending] = useState(false);
  const [operationTarget, setOperationTarget] = useState<RhythmOperationTarget | null>(null);
  const [operationError, setOperationError] = useState<'conflict' | 'uncertain' | null>(null);
  const newRuleTriggerRef = useRef<HTMLButtonElement>(null);
  const loadGeneration = useRef(0);
  const operationGeneration = useRef(0);
  const operationEpoch = useRef(0);
  const mounted = useRef(true);

  const selected = rules.find((rule) => rule.id === selectedId) ?? null;

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    const generation = ++loadGeneration.current;
    setSurfaceState('loading');
    try {
      const [loadedRules, loadedMembers] = await Promise.all([gateway.list(), gateway.members()]);
      if (generation !== loadGeneration.current) return;
      setRules(loadedRules);
      setMembers(loadedMembers);
      setSurfaceState(loadedRules.length ? 'ready' : 'empty');
    } catch (error) {
      if (generation === loadGeneration.current) handleError(error);
    }
  };

  useEffect(() => { void load(); return () => { loadGeneration.current += 1; }; }, [gateway]);
  useEffect(() => () => { mounted.current = false; operationEpoch.current += 1; }, []);

  const showsWorkspace = surfaceState === 'ready';

  const closeOperation = () => { operationEpoch.current += 1; setOperationError(null); setOperationTarget(null); };
  const inspect = (rule: RhythmRhythm) => { closeOperation(); setSelectedId(rule.id); };
  const closeSelection = () => { closeOperation(); setSelectedId(null); };
  const requestOperation = (operation: RhythmOperation, entityId: string, payload: RhythmOperationTarget['payload'], mutate: RhythmOperationTarget['mutate']) => {
    if (!can(operation) || mutationPending) return;
    operationGeneration.current += 1;
    operationEpoch.current += 1;
    setOperationError(null);
    setOperationTarget({ operation, entityId, payload, mutate, generation: `${entityId}:${operation}:${operationGeneration.current}:${Date.now()}` });
  };
  const retryOperation = () => {
    if (!operationTarget || mutationPending) return;
    operationGeneration.current += 1;
    operationEpoch.current += 1;
    setOperationError(null);
    setOperationTarget((target) => target && ({ ...target, generation: `${target.entityId}:${target.operation}:${operationGeneration.current}:${Date.now()}` }));
  };
  const confirmOperation = async () => {
    if (!operationTarget || mutationPending) return;
    const target = operationTarget;
    const epoch = operationEpoch.current;
    setMutationPending(true);
    try {
      const confirmation: RhythmWorkspaceOperationConfirmation = { operation: target.operation, entityId: target.entityId, payload: target.payload, generation: target.generation };
      if (host.confirmWorkspaceOperation && !(await host.confirmWorkspaceOperation(confirmation))) return;
      if (!mounted.current || operationEpoch.current !== epoch || operationTarget !== target) return;
      await target.mutate();
      if (!mounted.current || operationEpoch.current !== epoch || operationTarget !== target) return;
      setOperationTarget(null);
    } catch (error) {
      const kind = (error as { kind?: unknown } | null)?.kind;
      if (kind === 'conflict' || kind === 'uncertain') setOperationError(kind);
      else handleError(error);
    } finally { if (mounted.current) setMutationPending(false); }
  };

  const toggleEnabled = async (rule: RhythmRhythm, enabled: boolean) => {
    if (!isOwner(rule)) return;
    requestOperation('rhythms.update-rule', rule.id, { enabled }, async () => {
      const updated = await gateway.update(rule.id, { enabled });
      setRules((current) => current.map((item) => (item.id === rule.id ? updated : item)));
    });
  };

  const createRule = async (draft: RuleDraft) => {
    const normalizedSteps = draft.steps.map((step) => ({ title: step.title.trim().slice(0, 200), assigneeId: step.assigneeId || null }));
    const input = { title: draft.title.slice(0, 200), frequency: draft.frequency, dayOfWeek: draft.dayOfWeek, dayOfMonth: draft.dayOfMonth, month: draft.month, sequential: draft.sequential, steps: normalizedSteps };
    requestOperation('rhythms.create-rule', 'new-rule', input, async () => {
      const created = await gateway.create(input);
      setRules((current) => [...current, created]);
      setSelectedId(created.id);
      setCreateOpen(false);
    });
  };

  const saveRule = async (draft: RuleDraft) => {
    if (!selected || !isOwner(selected)) return;
    const steps = draft.steps.map((step) => ({ title: step.title.trim(), assigneeId: step.assigneeId || '' }));
    const originalSteps = selected.steps.map((step) => ({ title: step.title, assigneeId: step.assigneeId ?? '' }));
    const sameStep = (left: typeof steps[number], right: typeof steps[number]) => left.title === right.title && left.assigneeId === right.assigneeId;
    const sameStepSet = JSON.stringify([...steps].sort((left, right) => `${left.title}:${left.assigneeId}`.localeCompare(`${right.title}:${right.assigneeId}`))) === JSON.stringify([...originalSteps].sort((left, right) => `${left.title}:${left.assigneeId}`.localeCompare(`${right.title}:${right.assigneeId}`)));
    const ruleChanged = selected.title !== draft.title || selected.frequency !== draft.frequency || selected.dayOfWeek !== draft.dayOfWeek || selected.dayOfMonth !== draft.dayOfMonth || selected.month !== draft.month || selected.sequential !== draft.sequential;
    const stepsChanged = JSON.stringify(steps) !== JSON.stringify(originalSteps);
    const operation: RhythmOperation = ruleChanged ? 'rhythms.update-rule'
      : steps.length > originalSteps.length ? 'rhythms.create-step'
          : steps.length < originalSteps.length ? 'rhythms.delete-step'
          : sameStepSet && steps.some((step, index) => !sameStep(step, originalSteps[index]!)) ? 'rhythms.reorder-step'
            : 'rhythms.update-step';
    if (!ruleChanged && !stepsChanged) return;
    requestOperation(operation, selected.id, { title: draft.title.slice(0, 200), frequency: draft.frequency, dayOfWeek: draft.dayOfWeek, dayOfMonth: draft.dayOfMonth, month: draft.month, sequential: draft.sequential, steps: JSON.stringify(steps.map((step) => ({ title: step.title.slice(0, 200), assigneeId: step.assigneeId || null }))).slice(0, 2000) }, async () => {
      let updated = selected;
      if (ruleChanged) updated = await gateway.update(selected.id, { title: draft.title, frequency: draft.frequency, dayOfWeek: draft.dayOfWeek, dayOfMonth: draft.dayOfMonth, month: draft.month, sequential: draft.sequential });
      if (stepsChanged) updated = await gateway.replaceSteps(selected.id, steps.map((step) => ({ title: step.title, assigneeId: step.assigneeId || undefined })));
      setRules((current) => current.map((rule) => (rule.id === selected.id ? updated : rule)));
    });
  };

  const addWorkflowStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !isOwner(selected) || !stepTitle.trim()) return;
    requestOperation('rhythms.create-step', selected.id, { title: stepTitle.trim().slice(0, 200), assigneeId: stepAssignee || null }, async () => {
      const step = await gateway.addStep(selected.id, { title: stepTitle.trim(), assigneeId: stepAssignee || undefined });
      setRules((current) => current.map((rule) => (rule.id === selected.id ? { ...rule, steps: [...rule.steps, step] } : rule)));
      setStepTitle('');
      setStepAssignee('');
    });
  };

  return (
    <ScreenRoot screenName="Rhythms" testId="rhythm-rhythms-screen">
      <section className="page-shell pg-rhythms" aria-busy={surfaceState === 'loading'}>
        <header className="rhythms-header">
          <div className="rhythms-heading"><span className="eyebrow">Recurring work</span><h1>Rhythms</h1><p>Manage recurring rules, owners, generated tasks, and the next scheduled run.</p></div>
          <div className="rhythms-header-actions">
            <span data-testid="rhythms-visible-count">{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
            <button ref={newRuleTriggerRef} className="primary-button" type="button" disabled={!showsWorkspace || !can('rhythms.create-rule')} title={!can('rhythms.create-rule') ? 'This host grants inspection only.' : undefined} onClick={() => setCreateOpen(true)} data-testid="rhythms-new-rule">New rule</button>
          </div>
        </header>

        <div className="rhythms-scroll">
          {!showsWorkspace && <StatePanel state={surfaceState} onRetry={() => void load()} onCreate={() => setCreateOpen(true)} />}
          {showsWorkspace && (
            <div className="rhythms-layout">
              <section className="rhythms-collection" aria-labelledby="rhythms-list-title">
                <h2 id="rhythms-list-title">Recurring rules</h2>
                <div className="rhythms-list" data-testid="rhythms-list">
                  {rules.map((rule) => (
                    <article className={`rhythm-card ${rule.enabled ? '' : 'paused'}`} key={rule.id} data-testid={`rhythm-card-${rule.id}`}>
                      <div className="rhythm-card-copy">
                        <span className="eyebrow" data-testid={`rhythm-status-${rule.id}`}>{rule.enabled ? 'Enabled' : 'Paused'}</span>
                        <h3>{rule.title}</h3>
                        <p data-testid={`rhythm-pattern-${rule.id}`}>{patternDescription(rule)}</p>
                      </div>
                      <div className="rhythm-card-actions">
                        <button className="secondary-button" type="button" aria-label={`Inspect ${rule.title}`} onClick={() => inspect(rule)} data-testid={`rhythm-inspect-${rule.id}`}>Inspect</button>
                        <label className="rhythm-enabled-toggle">
                          <input type="checkbox" checked={rule.enabled} disabled={mutationPending || !can('rhythms.update-rule') || !isOwner(rule)} title={!isOwner(rule) ? 'Only the rhythm owner can change this rule.' : !can('rhythms.update-rule') ? 'This host grants inspection only.' : undefined} aria-label={`${rule.enabled ? 'Enabled' : 'Paused'} - ${rule.title}`} onChange={(event) => void toggleEnabled(rule, event.target.checked)} data-testid={`rhythm-enabled-${rule.id}`} />
                          <span aria-hidden="true" /><b>{rule.enabled ? 'Enabled' : 'Paused'}</b>
                        </label>
                        <button className="text-danger-button" type="button" disabled={mutationPending || !can('rhythms.delete-rule') || !isOwner(rule)} title={!isOwner(rule) ? 'Only the rhythm owner can delete this rule.' : !can('rhythms.delete-rule') ? 'This host grants inspection only.' : undefined} aria-label={`Delete ${rule.title}`} onClick={() => requestOperation('rhythms.delete-rule', rule.id, { title: rule.title.slice(0, 200) }, async () => { await gateway.delete(rule.id); setRules((current) => current.filter((item) => item.id !== rule.id)); if (selectedId === rule.id) setSelectedId(null); })} data-testid={`rhythm-delete-${rule.id}`}>Delete</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <aside className="rhythms-detail-column" aria-label="Selected rhythm">
                {selected ? (
                  <section className="rhythm-detail" aria-labelledby="rhythm-detail-title" data-testid="rhythm-detail">
                    <header>
                      <div><span className="eyebrow">{selected.enabled ? 'Enabled rhythm' : 'Paused rhythm'}</span><h2 id="rhythm-detail-title">{selected.title}</h2><p>{patternDescription(selected)}</p></div>
                      <button className="text-button" type="button" onClick={closeSelection} data-testid="rhythm-detail-close">Close</button>
                    </header>
                    <dl className="rhythm-metrics">
                      <div><dt>Owner</dt><dd data-testid="rhythm-owner">{selected.ownerName}</dd></div>
                      <div><dt>Generated</dt><dd data-testid="rhythm-generated-count">{selected.generatedCount} generated tasks</dd></div>
                      <div><dt>Completed</dt><dd data-testid="rhythm-completed-count">{selected.completedCount} completed</dd></div>
                      <div><dt>Remaining</dt><dd data-testid="rhythm-remaining-count">{selected.remainingCount} remaining</dd></div>
                    </dl>
                    <section className="rhythm-next">
                      <span className="eyebrow">Next due</span>
                      <strong data-testid="rhythm-next-due">{selected.enabled ? (selected.nextDueDate ?? 'Not scheduled') : 'Paused - no next generation'}</strong>
                      <p data-testid="rhythm-waiting-on">{selected.waitingOn ? `Waiting on ${selected.waitingOn}` : 'No person is blocking the next task'}</p>
                    </section>

                    <section className="rhythm-edit" aria-labelledby="rhythm-edit-title">
                      <h3 id="rhythm-edit-title">Edit rhythm</h3>
                      <RuleForm
                        idPrefix="rhythm-edit"
                        showStepsBuilder
                        initial={{ title: selected.title, frequency: selected.frequency, dayOfWeek: selected.dayOfWeek, dayOfMonth: selected.dayOfMonth, month: selected.month, sequential: selected.sequential, steps: selected.steps.map((step) => ({ title: step.title, assigneeId: step.assigneeId ?? '' })) }}
                        members={members}
                        disabled={mutationPending || !isOwner(selected) || !(['rhythms.update-rule', 'rhythms.create-step', 'rhythms.update-step', 'rhythms.delete-step', 'rhythms.reorder-step'] as RhythmOperation[]).some(can)}
                        onCancel={closeSelection}
                        onSave={(draft) => void saveRule(draft)}
                      />
                    </section>

                    <section className="rhythm-collaborators" aria-labelledby="rhythm-collaborators-title">
                      <header><h3 id="rhythm-collaborators-title">Collaborators</h3><button className="secondary-button" type="button" disabled title="Collaborator changes are not available from this host-neutral surface." data-testid="rhythm-add-collaborator">Add collaborator</button></header>
                      <div className="rhythm-people">
                        {selected.collaborators.length ? selected.collaborators.map((person) => (
                          <div className="rhythm-person" key={person.id} data-testid={`rhythm-collaborator-${person.id}`}>
                            <span aria-hidden="true">{person.initials}</span><strong>{person.name}</strong>
                            <button type="button" disabled aria-label={`Remove ${person.name}`} title="Collaborator changes are not available from this host-neutral surface." data-testid={`rhythm-remove-collaborator-${person.id}`}>Remove</button>
                          </div>
                        )) : <p>No collaborators yet.</p>}
                      </div>
                    </section>

                    <section className="rhythm-detail-steps" aria-labelledby="rhythm-steps-title">
                      <h3 id="rhythm-steps-title">Workflow steps</h3>
                      {selected.steps.length > 0 && (
                        <ol>{selected.steps.map((step: RhythmStep) => <li key={step.id} data-testid={`rhythm-step-${step.id}`}><strong>{step.title}</strong><span>{members.find((person) => person.id === step.assigneeId)?.name ?? 'Unassigned'}</span></li>)}</ol>
                      )}
                      <form className="rhythm-add-step-form" onSubmit={addWorkflowStep}>
                        <label>New step title<input disabled={!can('rhythms.create-step') || !isOwner(selected)} value={stepTitle} onChange={(event) => setStepTitle(event.target.value)} data-testid="rhythm-add-step-title" /></label>
                        <label>Assignee<select disabled={!can('rhythms.create-step') || !isOwner(selected)} value={stepAssignee} onChange={(event) => setStepAssignee(event.target.value)} data-testid="rhythm-add-step-assignee"><option value="">None</option>{members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                        <button className="secondary-button" type="submit" disabled={mutationPending || !can('rhythms.create-step') || !isOwner(selected) || !stepTitle.trim()} data-testid="rhythm-add-step-submit">Add step</button>
                      </form>
                    </section>
                  </section>
                ) : (
                  <section className="rhythm-detail-empty" aria-labelledby="rhythm-detail-empty-title"><h2 id="rhythm-detail-empty-title">Select a rhythm</h2><p>Inspect ownership, generated work, and the next due task without leaving the collection.</p></section>
                )}
              </aside>
            </div>
          )}
        </div>

        <FocusDialog open={createOpen} onClose={() => { closeOperation(); setCreateOpen(false); }} title="New Recurring Rule" description="Create a recurring rule with optional workflow steps." testId="rhythm-create-dialog" wide>
          <RuleForm idPrefix="rhythm-create" initial={blankDraft()} members={members} disabled={mutationPending || !can('rhythms.create-rule')} onCancel={() => { closeOperation(); setCreateOpen(false); }} onSave={(draft) => void createRule(draft)} />
        </FocusDialog>

        <FocusDialog open={Boolean(operationTarget)} onClose={closeOperation} title="Confirm Rhythm change" description="This exact change is sent only after you confirm it." testId="rhythm-operation-confirmation">
          <p role="status">Confirm {operationTarget?.operation} for this rhythm.</p>
          {operationError && <div role="alert" data-testid="rhythm-operation-outcome"><p>{operationError === 'conflict' ? 'This rhythm changed elsewhere. Reload before retrying.' : 'We could not verify whether this change was applied. Reload before retrying.'}</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => void load()} data-testid="rhythm-operation-reload">Reload</button><button className="secondary-button" type="button" onClick={retryOperation} data-testid="rhythm-operation-retry">Retry</button></div></div>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeOperation} data-testid="rhythm-operation-cancel">Cancel</button><button className="primary-button" type="button" disabled={mutationPending} onClick={() => void confirmOperation()} data-autofocus data-testid="rhythm-operation-confirm">Confirm</button></div>
        </FocusDialog>

      </section>
    </ScreenRoot>
  );
}
