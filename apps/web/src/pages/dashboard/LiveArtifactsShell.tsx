import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { useGateway } from '../../gateway/context';
import { useAuthUser } from '../../gateway/auth';
import { LiveArtifactsGatewayError, type LiveArtifact, type LiveArtifactDetail, type LiveArtifactsGateway } from '../../gateway/live-artifacts';
import type { UserPreferencesGateway } from '../../gateway/user-preferences';
import { DashboardPage } from '.';
import './liveArtifacts.css';

type TabStatus = 'loading' | 'ready' | 'unavailable' | 'deleted' | 'conflict' | 'error';

interface ArtifactTab {
  id: string;
  title: string;
  status: TabStatus;
  detail: LiveArtifactDetail | null;
  html: string | null;
  errorMessage: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function mapError(error: unknown): { status: TabStatus; message: string } {
  if (error instanceof LiveArtifactsGatewayError) {
    if (error.status === 404) return { status: 'unavailable', message: 'This live artifact is unavailable.' };
    if (error.status === 410 || error.code === 'artifact_deleted') return { status: 'deleted', message: 'This live artifact was deleted.' };
    if (error.status === 409 || error.code === 'CONFLICT') return { status: 'conflict', message: 'This live artifact has a conflict — reload to see the current revision.' };
    return { status: 'error', message: 'Could not load this live artifact. Try again.' };
  }
  return { status: 'error', message: 'Could not load this live artifact. Try again.' };
}

function LiveArtifactSurface({ tab, onReload }: { tab: ArtifactTab; onReload(): void }) {
  if (tab.status === 'loading') {
    return (
      <section data-testid="live-artifact-surface" data-artifact-id={tab.id} className="live-artifact-surface">
        <p role="status">Loading live artifact…</p>
      </section>
    );
  }
  if (tab.status !== 'ready' || !tab.detail) {
    return (
      <section data-testid="live-artifact-surface" data-artifact-id={tab.id} className="live-artifact-surface">
        <p role={tab.status === 'error' ? 'alert' : 'status'}>{tab.errorMessage}</p>
        <button type="button" className="secondary-button" onClick={onReload}>Reload</button>
      </section>
    );
  }
  const detail = tab.detail;
  return (
    <section data-testid="live-artifact-surface" data-artifact-id={tab.id} className="live-artifact-surface">
      <header className="live-artifact-toolbar">
        <div>
          <h2>{detail.title}</h2>
          <p>
            Updated by {detail.updatedByDisplayName ?? 'Unknown'} · {formatDate(detail.updatedAt)} · bundle revision {detail.currentBundleRevision} · state revision {detail.currentStateRevision} · {detail.visibility}
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onReload}>Reload</button>
      </header>
      {/* sandbox="allow-scripts" (no allow-same-origin) keeps this an opaque, isolated origin: the
          artifact bundle is untrusted content and must never reach network, file, popup,
          navigation, or download primitives — apps/api_server/src/controllers/live_artifacts_controller.ts:64-69
          already denies connect-src/forms/frames/objects in the served document's own CSP. */}
      <iframe data-testid="live-artifact-frame" title={detail.title} sandbox="allow-scripts" srcDoc={tab.html ?? ''} />
    </section>
  );
}

