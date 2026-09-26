import { useCallback, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import './ListInspector.css';
import { Splitter } from './Splitter';

export type ListInspectorItem = { id: string; title: string; subtitle?: string; meta?: string; badge?: string; group?: string; disabled?: boolean };

const selectionEvent = 'rhythm:list-inspector-selection';

function layoutSlug(label: string) {
  return label.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pane';
}

function subscribeToSelection(listener: () => void) {
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  window.addEventListener(selectionEvent, listener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
    window.removeEventListener(selectionEvent, listener);
  };
}

/** Hash-route query parameters, like the existing Tasks and Integrations pages. */
export function useSelectedId(key: string): [string | null, (id: string | null) => void] {
  const read = useCallback(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get(key), [key]);
  const selectedId = useSyncExternalStore(subscribeToSelection, read, () => null);
  const select = useCallback((id: string | null) => {
    const [route, query = ''] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    if (id === null) params.delete(key); else params.set(key, id);
    const nextQuery = params.toString();
    window.history.replaceState(window.history.state, '', `${route || '#/'}${nextQuery ? `?${nextQuery}` : ''}`);
    // replaceState does not emit hashchange. Notify other consumers of this hook.
    window.dispatchEvent(new Event(selectionEvent));
  }, [key]);
  return [selectedId, select];
}

export function ListInspector({ label, items, groups, selectedId, onSelect, toolbar, inspector, emptyState, noResultsState, loadingState, filterItem, loading = false, error, searchable = false, searchPlaceholder, className, listWidth, listFooter }: {
  label: string;
  items: ListInspectorItem[];
  groups?: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  toolbar?: ReactNode;
  inspector: (item: ListInspectorItem | null) => ReactNode;
  emptyState?: ReactNode;
  noResultsState?: ReactNode;
  loadingState?: ReactNode;
  filterItem?: (item: ListInspectorItem) => boolean;
  loading?: boolean;
  /** Fatal only: use when the list itself cannot be built. Rows, selection, and keyboard navigation are intentionally unavailable. */
  error?: ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  listWidth?: number;
  listFooter?: ReactNode;
}) {
  const instanceId = useId();
  const headingId = `${instanceId}-heading`;
  const defaultListWidth = listWidth !== undefined && Number.isFinite(listWidth) ? Math.max(240, listWidth) : 320;
  const [query, setQuery] = useState('');
  const [listPaneWidth, setListPaneWidth] = useState(defaultListWidth);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [listForId, setListForId] = useState<string | null>();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<'list' | 'detail' | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const hasError = error !== undefined && error !== null && error !== false;
  const missing = selectedId !== null && !selected && !loading && !hasError;
  const showList = loading || hasError || selectedId === null || listForId === selectedId;
  const terms = searchable ? query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
  const visible = items.filter((item) => {
    if (filterItem && !filterItem(item)) return false;
    const searchableText = [item.title, item.subtitle, item.meta, item.badge].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
  const knownGroups = new Set(groups?.map((group) => group.id));
  const sections = [
    ...(groups ?? []).map((group) => ({ ...group, items: visible.filter((item) => item.group === group.id) })),
    { id: '', label: '', items: visible.filter((item) => !item.group || !knownGroups.has(item.group)) },
  ].filter((group) => group.items.length > 0);
  const enabled = sections.flatMap((group) => group.items).filter((item) => !item.disabled);
  const rovingId = enabled.find((item) => item.id === focusedId)?.id
    ?? enabled.find((item) => item.id === selectedId)?.id ?? enabled[0]?.id;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      if (root.clientWidth > 0) setContainerWidth(root.clientWidth);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    if (pendingFocus.current === 'list') (rowRefs.current.get(rovingId ?? '') ?? listRef.current)?.focus();
    else if (backRef.current && getComputedStyle(backRef.current).display !== 'none') headingRef.current?.focus();
    pendingFocus.current = null;
  });

  const select = (item: ListInspectorItem) => {
    if (item.disabled || loading || hasError) return;
    setFocusedId(item.id);
    setListForId(undefined);
    pendingFocus.current = 'detail';
    onSelect(item.id);
  };
  const back = () => {
    setListForId(selectedId);
    pendingFocus.current = 'list';
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (loading || hasError || !enabled.length) return;
    const currentId = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]')?.dataset.itemId;
    const index = enabled.findIndex((item) => item.id === currentId);
    let next: ListInspectorItem | undefined;
    if (event.key === 'Home') next = enabled[0];
    if (event.key === 'End') next = enabled[enabled.length - 1];
    if (event.key === 'ArrowDown') next = enabled[Math.min(index + 1, enabled.length - 1)];
    if (event.key === 'ArrowUp') next = enabled[index < 0 ? enabled.length - 1 : Math.max(index - 1, 0)];
    if (next) {
      event.preventDefault();
      setFocusedId(next.id);
      rowRefs.current.get(next.id)?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = enabled.find((entry) => entry.id === (currentId ?? rovingId));
      if (item) select(item);
    }
  };
  const title = loading ? `Loading ${label}` : hasError ? `${label} unavailable` : missing ? 'Item not found' : selected?.title ?? 'Select an item';
  const effectiveListWidth = Math.min(listPaneWidth, containerWidth ?? listPaneWidth);
  const width = { '--list-inspector-list-width': `${effectiveListWidth}px` } as CSSProperties;

  return <div ref={rootRef} className={`list-inspector${className ? ` ${className}` : ''}`} style={width} data-pane={showList ? 'list' : 'inspector'}>
    <div className="list-inspector-panes tool-split">
      <aside className="list-inspector-rail tool-rail" aria-label={`${label} list`}>
        {toolbar && <div className="list-inspector-toolbar">{toolbar}</div>}
        {searchable && <label className="list-inspector-search"><span className="sr-only">Search {label}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder ?? `Search ${label}`} /></label>}
        <div className="list-inspector-list" ref={listRef} role="listbox" aria-label={label} aria-busy={loading} tabIndex={0} onKeyDown={onKeyDown}>
          {!loading && !hasError && sections.map((group, groupIndex) => <div key={group.id} role={group.label ? 'group' : 'presentation'} aria-labelledby={group.label ? `${instanceId}-group-${groupIndex}` : undefined}>
            {group.label && <div id={`${instanceId}-group-${groupIndex}`} className="list-inspector-group-label">{group.label}</div>}
            {group.items.map((item) => <div
              key={item.id}
              ref={(element) => { if (element) rowRefs.current.set(item.id, element); else rowRefs.current.delete(item.id); }}
              role="option"
              aria-label={item.title}
              aria-selected={item.id === selectedId}
              aria-disabled={item.disabled || undefined}
              aria-describedby={item.subtitle || item.meta || item.badge ? `${instanceId}-meta-${encodeURIComponent(item.id)}` : undefined}
              tabIndex={item.id === rovingId ? 0 : -1}
              className={`list-inspector-row${item.id === selectedId ? ' selected' : ''}`}
              data-item-id={item.id}
              data-testid={item.id}
              onFocus={() => setFocusedId(item.id)}
              onClick={(event) => { if (!item.disabled) { event.currentTarget.focus(); select(item); } }}
            >
              <strong title={item.title}>{item.title}</strong>
              <span className="list-inspector-row-meta" id={`${instanceId}-meta-${encodeURIComponent(item.id)}`}>
                {(item.subtitle || item.meta) && <small title={[item.subtitle, item.meta].filter(Boolean).join(' · ')}>{[item.subtitle, item.meta].filter(Boolean).join(' · ')}</small>}
                {item.badge && <span className="list-inspector-badge" title={item.badge}>{item.badge}</span>}
              </span>
            </div>)}
          </div>)}
        </div>
        {loading ? <div className="list-inspector-state" role="status" aria-live="polite" aria-atomic="true">{loadingState ?? `Loading ${label}…`}</div>
          : hasError ? <div className="list-inspector-state" role="alert">{error}</div>
          : !items.length ? <div className="list-inspector-state" role="status" aria-live="polite" aria-atomic="true">{emptyState ?? 'No items yet.'}</div>
          : !visible.length ? <div className="list-inspector-state" role="status" aria-live="polite" aria-atomic="true">{terms.length ? 'No results match your search.' : noResultsState ?? 'No results match your search.'}</div> : null}
        {listFooter && <div className="list-inspector-footer">{listFooter}</div>}
      </aside>
      <Splitter orientation="vertical" storageKey={`layout.list-inspector.${layoutSlug(label)}`} min={240} max={Math.max(520, defaultListWidth)} defaultSize={defaultListWidth} onResize={setListPaneWidth} ariaLabel={`Resize ${label} list`} className="list-inspector-splitter" />
      <section className="list-inspector-detail tool-detail" aria-labelledby={headingId} tabIndex={0} data-testid="list-inspector-detail">
        <header className="list-inspector-header">
          {/* Inspection remains available inside an existing disabled action fieldset. */}
          <div ref={backRef} role="button" tabIndex={0} className="list-inspector-back secondary-button" onClick={back} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); back(); } }}>Back to list</div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>{title}</h2>
        </header>
        {loading || hasError ? null : missing ? <p role="status" aria-live="polite">This item was not found or is no longer available. Select another item from the list.</p> : inspector(selected)}
      </section>
    </div>
  </div>;
}
