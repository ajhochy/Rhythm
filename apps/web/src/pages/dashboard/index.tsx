import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { HeaderTaskAction } from '../../components/HeaderTaskAction';
import { TaskCreateForm } from '../../components/TaskCreateForm';
import { navigate } from '../../components/Shell';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import { useAuthUser } from '../../gateway/auth';
import { useWorkspaceMembers } from '../../components/useWorkspaceMembers';
import { DashboardGatewayError, type DashboardSummary } from '../../gateway/dashboard';
import type { Task, TaskCollaborator, TaskStatus as LiveTaskStatus } from '../../gateway/planner';
import { launchQuickActionSession, quickActionPresets, type QuickActionPresetId, type QuickActionTaskContext } from '../../components/quickActions';
import {
  dashboardCollaborators,
  dashboardProject,
  dashboardTasks,
  dashboardThread,
  initialDashboardReceipts,
  type DashboardProjectStep,
  type DashboardTask,
} from './fixtures';
import './styles.css';

type DashboardOnDeckStep = DashboardSummary['projects']['items'][number]['onDeckSteps'][number];

type DashboardSurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type QuickAction = 'Help me finish this' | 'Draft next steps' | 'Summarize' | 'Create follow-up tasks';

const supportedStates: DashboardSurfaceState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];
const quickActions: Array<{ id: string; label: QuickAction }> = [
  { id: 'help-finish', label: 'Help me finish this' },
  { id: 'draft-next-steps', label: 'Draft next steps' },
  { id: 'summarize', label: 'Summarize' },
  { id: 'follow-up-tasks', label: 'Create follow-up tasks' },
];

function requestedSurfaceState(): DashboardSurfaceState {
  const requested = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('state');
  return supportedStates.includes(requested as DashboardSurfaceState) ? requested as DashboardSurfaceState : 'ready';
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function StatePanel({ state, onRetry, onEmpty }: { state: Exclude<DashboardSurfaceState, 'ready' | 'readonly'>; onRetry(): void; onEmpty(): void }) {
  if (state === 'loading') {
    return <section className="dashboard-state loading" role="status" aria-live="polite" data-testid="page-state-loading"><span className="state-mark" aria-hidden="true">◌</span><span className="eyebrow">Refreshing planning data</span><h2>Loading dashboard…</h2><p>Fetching the summary and active project steps.</p><div className="state-skeleton" aria-hidden="true"><span /><span /><span /></div></section>;
  }
  if (state === 'empty') {
    return <section className="dashboard-state" role="status" data-testid="page-state-empty"><span className="state-mark" aria-hidden="true">＋</span><span className="eyebrow">A clear workspace</span><h2>No planning work yet</h2><p>Create the first task to give this week a starting point.</p><button className="primary-button" type="button" onClick={onEmpty} data-testid="dashboard-empty-primary">Create the first task</button></section>;
  }
  if (state === 'server-error') {
    return <section className="dashboard-state danger" role="alert" data-testid="page-state-server-error"><span className="state-code">503</span><span className="eyebrow">Retryable server error</span><h2>Dashboard could not load</h2><p>The planning service returned a temporary error. Existing data remains unchanged.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  }
  if (state === 'forbidden') {
    return <section className="dashboard-state warning" role="alert" data-testid="page-state-forbidden"><span className="state-code">403</span><span className="eyebrow">Workspace permission required</span><h2>Dashboard access is restricted</h2><p>Ask a workspace administrator for planning access before viewing this summary.</p></section>;
  }
  return <section className="dashboard-state warning" role="status" data-testid="page-state-unavailable"><span className="state-mark" aria-hidden="true">◇</span><span className="eyebrow">Planning service prerequisite</span><h2>Planning data is unavailable</h2><p>Reconnect the planning service before refreshing tasks and projects.</p></section>;
}

function TaskEntry({ task, readonly, onInspect, onToggle }: { task: DashboardTask; readonly: boolean; onInspect(task: DashboardTask): void; onToggle(task: DashboardTask): void }) {
  return (
    <article className="task-entry">
      <button className="task-toggle" type="button" disabled={readonly} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => onToggle(task)} data-testid={`task-toggle-${task.id.replace('task-', '')}`}><span aria-hidden="true">{task.status === 'done' ? '✓' : '○'}</span></button>
      <button className="task-row" type="button" onClick={() => onInspect(task)} data-status={task.status} data-testid={`task-row-${task.id.replace('task-', '')}`}>
        <span className="row-copy"><strong>{task.title}</strong><small>{task.collaborator ? `${task.collaborator} · ` : ''}{task.dueLabel}</small></span>
        <span className="row-status">{task.status}</span>
      </button>
    </article>
  );
}

function ProjectStepEntry({ step, readonly, onInspect, onToggle }: { step: DashboardProjectStep; readonly: boolean; onInspect(step: DashboardProjectStep): void; onToggle(step: DashboardProjectStep): void }) {
  return (
    <article className="task-entry">
      <button className="task-toggle" type="button" disabled={readonly} aria-label={`${step.status === 'done' ? 'Reopen' : 'Complete'} ${step.title}`} onClick={() => onToggle(step)} data-testid={`project-step-toggle-${step.id.replace('step-', '')}`}><span aria-hidden="true">{step.status === 'done' ? '✓' : '○'}</span></button>
      <button className="task-row" type="button" onClick={() => onInspect(step)} data-status={step.status} data-testid={`project-step-row-${step.id.replace('step-', '')}`}><span className="row-copy"><strong>{step.title}</strong><small>{step.dueLabel}</small></span><span className="row-status">step</span></button>
    </article>
  );
}

