import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Splitter } from '../../components/Splitter';
import { colonyShell, type ColonySourceChoice, type ColonyStatus } from './bridge';
import { ColonyInspector } from './inspector';
import { ColonyViewMenu, type ColonyViewChange, type ColonyViewState } from './menus';
import { buildColonyRailModel, reconcileColonySelection, type ColonyFilters, type ColonyThread } from './model';
import { ColonyRail } from './rail';
import { ColonyFreshnessBanner, ColonyPartialFailureBanner, useColonyLoadPhase } from './status';
import './styles.css';

const SCENE_UNAVAILABLE_KEY = 'colony.sceneUnavailable';
type InventoryCollection = 'threads' | 'projects' | 'warnings';
type PageArgs = { collection: InventoryCollection; limit: number; generation?: string; cursor?: string };

const labels: Record<string, string> = {
  hermes: 'Hermes', codex: 'Codex', rhythm: 'Rhythm', opencode: 'OpenCode',
  'claude-code': 'Claude Code', cursor: 'Cursor', antigravity: 'Antigravity', kilocode: 'Kilo Code',
};

function overlayOpen() {
  return Boolean(document.querySelector('.menu-popover, [role="dialog"], .toast[data-visible="true"]'));
}

function ColonyHost({ headless, onError, onAttached, onSceneSelect, onSceneStatus, onSceneAction, onShortcut }: { headless: boolean; onError(message: string): void; onAttached(): void; onSceneSelect(threadId: string): void; onSceneStatus(available: boolean): void; onSceneAction(result: Record<string, unknown>): void; onShortcut(key: 'archive' | 'restore' | 'viewed'): void }) {
  const host = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const attached = useRef(false);
  const attachment = useRef<Promise<void> | null>(null);
  const detachTimer = useRef<number>();
  const reportCurrentBounds = useRef<() => void>(() => {});
  const visibility = useRef<boolean | null>(null);
  useEffect(() => {
    const bridge = colonyShell()?.colonyView;
    active.current = true;
    if (detachTimer.current !== undefined) window.clearTimeout(detachTimer.current);
    let frame = 0;
    const reportBounds = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active.current || !attached.current) return;
        const rect = host.current?.getBoundingClientRect();
        const hidden = overlayOpen() || !rect || rect.width <= 0 || rect.height <= 0;
        if (visibility.current !== hidden) {
          visibility.current = hidden;
          bridge?.sendIntent?.({ event: 'host.visibility', payload: { hidden } });
        }
        const bounds = hidden
          ? { x: 0, y: 0, width: 0, height: 0 }
          : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        void bridge?.setBounds(bounds).catch(() => { if (active.current) onError('Bot Crossing could not resize. Retry the local view.'); });
      });
    };
    // A headless (list-only) session has no WebContentsView to size or hide, so none of the
    // bounds/overlay-visibility plumbing below applies to it.
    let resize: ResizeObserver | undefined;
    let overlays: MutationObserver | undefined;
    if (!headless) {
      reportCurrentBounds.current = reportBounds;
      resize = new ResizeObserver(reportBounds);
      if (host.current) resize.observe(host.current);
      overlays = new MutationObserver(reportBounds);
      overlays.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-visible', 'open', 'aria-expanded'] });
      window.addEventListener('scroll', reportBounds, true);
      window.addEventListener('resize', reportBounds);
    }
    if (!bridge) onError('This version of Rhythm does not include the Bot Crossing host. Rebuild the Rhythm package.');
    else if (!attachment.current) {
      attachment.current = bridge.attach(headless ? { headless: true } : undefined).then((result) => {
        if (typeof result !== 'object' || result.ok !== true) {
          if (active.current) onError((typeof result === 'object' ? result.reason : undefined) || 'Bot Crossing could not open. Rebuild the pinned artifact and retry.');
          return;
        }
        attached.current = true;
        onAttached();
        reportCurrentBounds.current();
      }).catch(() => {
        if (active.current) onError('Bot Crossing could not open. Rebuild the pinned artifact and retry.');
      });
    }
    const unsubscribe = bridge?.onEvent?.((message) => {
      if (message.event === 'scene.select' && typeof message.payload.threadId === 'string') onSceneSelect(message.payload.threadId);
      if (message.event === 'scene.status' && typeof message.payload.webgl === 'string') onSceneStatus(message.payload.webgl !== 'lost');
      if (message.event === 'scene.action') onSceneAction(message.payload);
    });
    return () => {
      active.current = false;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      overlays?.disconnect();
      if (!headless) { window.removeEventListener('scroll', reportBounds, true); window.removeEventListener('resize', reportBounds); }
      unsubscribe?.();
      // StrictMode immediately replays mount effects. Deferring disposal one task
      // lets that replay reuse the in-flight attachment while real route departure
      // still tears down exactly once.
      detachTimer.current = window.setTimeout(() => {
        if (active.current) return;
        void attachment.current?.then(async () => {
          if (active.current || !attached.current) return;
          attached.current = false;
          attachment.current = null;
          await bridge?.detach().catch(() => undefined);
        });
      }, 0);
    };
  }, [headless, onAttached, onError, onSceneAction, onSceneSelect, onSceneStatus]);
  if (headless) return null;
  return <div ref={host} className="colony-host" data-colony-host role="region" aria-label="Bot Crossing scene" tabIndex={0} onKeyDown={(event) => {
    const target = event.target as HTMLElement;
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key.toLowerCase() === 'v') { event.preventDefault(); onShortcut('viewed'); }
    if (event.key.toLowerCase() === 'a') { event.preventDefault(); onShortcut('archive'); }
  }} />;
}

