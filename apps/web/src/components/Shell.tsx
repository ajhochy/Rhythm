import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { useFixtures } from '../store';
import type { DemoState } from '../types';
import { hermesShell } from '../pages/hermes/bridge';
import { colonyShell } from '../pages/colony/bridge';
import { AGENT_TOOL_DESCRIPTORS, type AgentToolDescriptor } from '../agentTools/registry';
import { readAgentToolPins, subscribeAgentToolPins } from '../agentTools/pins';
import { availableAgentToolIds } from '../agentTools/hosts';
import { useAuthUser } from '../gateway/auth';
import type { PendingApproval } from '../gateway/approvals';
import { Splitter } from './Splitter';

type OverlayRect = { height: number; left: number; top: number; width: number };

const nativeMenuFallbackWidths: Record<string, number> = {
  account: 294,
  notifications: 384,
  activity: 294,
  more: 294,
};

const destinations = ['Dashboard', 'Planner', 'Tasks', 'Rhythms', 'Projects', 'Messages', 'Facilities', 'Automations', 'Integrations', 'Agents', 'Settings'];
const optional = new Set(['Facilities', 'Automations', 'Integrations', 'Settings', 'Hermes', 'Bot Crossing', 'OpenDesign', 'Dayflow']);
const toolByLabel = new Map<string, AgentToolDescriptor>(AGENT_TOOL_DESCRIPTORS.map((tool) => [tool.label, tool]));
// Keeps the existing nav-hermes / nav-colony test IDs.
const toolNavKey = (tool: AgentToolDescriptor) => tool.id === 'bot-crossing' ? 'colony' : tool.id;

const destinationKey = (destination: string) => destination === 'Bot Crossing' ? 'colony' : destination.toLowerCase();

type TaskCreatePreview = { dueDate: string | null; notes: string | null; title: string | null };

function taskCreatePreview(action: string, preview: string | null): TaskCreatePreview | null {
  const prefix = 'task.create: ';
  if (action !== 'Authorize task.create' || !preview?.startsWith(prefix)) return null;
  try {
    const payload: unknown = JSON.parse(preview.slice(prefix.length));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const fields = payload as Record<string, unknown>;
    const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
    const task = { dueDate: text(fields.due_date), notes: text(fields.notes), title: text(fields.title) };
    return task.dueDate || task.notes || task.title ? task : null;
  } catch {
    return null;
  }
}

function ApprovalCard({ approval, deciding, onDecide }: { approval: PendingApproval; deciding: boolean; onDecide(id: string, status: 'approved' | 'rejected'): void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const task = taskCreatePreview(approval.action, approval.preview);
  const title = task?.title ?? approval.action;
  const summary = task ? task.notes : approval.preview;
  const detailsId = `approval-details-${approval.id}`;
  const disabled = !approval.decisionNonce || deciding;
  return (
    <div className="menu-item stacked approval-card" data-testid={`approval-card-${approval.id}`}>
      <div className="approval-heading">
        <strong className="approval-title">{title}</strong>
        <div className="approval-actions">
          <button type="button" role="menuitem" className="approval-action approve" aria-label="Approve" title="Approve" disabled={disabled} data-menu-keep-open onClick={() => onDecide(approval.id, 'approved')}><Icon name="check" size={14} /></button>
          <button type="button" role="menuitem" className="approval-action reject" aria-label="Reject" title="Reject" disabled={disabled} data-menu-keep-open onClick={() => onDecide(approval.id, 'rejected')}><Icon name="close" size={14} /></button>
        </div>
      </div>
      <div className="approval-meta"><small>Action: {approval.action}</small>{task?.dueDate && <small>Due: {task.dueDate}</small>}</div>
      {summary && <p className="approval-preview">{summary}</p>}
      {approval.consequence && <small className="approval-consequence">{approval.consequence}</small>}
      {approval.preview && <>
        <button type="button" role="menuitem" className="approval-details-toggle" aria-expanded={detailsOpen} aria-controls={detailsId} data-menu-keep-open onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? 'Hide details' : 'Show details'}</button>
        <div id={detailsId} className="approval-details" hidden={!detailsOpen}>{detailsOpen && <pre>{approval.preview}</pre>}</div>
      </>}
      {!approval.decisionNonce && <small>This legacy approval cannot be signed. Ask the agent to request approval again.</small>}
    </div>
  );
}

function moveMenuFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')];
  if (!items.length) return;
  event.preventDefault();
  const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}

function Menu({ label, icon, children, testId, menuId, onOpenChange, onPopoverLayout, className = '', popoverClassName = '', triggerClassName, triggerContent, account = false }: { label: string; icon: IconName; children: React.ReactNode; testId: string; menuId: string; onOpenChange(menuId: string, open: boolean): void; onPopoverLayout(menuId: string, rect: OverlayRect | null): void; className?: string; popoverClassName?: string; triggerClassName?: string; triggerContent?: React.ReactNode; account?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) closeMenu(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')?.focus());
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  useEffect(() => {
    onOpenChange(menuId, open);
    return () => { if (open) onOpenChange(menuId, false); };
  }, [menuId, onOpenChange, open]);
  useLayoutEffect(() => {
    if (!open) { onPopoverLayout(menuId, null); return; }
    const popover = ref.current?.querySelector<HTMLElement>('.menu-popover');
    if (!popover) return;
    const report = () => {
      const rect = popover.getBoundingClientRect();
      onPopoverLayout(menuId, { height: rect.height, left: rect.left, top: rect.top, width: rect.width });
    };
    const observer = new ResizeObserver(report);
    observer.observe(popover);
    window.addEventListener('resize', report);
    report();
    return () => { observer.disconnect(); window.removeEventListener('resize', report); onPopoverLayout(menuId, null); };
  }, [menuId, onPopoverLayout, open]);
  return (
    <div className={`menu-anchor ${className}`} ref={ref} data-native-overlay-kind={menuId} data-native-overlay-open={open || undefined}>
      <button ref={trigger} className={triggerClassName ?? (account ? 'profile-control' : 'icon-button header-control')} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => open ? closeMenu() : setOpen(true)} data-testid={testId}>
        {triggerContent ?? (account ? <><span className="avatar">AJ</span><span className="account-copy"><strong>AJ Hochhalter</strong><small>Rhythm workspace</small></span><Icon name="chevronDown" size={14} /></> : <Icon name={icon} />)}
      </button>
      {open && <div className={`menu-popover ${popoverClassName}`} role="menu" aria-label={label} onKeyDown={moveMenuFocus} onClick={(event) => { const button = (event.target as HTMLElement).closest('button'); if (button && !button.hasAttribute('data-menu-keep-open')) closeMenu(); }}>{children}</div>}
    </div>
  );
}

const demoLabels: Record<DemoState, string> = {
  running: 'Working session',
  permission: 'Permission request',
  question: 'Agent question',
  offline: 'Desktop offline',
  completed: 'Completed + artifacts',
  connecting: 'Connecting',
  retrying: 'Retrying connection',
  resumable: 'Unavailable · resumable',
  empty: 'Empty state',
  loading: 'Loading state',
  error: 'Service error',
  'no-provider': 'Choose a model',
};

