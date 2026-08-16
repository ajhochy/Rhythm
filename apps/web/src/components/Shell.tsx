import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { useFixtures } from '../store';
import type { DemoState } from '../types';

const destinations = ['Dashboard', 'Planner', 'Tasks', 'Rhythms', 'Projects', 'Messages', 'Facilities', 'Automations', 'Integrations', 'Agents'];
const optional = new Set(['Facilities', 'Automations', 'Integrations']);

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

function Menu({ label, icon, children, testId, className = '', popoverClassName = '', triggerClassName, triggerContent, account = false }: { label: string; icon: IconName; children: React.ReactNode; testId: string; className?: string; popoverClassName?: string; triggerClassName?: string; triggerContent?: React.ReactNode; account?: boolean }) {
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
  return (
    <div className={`menu-anchor ${className}`} ref={ref}>
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
  const { theme, setTheme, demo, setDemo, toast, resetFixtures, notify, unreadThreads, sessionGatewayMode, notifications, pushNotifications, notificationUnreadCount, markNotificationRead, markAllNotificationsRead } = useFixtures();
  const live = sessionGatewayMode === 'live';
  // c4b: entityType -> destination page. Deliberately a list route, not a deep per-entity view —
  // Rhythm's task/rhythm/project detail routes don't yet accept a hash target id to focus.
  const entityDestination: Record<string, string> = { task: '/tasks', rhythm: '/rhythms', project: '/projects' };
  const openDomainNotification = (id: number, entityType: string) => {
    markNotificationRead(id);
    navigate(entityDestination[entityType] ?? '/agents');
  };
  const openPushNotification = () => navigate('/agents');
  const [demoOpen, setDemoOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const activeKey = route.startsWith('/profiles') || route.startsWith('/endpoint-map') || route.startsWith('/tools/') ? 'agents' : route.split('/')[1] || 'agents';
  const activeLabel = activeKey.charAt(0).toUpperCase() + activeKey.slice(1);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const change = (event: MediaQueryListEvent) => setCompactNav(event.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const queryDemo = new URLSearchParams(window.location.hash.split('?')[1] || '').get('demo') as DemoState | null;
    if (queryDemo && Object.hasOwn(demoLabels, queryDemo)) setDemo(queryDemo);
  }, []);

  const destinationButton = (destination: string, inMenu = false) => {
    const key = destination.toLowerCase();
    const selected = key === activeKey;
    return (
      <button key={destination} type="button" role={inMenu ? 'menuitem' : undefined} className={inMenu ? 'menu-item' : `destination ${optional.has(destination) ? 'nav-optional' : ''} ${!['Dashboard', 'Agents'].includes(destination) ? 'nav-compact' : ''} ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => navigate(`/${key}`)} data-testid={`nav-${key}${inMenu ? '-overflow' : ''}`}>
        {destination}{destination === 'Messages' && unreadThreads > 0 && <span className="unread-badge" aria-label={`${unreadThreads} unread`}>{unreadThreads}</span>}
      </button>
    );
  };

  return (
    <div className="app-canvas" data-od-id="agents-app-shell">
      <a className="skip-link" href="#/agents" onClick={(event) => { event.preventDefault(); if (!window.location.hash.startsWith('#/agents')) navigate('/agents'); requestAnimationFrame(() => document.getElementById('main-content')?.focus()); }}>Skip to Agents workspace</a>
      <header className="app-header" data-od-id="rhythm-global-header">
        <nav className="destination-nav" aria-label="Product destinations">
          {destinations.map((destination) => destinationButton(destination))}
          <Menu label="More destinations" icon="chevronDown" testId="nav-more" className="more-nav" popoverClassName="nav-overflow" triggerClassName="destination" triggerContent={<>More <Icon name="chevronDown" size={14} /></>}>
            {(compactNav ? destinations.filter((destination) => !['Dashboard', 'Agents'].includes(destination)) : [...optional]).map((destination) => destinationButton(destination, true))}
          </Menu>
        </nav>
        <div className="global-actions">
          <Menu label="Background activity" icon="activity" testId="background-activity-button">
            <div className="menu-heading"><span>Background activity</span><small>2 sessions</small></div>
            <button className="activity-row" role="menuitem" type="button" onClick={() => { navigate('/agents'); setDemo('running'); notify('Volunteer coverage audit selected'); }}><span className="status-dot working" /><span><strong>Volunteer coverage audit</strong><small>Working · child agent</small></span></button>
            <button className="activity-row" role="menuitem" type="button" onClick={() => { navigate('/agents'); setDemo('resumable'); }}><span className="status-dot stuck" /><span><strong>Integration health sweep</strong><small>Unavailable · can resume</small></span></button>
          </Menu>
          <Menu label="Notifications" icon="bell" testId="notifications-button">
            {live ? <>
              <div className="menu-heading"><span>Notifications</span><small>{notificationUnreadCount} unread</small></div>
              {notifications.length === 0 && pushNotifications.length === 0 && <div className="menu-item stacked"><small>No notifications</small></div>}
              {notifications.map((item) => <button key={`domain-${item.id}`} role="menuitem" className="menu-item stacked" type="button" onClick={() => openDomainNotification(item.id, item.entityType)}><strong>{item.message}</strong><small>{item.type}</small></button>)}
              {pushNotifications.map((item) => <button key={`push-${item.id}`} role="menuitem" className="menu-item stacked" type="button" onClick={openPushNotification}><strong>{item.title}</strong><small>{item.body}</small></button>)}
              <button role="menuitem" className="menu-item stacked" type="button" onClick={markAllNotificationsRead}><strong>Mark all read</strong><small>Clears unread status</small></button>
            </> : <>
              <div className="menu-heading"><span>Notifications</span><small>2 unread</small></div>
              <button role="menuitem" className="menu-item stacked" type="button" onClick={() => { navigate('/agents'); setDemo('permission'); }}><strong>Permission needed</strong><small>Prepare release worktree</small></button>
              <button role="menuitem" className="menu-item stacked" type="button" onClick={() => notify('All notifications marked read')}><strong>Mark all read</strong><small>Clears unread status</small></button>
            </>}
          </Menu>
          <Menu label="Account and settings" icon="profile" testId="account-button" className="account-menu" account>
            <div className="account-card"><span className="avatar">AJ</span><div><strong>AJ Hochhalter</strong><small>Rhythm workspace</small></div></div>
            <button className="menu-item" role="menuitem" type="button" onClick={() => navigate('/profiles')} data-testid="account-profiles"><Icon name="profile" size={15} />Profiles</button>
            <button className="menu-item" role="menuitem" type="button" onClick={() => navigate('/tools/agent-settings')}><Icon name="settings" size={15} />Agent settings</button>
            <div className="prototype-diagnostics" role="group" aria-label="Workspace diagnostics">
              <span className="menu-section-label">Workspace diagnostics</span>
              <button className="menu-item" role="menuitem" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} data-testid="theme-toggle"><Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />Switch to {theme === 'light' ? 'dark' : 'light'} theme</button>
              <button className="menu-item" role="menuitem" type="button" onClick={() => navigate('/endpoint-map')} data-testid="endpoint-map-button"><Icon name="endpoint" size={15} />Endpoint Map</button>
              <div className="diagnostics-demo">
                <button className="menu-item" role="menuitem" type="button" aria-haspopup="menu" aria-expanded={demoOpen} onClick={() => setDemoOpen((value) => !value)} data-menu-keep-open data-testid="demo-states-button"><Icon name="activity" size={15} />Demo states<Icon name="chevronRight" size={13} /></button>
                {demoOpen && <div className="menu-popover demo-menu" role="menu" aria-label="Demo states" onClick={() => setDemoOpen(false)}>{(Object.keys(demoLabels) as DemoState[]).map((state) => <button role="menuitemradio" aria-checked={demo === state} className="menu-item" type="button" key={state} onClick={() => { setDemo(state); const base = window.location.hash.split('?')[0] || '#/agents'; history.replaceState(null, '', `${base}?demo=${state}`); }} data-testid={`demo-${state}`}>{demo === state ? <Icon name="check" size={14} /> : <span className="menu-spacer" />}{demoLabels[state]}</button>)}<hr /><button role="menuitem" className="menu-item" type="button" onClick={() => { resetFixtures(); history.replaceState(null, '', '#/agents'); }} data-testid="fixture-reset"><Icon name="refresh" size={14} />Reset workspace</button></div>}
              </div>
            </div>
          </Menu>
        </div>
      </header>
      <section className="workspace-surface" aria-label={`${activeLabel} workspace`}>
        <main id="main-content" tabIndex={-1}>{children}</main>
      </section>
      <div className="toast" role="status" aria-live="polite" data-testid="toast-status"><Icon name="check" size={15} /><span>{toast}</span></div>
    </div>
  );
}
