// Ported from apps/web/src/pages/planner/index.tsx (742 lines) + fixtures.ts. Carried over: the
// backlog + seven-day board layout, drag-and-drop scheduling, task select/bulk-complete,
// complete/reopen, the open/all visibility filter, the create-task dialog (defaulting its
// scheduled date to the day clicked), the task inspector (notes/scheduled/due date,
// collaborators, agent-handoff quick actions delegated to the host), and read-only calendar
// events. Deliberately dropped at the host-neutral boundary: the ISO-8601 week-number label
// format and its hardcoded 2026 demo-date validation (replaced with plain ±7-day arithmetic off
// the requested week's Monday — see shiftIsoDate/startOfWeek below), the hash-based route/query
// state, and the API-receipt ledger. Calendar events are read-only, but project steps retain the
// same completion, scheduling, and inspector behavior as the production planner.
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useRhythmDomainGateway, useRhythmHost } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { FocusDialog } from '../components/FocusDialog';
import { HeaderTaskAction } from '../components/HeaderTaskAction';
import { TaskCreateForm } from '../components/TaskCreateForm';
import { quickActionPresets } from '../components/quickActions';
import { RhythmGatewayError, type RhythmPlannerEvent, type RhythmPlannerTask, type RhythmPlannerWeek, type RhythmWorkspaceMember } from '../domain/types';

type PlannerSurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';
type FilterMode = 'open' | 'all';
type InspectorState = { kind: 'create'; scheduledDate?: string } | { kind: 'task'; id: string } | { kind: 'event'; id: string } | null;

function startOfWeek(date: Date): string {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}

