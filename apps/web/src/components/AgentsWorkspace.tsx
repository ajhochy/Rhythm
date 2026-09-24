import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { isSessionOffline, sessionPresentation } from '../sessionState';
import { emptyLiveProfile, useFixtures } from '../store';
import { Composer } from './Composer';
import { FocusDialog } from './FocusDialog';
import { Inspector } from './Inspector';
import { ProfileAvatar } from './Profiles';
import { SessionRail } from './SessionRail';
import { Splitter } from './Splitter';
import { Transcript } from './Transcript';
import { usePendingDecisions } from '../pending-decisions';
import type { AgentProject } from '../gateway/sessions';
import { emitAgentNotification } from '../agentNotifications';

export function AgentsWorkspace() {
  const { selected, sessions, profiles, models, accounts, sessionGatewayMode, saveSessionSettings, connectionMessage: fixtureConnectionMessage, liveSessionError, loading, summarizeSession, prepareLiveSession, startFreshSession, reconnectLiveSession, updateSession: updateFixtureSession, archiveSession, resumeSession, selectSession, notify, resumeGone, liveChildView, closeLiveChildView } = useFixtures();
  const live = sessionGatewayMode === 'live';
  const pending = usePendingDecisions(selected.id);
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const updateSession: typeof updateFixtureSession = (id, patch) => {
    if (!live) { updateFixtureSession(id, patch); return; }
    // The actions menu only uses this path for Fast; all form fields use the canonical submit below.
    void saveSessionSettings(id, { fastMode: patch.fastMode }).catch(error => setSettingsError(error instanceof Error ? error.message : 'Settings failed'));
  };
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [railWidth, setRailWidth] = useState(280);
  const [inspectorWidth, setInspectorWidth] = useState(336);
  const [railCollapsed, setRailCollapsed] = useState(compactLayout);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(compactLayout);
  const [sessionSettings, setSessionSettings] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<AgentProject | null>(null);
  useEffect(() => {
    const sync = () => emitAgentNotification({ v: 1, type: 'viewing', sessionId: selected.id || null,
      displayed: Boolean(selected.id && !loading && !selectedProject && !liveChildView && window.location.hash.startsWith('#/agents')) }, live);
    sync();
    window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('hashchange', sync); emitAgentNotification({ v: 1, type: 'viewing', sessionId: null, displayed: false }, live); };
  }, [selected.id, loading, selectedProject, liveChildView, live]);
  useEffect(() => { setSelectedProject(null); }, [selected.id]);
  const [retrying, setRetrying] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const connectionMessage = live ? retrying ? 'Reconciling session…' : liveSessionError ?? (loading ? 'Loading session…' : fixtureConnectionMessage === 'Desktop connected' ? 'Session loaded' : fixtureConnectionMessage) : fixtureConnectionMessage;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [resizeAnnouncement, setResizeAnnouncement] = useState('');
  const [activityAnnouncement, setActivityAnnouncement] = useState('');
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const previousStatus = useRef(selected.status);
  const previousConnection = useRef(connectionMessage);
  // ponytail: a real workspace with zero configured agent profiles is a legitimate live state
  // (fresh install, all profiles deleted) — fall back to a placeholder instead of crashing on
  // undefined.icon/.label when `profiles` resolves empty.
  const profile = profiles.find((item) => item.id === selected.profileId) ?? profiles[0] ?? emptyLiveProfile();
  const parentId = selected.parentId;
  const parent = parentId ? sessions.find((session) => session.id === parentId) : undefined;
  const readOnlyChild = live ? Boolean(liveChildView) : Boolean(parent);
  const backToParent = () => { if (liveChildView) closeLiveChildView(); else if (parent) selectSession(parent.id); };
  const presentation = sessionPresentation(selected);
  const recoverableConnection = Boolean(live && liveSessionError) || isSessionOffline(selected) || selected.connectionState === 'unavailable' || Boolean(selected.stuckSince);
  const lifecycleDisabled = lifecycleBusy || live && (!selected.id || readOnlyChild || selected.status === 'working' || selected.status === 'starting');
  const compactSession = async () => {
    if (lifecycleDisabled) return;
    setLifecycleBusy(true);
    try { await summarizeSession(selected.id); } finally { setLifecycleBusy(false); }
  };
  const prepareProject = async () => {
    if (lifecycleDisabled) return;
    if (!live) { setPrepareOpen(false); notify('Project prepared for agents'); return; }
    setLifecycleBusy(true);
    try { if (await prepareLiveSession(selected.id)) setPrepareOpen(false); } finally { setLifecycleBusy(false); }
  };
  const retryConnection = async () => {
    if (retrying) return;
    setRetrying(true);
    try { if (live) await reconnectLiveSession(); else { resumeSession(selected.id); notify('Desktop connection restored'); } }
    catch { /* The store retains the reconciliation error for the header. */ }
    finally { setRetrying(false); }
  };

  useEffect(() => { setRetrying(false); setActionsOpen(false); previousStatus.current = selected.status; previousConnection.current = connectionMessage; }, [selected.id]);
  useEffect(() => {
    if (previousStatus.current === 'working' && selected.status !== 'working') setActivityAnnouncement('Agent response complete.');
    previousStatus.current = selected.status;
  }, [selected.status]);
  useEffect(() => {
    if (previousConnection.current !== connectionMessage) setActivityAnnouncement(`Connection status: ${connectionMessage}`);
    previousConnection.current = connectionMessage;
  }, [connectionMessage]);
  const waitingForDecision = live ? !liveChildView && Boolean(pending.permissions.size || pending.questions.size) : selected.permission?.status === 'pending' || selected.question?.status === 'pending';
  useEffect(() => {
    if (waitingForDecision) setActivityAnnouncement('Agent is waiting for your decision.');
  }, [waitingForDecision]);
  const latestAssistant = [...selected.messages].reverse().find((message) => message.role === 'assistant');
  const goToActivity = () => {
    const target = waitingForDecision ? document.querySelector<HTMLElement>('[data-agent-decision="true"]') : latestAssistant ? document.getElementById(`agent-message-${latestAssistant.id}`) : null;
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const change = (event: MediaQueryListEvent) => {
      setCompactLayout(event.matches);
      if (event.matches) { setRailCollapsed(true); setInspectorCollapsed(true); }
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!actionsOpen) return;
    const close = (event: MouseEvent) => { if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setActionsOpen(false);
      actionsTriggerRef.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    requestAnimationFrame(() => actionsRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [actionsOpen]);
  const resizeRail = useCallback((size: number) => { setRailWidth(size); setResizeAnnouncement(`Sessions rail width ${size} pixels`); }, []);
  const resizeInspector = useCallback((size: number) => { setInspectorWidth(size); setResizeAnnouncement(`Inspector width ${size} pixels`); }, []);
  const toggleRail = () => {
    setRailCollapsed((value) => {
      if (compactLayout && value) setInspectorCollapsed(true);
      return !value;
    });
  };
  const toggleInspector = () => {
    setInspectorCollapsed((value) => {
      if (compactLayout && value) setRailCollapsed(true);
      return !value;
    });
  };
  const moveActionsFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')];
    if (!items.length) return;
    event.preventDefault();
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <section className="agents-workspace" aria-label="Agents workspace" style={{
      '--rail-width': railCollapsed ? '48px' : `${railWidth}px`,
      '--inspector-resizer-width': inspectorCollapsed ? '0px' : '8px',
      '--inspector-width': inspectorCollapsed ? 'var(--collapsed-inspector-width)' : `${inspectorWidth}px`,
    } as React.CSSProperties} data-od-id="agents-workspace">
      <SessionRail collapsed={railCollapsed} onToggle={toggleRail} selectedProject={selectedProject} onSelectProject={setSelectedProject} />
      {!railCollapsed && <Splitter orientation="vertical" storageKey="layout.agents.rail" min={228} max={380} defaultSize={280} onResize={resizeRail} ariaLabel="Resize Agents rail" className="rail-resize" testId="rail-resizer" />}
      <section className="conversation-pane" aria-label={selectedProject ? 'Selected agent project' : 'Active agent session'} data-od-id="active-agent-session">
        {selectedProject ? <div className="agent-project-empty" role="status" data-testid="selected-agent-project"><Icon name="worktree" size={28} /><h1>{selectedProject.name}</h1><p className="rail-project-path">{selectedProject.cwd}</p><p>No session selected. Use New session in the Agents rail to start here.</p><button className="secondary-button" type="button" onClick={() => setSelectedProject(null)}>Back to sessions</button></div> : <>
        <header className="session-header">
          <div className="session-identity">
            <ProfileAvatar profile={profile} />
            <div className="session-title-copy">
              {readOnlyChild && <button className="child-breadcrumb" type="button" onClick={backToParent} aria-label={`Back to parent session ${parent ? parent.name : selected.name}`} data-testid="child-back"><Icon name="chevronRight" className="rotate-180" size={12} />{parent ? parent.name : selected.name}</button>}
              <div className="identity-line"><strong>{profile.label}</strong>{selected.account && <button type="button" onClick={() => setSessionSettings(true)}>{selected.account}<Icon name="chevronDown" size={11} /></button>}<span className={`status-label ${presentation.tone}`}><i />{presentation.label}</span></div>
              <h1>{liveChildView ? liveChildView.title : selected.name}</h1>
              <div className="session-meta"><span><Icon name="branch" size={13} />{selected.branch}</span>{selected.dirtyCount > 0 && <span className="dirty-badge">{selected.dirtyCount} changed</span>}{selected.isolateWorktree && <span className="worktree-badge"><Icon name="worktree" size={12} />worktree</span>}{readOnlyChild && <span className="readonly-badge">Read only</span>}<span className="session-connection" aria-live="polite" data-testid="connection-status"><i className={`status-dot ${connectionMessage.toLowerCase().includes('offline') || connectionMessage.toLowerCase().includes('unavailable') ? 'offline' : 'working'}`} />{connectionMessage}</span></div>
              {resumeGone && resumeGone.id === selected.id && <div className="form-error" role="alert" data-testid="resume-gone-alert"><p>{resumeGone.message}</p><button className="secondary-button" type="button" disabled={lifecycleBusy} onClick={async () => { setLifecycleBusy(true); try { await startFreshSession(selected.id); } finally { setLifecycleBusy(false); } }}>Start fresh</button></div>}
            </div>
          </div>
          <div className="session-header-actions">
            {(waitingForDecision || latestAssistant) && <button className="text-button compact" type="button" onClick={goToActivity} data-testid="agent-go-to-activity">{waitingForDecision ? 'Go to decision' : 'Go to latest response'}</button>}
            <span className="session-cost" title="Total session cost">${selected.cost.toFixed(3)}</span>
            {recoverableConnection && <button className="secondary-button compact" type="button" disabled={retrying} onClick={() => void retryConnection()} data-testid="session-retry"><Icon name="refresh" className={retrying ? 'spin' : ''} size={14} />{retrying ? 'Retrying' : 'Reconnect'}</button>}
            <button className="icon-button small" type="button" disabled={lifecycleDisabled} onClick={() => void compactSession()} aria-label="Compact session" title="Compact session" data-testid="session-compact"><Icon name="spark" size={15} /></button>
            <button className="secondary-button prepare-button" type="button" disabled={lifecycleDisabled} onClick={() => setPrepareOpen(true)} data-testid="prepare-project" aria-label="Prepare project for agents" title="Prepare project for agents"><Icon name="worktree" size={14} /><span>Prepare project</span></button>
            <div className="menu-anchor" ref={actionsRef}><button ref={actionsTriggerRef} className="icon-button small" type="button" aria-label="Session actions" aria-haspopup="menu" aria-expanded={actionsOpen} onClick={() => setActionsOpen((value) => !value)} data-testid="session-actions"><Icon name="more" size={16} /></button>{actionsOpen && <div className="menu-popover session-actions-menu" role="menu" aria-label="Session actions" onKeyDown={moveActionsFocus}><button role="menuitem" type="button" className="menu-item" onClick={() => { setActionsOpen(false); setSessionSettings(true); }} data-testid="session-actions-settings"><Icon name="rename" size={14} />Agent, model and session settings</button><button role="menuitemcheckbox" aria-checked={selected.fastMode} type="button" className="menu-item" onClick={() => { updateSession(selected.id, { fastMode: !selected.fastMode }); setActionsOpen(false); }} data-testid="session-actions-fast"><Icon name="activity" size={14} />{selected.fastMode ? 'Disable Fast mode' : 'Enable Fast mode'}</button><button role="menuitem" type="button" className="menu-item" disabled={lifecycleDisabled} onClick={() => { void compactSession(); setActionsOpen(false); }} data-testid="session-actions-compact"><Icon name="spark" size={14} />Compact session</button><button role="menuitem" type="button" className="menu-item" disabled={lifecycleDisabled} onClick={() => { setActionsOpen(false); setPrepareOpen(true); }} data-testid="session-actions-prepare"><Icon name="worktree" size={14} />Prepare project for agents</button><button role="menuitem" type="button" className="menu-item" disabled={live && (!selected.id || readOnlyChild)} onClick={() => { archiveSession(selected.id); setActionsOpen(false); }}><Icon name="archive" size={14} />Archive session</button><button role="menuitem" type="button" className="menu-item" onClick={() => { notify('Session view closed; selection remains in the rail'); setActionsOpen(false); }}><Icon name="close" size={14} />Close session view</button></div>}</div>
          </div>
        </header>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="agent-activity-status">{activityAnnouncement}</span>
        <div className="transcript-reader"><Transcript /></div>
        {!liveChildView && <Composer />}
        </>}
      </section>
      {!inspectorCollapsed && <Splitter orientation="vertical" storageKey="layout.agents.inspector" min={286} max={470} defaultSize={336} onResize={resizeInspector} ariaLabel="Resize Inspector" resizeEdge="end" className="inspector-resize" testId="inspector-resizer" />}
      {selectedProject ? <aside className={`inspector${inspectorCollapsed ? ' collapsed' : ''}`} aria-label="Project context" /> : <Inspector collapsed={inspectorCollapsed} onToggle={toggleInspector} />}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="panel-resize-status">{resizeAnnouncement}</span>

      <FocusDialog open={sessionSettings} onClose={() => setSessionSettings(false)} title="Session settings" description="Update the fields supported by PATCH /agent-sessions/:id." testId="session-settings-dialog" wide>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); if (savingSettings) return;
          const data = new FormData(event.currentTarget);
          if (!live) { updateFixtureSession(selected.id, { name: String(data.get('name')), profileId: String(data.get('profile')), model: String(data.get('model')), thinkingBudget: String(data.get('thinking')), permissionMode: String(data.get('permission')), fastMode: data.get('fast') === 'on' }); setSessionSettings(false); notify('Session settings applied'); return; }
          const key = String(data.get('model')); const model = models.find(m => `${m.providerId}/${m.modelId}` === key);
          const account = String(data.get('account') ?? '');
          setSavingSettings(true); setSettingsError('');
          void saveSessionSettings(selected.id, { name: String(data.get('name')).trim(), profileId: String(data.get('profile')) || null, ...(model ? { providerId: model.providerId, modelId: model.modelId } : key === '' ? { providerId: null, modelId: null } : {}), thinkingBudget: data.get('thinking') === '' ? null : Number(data.get('thinking')), permissionMode: String(data.get('permission')), fastMode: data.get('fast') === 'on', ...(account && account !== selected.account ? { anthropicAccountId: account } : {}) })
            .then(() => { setSessionSettings(false); notify('Session settings saved and read back'); })
            .catch(error => setSettingsError(error instanceof Error ? error.message : 'Session settings failed'))
            .finally(() => setSavingSettings(false));
        }}>
          {settingsError && <p className="span-2" role="alert">{settingsError}</p>}
          <label className="field span-2">Session name<input name="name" required defaultValue={selected.name} /></label>
          <label className="field">Agent<select name="profile" defaultValue={selected.profileId}><option value="">Session default</option>{profiles.filter((item) => item.enabled && item.selectable && (!live || !item.id.startsWith('profile-created-'))).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label className="field">Model<select name="model" defaultValue={live ? selected.providerId && selected.modelId ? `${selected.providerId}/${selected.modelId}` : '' : selected.model}>{live ? <><option value="">Profile default</option>{selected.providerId && selected.modelId && !models.some(m => m.providerId === selected.providerId && m.modelId === selected.modelId) && <option value={`${selected.providerId}/${selected.modelId}`}>{selected.modelId} (unavailable; retain)</option>}{models.map(m => <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>{m.label} · {m.providerId}</option>)}</> : <><option>gpt-5.6</option><option>gpt-5.6-codex</option><option>claude-sonnet-4</option></>}</select></label>
          <label className="field">Reasoning{live ? <><input type="number" min="0" step="1" name="thinking" defaultValue={selected.thinkingBudget} /><span>Token budget; blank uses the default.</span></> : <select name="thinking" defaultValue={selected.thinkingBudget}><option>Off</option><option>Low</option><option>Medium</option><option>High</option><option>X-High</option><option>Max</option></select>}</label>
          <label className="field">Permissions<select name="permission" defaultValue={selected.permissionMode}>{live ? <><option value="default">Default</option><option value="acceptEdits">Accept Edits</option><option value="plan">Plan</option><option value="bypassPermissions">Bypass permissions (trusted workspaces only)</option></> : <><option>Default</option><option>Accept Edits</option><option>Plan</option><option>Bypass</option></>}</select></label>
          {live && <label className="field">Anthropic account<select name="account" defaultValue={selected.account ?? ''}><option value="">Keep current account</option>{selected.account && !accounts.some(a => a.id === selected.account) && <option value={selected.account}>{selected.account} (unavailable; retain)</option>}{accounts.map(a => <option value={a.id} key={a.id} disabled={!!a.status && a.status !== 'ok'}>{a.label} · {a.id}</option>)}</select></label>}
          <label className="check-label"><input name="fast" type="checkbox" defaultChecked={selected.fastMode} />Fast mode</label>
          <footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setSessionSettings(false)}>Cancel</button><button className="primary-button" type="submit" disabled={savingSettings || live && (!selected.id || readOnlyChild)} data-testid="save-session-settings">{savingSettings ? 'Saving…' : 'Save settings'}</button></footer>
        </form>
      </FocusDialog>
      <FocusDialog open={prepareOpen} onClose={() => setPrepareOpen(false)} title="Prepare project for agents" description="Initialize project instructions through POST /agent-sessions/:id/init." testId="prepare-project-dialog">{live ? <p>The configured model will inspect this project and write instructions. This can use provider tokens and modify AGENTS.md.</p> : <div className="prepare-list"><span><Icon name="check" />Git repository available</span><span><Icon name="check" />Worktree can be isolated</span><span><Icon name="check" />AGENTS.md discovered</span></div>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setPrepareOpen(false)}>Cancel</button><button className="primary-button" type="button" disabled={lifecycleDisabled} onClick={() => void prepareProject()} data-testid="confirm-prepare-project">{lifecycleBusy ? 'Preparing…' : 'Prepare project'}</button></div></FocusDialog>
    </section>
  );
}