export function Shell({ route, children }: { route: string; children: React.ReactNode }) {
  const pinScope = useAuthUser()?.user.id;
  const [pins, setPins] = useState(() => readAgentToolPins(pinScope));
  useEffect(() => {
    const refresh = () => setPins(readAgentToolPins(pinScope));
    refresh();
    return subscribeAgentToolPins(pinScope, refresh);
  }, [pinScope]);
  const pinnedIds = (pins.scope === pinScope ? pins : readAgentToolPins(pinScope)).ids;
  const hostIds = availableAgentToolIds();
  // Existing Hermes/Bot Crossing defaults stay visible through the same
  // owner-scoped pin contract. The permanent Rhythm conversation is not a
  // descriptor and therefore cannot be pinned or removed here.
  const visibleDestinations = [
    ...destinations,
    ...AGENT_TOOL_DESCRIPTORS
      .filter((tool) => hostIds.includes(tool.id) && pinnedIds.includes(tool.id))
      .map((tool) => tool.label),
  ];
  const { theme, setTheme, demo, setDemo, toast, resetFixtures, notify, unreadThreads, sessionGatewayMode, notifications, pushNotifications, notificationUnreadCount, markNotificationRead, markAllNotificationsRead, pendingApprovals, approvalError, approvalsLoading, approvalsUpdatedAt, decidingApprovalIds, refreshPendingApprovals, decideApproval } = useFixtures();
  const live = sessionGatewayMode === 'live';
  const entityDestination = (entityType: string, entityId: string) => ({
    task: `/tasks/task/${encodeURIComponent(entityId)}`,
    rhythm: `/rhythms/rule/${encodeURIComponent(entityId)}`,
    project: `/projects/instances/${encodeURIComponent(entityId)}`,
  })[entityType] ?? '/agents';
  const openDomainNotification = (id: number, entityType: string, entityId: string) => {
    markNotificationRead(id);
    navigate(entityDestination(entityType, entityId));
  };
  const openPushNotification = () => navigate('/agents');
  const [demoOpen, setDemoOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastReserve, setToastReserve] = useState(false);
  const [openMenus, setOpenMenus] = useState<Record<string, OverlayRect | true>>({});
  const [toastRect, setToastRect] = useState<OverlayRect | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const [navTier, setNavTier] = useState(() => window.matchMedia('(max-width: 900px)').matches ? 2 : window.matchMedia('(max-width: 1320px)').matches ? 1 : 0);
  const [navigationHeight, setNavigationHeight] = useState(48);
  const activeKey = route.startsWith('/profiles') || route.startsWith('/endpoint-map') || route.startsWith('/tools/') ? 'agents' : route.split('/')[1] || 'agents';
  const activeLabel = activeKey.charAt(0).toUpperCase() + activeKey.slice(1);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const compact = window.matchMedia('(max-width: 900px)');
    const overflow = window.matchMedia('(max-width: 1320px)');
    const change = () => setNavTier(compact.matches ? 2 : overflow.matches ? 1 : 0);
    compact.addEventListener('change', change);
    overflow.addEventListener('change', change);
    return () => { compact.removeEventListener('change', change); overflow.removeEventListener('change', change); };
  }, []);
  useEffect(() => {
    if (toast.id === 0) return;
    setToastVisible(true);
    setToastReserve(true);
    const hideTimer = window.setTimeout(() => setToastVisible(false), 3_000);
    return () => window.clearTimeout(hideTimer);
  }, [toast.id]);
  useEffect(() => {
    if (toastVisible || !toastReserve) return;
    const toastNode = toastRef.current;
    const release = () => setToastReserve(false);
    const transitionEnd = (event: TransitionEvent) => { if (event.propertyName === 'transform') release(); };
    toastNode?.addEventListener('transitionend', transitionEnd);
    // A reduced-motion preference or a cancelled transition does not emit an
    // event; retain the measured band for the normal exit duration in either case.
    const fallback = window.setTimeout(release, 220);
    return () => { toastNode?.removeEventListener('transitionend', transitionEnd); window.clearTimeout(fallback); };
  }, [toastReserve, toastVisible]);
  useEffect(() => {
    if (live) return;
    const queryDemo = new URLSearchParams(window.location.hash.split('?')[1] || '').get('demo') as DemoState | null;
    if (queryDemo && Object.hasOwn(demoLabels, queryDemo)) setDemo(queryDemo);
  }, []);

  const onMenuOpenChange = useCallback((menuId: string, open: boolean) => {
    setOpenMenus((current) => {
      if (Boolean(current[menuId]) === open) return current;
      const next = { ...current };
      if (open) next[menuId] = current[menuId] ?? true;
      else delete next[menuId];
      return next;
    });
  }, []);
  const onPopoverLayout = useCallback((menuId: string, rect: OverlayRect | null) => {
    setOpenMenus((current) => {
      if (!rect) {
        if (!current[menuId]) return current;
        const next = { ...current };
        delete next[menuId];
        return next;
      }
      const previous = current[menuId];
      if (previous !== true && previous && previous.left === rect.left && previous.top === rect.top && previous.width === rect.width && previous.height === rect.height) return current;
      return { ...current, [menuId]: rect };
    });
  }, []);
  useLayoutEffect(() => {
    if (!toastReserve) { setToastRect(null); return; }
    // Keep the visible toast geometry through the outgoing transform; reading
    // the translated-offscreen rect here would release the native footer band
    // before the toast has actually left it.
    if (!toastVisible) return;
    const toastNode = toastRef.current;
    if (!toastNode) return;
    const report = () => {
      const rect = toastNode.getBoundingClientRect();
      // ResizeObserver does not report transform animation frames. Measure the
      // wrapped box, then derive its final fixed-position top from `bottom` so
      // the native footer band exists before the enter translate reaches it.
      const bottom = Number.parseFloat(window.getComputedStyle(toastNode).bottom);
      const top = window.innerHeight - (Number.isFinite(bottom) ? bottom : 0) - rect.height;
      setToastRect((previous) => previous && previous.left === rect.left && previous.top === top && previous.width === rect.width && previous.height === rect.height ? previous : { height: rect.height, left: rect.left, top, width: rect.width });
    };
    const observer = new ResizeObserver(report);
    observer.observe(toastNode);
    window.addEventListener('resize', report);
    report();
    return () => { observer.disconnect(); window.removeEventListener('resize', report); };
  }, [toastReserve, toastVisible]);
  const nativeRoute = route === '/hermes' || route === '/colony' || route === '/open-design';
  const menuEntries = Object.entries(openMenus);
  const widestMenu = Math.max(0, ...menuEntries.map(([menuId, value]) => value === true ? nativeMenuFallbackWidths[menuId] ?? 270 : value.width));
  const stackedOverlay = nativeRoute && menuEntries.length > 0 && window.innerWidth < widestMenu + 300;
  const sideReserve = stackedOverlay ? 0 : Math.max(0, ...menuEntries.map(([menuId, value]) => value === true ? (nativeMenuFallbackWidths[menuId] ?? 270) + 24 : window.innerWidth - value.left + 12));
  const topReserve = stackedOverlay ? Math.max(0, ...menuEntries.map(([, value]) => value === true ? 260 : value.height + 18)) : 0;
  const footerReserve = toastReserve && toastRect ? Math.max(0, window.innerHeight - toastRect.top + 12) : 0;

  const destinationButton = (destination: string, inMenu = false) => {
    const tool = toolByLabel.get(destination);
    const key = tool ? toolNavKey(tool) : destinationKey(destination);
    const selected = tool
      ? route === tool.route
      : key === activeKey && !visibleDestinations.some((item) => toolByLabel.get(item)?.route === route);
    return (
      <button key={destination} type="button" role={inMenu ? 'menuitem' : undefined} className={inMenu ? 'menu-item' : `destination ${optional.has(destination) ? 'nav-optional' : ''} ${!['Dashboard', 'Agents'].includes(destination) ? 'nav-compact' : ''} ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => navigate(tool ? tool.route : `/${key}`)} data-testid={`nav-${key}${inMenu ? '-overflow' : ''}`}>
        {destination}{destination === 'Messages' && unreadThreads > 0 && <span className="unread-badge" aria-label={`${unreadThreads} unread`}>{unreadThreads}</span>}
      </button>
    );
  };

  return (
    <div className={`app-canvas ${nativeRoute ? 'native-overlay-route' : ''}`} style={{ '--app-navigation-height': `${navigationHeight}px`, '--native-overlay-side': `${sideReserve}px`, '--native-overlay-top': `${topReserve}px`, '--native-overlay-footer': `${footerReserve}px` } as React.CSSProperties} data-native-overlay-active={menuEntries.length > 0 || toastReserve || undefined} data-native-overlay-flow={stackedOverlay ? 'stacked' : undefined} data-od-id="agents-app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to main content</a>
      <header className="app-header" data-od-id="rhythm-global-header">
        <nav className="destination-nav" aria-label="Product destinations">
          {visibleDestinations.map((destination) => destinationButton(destination))}
          <Menu key={`${route}:${navTier}:more`} label="More destinations" icon="chevronDown" testId="nav-more" menuId="more" onOpenChange={onMenuOpenChange} onPopoverLayout={onPopoverLayout} className="more-nav" popoverClassName="nav-overflow" triggerClassName="destination" triggerContent={<>More <Icon name="chevronDown" size={14} /></>}>
            {(navTier === 2 ? visibleDestinations.filter((destination) => !['Dashboard', 'Agents'].includes(destination)) : [...optional].filter((destination) => visibleDestinations.includes(destination))).map((destination) => destinationButton(destination, true))}
          </Menu>
        </nav>
        <div className="global-actions">
          <Menu key={`${route}:activity`} label="Background activity" icon="activity" testId="background-activity-button" menuId="activity" onOpenChange={onMenuOpenChange} onPopoverLayout={onPopoverLayout}>
            {live ? <button className="menu-item" role="menuitem" type="button" onClick={() => navigate('/agents')}>View agent sessions</button> : <>
            <div className="menu-heading"><span>Background activity</span><small>2 sessions</small></div>
            <button className="activity-row" role="menuitem" type="button" onClick={() => { navigate('/agents'); setDemo('running'); notify('Volunteer coverage audit selected'); }}><span className="status-dot working" /><span><strong>Volunteer coverage audit</strong><small>Working · child agent</small></span></button>
            <button className="activity-row" role="menuitem" type="button" onClick={() => { navigate('/agents'); setDemo('resumable'); }}><span className="status-dot stuck" /><span><strong>Integration health sweep</strong><small>Unavailable · can resume</small></span></button>
            </>}
          </Menu>
          {live && <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="approval-queue-announcement">{pendingApprovals.length} pending approvals{approvalError ? '. Approval queue unavailable.' : ''}</span>}
          <Menu key={`${route}:notifications`} label={live ? `Notifications · ${pendingApprovals.length} pending approvals${approvalError ? ' · approval queue unavailable' : ''}` : 'Notifications'} icon="bell" testId="notifications-button" menuId="notifications" onOpenChange={onMenuOpenChange} onPopoverLayout={onPopoverLayout} popoverClassName="notifications-menu" triggerContent={live ? <><Icon name="bell" />{(pendingApprovals.length > 0 || approvalError) && <span className="unread-badge">{approvalError ? '!' : pendingApprovals.length}</span>}</> : undefined}>
            {live ? <>
              <div className="menu-heading"><span>Notifications</span><small>{notificationUnreadCount} unread</small></div>
              <button role="menuitem" className="menu-item" type="button" data-menu-keep-open onClick={() => void refreshPendingApprovals()}>Refresh approvals</button>
              <div className="menu-item stacked" role="status" aria-live="polite" data-testid="approval-queue-status">{pendingApprovals.length} pending approvals · {approvalsLoading ? 'Refreshing…' : approvalError ? 'Approval queue needs attention; showing last known pending cards' : approvalsUpdatedAt ? `Updated ${new Date(approvalsUpdatedAt).toLocaleTimeString()}` : 'Not yet loaded'}</div>
              {approvalError && <div className="menu-item stacked" role="alert" data-testid="approval-queue-error">{approvalError} Retry with Refresh approvals. Rhythm approvals are in this outer queue, not embedded engine permissions.</div>}
              {!approvalError && !approvalsLoading && approvalsUpdatedAt && notifications.length === 0 && pushNotifications.length === 0 && pendingApprovals.length === 0 && <div className="menu-item stacked"><small>No notifications</small></div>}
              {/* post-m1-phase-7 c4d: pending approvals as actionable cards, not just a read-only row —
                  Approve/Reject attempt the real decide() boundary; see decideApproval's doc comment in
                  store.tsx for why that boundary is presently an honest rejection (no native signer yet). */}
              {pendingApprovals.map((approval) => <ApprovalCard key={`approval-${approval.id}`} approval={approval} deciding={decidingApprovalIds.includes(approval.id)} onDecide={(id, status) => void decideApproval(id, status)} />)}
              {notifications.map((item) => <button key={`domain-${item.id}`} role="menuitem" className="menu-item stacked" type="button" onClick={() => openDomainNotification(item.id, item.entityType, item.entityId)}><strong>{item.message}</strong><small>{item.type}</small></button>)}
              {pushNotifications.map((item) => <button key={`push-${item.id}`} role="menuitem" className="menu-item stacked" type="button" onClick={openPushNotification}><strong>{item.title}</strong><small>{item.body}</small></button>)}
              <button role="menuitem" className="menu-item stacked" type="button" onClick={markAllNotificationsRead}><strong>Mark all read</strong><small>Clears unread status</small></button>
            </> : <>
              <div className="menu-heading"><span>Notifications</span><small>2 unread</small></div>
              <button role="menuitem" className="menu-item stacked" type="button" onClick={() => { navigate('/agents'); setDemo('permission'); }}><strong>Permission needed</strong><small>Prepare release worktree</small></button>
              <button role="menuitem" className="menu-item stacked" type="button" onClick={() => notify('All notifications marked read')}><strong>Mark all read</strong><small>Clears unread status</small></button>
            </>}
          </Menu>
          <Menu key={`${route}:account`} label="Account and settings" icon="profile" testId="account-button" menuId="account" onOpenChange={onMenuOpenChange} onPopoverLayout={onPopoverLayout} className="account-menu" account>
            <div className="account-card"><span className="avatar">AJ</span><div><strong>AJ Hochhalter</strong><small>Rhythm workspace</small></div></div>
            <button className="menu-item" role="menuitem" type="button" onClick={() => navigate('/profiles')} data-testid="account-profiles"><Icon name="profile" size={15} />Profiles</button>
            <button className="menu-item" role="menuitem" type="button" onClick={() => navigate('/tools/agent-settings')}><Icon name="settings" size={15} />Agent settings</button>
            <div className="prototype-diagnostics" role="group" aria-label="Workspace diagnostics">
              <span className="menu-section-label">Workspace diagnostics</span>
              <button className="menu-item" role="menuitem" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} data-testid="theme-toggle"><Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />Switch to {theme === 'light' ? 'dark' : 'light'} theme</button>
              <button className="menu-item" role="menuitem" type="button" onClick={() => navigate('/endpoint-map')} data-testid="endpoint-map-button"><Icon name="endpoint" size={15} />Endpoint Map</button>
              {!live && <div className="diagnostics-demo">
                <button className="menu-item" role="menuitem" type="button" aria-haspopup="menu" aria-expanded={demoOpen} onClick={() => setDemoOpen((value) => !value)} data-menu-keep-open data-testid="demo-states-button"><Icon name="activity" size={15} />Demo states<Icon name="chevronRight" size={13} /></button>
                {demoOpen && <div className="menu-popover demo-menu" role="menu" aria-label="Demo states" onClick={() => setDemoOpen(false)}>{(Object.keys(demoLabels) as DemoState[]).map((state) => <button role="menuitemradio" aria-checked={demo === state} className="menu-item" type="button" key={state} onClick={() => { setDemo(state); const base = window.location.hash.split('?')[0] || '#/agents'; history.replaceState(null, '', `${base}?demo=${state}`); }} data-testid={`demo-${state}`}>{demo === state ? <Icon name="check" size={14} /> : <span className="menu-spacer" />}{demoLabels[state]}</button>)}<hr /><button role="menuitem" className="menu-item" type="button" onClick={() => { resetFixtures(); history.replaceState(null, '', '#/agents'); }} data-testid="fixture-reset"><Icon name="refresh" size={14} />Reset workspace</button></div>}
              </div>}
            </div>
          </Menu>
        </div>
      </header>
      <Splitter orientation="horizontal" storageKey="layout.shell.navigation" min={44} max={112} defaultSize={48} onResize={setNavigationHeight} ariaLabel="Resize app navigation" className="shell-navigation-splitter" testId="shell-navigation-resizer" />
      <section className="workspace-surface" aria-label={`${activeLabel} workspace`}>
        <main id="main-content" tabIndex={-1}>{children}</main>
      </section>
      <div ref={toastRef} className="toast" role="status" aria-live="polite" data-visible={toastVisible} data-testid="toast-status"><Icon name="check" size={15} /><span>{toast.message}</span></div>
    </div>
  );
}
