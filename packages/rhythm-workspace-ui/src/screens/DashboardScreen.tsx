// Ported from apps/web/src/pages/dashboard/index.tsx (589 lines) — see SOURCE_MAP.md.
// The production file has two parallel implementations (a fixture-mode page and a
// live-mode page) that converge on the same UI structure but diverge in data shape; this
// screen unifies them behind the single `DashboardGateway` port, using the fixture
// version's richer per-task/step/thread view-model (it drives more of the actual UI:
// bucketed tasks, collaborator handoffs, project progress, unread previews). Agent-session
// quick actions and cross-screen `navigate()` calls become `host.onRequestFollowUp` /
// `host.onNavigateToScreen`; the embedded LiveArtifactsShell is intentionally not inlined
// here — Artifacts already has its own separately-gated screen (ArtifactsScreen) and
// duplicating it ungated inside Dashboard would defeat that gate.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRhythmDomainGateway, useRhythmHost } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { FocusDialog } from '../components/FocusDialog';
import { HeaderTaskAction } from '../components/HeaderTaskAction';
import { TaskCreateForm } from '../components/TaskCreateForm';
import { RhythmGatewayError, type RhythmDashboardProjectStep, type RhythmDashboardSummary, type RhythmDashboardTask, type RhythmWorkspaceMember } from '../domain/types';

type DashboardSurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function StatePanel({ state, onRetry, onEmpty }: { state: Exclude<DashboardSurfaceState, 'ready'>; onRetry(): void; onEmpty(): void }) {
  if (state === 'loading') {
    return <section className="dashboard-state loading" role="status" aria-live="polite" data-testid="page-state-loading"><span className="eyebrow">Refreshing planning data</span><h2>Loading dashboard…</h2><p>Fetching the summary and active project steps.</p><div className="state-skeleton" aria-hidden="true"><span /><span /><span /></div></section>;
  }
  if (state === 'empty') {
    return <section className="dashboard-state" role="status" data-testid="page-state-empty"><span className="eyebrow">A clear workspace</span><h2>No planning work yet</h2><p>Create the first task to give this week a starting point.</p><button className="primary-button" type="button" onClick={onEmpty} data-testid="dashboard-empty-primary">Create the first task</button></section>;
  }
  if (state === 'server_error') {
    return <section className="dashboard-state danger" role="alert" data-testid="page-state-server-error"><span className="eyebrow">Retryable server error</span><h2>Dashboard could not load</h2><p>The planning service returned a temporary error. Existing data remains unchanged.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  }
  if (state === 'forbidden') {
    return <section className="dashboard-state warning" role="alert" data-testid="page-state-forbidden"><span className="eyebrow">Workspace permission required</span><h2>Dashboard access is restricted</h2><p>Ask a workspace administrator for planning access before viewing this summary.</p></section>;
  }
  return <section className="dashboard-state warning" role="status" data-testid="page-state-unavailable"><span className="eyebrow">Planning service prerequisite</span><h2>Planning data is unavailable</h2><p>Reconnect the planning service before refreshing tasks and projects.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

function TaskEntry({ task, onInspect, onToggle }: { task: RhythmDashboardTask; onInspect(task: RhythmDashboardTask): void; onToggle(task: RhythmDashboardTask): void }) {
  return (
    <article className="task-entry">
      <button className="task-toggle" type="button" aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => onToggle(task)} data-testid={`task-toggle-${task.id}`}><span aria-hidden="true">{task.status === 'done' ? '✓' : '○'}</span></button>
      <button className="task-row" type="button" onClick={() => onInspect(task)} data-status={task.status} data-testid={`task-row-${task.id}`}>
        <span className="row-copy"><strong>{task.title}</strong><small>{task.collaboratorName ? `${task.collaboratorName} · ` : ''}{task.dueLabel}</small></span>
        <span className="row-status">{task.status}</span>
      </button>
    </article>
  );
}