function FixtureDashboardPage({ route }: { route: string }) {
  const { notify } = useFixtures();
  const [surfaceState, setSurfaceState] = useState<DashboardSurfaceState>(requestedSurfaceState);
  const [tasks, setTasks] = useState<DashboardTask[]>(() => structuredClone(dashboardTasks));
  const [projectSteps, setProjectSteps] = useState<DashboardProjectStep[]>(() => structuredClone(dashboardProject.steps));
  const [receipts, setReceipts] = useState<string[]>(() => [...initialDashboardReceipts]);
  const [selectedTask, setSelectedTask] = useState<DashboardTask | null>(null);
  const [selectedStep, setSelectedStep] = useState<DashboardProjectStep | null>(null);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [quickAction, setQuickAction] = useState<QuickAction | null>(null);
  const [titleError, setTitleError] = useState(false);
  const taskTitleRef = useRef<HTMLInputElement>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const isReadonly = surfaceState === 'readonly';
  const isContentVisible = surfaceState === 'ready' || surfaceState === 'readonly';

  useEffect(() => () => { if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current); }, []);

  const todayTasks = tasks.filter((task) => task.bucket === 'today');
  const pastDueTasks = tasks.filter((task) => task.bucket === 'past-due' && task.status === 'open');
  const weekTasks = tasks.filter((task) => task.bucket === 'week' && task.status === 'open');
  const unscheduledTasks = tasks.filter((task) => task.bucket === 'unscheduled' && task.status === 'open');
  const handoffTasks = tasks.filter((task) => task.collaborator && task.status === 'open');
  const openCount = tasks.filter((task) => task.status === 'open').length;
  const todayDone = todayTasks.filter((task) => task.status === 'done').length;
  const weekProgressTasks = tasks.filter((task) => ['task-team-briefing', 'task-morning-setup', 'task-finalize-launch-notes', 'task-volunteer-email'].includes(task.id));
  const weekDone = weekProgressTasks.filter((task) => task.status === 'done').length;
  const projectDone = projectSteps.filter((step) => step.status === 'done').length;
  const nextTask = tasks.find((task) => task.id === 'task-team-briefing') ?? tasks.find((task) => task.status === 'open');

  const projectNextStep = useMemo(() => {
    const intended = projectSteps.find((step) => step.id === dashboardProject.nextStep.id && step.status === 'open');
    return intended ?? projectSteps.find((step) => step.status === 'open');
  }, [projectSteps]);

  const writeStateToUrl = (state: DashboardSurfaceState) => {
    history.replaceState(null, '', `#${route}?state=${state}`);
  };

  const finishRefresh = (normaliseReadyUrl: boolean) => {
    setSurfaceState('ready');
    setReceipts((current) => [...current, 'GET /dashboard/summary → 200', 'GET /project-instances → 200']);
    if (normaliseReadyUrl) writeStateToUrl('ready');
    notify('Dashboard refreshed');
  };

  const refresh = (normaliseReadyUrl = false) => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    setSurfaceState('loading');
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      finishRefresh(normaliseReadyUrl);
    }, 650);
  };

  const recoverEmpty = () => {
    setSurfaceState('ready');
    writeStateToUrl('ready');
    setTaskCreateOpen(true);
  };

  const toggleTask = (task: DashboardTask) => {
    const nextStatus = task.status === 'done' ? 'open' : 'done';
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus } : item));
    setReceipts((current) => [...current, `PATCH /tasks/${task.id} {status:"${nextStatus}"} → 200`]);
    notify(nextStatus === 'done' ? `${task.title} completed` : `${task.title} reopened`);
  };

  const toggleProjectStep = (step: DashboardProjectStep) => {
    const nextStatus = step.status === 'done' ? 'open' : 'done';
    setProjectSteps((current) => current.map((item) => item.id === step.id ? { ...item, status: nextStatus } : item));
    setReceipts((current) => [...current, `PATCH /project-instances/steps/${step.id} {status:"${nextStatus}"} → 200`]);
    notify(nextStatus === 'done' ? `${step.title} completed` : `${step.title} reopened`);
  };

  const inspectTask = (task: DashboardTask) => {
    setSelectedTask(task);
    setReceipts((current) => [...current, `GET /tasks/${task.id}/collaborators → 200`]);
  };

  const updateInspectorCollaborator = (collaborator?: string) => {
    if (!selectedTask) return;
    const prior = selectedTask.collaborator;
    const updated = { ...selectedTask, collaborator };
    setSelectedTask(updated);
    setTasks((current) => current.map((task) => task.id === selectedTask.id ? updated : task));
    setReceipts((current) => [...current, collaborator
      ? `POST /tasks/${selectedTask.id}/collaborators {userId} → 201`
      : `DELETE /tasks/${selectedTask.id}/collaborators/${prior === 'Riley Chen' ? 'workspace-user-2' : 'workspace-user-3'} → 204`]);
    notify(collaborator ? `${collaborator} added` : 'Collaborator removed');
  };

  const createTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) {
      setTitleError(true);
      taskTitleRef.current?.focus();
      return;
    }
    const notes = String(data.get('notes') ?? '').trim();
    const scheduledDate = String(data.get('scheduledDate') ?? '').trim();
    const dueDate = String(data.get('dueDate') ?? '').trim();
    const collaboratorId = String(data.get('collaboratorId') ?? '').trim();
    const collaborator = dashboardCollaborators.find((person) => person.id === collaboratorId);
    const newTask: DashboardTask = { id: 'task-dashboard-new', title, notes, status: 'open', bucket: scheduledDate === '2026-08-12' ? 'today' : scheduledDate ? 'week' : 'unscheduled', scheduledDate: scheduledDate || undefined, dueDate: dueDate || undefined, dueLabel: dueDate || (scheduledDate === '2026-08-12' ? 'Today' : scheduledDate || 'Not scheduled'), collaborator: collaborator?.name };
    setTasks((current) => [...current, newTask]);
    setReceipts((current) => [
      ...current,
      `POST /tasks {title${notes ? ',notes' : ''}${scheduledDate ? ',scheduledDate' : ''}${dueDate ? ',dueDate' : ''}} → 201`,
      ...(collaboratorId ? [`POST /tasks/task-dashboard-new/collaborators {userId} → 201`] : []),
      'GET /dashboard/summary → 200',
      'GET /project-instances → 200',
    ]);
    form.reset();
    setTitleError(false);
    setTaskCreateOpen(false);
    notify(`${title} added to the dashboard`);
  };

  const saveTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTask) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('inspectorTitle') ?? '').trim();
    const notes = String(data.get('inspectorNotes') ?? '').trim();
    const scheduledDate = String(data.get('inspectorScheduledDate') ?? '').trim();
    const dueDate = String(data.get('inspectorDueDate') ?? '').trim();
    setTasks((current) => current.map((task) => task.id === selectedTask.id ? { ...task, title: title || task.title, notes, scheduledDate: scheduledDate || undefined, dueDate: dueDate || undefined, dueLabel: dueDate || (scheduledDate === '2026-08-12' ? 'Today' : scheduledDate || 'Not scheduled') } : task));
    setReceipts((current) => [...current, `PATCH /tasks/${selectedTask.id} {title,notes,dueDate,scheduledDate,preferredAgent,energy} → 200`]);
    setSelectedTask(null);
    notify('Task details saved');
  };

  const saveProjectStep = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedStep) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('stepTitle') ?? '').trim();
    setProjectSteps((current) => current.map((step) => step.id === selectedStep.id ? { ...step, title: title || step.title } : step));
    setReceipts((current) => [...current, `PATCH /project-instances/steps/${selectedStep.id} {title,notes,dueDate,scheduledDate,assigneeId} → 200`]);
    setSelectedStep(null);
    notify('Project step saved');
  };

  const openThread = () => {
    setReceipts((current) => [...current, `POST /message-threads/${dashboardThread.id}/read → 204`, `GET /message-threads/${dashboardThread.id}/messages → 200`, 'GET /message-threads → 200']);
    navigate(`/messages/${dashboardThread.id}`);
  };

  return (
    <section className="page-shell pg-dashboard" data-testid="page-dashboard" aria-labelledby="dashboard-title" aria-busy={surfaceState === 'loading'}>
      <header className="dashboard-toolbar">
        <div className="dashboard-heading"><span className="eyebrow">Planning workspace</span><h1 id="dashboard-title">Dashboard</h1><p>A calm view of the week ahead.</p></div>
        <div className="dashboard-header-actions"><div className="dashboard-summary-chips" aria-label="Dashboard summary"><span data-testid="dashboard-open-count">{openCount} open</span><span data-testid="dashboard-thread-count">6 threads</span></div><HeaderTaskAction onClick={() => setTaskCreateOpen(true)} disabled={!isContentVisible || isReadonly} describedBy={isReadonly ? 'dashboard-readonly-reason' : undefined} testId="dashboard-header-add-task" /><button className="icon-button" type="button" aria-label="Refresh dashboard" title="Refresh dashboard" disabled={surfaceState === 'loading'} onClick={() => refresh()} data-testid="dashboard-refresh">↻</button></div>
      </header>

      <div className="dashboard-scroll">
        {!isContentVisible && <StatePanel state={surfaceState as Exclude<DashboardSurfaceState, 'ready' | 'readonly'>} onRetry={() => refresh(true)} onEmpty={recoverEmpty} />}
        {isContentVisible && <>
          {isReadonly && <div className="readonly-banner" id="dashboard-readonly-reason" role="status" data-testid="page-state-readonly"><strong>Read-only permission</strong><span>You can inspect planning details and follow shortcuts, but task, project, and handoff changes require editor permission.</span></div>}
          <fieldset className="mutation-gate" disabled={isReadonly} aria-disabled={isReadonly || undefined} aria-describedby={isReadonly ? 'dashboard-readonly-reason' : undefined} data-testid="dashboard-mutations"><legend className="sr-only">Dashboard task creation controls</legend><span className="sr-only">Mutating controls require dashboard editor permission.</span></fieldset>

          <section className="focus-shell" aria-labelledby="dashboard-focus-title">
            <header className="section-intro"><div><span className="eyebrow">At a glance</span><h2 id="dashboard-focus-title">Focus for this week</h2><p>Review today, the week ahead, and the next active project without leaving planning.</p></div><span className="date-orbit">Wed · Aug 12</span></header>
            <div className="focus-grid">
              <article className="progress-card" data-testid="today-progress"><div className="card-topline"><h3>Today</h3><span>{todayDone === todayTasks.length ? 'Clear' : `${todayTasks.length - todayDone} open`}</span></div><p>Keep the immediate handoff moving.</p><dl className="metrics-grid"><Metric label="Complete" value={todayDone} /><Metric label="Open" value={todayTasks.length - todayDone} /><Metric label="Next" value={todayTasks.find((task) => task.status === 'open')?.title ?? 'Clear'} /><Metric label="Progress" value={`${todayDone}/${todayTasks.length} · ${Math.round((todayDone / Math.max(1, todayTasks.length)) * 100)}%`} /></dl><button className="deck-row" type="button" onClick={() => navigate('/planner')} data-testid="open-planner"><strong>{todayTasks.find((task) => task.status === 'open')?.title ?? 'Today is clear'}</strong><span>Open planner</span></button></article>
              <article className="progress-card" data-testid="week-progress"><div className="card-topline"><h3>This week</h3><button className="text-button" type="button" onClick={() => navigate('/planner')} data-testid="open-week-planner">Open planner</button></div><p>Two completed steps have made room for the weekend.</p><dl className="metrics-grid"><Metric label="Complete" value={weekDone} /><Metric label="Open" value={weekProgressTasks.length - weekDone} /><Metric label="Tomorrow" value="Volunteer email" /><Metric label="Progress" value={`${weekDone}/${weekProgressTasks.length} · ${Math.round((weekDone / weekProgressTasks.length) * 100)}%`} /></dl><button className="deck-row" type="button" onClick={() => { const task = tasks.find((item) => item.id === 'task-finalize-launch-notes'); if (task) inspectTask(task); }} data-testid="week-next-task"><strong>Finalize launch notes 📝</strong><span>Friday</span></button></article>
              <article className="progress-card" data-testid="project-progress-weekend-service"><div className="card-topline"><h3>{dashboardProject.title}</h3><button className="text-button" type="button" onClick={() => navigate('/projects')} data-testid="open-projects">Open projects</button></div><p>Owner {dashboardProject.owner} · due {dashboardProject.dueLabel}</p><dl className="metrics-grid"><Metric label="Complete" value={projectDone} /><Metric label="Open" value={projectSteps.length - projectDone} /><Metric label="Next" value={projectNextStep?.title ?? 'Clear'} /><Metric label="Progress" value={`${projectDone}/${projectSteps.length} · ${Math.round((projectDone / projectSteps.length) * 100)}%`} /></dl>{projectNextStep ? <button className="deck-row" type="button" onClick={() => setSelectedStep(projectNextStep)} data-testid="project-next-step"><strong>{projectNextStep.title}</strong><span>{projectNextStep.dueLabel}</span></button> : <div className="deck-empty">All project steps complete.</div>}</article>
            </div>
          </section>

          <section className="context-strip" aria-label="Dashboard handoffs">
            <article className="quick-card"><span className="eyebrow">Agent handoff</span><h2>Actions for the next task</h2><p>Prepare context for <strong>{nextTask?.title}</strong>.</p><div className="quick-list">{quickActions.map((action) => <button key={action.id} className="action-chip" type="button" disabled={isReadonly} aria-describedby={isReadonly ? 'dashboard-readonly-reason' : undefined} aria-pressed={quickAction === action.label} onClick={() => { setQuickAction(action.label); notify(`${action.label} handoff prepared`); }} data-testid={`quick-action-${action.id}`}>{action.label}</button>)}</div>{quickAction && <output className="quick-handoff" aria-live="polite" data-testid="quick-action-handoff"><strong>{quickAction}</strong><span>{nextTask?.title}</span><small>Local preview · no request sent</small></output>}</article>
            <article className="unread-card"><div className="card-topline"><div><span className="eyebrow">Unread context</span><h2>Unread messages</h2></div><button className="icon-button" type="button" onClick={() => navigate('/messages')} aria-label="Open messages" title="Open messages" data-testid="open-messages">→</button></div><p>Six active threads need a quick review before the weekend handoff.</p><button className="thread-preview" type="button" onClick={openThread} data-testid="unread-preview-thread-weekend-team"><span><strong>{dashboardThread.title}</strong><small>{dashboardThread.preview}</small></span><em>{dashboardThread.unreadLabel}</em></button></article>
          </section>

          <section className="planning-section" aria-labelledby="planning-title"><header className="section-intro compact"><div><span className="eyebrow">Operational view</span><h2 id="planning-title">Planning</h2><p>Tasks stay grouped by urgency without losing collaborator or project context.</p></div></header><div className="planning-grid">
            <article className="planning-card wide" data-testid="planning-past-due"><div className="list-head"><h3>Past due · {pastDueTasks.length}</h3><button className="text-button" type="button" onClick={() => navigate('/planner')} data-testid="open-past-due-planner">Planner</button></div>{pastDueTasks.map((task) => <TaskEntry key={task.id} task={task} readonly={isReadonly} onInspect={inspectTask} onToggle={toggleTask} />)}</article>
            <article className="planning-card" data-testid="planning-handoffs"><div className="list-head"><h3>Collaborator handoffs</h3><button className="text-button" type="button" onClick={() => navigate('/planner')} data-testid="open-handoffs-planner">Planner</button></div>{handoffTasks.length ? handoffTasks.map((task) => <div className="handoff-row" key={task.id}><span><strong>{task.title}</strong><small>{task.collaborator}</small></span><em>{task.dueLabel}</em></div>) : <p className="empty-copy">No collaborator handoffs.</p>}</article>
            <article className="planning-card" data-testid="planning-today"><div className="list-head"><h3>Today · {todayTasks.length}</h3><button className="text-button" type="button" onClick={() => navigate('/planner')} data-testid="open-today-planner">Planner</button></div>{todayTasks.map((task) => <TaskEntry key={task.id} task={task} readonly={isReadonly} onInspect={inspectTask} onToggle={toggleTask} />)}</article>
            <article className="planning-card" data-testid="planning-week"><div className="list-head"><h3>This week · {weekTasks.length}</h3><button className="text-button" type="button" onClick={() => navigate('/planner')} data-testid="open-planning-week">Planner</button></div>{weekTasks.map((task) => <TaskEntry key={task.id} task={task} readonly={isReadonly} onInspect={inspectTask} onToggle={toggleTask} />)}{!weekTasks.length && <p className="empty-copy">No open tasks later this week.</p>}</article>
            <article className="planning-card" data-testid="planning-project-steps"><div className="list-head"><h3>Project on deck</h3><span>{projectSteps.filter((step) => step.status === 'open').length}</span></div>{projectSteps.map((step) => <ProjectStepEntry key={step.id} step={step} readonly={isReadonly} onInspect={setSelectedStep} onToggle={toggleProjectStep} />)}{projectSteps.every((step) => step.status === 'done') && <p className="empty-copy">All project steps are complete.</p>}</article>
            <article className="planning-card wide" data-testid="planning-unscheduled"><div className="list-head"><h3>Unscheduled · {unscheduledTasks.length}</h3><button className="text-button" type="button" onClick={() => navigate('/planner')} data-testid="open-unscheduled-planner">Planner</button></div>{unscheduledTasks.map((task) => <TaskEntry key={task.id} task={task} readonly={isReadonly} onInspect={inspectTask} onToggle={toggleTask} />)}{!unscheduledTasks.length && <p className="empty-copy">Every open task has a date.</p>}</article>
          </div></section>

        </>}
      </div>

      <aside className="page-trace" aria-label="Request log" aria-live="polite" tabIndex={0} data-testid="page-trace"><span>Request log</span><ol>{receipts.map((receipt, index) => <li key={`${receipt}-${index}`}>{receipt}</li>)}</ol></aside>

      <FocusDialog open={taskCreateOpen} onClose={() => { setTaskCreateOpen(false); setTitleError(false); }} title="Add task" description="Set the task details now. More people and agent handoffs are available after creation." testId="dashboard-task-create"><TaskCreateForm idPrefix="dashboard-create" onSubmit={createTask} onCancel={() => { setTaskCreateOpen(false); setTitleError(false); }} members={dashboardCollaborators} titleRef={taskTitleRef} titleError={titleError ? 'Enter a task title.' : undefined} onTitleChange={() => setTitleError(false)} disabled={isReadonly} describedBy={isReadonly ? 'dashboard-readonly-reason' : undefined} noValidate testIds={{ title: 'task-title', notes: 'task-notes', scheduledDate: 'task-schedule', dueDate: 'task-due-date', collaborator: 'task-collaborator', cancel: 'dashboard-task-create-cancel', submit: 'task-add', error: 'task-title-error' }} /></FocusDialog>

      <FocusDialog open={Boolean(selectedTask)} onClose={() => setSelectedTask(null)} title="Task details" description="Inspect or update the selected task." testId="task-inspector" wide><form className="inspector-form" onSubmit={saveTask}><label>Task title<input name="inspectorTitle" defaultValue={selectedTask?.title ?? ''} disabled={isReadonly} data-autofocus data-testid="task-inspector-title" /></label><label>Notes<textarea name="inspectorNotes" defaultValue={selectedTask?.notes ?? ''} disabled={isReadonly} rows={4} data-testid="task-inspector-notes" /></label><div className="inspector-pair"><label>Scheduled date<input name="inspectorScheduledDate" type="date" defaultValue={selectedTask?.scheduledDate ?? ''} disabled={isReadonly} data-testid="task-inspector-scheduled" /></label><label>Due date<input name="inspectorDueDate" type="date" defaultValue={selectedTask?.dueDate ?? ''} disabled={isReadonly} data-testid="task-inspector-due" /></label></div><div className="inspector-pair"><label>Preferred agent<select defaultValue="Planning partner" disabled={isReadonly} data-testid="task-inspector-agent"><option>Planning partner</option><option>Writing partner</option></select></label><label>Energy<select defaultValue="Medium" disabled={isReadonly} data-testid="task-inspector-energy"><option>Low</option><option>Medium</option><option>High</option></select></label></div><section className="inspector-collaborator" aria-label="Task collaborator"><span><strong>Collaborator</strong><small>{selectedTask?.collaborator ?? 'No collaborator assigned'}</small></span>{selectedTask?.collaborator ? <button className="text-danger-button" type="button" disabled={isReadonly} onClick={() => updateInspectorCollaborator()} data-testid="task-inspector-collaborator-remove">Remove</button> : <button className="secondary-button" type="button" disabled={isReadonly} onClick={() => updateInspectorCollaborator('Riley Chen')} data-testid="task-inspector-collaborator-add">Add Riley Chen</button>}</section><footer><button className="secondary-button" type="button" onClick={() => setSelectedTask(null)} data-testid="task-inspector-cancel">Cancel</button><button className="primary-button" type="submit" disabled={isReadonly} aria-describedby={isReadonly ? 'dashboard-readonly-reason' : undefined} data-testid="task-inspector-save">Save changes</button></footer></form></FocusDialog>

      <FocusDialog open={Boolean(selectedStep)} onClose={() => setSelectedStep(null)} title="Project step details" description={`${dashboardProject.title} · project step`} testId="project-step-inspector" wide><form className="inspector-form" onSubmit={saveProjectStep}><label>Step title<input name="stepTitle" defaultValue={selectedStep?.title ?? ''} disabled={isReadonly} data-autofocus data-testid="project-step-title" /></label><label>Notes<textarea name="stepNotes" defaultValue="Coordinate the final check-in owner." disabled={isReadonly} rows={3} data-testid="project-step-notes" /></label><div className="inspector-pair"><label>Scheduled date<input type="date" defaultValue="2026-08-15" disabled={isReadonly} data-testid="project-step-scheduled" /></label><label>Due date<input type="date" defaultValue="2026-08-15" disabled={isReadonly} data-testid="project-step-due" /></label></div><label>Assignee<select defaultValue="workspace-user-2" disabled={isReadonly} data-testid="project-step-assignee"><option value="workspace-user-2">Riley Chen</option><option value="workspace-user-3">Morgan Lee</option></select></label><footer><button className="secondary-button" type="button" onClick={() => setSelectedStep(null)} data-testid="project-step-cancel">Cancel</button><button className="primary-button" type="submit" disabled={isReadonly} aria-describedby={isReadonly ? 'dashboard-readonly-reason' : undefined} data-testid="project-step-save">Save changes</button></footer></form></FocusDialog>

    </section>
  );
}

