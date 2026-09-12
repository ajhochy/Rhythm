import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { useGateway } from '../gateway/context';
import { compareSessions, SessionGatewayError, type ProjectBranches, type SessionCatalogEntry, type SessionSort, type TranscriptPageInfo } from '../gateway/sessions';
import { isSessionRecoverable, sessionPresentation } from '../sessionState';
import { useFixtures } from '../store';
import type { Session, SessionGroup, SessionScope } from '../types';
import { FocusDialog } from './FocusDialog';
import { navigate } from './Shell';
import { usePendingSessionIds } from '../pending-decisions';

const groupLabels: Record<SessionGroup, string> = { active: 'Active', resumable: 'Resumable', archived: 'Archived' };
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
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function SessionRail({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const fixtures = useFixtures();
  const gateway = useGateway();
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
  const [project, setProject] = useState('all');
  const [sort, setSort] = useState<SessionSort>('newest');
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const normalizedSearch = search.trim();
  const historyIdentity = useMemo(() => ({ gateway, scope, project, search: normalizedSearch, archivedOnly, refresh }), [gateway, scope, project, normalizedSearch, archivedOnly, refresh]);
  const currentHistory = useRef(historyIdentity);
  currentHistory.current = historyIdentity;
  const [history, setHistory] = useState<{
    identity: typeof historyIdentity; rows: SessionCatalogEntry[];
    pages: Record<string, TranscriptPageInfo>; busy: boolean; error: string;
  } | null>(null);
  const [projectLabels, setProjectLabels] = useState<{ gateway: typeof gateway; rows: { id: string; name: string }[] } | null>(null);
  const liveHistory = sessionGatewayMode === 'live';
  const currentPage = history?.identity === historyIdentity ? history : null;
  const loadHistory = async (parentId?: string, cursor?: string) => {
    const identity = historyIdentity;
    if (!gateway.domains.sessions?.listPage) return;
    setHistory((value) => value?.identity === identity ? { ...value, busy: true, error: '' } : { identity, rows: [], pages: {}, busy: true, error: '' });
    try {
      const result = await gateway.domains.sessions.listPage({ scope, projectId: scope === 'chats' && project !== 'all' ? project : undefined, search: normalizedSearch, archivedOnly, parentId, cursor });
      if (currentHistory.current !== identity) return;
      setHistory((value) => {
        const previous = value?.identity === identity ? value : null;
        const rows = new Map((previous?.rows ?? []).map((row) => [row.id, row]));
        for (const row of [...result.ancestors, ...result.sessions]) rows.set(row.id, row);
        return { identity, rows: [...rows.values()], pages: { ...previous?.pages, [parentId ?? '']: result.pageInfo }, busy: false, error: '' };
      });
    } catch (error) {
      if (currentHistory.current !== identity) return;
      setHistory((value) => value?.identity === identity ? { ...value, busy: false, error: error instanceof SessionGatewayError && error.status === 400 ? 'Session history cursor expired. Reset session history to continue.' : 'Session history unavailable. Reset session history to retry.' } : value);
    }
  };
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
    void gateway.domains.sessions.projectLabels().then((rows) => { if (active) setProjectLabels({ gateway, rows }); }).catch(() => { if (active) setProjectLabels({ gateway, rows: [] }); });
    return () => { active = false; };
  }, [gateway, liveHistory]);
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
  const [expanded, setExpanded] = useState<Record<SessionGroup | 'parents' | 'children', boolean>>({ active: true, resumable: true, archived: true, parents: true, children: true });

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
    setName(''); setTaskId(''); setCwd(selected.cwd); setIsolateWorktree(false); setWorktreeName('');
    setBranch(selected.branch); setNewBranchMode(false); setNewBranch(''); setPendingBranch(null); setStashConfirmed(false);
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
    void gateway.domains.sessions!.branches(selected.projectId)
      .then((data) => { if (active) setLiveBranches(data); })
      .catch(() => { if (active) setLiveBranches(null); });
    return () => { active = false; };
  }, [advancedOpen, sessionGatewayMode, selected.projectId, gateway]);
  const startSession = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true); setSubmitError(null);
    try {
      if (sessionGatewayMode === 'live') {
        await createLiveSession({
          name: name.trim(), cwd, profileId, taskId: taskId || undefined, anthropicAccountId: account || undefined, isolateWorktree, worktreeName: isolateWorktree ? worktreeName || undefined : undefined,
          branch: newBranchMode ? newBranch : branch || undefined, createBranch: newBranchMode, stash: stashConfirmed ? 'stash' : undefined,
        });
      } else {
        await Promise.resolve();
        if (cwd.includes('forbidden')) { setSubmitError({ status: 422, message: 'That working directory is not available. Choose another folder and try again.' }); return; }
        if (cwd.includes('server-error')) { setSubmitError({ status: 503, message: 'Fixture server could not create the worktree. Request id: fixture-create-503.' }); return; }
        createSession({ name: name.trim(), taskId, cwd, branch: newBranchMode ? newBranch : branch, createBranch: newBranchMode, stash: stashConfirmed, isolateWorktree, worktreeName, anthropicAccountId: account });
      }
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
    if (next !== selected.branch && selected.dirtyCount > 0) { setPendingBranch(next); return; }
    setBranch(next); setNewBranchMode(false);
  };
  const startToolsResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    const startY = event.clientY;
    const startHeight = toolsHeight;
    const move = (pointer: PointerEvent) => setToolsHeight(clamp(startHeight - (pointer.clientY - startY), 120, 320));
    const stop = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop);
      notify('Tools panel resized');
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', stop);
  };

  const changeScope = (next: SessionScope) => { setScope(next); setSearch(''); setProject('all'); setSelectedRows([]); };
  const moveScope = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const values: SessionScope[] = ['chats', 'scheduled', 'background'];
    const next = event.key === 'Home' ? values[0] : event.key === 'End' ? values[2] : values[(values.indexOf(scope) + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length];
    changeScope(next); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="scope-${next}"]`)?.focus());
  };
  const catalog: SessionCatalogEntry[] = liveHistory ? currentPage?.rows ?? [] : sessions;
  const projects = new Map((projectLabels?.gateway === gateway ? projectLabels.rows : []).map((item) => [item.id, item.name]));
  for (const session of catalog) if (session.projectId && !projects.has(session.projectId)) projects.set(session.projectId, session.projectName || `Unknown project (${session.projectId})`);
  const sessionsById = new Map(catalog.map((session) => [session.id, session]));
  const eligible = catalog.filter((session) => session.scope === scope && (scope !== 'chats' || project === 'all' || (session.projectId || 'null') === project) && (!liveHistory && !archivedOnly || (session.group === 'archived') === archivedOnly));
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
    if (!session.parentId || !included.has(session.parentId)) visible.push(session);
    else childrenByParent.set(session.parentId, [...(childrenByParent.get(session.parentId) ?? []), session]);
  }
  visible.sort((a, b) => compareSessions(a, b, sort));
  for (const children of childrenByParent.values()) children.sort((a, b) => compareSessions(a, b, sort));
  const toggleRow = (id: string, additive: boolean) => { if (!additive) { setSelectedRows([]); if (sessionGatewayMode === 'live') void selectLiveSession(id); else selectSession(id); return; } setSelectedRows((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); };
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
  const sessionRow = (session: SessionCatalogEntry, child = false) => {
    const presentation = liveHistory && pendingSessions.has(session.id)
      ? { tone: 'waiting', label: 'Waiting on you', waiting: true }
      : sessionPresentation(session);
    const parentSession = session.parentId ? sessionsById.get(session.parentId) : undefined;
    return (
    <div className={`session-row-wrap ${child ? 'child-wrap' : ''}`} key={session.id} data-session-menu={session.id} style={child ? { '--child-depth': childDepth(session) } as React.CSSProperties : undefined}>
      <button id={`session-${session.id}`} className={`${child ? 'child-session' : 'session-row'} ${selectedId === session.id ? 'selected' : ''} ${selectedRows.includes(session.id) ? 'multi-selected' : ''}`} type="button" onClick={(event) => toggleRow(session.id, event.shiftKey || event.metaKey)} aria-current={selectedId === session.id ? 'true' : undefined} aria-pressed={selectedRows.includes(session.id)} data-testid={`session-${session.id}`}>
        <span className={`status-dot ${presentation.tone}`} aria-hidden="true" /><span className="session-copy"><strong>{session.name}</strong>{!compact && <><small>{child ? `${parentSession?.name ?? 'Parent session'} · ${presentation.label}` : `${projects.get(session.projectId) || session.projectName || 'No project'} · ${presentation.label}`}</small>{session.lastPreview && <small title={session.lastPreview}>{session.lastPreview}</small>}</>}</span>{presentation.waiting && <span className="attention-mark" aria-label="Waiting on you">!</span>}
      </button>
      {!child && <><button className="session-overflow-button" type="button" aria-label={`${session.name} actions`} aria-haspopup="menu" aria-expanded={rowMenuId === session.id} onClick={() => setRowMenuId((current) => current === session.id ? null : session.id)} data-testid={`session-menu-${session.id}`}><Icon name="more" size={15} /></button>{rowMenuId === session.id && <div className="menu-popover session-row-menu" role="menu" aria-label={`${session.name} actions`}>
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
    return [
      sessionRow(session, child),
      ...(expanded.children ? children.map((nestedChild) => sessionTree(nestedChild, true, path)) : []),
      liveHistory && session.hasChildren && (!page || page.hasMore) && <button className="secondary-button" key={`load-${session.id}`} type="button" disabled={currentPage?.busy || !!currentPage?.error} onClick={() => void loadHistory(session.id, page?.nextCursor ?? undefined)}>{page ? 'Load older children of ' : 'Load children of '}{session.name}</button>,
    ];
  };

  return <aside className="session-rail" aria-label="Agents" data-od-id="sessions-tools-rail">
    <header className={`rail-header ${searchOpen ? 'searching' : ''}`}>
      {searchOpen ? <label className="rail-title-search"><Icon name="search" size={15} /><span className="sr-only">Search sessions</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearch(''); setSearchOpen(false); requestAnimationFrame(() => searchToggleRef.current?.focus()); } }} placeholder="Search agents" data-testid="session-search" /></label> : <h2>Agents</h2>}
      <div className="rail-header-actions"><button ref={searchToggleRef} className="icon-button small" type="button" onClick={() => { if (searchOpen) { setSearch(''); setSearchOpen(false); } else setSearchOpen(true); }} aria-label={searchOpen ? 'Close search' : 'Search agents'} aria-expanded={searchOpen} data-testid="session-search-toggle"><Icon name={searchOpen ? 'close' : 'search'} size={15} /></button><button className="icon-button small" type="button" onClick={() => { if (liveHistory) setRefresh((value) => value + 1); else notify('Session list refreshed at Aug 12, 3:48 PM'); }} aria-label="Refresh sessions" data-testid="sessions-refresh"><Icon name="refresh" size={15} /></button><button className="icon-button small" type="button" onClick={onToggle} aria-label="Collapse Agents" data-testid="rail-collapse"><Icon name="collapse" size={16} /></button></div>
    </header>
    <div className="rail-primary-actions"><button className="primary-button" type="button" disabled={liveHistory && (!defaultProfileId || submitting)} onClick={() => { if (liveHistory) { setSubmitting(true); void createLiveSession({ name: '', cwd: selected.cwd, profileId: defaultProfileId, isolateWorktree: false }).catch(error => notify(error instanceof Error ? error.message : 'Session creation failed')).finally(() => setSubmitting(false)); } else createSession(); }} data-testid="new-chat-instant"><Icon name="plus" size={16} />New session</button><button className="icon-button" type="button" onClick={openAdvanced} aria-label="Advanced new agent session" title="Advanced session options" data-testid="new-session-advanced"><Icon name="sliders" /></button></div>
    <div className="scope-tabs" role="tablist" aria-label="Session scopes" onKeyDown={moveScope}>{(['chats', 'scheduled', 'background'] as SessionScope[]).map((item) => <button role="tab" aria-selected={scope === item} tabIndex={scope === item ? 0 : -1} type="button" key={item} onClick={() => changeScope(item)} data-testid={`scope-${item}`}>{item === 'chats' ? 'Chats' : item === 'scheduled' ? 'Scheduled' : 'Background'}</button>)}</div>
    <div className="rail-filters"><div className="filter-row">{scope === 'chats' && <label><span className="sr-only">Project filter</span><select value={project} onChange={(event) => setProject(event.target.value)} data-testid="project-filter"><option value="all">All projects</option><option value="null">No project</option>{[...projects].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}<label><span className="sr-only">Session sort</span><select value={sort} onChange={(event) => setSort(event.target.value as SessionSort)} data-testid="session-sort"><option value="newest">Date · newest</option><option value="oldest">Date · oldest</option><option value="name">Name</option><option value="activity">Last activity</option><option value="status">Status</option></select></label></div><label><input type="checkbox" checked={archivedOnly} onChange={(event) => setArchivedOnly(event.target.checked)} />Archived sessions</label><label><input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} />Compact rows</label></div>
    {selectedRows.length > 0 && <div className="bulk-bar" role="toolbar" aria-label="Selected session actions"><strong>{selectedRows.length} selected</strong><button type="button" onClick={() => setSelectedRows([])}>Cancel</button><button type="button" onClick={() => setBulkDeleteOpen(true)}>Delete</button></div>}
    <div className="session-list" aria-label={`${scope} sessions`} aria-busy={liveHistory && (!currentPage || currentPage.busy)}><section className="agent-disclosure"><button className="group-toggle section-disclosure" type="button" aria-expanded={expanded.parents} onClick={() => setExpanded((current) => ({ ...current, parents: !current.parents }))}><Icon name={expanded.parents ? 'chevronDown' : 'chevronRight'} size={14} /><span>Agents</span><small>{visible.length}</small></button>{expanded.parents && (['active', 'resumable', 'archived'] as SessionGroup[]).map((group) => { const grouped = visible.filter((session) => session.group === group); return <section className="session-group" key={group}><button className="group-toggle" type="button" aria-expanded={expanded[group]} onClick={() => setExpanded((current) => ({ ...current, [group]: !current[group] }))} data-testid={`group-${group}`}><Icon name={expanded[group] ? 'chevronDown' : 'chevronRight'} size={13} /><span>{groupLabels[group]}</span><small>{grouped.length}</small></button>{expanded[group] && <div>{grouped.map((session) => sessionTree(session))}{grouped.length === 0 && <p className="rail-empty">No {groupLabels[group].toLowerCase()} sessions match.</p>}</div>}</section>; })}</section>{liveHistory && <>{(!currentPage || currentPage.busy) && <p role="status">Loading session history…</p>}{currentPage?.error && <div role="alert"><p>{currentPage.error}</p><button className="secondary-button" type="button" onClick={() => setRefresh((value) => value + 1)}>Reset session history</button></div>}{currentPage?.pages['']?.hasMore && <><p className="rail-empty">Order applies to loaded sessions. Load older history to include more.</p><button className="secondary-button" type="button" disabled={currentPage.busy || !!currentPage.error} onClick={() => void loadHistory(undefined, currentPage.pages[''].nextCursor ?? undefined)}>{normalizedSearch ? 'Load older matches' : 'Load older roots'}</button></>}</>}</div>
    <div className="tools-resizer" role="separator" aria-orientation="horizontal" aria-label="Resize Tools panel" aria-valuemin={120} aria-valuemax={320} aria-valuenow={toolsHeight} aria-valuetext={`${toolsHeight} pixels`} tabIndex={0} onPointerDown={startToolsResize} onKeyDown={(event) => { if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); if (event.key === 'ArrowUp') setToolsHeight((value) => clamp(value + 16, 120, 320)); if (event.key === 'ArrowDown') setToolsHeight((value) => clamp(value - 16, 120, 320)); if (event.key === 'Home') setToolsHeight(120); if (event.key === 'End') setToolsHeight(320); }} data-testid="tools-resizer"><span /></div>
    <nav className="tools-nav" aria-label="Agent tools" style={{ height: `${toolsHeight}px` }}><span className="rail-section-label">Tools</span>{tools.map((tool) => <button type="button" onClick={() => openTool(tool.key)} key={tool.key} data-testid={`tool-${tool.key}`}><Icon name={tool.icon} /><span><strong>{tool.label}</strong><small>{tool.description}</small></span><Icon name="chevronRight" size={14} /></button>)}</nav>
    <footer className="rail-account"><button type="button" onClick={() => navigate('/tools/agent-settings')} data-testid="rail-agent-settings"><span className="avatar">AJ</span><span><strong>AJ Hochhalter</strong><small>Agent settings</small></span><Icon name="settings" size={15} /></button></footer>

    <FocusDialog open={advancedOpen} onClose={closeAdvanced} title="New agent session" description="Choose the task and working context. Model and agent are selected after the session starts." testId="advanced-session-dialog" wide>
      <form className="form-grid advanced-session-form" onSubmit={startSession}>
        <label className="field span-2">Session name<span>Required</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Fix auth bug" required data-autofocus data-testid="advanced-name" /></label>
        <label className="field span-2">Linked task<span>Optional · non-done tasks</span><select value={taskId} onChange={(event) => setTaskId(event.target.value)} data-testid="advanced-task"><option value="">No task linked</option>{liveHistory ? liveTasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>) : <><option value="task-review-handoff">Review service handoff</option><option value="task-check-relay">Check relay recovery</option></>}</select>{liveHistory && tasksError && <span role="alert">{tasksError}</span>}</label>
        {liveHistory && <label className="field span-2">Agent profile<span>Required</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)} required data-testid="advanced-profile"><option value="" disabled>Choose an enabled profile</option>{eligibleProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}</select></label>}
        <label className="field span-2">Working directory<div className="field-with-action"><input value={cwd} onChange={(event) => { setCwd(event.target.value); setBranch(''); setNewBranchMode(false); setNewBranch(''); setPendingBranch(null); }} required data-testid="advanced-cwd" /><button type="button" disabled={liveHistory} title={liveHistory ? 'Native folder browsing is unavailable; enter the directory path' : undefined} onClick={() => { setCwd('/workspace/rhythm'); notify('Fixture folder selected'); }} data-testid="advanced-browse">Browse…</button></div>{liveHistory && <span>Enter the directory path; native folder browsing is unavailable.</span>}</label>
        <label className="switch-row span-2"><input type="checkbox" checked={isolateWorktree} onChange={(event) => setIsolateWorktree(event.target.checked)} data-testid="advanced-isolate-worktree" /><span><strong>Run in isolated worktree</strong><small>Creates a separate git worktree so edits do not touch this working directory.</small></span></label>
        {isolateWorktree && <label className="field span-2">Worktree name<span>Optional</span><input value={worktreeName} onChange={(event) => setWorktreeName(event.target.value)} placeholder="release-readiness" data-testid="advanced-worktree-name" /></label>}
        <fieldset className="branch-options span-2"><legend>Branch</legend>{newBranchMode ? <div className="field-with-action"><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="new-branch-name" aria-label="New branch name" data-testid="advanced-new-branch" /><button type="button" onClick={() => { setNewBranchMode(false); setNewBranch(''); }}>Cancel</button></div> : sessionGatewayMode === 'live'
          ? <select value={branch} onChange={(event) => selectBranch(event.target.value)} aria-label="Branch" data-testid="advanced-branch">
              {branch === '' && <option value="">Use cwd's current branch</option>}
              {cwd === selected.cwd && <><option value={liveBranches?.current ?? selected.branch}>Current · {liveBranches?.current ?? selected.branch}</option>
              {(liveBranches?.recent ?? []).filter((name) => name !== (liveBranches?.current ?? selected.branch)).map((name) => <option value={name} key={`recent-${name}`}>{name} · recent</option>)}
              {(liveBranches?.local ?? []).filter((name) => name !== (liveBranches?.current ?? selected.branch) && !(liveBranches?.recent ?? []).includes(name)).map((name) => <option value={name} key={`local-${name}`}>{name} · local</option>)}</>}
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
