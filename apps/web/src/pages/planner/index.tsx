import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { HeaderTaskAction } from '../../components/HeaderTaskAction';
import { TaskCreateForm } from '../../components/TaskCreateForm';
import { navigate } from '../../components/Shell';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import { PlannerGatewayError, type Task, type TaskCollaborator, type WeeklyPlan } from '../../gateway/planner';
import { launchQuickActionSession, quickActionPresets, type QuickActionTaskContext } from '../../components/quickActions';
import {
  partialLongTask,
  plannerEvents,
  plannerMembers,
  plannerTasks,
  PLANNER_CURRENT_WEEK,
  type PlannerEvent,
  type PlannerTask,
} from './fixtures';
import './styles.css';

type PlannerSurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type FilterMode = 'open' | 'all';
type InspectorState =
  | { kind: 'create'; scheduledDate?: string }
  | { kind: 'task'; id: string }
  | { kind: 'event'; id: string }
  | null;

const supportedStates: PlannerSurfaceState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];
const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const monthDayFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function queryParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function requestedState(): PlannerSurfaceState {
  const value = queryParams().get('state');
  return supportedStates.includes(value as PlannerSurfaceState) ? value as PlannerSurfaceState : 'ready';
}

function initialLoadReceipt() {
  const state = requestedState();
  const endpoint = `GET /weekly-plan?week=${validWeek(queryParams().get('week'))}`;
  if (state === 'loading') return null;
  if (state === 'server-error' || state === 'unavailable') return `${endpoint} → 503`;
  if (state === 'forbidden') return `${endpoint} → 403`;
  return `${endpoint} → 200`;
}

function validWeek(value: string | null) {
  return value && /^2026-W(?:3[0-6])$/.test(value) ? value : PLANNER_CURRENT_WEEK;
}

function isoWeekMonday(label: string) {
  const [yearText, weekText] = label.split('-W');
  const year = Number(yearText);
  const week = Number(weekText);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekday = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - weekday + 1 + ((week - 1) * 7));
  return monday;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function weekDays(label: string) {
  const monday = isoWeekMonday(label);
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + offset);
    return { date: isoDate(date), weekday: dayFormatter.format(date), monthDay: monthDayFormatter.format(date), isToday: isoDate(date) === '2026-08-12' };
  });
}

function adjacentWeek(label: string, delta: number) {
  const monday = isoWeekMonday(label);
  monday.setUTCDate(monday.getUTCDate() + (delta * 7));
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + (4 - (firstThursday.getUTCDay() || 7)));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function StatePanel({ state, onRetry, onCreate }: { state: Exclude<PlannerSurfaceState, 'ready' | 'readonly'>; onRetry(): void; onCreate(): void }) {
  if (state === 'loading') return <section className="planner-state" role="status" aria-live="polite" aria-busy="true" data-testid="page-state-loading"><span className="state-symbol" aria-hidden="true">◌</span><span className="eyebrow">Weekly planning fixture</span><h2>Loading this week…</h2><p>Assembling seven day lanes, calendar context, and backlog work.</p><div className="state-lines" aria-hidden="true"><span /><span /><span /></div></section>;
  if (state === 'empty') return <section className="planner-state" role="status" data-testid="page-state-empty"><span className="state-symbol" aria-hidden="true">+</span><span className="eyebrow">A clear week</span><h2>No work planned yet</h2><p>Add the first unscheduled task, then place it when the week takes shape.</p><button className="primary-button" type="button" onClick={onCreate} data-testid="planner-add-empty-task">Add task</button></section>;
  if (state === 'server-error') return <section className="planner-state danger" role="alert" data-testid="page-state-server-error"><span className="state-code">503</span><span className="eyebrow">Retryable server error</span><h2>This week could not load</h2><p>The deterministic planning adapter returned an error. Your fixture seed is unchanged.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="planner-state warning" role="alert" data-testid="page-state-forbidden"><span className="state-code">403</span><span className="eyebrow">Workspace access required</span><h2>Planner access is restricted</h2><p>Planning membership or editor permission is required before this week can be viewed.</p></section>;
  return <section className="planner-state warning" role="status" data-testid="page-state-unavailable"><span className="state-symbol" aria-hidden="true">◇</span><span className="eyebrow">Planning service prerequisite</span><h2>Planner is unavailable</h2><p>Reconnect the local planning service fixture before loading weekly work.</p></section>;
}

function TaskCard({ task, readonly, selected, onInspect, onComplete, onSelect, onDragStart }: {
  task: PlannerTask;
  readonly: boolean;
  selected: boolean;
  onInspect(task: PlannerTask): void;
  onComplete(task: PlannerTask): void;
  onSelect(task: PlannerTask): void;
  onDragStart(event: DragEvent<HTMLButtonElement>, task: PlannerTask): void;
}) {
  const sourceLabel = task.source === 'project-step' ? task.projectName ?? 'Project step' : `${task.energy ?? '-'} Task`;
  const placementDate = task.source === 'project-step' ? task.dueDate : task.scheduledDate;
  const showDueDate = Boolean(task.dueDate && task.dueDate !== placementDate);
  return (
    <article className={`planner-task ${task.source === 'project-step' ? 'project-step' : ''} ${selected ? 'selected' : ''}`} data-status={task.status}>
      <button
        className="task-main"
        type="button"
        draggable={!readonly}
        aria-label={`Inspect ${task.title}`}
        onDragStart={(event) => onDragStart(event, task)}
        onClick={() => onInspect(task)}
        data-testid={`planner-task-${task.id}`}
        data-task-title="true"
      >
        <span className="task-source">{sourceLabel}</span>
        <strong>{task.title}</strong>
        {showDueDate ? <small data-testid={`planner-task-due-${task.id}`}>Due {task.dueDate}</small> : null}
      </button>
      <div className="task-controls">
        <button type="button" disabled={readonly} aria-describedby={readonly ? 'planner-readonly-reason' : undefined} aria-label={`Select ${task.title}`} aria-pressed={selected} onClick={() => onSelect(task)} data-testid={`planner-task-select-${task.id}`}><span aria-hidden="true">{selected ? '◆' : '◇'}</span></button>
        <button type="button" disabled={readonly} aria-describedby={readonly ? 'planner-readonly-reason' : undefined} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => onComplete(task)} data-testid={`planner-complete-${task.id}`}><span aria-hidden="true">{task.status === 'done' ? '↺' : '✓'}</span></button>
      </div>
    </article>
  );
}