type WorkTask = Pick<Task, 'id' | 'title'> & Partial<Pick<Task, 'notes' | 'status' | 'dueDate' | 'scheduledDate' | 'sourceType' | 'sourceName' | 'ownerId'>>;
const workKey = (task: WorkTask) => `${task.sourceType === 'project_step' ? 'step' : 'task'}:${task.id}`;
const sourceReadonly = (task: WorkTask) => task.sourceType === 'calendar_shadow_event' || task.sourceType === 'prod_mirror' || !task.status;
const openWork = (task: WorkTask) => task.status !== 'done' && task.status !== 'deferred';

function LiveTaskEntry({ task, reasons = [], pending = false, readonly = false, onInspect, onToggle }: { task: WorkTask; reasons?: string[]; pending?: boolean; readonly?: boolean; onInspect(task: WorkTask): void; onToggle(task: WorkTask): void }) {
  return (
    <article className="task-entry" data-task-key={workKey(task)}>
      <button className="task-toggle" type="button" disabled={pending || readonly || sourceReadonly(task)} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => onToggle(task)} data-testid={`task-toggle-${task.id}`}><span aria-hidden="true">✓</span></button>
      {/* data-source-id is the task's own canonical id, not task.sourceId (the owning instance for
          project steps) — apps/api_server/src/repositories/project_instances_repository.ts:106-129
          maps a step's own row.id onto Task.id. */}
      <button className="task-row" type="button" onClick={() => onInspect(task)} data-status={task.status} data-source-type={task.sourceType ?? undefined} data-source-id={task.id} data-testid={`task-row-${task.id}`}>
        <span className="row-copy"><strong>{task.title}</strong><small>{[task.sourceName, task.scheduledDate && `Planned ${task.scheduledDate}`, task.dueDate && `Due ${task.dueDate}`, ...reasons, sourceReadonly(task) ? 'Read only · update in source' : readonly ? 'Editor permission required' : null].filter(Boolean).join(' · ') || 'Not scheduled'}</small></span>
        <span className="row-status">{task.status === 'done' ? 'Done' : task.status === 'in_progress' ? 'In progress' : ''}</span>
      </button>
    </article>
  );
}