function Enablement({ sources, busy, onToggle, onEnable }: { sources: ColonySourceChoice[]; busy: boolean; onToggle(id: string, enabled: boolean): void; onEnable(): void }) {
  return <div className="colony-state colony-onboarding">
    <p className="eyebrow">Local workspace map</p>
    <h1>See your local agent work in one place</h1>
    <p>Bot Crossing reads the local task stores you choose and draws them as a shared scene. Discovery is read-only: Rhythm does not edit harness records or upload their paths and history to the hosted API.</p>
    <fieldset>
      <legend>Choose local sources</legend>
      <div className="colony-source-list">
        {sources.map((source) => <label key={source.id} className="colony-source">
          <input type="checkbox" checked={source.enabled} disabled={busy || source.state === 'missing'} onChange={(event) => onToggle(source.id, event.currentTarget.checked)} />
          <span><strong>{labels[source.id] ?? source.id}</strong><small>{source.state === 'present' ? 'Found on this Mac' : 'Not found on this Mac'}</small></span>
        </label>)}
      </div>
    </fieldset>
    <div className="colony-state-actions"><button type="button" className="primary-button" disabled={busy} onClick={onEnable}>Enable Bot Crossing</button></div>
    <p className="colony-footnote">You can disable scanning later without deleting this profile’s local Colony state.</p>
  </div>;
}

