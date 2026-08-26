import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { isSessionOffline, sessionPresentation } from '../sessionState';
import { emptyLiveProfile, useFixtures } from '../store';
import { Composer } from './Composer';
import { FocusDialog } from './FocusDialog';
import { Inspector } from './Inspector';
import { profileAvatarLabel } from './Profiles';
import { SessionRail } from './SessionRail';
import { Transcript } from './Transcript';

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

export function AgentsWorkspace() {
  const { selected, sessions, profiles, connectionMessage, updateSession, archiveSession, resumeSession, selectSession, notify, resumeGone, dismissResumeGone, liveChildView, closeLiveChildView } = useFixtures();
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [railWidth, setRailWidth] = useState(280);
  const [inspectorWidth, setInspectorWidth] = useState(336);
  const [railCollapsed, setRailCollapsed] = useState(compactLayout);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(compactLayout);
  const [sessionSettings, setSessionSettings] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [resizeAnnouncement, setResizeAnnouncement] = useState('');
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  // ponytail: a real workspace with zero configured agent profiles is a legitimate live state
  // (fresh install, all profiles deleted) — fall back to a placeholder instead of crashing on
  // undefined.icon/.label when `profiles` resolves empty.
  const profile = profiles.find((item) => item.id === selected.profileId) ?? profiles[0] ?? emptyLiveProfile();
  const parentId = selected.parentId ?? selected.parentSessionId;
  const parent = parentId ? sessions.find((session) => session.id === parentId) : undefined;
  const readOnlyChild = Boolean(parent) || Boolean(liveChildView);
  const backToParent = () => { if (liveChildView) closeLiveChildView(); else if (parent) selectSession(parent.id); };
  const presentation = sessionPresentation(selected);
  const recoverableConnection = isSessionOffline(selected) || selected.connectionState === 'unavailable' || Boolean(selected.stuckSince);

  useEffect(() => { setRetrying(false); setActionsOpen(false); }, [selected.id]);
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
  const startResize = (side: 'rail' | 'inspector') => (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const start = side === 'rail' ? railWidth : inspectorWidth;
    const move = (pointer: PointerEvent) => side === 'rail' ? setRailWidth(clamp(start + pointer.clientX - startX, 228, 380)) : setInspectorWidth(clamp(start - pointer.clientX + startX, 286, 470));
    const stop = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); notify(`${side === 'rail' ? 'Sessions rail' : 'Inspector'} resized`); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
  };
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
  const resizeWithKeys = (side: 'rail' | 'inspector') => (event: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') {
      if (side === 'rail') { setRailWidth(228); setResizeAnnouncement('Sessions rail width 228 pixels'); }
      else { setInspectorWidth(286); setResizeAnnouncement('Inspector width 286 pixels'); }
      return;
    }
    if (event.key === 'End') {
      if (side === 'rail') { setRailWidth(380); setResizeAnnouncement('Sessions rail width 380 pixels'); }
      else { setInspectorWidth(470); setResizeAnnouncement('Inspector width 470 pixels'); }
      return;
    }
    const rtl = document.documentElement.dir === 'rtl';
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const delta = direction * (rtl ? -1 : 1) * 12;
    if (side === 'rail') setRailWidth((value) => { const next = clamp(value + delta, 228, 380); setResizeAnnouncement(`Sessions rail width ${next} pixels`); return next; });
    else setInspectorWidth((value) => { const next = clamp(value - delta, 286, 470); setResizeAnnouncement(`Inspector width ${next} pixels`); return next; });
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
      '--inspector-resizer-width': inspectorCollapsed ? '0px' : '5px',
      '--inspector-width': inspectorCollapsed ? 'var(--collapsed-inspector-width)' : `${inspectorWidth}px`,
    } as React.CSSProperties} data-od-id="agents-workspace">
      <SessionRail collapsed={railCollapsed} onToggle={toggleRail} />
      {!railCollapsed && <div className="resize-handle rail-resize" role="separator" aria-orientation="vertical" aria-label="Resize Agents rail" aria-valuemin={228} aria-valuemax={380} aria-valuenow={railWidth} aria-valuetext={`${railWidth} pixels`} tabIndex={0} onPointerDown={startResize('rail')} onKeyDown={resizeWithKeys('rail')} data-testid="rail-resizer" />}
      <section className="conversation-pane" aria-label="Active agent session" data-od-id="active-agent-session">
        <header className="session-header">
          <div className="session-identity">
            <span className="profile-avatar" aria-label={`${profile.label} icon`}>{profileAvatarLabel(profile)}</span>
            <div className="session-title-copy">
              {readOnlyChild && <button className="child-breadcrumb" type="button" onClick={backToParent} aria-label={`Back to parent session ${parent ? parent.name : selected.name}`} data-testid="child-back"><Icon name="chevronRight" className="rotate-180" size={12} />{parent ? parent.name : selected.name}</button>}
              <div className="identity-line"><strong>{profile.label}</strong>{selected.account && <button type="button" onClick={() => setSessionSettings(true)}>{selected.account}<Icon name="chevronDown" size={11} /></button>}<span className={`status-label ${presentation.tone}`}><i />{presentation.label}</span></div>
              <h1>{liveChildView ? liveChildView.title : selected.name}</h1>
              <div className="session-meta"><span><Icon name="branch" size={13} />{selected.branch}</span>{selected.dirtyCount > 0 && <span className="dirty-badge">{selected.dirtyCount} changed</span>}{selected.isolateWorktree && <span className="worktree-badge"><Icon name="worktree" size={12} />worktree</span>}{readOnlyChild && <span className="readonly-badge">Read only</span>}<span className="session-connection" aria-live="polite" data-testid="connection-status"><i className={`status-dot ${connectionMessage.toLowerCase().includes('offline') || connectionMessage.toLowerCase().includes('unavailable') ? 'offline' : 'working'}`} />{connectionMessage}</span></div>
              {resumeGone && resumeGone.id === selected.id && <div className="form-error" role="alert" data-testid="resume-gone-alert"><p>{resumeGone.message}</p><button className="secondary-button" type="button" onClick={dismissResumeGone}>Start fresh</button></div>}
            </div>
          </div>
          <div className="session-header-actions">
            <span className="session-cost" title="Total session cost">${selected.cost.toFixed(3)}</span>
            {recoverableConnection && <button className="secondary-button compact" type="button" onClick={() => { setRetrying(true); setTimeout(() => { setRetrying(false); resumeSession(selected.id); notify('Desktop connection restored'); }, 240); }} data-testid="session-retry"><Icon name="refresh" className={retrying ? 'spin' : ''} size={14} />{retrying ? 'Retrying' : 'Reconnect'}</button>}
            <button className="icon-button small" type="button" onClick={() => notify('Session context compacted')} aria-label="Compact session" title="Compact session" data-testid="session-compact"><Icon name="spark" size={15} /></button>
            <button className="secondary-button prepare-button" type="button" onClick={() => setPrepareOpen(true)} data-testid="prepare-project" aria-label="Prepare project for agents" title="Prepare project for agents"><Icon name="worktree" size={14} /><span>Prepare project</span></button>
            <div className="menu-anchor" ref={actionsRef}><button ref={actionsTriggerRef} className="icon-button small" type="button" aria-label="Session actions" aria-haspopup="menu" aria-expanded={actionsOpen} onClick={() => setActionsOpen((value) => !value)} data-testid="session-actions"><Icon name="more" size={16} /></button>{actionsOpen && <div className="menu-popover session-actions-menu" role="menu" aria-label="Session actions" onKeyDown={moveActionsFocus}><button role="menuitem" type="button" className="menu-item" onClick={() => { setActionsOpen(false); setSessionSettings(true); }} data-testid="session-actions-settings"><Icon name="rename" size={14} />Agent, model and session settings</button><button role="menuitemcheckbox" aria-checked={selected.fastMode} type="button" className="menu-item" onClick={() => { updateSession(selected.id, { fastMode: !selected.fastMode }); setActionsOpen(false); }} data-testid="session-actions-fast"><Icon name="activity" size={14} />{selected.fastMode ? 'Disable Fast mode' : 'Enable Fast mode'}</button><button role="menuitem" type="button" className="menu-item" onClick={() => { notify('Session context compacted'); setActionsOpen(false); }} data-testid="session-actions-compact"><Icon name="spark" size={14} />Compact session</button><button role="menuitem" type="button" className="menu-item" onClick={() => { setActionsOpen(false); setPrepareOpen(true); }} data-testid="session-actions-prepare"><Icon name="worktree" size={14} />Prepare project for agents</button><button role="menuitem" type="button" className="menu-item" onClick={() => { archiveSession(selected.id); setActionsOpen(false); }}><Icon name="archive" size={14} />Archive session</button><button role="menuitem" type="button" className="menu-item" onClick={() => { notify('Session view closed; selection remains in the rail'); setActionsOpen(false); }}><Icon name="close" size={14} />Close session view</button></div>}</div>
          </div>
        </header>
        <div className="transcript-scroll"><Transcript /></div>
        <Composer />
      </section>
      {!inspectorCollapsed && <div className="resize-handle inspector-resize" role="separator" aria-orientation="vertical" aria-label="Resize Inspector" aria-valuemin={286} aria-valuemax={470} aria-valuenow={inspectorWidth} aria-valuetext={`${inspectorWidth} pixels`} tabIndex={0} onPointerDown={startResize('inspector')} onKeyDown={resizeWithKeys('inspector')} data-testid="inspector-resizer" />}
      <Inspector collapsed={inspectorCollapsed} onToggle={toggleInspector} />
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="panel-resize-status">{resizeAnnouncement}</span>

      <FocusDialog open={sessionSettings} onClose={() => setSessionSettings(false)} title="Session settings" description="Update the fields supported by PATCH /agent-sessions/:id." testId="session-settings-dialog" wide>
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); updateSession(selected.id, { name: String(data.get('name')), model: String(data.get('model')), thinkingBudget: String(data.get('thinking')), permissionMode: String(data.get('permission')), fastMode: data.get('fast') === 'on' }); setSessionSettings(false); notify('Session settings applied'); }}>
          <label className="field span-2">Session name<input name="name" defaultValue={selected.name} /></label>
          <label className="field">Agent<select name="profile" defaultValue={selected.profileId}>{profiles.filter((item) => item.enabled).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label className="field">Model<select name="model" defaultValue={selected.model}><option>gpt-5.6</option><option>gpt-5.6-codex</option><option>claude-sonnet-4</option></select></label>
          <label className="field">Reasoning<select name="thinking" defaultValue={selected.thinkingBudget}><option>Off</option><option>Low</option><option>Medium</option><option>High</option><option>X-High</option><option>Max</option></select></label>
          <label className="field">Permissions<select name="permission" defaultValue={selected.permissionMode}><option>Default</option><option>Accept Edits</option><option>Plan</option><option>Bypass</option></select></label>
          <label className="check-label"><input name="fast" type="checkbox" defaultChecked={selected.fastMode} />Fast mode</label>
          <footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setSessionSettings(false)}>Cancel</button><button className="primary-button" type="submit" data-testid="save-session-settings">Save settings</button></footer>
        </form>
      </FocusDialog>
      <FocusDialog open={prepareOpen} onClose={() => setPrepareOpen(false)} title="Prepare project for agents" description="Initialize project instructions through POST /agent-sessions/:id/init." testId="prepare-project-dialog"><div className="prepare-list"><span><Icon name="check" />Git repository available</span><span><Icon name="check" />Worktree can be isolated</span><span><Icon name="check" />AGENTS.md discovered</span></div><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setPrepareOpen(false)}>Cancel</button><button className="primary-button" type="button" onClick={() => { setPrepareOpen(false); notify('Project prepared for agents'); }} data-testid="confirm-prepare-project">Prepare project</button></div></FocusDialog>
    </section>
  );
}