function CalendarEvent({ event, onInspect }: { event: PlannerEvent; onInspect(event: PlannerEvent): void }) {
  return <button className="calendar-event" type="button" onClick={() => onInspect(event)} data-testid={`planner-event-${event.id}`}><span>{event.timeLabel}</span><strong>{event.title}</strong><small>Calendar · read only</small></button>;
}

function FixturePlannerPage({ route }: { route: string }) {
  const { createSession, notify } = useFixtures();
  const [surfaceState, setSurfaceState] = useState<PlannerSurfaceState>(requestedState);
  const [week, setWeek] = useState(() => validWeek(queryParams().get('week')));
  const [filter, setFilter] = useState<FilterMode>('open');
  const [tasks, setTasks] = useState<PlannerTask[]>(() => {
    const seeded = structuredClone(plannerTasks) as PlannerTask[];
    return queryParams().get('fixture') === 'partial-long' ? [partialLongTask, ...seeded] : seeded;
  });
  const [receipts, setReceipts] = useState<string[]>(() => {
    const receipt = initialLoadReceipt();
    return receipt ? [receipt] : [];
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspector, setInspector] = useState<InspectorState>(null);
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const readonly = surfaceState === 'readonly';
  const contentVisible = surfaceState === 'ready' || surfaceState === 'readonly';
  const days = useMemo(() => weekDays(week), [week]);
  const currentTask = inspector?.kind === 'task' ? tasks.find((task) => task.id === inspector.id) ?? null : null;
  const currentEvent = inspector?.kind === 'event' ? plannerEvents.find((event) => event.id === inspector.id) ?? null : null;

  const weekTaskIds = new Set(days.map((day) => day.date));
  const weekStart = days[0]?.date ?? '';
  const placementDate = (task: PlannerTask) => task.source === 'project-step' ? task.dueDate : task.scheduledDate;
  const backlog = tasks.filter((task) => task.status === 'open' && (task.source === 'project-step' ? !task.dueDate || task.dueDate < weekStart : !task.scheduledDate && !task.dueDate));
  const scheduledOpen = tasks.filter((task) => task.status === 'open' && weekTaskIds.has(placementDate(task) ?? '')).length;
  const doneCount = tasks.filter((task) => task.status === 'done').length;

  const writeQuery = (updates: Record<string, string | null>) => {
    const params = queryParams();
    for (const [key, value] of Object.entries(updates)) value === null ? params.delete(key) : params.set(key, value);
    const query = params.toString();
    history.replaceState(null, '', `#${route}${query ? `?${query}` : ''}`);
  };

  const appendReceipt = (receipt: string) => setReceipts((current) => [...current, receipt]);

  const changeWeek = (next: string) => {
    setWeek(next);
    writeQuery({ week: next });
    appendReceipt(`GET /weekly-plan?week=${next} → 200`);
  };

  const retry = () => {
    setSurfaceState('ready');
    writeQuery({ state: 'ready' });
    appendReceipt(`GET /weekly-plan?week=${week} → 200`);
    notify('Planner fixture recovered');
  };

  const moveTask = (taskId: string, date: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || readonly || task.status === 'done') return;
    const wasScheduled = Boolean(task.scheduledDate);
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, scheduledDate: date, dueDate: date, scheduledOrder: 900 } : item));
    if (task.source === 'project-step') appendReceipt(`PATCH /project-instances/steps/${task.id} {dueDate:${date}} → 200`);
    else if (wasScheduled) appendReceipt(`PATCH /weekly-plan/tasks/${task.id} {scheduledDate:${date},locked:false,scheduledOrder} → 200`);
    else appendReceipt(`PATCH /tasks/${task.id} {dueDate:${date},scheduledDate:${date},scheduledOrder} → 200`);
    notify(`${task.title} scheduled for ${date}`);
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>, task: PlannerTask) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/planner-task', task.id);
    event.dataTransfer.setData('text/plain', task.id);
  };

  const dropOnDay = (event: DragEvent<HTMLElement>, date: string) => {
    event.preventDefault();
    moveTask(event.dataTransfer.getData('text/planner-task') || event.dataTransfer.getData('text/plain'), date);
  };

  const toggleComplete = (task: PlannerTask) => {
    if (readonly) return;
    const next = task.status === 'done' ? 'open' : 'done';
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: next } : item));
    const family = task.source === 'project-step' ? '/project-instances/steps' : '/tasks';
    appendReceipt(`PATCH ${family}/${task.id} {status:${next}} → 200`);
    setSelectedIds((current) => current.filter((id) => id !== task.id));
    if (next === 'done') notify('Task marked complete.');
    else notify(`${task.title} reopened`);
  };

  const toggleSelected = (task: PlannerTask) => setSelectedIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]);

  const bulkComplete = () => {
    const selectedTasks = tasks.filter((task) => selectedIds.includes(task.id) && task.status === 'open');
    setTasks((current) => current.map((task) => selectedIds.includes(task.id) ? { ...task, status: 'done' } : task));
    for (const task of selectedTasks) {
      const family = task.source === 'project-step' ? '/project-instances/steps' : '/tasks';
      appendReceipt(`PATCH ${family}/${task.id} {status:done} → 200`);
    }
    setSelectedIds([]);
    notify('Task marked complete.');
  };

  const createTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inspector || inspector.kind !== 'create') return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') ?? '').trim();
    const notes = String(data.get('notes') ?? '').trim();
    const dueDate = String(data.get('dueDate') ?? '').trim();
    const scheduledDate = String(data.get('scheduledDate') ?? '').trim();
    const collaboratorId = String(data.get('collaboratorId') ?? '').trim();
    const collaborator = plannerMembers.find((member) => member.id === collaboratorId);
    if (!title) return;
    const id = `created-${tasks.filter((task) => task.id.startsWith('created-')).length + 1}`;
    setTasks((current) => [...current, { id, source: 'task', title, notes, status: 'open', scheduledDate: scheduledDate || undefined, dueDate: dueDate || undefined, scheduledOrder: 1000 + current.length, collaborators: collaborator ? [collaborator] : [] }]);
    appendReceipt(`POST /tasks {title${notes ? ',notes' : ''}${dueDate ? `,dueDate:${dueDate}` : ''}${scheduledDate ? `,scheduledDate:${scheduledDate}` : ''}} → 201`);
    if (collaborator) appendReceipt(`POST /tasks/${id}/collaborators {userId:${collaborator.id}} → 201`);
    if (surfaceState === 'empty') {
      setSurfaceState('ready');
      writeQuery({ state: 'ready' });
    }
    setInspector(null);
    notify(`${title} added to Planner`);
  };

  const saveTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentTask || readonly) return;
    const data = new FormData(event.currentTarget);
    const notes = String(data.get('notes') ?? '');
    const scheduledDate = String(data.get('scheduledDate') ?? '').trim();
    const dueDate = String(data.get('dueDate') ?? '').trim();
    setTasks((current) => current.map((task) => task.id === currentTask.id ? { ...task, notes, scheduledDate: scheduledDate || undefined, dueDate: dueDate || undefined } : task));
    const changed = [
      ...(notes !== currentTask.notes ? ['notes'] : []),
      ...(dueDate !== (currentTask.dueDate ?? '') ? [`dueDate:${dueDate || 'null'}`] : []),
      ...(currentTask.source === 'task' && scheduledDate !== (currentTask.scheduledDate ?? '') ? [`scheduledDate:${scheduledDate || 'null'}`] : []),
    ];
    if (changed.length) {
      const family = currentTask.source === 'project-step' ? '/project-instances/steps' : '/tasks';
      appendReceipt(`PATCH ${family}/${currentTask.id} {${changed.join(',')}} → 200`);
    }
    setInspector(null);
    notify('Planner-supported details saved');
  };

  const addCollaborator = (member: typeof plannerMembers[number]) => {
    if (!currentTask || currentTask.source !== 'task') return;
    setTasks((current) => current.map((task) => task.id === currentTask.id ? { ...task, collaborators: [...(task.collaborators ?? []), member] } : task));
    appendReceipt(`POST /tasks/${currentTask.id}/collaborators {userId} → 201`);
    setCollaboratorPickerOpen(false);
    notify(`${member.name} added`);
  };

  const removeCollaborator = (memberId: string) => {
    if (!currentTask || currentTask.source !== 'task') return;
    setTasks((current) => current.map((task) => task.id === currentTask.id ? { ...task, collaborators: (task.collaborators ?? []).filter((member) => member.id !== memberId) } : task));
    appendReceipt(`DELETE /tasks/${currentTask.id}/collaborators/${memberId} → 204`);
    appendReceipt(`GET /tasks/${currentTask.id}/collaborators → 200`);
    notify('Collaborator removed');
  };

  const runQuickAction = (label: string) => {
    if (!currentTask) return;
    createSession({ name: `${label}: ${currentTask.title}`, taskId: currentTask.id });
    notify('POST /agent-sessions {cwd,name,agentId,mcpRole,taskId} → 201');
    setInspector(null);
    navigate('/agents');
  };

  const closeInspector = () => {
    setInspector(null);
    setCollaboratorPickerOpen(false);
  };

  return (
    <section className="page-shell pg-planner" data-testid="page-planner" aria-labelledby="planner-title">
      <header className="planner-toolbar">
        <div className="planner-heading"><h1 id="planner-title">Planner</h1><p data-testid="planner-week-label">Week of {weekFormatter.format(isoWeekMonday(week))}</p></div>
        <div className="planner-summary" aria-label="Week summary">
          <span><strong data-testid="planner-summary-open">{scheduledOpen}</strong> scheduled open</span>
          <span><strong data-testid="planner-summary-done">{doneCount}</strong> completed</span>
          <span><strong data-testid="planner-summary-unscheduled">{backlog.length}</strong> backlog</span>
        </div>
        <div className="planner-header-actions"><HeaderTaskAction onClick={() => setInspector({ kind: 'create' })} disabled={!contentVisible || readonly} describedBy={readonly ? 'planner-readonly-reason' : undefined} testId="planner-header-add-task" /><nav className="week-controls" aria-label="Week navigation">
          <button className="secondary-button" type="button" aria-label="Previous week" onClick={() => changeWeek(adjacentWeek(week, -1))} data-testid="planner-prev-week">←</button>
          <button className="secondary-button" type="button" disabled={week === PLANNER_CURRENT_WEEK} aria-describedby={week === PLANNER_CURRENT_WEEK ? 'planner-today-reason' : undefined} title={week === PLANNER_CURRENT_WEEK ? 'Already showing the current week' : 'Return to the current week'} onClick={() => changeWeek(PLANNER_CURRENT_WEEK)} data-testid="planner-today">Today</button>
          <button className="secondary-button" type="button" aria-label="Next week" onClick={() => changeWeek(adjacentWeek(week, 1))} data-testid="planner-next-week">→</button>
          <span className="sr-only" id="planner-today-reason">Today is unavailable because the current week is already visible.</span>
        </nav></div>
      </header>

      <div className="planner-scroll">
        {!contentVisible && <StatePanel state={surfaceState} onRetry={retry} onCreate={() => setInspector({ kind: 'create' })} />}
        {contentVisible && <>
          {readonly && <div className="readonly-banner" id="planner-readonly-reason" role="status" data-testid="page-state-readonly"><strong>Read-only permission</strong><span>You can inspect tasks and calendar context. Editing, scheduling, selection, and completion require Planner editor permission.</span></div>}
          <fieldset className="mutation-gate" disabled={readonly} aria-disabled={readonly || undefined} aria-describedby={readonly ? 'planner-readonly-reason' : undefined} data-testid="planner-mutations"><legend className="sr-only">Planner mutation controls</legend></fieldset>

          {selectedIds.length > 0 && <aside className="selection-bar" aria-label="Selected tasks"><strong data-testid="planner-selection-count">{selectedIds.length} selected</strong><button className="primary-button" type="button" disabled={readonly} onClick={bulkComplete} data-testid="planner-bulk-complete">Mark complete</button><button className="text-button" type="button" disabled={readonly} onClick={() => setSelectedIds([])} data-testid="planner-clear-selection">Clear</button></aside>}

          <section className="planner-board" aria-label="Weekly plan">
            <aside className="backlog-lane" data-testid="planner-backlog">
              <header><div><span className="eyebrow">Unscheduled</span><h2>Backlog</h2></div><span className="count-badge" data-testid="planner-backlog-count">{backlog.length}</span></header>
              <p>Open work without a date, including overdue project steps.</p>
              <button className="secondary-button add-control" type="button" disabled={readonly} aria-describedby={readonly ? 'planner-readonly-reason' : undefined} onClick={() => setInspector({ kind: 'create' })} data-testid="planner-add-backlog-task">+ Add unscheduled task</button>
              <div className="lane-list">{backlog.map((task) => <TaskCard key={task.id} task={task} readonly={readonly} selected={selectedIds.includes(task.id)} onInspect={(item) => setInspector({ kind: 'task', id: item.id })} onComplete={toggleComplete} onSelect={toggleSelected} onDragStart={onDragStart} />)}</div>
            </aside>

            <div className="days-grid">
              {days.map((day) => {
                const events = week === PLANNER_CURRENT_WEEK ? plannerEvents.filter((event) => event.date === day.date) : [];
                const dayTasks = tasks.filter((task) => placementDate(task) === day.date && (filter === 'all' || task.status === 'open'));
                return <section className={`day-lane ${day.isToday ? 'today' : ''}`} key={day.date} aria-labelledby={`planner-day-title-${day.date}`} onDragOver={(event) => { if (!readonly) event.preventDefault(); }} onDrop={(event) => dropOnDay(event, day.date)} data-testid={`planner-day-${day.date}`}>
                  <header><span>{day.weekday}</span><h2 id={`planner-day-title-${day.date}`}>{day.monthDay}</h2>{day.isToday && <em>Today</em>}</header>
                  <div className="event-list">{events.map((event) => <CalendarEvent key={event.id} event={event} onInspect={(item) => setInspector({ kind: 'event', id: item.id })} />)}</div>
                  <div className="lane-list">{dayTasks.map((task) => <TaskCard key={task.id} task={task} readonly={readonly} selected={selectedIds.includes(task.id)} onInspect={(item) => setInspector({ kind: 'task', id: item.id })} onComplete={toggleComplete} onSelect={toggleSelected} onDragStart={onDragStart} />)}</div>
                  <button className="text-button add-control" type="button" disabled={readonly} aria-describedby={readonly ? 'planner-readonly-reason' : undefined} onClick={() => setInspector({ kind: 'create', scheduledDate: day.date })} data-testid={`planner-add-task-${day.date}`}>+ Add task</button>
                </section>;
              })}
            </div>
          </section>

          <div className="filter-control" role="group" aria-label="Task visibility"><button type="button" aria-pressed={filter === 'open'} onClick={() => setFilter('open')} data-testid="planner-filter-open">Open</button><button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} data-testid="planner-filter-all">All</button></div>
        </>}
      </div>

      <aside className="page-trace" aria-label="Planner endpoint receipts" data-testid="page-trace"><span>Wire receipts</span><ol>{receipts.map((receipt, index) => <li key={`${index}-${receipt}`}>{receipt}</li>)}</ol></aside>

      <FocusDialog open={inspector?.kind === 'create'} onClose={closeInspector} title="Add task" description="Set the task details now. More people and agent handoffs are available after creation." testId="planner-create-task-dialog">
        <TaskCreateForm idPrefix="planner-create" onSubmit={createTask} onCancel={closeInspector} members={plannerMembers} defaultScheduledDate={inspector?.kind === 'create' ? inspector.scheduledDate ?? '' : ''} testIds={{ title: 'planner-create-title', notes: 'planner-create-notes', scheduledDate: 'planner-create-scheduled-date', dueDate: 'planner-create-due-date', collaborator: 'planner-create-collaborator', cancel: 'planner-create-task-cancel', submit: 'planner-create-task-submit' }} />
      </FocusDialog>

      <FocusDialog open={Boolean(currentTask)} onClose={closeInspector} title={readonly ? 'Task details' : currentTask?.source === 'project-step' ? 'Edit project step' : 'Edit task'} description={currentTask?.source === 'project-step' ? `Source-owned by ${currentTask.projectName}. Only notes and due date persist from Planner.` : readonly ? 'Inspection remains available with read-only Planner permission.' : 'Planner persists notes and date fields for existing tasks.'} testId="planner-inspector">
        {currentTask && (readonly ? <article className="readonly-details"><span className="eyebrow">Read only</span><h3>{currentTask.title}</h3><p>{currentTask.notes || 'No notes'}</p><dl><div><dt>Scheduled</dt><dd>{currentTask.scheduledDate ?? 'Unscheduled'}</dd></div><div><dt>Due</dt><dd>{currentTask.dueDate ?? 'No due date'}</dd></div></dl></article> : <>
          <form className="inspector-form task-editor-form" onSubmit={saveTask}>
            <p className="inspector-record-title">{currentTask.title}</p>
            <label className="task-editor-field">Task notes<textarea name="notes" rows={4} defaultValue={currentTask.notes} data-autofocus data-testid="planner-edit-notes" /></label>
            <div className="field-pair task-editor-pair">{currentTask.source === 'task' && <label className="task-editor-field">Scheduled date<input name="scheduledDate" type="date" defaultValue={currentTask.scheduledDate ?? ''} data-testid="planner-edit-scheduled-date" /></label>}<label className="task-editor-field">Due date<input name="dueDate" type="date" defaultValue={currentTask.dueDate ?? ''} data-testid="planner-edit-due-date" /></label></div>
            {currentTask.source === 'task' && <section className="collaborators task-editor-section" aria-labelledby="planner-collaborators-title"><div className="subhead task-editor-section-head"><h3 id="planner-collaborators-title">Collaborators</h3><button className="secondary-button" type="button" onClick={() => setCollaboratorPickerOpen((value) => !value)} data-testid="planner-add-collaborator">Add collaborator</button></div><div className="collaborator-chips">{(currentTask.collaborators ?? []).map((member) => <span key={member.id}>{member.name}<button type="button" aria-label={`Remove ${member.name}`} onClick={() => removeCollaborator(member.id)} data-testid={`planner-remove-collaborator-${member.id}`}>×</button></span>)}</div>{collaboratorPickerOpen && <div className="collaborator-picker" role="listbox" aria-label="Workspace members">{plannerMembers.filter((member) => !(currentTask.collaborators ?? []).some((existing) => existing.id === member.id)).map((member) => <button type="button" role="option" aria-selected="false" key={member.id} onClick={() => addCollaborator(member)} data-testid={`planner-collaborator-option-${member.id}`}>{member.name}</button>)}</div>}</section>}
            <section className="quick-actions" aria-labelledby="planner-quick-actions-title"><h3 id="planner-quick-actions-title">Agent handoff</h3>{['Help me finish this', 'Draft next steps', 'Summarize', 'Create follow-up tasks'].map((label) => <button className="secondary-button" type="button" key={label} onClick={() => runQuickAction(label)} data-testid={`planner-quick-${label.toLowerCase().replaceAll(' ', '-')}`}>{label}</button>)}</section>
            <footer className="task-editor-footer"><button className="text-button" type="button" onClick={() => navigate(currentTask.source === 'project-step' ? '/projects' : '/tasks')} data-testid={`planner-open-${currentTask.source === 'project-step' ? 'projects' : 'tasks'}`}>Open in {currentTask.source === 'project-step' ? 'Projects' : 'Tasks'}</button><button className="secondary-button" type="button" onClick={closeInspector} data-testid="planner-edit-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="planner-save-task">Save changes</button></footer>
          </form>
        </>)}
      </FocusDialog>

      <FocusDialog open={Boolean(currentEvent)} onClose={closeInspector} title="Calendar event" description="Calendar shadow events provide planning context and cannot be changed here." testId="planner-calendar-inspector">
        {currentEvent && <article className="readonly-details"><span className="eyebrow">READ ONLY</span><h3>{currentEvent.title}</h3><p>{currentEvent.notes}</p><dl><div><dt>Date</dt><dd>{currentEvent.date}</dd></div><div><dt>Time</dt><dd>{currentEvent.timeLabel}</dd></div></dl></article>}
      </FocusDialog>
    </section>
  );
}

