import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { useGateway } from '../gateway/context';
import { useAuthUser } from '../gateway/auth';
import { compareSessions, SessionGatewayError, type AgentProject, type ProjectBranches, type SessionCatalogEntry, type SessionSort, type TranscriptPageInfo } from '../gateway/sessions';
import { readLocalUserPreferences, writeLocalUserPreferences } from '../gateway/user-preferences';
import { isSessionRecoverable, sessionPresentation } from '../sessionState';
import { useFixtures } from '../store';
import type { Session, SessionScope } from '../types';
import { FocusDialog } from './FocusDialog';
import { navigate } from './Shell';
import { Splitter } from './Splitter';
import { usePendingSessionIds } from '../pending-decisions';
import './SessionRail.css';

const tools: { key: string; label: string; description: string; icon: IconName }[] = [
  { key: 'brain', label: 'Brain', description: 'Workspace memory', icon: 'brain' },
  { key: 'deep-research', label: 'Deep Research', description: 'Research runs', icon: 'search' },
  { key: 'tasks', label: 'Tasks', description: 'Agent-linked work', icon: 'todo' },
  { key: 'webhooks', label: 'Webhooks', description: 'Delivery signals', icon: 'webhook' },
  { key: 'profiles', label: 'Profiles', description: 'Identity and policy', icon: 'profile' },
  { key: 'skills', label: 'Skills', description: 'Agent capabilities', icon: 'spark' },
  { key: 'playbooks', label: 'Playbooks', description: 'Slash commands', icon: 'playbook' },
  { key: 'cookbook', label: 'Cookbook', description: 'Reusable recipes', icon: 'book' },
  { key: 'review', label: 'Review Queue', description: 'Pending review', icon: 'review' },
  { key: 'report-card', label: 'Report Card', description: 'Run quality', icon: 'report' },
  { key: 'email', label: 'Email', description: 'Agent signals', icon: 'mail' },
  { key: 'gallery', label: 'Gallery', description: 'Artifacts', icon: 'gallery' },
];
const accounts = ['Rhythm workspace', 'Research account'];
export function SessionRail({ collapsed, onToggle, selectedProject, onSelectProject }: { collapsed: boolean; onToggle(): void; selectedProject: AgentProject | null; onSelectProject(project: AgentProject | null): void }) {
  const fixtures = useFixtures();
  const gateway = useGateway();
  const auth = useAuthUser();
  const preferenceUserId = auth?.user.id ?? 'fixture';
  const initialViewPreferences = readLocalUserPreferences(preferenceUserId);
  const pendingSessions = usePendingSessionIds();
  const { sessions, profiles, selected, selectedId, scope, setScope, selectSession, createSession, archiveSession, unarchiveSession, deleteSession, resumeSession, cancelSession, notify, sessionGatewayMode, createLiveSession, deleteLiveSession, selectLiveSession } = fixtures;
  const eligibleProfiles = profiles.filter(profile => profile.enabled && profile.selectable && (sessionGatewayMode !== 'live' || !profile.id.startsWith('profile-created-')));
  const defaultProfileId = eligibleProfiles.find(profile => profile.isDefault)?.id ?? eligibleProfiles[0]?.id ?? '';
  const [liveTasks, setLiveTasks] = useState<{ id: string; title: string }[]>([]);
  const [tasksError, setTasksError] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const [sort, setSort] = useState<SessionSort>(initialViewPreferences.sessionSort);
  const [archivedOnly, setArchivedOnly] = useState(initialViewPreferences.archivedOnly);
  const [compact, setCompact] = useState(initialViewPreferences.compact);
  useEffect(() => {
    const preferences = readLocalUserPreferences(preferenceUserId);
    setSort(preferences.sessionSort);
    setArchivedOnly(preferences.archivedOnly);
    setCompact(preferences.compact);
  }, [preferenceUserId]);
  const saveViewPreference = (patch: Parameters<typeof writeLocalUserPreferences>[1], apply: () => void) => {
    try {
      writeLocalUserPreferences(preferenceUserId, patch);
      apply();
    } catch {
      notify('View preference could not be saved. Allow device storage and retry.');
    }
  };
  const setSortPreference = (value: SessionSort) => {
    saveViewPreference({ sessionSort: value }, () => setSort(value));
  };
  const setArchivedOnlyPreference = (value: boolean) => {
    saveViewPreference({ archivedOnly: value }, () => setArchivedOnly(value));
  };
  const setCompactPreference = (value: boolean) => {
    saveViewPreference({ compact: value }, () => setCompact(value));
  };
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const viewOptionsRef = useRef<HTMLDivElement>(null);
  const viewOptionsTriggerRef = useRef<HTMLButtonElement>(null);
  const viewOptionsLastItem = useRef(false);
  const closeViewOptions = () => {
    setViewOptionsOpen(false);
    viewOptionsTriggerRef.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!viewOptionsOpen) return;
    const menu = viewOptionsRef.current?.querySelector<HTMLElement>('[role="menu"]');
    const rail = viewOptionsRef.current?.closest('aside');
    const fitMenu = () => {
      if (!menu || !rail) return;
      const bounds = menu.getBoundingClientRect();
      const scale = menu.offsetWidth ? bounds.width / menu.offsetWidth : 1;
      menu.style.maxHeight = `${Math.max(44, (Math.min(window.innerHeight, rail.getBoundingClientRect().bottom) - bounds.top - 8) / scale)}px`;
    };
    fitMenu();
    const resize = new ResizeObserver(fitMenu);
    if (rail) resize.observe(rail);
    const items = viewOptionsRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    items?.[viewOptionsLastItem.current ? items.length - 1 : 0]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!viewOptionsRef.current?.contains(event.target as Node)) setViewOptionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', fitMenu);
    return () => { resize.disconnect(); document.removeEventListener('pointerdown', closeOutside); window.removeEventListener('resize', fitMenu); };
  }, [viewOptionsOpen]);
  const moveViewOptionsFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeViewOptions(); return; }
    if (event.key === 'Tab') { closeViewOptions(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  const [refresh, setRefresh] = useState(0);
  const normalizedSearch = search.trim();
  const historyIdentity = useMemo(() => ({ gateway, scope, search: normalizedSearch, archivedOnly, refresh }), [gateway, scope, normalizedSearch, archivedOnly, refresh]);
  const currentHistory = useRef(historyIdentity);
  currentHistory.current = historyIdentity;
  const historyRequests = useRef({ identity: historyIdentity, keys: new Set<string>() });
  const sessionListRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestore = useRef<{ top: number; focusParent?: string } | null>(null);
  const [history, setHistory] = useState<{
    identity: typeof historyIdentity; rows: SessionCatalogEntry[];
    pages: Record<string, TranscriptPageInfo>; busy: boolean; error: string;
    children: Record<string, { busy: boolean; error: string; resetCursor?: boolean }>;
  } | null>(null);
  const [projectLabels, setProjectLabels] = useState<{ gateway: typeof gateway; rows: AgentProject[] } | null>(null);
  const [projectRefresh, setProjectRefresh] = useState(0);
  const [projectsError, setProjectsError] = useState('');
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectCwd, setProjectCwd] = useState('');
  const [projectError, setProjectError] = useState('');
  const [projectSaving, setProjectSaving] = useState(false);
  const [folderPicking, setFolderPicking] = useState(false);
  const projectSaveInFlight = useRef(false);
  const projectFormGeneration = useRef(0);
  const currentGateway = useRef(gateway);
  currentGateway.current = gateway;
  const liveHistory = sessionGatewayMode === 'live';
  const currentPage = history?.identity === historyIdentity ? history : null;
  const loadHistory = async (parentId?: string, cursor?: string) => {
    const identity = historyIdentity;
    if (!gateway.domains.sessions?.listPage) return;
    if (historyRequests.current.identity !== identity) historyRequests.current = { identity, keys: new Set() };
    const requests = historyRequests.current.keys;
    const key = parentId ?? '';
    if (requests.has(key)) return;
    requests.add(key);
    setHistory((value) => {
      const previous = value?.identity === identity ? value : { identity, rows: [], pages: {}, children: {}, busy: false, error: '' };
      return parentId ? { ...previous, children: { ...previous.children, [parentId]: { busy: true, error: '' } } } : { ...previous, busy: true, error: '' };
    });
    try {
      const result = await gateway.domains.sessions.listPage({ scope, search: normalizedSearch, archivedOnly, parentId, cursor });
      if (currentHistory.current !== identity) return;
      if (parentId && sessionListRef.current) {
        pendingScrollRestore.current = {
          top: sessionListRef.current.scrollTop,
          focusParent: !result.pageInfo.hasMore && document.activeElement?.getAttribute('data-load-parent') === parentId ? parentId : undefined,
        };
      }
      setHistory((value) => {
        const previous = value?.identity === identity ? value : null;
        const rows = new Map((previous?.rows ?? []).map((row) => [row.id, row]));
        for (const row of [...result.ancestors, ...result.sessions]) rows.set(row.id, row);
        return { identity, rows: [...rows.values()], pages: { ...previous?.pages, [key]: result.pageInfo },
          busy: parentId ? previous?.busy ?? false : false, error: parentId ? previous?.error ?? '' : '',
          children: { ...previous?.children, ...(parentId ? { [parentId]: { busy: false, error: '' } } : {}) } };
      });
    } catch (error) {
      if (currentHistory.current !== identity) return;
      const expired = error instanceof SessionGatewayError && error.status === 400;
      setHistory((value) => value?.identity !== identity ? value : parentId
        ? { ...value, children: { ...value.children, [parentId]: { busy: false, error: expired ? 'Subagent history expired.' : 'Could not load subagents.', resetCursor: expired } } }
        : { ...value, busy: false, error: expired ? 'Session history cursor expired. Reset session history to continue.' : 'Session history unavailable. Reset session history to retry.' });
    } finally {
      requests.delete(key);
    }
  };
  useLayoutEffect(() => {
    const restore = pendingScrollRestore.current;
    pendingScrollRestore.current = null;
    if (!restore || !sessionListRef.current) return;
    if (restore.focusParent) document.getElementById(`subagents-toggle-${restore.focusParent}`)?.focus({ preventScroll: true });
    sessionListRef.current.scrollTop = restore.top;
  }, [currentPage]);
  useEffect(() => {
    if (!liveHistory) return;
    setHistory(null);
    void loadHistory();
    // Scope/filter/refresh creates a fresh snapshot. Never automatically drain a cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIdentity, liveHistory]);
  useEffect(() => {
    if (!liveHistory || !gateway.domains.sessions?.projectLabels) return;
    let active = true;
    setProjectsError('');
    void gateway.domains.sessions.projectLabels().then((rows) => { if (active) setProjectLabels({ gateway, rows }); }).catch(() => { if (active) setProjectsError('Projects could not be loaded.'); });
    return () => { active = false; };
  }, [gateway, liveHistory, projectRefresh]);
  useEffect(() => {
    projectFormGeneration.current += 1;
    setProjectFormOpen(false);
    onSelectProject(null);
    // Project selection belongs to this gateway/account, never the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);
  const openProjectForm = () => {
    projectFormGeneration.current += 1;
    setProjectName(''); setProjectCwd(''); setProjectError(''); setFolderPicking(false); setProjectFormOpen(true);
  };
  const closeProjectForm = () => {
    if (projectSaveInFlight.current) return;
    projectFormGeneration.current += 1;
    setProjectFormOpen(false);
  };
  // Optional until the native picker bridge lands; manual entry is always available.
  const projectShell = (window as Window & { rhythmShell?: { selectDirectory?: () => Promise<string | null> } }).rhythmShell;
  const chooseProjectFolder = async () => {
    if (!projectShell?.selectDirectory || folderPicking) return;
    const generation = projectFormGeneration.current;
    setFolderPicking(true); setProjectError('');
    try {
      const path = await projectShell.selectDirectory();
      if (generation === projectFormGeneration.current && path !== null) setProjectCwd(path);
    } catch {
      if (generation === projectFormGeneration.current) setProjectError('The folder picker could not open. Enter the working directory below.');
    } finally {
      if (generation === projectFormGeneration.current) setFolderPicking(false);
    }
  };
  const addProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (projectSaveInFlight.current || folderPicking) return;
    const name = projectName.trim(); const cwd = projectCwd.trim();
    if (!name || !cwd) { setProjectError('Enter a project name and working directory.'); return; }
    if (!(cwd.startsWith('/') || cwd === '~' || cwd.startsWith('~/')) || cwd.includes('\0')) {
      setProjectError('Enter an absolute directory path, such as /Users/you/project or ~/project.'); return;
    }
    if (!gateway.domains.sessions?.createProject) { setProjectError('Project creation is unavailable in this workspace. Connect to the agent service and try again.'); return; }
    const generation = projectFormGeneration.current;
    projectSaveInFlight.current = true;
    setProjectSaving(true); setProjectError('');
    try {
      const project = await gateway.domains.sessions.createProject({ name, cwd });
      if (currentGateway.current !== gateway || generation !== projectFormGeneration.current) return;
      // Keep the successful response visible even if the subsequent catalog refresh fails.
      setProjectLabels((value) => ({ gateway, rows: [...(value?.gateway === gateway ? value.rows.filter((row) => row.id !== project.id) : []), project] }));
      setProjectRefresh((value) => value + 1);
      setCollapsedProjects((value) => { const next = new Set(value); next.delete(project.id); return next; });
      setSearch(''); setArchivedOnlyPreference(false); setScope('chats'); setSelectedRows([]);
      onSelectProject(project);
      setProjectFormOpen(false);
      notify(`Project ${project.name} created`);
    } catch (error) {
      if (currentGateway.current !== gateway || generation !== projectFormGeneration.current) return;
      setProjectError(error instanceof SessionGatewayError && error.status === 400 ? error.message.replace(/\bcwd\b/g, 'Working directory') : 'Project could not be saved. Check the connection and try again.');
    } finally {
      projectSaveInFlight.current = false;
      setProjectSaving(false);
    }
  };
  // Keep live status/creation/deletion changes without re-fetching on every streamed token.
  const previousSessions = useRef(sessions);
  useEffect(() => {
    const before = new Map(previousSessions.current.map((row) => [row.id, row]));
    previousSessions.current = sessions;
    if (!liveHistory) return;
    const now = new Map(sessions.map((row) => [row.id, row]));
    setHistory((value) => {
      if (!value || value.identity !== historyIdentity) return value;
      const rows = new Map(value.rows.filter((row) => !before.has(row.id) || now.has(row.id)).map((row) => [row.id, row]));
      for (const row of sessions) {
        if (!before.has(row.id) || before.get(row.id) === row) continue;
        const catalogRow = rows.get(row.id);
        if (catalogRow) rows.set(row.id, { ...catalogRow, ...row });
      }
      // A newly created/selected row is already readable through the real detail surface.
      for (const row of sessions) if (!before.has(row.id)) rows.set(row.id, row);
      return { ...value, rows: [...rows.values()] };
    });
  }, [sessions, liveHistory, historyIdentity]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [toolsHeight, setToolsHeight] = useState(224);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => new Set());

  const [name, setName] = useState('');
  const [taskId, setTaskId] = useState('');
  const [cwd, setCwd] = useState(selected.cwd);
  const [isolateWorktree, setIsolateWorktree] = useState(false);
  const [worktreeName, setWorktreeName] = useState('');
  const [branch, setBranch] = useState(selected.branch);
  const [newBranchMode, setNewBranchMode] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [stashConfirmed, setStashConfirmed] = useState(false);
  const [account, setAccount] = useState('');
  const [profileId, setProfileId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ status: number; message: string } | null>(null);
  // post-m1-phase-6 c3a: real project branches — apps/api_server/src/controllers/projects_controller.ts:161-175
  // (GET /projects/:id/branches → {current, local, recent}). Never a fixture branch literal.
  const [liveBranches, setLiveBranches] = useState<ProjectBranches | null>(null);

  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    if (!rowMenuId) return;
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(`[data-session-menu="${rowMenuId}"]`)) setRowMenuId(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setRowMenuId(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [rowMenuId]);

  const resetAdvanced = () => {
    setName(''); setTaskId(''); setCwd(selectedProject?.cwd ?? selected.cwd); setIsolateWorktree(false); setWorktreeName('');
    setBranch(selectedProject ? selectedProject.vcsBranch ?? '' : selected.branch); setNewBranchMode(false); setNewBranch(''); setPendingBranch(null); setStashConfirmed(false);
    setAccount(''); setProfileId(defaultProfileId); setSubmitting(false); setSubmitError(null);
  };
  const openAdvanced = () => { resetAdvanced(); setLiveBranches(null); setAdvancedOpen(true); };
  const closeAdvanced = () => { if (!submitting) setAdvancedOpen(false); };
  // c3a: fetch the real project branch list once the dialog opens in live mode — never the
  // fixture's hardcoded 'release/desktop'/'main' literals.
  useEffect(() => {
    if (!advancedOpen || sessionGatewayMode !== 'live') return;
    let active = true;
    setLiveTasks([]); setTasksError('');
    void gateway.domains.tasks!.list().then(rows => { if (active) setLiveTasks(rows.filter(task => task.status !== 'done')); }).catch(() => { if (active) setTasksError('Task catalog unavailable'); });
    void gateway.domains.sessions!.branches(selectedProject?.id ?? selected.projectId)
      .then((data) => { if (active) setLiveBranches(data); })
      .catch(() => { if (active) setLiveBranches(null); });
    return () => { active = false; };
  }, [advancedOpen, sessionGatewayMode, selected.projectId, selectedProject?.id, gateway]);
  const startSession = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true); setSubmitError(null);
    try {
      if (sessionGatewayMode === 'live') {
        await createLiveSession({
          name: name.trim(), cwd, profileId, ...(selectedProject && cwd === selectedProject.cwd ? { projectId: selectedProject.id } : {}), taskId: taskId || undefined, anthropicAccountId: account || undefined, isolateWorktree, worktreeName: isolateWorktree ? worktreeName || undefined : undefined,
          branch: newBranchMode ? newBranch : branch || undefined, createBranch: newBranchMode, stash: stashConfirmed ? 'stash' : undefined,
        });
      } else {
        await Promise.resolve();
        if (cwd.includes('forbidden')) { setSubmitError({ status: 422, message: 'That working directory is not available. Choose another folder and try again.' }); return; }
        if (cwd.includes('server-error')) { setSubmitError({ status: 503, message: 'Fixture server could not create the worktree. Request id: fixture-create-503.' }); return; }
        createSession({ name: name.trim(), taskId, cwd, branch: newBranchMode ? newBranch : branch, createBranch: newBranchMode, stash: stashConfirmed, isolateWorktree, worktreeName, anthropicAccountId: account });
      }
      onSelectProject(null);
      setAdvancedOpen(false);
    } catch (error) {
      setSubmitError(error instanceof SessionGatewayError
        ? { status: error.status, message: error.message }
        : { status: 0, message: 'Session service unavailable' });
    } finally {
      setSubmitting(false);
    }
  };
  const selectBranch = (next: string) => {
    if (next === '__new__') { setNewBranchMode(true); setNewBranch(''); return; }
    if (!selectedProject && next !== selected.branch && selected.dirtyCount > 0) { setPendingBranch(next); return; }
    setBranch(next); setNewBranchMode(false);
  };
  const changeScope = (next: SessionScope) => { setScope(next); setSearch(''); setSelectedRows([]); };
  const moveScope = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const values: SessionScope[] = ['chats', 'scheduled', 'background'];
    const next = event.key === 'Home' ? values[0] : event.key === 'End' ? values[2] : values[(values.indexOf(scope) + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length];
    changeScope(next); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="scope-${next}"]`)?.focus());
  };
  const catalog: SessionCatalogEntry[] = liveHistory ? currentPage?.rows ?? [] : sessions;
  const projectCatalog = projectLabels?.gateway === gateway ? projectLabels.rows : [];
  const projects = new Map(projectCatalog.map((item) => [item.id, item.name]));
  for (const session of catalog) if (session.projectId && !projects.has(session.projectId)) projects.set(session.projectId, session.projectName || `Unknown project (${session.projectId})`);
  const projectNameCounts = new Map<string, number>();
  for (const name of projects.values()) projectNameCounts.set(name, (projectNameCounts.get(name) ?? 0) + 1);
  const sessionsById = new Map(catalog.map((session) => [session.id, session]));
  const eligible = catalog.filter((session) => session.scope === scope && (!liveHistory && !archivedOnly || (session.group === 'archived') === archivedOnly));
  const eligibleById = new Map(eligible.map((session) => [session.id, session]));
  const included = new Set<string>();
  for (const session of eligible) {
    if (normalizedSearch && !`${session.name} ${session.lastPreview ?? ''}`.toLowerCase().includes(normalizedSearch.toLowerCase())) continue;
    let current: SessionCatalogEntry | undefined = session;
    while (current && !included.has(current.id)) { included.add(current.id); current = current.parentId ? eligibleById.get(current.parentId) : undefined; }
  }
  const visible: SessionCatalogEntry[] = [];
  const childrenByParent = new Map<string, SessionCatalogEntry[]>();
  for (const session of eligible) {
    if (!included.has(session.id)) continue;
    if (!session.parentId || !included.has(session.parentId) || (eligibleById.get(session.parentId)?.projectId || '') !== (session.projectId || '')) visible.push(session);
    else childrenByParent.set(session.parentId, [...(childrenByParent.get(session.parentId) ?? []), session]);
  }
  const idsByName = new Map<string, string[]>();
  for (const session of eligible) idsByName.set(session.name, [...(idsByName.get(session.name) ?? []), session.id]);
  const uniqueName = (session: SessionCatalogEntry) => {
    const ids = idsByName.get(session.name) ?? [];
    if (ids.length < 2) return session.name;
    let length = Math.min(8, session.id.length);
    while (length < session.id.length && ids.some((id) => id !== session.id && id.startsWith(session.id.slice(0, length)))) length += 1;
    return `${session.name} (${session.id.slice(0, length)})`;
  };
  visible.sort((a, b) => compareSessions(a, b, sort));
  for (const children of childrenByParent.values()) children.sort((a, b) => compareSessions(a, b, sort));
  const projectGroups = new Map<string, { roots: SessionCatalogEntry[]; count: number }>();
  for (const session of visible) {
    const id = session.projectId || '';
    if (!projectGroups.has(id)) projectGroups.set(id, { roots: [], count: 0 });
    projectGroups.get(id)!.roots.push(session);
  }
  for (const session of eligible) if (included.has(session.id)) {
    const group = projectGroups.get(session.projectId || '');
    if (group) group.count += 1;
  }
  if (scope === 'chats' && !archivedOnly && !normalizedSearch) for (const project of projectCatalog) {
    if (project.cwd && !project.archivedAt && !projectGroups.has(project.id)) projectGroups.set(project.id, { roots: [], count: 0 });
  }
  const toggleRow = (id: string, additive: boolean) => { if (!additive) { onSelectProject(null); setSelectedRows([]); if (sessionGatewayMode === 'live') void selectLiveSession(id); else selectSession(id); return; } setSelectedRows((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); };
  const removeSession = async (id: string) => {
    if (!liveHistory) { deleteSession(id); return; }
    await deleteLiveSession(id);
    setRefresh((value) => value + 1);
  };
  const openTool = (key: string) => navigate(key === 'profiles' ? '/profiles' : `/tools/${key}`);

  if (collapsed) return <aside className="session-rail collapsed" aria-label="Agents collapsed" data-od-id="sessions-tools-rail"><button className="icon-button collapse-control" type="button" onClick={onToggle} aria-label="Expand Agents" data-testid="rail-expand"><Icon name="expand" /></button><button className="rail-glyph selected" type="button" onClick={() => changeScope('chats')} aria-label="Chats"><Icon name="agents" /></button><button className="rail-glyph" type="button" onClick={() => openTool('profiles')} aria-label="Profiles"><Icon name="profile" /></button><button className="rail-glyph" type="button" onClick={() => navigate('/tools/agent-settings')} aria-label="Agent settings"><Icon name="settings" /></button></aside>;

  const childDepth = (session: Session) => {
    let depth = 0; let current: Session | undefined = session;
    while (current?.parentId && depth < 4) { depth += 1; current = sessionsById.get(current.parentId); }
    return depth;
  };
  const sessionRow = (session: SessionCatalogEntry, child = false, disclosure?: { label: string; name: string; expanded: boolean }) => {
    const presentation = liveHistory && pendingSessions.has(session.id)
      ? { tone: 'waiting', label: 'Waiting on you', waiting: true }
      : sessionPresentation(session);
    const parentSession = session.parentId ? sessionsById.get(session.parentId) : undefined;
    return (
    <div className={`session-row-wrap ${child ? 'child-wrap' : ''} ${disclosure ? 'has-subagents' : ''}`} key={session.id} data-session-menu={session.id} style={child ? { '--child-depth': childDepth(session) } as React.CSSProperties : undefined}>
      <button id={`session-${session.id}`} className={`${child ? 'child-session' : 'session-row'} ${!selectedProject && selectedId === session.id ? 'selected' : ''} ${selectedRows.includes(session.id) ? 'multi-selected' : ''}`} type="button" onClick={(event) => toggleRow(session.id, event.shiftKey || event.metaKey)} aria-current={!selectedProject && selectedId === session.id ? 'true' : undefined} aria-pressed={selectedRows.includes(session.id)} data-testid={`session-${session.id}`}>
        <span className={`status-dot ${presentation.tone}`} aria-hidden="true" /><span className="session-copy"><strong>{session.name}</strong>{compact ? <small>{presentation.label}</small> : <><small>{child ? `${parentSession?.name ?? 'Parent session'} · ${presentation.label}` : `${projects.get(session.projectId) || session.projectName || 'No project'} · ${presentation.label}`}</small>{session.lastPreview && <small title={session.lastPreview}>{session.lastPreview}</small>}</>}</span>{presentation.waiting && <span className="attention-mark" role="img" aria-label="Waiting on you">!</span>}
      </button>
      {disclosure && <button id={`subagents-toggle-${session.id}`} className="subagent-disclosure" type="button" aria-label={disclosure.name} title={disclosure.name} aria-expanded={disclosure.expanded} aria-controls={`subagent-children-${session.id}`} onClick={() => setCollapsedParents((current) => { const next = new Set(current); if (next.has(session.id)) next.delete(session.id); else next.add(session.id); return next; })} data-testid={`subagents-${session.id}`}><Icon name={disclosure.expanded ? 'chevronDown' : 'chevronRight'} size={13} /><span>{disclosure.label}</span></button>}
      {!child && <><button className="session-overflow-button" type="button" aria-label={`${uniqueName(session)} actions`} aria-haspopup="menu" aria-expanded={rowMenuId === session.id} onClick={() => setRowMenuId((current) => current === session.id ? null : session.id)} data-testid={`session-menu-${session.id}`}><Icon name="more" size={15} /></button>{rowMenuId === session.id && <div className="menu-popover session-row-menu" role="menu" aria-label={`${uniqueName(session)} actions`}>
        {session.group === 'archived' ? <button className="menu-item" role="menuitem" type="button" onClick={() => { unarchiveSession(session.id); setRowMenuId(null); }} data-testid={`unarchive-${session.id}`}><Icon name="resume" size={14} />Restore</button> : <button className="menu-item" role="menuitem" type="button" onClick={() => { archiveSession(session.id); setRowMenuId(null); }} data-testid={`archive-${session.id}`}><Icon name="archive" size={14} />Archive</button>}
        {isSessionRecoverable(session) && session.group !== 'archived' && <button className="menu-item" role="menuitem" type="button" onClick={() => { resumeSession(session.id); setRowMenuId(null); }} data-testid={`resume-${session.id}`}><Icon name="resume" size={14} />Resume</button>}
        {session.status === 'working' && <button className="menu-item" role="menuitem" type="button" onClick={() => { cancelSession(session.id); setRowMenuId(null); }} data-testid={`cancel-${session.id}`}><Icon name="cancel" size={13} />Cancel</button>}
        <button className="menu-item danger" role="menuitem" type="button" onClick={() => { setDeleteTarget(session); setRowMenuId(null); }} data-testid={`delete-${session.id}`}><Icon name="delete" size={14} />Delete permanently</button>
      </div>}</>}
    </div>
  );
  };

  const sessionTree = (session: SessionCatalogEntry, child = false, visited = new Set<string>()): React.ReactNode => {
    if (visited.has(session.id)) return null;
    const path = new Set(visited).add(session.id);
    const children = childrenByParent.get(session.id) ?? [];
    const page = currentPage?.pages[session.id];
    const childRequest = currentPage?.children[session.id];
    const expanded = !collapsedParents.has(session.id);
    const loadedRunning = children.filter((nestedChild) => nestedChild.status === 'working').length;
    const hasExactCount = session.childCount !== undefined;
    const count = hasExactCount ? Math.max(session.childCount!, children.length) : children.length;
    const running = session.runningChildCount !== undefined ? session.runningChildCount : loadedRunning;
    const incomplete = !hasExactCount && session.hasChildren === true && (!page || page.hasMore);
    const countLabel = count === 0 && incomplete ? 'More subagents' : `${count}${incomplete ? '+' : ''} ${count === 1 ? 'subagent' : 'subagents'}`;
    const childLabel = `${countLabel}${running ? ` · ${running} running` : ''}`;
    // The chip stays numeric so the session name keeps the row; the full phrase lives in the name/tooltip.
    const compactLabel = count === 0 && incomplete ? 'More' : `${count}${incomplete ? '+' : ''}${running ? ` · ${running}` : ''}`;
    const hasDisclosure = count > 0 || session.hasChildren === true;
    const disclosureName = `${uniqueName(session)}: ${childLabel}`;
    return [
      sessionRow(session, child, hasDisclosure ? { label: compactLabel, name: disclosureName, expanded } : undefined),
      hasDisclosure && <div id={`subagent-children-${session.id}`} className="subagent-children" key={`subagent-children-${session.id}`}>{expanded && <>
        {children.map((nestedChild) => sessionTree(nestedChild, true, path))}
        {liveHistory && (!page || page.hasMore) && <button className="rail-load-children" type="button" data-load-parent={session.id} style={{ '--child-depth': Math.min(4, childDepth(session) + 1) } as React.CSSProperties} aria-disabled={childRequest?.busy || undefined} aria-busy={childRequest?.busy || undefined} onClick={() => void loadHistory(session.id, childRequest?.resetCursor ? undefined : page?.nextCursor ?? undefined)}>
          <Icon name={childRequest?.busy ? 'refresh' : 'chevronDown'} className={childRequest?.busy ? 'spin' : undefined} size={13} />
          <span aria-live="polite" aria-atomic="true">{childRequest?.error ? <>{childRequest.error} <span className="rail-child-retry">Retry</span></> : page ? 'Load more subagents' : 'Load subagents'}<span className="sr-only"> for {uniqueName(session)}{childRequest?.busy ? ' — Loading' : ''}</span></span>
        </button>}
      </>}</div>,
    ];
  };

  return <aside className="session-rail" aria-label="Agents" data-od-id="sessions-tools-rail">
    <header className={`rail-header ${searchOpen ? 'searching' : ''}`}>
      {searchOpen ? <label className="rail-title-search"><Icon name="search" size={15} /><span className="sr-only">Search sessions</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearch(''); setSearchOpen(false); requestAnimationFrame(() => searchToggleRef.current?.focus()); } }} placeholder="Search agents" data-testid="session-search" /></label> : <h2>Agents</h2>}
      <div className="rail-header-actions"><button ref={searchToggleRef} className="icon-button small" type="button" onClick={() => { if (searchOpen) { setSearch(''); setSearchOpen(false); } else setSearchOpen(true); }} aria-label={searchOpen ? 'Close search' : 'Search agents'} aria-expanded={searchOpen} data-testid="session-search-toggle"><Icon name={searchOpen ? 'close' : 'search'} size={15} /></button><button className="icon-button small" type="button" onClick={() => { if (liveHistory) { setRefresh((value) => value + 1); setProjectRefresh((value) => value + 1); } else notify('Session list refreshed at Aug 12, 3:48 PM'); }} aria-label="Refresh sessions" data-testid="sessions-refresh"><Icon name="refresh" size={15} /></button><button className="icon-button small" type="button" onClick={onToggle} aria-label="Collapse Agents" data-testid="rail-collapse"><Icon name="collapse" size={16} /></button></div>
    </header>
    <div className="rail-primary-actions"><button className="primary-button" type="button" disabled={liveHistory && (!defaultProfileId || submitting)} onClick={() => { if (liveHistory) { setSubmitting(true); void createLiveSession({ name: '', cwd: selectedProject?.cwd ?? selected.cwd, ...(selectedProject ? { projectId: selectedProject.id } : {}), profileId: defaultProfileId, isolateWorktree: false }).then(() => onSelectProject(null)).catch(error => notify(error instanceof Error ? error.message : 'Session creation failed')).finally(() => setSubmitting(false)); } else createSession(); }} data-testid="new-chat-instant"><Icon name="plus" size={16} />New session</button><button className="icon-button" type="button" onClick={openAdvanced} aria-label="Advanced new agent session" title="Advanced session options" data-testid="new-session-advanced"><Icon name="sliders" /></button></div>
    <button className="rail-add-project" type="button" onClick={openProjectForm} data-testid="rail-add-project"><Icon name="plus" size={14} />Add project</button>
    <div className="scope-tabs" role="tablist" aria-label="Session scopes" onKeyDown={moveScope}>{(['chats', 'scheduled', 'background'] as SessionScope[]).map((item) => <button role="tab" aria-selected={scope === item} tabIndex={scope === item ? 0 : -1} type="button" key={item} onClick={() => changeScope(item)} data-testid={`scope-${item}`}>{item === 'chats' ? 'Chats' : item === 'scheduled' ? 'Scheduled' : 'Background'}</button>)}</div>
    <div className="rail-filters rail-view-controls" ref={viewOptionsRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setViewOptionsOpen(false); }}>
      <label className="rail-sort"><span className="sr-only">Session sort</span><select value={sort} onChange={(event) => setSortPreference(event.target.value as SessionSort)} data-testid="session-sort"><option value="newest">Date · newest</option><option value="oldest">Date · oldest</option><option value="name">Name</option><option value="activity">Last activity</option><option value="status">Status</option></select></label>
      <button ref={viewOptionsTriggerRef} className="rail-view-trigger" type="button" aria-haspopup="menu" aria-expanded={viewOptionsOpen} aria-controls={viewOptionsOpen ? 'rail-view-options' : undefined} onClick={() => { viewOptionsLastItem.current = false; setViewOptionsOpen((value) => !value); }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); viewOptionsLastItem.current = event.key === 'ArrowUp'; setViewOptionsOpen(true); } }}>View options<Icon name="chevronDown" size={13} /></button>
      {viewOptionsOpen && <div id="rail-view-options" className="menu-popover rail-view-menu" role="menu" tabIndex={0} aria-label="View options" onKeyDown={moveViewOptionsFocus}>
        <button className="rail-view-item" type="button" role="menuitemcheckbox" tabIndex={-1} aria-checked={archivedOnly} aria-describedby="rail-archive-help" onClick={() => { setArchivedOnlyPreference(!archivedOnly); closeViewOptions(); }}><span className="rail-option-mark" aria-hidden="true">{archivedOnly && <Icon name="check" size={14} />}</span><span>View archived sessions</span></button>
        <p role="presentation" id="rail-archive-help" className="rail-view-help">Shows archived conversations instead of active ones. Does not archive anything.</p>
        <div role="group" aria-labelledby="rail-spacing-label" aria-describedby="rail-spacing-help">
          <p role="presentation" id="rail-spacing-label" className="rail-view-label">Row spacing</p>
          <p role="presentation" id="rail-spacing-help" className="rail-view-help">Compact fits more sessions in the list</p>
          {(['Comfortable', 'Compact'] as const).map((spacing) => <button className="rail-view-item" type="button" role="menuitemradio" tabIndex={-1} aria-checked={compact === (spacing === 'Compact')} key={spacing} onClick={() => { setCompactPreference(spacing === 'Compact'); closeViewOptions(); }}><span className="rail-option-mark" aria-hidden="true">{compact === (spacing === 'Compact') && <Icon name="check" size={14} />}</span><span>{spacing}</span></button>)}
        </div>
      </div>}
    </div>
    {archivedOnly && <button className="rail-archive-chip" type="button" onClick={() => setArchivedOnlyPreference(false)}>Archived sessions — Back to active</button>}
    {selectedRows.length > 0 && <div className="bulk-bar" role="toolbar" aria-label="Selected session actions"><strong>{selectedRows.length} selected</strong><button type="button" onClick={() => setSelectedRows([])}>Cancel</button><button type="button" onClick={() => setBulkDeleteOpen(true)}>Delete</button></div>}
    <div ref={sessionListRef} className={`session-list${compact ? ' rail-compact' : ''}`} role="region" tabIndex={0} aria-label={`${scope} sessions`} aria-busy={liveHistory && (!currentPage || currentPage.busy)}>
      {[...projectGroups].map(([id, group]) => {
        const expanded = !collapsedProjects.has(id);
        const name = id ? projects.get(id)! : 'No project';
        const label = id && (projectNameCounts.get(name) ?? 0) > 1 ? `${name} (${id})` : name;
        const project = projectCatalog.find((item) => item.id === id);
        return <section className="session-group" key={id}>
          <button className="group-toggle" type="button" aria-expanded={expanded} onClick={() => setCollapsedProjects((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} data-testid={`group-project-${id}`}><Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} /><span>{label}</span><small>{group.count}</small></button>
          {expanded && <div>{group.roots.map((session) => sessionTree(session))}{group.count === 0 && project?.cwd && <div className="rail-empty-project">
            <p>{currentPage?.pages['']?.hasMore ? 'No sessions loaded.' : 'No active sessions.'}</p><p className="rail-project-path" title={project.cwd}>{project.cwd}</p>
            <button className="rail-project-select" type="button" aria-pressed={selectedProject?.id === id} onClick={() => { onSelectProject(project); setSelectedRows([]); }}>{selectedProject?.id === id ? 'Selected project' : 'Select project'}<span className="sr-only"> {label}</span></button>
          </div>}</div>}
        </section>;
      })}
      {projectGroups.size === 0 && (!liveHistory || currentPage && !currentPage.busy && !currentPage.error) && <div className="rail-empty"><p>No sessions match.</p><button className="rail-add-project" type="button" onClick={openProjectForm}>Add project</button></div>}
      {projectsError && <div className="rail-project-error" role="alert">{projectsError} <button type="button" onClick={() => setProjectRefresh((value) => value + 1)}>Retry projects</button></div>}
      {liveHistory && <>{(!currentPage || currentPage.busy) && <p role="status">Loading session history…</p>}{currentPage?.error && <div role="alert"><p>{currentPage.error}</p><button className="secondary-button" type="button" onClick={() => setRefresh((value) => value + 1)}>Reset session history</button></div>}{currentPage?.pages['']?.hasMore && <><p className="rail-empty">Order applies to loaded sessions. Load older history to include more.</p><button className="secondary-button" type="button" disabled={currentPage.busy || !!currentPage.error} onClick={() => void loadHistory(undefined, currentPage.pages[''].nextCursor ?? undefined)}>{normalizedSearch ? 'Load older matches' : 'Load older roots'}</button></>}</>}
    </div>
    <Splitter orientation="horizontal" storageKey="layout.agents.tools" min={120} max={320} defaultSize={224} onResize={setToolsHeight} ariaLabel="Resize Tools panel" resizeEdge="end" className="tools-resizer" testId="tools-resizer" />
    <nav className="tools-nav" aria-label="Agent tools" style={{ height: `${toolsHeight}px` }}><span className="rail-section-label">Tools</span>{tools.map((tool) => <button type="button" onClick={() => openTool(tool.key)} key={tool.key} data-testid={`tool-${tool.key}`}><Icon name={tool.icon} /><span><strong>{tool.label}</strong><small>{tool.description}</small></span><Icon name="chevronRight" size={14} /></button>)}</nav>
    <footer className="rail-account"><button type="button" onClick={() => navigate('/tools/agent-settings')} data-testid="rail-agent-settings"><span className="avatar">AJ</span><span><strong>AJ Hochhalter</strong><small>Agent settings</small></span><Icon name="settings" size={15} /></button></footer>

    <FocusDialog open={projectFormOpen} onClose={closeProjectForm} title="Add project" description="Give an existing working directory a name so you can start sessions in it." testId="add-project-dialog">
      <form className="rail-project-form" onSubmit={addProject}>
        <label className="field">Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} required disabled={projectSaving} data-autofocus data-testid="project-name" autoComplete="off" /></label>
        <label className="field" htmlFor="agent-project-cwd">Working directory</label>
        <input id="agent-project-cwd" value={projectCwd} onChange={(event) => setProjectCwd(event.target.value)} required disabled={projectSaving} placeholder="/Users/you/project" aria-describedby="project-directory-help" data-testid="project-cwd" autoComplete="off" spellCheck={false} />
        <button className="secondary-button rail-folder-picker" type="button" onClick={() => void chooseProjectFolder()} disabled={!projectShell?.selectDirectory || folderPicking || projectSaving}>{folderPicking ? 'Choosing folder…' : 'Choose folder…'}</button>
        <p id="project-directory-help">{projectShell?.selectDirectory ? 'Choose a folder or enter its full path.' : 'Folder browsing is unavailable here. Enter the full directory path.'}</p>
        {projectError && <p className="form-error" role="alert">{projectError}</p>}
        <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={closeProjectForm} disabled={projectSaving}>Cancel</button><button className="primary-button" type="submit" disabled={projectSaving || folderPicking || !projectName.trim() || !projectCwd.trim()}>{projectSaving ? 'Creating…' : 'Create'}</button></footer>
      </form>
    </FocusDialog>

    <FocusDialog open={advancedOpen} onClose={closeAdvanced} title="New agent session" description="Choose the task and working context. Model and agent are selected after the session starts." testId="advanced-session-dialog" wide>
      <form className="form-grid advanced-session-form" onSubmit={startSession}>
        <label className="field span-2">Session name<span>Required</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Fix auth bug" required data-autofocus data-testid="advanced-name" /></label>
        <label className="field span-2">Linked task<span>Optional · non-done tasks</span><select value={taskId} onChange={(event) => setTaskId(event.target.value)} data-testid="advanced-task"><option value="">No task linked</option>{liveHistory ? liveTasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>) : <><option value="task-review-handoff">Review service handoff</option><option value="task-check-relay">Check relay recovery</option></>}</select>{liveHistory && tasksError && <span role="alert">{tasksError}</span>}</label>
        {liveHistory && <label className="field span-2">Agent profile<span>Required</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)} required data-testid="advanced-profile"><option value="" disabled>Choose an enabled profile</option>{eligibleProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}</select></label>}
        <label className="field span-2">Working directory<div className="field-with-action"><input value={cwd} onChange={(event) => { setCwd(event.target.value); setBranch(''); setNewBranchMode(false); setNewBranch(''); setPendingBranch(null); }} required data-testid="advanced-cwd" /><button type="button" disabled={liveHistory && !window.rhythmShell?.selectDirectory} title={liveHistory ? 'Native folder browsing is unavailable; enter the directory path' : undefined} onClick={async () => {
          if (window.rhythmShell?.selectDirectory) {
            try {
              const directory = await window.rhythmShell.selectDirectory();
              if (directory !== null) { setCwd(directory); setBranch(''); setNewBranchMode(false); setNewBranch(''); setPendingBranch(null); }
            } catch { notify('Folder selection failed; enter the directory path manually.'); }
          } else { setCwd('/workspace/rhythm'); notify('Fixture folder selected'); }
        }} data-testid="advanced-browse">Browse…</button></div>{liveHistory && <span>Enter the directory path; native folder browsing is unavailable.</span>}</label>
        <label className="switch-row span-2"><input type="checkbox" checked={isolateWorktree} onChange={(event) => setIsolateWorktree(event.target.checked)} data-testid="advanced-isolate-worktree" /><span><strong>Run in isolated worktree</strong><small>Creates a separate git worktree so edits do not touch this working directory.</small></span></label>
        {isolateWorktree && <label className="field span-2">Worktree name<span>Optional</span><input value={worktreeName} onChange={(event) => setWorktreeName(event.target.value)} placeholder="release-readiness" data-testid="advanced-worktree-name" /></label>}
        <fieldset className="branch-options span-2"><legend>Branch</legend>{newBranchMode ? <div className="field-with-action"><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="new-branch-name" aria-label="New branch name" data-testid="advanced-new-branch" /><button type="button" onClick={() => { setNewBranchMode(false); setNewBranch(''); }}>Cancel</button></div> : sessionGatewayMode === 'live'
          ? <select value={branch} onChange={(event) => selectBranch(event.target.value)} aria-label="Branch" data-testid="advanced-branch">
              {branch === '' && <option value="">Use cwd's current branch</option>}
              {cwd === (selectedProject?.cwd ?? selected.cwd) && <><option value={liveBranches?.current ?? (selectedProject ? selectedProject.vcsBranch ?? '' : selected.branch)}>Current · {liveBranches?.current ?? (selectedProject ? selectedProject.vcsBranch ?? '' : selected.branch)}</option>
              {(liveBranches?.recent ?? []).filter((name) => name !== (liveBranches?.current ?? (selectedProject ? selectedProject.vcsBranch ?? '' : selected.branch))).map((name) => <option value={name} key={`recent-${name}`}>{name} · recent</option>)}
              {(liveBranches?.local ?? []).filter((name) => name !== (liveBranches?.current ?? (selectedProject ? selectedProject.vcsBranch ?? '' : selected.branch)) && !(liveBranches?.recent ?? []).includes(name)).map((name) => <option value={name} key={`local-${name}`}>{name} · local</option>)}</>}
              <option value="__new__">New branch from current</option>
            </select>
          : <select value={branch} onChange={(event) => selectBranch(event.target.value)} aria-label="Branch" data-testid="advanced-branch"><option value={selected.branch}>Current · {selected.branch}</option>{selected.branch !== 'release/desktop' && <option value="release/desktop">release/desktop · recent</option>}{selected.branch !== 'main' && <option value="main">main · local</option>}<option value="__new__">New branch from current</option></select>}</fieldset>
        {(liveHistory || accounts.length >= 2) && <label className="field span-2">Account<span>Optional</span><select value={account} onChange={(event) => setAccount(event.target.value)} data-testid="advanced-account"><option value="">Profile default</option>{liveHistory ? fixtures.accounts.map(item => <option key={item.id} value={item.id} disabled={!!item.status && item.status !== 'ok'}>{item.label} · {item.id}</option>) : accounts.map((item) => <option key={item}>{item}</option>)}</select>{liveHistory && fixtures.catalogError && <span role="alert">{fixtures.catalogError}</span>}</label>}
        {pendingBranch && <div className="protected-confirm span-2" role="alertdialog" aria-labelledby="stash-confirm-title" aria-describedby="stash-confirm-description" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPendingBranch(null); } }} data-testid="stash-confirm-dialog"><div><strong id="stash-confirm-title">Working tree has uncommitted changes</strong><p id="stash-confirm-description">Stash the unsaved changes before switching branches, or cancel and keep the current branch.</p></div><div className="dialog-actions"><button className="secondary-button" type="button" autoFocus onClick={() => setPendingBranch(null)} data-testid="stash-cancel">Cancel</button><button className="primary-button" type="button" onClick={() => { setBranch(pendingBranch); setStashConfirmed(true); setPendingBranch(null); }} data-testid="stash-confirm">Stash</button></div></div>}
        {submitError && <div className="form-error span-2" role="alert" data-testid="advanced-error">{submitError.status >= 500 ? <><strong>Something went wrong on the server.</strong><details><summary>Details</summary><p>{submitError.message}</p></details></> : submitError.message}</div>}
        <footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={closeAdvanced} disabled={submitting}>Cancel</button><button className="primary-button" type="submit" disabled={!name.trim() || submitting || liveHistory && !eligibleProfiles.some(profile => profile.id === profileId)} data-testid="advanced-create">{submitting ? <><Icon name="refresh" className="spin" size={14} />Starting…</> : 'Start'}</button></footer>
      </form>
    </FocusDialog>
    <FocusDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Delete session permanently?" description={deleteTarget ? `${deleteTarget.name} and its ${sessionGatewayMode === 'live' ? 'persisted' : 'fixture'} transcript will be removed.` : ''} testId="delete-session-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)}>Keep session</button><button className="danger-button" type="button" onClick={() => { if (deleteTarget) void removeSession(deleteTarget.id); setDeleteTarget(null); }} data-testid="confirm-session-delete">Delete permanently</button></div></FocusDialog>
    <FocusDialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} title="Delete selected sessions?" description={`${selectedRows.length} deterministic sessions will be removed.`} testId="bulk-delete-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setBulkDeleteOpen(false)}>Cancel</button><button className="danger-button" type="button" onClick={() => { selectedRows.forEach((id) => { void removeSession(id); }); setSelectedRows([]); setBulkDeleteOpen(false); }}>Delete selected</button></div></FocusDialog>
  </aside>;
}
