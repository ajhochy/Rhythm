// Ported from apps/web/src/pages/tasks/index.tsx (528 lines) — see SOURCE_MAP.md for the
// full list of what was carried over vs. deliberately dropped at the host-neutral boundary
// (agent-session quick actions, the fixture/live-mode split, hash-based deep linking, and the
// HTTP endpoint receipts ledger — all host/transport-specific, not screen behavior).
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { RhythmTaskOperationConfirmation } from '../host/types';
import { useRhythmDomainGateway, useRhythmHost } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { Icon } from '../components/Icon';
import { FocusDialog } from '../components/FocusDialog';
import { HeaderTaskAction } from '../components/HeaderTaskAction';
import { TaskCreateForm } from '../components/TaskCreateForm';
import { quickActionPresets } from '../components/quickActions';
import { RhythmGatewayError, type RhythmTask, type RhythmWorkspaceMember, type TaskStatus } from '../domain/types';

type TasksSurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';
type TasksView = 'list' | 'board';
type TasksSort = 'due' | 'created' | 'status' | 'title';

const boardStatuses: TaskStatus[] = ['open', 'in_progress', 'waiting_for_reply', 'done'];
const taskStatusLabels: Record<TaskStatus, string> = { open: 'Open', in_progress: 'In progress', waiting_for_reply: 'Waiting for reply', done: 'Done' };
const bucketOrder: RhythmTask['bucket'][] = ['past-due', 'today', 'week', 'month', 'no-due', 'completed'];
const bucketLabels: Record<RhythmTask['bucket'], string> = { 'past-due': 'Past due', today: 'Today', week: 'This week', month: 'This month', 'no-due': 'No date', completed: 'Completed' };

function dateLabel(task: RhythmTask) {
  if (task.bucket === 'past-due') return 'Past due';
  if (task.bucket === 'today') return 'Today';
  return task.scheduledDate ?? task.dueDate ?? 'No date';
}

function isSourceReadonly(task: RhythmTask) {
  return task.sourceType === 'calendar_shadow_event' || task.sourceType === 'prod_mirror';
}

function StatePanel({ state, onRetry, onEmpty, canWrite }: { state: Exclude<TasksSurfaceState, 'ready'>; onRetry(): void; onEmpty(): void; canWrite: boolean }) {
  if (state === 'loading') {
    return <section className="tasks-state loading" role="status" aria-live="polite" data-testid="page-state-loading"><span className="eyebrow">Current workspace</span><h2>Loading tasks</h2><p>Gathering the current task list.</p><div className="tasks-skeleton state-skeleton" aria-hidden="true"><span /><span /><span /></div></section>;
  }
  if (state === 'empty') {
    return <section className="tasks-state" role="status" data-testid="page-state-empty"><span className="eyebrow">A clear workspace</span><h2>No tasks yet</h2><p>Create a task above and it will settle into this workspace.</p><button className="primary-button" type="button" disabled={!canWrite} onClick={onEmpty} data-testid="tasks-empty-create">Create a task</button></section>;
  }
  if (state === 'server_error') {
    return <section className="tasks-state danger" role="alert" data-testid="page-state-server-error"><span className="eyebrow">Retryable server error</span><h2>Unable to load tasks</h2><p>The task service returned a temporary failure. Your source data remains unchanged.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  }
  if (state === 'forbidden') {
    return <section className="tasks-state warning" role="alert" data-testid="page-state-forbidden"><span className="eyebrow">Workspace permission required</span><h2>Tasks access is restricted</h2><p>Ask a workspace administrator for task access.</p></section>;
  }
  return <section className="tasks-state warning" role="status" data-testid="page-state-unavailable"><span className="eyebrow">Service prerequisite</span><h2>Tasks are unavailable</h2><p>Reconnect the task service before loading or changing this queue.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

function TaskMenu({ task, readonly, isOwner, ownerOnlyReasonId, readonlyReasonId, onInspect, onDelete }: {
  task: RhythmTask; readonly: boolean; isOwner: boolean; ownerOnlyReasonId: string; readonlyReasonId: string; onInspect(): void; onDelete(): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeWithEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus());
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeWithEscape); };
  }, [open]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
    if (!items.length) return;
    event.preventDefault();
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="task-menu-anchor" ref={rootRef}>
      <button ref={triggerRef} className="icon-button task-menu-trigger" type="button" aria-label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid={`task-menu-${task.id}`}><Icon name="more" size={16} /></button>
      {open && (
        <div className="menu-popover task-menu" role="menu" aria-label={`Actions for ${task.title}`} onKeyDown={moveFocus}>
          <button className="menu-item" role="menuitem" type="button" onClick={() => { setOpen(false); onInspect(); }} data-testid={`task-menu-inspect-${task.id}`}>Inspect task</button>
          <button
            className="menu-item danger-item"
            role="menuitem"
            type="button"
            disabled={!isOwner || readonly}
            aria-describedby={!isOwner ? ownerOnlyReasonId : readonly ? readonlyReasonId : undefined}
            onClick={() => { setOpen(false); onDelete(); }}
            data-testid={`task-delete-${task.id}`}
          >
            Delete task
          </button>
        </div>
      )}
    </div>
  );
}