function isoWeekLabelForDate(date: Date): string {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + (4 - (thursday.getUTCDay() || 7)));
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + (4 - (firstThursday.getUTCDay() || 7)));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function requestedLiveWeek(): string {
  const raw = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('week');
  return raw && /^\d{4}-W\d{2}$/.test(raw) ? raw : isoWeekLabelForDate(new Date());
}

// Fixture weekDays() hardcodes "today" as the fixed 2026-08-12 demo date; Live needs the real date.
function liveWeekDays(label: string) {
  const monday = isoWeekMonday(label);
  const todayIso = isoDate(new Date());
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + offset);
    const iso = isoDate(date);
    return { date: iso, weekday: dayFormatter.format(date), monthDay: monthDayFormatter.format(date), isToday: iso === todayIso };
  });
}

// apps/api_server/src/repositories/project_instances_repository.ts:118 — sourceType: 'project_step'
function isProjectStep(task: Task): boolean {
  return task.sourceType === 'project_step';
}
// apps/api_server/src/services/weekly_planning_service.ts:151 — sourceType: 'calendar_shadow_event'
function isCalendarShadow(task: Task): boolean {
  return task.sourceType === 'calendar_shadow_event';
}

function LiveTaskCard({ task, selected, onInspect, onComplete, onSelect, onDragStart }: {
  task: Task;
  selected: boolean;
  onInspect(task: Task): void;
  onComplete(task: Task): void;
  onSelect(task: Task): void;
  onDragStart(event: DragEvent<HTMLButtonElement>, task: Task): void;
}) {
  const readonly = isCalendarShadow(task);
  const sourceLabel = isProjectStep(task) ? task.sourceName ?? 'Project step' : `${task.energy ?? '-'} Task`;
  // data-source-id is the task's own canonical id, not task.sourceId (the owning instance for
  // project steps) — apps/api_server/src/repositories/project_instances_repository.ts:106-129
  // maps a step's own row.id onto Task.id, so this proves the real step id survived unchanged.
  return (
    <article className={`planner-task ${isProjectStep(task) ? 'project-step' : ''} ${selected ? 'selected' : ''}`} data-status={task.status} data-source-type={task.sourceType ?? undefined} data-source-id={task.id}>
      <button className="task-main" type="button" draggable={!readonly} aria-label={`Inspect ${task.title}`} onDragStart={(event) => onDragStart(event, task)} onClick={() => onInspect(task)} data-testid={`planner-task-${task.id}`} data-task-title="true">
        <span className="task-source">{sourceLabel}</span>
        <strong>{task.title}</strong>
        {task.dueDate ? <small data-testid={`planner-task-due-${task.id}`}>Due {task.dueDate}</small> : null}
      </button>
      {!readonly && <div className="task-controls">
        <button type="button" aria-label={`Select ${task.title}`} aria-pressed={selected} onClick={() => onSelect(task)} data-testid={`planner-task-select-${task.id}`}><span aria-hidden="true">{selected ? '◆' : '◇'}</span></button>
        <button type="button" aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => onComplete(task)} data-testid={`planner-complete-${task.id}`}><span aria-hidden="true">{task.status === 'done' ? '↺' : '✓'}</span></button>
      </div>}
    </article>
  );
}

