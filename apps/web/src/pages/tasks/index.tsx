import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { HeaderTaskAction } from '../../components/HeaderTaskAction';
import { TaskCreateForm } from '../../components/TaskCreateForm';
import { navigate } from '../../components/Shell';
import { Icon } from '../../icons';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import { TaskGatewayError, type TaskCollaborator as ApiTaskCollaborator } from '../../gateway/tasks';
import { launchQuickActionSession, quickActionPresets, type QuickActionPresetId, type QuickActionTaskContext } from '../../components/quickActions';
import {
  cloneSeededTasks,
  currentUserId,
  initialTaskReceipts,
  taskBucketLabels,
  taskBucketOrder,
  taskStatusLabels,
  workspaceMembers,
  type TaskBucket,
  type TaskFixture,
  type TaskStatus,
} from './fixtures';
import './styles.css';

type TasksSurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type TasksView = 'list' | 'board';
type TasksSort = 'due' | 'created' | 'status' | 'title';
type QuickActionId = QuickActionPresetId;

const supportedStates: TasksSurfaceState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];
const boardStatuses: TaskStatus[] = ['open', 'in_progress', 'waiting_for_reply', 'done'];
const quickActions = quickActionPresets;

function hashParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function initialSurfaceState(): TasksSurfaceState {
  const value = hashParams().get('state');
  return supportedStates.includes(value as TasksSurfaceState) ? value as TasksSurfaceState : 'ready';
}