function ProjectStepEntry({ step, onInspect, onToggle }: { step: RhythmDashboardProjectStep; onInspect(step: RhythmDashboardProjectStep): void; onToggle(step: RhythmDashboardProjectStep): void }) {
  return (
    <article className="task-entry">
      <button className="task-toggle" type="button" aria-label={`${step.status === 'done' ? 'Reopen' : 'Complete'} ${step.title}`} onClick={() => onToggle(step)} data-testid={`project-step-toggle-${step.id}`}><span aria-hidden="true">{step.status === 'done' ? '✓' : '○'}</span></button>
      <button className="task-row" type="button" onClick={() => onInspect(step)} data-status={step.status} data-testid={`project-step-row-${step.id}`}><span className="row-copy"><strong>{step.title}</strong><small>{step.dueLabel}</small></span><span className="row-status">step</span></button>
    </article>
  );
}

export function DashboardScreen() {
  const { dashboard: gateway } = useRhythmDomainGateway();
  const host = useRhythmHost();
  const [surfaceState, setSurfaceState] = useState<DashboardSurfaceState>('loading');
  const [summary, setSummary] = useState<RhythmDashboardSummary | null>(null);
  const [members, setMembers] = useState<RhythmWorkspaceMember[]>([]);
  const [selectedTask, setSelectedTask] = useState<RhythmDashboardTask | null>(null);
  const [selectedStep, setSelectedStep] = useState<RhythmDashboardProjectStep | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const taskTitleRef = useRef<HTMLInputElement>(null);

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'unavailable' || kind === 'not_found' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    setSurfaceState('loading');
    try {
      const [loadedSummary, loadedMembers] = await Promise.all([gateway.summary(), gateway.members()]);
      setSummary(loadedSummary);
      setMembers(loadedMembers);
      setSurfaceState(loadedSummary.tasks.length || loadedSummary.project ? 'ready' : 'empty');
    } catch (error) {
      handleError(error);
    }
  };

  useEffect(() => { void load(); }, [gateway]);

  const isContentVisible = surfaceState === 'ready';
  const tasks = summary?.tasks ?? [];
  const project = summary?.project ?? null;

  const todayTasks = tasks.filter((task) => task.bucket === 'today');
  const pastDueTasks = tasks.filter((task) => task.bucket === 'past-due' && task.status === 'open');
  const weekTasks = tasks.filter((task) => task.bucket === 'week' && task.status === 'open');
  const unscheduledTasks = tasks.filter((task) => task.bucket === 'unscheduled' && task.status === 'open');
  const handoffTasks = tasks.filter((task) => task.collaboratorName && task.status === 'open');
  const openCount = tasks.filter((task) => task.status === 'open').length;
  const todayDone = todayTasks.filter((task) => task.status === 'done').length;
  const projectSteps = project?.steps ?? [];
  const projectDone = projectSteps.filter((step) => step.status === 'done').length;
  const projectNextStep = useMemo(() => projectSteps.find((step) => step.status === 'open'), [projectSteps]);

  const toggleTask = async (task: RhythmDashboardTask) => {
    if (mutationPending) return;
    setMutationPending(true);
    try {
      const updated = await gateway.updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' });
      setSummary((current) => current && { ...current, tasks: current.tasks.map((item) => (item.id === updated.id ? updated : item)) });
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const toggleStep = async (step: RhythmDashboardProjectStep) => {
    if (mutationPending || !project) return;
    setMutationPending(true);
    try {
      const updated = await gateway.updateProjectStep(step.id, { status: step.status === 'done' ? 'open' : 'done' });
      setSummary((current) => current && current.project && { ...current, project: { ...current.project, steps: current.project.steps.map((item) => (item.id === updated.id ? updated : item)) } });
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) { setTitleError(true); taskTitleRef.current?.focus(); return; }
    setMutationPending(true);
    try {
      const created = await gateway.createTask({
        title,
        notes: String(data.get('notes') ?? '').trim() || undefined,
        scheduledDate: String(data.get('scheduledDate') ?? '').trim() || undefined,
        dueDate: String(data.get('dueDate') ?? '').trim() || undefined,
        collaboratorId: String(data.get('collaboratorId') ?? '').trim() || undefined,
      });
      setSummary((current) => current && { ...current, tasks: [...current.tasks, created], openTaskCount: current.openTaskCount + 1 });
      form.reset();
      setTitleError(false);
      setCreateOpen(false);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const saveTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTask) return;
    const data = new FormData(event.currentTarget);
    setMutationPending(true);
    try {
      const updated = await gateway.updateTask(selectedTask.id, {
        title: String(data.get('inspectorTitle') ?? '').trim() || selectedTask.title,
        notes: String(data.get('inspectorNotes') ?? ''),
        scheduledDate: String(data.get('inspectorScheduledDate') ?? '') || undefined,
        dueDate: String(data.get('inspectorDueDate') ?? '') || undefined,
      });
      setSummary((current) => current && { ...current, tasks: current.tasks.map((task) => (task.id === updated.id ? updated : task)) });
      setSelectedTask(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const updateInspectorCollaborator = async (collaboratorId: string | null) => {
    if (!selectedTask) return;
    try {
      const updated = await gateway.updateTask(selectedTask.id, { collaboratorId });
      setSelectedTask(updated);
      setSummary((current) => current && { ...current, tasks: current.tasks.map((task) => (task.id === updated.id ? updated : task)) });
    } catch (error) {
      handleError(error);
    }
  };

  return (
    <ScreenRoot screenName="Dashboard" testId="rhythm-dashboard-screen">
      <section className="page-shell pg-dashboard" aria-busy={surfaceState === 'loading'}>
        <header className="dashboard-toolbar">
          <div className="dashboard-heading"><span className="eyebrow">Planning workspace</span><h1>Dashboard</h1><p>A calm view of the week ahead.</p></div>
          <div className="dashboard-header-actions">
            <div className="dashboard-summary-chips" aria-label="Dashboard summary">
              <span data-testid="dashboard-open-count">{summary?.openTaskCount ?? openCount} open</span>
              <span data-testid="dashboard-thread-count">{summary?.threadCount ?? 0} threads</span>
            </div>
            <HeaderTaskAction onClick={() => setCreateOpen(true)} disabled={!isContentVisible || mutationPending} testId="dashboard-header-add-task" />
            <button className="icon-button" type="button" aria-label="Refresh dashboard" title="Refresh dashboard" disabled={surfaceState === 'loading'} onClick={() => void load()} data-testid="dashboard-refresh">↻</button>
          </div>
        </header>

        <section className="quick-card" aria-labelledby="dashboard-quick-title">
          <span className="eyebrow">Quick actions</span>
          <h2 id="dashboard-quick-title">Actions for the next task</h2>
          <p>{todayTasks[0]?.title ? `Prepare context for ${todayTasks[0].title}.` : 'No task is next in queue yet.'}</p>
          <div className="quick-list">
            {['Help me finish this', 'Draft next steps', 'Summarize', 'Create follow-up tasks'].map((label) => (
              <button key={label} className="action-chip" type="button" onClick={() => host.onRequestFollowUp?.({ screen: 'dashboard', label, relatedId: todayTasks[0]?.id })} data-testid={`quick-action-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{label}</button>
            ))}
          </div>
        </section>

        <div className="dashboard-scroll">
          {!isContentVisible && <StatePanel state={surfaceState} onRetry={() => void load()} onEmpty={() => setCreateOpen(true)} />}
          {isContentVisible && summary && (
            <>
              <section className="focus-shell" aria-labelledby="dashboard-focus-title">
                <header className="section-intro"><div><span className="eyebrow">At a glance</span><h2 id="dashboard-focus-title">Focus for this week</h2><p>Review today, the week ahead, and the next active project without leaving planning.</p></div></header>
                <div className="focus-grid">
                  <article className="progress-card" data-testid="today-progress">
                    <div className="card-topline"><h3>Today</h3><span>{todayDone === todayTasks.length ? 'Clear' : `${todayTasks.length - todayDone} open`}</span></div>
                    <dl className="metrics-grid"><Metric label="Complete" value={todayDone} /><Metric label="Open" value={todayTasks.length - todayDone} /><Metric label="Next" value={todayTasks.find((task) => task.status === 'open')?.title ?? 'Clear'} /></dl>
                    <button className="deck-row" type="button" onClick={() => host.onNavigateToScreen?.('planner')} data-testid="open-planner"><strong>{todayTasks.find((task) => task.status === 'open')?.title ?? 'Today is clear'}</strong><span>Open planner</span></button>
                  </article>
                  <article className="progress-card" data-testid="week-progress">
                    <div className="card-topline"><h3>This week</h3><button className="text-button" type="button" onClick={() => host.onNavigateToScreen?.('planner')} data-testid="open-week-planner">Open planner</button></div>
                    <dl className="metrics-grid"><Metric label="Open" value={weekTasks.length} /><Metric label="Past due" value={pastDueTasks.length} /></dl>
                  </article>
                  {project && (
                    <article className="progress-card" data-testid="project-progress">
                      <div className="card-topline"><h3>{project.title}</h3><button className="text-button" type="button" onClick={() => host.onNavigateToScreen?.('projects')} data-testid="open-projects">Open projects</button></div>
                      <p>Owner {project.owner} · due {project.dueLabel}</p>
                      <dl className="metrics-grid"><Metric label="Complete" value={projectDone} /><Metric label="Open" value={projectSteps.length - projectDone} /><Metric label="Next" value={projectNextStep?.title ?? 'Clear'} /></dl>
                      {projectNextStep ? <button className="deck-row" type="button" onClick={() => setSelectedStep(projectNextStep)} data-testid="project-next-step"><strong>{projectNextStep.title}</strong><span>{projectNextStep.dueLabel}</span></button> : <div className="deck-empty">All project steps complete.</div>}
                    </article>
                  )}
                </div>
              </section>

              <section className="context-strip" aria-label="Dashboard handoffs">
                <article className="unread-card">
                  <div className="card-topline"><div><span className="eyebrow">Unread context</span><h2>Unread messages</h2></div><button className="icon-button" type="button" onClick={() => host.onNavigateToScreen?.('messages')} aria-label="Open messages" title="Open messages" data-testid="open-messages">→</button></div>
                  {summary.unreadThreads.length
                    ? summary.unreadThreads.map((thread) => <button key={thread.id} className="thread-preview" type="button" onClick={() => host.onNavigateToScreen?.('messages', { relatedId: thread.id })} data-testid={`unread-preview-${thread.id}`}><span><strong>{thread.title}</strong><small>{thread.preview}</small></span><em>{thread.unreadCount} unread</em></button>)
                    : <p className="empty-copy">No unread threads.</p>}
                </article>
              </section>

              <section className="planning-section" aria-labelledby="planning-title">
                <header className="section-intro compact"><div><span className="eyebrow">Operational view</span><h2 id="planning-title">Planning</h2><p>Tasks stay grouped by urgency without losing collaborator or project context.</p></div></header>
                <div className="planning-grid">
                  <article className="planning-card wide" data-testid="planning-past-due"><div className="list-head"><h3>Past due · {pastDueTasks.length}</h3></div>{pastDueTasks.map((task) => <TaskEntry key={task.id} task={task} onInspect={setSelectedTask} onToggle={(item) => void toggleTask(item)} />)}{!pastDueTasks.length && <p className="empty-copy">Nothing overdue.</p>}</article>
                  <article className="planning-card" data-testid="planning-handoffs"><div className="list-head"><h3>Collaborator handoffs</h3></div>{handoffTasks.length ? handoffTasks.map((task) => <div className="handoff-row" key={task.id}><span><strong>{task.title}</strong><small>{task.collaboratorName}</small></span><em>{task.dueLabel}</em></div>) : <p className="empty-copy">No collaborator handoffs.</p>}</article>
                  <article className="planning-card" data-testid="planning-today"><div className="list-head"><h3>Today · {todayTasks.length}</h3></div>{todayTasks.map((task) => <TaskEntry key={task.id} task={task} onInspect={setSelectedTask} onToggle={(item) => void toggleTask(item)} />)}</article>
                  <article className="planning-card" data-testid="planning-week"><div className="list-head"><h3>This week · {weekTasks.length}</h3></div>{weekTasks.map((task) => <TaskEntry key={task.id} task={task} onInspect={setSelectedTask} onToggle={(item) => void toggleTask(item)} />)}{!weekTasks.length && <p className="empty-copy">No open tasks later this week.</p>}</article>
                  <article className="planning-card" data-testid="planning-project-steps"><div className="list-head"><h3>Project on deck</h3><span>{projectSteps.filter((step) => step.status === 'open').length}</span></div>{projectSteps.map((step) => <ProjectStepEntry key={step.id} step={step} onInspect={setSelectedStep} onToggle={(item) => void toggleStep(item)} />)}{!projectSteps.length && <p className="empty-copy">All project steps are complete.</p>}</article>
                  <article className="planning-card wide" data-testid="planning-unscheduled"><div className="list-head"><h3>Unscheduled · {unscheduledTasks.length}</h3></div>{unscheduledTasks.map((task) => <TaskEntry key={task.id} task={task} onInspect={setSelectedTask} onToggle={(item) => void toggleTask(item)} />)}{!unscheduledTasks.length && <p className="empty-copy">Every open task has a date.</p>}</article>
                </div>
              </section>
            </>
          )}
        </div>

        <FocusDialog open={createOpen} onClose={() => { setCreateOpen(false); setTitleError(false); }} title="Add task" description="Set the task details now." testId="dashboard-task-create">
          <TaskCreateForm
            idPrefix="dashboard-create"
            onSubmit={createTask}
            onCancel={() => { setCreateOpen(false); setTitleError(false); }}
            members={members}
            titleRef={taskTitleRef}
            titleError={titleError ? 'Enter a task title.' : undefined}
            onTitleChange={() => setTitleError(false)}
            disabled={mutationPending}
            noValidate
            testIds={{ title: 'task-title', notes: 'task-notes', scheduledDate: 'task-schedule', dueDate: 'task-due-date', collaborator: 'task-collaborator', cancel: 'dashboard-task-create-cancel', submit: 'task-add', error: 'task-title-error' }}
          />
        </FocusDialog>

        <FocusDialog open={Boolean(selectedTask)} onClose={() => setSelectedTask(null)} title="Task details" description="Inspect or update the selected task." testId="task-inspector" wide>
          <form className="inspector-form" onSubmit={saveTask}>
            <label>Task title<input name="inspectorTitle" defaultValue={selectedTask?.title ?? ''} data-autofocus data-testid="task-inspector-title" /></label>
            <label>Notes<textarea name="inspectorNotes" defaultValue={selectedTask?.notes ?? ''} rows={4} data-testid="task-inspector-notes" /></label>
            <div className="inspector-pair">
              <label>Scheduled date<input name="inspectorScheduledDate" type="date" defaultValue={selectedTask?.scheduledDate ?? ''} data-testid="task-inspector-scheduled" /></label>
              <label>Due date<input name="inspectorDueDate" type="date" defaultValue={selectedTask?.dueDate ?? ''} data-testid="task-inspector-due" /></label>
            </div>
            <section className="inspector-collaborator" aria-label="Task collaborator">
              <span><strong>Collaborator</strong><small>{selectedTask?.collaboratorName ?? 'No collaborator assigned'}</small></span>
              {selectedTask?.collaboratorId
                ? <button className="text-danger-button" type="button" onClick={() => void updateInspectorCollaborator(null)} data-testid="task-inspector-collaborator-remove">Remove</button>
                : <button className="secondary-button" type="button" disabled={!members[0]} onClick={() => members[0] && void updateInspectorCollaborator(members[0].id)} data-testid="task-inspector-collaborator-add">Add {members[0]?.name ?? 'collaborator'}</button>}
            </section>
            <footer><button className="secondary-button" type="button" onClick={() => setSelectedTask(null)} data-testid="task-inspector-cancel">Cancel</button><button className="primary-button" type="submit" disabled={mutationPending} data-testid="task-inspector-save">Save changes</button></footer>
          </form>
        </FocusDialog>

        <FocusDialog open={Boolean(selectedStep)} onClose={() => setSelectedStep(null)} title="Project step details" description={project ? `${project.title} · project step` : 'Project step'} testId="project-step-inspector" wide>
          <form className="inspector-form" onSubmit={(event) => { event.preventDefault(); setSelectedStep(null); }}>
            <label>Step title<input name="stepTitle" defaultValue={selectedStep?.title ?? ''} data-autofocus data-testid="project-step-title" /></label>
            <label>Notes<textarea name="stepNotes" defaultValue={selectedStep?.notes ?? ''} rows={3} data-testid="project-step-notes" /></label>
            <footer><button className="secondary-button" type="button" onClick={() => setSelectedStep(null)} data-testid="project-step-cancel">Cancel</button><button className="primary-button" type="submit" data-testid="project-step-save">Save changes</button></footer>
          </form>
        </FocusDialog>
      </section>
    </ScreenRoot>
  );
}