function LivePlannerPage({ route }: { route: string }) {
  const { notify } = useFixtures();
  // apps/web/src/gateway/index.ts:99 — every domain shares the one bearer from the signed-in
  // session; Planner must not build its own gateway from a build-time/test-only env value.
  const rendererGateway = useGateway();
  const gateway = rendererGateway.domains.planner!;
  const [surfaceState, setSurfaceState] = useState<PlannerSurfaceState>('loading');
  const [week, setWeek] = useState(requestedLiveWeek);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [receipts, setReceipts] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspectorTaskId, setInspectorTaskId] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<TaskCollaborator[]>([]);
  const [collaboratorId, setCollaboratorId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createScheduledDate, setCreateScheduledDate] = useState<string | undefined>(undefined);
  const [mutationPending, setMutationPending] = useState(false);
  const [quickActionPending, setQuickActionPending] = useState(false);

  const appendReceipt = (line: string) => setReceipts((current) => [...current, line]);
  const days = useMemo(() => liveWeekDays(week), [week]);

  const recordError = (method: string, path: string, error: unknown): string => {
    const status = error instanceof PlannerGatewayError ? error.status : 0;
    const message = error instanceof PlannerGatewayError ? error.message : 'Planner service unavailable';
    appendReceipt(`${method} ${path} → ${status || 'network error'}`);
    setSurfaceState(status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'unavailable' : 'server-error');
    return message;
  };

  const load = async (targetWeek: string) => {
    setSurfaceState('loading');
    try {
      // apps/api_server/src/routes/weekly_plan_routes.ts:9
      const loaded = await gateway.plan(targetWeek);
      setPlan(loaded);
      setErrorMessage(null);
      appendReceipt(`GET /weekly-plan?week=${targetWeek} → 200`);
      const hasWork = loaded.backlog.length > 0 || loaded.days.some((day) => day.tasks.length > 0);
      setSurfaceState(hasWork ? 'ready' : 'empty');
    } catch (error) {
      setErrorMessage(recordError('GET', `/weekly-plan?week=${targetWeek}`, error));
    }
  };

  useEffect(() => { void load(week); }, [gateway, week]);

  const writeQuery = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    for (const [key, value] of Object.entries(updates)) value === null ? params.delete(key) : params.set(key, value);
    const query = params.toString();
    history.replaceState(null, '', `#${route}${query ? `?${query}` : ''}`);
  };

  const changeWeek = (next: string) => { setWeek(next); writeQuery({ week: next }); };

  const allTasks = useMemo(() => plan ? [...plan.backlog, ...plan.days.flatMap((day) => day.tasks)] : [], [plan]);
  const currentTask = inspectorTaskId ? allTasks.find((task) => task.id === inspectorTaskId) ?? null : null;

  const toggleComplete = async (task: Task) => {
    if (mutationPending || isCalendarShadow(task)) return;
    setMutationPending(true);
    // apps/api_server/src/models/task.ts:7 (TaskStatus) / apps/api_server/src/models/project_instance.ts:8 (ProjectInstanceStep.status)
    const nextStatus: 'open' | 'done' = task.status === 'done' ? 'open' : 'done';
    try {
      if (isProjectStep(task) && task.sourceId) {
        await gateway.updateProjectStep(task.sourceId, { status: nextStatus });
        appendReceipt(`PATCH /project-instances/steps/${task.sourceId} {status:${nextStatus}} → 200`);
      } else {
        await gateway.updateTask(task.id, { status: nextStatus });
        appendReceipt(`PATCH /tasks/${task.id} {status:${nextStatus}} → 200`);
      }
      setSelectedIds((current) => current.filter((id) => id !== task.id));
      notify(nextStatus === 'done' ? 'Task marked complete.' : `${task.title} reopened`);
      await load(week);
    } catch (error) { setErrorMessage(recordError('PATCH', `/tasks/${task.id}`, error)); } finally { setMutationPending(false); }
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>, task: Task) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/planner-task', task.id);
    event.dataTransfer.setData('text/plain', task.id);
  };

  const moveTask = async (taskId: string, date: string) => {
    const task = allTasks.find((item) => item.id === taskId);
    if (!task || mutationPending || isCalendarShadow(task) || task.status === 'done') return;
    setMutationPending(true);
    try {
      if (isProjectStep(task) && task.sourceId) {
        // apps/api_server/src/routes/project_instances_routes.ts:13
        await gateway.updateProjectStep(task.sourceId, { dueDate: date });
        appendReceipt(`PATCH /project-instances/steps/${task.sourceId} {dueDate:${date}} → 200`);
      } else {
        // apps/api_server/src/routes/weekly_plan_routes.ts:10
        await gateway.scheduleTask(task.id, { scheduledDate: date });
        appendReceipt(`PATCH /weekly-plan/tasks/${task.id} {scheduledDate:${date}} → 200`);
      }
      notify(`${task.title} scheduled for ${date}`);
      await load(week);
    } catch (error) { setErrorMessage(recordError('PATCH', `/weekly-plan/tasks/${taskId}`, error)); } finally { setMutationPending(false); }
  };

  const dropOnDay = (event: DragEvent<HTMLElement>, date: string) => {
    event.preventDefault();
    void moveTask(event.dataTransfer.getData('text/planner-task') || event.dataTransfer.getData('text/plain'), date);
  };

  const toggleSelected = (task: Task) => setSelectedIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]);

  const openInspector = async (task: Task) => {
    setInspectorTaskId(task.id);
    setCollaboratorId('');
    setCollaborators([]);
    if (isProjectStep(task) || isCalendarShadow(task)) return;
    try {
      // apps/api_server/src/routes/tasks_routes.ts:14
      const loaded = await gateway.taskCollaborators(task.id);
      setCollaborators(loaded);
      appendReceipt(`GET /tasks/${task.id}/collaborators → 200`);
    } catch (error) { recordError('GET', `/tasks/${task.id}/collaborators`, error); }
  };

  const closeInspector = () => { setInspectorTaskId(null); setCollaborators([]); };

  const addCollaborator = async () => {
    if (!currentTask || !collaboratorId.trim()) return;
    const userId = Number(collaboratorId);
    if (!Number.isInteger(userId)) return;
    try {
      // apps/api_server/src/routes/tasks_routes.ts:15
      const updated = await gateway.addTaskCollaborator(currentTask.id, userId);
      setCollaborators(updated);
      appendReceipt(`POST /tasks/${currentTask.id}/collaborators {userId} → 201`);
      setCollaboratorId('');
      notify('Collaborator added');
    } catch (error) { setErrorMessage(recordError('POST', `/tasks/${currentTask.id}/collaborators`, error)); }
  };

  const removeCollaboratorLive = async (userId: number) => {
    if (!currentTask) return;
    try {
      // apps/api_server/src/routes/tasks_routes.ts:16
      await gateway.removeTaskCollaborator(currentTask.id, userId);
      setCollaborators((current) => current.filter((person) => person.userId !== userId));
      appendReceipt(`DELETE /tasks/${currentTask.id}/collaborators/${userId} → 204`);
      notify('Collaborator removed');
    } catch (error) { setErrorMessage(recordError('DELETE', `/tasks/${currentTask.id}/collaborators/${userId}`, error)); }
  };

  // Shared with Dashboard/Tasks (components/quickActions.ts) — one Secretary-session capability,
  // not three separate implementations.
  const launchQuickAction = async (actionId: Parameters<typeof launchQuickActionSession>[1]) => {
    if (!currentTask || quickActionPending) return;
    setQuickActionPending(true);
    try {
      const createFollowUpTask = async (): Promise<QuickActionTaskContext> => {
        const created = await gateway.createTask({ title: `Follow-up: ${currentTask.title}` });
        appendReceipt('POST /tasks {title} → 201');
        await load(week);
        return { id: created.id, title: created.title };
      };
      await launchQuickActionSession(rendererGateway.domains.sessions!, actionId, { id: currentTask.id, title: currentTask.title }, actionId === 'follow-up-tasks' ? createFollowUpTask : undefined);
      appendReceipt('POST /agent-sessions {profileId,mcpRole,cwd,name,taskId} → 201');
      notify('Secretary session created');
      navigate('/agents');
    } catch (error) { setErrorMessage(recordError('POST', '/agent-sessions', error)); } finally { setQuickActionPending(false); }
  };

  const saveTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentTask) return;
    const data = new FormData(event.currentTarget);
    const notes = String(data.get('notes') ?? '');
    const scheduledDate = String(data.get('scheduledDate') ?? '').trim();
    const dueDate = String(data.get('dueDate') ?? '').trim();
    setMutationPending(true);
    try {
      if (isProjectStep(currentTask) && currentTask.sourceId) {
        await gateway.updateProjectStep(currentTask.sourceId, { notes, dueDate: dueDate || undefined });
        appendReceipt(`PATCH /project-instances/steps/${currentTask.sourceId} {notes,dueDate} → 200`);
      } else {
        await gateway.updateTask(currentTask.id, { notes, scheduledDate: scheduledDate || undefined, dueDate: dueDate || undefined });
        appendReceipt(`PATCH /tasks/${currentTask.id} {notes,dueDate,scheduledDate} → 200`);
      }
      notify('Planner-supported details saved');
      closeInspector();
      await load(week);
    } catch (error) { setErrorMessage(recordError('PATCH', `/tasks/${currentTask.id}`, error)); } finally { setMutationPending(false); }
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') ?? '').trim();
    if (!title) return;
    const notes = String(data.get('notes') ?? '').trim();
    const dueDate = String(data.get('dueDate') ?? '').trim();
    const scheduledDate = String(data.get('scheduledDate') ?? '').trim();
    setMutationPending(true);
    try {
      // Server assigns the id; the created record is read back through the next plan() load,
      // never invented client-side.
      await gateway.createTask({ title, notes: notes || undefined, dueDate: dueDate || undefined, scheduledDate: scheduledDate || undefined });
      appendReceipt(`POST /tasks {title${notes ? ',notes' : ''}${dueDate ? ',dueDate' : ''}${scheduledDate ? ',scheduledDate' : ''}} → 201`);
      setCreateOpen(false);
      notify(`${title} added to Planner`);
      await load(week);
    } catch (error) { setErrorMessage(recordError('POST', '/tasks', error)); } finally { setMutationPending(false); }
  };

  const contentVisible = surfaceState === 'ready';
  const backlog = plan?.backlog ?? [];
  const doneCount = allTasks.filter((task) => task.status === 'done').length;
  const scheduledOpen = allTasks.filter((task) => task.status === 'open' && (plan?.days.some((day) => day.tasks.some((entry) => entry.id === task.id)) ?? false)).length;

  return (
    <section className="page-shell pg-planner" data-testid="page-planner" aria-labelledby="planner-title">
      <header className="planner-toolbar">
        <div className="planner-heading"><h1 id="planner-title">Planner</h1><p data-testid="planner-week-label">Week of {weekFormatter.format(isoWeekMonday(week))}</p></div>
        <div className="planner-summary" aria-label="Week summary">
          <span><strong data-testid="planner-summary-open">{scheduledOpen}</strong> scheduled open</span>
          <span><strong data-testid="planner-summary-done">{doneCount}</strong> completed</span>
          <span><strong data-testid="planner-summary-unscheduled">{backlog.length}</strong> backlog</span>
        </div>
        <div className="planner-header-actions">
          <HeaderTaskAction onClick={() => { setCreateScheduledDate(undefined); setCreateOpen(true); }} disabled={!contentVisible || mutationPending} testId="planner-header-add-task" />
          <nav className="week-controls" aria-label="Week navigation">
            <button className="secondary-button" type="button" aria-label="Previous week" onClick={() => changeWeek(adjacentWeek(week, -1))} data-testid="planner-prev-week">←</button>
            <button className="secondary-button" type="button" onClick={() => changeWeek(isoWeekLabelForDate(new Date()))} data-testid="planner-today">Today</button>
            <button className="secondary-button" type="button" aria-label="Next week" onClick={() => changeWeek(adjacentWeek(week, 1))} data-testid="planner-next-week">→</button>
          </nav>
        </div>
      </header>

      <div className="planner-scroll">
        {!contentVisible && <StatePanel state={surfaceState as Exclude<PlannerSurfaceState, 'ready' | 'readonly'>} onRetry={() => void load(week)} onCreate={() => { setCreateScheduledDate(undefined); setCreateOpen(true); }} />}
        {contentVisible && plan && <>
          {errorMessage && <div className="readonly-banner" role="alert" data-testid="planner-mutation-error">{errorMessage}</div>}
          {selectedIds.length > 0 && <aside className="selection-bar" aria-label="Selected tasks"><strong data-testid="planner-selection-count">{selectedIds.length} selected</strong><button className="text-button" type="button" onClick={() => setSelectedIds([])} data-testid="planner-clear-selection">Clear</button></aside>}

          <section className="planner-board" aria-label="Weekly plan">
            <aside className="backlog-lane" data-testid="planner-backlog">
              <header><div><span className="eyebrow">Unscheduled</span><h2>Backlog</h2></div><span className="count-badge" data-testid="planner-backlog-count">{backlog.length}</span></header>
              <p>Open work without a date, including overdue project steps.</p>
              <button className="secondary-button add-control" type="button" disabled={mutationPending} onClick={() => { setCreateScheduledDate(undefined); setCreateOpen(true); }} data-testid="planner-add-backlog-task">+ Add unscheduled task</button>
              <div className="lane-list">{backlog.map((task) => <LiveTaskCard key={task.id} task={task} selected={selectedIds.includes(task.id)} onInspect={(item) => void openInspector(item)} onComplete={(item) => void toggleComplete(item)} onSelect={toggleSelected} onDragStart={onDragStart} />)}</div>
            </aside>

            <div className="days-grid">
              {days.map((day) => {
                const dayTasks = plan.days.find((entry) => entry.date === day.date)?.tasks ?? [];
                return <section className={`day-lane ${day.isToday ? 'today' : ''}`} key={day.date} aria-labelledby={`planner-day-title-${day.date}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnDay(event, day.date)} data-testid={`planner-day-${day.date}`}>
                  <header><span>{day.weekday}</span><h2 id={`planner-day-title-${day.date}`}>{day.monthDay}</h2>{day.isToday && <em>Today</em>}</header>
                  <div className="lane-list">{dayTasks.map((task) => <LiveTaskCard key={task.id} task={task} selected={selectedIds.includes(task.id)} onInspect={(item) => void openInspector(item)} onComplete={(item) => void toggleComplete(item)} onSelect={toggleSelected} onDragStart={onDragStart} />)}</div>
                  <button className="text-button add-control" type="button" disabled={mutationPending} onClick={() => { setCreateScheduledDate(day.date); setCreateOpen(true); }} data-testid={`planner-add-task-${day.date}`}>+ Add task</button>
                </section>;
              })}
            </div>
          </section>
        </>}
      </div>

      <aside className="page-trace" aria-label="Planner endpoint receipts" data-testid="page-trace"><span>Wire receipts</span><ol>{receipts.map((receipt, index) => <li key={`${index}-${receipt}`}>{receipt}</li>)}</ol></aside>

      <FocusDialog open={createOpen} onClose={() => setCreateOpen(false)} title="Add task" description="Set the task details now." testId="planner-create-task-dialog">
        <TaskCreateForm idPrefix="planner-create" onSubmit={(event) => void createTask(event)} onCancel={() => setCreateOpen(false)} members={[]} defaultScheduledDate={createScheduledDate ?? ''} disabled={mutationPending} testIds={{ title: 'planner-create-title', notes: 'planner-create-notes', scheduledDate: 'planner-create-scheduled-date', dueDate: 'planner-create-due-date', collaborator: 'planner-create-collaborator', cancel: 'planner-create-task-cancel', submit: 'planner-create-task-submit' }} />
      </FocusDialog>

      <FocusDialog open={Boolean(currentTask)} onClose={closeInspector} title={currentTask && isProjectStep(currentTask) ? 'Edit project step' : 'Edit task'} description={currentTask && isProjectStep(currentTask) ? `Source-owned by ${currentTask.sourceName ?? 'its project'}. Only notes and due date persist from Planner.` : 'Planner persists notes and date fields for existing tasks.'} testId="planner-inspector">
        {currentTask && (isCalendarShadow(currentTask) ? <article className="readonly-details"><span className="eyebrow">Read only</span><h3>{currentTask.title}</h3><p>{currentTask.notes || 'No notes'}</p></article> : <form className="inspector-form task-editor-form" onSubmit={(event) => void saveTask(event)}>
          <p className="inspector-record-title">{currentTask.title}</p>
          <label className="task-editor-field">Task notes<textarea name="notes" rows={4} defaultValue={currentTask.notes ?? ''} data-autofocus data-testid="planner-edit-notes" /></label>
          <div className="field-pair task-editor-pair">{!isProjectStep(currentTask) && <label className="task-editor-field">Scheduled date<input name="scheduledDate" type="date" defaultValue={currentTask.scheduledDate ?? ''} data-testid="planner-edit-scheduled-date" /></label>}<label className="task-editor-field">Due date<input name="dueDate" type="date" defaultValue={currentTask.dueDate ?? ''} data-testid="planner-edit-due-date" /></label></div>
          {!isProjectStep(currentTask) && <section className="collaborators task-editor-section" aria-labelledby="planner-collaborators-title">
            <div className="subhead task-editor-section-head"><h3 id="planner-collaborators-title">Collaborators</h3></div>
            <div className="collaborator-chips">{collaborators.map((person) => <span key={person.userId}>{person.name}<button type="button" aria-label={`Remove ${person.name}`} onClick={() => void removeCollaboratorLive(person.userId)} data-testid={`planner-remove-collaborator-${person.userId}`}>×</button></span>)}</div>
            <div className="inspector-pair"><input type="number" placeholder="User id" value={collaboratorId} onChange={(event) => setCollaboratorId(event.target.value)} data-testid="planner-collaborator-input" /><button className="secondary-button" type="button" onClick={() => void addCollaborator()} data-testid="planner-add-collaborator">Add collaborator</button></div>
          </section>}
          <section className="quick-actions" aria-labelledby="planner-quick-actions-title"><h3 id="planner-quick-actions-title">Agent handoff</h3>{quickActionPresets.map((action) => <button className="secondary-button" type="button" disabled={quickActionPending} key={action.id} onClick={() => void launchQuickAction(action.id)} data-testid={`quick-action-${action.id}`}>{action.label}</button>)}</section>
          <footer className="task-editor-footer"><button className="secondary-button" type="button" onClick={closeInspector} data-testid="planner-edit-cancel">Cancel</button><button className="primary-button" type="submit" disabled={mutationPending} data-testid="planner-save-task">Save changes</button></footer>
        </form>)}
      </FocusDialog>
    </section>
  );
}

export function PlannerPage(props: { route: string }) {
  const gateway = useGateway();
  return gateway.mode === 'live' ? <LivePlannerPage {...props} /> : <FixturePlannerPage {...props} />;
}