function ArtifactPicker({ open, onClose, gateway, onSelect }: {
  open: boolean;
  onClose(): void;
  gateway: LiveArtifactsGateway;
  onSelect(id: string, title: string): void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [artifacts, setArtifacts] = useState<LiveArtifact[]>([]);
  const [search, setSearch] = useState('');

  const load = async () => {
    setStatus('loading');
    try {
      const list = await gateway.list();
      setArtifacts(list);
      setStatus(list.length ? 'ready' : 'empty');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    if (open) { setSearch(''); void load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = artifacts.filter((artifact) => artifact.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <FocusDialog open={open} onClose={onClose} title="Add live artifact" description="Search and open an HTML live artifact." testId="live-artifact-picker">
      {status === 'loading' && <p role="status">Loading live artifacts…</p>}
      {status === 'error' && (
        <>
          <p role="alert">Could not load live artifacts.</p>
          <button type="button" className="secondary-button" onClick={() => void load()} data-testid="live-artifact-picker-retry">Retry</button>
        </>
      )}
      {status !== 'loading' && status !== 'error' && (
        <>
          <div className="artifact-picker-search">
            <input type="search" role="searchbox" aria-label="Search live artifacts" value={search} data-autofocus onChange={(event) => setSearch(event.target.value)} />
            {search && <button type="button" className="secondary-button" onClick={() => setSearch('')}>Clear search</button>}
          </div>
          {status === 'empty' && <p>No HTML live artifacts yet.</p>}
          {status === 'ready' && filtered.length === 0 && <p>No matching live artifacts.</p>}
          {status === 'ready' && filtered.length > 0 && (
            <div role="listbox" aria-label="Live artifacts" className="artifact-picker-list">
              {filtered.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="artifact-picker-option"
                  onClick={() => onSelect(artifact.id, artifact.title)}
                >
                  {artifact.title}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </FocusDialog>
  );
}

function LiveArtifactsWorkspace({
  route, artifactTabIds, liveArtifacts, userPreferences,
}: {
  route: string;
  artifactTabIds: string[];
  liveArtifacts: LiveArtifactsGateway;
  userPreferences: UserPreferencesGateway;
}) {
  const [tabs, setTabs] = useState<ArtifactTab[]>([]);
  // Dashboard is always the initial selection — never the last-active artifact tab.
  const [selected, setSelected] = useState<string>('dashboard');
  const [pickerOpen, setPickerOpen] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const addRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const loaded: ArtifactTab[] = [];
      for (const id of artifactTabIds) {
        try {
          const detail = await liveArtifacts.get(id);
          loaded.push({ id, title: detail.title, status: 'ready', detail, html: null, errorMessage: null });
        } catch {
          // A restored tab whose artifact no longer loads is dropped rather than shown broken.
        }
      }
      if (active) setTabs(loaded);
    })();
    return () => { active = false; };
    // Seed exactly once per mounted identity — a real identity change always remounts this
    // component via a fresh sign-in, never via a prop change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingFocusRef.current) return;
    const id = pendingFocusRef.current;
    pendingFocusRef.current = null;
    requestAnimationFrame(() => focusTabId(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  const order = ['dashboard', ...tabs.map((tab) => tab.id)];

  function focusTabId(id: string) {
    if (id === 'dashboard') dashboardRef.current?.focus();
    else tabRefs.current[id]?.focus();
  }

  function focusNeighbor(fromId: string, delta: number) {
    const index = order.indexOf(fromId);
    if (index === -1) return;
    focusTabId(order[(index + delta + order.length) % order.length]);
  }

  async function persistTabIds(ids: string[]) {
    try { await userPreferences.updateArtifactTabIds(ids); } catch { /* best-effort; UI stays the source of truth for this session */ }
  }

  async function loadTab(id: string) {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, status: 'loading' } : tab)));
    try {
      const detail = await liveArtifacts.get(id);
      const html = await liveArtifacts.render(id);
      setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, status: 'ready', detail, html, title: detail.title, errorMessage: null } : tab)));
    } catch (error) {
      const { status, message } = mapError(error);
      setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, status, errorMessage: message } : tab)));
    }
  }

  function selectTab(id: string) {
    setSelected(id);
    const tab = tabs.find((candidate) => candidate.id === id);
    if (tab && tab.html === null) void loadTab(id);
  }

  async function openArtifact(id: string, title: string) {
    setPickerOpen(false);
    if (tabs.some((tab) => tab.id === id)) { setSelected(id); return; }
    const nextTabs = [...tabs, { id, title, status: 'loading' as TabStatus, detail: null, html: null, errorMessage: null }];
    setTabs(nextTabs);
    setSelected(id);
    await persistTabIds(nextTabs.map((tab) => tab.id));
    await loadTab(id);
  }

  function closeTab(id: string) {
    const index = order.indexOf(id);
    pendingFocusRef.current = order[index - 1] ?? 'dashboard';
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      void persistTabIds(next.map((tab) => tab.id));
      return next;
    });
    setSelected((current) => (current === id ? (order[index - 1] ?? 'dashboard') : current));
  }

  function handleTabKeyDown(event: KeyboardEvent, id: string) {
    if (event.key === 'ArrowRight') { event.preventDefault(); focusNeighbor(id, 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); focusNeighbor(id, -1); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && id !== 'dashboard') { event.preventDefault(); closeTab(id); }
  }

  const activeTab = tabs.find((tab) => tab.id === selected);

  return (
    <div className="live-artifact-shell">
      <div className="artifact-tablist-row">
        <div role="tablist" aria-label="Dashboard artifacts" className="artifact-tablist">
          <div
            role="tab"
            aria-selected={selected === 'dashboard'}
            tabIndex={0}
            ref={dashboardRef}
            className="artifact-tab"
            onClick={() => setSelected('dashboard')}
            onKeyDown={(event) => handleTabKeyDown(event, 'dashboard')}
          >
            Dashboard
          </div>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={selected === tab.id}
              aria-label={tab.title}
              data-artifact-id={tab.id}
              tabIndex={0}
              ref={(element) => { tabRefs.current[tab.id] = element; }}
              className="artifact-tab"
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            >
              <span className="artifact-tab-label">{tab.title}</span>
              <button type="button" className="artifact-tab-close" aria-label={`Close ${tab.title}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}>×</button>
            </div>
          ))}
        </div>
        <button ref={addRef} type="button" className="artifact-tab-add" aria-label="Add live artifact" onClick={() => setPickerOpen(true)}>+</button>
      </div>

      <div className="artifact-tab-content">
        {/* Dashboard is a FIXED tab: it stays mounted (never unmounted/re-created) so its own
            in-progress state survives switching to an artifact tab and back — only visibility
            toggles. `hidden` keeps it attached to the DOM while removed from layout/a11y tree. */}
        <div hidden={selected !== 'dashboard'} className="artifact-dashboard-pane">
          <DashboardPage route={route} />
        </div>
        {activeTab && selected !== 'dashboard' && (
          <LiveArtifactSurface tab={activeTab} onReload={() => void loadTab(activeTab.id)} />
        )}
      </div>

      <ArtifactPicker open={pickerOpen} onClose={() => setPickerOpen(false)} gateway={liveArtifacts} onSelect={(id, title) => void openArtifact(id, title)} />
    </div>
  );
}

// Live-mode wrapper: Dashboard becomes a fixed tab beside dynamic, stable-ID artifact tabs opened
// from a searchable HTML-only picker (post-m1-phase-8 c1a-c1f). Fixture mode and any live harness
// that authenticates via the test-only token (no signed-in AuthUser) fall through to the bare
// Dashboard unchanged — this must never regress the existing fixture artifact panel or phase-3/4
// live coverage.
export function LiveArtifactsShell({ route }: { route: string }) {
  const gateway = useGateway();
  const authUser = useAuthUser();
  const liveArtifacts = gateway.domains.liveArtifacts;
  const userPreferences = gateway.domains.userPreferences;
  if (gateway.mode !== 'live' || !authUser || !liveArtifacts || !userPreferences) {
    return <DashboardPage route={route} />;
  }
  return (
    <LiveArtifactsWorkspace
      key={authUser.user.id}
      route={route}
      artifactTabIds={authUser.user.artifactTabIds ?? []}
      liveArtifacts={liveArtifacts}
      userPreferences={userPreferences}
    />
  );
}