function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function StatePanel({ state, onRetry, onCreate }: { state: Exclude<PlannerSurfaceState, 'ready'>; onRetry(): void; onCreate(): void }) {
  if (state === 'loading') return <section className="planner-state" role="status" aria-live="polite" data-testid="page-state-loading"><span className="eyebrow">Weekly plan</span><h2>Loading this week…</h2><p>Assembling seven day lanes, calendar context, and backlog work.</p><div className="state-lines" aria-hidden="true"><span /><span /><span /></div></section>;
  if (state === 'empty') return <section className="planner-state" role="status" data-testid="page-state-empty"><span className="eyebrow">A clear week</span><h2>No work planned yet</h2><p>Add the first unscheduled task, then place it when the week takes shape.</p><button className="primary-button" type="button" onClick={onCreate} data-testid="planner-add-empty-task">Add task</button></section>;
  if (state === 'server_error') return <section className="planner-state danger" role="alert" data-testid="page-state-server-error"><span className="eyebrow">Retryable server error</span><h2>This week could not load</h2><p>The planning service returned a temporary error. Your data is unchanged.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="planner-state warning" role="alert" data-testid="page-state-forbidden"><span className="eyebrow">Workspace access required</span><h2>Planner access is restricted</h2><p>Ask a workspace administrator for planning access.</p></section>;
  return <section className="planner-state warning" role="status" data-testid="page-state-unavailable"><span className="eyebrow">Planning service prerequisite</span><h2>Planner is unavailable</h2><p>Reconnect the planning service before loading weekly work.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

function TaskCard({ task, selected, canWrite, onInspect, onComplete, onSelect, onDragStart }: {
  task: RhythmPlannerTask; selected: boolean; canWrite: boolean; onInspect(task: RhythmPlannerTask): void; onComplete(task: RhythmPlannerTask): void; onSelect(task: RhythmPlannerTask): void; onDragStart(event: DragEvent<HTMLButtonElement>, task: RhythmPlannerTask): void;
}) {
  return (
    <article className={`planner-task ${task.readonly ? 'project-step' : ''} ${selected ? 'selected' : ''}`} data-status={task.status}>
      <button className="task-main" type="button" draggable={canWrite} aria-label={`Inspect ${task.title}`} onDragStart={(event) => onDragStart(event, task)} onClick={() => onInspect(task)} data-testid={`planner-task-${task.id}`}>
        <span className="task-source">{task.readonly ? task.projectName ?? 'Project step' : `${task.energy ?? '-'} Task`}</span>
        <strong>{task.title}</strong>
        {task.dueDate && task.dueDate !== task.scheduledDate && <small>Due {task.dueDate}</small>}
      </button>
      <div className="task-controls">
        <button type="button" disabled={!canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} aria-label={`Select ${task.title}`} aria-pressed={selected} onClick={() => onSelect(task)} data-testid={`planner-task-select-${task.id}`}><span aria-hidden="true">{selected ? '◆' : '◇'}</span></button>
        <button type="button" disabled={!canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => onComplete(task)} data-testid={`planner-complete-${task.id}`}><span aria-hidden="true">{task.status === 'done' ? '↺' : '✓'}</span></button>
      </div>
    </article>
  );
}

function CalendarEvent({ event, onInspect }: { event: RhythmPlannerEvent; onInspect(event: RhythmPlannerEvent): void }) {
  return <button className="calendar-event" type="button" onClick={() => onInspect(event)} data-testid={`planner-event-${event.id}`}><span>{event.timeLabel}</span><strong>{event.title}</strong><small>Calendar · read only</small></button>;
}

export function PlannerScreen() {
  const { planner: gateway } = useRhythmDomainGateway();
  const host = useRhythmHost();
  const canWrite = host.currentUser.collaborationCapability !== 'read';
  const [surfaceState, setSurfaceState] = useState<PlannerSurfaceState>('loading');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [plan, setPlan] = useState<RhythmPlannerWeek | null>(null);
  const [members, setMembers] = useState<RhythmWorkspaceMember[]>([]);
  const [filter, setFilter] = useState<FilterMode>('open');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspector, setInspector] = useState<InspectorState>(null);
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const createTitleRef = useRef<HTMLInputElement>(null);
  const loadGeneration = useRef(0);

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async (targetWeekStart: string) => {
    const generation = ++loadGeneration.current;
    setSurfaceState('loading');
    try {
      const [loadedPlan, loadedMembers] = await Promise.all([gateway.week(targetWeekStart), gateway.members()]);
      if (generation !== loadGeneration.current) return;
      setPlan(loadedPlan);
      setMembers(loadedMembers);
      const hasWork = loadedPlan.backlog.length > 0 || loadedPlan.days.some((day) => day.tasks.length > 0);
      setSurfaceState(hasWork ? 'ready' : 'empty');
    } catch (error) {
      if (generation === loadGeneration.current) handleError(error);
    }
  };

  useEffect(() => { void load(weekStart); return () => { loadGeneration.current += 1; }; }, [gateway, weekStart]);

  const showsWorkspace = surfaceState === 'ready';
  const allTasks = useMemo(() => (plan ? [...plan.backlog, ...plan.days.flatMap((day) => day.tasks)] : []), [plan]);
  const currentTask = inspector?.kind === 'task' ? allTasks.find((task) => task.id === inspector.id) ?? null : null;
  const currentEvent = inspector?.kind === 'event' ? plan?.days.flatMap((day) => day.events).find((event) => event.id === inspector.id) ?? null : null;

  const backlog = useMemo(() => (plan?.backlog ?? []).filter((task) => filter === 'all' || task.status === 'open'), [plan, filter]);
  const doneCount = allTasks.filter((task) => task.status === 'done').length;
  const scheduledOpenCount = plan?.days.reduce((count, day) => count + day.tasks.filter((task) => task.status === 'open').length, 0) ?? 0;

  const changeWeek = (next: string) => setWeekStart(next);

  const changeStatus = async (task: RhythmPlannerTask, status: 'open' | 'done') => {
    if (!canWrite || mutationPending) return;
    setMutationPending(true);
    try {
      const updated = await gateway.update(task.id, { status });
      setPlan((current) => current && {
        ...current,
        backlog: current.backlog.map((item) => (item.id === updated.id ? updated : item)),
        days: current.days.map((day) => ({ ...day, tasks: day.tasks.map((item) => (item.id === updated.id ? updated : item)) })),
      });
      setSelectedIds((current) => current.filter((id) => id !== task.id));
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const toggleSelected = (task: RhythmPlannerTask) => setSelectedIds((current) => (current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]));

  const bulkComplete = async () => {
    const targets = allTasks.filter((task) => selectedIds.includes(task.id) && task.status === 'open');
    for (const task of targets) await changeStatus(task, 'done');
    setSelectedIds([]);
  };

  const onDragStart = (_event: DragEvent<HTMLButtonElement>, task: RhythmPlannerTask) => setDraggedId(task.id);

  const moveTask = async (taskId: string, date: string) => {
    const task = allTasks.find((item) => item.id === taskId);
    if (!canWrite || !task || mutationPending || task.status === 'done') return;
    setMutationPending(true);
    try {
      const updated = await gateway.scheduleTask(task.id, { scheduledDate: date });
      await load(weekStart);
      void updated;
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const dropOnDay = (event: DragEvent<HTMLElement>, date: string) => {
    event.preventDefault();
    if (draggedId) void moveTask(draggedId, date);
    setDraggedId(null);
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!canWrite || !form.reportValidity()) return;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) { createTitleRef.current?.focus(); return; }
    setMutationPending(true);
    try {
      await gateway.create({
        title,
        notes: String(data.get('notes') ?? '').trim() || undefined,
        scheduledDate: String(data.get('scheduledDate') ?? '') || undefined,
        dueDate: String(data.get('dueDate') ?? '') || undefined,
      });
      await load(weekStart);
      setInspector(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const saveTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || !currentTask) return;
    const data = new FormData(event.currentTarget);
    setMutationPending(true);
    try {
      const updated = await gateway.update(currentTask.id, {
        notes: String(data.get('notes') ?? ''),
        scheduledDate: String(data.get('scheduledDate') ?? '') || undefined,
        dueDate: String(data.get('dueDate') ?? '') || undefined,
      });
      setPlan((current) => current && {
        ...current,
        backlog: current.backlog.map((item) => (item.id === updated.id ? updated : item)),
        days: current.days.map((day) => ({ ...day, tasks: day.tasks.map((item) => (item.id === updated.id ? updated : item)) })),
      });
      setInspector(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const addCollaborator = async (memberId: string) => {
    if (!canWrite || !currentTask) return;
    try {
      const updated = await gateway.addCollaborator(currentTask.id, memberId);
      setPlan((current) => current && {
        ...current,
        backlog: current.backlog.map((item) => (item.id === updated.id ? updated : item)),
        days: current.days.map((day) => ({ ...day, tasks: day.tasks.map((item) => (item.id === updated.id ? updated : item)) })),
      });
      setCollaboratorPickerOpen(false);
    } catch (error) {
      handleError(error);
    }
  };

  const removeCollaborator = async (memberId: string) => {
    if (!canWrite || !currentTask) return;
    try {
      const updated = await gateway.removeCollaborator(currentTask.id, memberId);
      setPlan((current) => current && {
        ...current,
        backlog: current.backlog.map((item) => (item.id === updated.id ? updated : item)),
        days: current.days.map((day) => ({ ...day, tasks: day.tasks.map((item) => (item.id === updated.id ? updated : item)) })),
      });
    } catch (error) {
      handleError(error);
    }
  };

  const launchQuickAction = (actionId: string, label: string) => {
    if (!currentTask) return;
    host.onRequestFollowUp?.({ screen: 'planner', label, action: actionId, relatedId: currentTask.id });
  };

  const closeInspector = () => { setInspector(null); setCollaboratorPickerOpen(false); };

  return (
    <ScreenRoot screenName="Planner" testId="rhythm-planner-screen">
      <section className="page-shell pg-planner" aria-busy={surfaceState === 'loading'}>
        <header className="planner-toolbar">
          <div className="planner-heading"><h1>Planner</h1><p data-testid="planner-week-label">Week of {weekStart}</p></div>
          <div className="planner-summary" aria-label="Week summary">
            <span><strong>{scheduledOpenCount}</strong> scheduled open</span>
            <span><strong>{doneCount}</strong> completed</span>
            <span><strong data-testid="planner-backlog-count">{backlog.length}</strong> backlog</span>
          </div>
          <div className="planner-header-actions">
            <HeaderTaskAction onClick={() => setInspector({ kind: 'create' })} disabled={!showsWorkspace || mutationPending || !canWrite} testId="planner-header-add-task" />
            <nav className="week-controls" aria-label="Week navigation">
              <button className="secondary-button" type="button" aria-label="Previous week" onClick={() => changeWeek(shiftIsoDate(weekStart, -7))} data-testid="planner-prev-week">←</button>
              <button className="secondary-button" type="button" disabled={weekStart === startOfWeek(new Date())} onClick={() => changeWeek(startOfWeek(new Date()))} data-testid="planner-today">Today</button>
              <button className="secondary-button" type="button" aria-label="Next week" onClick={() => changeWeek(shiftIsoDate(weekStart, 7))} data-testid="planner-next-week">→</button>
            </nav>
          </div>
        </header>

        <div className="planner-scroll">
          {!showsWorkspace && <StatePanel state={surfaceState} onRetry={() => void load(weekStart)} onCreate={() => setInspector({ kind: 'create' })} />}
          {showsWorkspace && plan && (
            <>
              {selectedIds.length > 0 && (
                <aside className="selection-bar" aria-label="Selected tasks">
                  <strong data-testid="planner-selection-count">{selectedIds.length} selected</strong>
                  <button className="primary-button" type="button" disabled={!canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} onClick={() => void bulkComplete()} data-testid="planner-bulk-complete">Mark complete</button>
                  <button className="text-button" type="button" onClick={() => setSelectedIds([])} data-testid="planner-clear-selection">Clear</button>
                </aside>
              )}

              <section className="planner-board" aria-label="Weekly plan" data-testid="planner-board">
                <aside className="backlog-lane" data-testid="planner-backlog">
                  <header><span className="eyebrow">Unscheduled</span><h2>Backlog</h2></header>
                  <button className="secondary-button add-control" type="button" disabled={mutationPending || !canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} onClick={() => setInspector({ kind: 'create' })} data-testid="planner-add-backlog-task">+ Add unscheduled task</button>
                  <div className="lane-list">
                          {backlog.map((task) => <TaskCard key={task.id} task={task} selected={selectedIds.includes(task.id)} canWrite={canWrite} onInspect={(item) => setInspector({ kind: 'task', id: item.id })} onComplete={(item) => void changeStatus(item, item.status === 'done' ? 'open' : 'done')} onSelect={toggleSelected} onDragStart={onDragStart} />)}
                  </div>
                </aside>

                <div className="days-grid">
                  {plan.days.map((day) => {
                    const dayTasks = day.tasks.filter((task) => filter === 'all' || task.status === 'open');
                    return (
                      <section className="day-lane" key={day.date} aria-labelledby={`planner-day-title-${day.date}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnDay(event, day.date)} data-testid={`planner-day-${day.date}`}>
                        <header><span>{day.label}</span><h2 id={`planner-day-title-${day.date}`}>{day.date}</h2></header>
                        <div className="event-list">{day.events.map((event) => <CalendarEvent key={event.id} event={event} onInspect={(item) => setInspector({ kind: 'event', id: item.id })} />)}</div>
                        <div className="lane-list">
                          {dayTasks.map((task) => <TaskCard key={task.id} task={task} selected={selectedIds.includes(task.id)} canWrite={canWrite} onInspect={(item) => setInspector({ kind: 'task', id: item.id })} onComplete={(item) => void changeStatus(item, item.status === 'done' ? 'open' : 'done')} onSelect={toggleSelected} onDragStart={onDragStart} />)}
                        </div>
                        <button className="text-button add-control" type="button" disabled={mutationPending || !canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} onClick={() => setInspector({ kind: 'create', scheduledDate: day.date })} data-testid={`planner-add-task-${day.date}`}>+ Add task</button>
                      </section>
                    );
                  })}
                </div>
              </section>

              <div className="filter-control" role="group" aria-label="Task visibility">
                <button type="button" aria-pressed={filter === 'open'} onClick={() => setFilter('open')} data-testid="planner-filter-open">Open</button>
                <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} data-testid="planner-filter-all">All</button>
              </div>
            </>
          )}
        </div>

        <FocusDialog open={inspector?.kind === 'create'} onClose={closeInspector} title="Add task" description="Set the task details now. More people are available after creation." testId="planner-create-task-dialog">
          <TaskCreateForm
            idPrefix="planner-create"
            onSubmit={(event) => void createTask(event)}
            onCancel={closeInspector}
            members={members}
            titleRef={createTitleRef}
            defaultScheduledDate={inspector?.kind === 'create' ? inspector.scheduledDate ?? '' : ''}
            disabled={mutationPending || !canWrite}
            testIds={{ title: 'planner-create-title', notes: 'planner-create-notes', scheduledDate: 'planner-create-scheduled-date', dueDate: 'planner-create-due-date', collaborator: 'planner-create-collaborator', cancel: 'planner-create-task-cancel', submit: 'planner-create-task-submit' }}
          />
        </FocusDialog>

        <FocusDialog open={Boolean(currentTask)} onClose={closeInspector} title={canWrite ? 'Edit task' : 'Task details'} description={canWrite ? 'Planner persists notes and date fields for existing tasks.' : 'This host grants inspection only.'} testId="planner-inspector">
          {currentTask && (
            <form className="inspector-form task-editor-form" onSubmit={(event) => void saveTask(event)}>
              <p className="inspector-record-title">{currentTask.title}</p>
              <label className="task-editor-field">Task notes<textarea name="notes" rows={4} defaultValue={currentTask.notes} data-autofocus data-testid="planner-edit-notes" /></label>
              <div className="field-pair task-editor-pair">
                <label className="task-editor-field">Scheduled date<input name="scheduledDate" type="date" defaultValue={currentTask.scheduledDate ?? ''} data-testid="planner-edit-scheduled-date" /></label>
                <label className="task-editor-field">Due date<input name="dueDate" type="date" defaultValue={currentTask.dueDate ?? ''} data-testid="planner-edit-due-date" /></label>
              </div>
              <section className="collaborators task-editor-section" aria-labelledby="planner-collaborators-title">
                <div className="subhead task-editor-section-head"><h3 id="planner-collaborators-title">Collaborators</h3><button className="secondary-button" type="button" disabled={!canWrite} onClick={() => setCollaboratorPickerOpen((value) => !value)} data-testid="planner-add-collaborator">Add collaborator</button></div>
                <div className="collaborator-chips">{currentTask.collaborators.map((member) => <span key={member.id}>{member.name}<button type="button" aria-label={`Remove ${member.name}`} onClick={() => void removeCollaborator(member.id)} data-testid={`planner-remove-collaborator-${member.id}`}>×</button></span>)}</div>
                {collaboratorPickerOpen && (
                  <div className="collaborator-picker" role="listbox" aria-label="Workspace members">
                    {members.filter((member) => !currentTask.collaborators.some((existing) => existing.id === member.id)).map((member) => (
                      <button type="button" role="option" aria-selected="false" key={member.id} onClick={() => void addCollaborator(member.id)} data-testid={`planner-collaborator-option-${member.id}`}>{member.name}</button>
                    ))}
                  </div>
                )}
              </section>
              <section className="quick-actions" aria-labelledby="planner-quick-actions-title">
                <h3 id="planner-quick-actions-title">Agent handoff</h3>
                {quickActionPresets.map((action) => <button className="secondary-button" type="button" key={action.id} onClick={() => launchQuickAction(action.id, action.label)} data-testid={`quick-action-${action.id}`}>{action.label}</button>)}
              </section>
              <footer className="task-editor-footer">
                <button className="secondary-button" type="button" onClick={closeInspector} data-testid="planner-edit-cancel">Cancel</button>
                <button className="primary-button" type="submit" disabled={mutationPending || !canWrite} title={!canWrite ? 'This host grants inspection only.' : undefined} data-testid="planner-save-task">Save changes</button>
              </footer>
            </form>
          )}
        </FocusDialog>

        <FocusDialog open={Boolean(currentEvent)} onClose={closeInspector} title="Calendar event" description="Calendar events provide planning context and cannot be changed here." testId="planner-calendar-inspector">
          {currentEvent && <article className="readonly-details"><span className="eyebrow">Read only</span><h3>{currentEvent.title}</h3><p>{currentEvent.notes}</p><dl><div><dt>Date</dt><dd>{currentEvent.date}</dd></div><div><dt>Time</dt><dd>{currentEvent.timeLabel}</dd></div></dl></article>}
        </FocusDialog>
      </section>
    </ScreenRoot>
  );
}