export function TasksScreen() {
  const { tasks: gateway } = useRhythmDomainGateway();
  const host = useRhythmHost();
  const canWrite = host.currentUser.capabilities?.includes('tasks.write') ?? false;
  const canComplete = canWrite || (host.currentUser.capabilities?.includes('tasks.complete') ?? false);
  const canReschedule = canWrite || (host.currentUser.capabilities?.includes('tasks.reschedule') ?? false);
  const [surfaceState, setSurfaceState] = useState<TasksSurfaceState>('loading');
  const [tasks, setTasks] = useState<RhythmTask[]>([]);
  const [members, setMembers] = useState<RhythmWorkspaceMember[]>([]);
  const [view, setView] = useState<TasksView>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('all');
  const [minimumPriority, setMinimumPriority] = useState('0');
  const [completion, setCompletion] = useState<'open' | 'all'>('open');
  const [dateWindow, setDateWindow] = useState('all');
  const [sort, setSort] = useState<TasksSort>('due');
  const [deleteTarget, setDeleteTarget] = useState<RhythmTask | null>(null);
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [operationTarget, setOperationTarget] = useState<{ task: RhythmTask; operation: 'complete' | 'reschedule'; scheduledDate?: string; generation: string } | null>(null);
  const [operationError, setOperationError] = useState<'conflict' | 'uncertain' | null>(null);
  const createTitleRef = useRef<HTMLInputElement>(null);
  const operationGeneration = useRef(0);
  const operationEpoch = useRef(0);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; operationEpoch.current += 1; }, []);

  const currentUserId = host.currentUser.initials;

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    setSurfaceState('loading');
    try {
      const [loadedTasks, loadedMembers] = await Promise.all([gateway.list(), gateway.members()]);
      setTasks(loadedTasks);
      setMembers(loadedMembers);
      setSurfaceState(loadedTasks.length ? 'ready' : 'empty');
    } catch (error) {
      handleError(error);
    }
  };

  useEffect(() => { void load(); }, [gateway]);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;
  const showsWorkspace = surfaceState === 'ready';
  const ownerOnlyReasonId = 'tasks-owner-only-reason';
  const readonlyReasonId = 'tasks-readonly-reason';

  const tagOptions = useMemo(() => [...new Set(tasks.flatMap((task) => task.tags))].sort(), [tasks]);

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const priority = Number(minimumPriority);
    const filtered = tasks.filter((task) => {
      if (needle && ![task.title, task.notes, task.sourceName ?? ''].some((value) => value.toLocaleLowerCase().includes(needle))) return false;
      if (tag !== 'all' && !task.tags.includes(tag)) return false;
      if (task.priority < priority) return false;
      if (view === 'list' && completion === 'open' && task.status === 'done') return false;
      if (dateWindow !== 'all' && task.bucket !== dateWindow) return false;
      return true;
    });
    const statusOrder: TaskStatus[] = ['open', 'in_progress', 'waiting_for_reply', 'done'];
    return [...filtered].sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
      if (sort === 'created') return left.createdAt.localeCompare(right.createdAt);
      if (sort === 'status') return statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status) || left.title.localeCompare(right.title);
      const leftDate = left.dueDate ?? left.scheduledDate ?? '9999-12-31';
      const rightDate = right.dueDate ?? right.scheduledDate ?? '9999-12-31';
      return leftDate.localeCompare(rightDate) || left.title.localeCompare(right.title);
    });
  }, [completion, dateWindow, minimumPriority, search, sort, tag, tasks, view]);

  const groupedTasks = useMemo(
    () => bucketOrder.map((bucket) => ({ bucket, tasks: visibleTasks.filter((task) => task.bucket === bucket) })).filter((group) => group.tasks.length > 0),
    [visibleTasks],
  );

  const openInspector = (task: RhythmTask) => setSelectedId(task.id);
  const closeInspector = () => setSelectedId(null);

  const changeStatus = async (task: RhythmTask, nextStatus: TaskStatus) => {
    if (!canWrite || mutationPending) return;
    setMutationPending(true);
    try {
      const updated = await gateway.update(task.id, { status: nextStatus });
      setTasks((current) => current.map((item) => (item.id === task.id ? updated : item)));
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const requestTaskOperation = (task: RhythmTask, operation: 'complete' | 'reschedule') => {
    if ((operation === 'complete' && !canComplete) || (operation === 'reschedule' && !canReschedule) || mutationPending) return;
    // This immutable generation binds a human-visible dialog to one foreground action.
    operationGeneration.current += 1;
    operationEpoch.current += 1;
    setOperationError(null);
    setOperationTarget({ task, operation, scheduledDate: operation === 'reschedule' ? task.scheduledDate ?? new Date().toISOString().slice(0, 10) : undefined, generation: `${task.id}:${operation}:${operationGeneration.current}:${Date.now()}` });
  };

  const retryTaskOperation = () => {
    if (!operationTarget || mutationPending) return;
    // A retry is a new foreground intent, never a reuse of the receipt for the
    // previous attempt (including an ambiguous one).
    operationGeneration.current += 1;
    operationEpoch.current += 1;
    setOperationError(null);
    setOperationTarget((target) => target && { ...target, generation: `${target.task.id}:${target.operation}:${operationGeneration.current}:${Date.now()}` });
  };

  const reloadTaskOperationContext = async () => {
    try {
      const [loadedTasks, loadedMembers] = await Promise.all([gateway.list(), gateway.members()]);
      setTasks(loadedTasks);
      setMembers(loadedMembers);
      setSurfaceState(loadedTasks.length ? 'ready' : 'empty');
    } catch (error) {
      handleError(error);
    }
  };

  const isIsoCalendarDate = (value: string | undefined) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);

  const confirmTaskOperation = async () => {
    if (!operationTarget || mutationPending) return;
    if (operationTarget.operation === 'reschedule' && !isIsoCalendarDate(operationTarget.scheduledDate)) {
      handleError(new RhythmGatewayError('server_error', 'Choose a real calendar date.'));
      return;
    }
    const confirmation: RhythmTaskOperationConfirmation = { taskId: operationTarget.task.id, generation: operationTarget.generation, operation: operationTarget.operation, scheduledDate: operationTarget.scheduledDate };
    const target = operationTarget;
    const epoch = operationEpoch.current;
    setMutationPending(true);
    try {
      if (host.confirmTaskOperation && !(await host.confirmTaskOperation(confirmation))) return;
      // The host confirmation can suspend across a provider re-home.  Do not let a
      // receipt issued for the old mounted target perform a write in the new one.
      if (!mounted.current || operationEpoch.current !== epoch || operationTarget !== target) return;
      const updated = target.operation === 'complete'
        ? gateway.complete ? await gateway.complete(target.task.id, target.generation) : canWrite ? await gateway.update(target.task.id, { status: 'done' }) : null
        : gateway.reschedule && target.scheduledDate ? await gateway.reschedule(target.task.id, target.scheduledDate, target.generation) : canWrite && target.scheduledDate ? await gateway.update(target.task.id, { scheduledDate: target.scheduledDate }) : null;
      if (!mounted.current || operationEpoch.current !== epoch || operationTarget !== target) return;
      if (!updated) throw new RhythmGatewayError('forbidden', 'This host does not expose the requested task operation.');
      setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
      setOperationTarget(null);
    } catch (error) {
      const outcome = (error as { kind?: unknown } | null)?.kind;
      if (outcome === 'conflict' || outcome === 'uncertain') {
        // Keep the exact foreground context visible: neither outcome proves a
        // local success, and the user needs a fresh confirmation to retry.
        setOperationError(outcome);
      } else {
        handleError(error);
      }
    } finally {
      setMutationPending(false);
    }
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) { createTitleRef.current?.focus(); return; }
    setMutationPending(true);
    try {
      const created = await gateway.create({
        title,
        notes: String(data.get('notes') ?? '').trim(),
        scheduledDate: String(data.get('scheduledDate') ?? '') || undefined,
        dueDate: String(data.get('dueDate') ?? '') || undefined,
      });
      setTasks((current) => [...current, created]);
      const collaboratorId = String(data.get('collaboratorId') ?? '');
      if (collaboratorId) {
        const withCollaborator = await gateway.addCollaborator(created.id, collaboratorId);
        setTasks((current) => current.map((item) => (item.id === withCollaborator.id ? withCollaborator : item)));
      }
      form.reset();
      setCreateOpen(false);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const saveInspector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || !selectedTask) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') ?? '').trim();
    if (!title) return;
    setMutationPending(true);
    try {
      const updated = await gateway.update(selectedTask.id, {
        title,
        notes: String(data.get('notes') ?? ''),
        scheduledDate: String(data.get('scheduledDate') ?? '') || undefined,
        dueDate: String(data.get('dueDate') ?? '') || undefined,
        preferredAgent: String(data.get('preferredAgent') ?? '') as RhythmTask['preferredAgent'],
        energy: String(data.get('energy') ?? '') as RhythmTask['energy'],
      });
      setTasks((current) => current.map((task) => (task.id === selectedTask.id ? updated : task)));
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const addCollaborator = async (memberId: string) => {
    if (!canWrite || !selectedTask) return;
    try {
      const updated = await gateway.addCollaborator(selectedTask.id, memberId);
      setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
      setCollaboratorPickerOpen(false);
    } catch (error) {
      handleError(error);
    }
  };

  const removeCollaborator = async (memberId: string) => {
    if (!canWrite || !selectedTask) return;
    try {
      const updated = await gateway.removeCollaborator(selectedTask.id, memberId);
      setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
    } catch (error) {
      handleError(error);
    }
  };

  const confirmDelete = async () => {
    if (!canWrite || !deleteTarget) return;
    setMutationPending(true);
    try {
      await gateway.delete(deleteTarget.id);
      setTasks((current) => current.filter((task) => task.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (error) {
      handleError(error);
    } finally {
      setMutationPending(false);
    }
  };

  const moveTask = (status: TaskStatus) => {
    if (!draggedId) return;
    const task = tasks.find((item) => item.id === draggedId);
    if (canWrite && task && task.status !== status && !isSourceReadonly(task)) void changeStatus(task, status);
    setDraggedId(null);
  };

  const launchQuickAction = (actionId: string, label: string) => {
    if (!selectedTask) return;
    host.onRequestFollowUp?.({ screen: 'tasks', label, action: actionId, relatedId: selectedTask.id });
  };

  const clearFilters = () => {
    setSearch('');
    setTag('all');
    setMinimumPriority('0');
    setCompletion('open');
    setDateWindow('all');
  };

  const renderTaskRow = (task: RhythmTask) => {
    const isOwner = !task.isShared;
    const readonly = !canWrite || isSourceReadonly(task) || mutationPending;
    return (
      <div className="task-row" role="row" aria-selected={selectedId === task.id} data-status={task.status} data-testid={`task-row-${task.id}`} key={task.id}>
        <span className="task-cell complete-cell" role="gridcell">
          <label className="task-complete-label">
            <span className="sr-only">{task.status === 'done' ? 'Reopen' : 'Complete'} {task.title}</span>
            <input
              type="checkbox"
              checked={task.status === 'done'}
              disabled={!canComplete || isSourceReadonly(task) || mutationPending}
              aria-describedby={!canComplete || isSourceReadonly(task) ? readonlyReasonId : undefined}
              onChange={() => requestTaskOperation(task, 'complete')}
              data-testid={`task-complete-${task.id}`}
            />
          </label>
          {canReschedule && !isSourceReadonly(task) && <button className="text-button" type="button" disabled={mutationPending} onClick={() => requestTaskOperation(task, 'reschedule')} data-testid={`task-reschedule-${task.id}`}>Reschedule</button>}
        </span>
        <span className="task-cell main-cell" role="gridcell">
          <button className="task-row-main" type="button" onClick={() => openInspector(task)} data-testid={`task-select-${task.id}`}>
            <span className="task-row-copy">
              <span className="task-kicker">{task.sourceName ?? taskStatusLabels[task.status]}</span>
              <h3 data-testid="task-title">{task.title}</h3>
              <span className="task-meta">{dateLabel(task)}{task.priority ? ` · P${task.priority}` : ''}</span>
            </span>
            <span className="task-tags" aria-label={task.tags.length ? `Tags: ${task.tags.join(', ')}` : 'No tags'}>
              {task.tags.slice(0, 3).map((item) => <span key={item}>{item}</span>)}
            </span>
          </button>
        </span>
        <span className="task-cell inspect-cell" role="gridcell">
          <button className="icon-button task-inspect-button" type="button" aria-label={`Inspect ${task.title}`} onClick={() => openInspector(task)} data-testid={`task-inspect-${task.id}`}>
            <Icon name="chevronRight" size={15} />
          </button>
        </span>
        <span className="task-cell menu-cell" role="gridcell">
          <TaskMenu task={task} readonly={readonly} isOwner={isOwner} ownerOnlyReasonId={ownerOnlyReasonId} readonlyReasonId={readonlyReasonId} onInspect={() => openInspector(task)} onDelete={() => setDeleteTarget(task)} />
        </span>
      </div>
    );
  };

  const collaboratorCandidates = selectedTask
    ? members.filter((member) => member.id !== selectedTask.ownerId && !selectedTask.collaborators.some((existing) => existing.id === member.id))
    : [];
  const selectedIsOwner = selectedTask ? !selectedTask.isShared : false;
  const selectedReadonly = Boolean(selectedTask && (!canWrite || isSourceReadonly(selectedTask) || mutationPending));

  return (
    <ScreenRoot screenName="Tasks" testId="rhythm-tasks-screen">
      <section className="page-shell pg-tasks" aria-busy={surfaceState === 'loading'}>
        <header className="tasks-header">
          <div className="tasks-heading"><span className="eyebrow">Planning queue</span><h1>Tasks</h1><p>Shape the next useful handoff without losing the wider rhythm.</p></div>
          <div className="tasks-header-actions">
            <span className="tasks-count" data-testid="tasks-visible-count">{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}</span>
            <HeaderTaskAction onClick={() => canWrite && setCreateOpen(true)} disabled={!canWrite || !showsWorkspace || mutationPending} testId="tasks-header-add-task" />
            <div className="tasks-view-switch" aria-label="Task presentation">
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} data-testid="tasks-view-list">List</button>
              <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')} data-testid="tasks-view-board">Board</button>
            </div>
          </div>
        </header>

        <div className="tasks-scroll" role="region" aria-label="Tasks workspace content" tabIndex={0}>
          {!showsWorkspace && <StatePanel state={surfaceState} onRetry={() => void load()} onEmpty={() => canWrite && setCreateOpen(true)} canWrite={canWrite} />}
          {showsWorkspace && (
            <>
              <p className="tasks-owner-note" id={ownerOnlyReasonId}><strong>Shared-task permissions</strong> Collaborators may edit and complete; only the task owner can add or remove collaborators or delete.</p>
              <p className="sr-only" id={readonlyReasonId}>This task is synchronized from another source of truth and is inspect-only here.</p>
              {!canWrite && <p className="inspector-prerequisite" role="status" data-testid="tasks-readonly-explanation"><strong>Read-only workspace</strong><span>Your host has not granted Tasks write access. You can inspect tasks and ask Hermes, but changes are unavailable.</span></p>}

              <div className="tasks-workspace-layout">
                <div className="tasks-collection">
                  <section className="tasks-workspace" aria-labelledby="tasks-workspace-title">
                    <div className="tasks-controls">
                      <div><span className="eyebrow">Organize</span><h2 id="tasks-workspace-title">{view === 'list' ? 'Task list' : 'Task board'}</h2></div>
                      <div className="tasks-filter-grid">
                        <div className="search-field">
                          <Icon name="search" size={14} />
                          <label className="sr-only" htmlFor="tasks-search-input">Search tasks</label>
                          <input id="tasks-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" data-testid="tasks-search" />
                          {search && <button className="tasks-search-clear" type="button" aria-label="Clear task search" onClick={() => setSearch('')} data-testid="tasks-clear-search"><Icon name="close" size={13} /></button>}
                        </div>
                        <label><span>Tag</span><select value={tag} onChange={(event) => setTag(event.target.value)} data-testid="tasks-tag-filter"><option value="all">All tags</option>{tagOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                        <label><span>Priority</span><select value={minimumPriority} onChange={(event) => setMinimumPriority(event.target.value)} data-testid="tasks-priority-filter"><option value="0">Any priority</option><option value="1">P1+</option><option value="2">P2+</option><option value="3">P3+</option></select></label>
                        <label><span>Open / All</span><select value={completion} onChange={(event) => setCompletion(event.target.value as 'open' | 'all')} data-testid="tasks-completion-filter"><option value="open">Open</option><option value="all">All</option></select></label>
                        <label><span>Date window</span><select value={dateWindow} onChange={(event) => setDateWindow(event.target.value)} data-testid="tasks-date-filter"><option value="all">All</option><option value="today">Today</option><option value="week">This Week</option><option value="month">This Month</option></select></label>
                        {view === 'list' && <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as TasksSort)} data-testid="tasks-sort"><option value="due">Due date</option><option value="created">Created date</option><option value="status">Status</option><option value="title">Title</option></select></label>}
                      </div>
                    </div>

                    {visibleTasks.length === 0 ? (
                      <section className="tasks-no-results" data-testid="tasks-no-results">
                        <h2>{search ? 'No matching tasks' : 'Nothing to show'}</h2>
                        <p>{search ? 'Clear the search to restore the queue.' : 'Clear an active filter to see the full task list.'}</p>
                        <button className="secondary-button" type="button" onClick={clearFilters} data-testid="tasks-clear-filters">Clear filters</button>
                      </section>
                    ) : view === 'list' ? (
                      <div className="tasks-list" data-testid="tasks-list">
                        {groupedTasks.map((group) => (
                          <section className="task-group" aria-labelledby={`task-group-title-${group.bucket}`} data-testid={`task-group-${group.bucket}`} key={group.bucket}>
                            <header><h2 id={`task-group-title-${group.bucket}`}>{bucketLabels[group.bucket]}</h2><span>{group.tasks.length}</span></header>
                            <div role="grid" aria-label={`${bucketLabels[group.bucket]} tasks`}>{group.tasks.map(renderTaskRow)}</div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <div className="kanban-board" role="region" tabIndex={0} data-testid="tasks-board" aria-label="Task status board">
                        {boardStatuses.map((status) => {
                          const columnTasks = visibleTasks.filter((task) => task.status === status);
                          return (
                            <section className="kanban-column" onDragOver={(event) => event.preventDefault()} onDrop={() => moveTask(status)} aria-labelledby={`kanban-title-${status}`} data-testid={`kanban-column-${status.replaceAll('_', '-')}`} key={status}>
                              <header><h2 id={`kanban-title-${status}`}>{taskStatusLabels[status]}</h2><span>{columnTasks.length}</span></header>
                              <div className="kanban-stack" role="listbox" aria-label={`${taskStatusLabels[status]} tasks`}>
                                {columnTasks.length ? columnTasks.map((task) => (
                                  <div
                                    className="task-card"
                                    role="option"
                                    tabIndex={0}
                                    draggable={canWrite && !isSourceReadonly(task)}
                                    aria-selected={selectedId === task.id}
                                    aria-label={`Inspect ${task.title}`}
                                    onDragStart={() => setDraggedId(task.id)}
                                    onClick={() => openInspector(task)}
                                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openInspector(task); } }}
                                    data-testid={`task-card-${task.id}`}
                                    key={task.id}
                                  >
                                    <span className="task-kicker">{taskStatusLabels[task.status]}</span>
                                    <h3>{task.title}</h3>
                                    <p>{dateLabel(task)}</p>
                                    <div className="task-card-tags">{task.priority ? <span>P{task.priority}</span> : null}{task.tags.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div>
                                  </div>
                                )) : <p className="kanban-empty">No tasks in this stage.</p>}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>

                <aside className="task-detail-column" aria-label="Selected task" data-testid="task-inspector">
                  {selectedTask ? (
                    <section className="task-detail" aria-labelledby="task-detail-title">
                      <header>
                        <div><span className="task-detail-state">{taskStatusLabels[selectedTask.status]}</span><h2 id="task-detail-title">{selectedTask.title}</h2><p>{selectedTask.priority ? `P${selectedTask.priority} · ` : ''}{selectedTask.sourceName ?? 'Rhythm task'} · {dateLabel(selectedTask)}</p></div>
                        <button className="text-button" type="button" onClick={closeInspector} data-testid="task-detail-close">Close</button>
                      </header>
                      {selectedReadonly && <div className="inspector-prerequisite" role="status"><strong>{canWrite ? 'Synchronized source of truth' : 'Read-only workspace'}</strong><span>{canWrite ? 'This task is inspect-only here.' : 'Your host has not granted Tasks write access.'}</span></div>}
                      <form className="task-inspector-form" key={selectedTask.id} onSubmit={saveInspector}>
                        <div className="task-source-grid"><div><span>Created by</span><strong data-testid="task-created-by">{selectedTask.createdBy}</strong></div><div><span>Status</span><strong>{taskStatusLabels[selectedTask.status]}</strong></div></div>
                        <fieldset disabled={selectedReadonly}>
                          <legend className="sr-only">Task details</legend>
                          <label>Title<input disabled={selectedReadonly} name="title" required defaultValue={selectedTask.title} data-testid="task-edit-title" /></label>
                          <label>Notes<textarea disabled={selectedReadonly} name="notes" rows={4} defaultValue={selectedTask.notes} data-testid="task-edit-notes" /></label>
                          <div className="inspector-pair">
                            <label>Scheduled date<input disabled={selectedReadonly} name="scheduledDate" type="date" defaultValue={selectedTask.scheduledDate ?? ''} data-testid="task-edit-scheduled-date" /></label>
                            <label>Due date<input disabled={selectedReadonly} name="dueDate" type="date" defaultValue={selectedTask.dueDate ?? ''} data-testid="task-edit-due-date" /></label>
                          </div>
                          <div className="inspector-pair">
                            <label>Default agent<select disabled={selectedReadonly} name="preferredAgent" defaultValue={selectedTask.preferredAgent} data-testid="task-edit-agent"><option value="">None</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option></select></label>
                            <label>Energy<select disabled={selectedReadonly} name="energy" defaultValue={selectedTask.energy} data-testid="task-edit-energy"><option value="">None</option><option value="🔥">🔥 Fire</option><option value="⚡">⚡ Electric</option><option value="🌱">🌱 Grounded</option></select></label>
                          </div>
                          <footer className="task-detail-form-actions">
                            <button className="secondary-button" type="button" disabled={selectedReadonly} onClick={() => void changeStatus(selectedTask, selectedTask.status === 'done' ? 'open' : 'done')} data-testid="task-detail-complete">{selectedTask.status === 'done' ? 'Reopen' : 'Complete'}</button>
                            <button className="primary-button" type="submit" disabled={selectedReadonly} data-testid="task-save">Save changes</button>
                          </footer>
                        </fieldset>
                      </form>
                      <section className="task-people" aria-labelledby="task-people-title">
                        <div className="inspector-section-heading">
                          <div><h3 id="task-people-title">People</h3><p>Collaborators on this task.</p></div>
                          <button className="secondary-button" type="button" disabled={!selectedIsOwner || selectedReadonly} aria-describedby={!selectedIsOwner ? ownerOnlyReasonId : selectedReadonly ? readonlyReasonId : undefined} onClick={() => setCollaboratorPickerOpen(true)} data-testid="task-add-collaborator"><Icon name="plus" size={14} />Add</button>
                        </div>
                        <div className="collaborator-list">
                          {selectedTask.collaborators.length ? selectedTask.collaborators.map((person) => (
                            <div className="collaborator-chip" data-testid={`task-collaborator-${person.id}`} key={person.id}>
                              <span aria-hidden="true">{person.initials}</span><strong>{person.name}</strong>
                              <button className="icon-button" type="button" disabled={!selectedIsOwner || selectedReadonly} aria-label={`Remove ${person.name}`} onClick={() => void removeCollaborator(person.id)} data-testid={`task-remove-collaborator-${person.id}`}><Icon name="close" size={13} /></button>
                            </div>
                          )) : <p>No collaborators yet.</p>}
                        </div>
                      </section>
                      {(!selectedReadonly || !canWrite) && (
                        <section className="task-quick-actions" aria-labelledby="task-quick-title">
                          <h3 id="task-quick-title">Quick actions</h3>
                          <div>{quickActionPresets.map((action) => <button className="task-action-chip" type="button" onClick={() => launchQuickAction(action.id, action.label)} data-testid={`quick-action-${action.id}`} key={action.id}>{action.label}</button>)}</div>
                        </section>
                      )}
                    </section>
                  ) : (
                    <section className="task-detail-empty" aria-labelledby="task-detail-empty-title"><h2 id="task-detail-empty-title">Select a task</h2><p>Open a task to review its context, people, and next actions without leaving the queue.</p></section>
                  )}
                </aside>
              </div>
            </>
          )}
        </div>

        <FocusDialog open={createOpen} onClose={() => setCreateOpen(false)} title="Add task" description="Set the task details now. More people are available after creation." testId="task-create-dialog">
          <TaskCreateForm
            idPrefix="tasks-create"
            onSubmit={createTask}
            onCancel={() => setCreateOpen(false)}
            members={members.filter((member) => member.id !== currentUserId)}
            titleRef={createTitleRef}
            disabled={!canWrite || mutationPending}
            testIds={{ title: 'task-create-title', notes: 'task-create-notes', scheduledDate: 'task-create-scheduled-date', dueDate: 'task-create-due-date', collaborator: 'task-create-collaborator', cancel: 'task-create-cancel', submit: 'task-create-submit', mutations: 'tasks-mutations' }}
          />
        </FocusDialog>

        <FocusDialog open={collaboratorPickerOpen} onClose={() => setCollaboratorPickerOpen(false)} title="Add collaborator" description="Only workspace members who are not the owner or already collaborating are shown." testId="task-collaborator-picker">
          <div className="collaborator-options" role="listbox" aria-label="Available collaborators">
            {collaboratorCandidates.length ? collaboratorCandidates.map((person) => (
              <button className="secondary-button" role="option" aria-selected="false" type="button" onClick={() => void addCollaborator(person.id)} data-testid={`task-collaborator-option-${person.id}`} key={person.id}>
                <span>{person.initials}</span><strong>{person.name}</strong>
              </button>
            )) : <p>No eligible collaborators remain.</p>}
          </div>
        </FocusDialog>

        <FocusDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={deleteTarget ? `Delete "${deleteTarget.title}"?` : 'Delete task?'} description="This cannot be undone." testId="task-delete-dialog">
          <p className="delete-copy">The task and its collaborator links will be removed.</p>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)} data-testid="task-delete-cancel">Cancel</button>
            <button className="danger-button" type="button" disabled={!canWrite || mutationPending} onClick={() => void confirmDelete()} data-testid="task-delete-confirm">Delete task</button>
          </div>
        </FocusDialog>

        <FocusDialog open={Boolean(operationTarget)} onClose={() => { operationEpoch.current += 1; setOperationError(null); setOperationTarget(null); }} title={operationTarget?.operation === 'complete' ? `Complete “${operationTarget.task.title}”?` : `Reschedule “${operationTarget?.task.title ?? ''}”?`} description="This action is sent only after you confirm it." testId="task-operation-confirmation">
          {operationTarget?.operation === 'reschedule' && <label>Scheduled date<input type="date" value={operationTarget.scheduledDate ?? ''} disabled={mutationPending} onChange={(event) => setOperationTarget((current) => current ? { ...current, scheduledDate: event.target.value } : current)} data-testid="task-operation-date" /></label>}
          <p role="status">{operationTarget?.operation === 'complete' ? 'Mark this task complete.' : `Set the scheduled date to ${operationTarget?.scheduledDate ?? ''}.`}</p>
          {operationError && <div role="alert" data-testid="task-operation-outcome"><p>{operationError === 'conflict' ? 'This task changed elsewhere. Reload before retrying.' : 'We could not verify whether the task operation was applied. Reload before retrying.'}</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => void reloadTaskOperationContext()} data-testid="task-operation-reload">Reload</button><button className="secondary-button" type="button" onClick={retryTaskOperation} data-testid="task-operation-retry">Retry</button></div></div>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => { operationEpoch.current += 1; setOperationError(null); setOperationTarget(null); }}>Cancel</button><button className="primary-button" type="button" disabled={mutationPending || (operationTarget?.operation === 'reschedule' && !isIsoCalendarDate(operationTarget.scheduledDate))} onClick={() => void confirmTaskOperation()} data-autofocus data-testid="task-operation-confirm">Confirm</button></div>
        </FocusDialog>
      </section>
    </ScreenRoot>
  );
}