function routeSelection(route: string) {
  const match = route.match(/\/task\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function routeView(route: string): TasksView {
  return route.startsWith('/tasks/board') ? 'board' : 'list';
}

function dateLabel(task: TaskFixture) {
  if (task.bucket === 'past-due') return 'Past due';
  if (task.bucket === 'today') return 'Today';
  if (task.scheduledDate) return task.scheduledDate;
  if (task.dueDate) return task.dueDate;
  return 'No date';
}

function isSourceReadonly(task: TaskFixture) {
  return task.sourceType === 'calendar_shadow_event' || task.sourceType === 'prod_mirror';
}

function taskIdForTitle(title: string) {
  if (title.toLocaleLowerCase() === 'coordinate sanctuary reset') return 'task-sanctuary-reset';
  const slug = title.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `task-${slug || 'created'}`;
}

function StatePanel({ state, onRetry, onEmpty }: { state: Exclude<TasksSurfaceState, 'ready' | 'readonly' | 'forbidden'>; onRetry(): void; onEmpty(): void }) {
  if (state === 'loading') {
    return <section className="tasks-state loading" role="status" aria-live="polite" data-testid="page-state-loading"><span className="tasks-state-spinner" aria-hidden="true" /><span className="eyebrow">Current workspace</span><h2>Loading tasks</h2><p>Gathering the current task list and workspace people.</p><div className="tasks-skeleton" aria-hidden="true"><span /><span /><span /></div></section>;
  }
  if (state === 'empty') {
    return <section className="tasks-state" role="status" data-testid="page-state-empty"><span className="tasks-state-mark" aria-hidden="true">＋</span><span className="eyebrow">A clear workspace</span><h2>No tasks yet</h2><p>Create a task above and it will settle into this workspace.</p><button className="primary-button" type="button" onClick={onEmpty} data-testid="tasks-empty-create">Create a task</button></section>;
  }
  if (state === 'server-error') {
    return <section className="tasks-state danger" role="alert" data-testid="page-state-server-error"><span className="tasks-state-code">503</span><span className="eyebrow">Retryable server error</span><h2>Unable to load tasks</h2><p>The seeded task adapter returned a temporary failure. Your source data remains unchanged.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  }
  return <section className="tasks-state warning" role="status" data-testid="page-state-unavailable"><span className="tasks-state-mark" aria-hidden="true">◇</span><span className="eyebrow">Desktop prerequisite</span><h2>Tasks are unavailable</h2><p>Reconnect the desktop task service before loading or changing this queue.</p></section>;
}

function TaskMenu({ task, ownerOnlyReasonId, readonlyReasonId, readonly, isOwner, onInspect, onDelete }: { task: TaskFixture; ownerOnlyReasonId: string; readonlyReasonId: string; readonly: boolean; isOwner: boolean; onInspect(): void; onDelete(): void }) {
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

  return <div className="task-menu-anchor" ref={rootRef}><button ref={triggerRef} className="icon-button task-menu-trigger" type="button" aria-label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid={`task-menu-${task.id}`}><Icon name="more" size={16} /></button>{open && <div className="menu-popover task-menu" role="menu" aria-label={`Actions for ${task.title}`} onKeyDown={moveFocus}><button className="menu-item" role="menuitem" type="button" onClick={() => { setOpen(false); onInspect(); }} data-testid={`task-menu-inspect-${task.id}`}>Inspect task</button><button className="menu-item danger-item" role="menuitem" type="button" disabled={!isOwner || readonly} aria-describedby={!isOwner ? ownerOnlyReasonId : readonly ? readonlyReasonId : undefined} title={!isOwner ? 'Only the task owner can delete this task' : readonly ? 'Make changes in the synchronized source of truth' : undefined} onClick={() => { setOpen(false); onDelete(); }} data-testid={`task-delete-${task.id}`}>Delete task</button></div>}</div>;
}

export function TasksPage({ route }: { route: string }) {
  const { notify, createSession } = useFixtures();
  const gateway = useGateway();
  const initialParams = useMemo(hashParams, []);
  const [surfaceState, setSurfaceState] = useState<TasksSurfaceState>(initialSurfaceState);
  const [tasks, setTasks] = useState<TaskFixture[]>(cloneSeededTasks);
  const [receipts, setReceipts] = useState<string[]>(() => surfaceState === 'server-error' ? ['GET /tasks → 503'] : gateway.mode === 'fixture' ? [...initialTaskReceipts] : []);
  const [view, setView] = useState<TasksView>(() => routeView(route));
  const [selectedId, setSelectedId] = useState<string | null>(() => routeSelection(route));
  const [search, setSearch] = useState(() => initialParams.get('search') ?? '');
  const [tag, setTag] = useState(() => initialParams.get('tag') ?? 'all');
  const [minimumPriority, setMinimumPriority] = useState(() => initialParams.get('priority') ?? '0');
  const [completion, setCompletion] = useState(() => initialParams.get('completion') ?? 'open');
  const [dateWindow, setDateWindow] = useState(() => initialParams.get('date') ?? 'all');
  const [sort, setSort] = useState<TasksSort>(() => (['due', 'created', 'status', 'title'].includes(initialParams.get('sort') ?? '') ? initialParams.get('sort') as TasksSort : 'due'));
  const [deleteTarget, setDeleteTarget] = useState<TaskFixture | null>(null);
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  // Live-only: the real collaborator round-trip (apps/api_server/src/routes/tasks_routes.ts:14-16).
  // Kept separate from TaskFixture.collaborators, whose {id,name,initials} shape is fixture-only
  // and does not match the API's {userId,name,photoUrl} (apps/api_server/src/models/task.ts:1-5).
  const [liveCollaborators, setLiveCollaborators] = useState<ApiTaskCollaborator[]>([]);
  const [collaboratorUserId, setCollaboratorUserId] = useState('');
  const [quickActionPending, setQuickActionPending] = useState(false);
  const createTitleRef = useRef<HTMLInputElement>(null);

  const recordError = (method: string, path: string, error: unknown) => {
    const status = error instanceof TaskGatewayError ? error.status : 0;
    appendReceipt(`${method} ${path} → ${status || 'network error'}`);
    setSurfaceState(status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'unavailable' : 'server-error');
  };

  const loadTasks = async () => {
    if (gateway.mode === 'fixture') return;
    setSurfaceState('loading');
    try {
      const loaded = await gateway.domains.tasks!.list();
      setTasks(loaded);
      setSurfaceState(loaded.length ? 'ready' : 'empty');
      appendReceipt('GET /tasks?status=all → 200');
    } catch (error) {
      recordError('GET', '/tasks?status=all', error);
    }
  };

  useEffect(() => { void loadTasks(); }, [gateway]);

  // Fires for both click-driven selection and a direct deep link (e.g. #/tasks/task/<id>), since
  // the redspec for post-m1-p3-c2c loads the inspector route directly rather than clicking a row.
  useEffect(() => {
    if (gateway.mode !== 'live' || !selectedId) { setLiveCollaborators([]); return; }
    let cancelled = false;
    gateway.domains.tasks!.collaborators(selectedId)
      .then((loaded) => {
        if (cancelled) return;
        setLiveCollaborators(loaded);
        appendReceipt(`GET /tasks/${selectedId}/collaborators → 200`);
      })
      .catch((error) => { if (!cancelled) recordError('GET', `/tasks/${selectedId}/collaborators`, error); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, selectedId]);

  useLayoutEffect(() => {
    const labels: Record<string, string> = {
      'task-create-dialog': 'Task creation fields',
      'task-collaborator-picker': 'Collaborator picker content',
      'task-delete-dialog': 'Delete task confirmation',
    };
    document.querySelectorAll<HTMLElement>('.pg-tasks .dialog-body').forEach((scrollContainer) => {
      const dialogId = scrollContainer.closest<HTMLElement>('[data-testid]')?.dataset.testid ?? '';
      scrollContainer.tabIndex = 0;
      scrollContainer.setAttribute('role', 'region');
      scrollContainer.setAttribute('aria-label', labels[dialogId] ?? 'Task dialog content');
    });
  }, [collaboratorPickerOpen, createOpen, deleteTarget]);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;
  const isReadonly = surfaceState === 'readonly';
  const showsWorkspace = surfaceState === 'ready' || surfaceState === 'readonly' || surfaceState === 'forbidden';
  const ownerOnlyReasonId = 'tasks-owner-only-reason';
  const readonlyReasonId = 'tasks-readonly-reason';

  const tags = useMemo(() => [...new Set(tasks.flatMap((task) => task.tags))].sort(), [tasks]);

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

  const groupedTasks = useMemo(() => taskBucketOrder.map((bucket) => ({ bucket, tasks: visibleTasks.filter((task) => task.bucket === bucket) })).filter((group) => group.tasks.length > 0), [visibleTasks]);

  const writeUrl = (overrides: { view?: TasksView; selectedId?: string | null; state?: TasksSurfaceState } = {}, queryPatch: Record<string, string | null> = {}) => {
    const nextView = overrides.view ?? view;
    const nextSelectedId = Object.hasOwn(overrides, 'selectedId') ? overrides.selectedId ?? null : selectedId;
    const params = hashParams();
    Object.entries(queryPatch).forEach(([key, value]) => { if (!value || value === 'all' || value === '0' || value === 'open' || value === 'due') params.delete(key); else params.set(key, value); });
    if (overrides.state) params.set('state', overrides.state);
    const path = `/tasks${nextView === 'board' ? '/board' : ''}${nextSelectedId ? `/task/${encodeURIComponent(nextSelectedId)}` : ''}`;
    const query = params.toString();
    history.replaceState(null, '', `#${path}${query ? `?${query}` : ''}`);
  };

  const setQueryValue = (key: string, value: string, setter: (value: never) => void) => {
    setter(value as never);
    writeUrl({}, { [key]: value });
  };

  const openInspector = (task: TaskFixture) => {
    setSelectedId(task.id);
    writeUrl({ selectedId: task.id });
  };

  const closeInspector = () => {
    setSelectedId(null);
    writeUrl({ selectedId: null });
  };

  const appendReceipt = (receipt: string) => setReceipts((current) => [...current, receipt]);

  const changeStatus = async (task: TaskFixture, nextStatus: TaskStatus) => {
    if (mutationPending) return;
    if (gateway.mode === 'live') {
      setMutationPending(true);
      try {
        const updated = await gateway.domains.tasks!.update(task.id, { status: nextStatus });
        setTasks((current) => current.map((item) => item.id === task.id ? updated : item));
        appendReceipt(`PATCH /tasks/${task.id} {status:"${nextStatus}"} → 200`);
        notify(nextStatus === 'done' ? 'Task marked complete.' : `${task.title} reopened`);
      } catch (error) { recordError('PATCH', `/tasks/${task.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus, bucket: nextStatus === 'done' ? 'completed' : item.bucket === 'completed' ? 'no-due' : item.bucket } : item));
    appendReceipt(`PATCH /tasks/${task.id} {status:"${nextStatus}"} → 200`);
    notify(nextStatus === 'done' ? 'Task marked complete.' : `${task.title} reopened`);
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) { createTitleRef.current?.focus(); return; }
    const notes = String(data.get('notes') ?? '').trim();
    const scheduledDate = String(data.get('scheduledDate') ?? '');
    const dueDate = String(data.get('dueDate') ?? '');
    const collaboratorId = String(data.get('collaboratorId') ?? '');
    const collaborator = workspaceMembers.find((person) => person.id === collaboratorId);
    if (gateway.mode === 'live') {
      setMutationPending(true);
      try {
        const created = await gateway.domains.tasks!.create({ title, notes, scheduledDate: scheduledDate || undefined, dueDate: dueDate || undefined, preferredAgent: '' });
        setTasks((current) => [...current, created]);
        appendReceipt(`POST /tasks {title${notes ? ',notes' : ''}${scheduledDate ? ',scheduledDate' : ''}${dueDate ? ',dueDate' : ''},preferredAgent} → 201`);
        form.reset(); setCreateOpen(false); notify(`${title} added`);
      } catch (error) { recordError('POST', '/tasks', error); } finally { setMutationPending(false); }
      return;
    }
    const id = taskIdForTitle(title);
    const bucket: TaskBucket = scheduledDate === '2026-08-12' ? 'today' : scheduledDate <= '2026-08-16' ? 'week' : scheduledDate ? 'month' : 'no-due';
    const task: TaskFixture = { id, title, notes, status: 'open', bucket, priority: 0, tags: [], scheduledDate: scheduledDate || undefined, dueDate: dueDate || undefined, createdAt: '2026-08-12T15:48:00-07:00', sourceType: 'manual', createdBy: 'AJ Hochhalter', ownerId: currentUserId, preferredAgent: '', energy: '', collaborators: collaborator ? [collaborator] : [] };
    setTasks((current) => current.some((item) => item.id === id) ? current : [...current, task]);
    appendReceipt(`POST /tasks {title${notes ? ',notes' : ''}${scheduledDate ? ',scheduledDate' : ''}${dueDate ? ',dueDate' : ''},preferredAgent} → 201`);
    if (collaboratorId) appendReceipt(`POST /tasks/${id}/collaborators {userId} → 201`);
    form.reset();
    setCreateOpen(false);
    notify(`${title} added`);
  };

  const saveInspector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTask) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') ?? '').trim();
    if (!title) return;
    const patch = {
      title,
      notes: String(data.get('notes') ?? ''),
      scheduledDate: String(data.get('scheduledDate') ?? '') || undefined,
      dueDate: String(data.get('dueDate') ?? '') || undefined,
      preferredAgent: String(data.get('preferredAgent') ?? '') as TaskFixture['preferredAgent'],
      energy: String(data.get('energy') ?? '') as TaskFixture['energy'],
    };
    if (gateway.mode === 'live') {
      setMutationPending(true);
      try {
        const updated = await gateway.domains.tasks!.update(selectedTask.id, patch);
        setTasks((current) => current.map((task) => task.id === selectedTask.id ? updated : task));
        appendReceipt(`PATCH /tasks/${selectedTask.id} {title,notes,dueDate,scheduledDate,preferredAgent,energy} → 200`);
        notify('Task details saved');
      } catch (error) { recordError('PATCH', `/tasks/${selectedTask.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setTasks((current) => current.map((task) => task.id === selectedTask.id ? { ...task, ...patch } : task));
    appendReceipt(`PATCH /tasks/${selectedTask.id} {title,notes,dueDate,scheduledDate,preferredAgent,energy} → 200`);
    notify('Task details saved');
  };

  const addCollaborator = (personId: string) => {
    if (!selectedTask) return;
    const person = workspaceMembers.find((candidate) => candidate.id === personId);
    if (!person) return;
    setTasks((current) => current.map((task) => task.id === selectedTask.id ? { ...task, collaborators: [...task.collaborators, person] } : task));
    appendReceipt(`POST /tasks/${selectedTask.id}/collaborators {userId} → 201`);
    setCollaboratorPickerOpen(false);
    notify(`${person.name} added`);
  };

  const removeCollaborator = (personId: string) => {
    if (!selectedTask) return;
    setTasks((current) => current.map((task) => task.id === selectedTask.id ? { ...task, collaborators: task.collaborators.filter((person) => person.id !== personId) } : task));
    appendReceipt(`DELETE /tasks/${selectedTask.id}/collaborators/${personId} → 204`);
    appendReceipt(`GET /tasks/${selectedTask.id}/collaborators → 200`);
    notify('Collaborator removed');
  };

  // apps/api_server/src/routes/tasks_routes.ts:15 — POST /tasks/:id/collaborators { userId }
  const addLiveCollaborator = async () => {
    if (!selectedTask || !collaboratorUserId.trim()) return;
    const userId = Number(collaboratorUserId);
    if (!Number.isInteger(userId)) return;
    try {
      const updated = await gateway.domains.tasks!.addCollaborator(selectedTask.id, userId);
      setLiveCollaborators(updated);
      appendReceipt(`POST /tasks/${selectedTask.id}/collaborators {userId} → 201`);
      setCollaboratorUserId('');
      notify('Collaborator added');
    } catch (error) { recordError('POST', `/tasks/${selectedTask.id}/collaborators`, error); }
  };

  // apps/api_server/src/routes/tasks_routes.ts:16 — DELETE /tasks/:id/collaborators/:userId
  const removeLiveCollaborator = async (userId: number) => {
    if (!selectedTask) return;
    try {
      await gateway.domains.tasks!.removeCollaborator(selectedTask.id, userId);
      setLiveCollaborators((current) => current.filter((person) => person.userId !== userId));
      appendReceipt(`DELETE /tasks/${selectedTask.id}/collaborators/${userId} → 204`);
      notify('Collaborator removed');
    } catch (error) { recordError('DELETE', `/tasks/${selectedTask.id}/collaborators/${userId}`, error); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (gateway.mode === 'live') {
      setMutationPending(true);
      try {
        await gateway.domains.tasks!.delete(deleteTarget.id);
        setTasks((current) => current.filter((task) => task.id !== deleteTarget.id));
        appendReceipt(`DELETE /tasks/${deleteTarget.id} → 204`);
        if (selectedId === deleteTarget.id) { setSelectedId(null); writeUrl({ selectedId: null }); }
        notify(`${deleteTarget.title} deleted`); setDeleteTarget(null);
      } catch (error) { recordError('DELETE', `/tasks/${deleteTarget.id}`, error); } finally { setMutationPending(false); }
      return;
    }
    setTasks((current) => current.filter((task) => task.id !== deleteTarget.id));
    appendReceipt(`DELETE /tasks/${deleteTarget.id} → 204`);
    if (selectedId === deleteTarget.id) { setSelectedId(null); writeUrl({ selectedId: null }); }
    notify(`${deleteTarget.title} deleted`);
    setDeleteTarget(null);
  };

  const moveTask = (status: TaskStatus) => {
    if (!draggedId || isReadonly) return;
    const task = tasks.find((item) => item.id === draggedId);
    if (task && task.status !== status) changeStatus(task, status);
    setDraggedId(null);
  };

  // apps/api_server/src/controllers/agent_sessions_controller.ts:636-1017 — POST /agent-sessions;
  // shared with Dashboard/Planner so the Secretary handoff is built once (components/quickActions.ts).
  const launchLiveQuickAction = async (action: QuickActionId) => {
    if (!selectedTask || quickActionPending) return;
    setQuickActionPending(true);
    try {
      const createFollowUpTask = async (): Promise<QuickActionTaskContext> => {
        const created = await gateway.domains.tasks!.create({ title: `Follow-up: ${selectedTask.title}`, notes: '', preferredAgent: '' });
        setTasks((current) => [...current, created]);
        appendReceipt('POST /tasks {title,preferredAgent} → 201');
        return { id: created.id, title: created.title };
      };
      await launchQuickActionSession(gateway.domains.sessions!, action, { id: selectedTask.id, title: selectedTask.title }, action === 'follow-up-tasks' ? createFollowUpTask : undefined);
      appendReceipt('POST /agent-sessions {profileId,mcpRole,cwd,name,taskId} → 201');
      notify('Secretary session created');
      navigate('/agents');
    } catch (error) { recordError('POST', '/agent-sessions', error); } finally { setQuickActionPending(false); }
  };

  const launchQuickAction = (action: QuickActionId) => {
    if (!selectedTask) return;
    if (gateway.mode === 'live') { void launchLiveQuickAction(action); return; }
    if (action === 'follow-up-tasks') {
      const followUp: TaskFixture = { ...selectedTask, id: `task-follow-up-${selectedTask.id.replace(/^task-/, '')}`, title: `Follow-up: ${selectedTask.title}`, status: 'open', bucket: 'no-due', createdAt: '2026-08-12T15:48:00-07:00', collaborators: [] };
      setTasks((current) => current.some((task) => task.id === followUp.id) ? current : [...current, followUp]);
      appendReceipt('POST /tasks {title,preferredAgent} → 201');
    }
    createSession({ name: `${selectedTask.title} · ${quickActions.find((item) => item.id === action)?.label}`, cwd: '/workspace/rhythm', taskId: selectedTask.id });
    const receipt = 'POST /agent-sessions {cwd,name,agentId,mcpRole,taskId} → 201';
    appendReceipt(receipt);
    notify(receipt);
    navigate('/agents');
  };

  const recover = () => {
    if (gateway.mode === 'live') { void loadTasks(); return; }
    setSurfaceState('ready');
    appendReceipt('GET /tasks → 200');
    writeUrl({ state: 'ready' });
    notify('Tasks restored');
  };

  const recoverEmpty = () => {
    setSurfaceState('ready');
    writeUrl({ state: 'ready' });
    setCreateOpen(true);
  };

  const clearSearch = () => {
    setSearch('');
    writeUrl({}, { search: null });
  };

  const clearFilters = () => {
    setSearch('');
    setTag('all');
    setMinimumPriority('0');
    setCompletion('open');
    setDateWindow('all');
    writeUrl({}, { search: null, tag: null, priority: null, completion: null, date: null });
  };

  const renderTaskRow = (task: TaskFixture) => {
    const isOwner = task.isShared === undefined ? task.ownerId === currentUserId : !task.isShared;
    const ownerReason = isOwner ? undefined : ownerOnlyReasonId;
    return <article className="task-row" role="row" aria-selected={selectedId === task.id} data-status={task.status} data-testid={`task-row-${task.id}`} key={task.id}><span className="task-cell complete-cell" role="gridcell"><label className="task-complete-label"><span className="sr-only">{task.status === 'done' ? 'Reopen' : 'Complete'} {task.title}</span><input type="checkbox" checked={task.status === 'done'} disabled={isReadonly || isSourceReadonly(task) || mutationPending} aria-describedby={isReadonly || isSourceReadonly(task) ? readonlyReasonId : undefined} onChange={(event) => { void changeStatus(task, event.target.checked ? 'done' : 'open'); }} data-testid={`task-complete-${task.id}`} /><span aria-hidden="true" /></label></span><span className="task-cell main-cell" role="gridcell"><button className="task-row-main" type="button" onClick={() => openInspector(task)} data-testid={`task-select-${task.id}`}><span className="task-row-copy"><span className="task-kicker">{task.sourceName ?? taskStatusLabels[task.status]}</span><h3 data-testid="task-title">{task.title}</h3><span className="task-meta">{dateLabel(task)}{task.priority ? ` · P${task.priority}` : ''}</span></span><span className="task-tags" aria-label={task.tags.length ? `Tags: ${task.tags.join(', ')}` : 'No tags'}>{task.tags.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</span></button></span><span className="task-cell inspect-cell" role="gridcell"><button className="icon-button task-inspect-button" type="button" aria-label={`Inspect ${task.title}`} onClick={() => openInspector(task)} data-testid={`task-inspect-${task.id}`}><Icon name="chevronRight" size={15} /></button></span><span className="task-cell menu-cell" role="gridcell"><TaskMenu task={task} ownerOnlyReasonId={ownerReason ?? ownerOnlyReasonId} readonlyReasonId={readonlyReasonId} readonly={isReadonly || isSourceReadonly(task) || mutationPending} isOwner={isOwner} onInspect={() => openInspector(task)} onDelete={() => setDeleteTarget(task)} /></span></article>;
  };

  const collaboratorCandidates = selectedTask ? workspaceMembers.filter((person) => person.id !== selectedTask.ownerId && !selectedTask.collaborators.some((existing) => existing.id === person.id)) : [];
  const selectedIsOwner = selectedTask?.isShared === undefined ? selectedTask?.ownerId === currentUserId : !selectedTask.isShared;
  const selectedReadonly = Boolean(selectedTask && (isReadonly || isSourceReadonly(selectedTask) || mutationPending));

  return <section className="page-shell pg-tasks" data-od-id="tasks-page" data-testid="page-tasks" aria-labelledby="tasks-title" aria-busy={surfaceState === 'loading'}>
    <header className="tasks-header" data-od-id="tasks-header">
      <div className="tasks-heading"><span className="eyebrow">Planning queue</span><h1 id="tasks-title" data-od-id="tasks-title">Tasks</h1><p>Shape the next useful handoff without losing the wider rhythm.</p></div>
      <div className="tasks-header-actions"><span className="tasks-count" data-testid="tasks-visible-count">{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}</span><HeaderTaskAction onClick={() => setCreateOpen(true)} disabled={!showsWorkspace || isReadonly || mutationPending} describedBy={isReadonly ? readonlyReasonId : undefined} testId="tasks-header-add-task" /><div className="tasks-view-switch" aria-label="Task presentation"><button type="button" aria-pressed={view === 'list'} onClick={() => { setView('list'); writeUrl({ view: 'list' }); }} data-testid="tasks-view-list">List</button><button type="button" aria-pressed={view === 'board'} onClick={() => { setView('board'); writeUrl({ view: 'board' }); }} data-testid="tasks-view-board">Board</button></div></div>
    </header>

    <div className="tasks-scroll" role="region" aria-label="Tasks workspace content" tabIndex={0}>
      {!showsWorkspace && <StatePanel state={surfaceState as Exclude<TasksSurfaceState, 'ready' | 'readonly' | 'forbidden'>} onRetry={recover} onEmpty={recoverEmpty} />}
      {showsWorkspace && <>
        {surfaceState === 'readonly' && <div className="tasks-prerequisite readonly" id={readonlyReasonId} role="status" data-testid="page-state-readonly"><strong>Read-only source of truth</strong><span>Inspect the queue here; make changes in its synchronized source of truth.</span></div>}
        {surfaceState === 'forbidden' && <div className="tasks-prerequisite forbidden" id={ownerOnlyReasonId} role="alert" data-testid="page-state-forbidden"><strong>Task owner required</strong><span>Only the task owner can add or remove collaborators or delete a task. Collaborators may still edit and complete shared work.</span></div>}
        {surfaceState !== 'forbidden' && <p className="tasks-owner-note" id={ownerOnlyReasonId}><strong>Shared-task permissions</strong> Collaborators may edit and complete; only the task owner can add or remove collaborators or delete.</p>}

        <div className="tasks-workspace-layout" data-od-id="tasks-workspace-layout">
          <div className="tasks-collection">
            <section className="tasks-workspace" aria-labelledby="tasks-workspace-title" data-od-id="task-queue">
              <div className="tasks-controls"><div><span className="eyebrow">Organize</span><h2 id="tasks-workspace-title">{view === 'list' ? 'Task list' : 'Task board'}</h2></div><div className="tasks-filter-grid"><div className="search-field"><Icon name="search" size={14} /><label className="sr-only" htmlFor="tasks-search-input">Search tasks</label><input id="tasks-search-input" value={search} onChange={(event) => { setSearch(event.target.value); writeUrl({}, { search: event.target.value }); }} placeholder="Search tasks" data-testid="tasks-search" />{search && <button className="tasks-search-clear" type="button" aria-label="Clear task search" onClick={clearSearch} data-testid="tasks-clear-search"><Icon name="close" size={13} /></button>}</div><label><span>Tag</span><select value={tag} onChange={(event) => setQueryValue('tag', event.target.value, setTag as (value: never) => void)} data-testid="tasks-tag-filter"><option value="all">All tags</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Priority</span><select value={minimumPriority} onChange={(event) => setQueryValue('priority', event.target.value, setMinimumPriority as (value: never) => void)} data-testid="tasks-priority-filter"><option value="0">Any priority</option><option value="1">P1+</option><option value="2">P2+</option><option value="3">P3+</option></select></label><label><span>Open / All</span><select value={completion} onChange={(event) => setQueryValue('completion', event.target.value, setCompletion as (value: never) => void)} data-testid="tasks-completion-filter"><option value="open">Open</option><option value="all">All</option></select></label><label><span>Date window</span><select value={dateWindow} onChange={(event) => setQueryValue('date', event.target.value, setDateWindow as (value: never) => void)} data-testid="tasks-date-filter"><option value="all">All</option><option value="today">Today</option><option value="week">This Week</option><option value="month">This Month</option></select></label>{view === 'list' && <label><span>Sort</span><select value={sort} onChange={(event) => setQueryValue('sort', event.target.value, setSort as (value: never) => void)} data-testid="tasks-sort"><option value="due">Due date</option><option value="created">Created date</option><option value="status">Status</option><option value="title">Title</option></select></label>}</div></div>

              <div className="tasks-legend" aria-label="Task date and source legend"><span><i className="past" />Past due</span><span><i className="today" />Today</span><span><i className="rhythm" />Rhythm</span><span><i className="project" />Project</span><span><i className="automation" />Automation</span></div>

              {visibleTasks.length === 0 ? <section className="tasks-no-results" data-testid="tasks-no-results"><span className="tasks-state-mark" aria-hidden="true">⌕</span><h2>{search ? 'No matching tasks' : 'Nothing to show'}</h2><p>{search ? 'Clear the search to restore the queue.' : 'Clear an active filter to see the full task list.'}</p><button className="secondary-button" type="button" onClick={clearFilters} data-testid="tasks-clear-filters">Clear filters</button></section> : view === 'list' ? <div className="tasks-list" data-testid="tasks-list">{groupedTasks.map((group) => <section className="task-group" aria-labelledby={`task-group-title-${group.bucket}`} data-testid={`task-group-${group.bucket}`} key={group.bucket}><header><h2 id={`task-group-title-${group.bucket}`}>{taskBucketLabels[group.bucket]}</h2><span>{group.tasks.length}</span></header><div role="grid" aria-label={`${taskBucketLabels[group.bucket]} tasks`}>{group.tasks.map(renderTaskRow)}</div></section>)}</div> : <div className="kanban-board" role="region" tabIndex={0} data-testid="tasks-board" aria-label="Task status board">{boardStatuses.map((status) => { const columnTasks = visibleTasks.filter((task) => task.status === status); return <section className="kanban-column" onDragOver={(event) => event.preventDefault()} onDrop={() => moveTask(status)} aria-labelledby={`kanban-title-${status}`} data-testid={`kanban-column-${status.replaceAll('_', '-')}`} key={status}><header><h2 id={`kanban-title-${status}`}>{taskStatusLabels[status]}</h2><span>{columnTasks.length}</span></header><div className="kanban-stack" role="listbox" aria-label={`${taskStatusLabels[status]} tasks`}>{columnTasks.length ? columnTasks.map((task) => <article className="task-card" role="option" tabIndex={0} draggable={!isReadonly && !isSourceReadonly(task)} aria-selected={selectedId === task.id} aria-label={`Inspect ${task.title}`} onDragStart={() => setDraggedId(task.id)} onClick={() => openInspector(task)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openInspector(task); } }} data-testid={`task-card-${task.id}`} key={task.id}><span className="task-kicker">{taskStatusLabels[task.status]}</span><h3>{task.title}</h3><p>{dateLabel(task)}{task.preferredAgent ? ` · ${task.preferredAgent}` : ''}</p><div className="task-card-tags">{task.priority ? <span>P{task.priority}</span> : null}{task.tags.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div></article>) : <p className="kanban-empty">No tasks in this stage.</p>}</div></section>; })}</div>}
            </section>
          </div>

          <aside className="task-detail-column" aria-label="Selected task" data-od-id="task-inspector" data-testid="task-inspector">
            {selectedTask ? <section className="task-detail" aria-labelledby="task-detail-title">
              <header><div><span className="task-detail-state">{taskStatusLabels[selectedTask.status]}</span><h2 id="task-detail-title">{selectedTask.title}</h2><p>{selectedTask.priority ? `P${selectedTask.priority} · ` : ''}<span role="textbox" aria-label="Source" aria-readonly="true" data-testid="task-source">{selectedTask.sourceName ?? 'Rhythm task'}</span> · {dateLabel(selectedTask)}</p></div><button className="text-button" type="button" onClick={closeInspector} data-testid="task-detail-close">Close</button></header>
              {selectedReadonly && <div className="inspector-prerequisite" role="status"><strong>Synchronized source of truth</strong><span>This task is inspect-only here.</span></div>}
              <form className="task-inspector-form" key={selectedTask.id} onSubmit={saveInspector}>
                <div className="task-source-grid"><div><span>Created by</span><strong role="textbox" aria-label="Created by" aria-readonly="true" data-testid="task-created-by">{selectedTask.createdBy}</strong></div><div><span>Status</span><strong>{taskStatusLabels[selectedTask.status]}</strong></div></div>
                <fieldset disabled={selectedReadonly}><legend className="sr-only">Task details</legend><label>Title<input name="title" required defaultValue={selectedTask.title} data-testid="task-edit-title" /></label><label>Notes<textarea name="notes" rows={4} defaultValue={selectedTask.notes} data-testid="task-edit-notes" /></label><div className="inspector-pair"><label>Scheduled date<input name="scheduledDate" type="date" defaultValue={selectedTask.scheduledDate ?? ''} data-testid="task-edit-scheduled-date" /></label><label>Due date<input name="dueDate" type="date" defaultValue={selectedTask.dueDate ?? ''} data-testid="task-edit-due-date" /></label></div><div className="inspector-pair"><label>Default agent<select name="preferredAgent" defaultValue={selectedTask.preferredAgent} data-testid="task-edit-agent"><option value="">None</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option></select></label><label>Energy<select name="energy" defaultValue={selectedTask.energy} data-testid="task-edit-energy"><option value="">None</option><option value="🔥">🔥 Fire</option><option value="⚡">⚡ Electric</option><option value="🌱">🌱 Grounded</option></select></label></div><footer className="task-detail-form-actions"><button className="secondary-button" type="button" onClick={() => changeStatus(selectedTask, selectedTask.status === 'done' ? 'open' : 'done')} data-testid="task-detail-complete">{selectedTask.status === 'done' ? 'Reopen' : 'Complete'}</button><button className="primary-button" type="submit" data-testid="task-save">Save changes</button></footer></fieldset>
              </form>
              <section className="task-people" aria-labelledby="task-people-title">
                <div className="inspector-section-heading"><div><h3 id="task-people-title">People</h3><p>Collaborators on this task.</p></div>{gateway.mode !== 'live' && <button className="secondary-button" type="button" disabled={!selectedIsOwner || selectedReadonly} aria-describedby={!selectedIsOwner ? ownerOnlyReasonId : selectedReadonly ? readonlyReasonId : undefined} title={!selectedIsOwner ? 'Only the task owner can add or remove collaborators' : undefined} onClick={() => setCollaboratorPickerOpen(true)} data-testid="task-add-collaborator"><Icon name="plus" size={14} />Add</button>}</div>
                {gateway.mode === 'live'
                  ? <div className="collaborator-list">{liveCollaborators.length ? liveCollaborators.map((person) => <div className="collaborator-chip" data-testid={`task-collaborator-${person.userId}`} key={person.userId}><strong>{person.name}</strong><button className="icon-button" type="button" disabled={!selectedIsOwner || selectedReadonly} aria-label={`Remove ${person.name}`} aria-describedby={!selectedIsOwner ? ownerOnlyReasonId : selectedReadonly ? readonlyReasonId : undefined} onClick={() => void removeLiveCollaborator(person.userId)} data-testid={`task-remove-collaborator-${person.userId}`}><Icon name="close" size={13} /></button></div>) : <p>No collaborators yet.</p>}<div className="inspector-pair"><input type="number" placeholder="User id" value={collaboratorUserId} disabled={!selectedIsOwner || selectedReadonly} onChange={(event) => setCollaboratorUserId(event.target.value)} data-testid="task-collaborator-input" /><button className="secondary-button" type="button" disabled={!selectedIsOwner || selectedReadonly} onClick={() => void addLiveCollaborator()} data-testid="task-add-collaborator">Add</button></div></div>
                  : <div className="collaborator-list">{selectedTask.collaborators.length ? selectedTask.collaborators.map((person) => <div className="collaborator-chip" data-testid={`task-collaborator-${person.id}`} key={person.id}><span aria-hidden="true">{person.initials}</span><strong>{person.name}</strong><button className="icon-button" type="button" disabled={!selectedIsOwner || selectedReadonly} aria-label={`Remove ${person.name}`} aria-describedby={!selectedIsOwner ? ownerOnlyReasonId : selectedReadonly ? readonlyReasonId : undefined} onClick={() => removeCollaborator(person.id)} data-testid={`task-remove-collaborator-${person.id}`}><Icon name="close" size={13} /></button></div>) : <p>No collaborators yet.</p>}</div>}
              </section>
              {!selectedReadonly && <section className="task-quick-actions" aria-labelledby="task-quick-title"><h3 id="task-quick-title">Quick actions</h3><div>{quickActions.map((action) => <button className="task-action-chip" type="button" disabled={quickActionPending} onClick={() => launchQuickAction(action.id)} data-testid={`quick-action-${action.id}`} key={action.id}>{action.label}</button>)}</div></section>}
            </section> : <section className="task-detail-empty" aria-labelledby="task-detail-empty-title"><h2 id="task-detail-empty-title">Select a task</h2><p>Open a task to review its context, people, and next actions without leaving the queue.</p></section>}
          </aside>
        </div>
      </>}
    </div>

    <aside className="page-trace" aria-label="Tasks endpoint receipts" tabIndex={0} data-testid="page-trace"><span>Endpoint ledger</span><ol>{receipts.map((receipt, index) => <li key={`${receipt}-${index}`}>{receipt}</li>)}</ol></aside>

    <FocusDialog open={createOpen} onClose={() => setCreateOpen(false)} title="Add task" description="Set the task details now. More people and agent handoffs are available after creation." testId="task-create-dialog"><TaskCreateForm idPrefix="tasks-create" onSubmit={createTask} onCancel={() => setCreateOpen(false)} members={workspaceMembers.filter((person) => person.id !== currentUserId)} titleRef={createTitleRef} disabled={isReadonly || mutationPending} describedBy={isReadonly ? readonlyReasonId : undefined} testIds={{ title: 'task-create-title', notes: 'task-create-notes', scheduledDate: 'task-create-scheduled-date', dueDate: 'task-create-due-date', collaborator: 'task-create-collaborator', cancel: 'task-create-cancel', submit: 'task-create-submit', mutations: 'tasks-mutations' }} /></FocusDialog>

    <FocusDialog open={collaboratorPickerOpen} onClose={() => setCollaboratorPickerOpen(false)} title="Add collaborator" description="Only workspace members who are not the owner or already collaborating are shown." testId="task-collaborator-picker"><div className="collaborator-options" role="listbox" aria-label="Available collaborators">{collaboratorCandidates.length ? collaboratorCandidates.map((person) => <button className="secondary-button" role="option" aria-selected="false" type="button" onClick={() => addCollaborator(person.id)} data-testid={`task-collaborator-option-${person.id}`} key={person.id}><span>{person.initials}</span><strong>{person.name}</strong></button>) : <p>No eligible collaborators remain.</p>}</div></FocusDialog>

    <FocusDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={deleteTarget ? `Delete “${deleteTarget.title}”?` : 'Delete task?'} description="This cannot be undone." testId="task-delete-dialog"><p className="delete-copy">The task and its collaborator links will be removed.</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)} data-testid="task-delete-cancel">Cancel</button><button className="danger-button" type="button" disabled={mutationPending} onClick={confirmDelete} data-testid="task-delete-confirm">Delete task</button></div></FocusDialog>
  </section>;
}