export function ColonyPage() {
  const bridge = colonyShell()?.colonyView;
  const [status, setStatus] = useState<ColonyStatus | null>(null);
  const [sources, setSources] = useState<ColonySourceChoice[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [threads, setThreads] = useState<ColonyThread[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [inventoryWarnings, setInventoryWarnings] = useState<string[]>([]);
  const [inventoryStartedAt, setInventoryStartedAt] = useState<number | null>(null);
  const [actionNotice, setActionNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [sceneAvailable, setSceneAvailable] = useState(false);
  const [listOnly, setListOnly] = useState<boolean>(() => {
    try { return window.localStorage.getItem(SCENE_UNAVAILABLE_KEY) === '1'; } catch { return false; }
  });
  const [viewState, setViewState] = useState<ColonyViewState>(() => ({
    quality: 'auto', sound: true, motion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full',
  }));
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return window.localStorage.getItem('colony.selection'); } catch { return null; }
  });
  const [filters, setFilters] = useState<ColonyFilters>({ query: '', harness: [], activity: [], includeHistorical: false });
  const [inspectorWidth, setInspectorWidth] = useState(336);
  const handleError = useCallback((message: string) => setError(message), []);
  const sceneStatus = useCallback((available: boolean) => {
    setSceneAvailable(available);
    if (!available) {
      setListOnly(true);
      try { window.localStorage.setItem(SCENE_UNAVAILABLE_KEY, '1'); } catch { /* best effort */ }
    }
  }, []);
  const retryScene = useCallback(() => {
    try { window.localStorage.removeItem(SCENE_UNAVAILABLE_KEY); } catch { /* best effort */ }
    setListOnly(false);
    setSceneAvailable(false);
    setAttempt((value) => value + 1);
  }, []);
  const [inventoryCancelled, setInventoryCancelled] = useState(false);
  const timedLoadPhase = useColonyLoadPhase(inventoryLoading, inventoryStartedAt);
  const loadPhase = inventoryCancelled ? 'cancelled' : timedLoadPhase;
  const failedSourceLabel = useCallback((id: string) => labels[id] ?? id, []);

  useEffect(() => bridge?.onReset?.(() => {
    try {
      window.localStorage.removeItem('colony.selection');
      window.localStorage.removeItem('layout.colony.inspector');
    } catch { /* Account-switch clearing is best effort when storage is unavailable. */ }
    setStatus({ v: 1, available: true, enabled: false, sources: [] });
    setSources([]);
    setThreads([]);
    setSelectedId(null);
    setInventoryLoaded(false);
    setInventoryError('');
    setSceneAvailable(false);
    setError('');
    setActionNotice(null);
  }), [bridge]);

  useEffect(() => {
    if (!actionNotice) return;
    const timer = window.setTimeout(() => setActionNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    let alive = true;
    if (!bridge) { setError('This version of Rhythm does not include the Bot Crossing host. Rebuild the Rhythm package.'); return; }
    void bridge.getStatus().then(async (next) => {
      if (!alive) return;
      setStatus(next);
      if (!next.available) { setError(next.reason || 'Bot Crossing is unavailable. Rebuild the Rhythm package.'); return; }
      if (!next.enabled) {
        const choices = await bridge.discoverSources();
        if (alive) setSources(choices);
      }
    }).catch(() => { if (alive) setError('Bot Crossing settings are unavailable. Rebuild the Rhythm package.'); });
    return () => { alive = false; };
  }, [attempt, bridge]);

  // Resumable so Retry (COL-08) can replay exactly the one page request that stalled,
  // instead of restarting the whole threads/projects/warnings walk from scratch.
  type InventoryWalk = { queue: InventoryCollection[]; cursor?: string; generation?: string; collected: ColonyThread[]; warnings: string[] };
  const inventoryWalkRef = useRef<InventoryWalk | null>(null);
  const retryArgsRef = useRef<PageArgs | null>(null);
  const cancelledRef = useRef(false);

  const finishInventory = useCallback(async (walk: InventoryWalk) => {
    setThreads(walk.collected);
    setSelectedId((current) => reconcileColonySelection(current, walk.collected));
    setInventoryWarnings(walk.warnings);
    setInventoryLoaded(true);
    setInventoryLoading(false);
    setInventoryStartedAt(null);
    inventoryWalkRef.current = null;
    retryArgsRef.current = null;
    if (walk.generation) await bridge?.inventoryCancel?.(walk.generation).catch(() => undefined);
  }, [bridge]);

  const fetchNext = useCallback(async (): Promise<void> => {
    const walk = inventoryWalkRef.current;
    if (!bridge?.inventoryPage || !walk) return;
    const collection = walk.queue[0];
    if (!collection) { await finishInventory(walk); return; }
    const args: PageArgs = { collection, limit: 250, ...(walk.generation ? { generation: walk.generation } : {}), ...(walk.cursor ? { cursor: walk.cursor } : {}) };
    retryArgsRef.current = args;
    try {
      const page = await bridge.inventoryPage(args);
      if (cancelledRef.current || inventoryWalkRef.current !== walk) return;
      if (walk.generation && page.generation !== walk.generation) throw new Error('Inventory generation changed');
      walk.generation = page.generation;
      if (collection === 'threads') walk.collected.push(...(page.records as ColonyThread[]));
      if (collection === 'warnings') walk.warnings.push(...(page.records as string[]));
      if (page.nextCursor) walk.cursor = page.nextCursor;
      else { walk.queue = walk.queue.slice(1); walk.cursor = undefined; }
      retryArgsRef.current = null;
      void fetchNext();
    } catch {
      if (cancelledRef.current || inventoryWalkRef.current !== walk) return;
      setInventoryError('Bot Crossing inventory could not be read. Retry the local view.');
      setInventoryLoading(false);
    }
  }, [bridge, finishInventory]);

  const loadInventory = useCallback(() => {
    if (!bridge?.inventoryPage) return;
    cancelledRef.current = false;
    setInventoryCancelled(false);
    setInventoryError('');
    setInventoryLoading(true);
    setInventoryStartedAt(Date.now());
    inventoryWalkRef.current = { queue: ['threads', 'projects', 'warnings'], collected: [], warnings: [] };
    void fetchNext();
  }, [bridge, fetchNext]);

  // Stops the in-flight request and marks the load cancelled, but keeps the walk/retry
  // state so Retry can resume the same page rather than starting over.
  const cancelInventory = useCallback(() => {
    cancelledRef.current = true;
    setInventoryLoading(false);
    setInventoryStartedAt(null);
    setInventoryCancelled(true);
    const generation = inventoryWalkRef.current?.generation;
    if (generation) void bridge?.inventoryCancel?.(generation).catch(() => undefined);
  }, [bridge]);

  // Issues exactly one page request: the same one that was in flight when it stalled. The walk
  // is untouched by a failed attempt (fetchNext only mutates it on success), so fetchNext()
  // recomputes the identical args from the walk's own queue/generation/cursor: no need to
  // duplicate the fetch-then-advance body here too.
  const retryInventory = useCallback(() => {
    if (!bridge?.inventoryPage || !inventoryWalkRef.current || !retryArgsRef.current) return;
    cancelledRef.current = false;
    setInventoryCancelled(false);
    setInventoryError('');
    setInventoryLoading(true);
    setInventoryStartedAt(Date.now());
    void fetchNext();
  }, [bridge, fetchNext]);

  useEffect(() => {
    try {
      if (selectedId) window.localStorage.setItem('colony.selection', selectedId);
      else window.localStorage.removeItem('colony.selection');
    } catch { /* Profile-local layout state is best effort. */ }
  }, [selectedId]);

  const model = useMemo(() => buildColonyRailModel(threads, filters), [filters, threads]);
  useEffect(() => {
    if (inventoryLoaded && selectedId && !model.visible.some((row) => row.thread.id === selectedId)) setSelectedId(null);
  }, [inventoryLoaded, model.visible, selectedId]);

  useEffect(() => {
    if (!status?.enabled) return;
    bridge?.sendIntent?.({ event: 'host.filter', payload: { query: filters.query, harness: filters.harness, activity: filters.activity, includeHistorical: filters.includeHistorical } });
  }, [bridge, filters, status?.enabled]);

  const selectThread = useCallback((threadId: string) => {
    setSelectedId(threadId);
    bridge?.sendIntent?.({ event: 'host.select', payload: { threadId } });
  }, [bridge]);
  const sceneSelect = useCallback((threadId: string) => setSelectedId(threadId), []);
  const sceneAction = useCallback((result: Record<string, unknown>) => {
    if (result.kind === 'rhythm-session' && typeof result.sessionId === 'string') window.location.hash = `/agents?sessionId=${encodeURIComponent(result.sessionId)}`;
  }, []);
  const attached = useCallback(() => {
    // A headless (list-only) attach never creates a scene (colony-service.mjs never binds a
    // scene channel for one), so it must not report a scene as available.
    if (!listOnly) setSceneAvailable(true);
    void loadInventory();
    // The OS reduced-motion preference is otherwise only known locally; the native scene
    // never learns about it unless we tell it on attach — but only when a scene exists to tell.
    if (!listOnly && viewState.motion === 'reduced') bridge?.sendIntent?.({ event: 'host.view', payload: { motion: 'reduced' } });
  }, [bridge, listOnly, loadInventory, viewState.motion]);
  const changeView = useCallback((change: ColonyViewChange) => {
    if (!sceneAvailable || listOnly) return;
    bridge?.sendIntent?.({ event: 'host.view', payload: change });
    setViewState((current) => ({
      quality: change.quality ?? current.quality,
      sound: change.sound ?? current.sound,
      motion: change.motion ?? current.motion,
    }));
  }, [bridge, listOnly, sceneAvailable]);

  const runAction = useCallback(async (kind: 'open' | 'showParent' | 'reveal' | 'copyPath' | 'archive' | 'restore' | 'viewed') => {
    if (!bridge?.runAction || !selectedId) return;
    const before = selectedId;
    try {
      const result = await bridge.runAction(kind, before);
      if (!result.ok) { setActionNotice({ kind: 'error', message: result.reason || 'Bot Crossing action failed.' }); return; }
      if (result.kind === 'rhythm-session' && result.sessionId) {
        window.location.hash = `/agents?sessionId=${encodeURIComponent(result.sessionId)}`;
        return;
      }
      if (result.kind === 'select-thread' && result.id) { selectThread(result.id); setActionNotice(null); return; }
      if (kind === 'archive' || kind === 'restore') setThreads((current) => current.map((thread) => thread.id === before ? { ...thread, archived: kind === 'archive' } : thread));
      const messages: Record<string, string> = { open: 'Task opened.', reveal: 'Task folder revealed.', copyPath: 'Task folder path copied.', archive: 'Archived from Colony.', restore: 'Restored to Colony.', viewed: 'Marked viewed.' };
      setActionNotice({ kind: 'success', message: messages[kind] || 'Action completed.' });
    } catch (cause) {
      setActionNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Bot Crossing action failed.' });
    }
  }, [bridge, selectThread, selectedId]);

  const toggle = async (id: string, enabled: boolean) => {
    if (!bridge) return;
    setBusy(true);
    try {
      await bridge.setSource(id, enabled);
      setSources((current) => current.map((source) => source.id === id ? { ...source, enabled } : source));
    } catch { setError('Rhythm could not save that local source choice.'); }
    finally { setBusy(false); }
  };
  const enable = async () => {
    if (!bridge) return;
    setBusy(true);
    try { const next = await bridge.setEnabled(true); setStatus(next); setError(''); }
    catch { setError('Rhythm could not enable Bot Crossing for this profile.'); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const next = await bridge.setEnabled(false);
      setStatus(next);
      setSources(await bridge.discoverSources());
    } catch { setError('Rhythm could not stop Bot Crossing.'); }
    finally { setBusy(false); }
  };

  return <section className="colony-page" aria-label="Bot Crossing" data-testid="page-colony">
    {error ? <div className="colony-state colony-error"><p className="eyebrow">Local view unavailable</p><h1>Bot Crossing could not open</h1><p role="alert">{error}</p><div className="colony-state-actions"><button type="button" className="primary-button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Retry</button></div></div>
      : !status ? <div className="colony-state" role="status"><p>Loading Bot Crossing settings…</p></div>
        : !status.enabled ? <Enablement sources={sources} busy={busy} onToggle={(id, enabled) => void toggle(id, enabled)} onEnable={() => void enable()} />
          : !listOnly ? <div className="colony-enabled colony-scene-only"><ColonyHost key={attempt} headless={false} onError={handleError} onAttached={attached} onSceneSelect={sceneSelect} onSceneStatus={sceneStatus} onSceneAction={sceneAction} onShortcut={(kind) => void runAction(kind)} /></div>
            : <div className="colony-enabled"><header className="colony-toolbar"><div><strong>Bot Crossing</strong><span>Local read-only sources</span></div>{actionNotice && <p className={`colony-action-status ${actionNotice.kind}`} role={actionNotice.kind === 'error' ? 'alert' : 'status'}>{actionNotice.message}</p>}<div className="colony-toolbar-actions"><ColonyViewMenu hasSelection={Boolean(selectedId)} sceneAvailable={sceneAvailable} listOnly={listOnly} state={viewState} onView={changeView} /><button type="button" className="secondary-button compact" disabled={busy} onClick={() => void disable()}>Disable</button></div></header>
            {listOnly && <p className="colony-state-warning" role="status">3D scene unavailable — showing list view. <button type="button" className="secondary-button compact" onClick={retryScene}>Retry 3D scene</button></p>}
            <ColonyPartialFailureBanner warnings={inventoryWarnings} labelFor={failedSourceLabel} />
            <ColonyFreshnessBanner phase={loadPhase} onCancel={cancelInventory} onRetry={retryInventory} />
            {/* ListInspector's `loading` prop blocks/unmounts its whole detail pane, and ColonyHost
                (the native view + worker) lives there. Inventory loading starts in the same tick the
                scene finishes attaching, so passing it through here would tear down and re-attach the
                view/worker on every inventory load or retry (COL-08's "no second scanner"). The
                ColonyFreshnessBanner above communicates load state instead. */}
            <ColonyRail threads={threads} filters={filters} selectedId={selectedId} loading={false} error={inventoryError || undefined} onFilters={setFilters} onSelect={selectThread} detail={(thread) => <div className={`colony-stage${listOnly ? ' colony-stage-list-only' : thread ? ' has-inspector' : ''}`} style={{ '--colony-inspector-width': `${inspectorWidth}px` } as CSSProperties}>
              <ColonyHost key={attempt} headless={true} onError={handleError} onAttached={attached} onSceneSelect={sceneSelect} onSceneStatus={sceneStatus} onSceneAction={sceneAction} onShortcut={(kind) => void runAction(kind)} />
              {listOnly
                ? (thread ? <ColonyInspector thread={thread} onAction={(kind) => void runAction(kind)} /> : <p className="colony-muted" role="status">Select a task in the list to inspect it.</p>)
                : thread && <><Splitter orientation="vertical" storageKey="layout.colony.inspector" min={288} max={440} defaultSize={336} resizeEdge="end" onResize={setInspectorWidth} ariaLabel="Resize Bot Crossing inspector" testId="colony-inspector-splitter" /><ColonyInspector thread={thread} onAction={(kind) => void runAction(kind)} /></>}
            </div>} />
          </div>}
  </section>;
}