function LiveStepEntry({ step, context, pending, onToggle, onInspect }: { step: DashboardOnDeckStep; context: string; pending: boolean; onToggle(step: DashboardOnDeckStep): void; onInspect(step: DashboardOnDeckStep): void }) {
  return (
    <article className="task-entry">
      <button className="task-toggle" type="button" disabled={pending} aria-label={`${step.status === 'done' ? 'Reopen' : 'Complete'} ${step.title}`} onClick={() => onToggle(step)} data-testid={`project-step-toggle-${step.id}`}><span aria-hidden="true">✓</span></button>
      <button type="button" className="task-row" onClick={() => onInspect(step)} data-status={step.status} data-source-type="project_step" data-source-id={step.id} data-testid={`project-step-row-${step.id}`}>
        <span className="row-copy"><strong>{step.title}</strong><small>{context}{step.dueDate ? ` · Due ${step.dueDate}` : ''}</small></span>
        <span className="row-status">step</span>
      </button>
    </article>
  );
}

function LiveDashboardPage({ route, active = true }: { route: string; active?: boolean }) {
  const { notify } = useFixtures();
  // apps/web/src/gateway/index.ts:98 — every domain shares the one bearer from the signed-in
  // session; Dashboard must not build its own gateway from a build-time/test-only env value.
  const rendererGateway = useGateway();
  const gateway = rendererGateway.domains.dashboard!;
  const auth = useAuthUser();
  const { members: memberOptions, status: memberStatus, currentUserId: liveUserId } = useWorkspaceMembers();
  const [surfaceState, setSurfaceState] = useState<DashboardSurfaceState>('loading');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [supplemental, setSupplemental] = useState<WorkTask[]>([]);
  const [supplementalState, setSupplementalState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [recentlyCompleted, setRecentlyCompleted] = useState<WorkTask[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState<WorkTask | null>(null);
  const [selectedStep, setSelectedStep] = useState<DashboardOnDeckStep | null>(null);
  const [collaborators, setCollaborators] = useState<TaskCollaborator[]>([]);
  const [collaboratorId, setCollaboratorId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [quickActionPending, setQuickActionPending] = useState(false);
  const taskTitleRef = useRef<HTMLInputElement>(null);
  const statusPending = useRef(false);
  const loadGeneration = useRef(0);
  const supplementalGeneration = useRef(0);
  const [retryStatus, setRetryStatus] = useState<WorkTask | null>(null);
  const workspaceReadonly = surfaceState === 'forbidden' || surfaceState === 'readonly';

  const appendReceipt = (line: string) => setReceipts((current) => [...current, line]);

  const recordError = (method: string, path: string, error: unknown): string => {
    const status = error instanceof DashboardGatewayError ? error.status : 0;
    const message = error instanceof DashboardGatewayError ? error.message : 'Dashboard service unavailable';
    appendReceipt(`${method} ${path} → ${status || 'network error'}`);
    return message;
  };

  const loadSupplemental = async () => {
    const generation = ++supplementalGeneration.current;
    try {
      const tasks = await rendererGateway.domains.tasks!.list();
      if (generation !== supplementalGeneration.current) return;
      setSupplemental(tasks.map(task => ({ ...task, ownerId: task.ownerId ? Number(task.ownerId) : null })));
      setSupplementalState('ready');
      appendReceipt('GET /tasks?status=all → 200');
    } catch {
      if (generation !== supplementalGeneration.current) return;
      setSupplemental([]);
      setSupplementalState('error');
    }
  };

  const load = async ({ blocking = true }: { blocking?: boolean } = {}) => {
    const generation = ++loadGeneration.current;
    if (blocking) setSurfaceState('loading');
    const tasksRead = loadSupplemental();
    try {
      const loadedSummary = await gateway.summary();
      if (generation !== loadGeneration.current) return;
      appendReceipt('GET /dashboard/summary → 200');
      setSummary(loadedSummary);
      setErrorMessage(null);
      setSurfaceState('ready');
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      if (blocking) {
        setErrorMessage(recordError('GET', '/dashboard/summary', error));
        const status = error instanceof DashboardGatewayError ? error.status : 0;
        setSurfaceState(status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'unavailable' : 'server-error');
      } else {
        const status = error instanceof DashboardGatewayError ? error.status : 0;
        const message = error instanceof DashboardGatewayError ? error.message : 'Dashboard service unavailable';
        appendReceipt(`GET /dashboard/summary → ${status || 'network error'}`);
        setErrorMessage(`Could not refresh the latest dashboard. Confirmed changes are saved. ${message}`);
      }
    }
    await tasksRead;
  };

  useEffect(() => {
    if (active && route.startsWith('/dashboard')) void load({ blocking: !summary });
    return () => { loadGeneration.current++; supplementalGeneration.current++; };
  }, [gateway, active, route]);

  const isContentVisible = surfaceState === 'ready';

  // Shared with Planner/Tasks (components/quickActions.ts) so the Secretary handoff is one
  // capability, not three. Available even with an empty summary — there is no task to bind yet,
  // so the session launches unbound (launchQuickActionSession accepts a null task).
  const nextLiveTask: WorkTask | null = summary && !workspaceReadonly
    ? [...summary.tasks.today, ...summary.tasks.thisWeek, ...summary.tasks.pastDue, ...summary.tasks.unscheduled].find(task => openWork(task) && !sourceReadonly(task) && task.sourceType !== 'project_step') ?? null
    : null;

  const launchDashboardQuickAction = async (actionId: QuickActionPresetId) => {
    if (quickActionPending) return;
    setQuickActionPending(true);
    try {
      const createFollowUpTask = async (): Promise<QuickActionTaskContext> => {
        const created = await gateway.createTask({ title: `Follow-up: ${nextLiveTask?.title ?? 'task'}` });
        appendReceipt('POST /tasks {title} → 201');
        await load();
        return { id: created.id, title: created.title };
      };
      await launchQuickActionSession(
        rendererGateway.domains.sessions!,
        actionId,
        nextLiveTask ? { id: nextLiveTask.id, title: nextLiveTask.title } : null,
        actionId === 'follow-up-tasks' ? createFollowUpTask : undefined,
      );
      appendReceipt(`POST /agent-sessions {profileId,mcpRole,cwd,name${nextLiveTask ? ',taskId' : ''}} → 201`);
      notify('Secretary session created');
      navigate('/agents');
    } catch (error) { setErrorMessage(recordError('POST', '/agent-sessions', error)); } finally { setQuickActionPending(false); }
  };

  const applyTaskStatusToSummary = (changed: WorkTask, nextStatus: LiveTaskStatus) => {
    const matches = (task: WorkTask) => workKey(task) === workKey(changed);
    setSummary((current) => {
      if (!current) return current;
      const { tasks } = current;
      const inPastDue = tasks.pastDue.some(matches);
      const inPastDeadline = tasks.pastDeadlineTasks.some(matches);
      const inToday = tasks.today.some(matches);
      const inThisWeek = tasks.thisWeek.some(matches);
      const inUnscheduled = tasks.unscheduled.some(matches);
      const update = (items: Task[]) => nextStatus === 'done'
        ? items.filter((task) => !matches(task))
        : items.map((task) => matches(task) ? { ...task, status: nextStatus } : task);
      const decrement = (value: number, member: boolean) => member ? Math.max(0, value - 1) : value;
      return {
        ...current,
        tasks: {
          ...tasks,
          openCount: nextStatus === 'done' ? Math.max(0, tasks.openCount - 1) : tasks.openCount,
          pastDueCount: nextStatus === 'done' ? decrement(tasks.pastDueCount, inPastDue) : tasks.pastDueCount,
          pastDeadlineCount: nextStatus === 'done' ? decrement(tasks.pastDeadlineCount, inPastDeadline) : tasks.pastDeadlineCount,
          pastDeadlineTasks: nextStatus === 'done' ? tasks.pastDeadlineTasks.filter((task) => !matches(task)) : tasks.pastDeadlineTasks,
          todayRemainingCount: nextStatus === 'done' ? decrement(tasks.todayRemainingCount, inToday) : tasks.todayRemainingCount,
          thisWeekRemainingCount: nextStatus === 'done' ? decrement(tasks.thisWeekRemainingCount, inThisWeek) : tasks.thisWeekRemainingCount,
          unscheduledCount: nextStatus === 'done' ? decrement(tasks.unscheduledCount, inUnscheduled) : tasks.unscheduledCount,
          recent: update(tasks.recent),
          pastDue: update(tasks.pastDue),
          today: update(tasks.today),
          thisWeek: update(tasks.thisWeek),
          unscheduled: update(tasks.unscheduled),
        },
      };
    });
  };

  const applyStepStatusToSummary = (stepId: string, nextStatus: 'open' | 'done') => {
    setSummary((current) => current ? {
      ...current,
      projects: {
        ...current.projects,
        items: current.projects.items.map((project) => ({
          ...project,
          onDeckSteps: nextStatus === 'done'
            ? project.onDeckSteps.filter((step) => step.id !== stepId)
            : project.onDeckSteps.map((step) => step.id === stepId ? { ...step, status: nextStatus } : step),
        })),
      },
    } : current);
  };

  // apps/api_server/src/models/task.ts:7 — TaskStatus = 'open' | 'in_progress' | 'waiting_for_reply' | 'done'
  const toggleTask = async (task: WorkTask) => {
    if (statusPending.current || mutationPending || workspaceReadonly || sourceReadonly(task)) return;
    statusPending.current = true;
    // Invalidate older reads before publishing a confirmed mutation.
    loadGeneration.current++; supplementalGeneration.current++;
    const nextStatus: LiveTaskStatus = task.status === 'done' ? 'open' : 'done';
    const path = task.sourceType === 'project_step' ? `/project-instances/steps/${task.id}` : `/tasks/${task.id}`;
    const trigger = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    const row = trigger?.closest('.task-entry');
    const section = row?.parentElement;
    const rowIndex = row && section ? Array.from(section.querySelectorAll('.task-entry')).indexOf(row) : -1;
    setMutationPending(true);
    setErrorMessage(null); setRetryStatus(null);
    try {
      if (task.sourceType === 'project_step') await gateway.updateProjectStep(task.id, { status: nextStatus });
      else await gateway.updateTask(task.id, { status: nextStatus });
      appendReceipt(`PATCH ${path} {status:"${nextStatus}"} → 200`);
      applyTaskStatusToSummary(task, nextStatus);
      if (task.sourceType === 'project_step') {
        applyStepStatusToSummary(task.id, nextStatus);
        setSelectedStep(current => current?.id === task.id ? { ...current, status: nextStatus } : current);
      }
      setSupplemental(current => current.map(item => workKey(item) === workKey(task) ? { ...item, status: nextStatus } : item));
      setSelectedTask(current => current && workKey(current) === workKey(task) ? { ...current, status: nextStatus } : current);
      setRecentlyCompleted(current => nextStatus === 'done' ? [...current.filter(item => workKey(item) !== workKey(task)), { ...task, status: nextStatus }] : current.filter(item => workKey(item) !== workKey(task)));
      notify(nextStatus === 'done' ? `${task.title} completed` : `${task.title} reopened`);
      await load({ blocking: false });
    } catch (error) { setErrorMessage(recordError('PATCH', path, error)); setRetryStatus(task); }
    finally {
      statusPending.current = false; setMutationPending(false);
      requestAnimationFrame(() => {
        if (trigger?.isConnected && !trigger.disabled) { trigger.focus({ preventScroll: true }); return; }
        if (!section?.isConnected || rowIndex < 0) return;
        const targets = Array.from(section.querySelectorAll<HTMLButtonElement>('.task-entry .task-toggle'));
        const focusAfter = [...targets.slice(rowIndex), ...targets.slice(0, rowIndex).reverse()].find(target => target.isConnected && !target.disabled)
          ?? section.querySelector<HTMLElement>('h2');
        focusAfter?.focus({ preventScroll: true });
      });
    }
  };

  // apps/api_server/src/models/project_instance.ts:8 — ProjectInstanceStep.status = 'open' | 'done'
  const toggleStep = async (step: DashboardOnDeckStep) => {
    if (step.status !== 'open' && step.status !== 'done') return;
    await toggleTask({ ...step, status: step.status, sourceType: 'project_step' });
  };

  const saveStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedStep || mutationPending || workspaceReadonly) return;
    const data = new FormData(event.currentTarget); setMutationPending(true);
    try {
      await gateway.updateProjectStep(selectedStep.id, { title: String(data.get('title') ?? '').trim(), notes: String(data.get('notes') ?? ''), dueDate: String(data.get('dueDate') ?? '') || undefined });
      appendReceipt(`PATCH /project-instances/steps/${selectedStep.id} {title,notes,dueDate} → 200`);
      setSelectedStep(null); await load({ blocking: false });
    } catch (error) { setErrorMessage(recordError('PATCH', `/project-instances/steps/${selectedStep.id}`, error)); }
    finally { setMutationPending(false); }
  };

  const inspectTask = async (task: WorkTask) => {
    if (!task.status) { navigate(`/tasks/task/${encodeURIComponent(task.id)}`); return; }
    setSelectedTask(task);
    setErrorMessage(null); setRetryStatus(null); setCollaborators([]);
    setCollaboratorId('');
    if (task.sourceType === 'project_step' || sourceReadonly(task)) return;
    try {
      // apps/api_server/src/routes/tasks_routes.ts:14
      const loaded = await gateway.taskCollaborators(task.id);
      setCollaborators(loaded);
      appendReceipt(`GET /tasks/${task.id}/collaborators → 200`);
    } catch (error) { recordError('GET', `/tasks/${task.id}/collaborators`, error); }
  };

  const addCollaborator = async () => {
    if (!selectedTask || selectedTask.ownerId !== liveUserId || sourceReadonly(selectedTask) || workspaceReadonly || !collaboratorId.trim()) return;
    const userId = Number(collaboratorId);
    if (!Number.isInteger(userId)) return;
    try {
      // apps/api_server/src/routes/tasks_routes.ts:15
      const updated = await gateway.addTaskCollaborator(selectedTask.id, userId);
      setCollaborators(updated);
      appendReceipt(`POST /tasks/${selectedTask.id}/collaborators {userId} → 201`);
      setCollaboratorId('');
      notify('Collaborator added');
    } catch (error) { setErrorMessage(recordError('POST', `/tasks/${selectedTask.id}/collaborators`, error)); }
  };

  const removeCollaborator = async (userId: number) => {
    if (!selectedTask || selectedTask.ownerId !== liveUserId || sourceReadonly(selectedTask) || workspaceReadonly) return;
    try {
      // apps/api_server/src/routes/tasks_routes.ts:16
      await gateway.removeTaskCollaborator(selectedTask.id, userId);
      setCollaborators((current) => current.filter((person) => person.userId !== userId));
      appendReceipt(`DELETE /tasks/${selectedTask.id}/collaborators/${userId} → 204`);
      notify('Collaborator removed');
    } catch (error) { setErrorMessage(recordError('DELETE', `/tasks/${selectedTask.id}/collaborators/${userId}`, error)); }
  };

  const saveTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTask || mutationPending || workspaceReadonly || sourceReadonly(selectedTask)) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('inspectorTitle') ?? '').trim();
    if (!title) return;
    const path = selectedTask.sourceType === 'project_step' ? `/project-instances/steps/${selectedTask.id}` : `/tasks/${selectedTask.id}`;
    setMutationPending(true);
    try {
      const input = {
        title,
        notes: String(data.get('inspectorNotes') ?? ''),
        dueDate: String(data.get('inspectorDueDate') ?? '') || undefined,
        scheduledDate: String(data.get('inspectorScheduledDate') ?? '') || undefined,
      };
      const updated = selectedTask.sourceType === 'project_step'
        ? await gateway.updateProjectStep(selectedTask.id, input)
        : await gateway.updateTask(selectedTask.id, input);
      appendReceipt(`PATCH ${path} {title,notes,dueDate,scheduledDate} → 200`);
      setSelectedTask({ ...selectedTask, ...updated });
      notify('Task details saved');
      await load();
    } catch (error) { setErrorMessage(recordError('PATCH', path, error)); } finally { setMutationPending(false); }
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) { setTitleError(true); taskTitleRef.current?.focus(); return; }
    setMutationPending(true);
    try {
      const notes = String(data.get('notes') ?? '').trim();
      const scheduledDate = String(data.get('scheduledDate') ?? '').trim();
      const dueDate = String(data.get('dueDate') ?? '').trim();
      const collaboratorId = String(data.get('collaboratorId') ?? '').trim();
      // Server assigns the id; the created record is read back below, never invented client-side.
      const created = await gateway.createTask({ title, notes: notes || undefined, scheduledDate: scheduledDate || undefined, dueDate: dueDate || undefined });
      appendReceipt(`POST /tasks {title${notes ? ',notes' : ''}${scheduledDate ? ',scheduledDate' : ''}${dueDate ? ',dueDate' : ''}} → 201`);
      if (collaboratorId) {
        await gateway.addTaskCollaborator(created.id, Number(collaboratorId));
        appendReceipt(`POST /tasks/${created.id}/collaborators {userId:${collaboratorId}} → 200`);
      }
      form.reset();
      setTitleError(false);
      setCreateOpen(false);
      notify(`${created.title} added to the dashboard`);
      await load();
    } catch (error) { setErrorMessage(recordError('POST', '/tasks', error)); } finally { setMutationPending(false); }
  };

  const canonical = new Map<string, WorkTask>();
  for (const task of supplemental) canonical.set(workKey(task), task);
  for (const task of summary ? [...summary.tasks.recent, ...summary.tasks.pastDue, ...summary.tasks.today, ...summary.tasks.thisWeek, ...summary.tasks.unscheduled] : []) canonical.set(workKey(task), task);
  const waiting = supplemental.filter(task => task.status === 'waiting_for_reply').sort((a, b) => a.id.localeCompare(b.id));
  const reasons = new Map<string, string[]>();
  const attention = new Map<string, WorkTask>();
  for (const [items, reason] of [
    [summary?.tasks.pastDue ?? [], 'Overdue'],
    [[...(summary?.tasks.pastDeadlineTasks ?? [])].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')), 'Past deadline'],
    [waiting, 'Waiting for reply'],
  ] as const) {
    for (const item of items) {
      const key = workKey(item);
      const task = canonical.get(key) ?? item;
      if (!openWork(task)) continue;
      attention.set(key, task);
      reasons.set(key, [...(reasons.get(key) ?? []), reason]);
    }
  }
  const allocated = new Set(attention.keys());
  const allocate = (items: WorkTask[]) => items.filter(task => {
    const key = workKey(task);
    if (!openWork(task) || allocated.has(key)) return false;
    allocated.add(key); return true;
  });
  const queues = [
    { id: 'planning-past-due', title: 'Needs attention', tasks: [...attention.values()], cap: 5, empty: 'Nothing overdue or past deadline.' },
    { id: 'planning-today', title: 'Today', tasks: allocate(summary?.tasks.today ?? []), cap: 6, empty: 'Nothing scheduled today.' },
    { id: 'planning-week', title: 'Later this week', tasks: allocate(summary?.tasks.thisWeek ?? []), cap: 3, empty: 'No open tasks later this week.' },
    { id: 'planning-unscheduled', title: 'Unscheduled', tasks: allocate(summary?.tasks.unscheduled ?? []), cap: 3, empty: 'No unscheduled tasks.' },
  ];
  const projectSteps = (summary?.projects.items ?? []).flatMap(project => project.onDeckSteps.filter(step => step.status !== 'done' && step.status !== 'deferred' && !allocated.has(`step:${step.id}`)).map(step => ({ step, context: [project.title, step.assigneeName].filter(Boolean).join(' · ') }))).slice(0, 3);
  const focusQueue = (id: string) => { const heading = document.getElementById(`${id}-title`); heading?.scrollIntoView({ block: 'nearest' }); heading?.focus({ preventScroll: true }); };
  const retry = () => retryStatus ? void toggleTask(retryStatus) : void load({ blocking: false });
  const selectedReadonly = workspaceReadonly || Boolean(selectedTask && sourceReadonly(selectedTask));
  const canManagePeople = Boolean(selectedTask && liveUserId !== null && selectedTask.ownerId === liveUserId && selectedTask.sourceType !== 'project_step' && !selectedReadonly);

  return (
    <section className="page-shell pg-dashboard work-first-dashboard" data-testid="page-dashboard" aria-labelledby="dashboard-title" aria-busy={surfaceState === 'loading'}>
      <header className="dashboard-toolbar">
        <div className="dashboard-heading"><h1 id="dashboard-title">Dashboard</h1><time>{new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div>
        <div className="dashboard-header-actions">
          <button className="text-button" type="button" onClick={() => navigate('/planner')} data-testid="open-planner">Open planner</button>
          <HeaderTaskAction onClick={() => setCreateOpen(true)} disabled={workspaceReadonly || mutationPending} testId="dashboard-header-add-task" />
          <button className="icon-button" type="button" aria-label="Refresh dashboard" title="Refresh dashboard" disabled={surfaceState === 'loading' || mutationPending} onClick={() => void load({ blocking: !summary })} data-testid="dashboard-refresh">↻</button>
        </div>
      </header>
      <nav className="dashboard-counts" data-testid="dashboard-counts" aria-label="Work queues">
        {[
          ['Overdue', isContentVisible ? summary?.tasks.pastDueCount : null, 'planning-past-due'],
          ['Today', isContentVisible ? summary?.tasks.todayRemainingCount : null, 'planning-today'],
          ['Waiting', isContentVisible && supplementalState === 'ready' ? waiting.length : null, 'planning-past-due'],
          ['Unscheduled', isContentVisible ? summary?.tasks.unscheduledCount : null, 'planning-unscheduled'],
        ].map(([label, count, id]) => <button type="button" key={label} disabled={!isContentVisible} onClick={() => focusQueue(String(id))}>{label} {count ?? '—'}</button>)}
      </nav>
      <div className="dashboard-scroll">
        {!isContentVisible && <StatePanel state={surfaceState as Exclude<DashboardSurfaceState, 'ready' | 'readonly'>} onRetry={() => void load()} onEmpty={() => setCreateOpen(true)} />}
        {isContentVisible && errorMessage && <div className="readonly-banner" role="alert" data-testid="dashboard-mutation-error">{errorMessage}<button type="button" className="text-button" disabled={mutationPending} onClick={retry}>Retry</button></div>}
        <div className="dashboard-columns">
          <div data-testid="dashboard-work">
            {isContentVisible && queues.map(queue => <section key={queue.id} className="work-queue" data-testid={queue.id} aria-labelledby={`${queue.id}-title`}>
              <div className="list-head"><h2 id={`${queue.id}-title`} tabIndex={-1}>{queue.title}</h2><span>{expanded.includes(queue.id) ? queue.tasks.length : Math.min(queue.cap, queue.tasks.length)} of {queue.tasks.length} shown</span></div>
              {queue.id === 'planning-past-due' && supplementalState === 'error' && <p role="status">Waiting tasks unavailable · <button type="button" className="text-button" onClick={() => void loadSupplemental()}>Retry</button></p>}
              {(expanded.includes(queue.id) ? queue.tasks : queue.tasks.slice(0, queue.cap)).map(task => <LiveTaskEntry key={workKey(task)} task={task} reasons={[...(reasons.get(workKey(task)) ?? []), ...(queue.id !== 'planning-past-due' && nextLiveTask && workKey(task) === workKey(nextLiveTask) ? ['Next'] : [])]} readonly={workspaceReadonly} pending={mutationPending} onInspect={item => void inspectTask(item)} onToggle={item => void toggleTask(item)} />)}
              {!queue.tasks.length && <p className="empty-copy">{queue.empty}</p>}
              {queue.tasks.length > queue.cap && <button className="text-button" type="button" aria-expanded={expanded.includes(queue.id)} onClick={() => setExpanded(current => current.includes(queue.id) ? current.filter(id => id !== queue.id) : [...current, queue.id])}>{expanded.includes(queue.id) ? 'Show fewer' : `Show all ${queue.tasks.length}`}</button>}
            </section>)}
            {recentlyCompleted.length > 0 && <details className="work-queue"><summary>Recently completed</summary>{recentlyCompleted.map(task => <p key={workKey(task)}>{task.title} <button type="button" className="text-button" disabled={mutationPending || workspaceReadonly} onClick={() => void toggleTask(task)}>Reopen {task.title}</button></p>)}</details>}
          </div>
          <aside className="dashboard-context" aria-label="Work context">
            {isContentVisible && summary && <>
              <section className="work-queue" data-testid="planning-project-steps"><div className="list-head"><h2 tabIndex={-1}>Next project steps</h2><button className="text-button" type="button" onClick={() => navigate('/projects')} data-testid="open-projects">Projects</button></div>{projectSteps.map(({ step, context }) => <LiveStepEntry key={step.id} step={step} context={context} pending={mutationPending || workspaceReadonly} onInspect={setSelectedStep} onToggle={item => void toggleStep(item)} />)}{!projectSteps.length && <p className="empty-copy">No next project steps.</p>}</section>
              <section className="work-queue"><div className="list-head"><h2>Unread messages</h2><button className="icon-button" type="button" aria-label="Open messages" onClick={() => navigate('/messages')} data-testid="open-messages">→</button></div>{summary.messages.unreadPreviews.slice(0, 3).map(preview => <button key={preview.threadId} className="thread-preview" type="button" onClick={() => navigate(`/messages/${preview.threadId}`)} data-testid={`unread-preview-thread-${preview.threadId}`}><span><strong>{preview.threadTitle}</strong><small>{preview.senderName}: {preview.preview}</small></span><em>{preview.unreadCount} unread</em></button>)}{!summary.messages.unreadPreviews.length && <p className="empty-copy">No unread threads.</p>}</section>
              <details className="work-queue" data-testid="dashboard-goals"><summary>Goals and rhythms</summary>{summary.goals.items.map(goal => <article key={goal.id} data-testid={`dashboard-goal-${goal.id}`}><strong>{goal.title}</strong><p>{goal.currentValue} / {goal.endValue} {goal.metricType} · {goal.health}</p><progress value={goal.progress} max={1} aria-label={`${goal.title} progress`} /></article>)}{summary.rhythms.items.map(rhythm => <p key={rhythm.id}>{rhythm.title} · {rhythm.completedCount}/{rhythm.totalCount}</p>)}{!summary.goals.items.length && !summary.rhythms.items.length && <p>No active goals or rhythms.</p>}</details>
            </>}
            <details className="work-queue" data-testid="dashboard-agent-actions"><summary>Agent actions</summary><p>{nextLiveTask ? `Task: ${nextLiveTask.title}` : 'No task selected · starts an unbound session.'}</p><div className="quick-list">{quickActionPresets.map(action => <button key={action.id} className="action-chip" type="button" disabled={quickActionPending || workspaceReadonly} onClick={() => void launchDashboardQuickAction(action.id)} data-testid={`quick-action-${action.id}`}>{action.label}</button>)}</div></details>
          </aside>
        </div>
      </div>
      {!auth && <details><summary>Diagnostics</summary><aside className="page-trace" aria-label="Request log" tabIndex={0} data-testid="page-trace"><ol>{receipts.map((receipt, index) => <li key={`${receipt}-${index}`}>{receipt}</li>)}</ol></aside></details>}

      <FocusDialog open={createOpen} onClose={() => { setCreateOpen(false); setTitleError(false); }} title="Add task" description="Set the task details now." testId="dashboard-task-create">
        <TaskCreateForm idPrefix="dashboard-create" onSubmit={(event) => void createTask(event)} onCancel={() => { setCreateOpen(false); setTitleError(false); }} members={memberOptions.filter((member) => member.userId !== liveUserId)} titleRef={taskTitleRef} titleError={titleError ? 'Enter a task title.' : undefined} onTitleChange={() => setTitleError(false)} disabled={mutationPending || memberStatus === 'loading'} noValidate testIds={{ title: 'task-title', notes: 'task-notes', scheduledDate: 'task-schedule', dueDate: 'task-due-date', collaborator: 'task-collaborator', cancel: 'dashboard-task-create-cancel', submit: 'task-add', error: 'task-title-error' }} />
      </FocusDialog>

      <FocusDialog open={Boolean(selectedTask)} onClose={() => setSelectedTask(null)} title="Task details" description="Inspect or update the selected task." testId="task-inspector" wide>
        <div className="dashboard-status-action">
          <button type="button" className="primary-button" disabled={mutationPending || selectedReadonly} data-testid="task-detail-complete" onClick={() => selectedTask && void toggleTask(selectedTask)}>{mutationPending ? selectedTask?.status === 'done' ? 'Reopening…' : 'Completing…' : `${selectedTask?.status === 'done' ? 'Reopen' : 'Complete'} ${selectedTask?.sourceType === 'project_step' ? 'step' : 'task'}`}</button>
          {selectedReadonly && <p>Read only · update in source or ask for editor permission.</p>}
          {errorMessage && <p role="alert">{errorMessage} <button type="button" className="text-button" disabled={mutationPending} onClick={retry}>Retry</button></p>}
        </div>
        <form key={selectedTask && workKey(selectedTask)} className="inspector-form" onSubmit={(event) => void saveTask(event)}>
          <label>Task title<input name="inspectorTitle" defaultValue={selectedTask?.title ?? ''} disabled={selectedReadonly} data-autofocus data-testid="task-inspector-title" /></label>
          <label>Notes<textarea name="inspectorNotes" defaultValue={selectedTask?.notes ?? ''} disabled={selectedReadonly} rows={3} data-testid="task-inspector-notes" /></label>
          <div className="inspector-pair"><label>Scheduled date<input name="inspectorScheduledDate" type="date" defaultValue={selectedTask?.scheduledDate ?? ''} disabled={selectedReadonly} data-testid="task-inspector-scheduled" /></label><label>Due date<input name="inspectorDueDate" type="date" defaultValue={selectedTask?.dueDate ?? ''} disabled={selectedReadonly} data-testid="task-inspector-due" /></label></div>
          <section className="inspector-collaborator" aria-label="Task collaborators">
            <span><strong>Collaborators</strong></span>
            <ul className="collaborator-list">
              {collaborators.map((person) => <li key={person.userId} data-testid={`task-inspector-collaborator-${person.userId}`}>{person.name}<button type="button" disabled={!canManagePeople || mutationPending} onClick={() => void removeCollaborator(person.userId)} data-testid={`task-inspector-collaborator-remove-${person.userId}`}>Remove</button></li>)}
              {!collaborators.length && <li>No collaborators.</li>}
            </ul>
            <div className="inspector-pair">
              <label>Workspace member<select value={collaboratorId} disabled={memberStatus !== 'ready'} onChange={(event) => setCollaboratorId(event.target.value)} data-testid="task-inspector-collaborator-input"><option value="">Select a member</option>{memberOptions.filter((member) => !collaborators.some((existing) => existing.userId === member.userId)).map((member) => <option key={member.id} value={member.id}>{member.name}{member.email ? ` · ${member.email}` : ''}</option>)}</select></label>
              <button className="secondary-button" type="button" disabled={!canManagePeople || mutationPending || !collaboratorId} onClick={() => void addCollaborator()} data-testid="task-inspector-collaborator-add">Add</button>
            </div>
          </section>
          <footer><button className="secondary-button" type="button" onClick={() => setSelectedTask(null)} data-testid="task-inspector-cancel">Cancel</button><button className="primary-button" type="submit" disabled={mutationPending || selectedReadonly} data-testid="task-inspector-save">Save changes</button></footer>
        </form>
      </FocusDialog>
      <FocusDialog open={Boolean(selectedStep)} onClose={() => setSelectedStep(null)} title="Project step details" description="Edit the supported on-deck project step fields." testId="dashboard-project-step-dialog">
        <div className="dashboard-status-action"><button type="button" className="primary-button" disabled={mutationPending || workspaceReadonly} onClick={() => selectedStep && void toggleStep(selectedStep)} data-testid="project-step-detail-complete">{mutationPending ? selectedStep?.status === 'done' ? 'Reopening…' : 'Completing…' : selectedStep?.status === 'done' ? 'Reopen step' : 'Complete step'}</button>{errorMessage && <p role="alert">{errorMessage} <button type="button" className="text-button" disabled={mutationPending} onClick={retry}>Retry</button></p>}</div>
        <form onSubmit={(event) => void saveStep(event)}><label>Title<input name="title" data-autofocus defaultValue={selectedStep?.title ?? ''} /></label><label>Notes<textarea name="notes" defaultValue={selectedStep?.notes ?? ''} /></label><label>Due date<input name="dueDate" type="date" defaultValue={selectedStep?.dueDate ?? ''} /></label><div className="dialog-actions"><button type="button" onClick={() => setSelectedStep(null)}>Cancel</button><button type="submit" disabled={mutationPending}>Save step</button></div></form>
      </FocusDialog>
    </section>
  );
}

export function DashboardPage(props: { route: string; active?: boolean }) {
  const gateway = useGateway();
  return gateway.mode === 'live' ? <LiveDashboardPage {...props} /> : <FixtureDashboardPage {...props} />;
}
