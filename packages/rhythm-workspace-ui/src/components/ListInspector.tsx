import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Splitter } from './Splitter';

export interface ListInspectorItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  badgeTestId?: string;
  group?: string;
  disabled?: boolean;
  testId?: string;
  testAliases?: string[];
}

export interface ListInspectorProps {
  label: string;
  items: ListInspectorItem[];
  groups?: Array<{ id: string; label: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Stable host identity. Changing it resets transient query, focus, pane, and split state. */
  identityKey?: string;
  toolbar?: ReactNode;
  inspector: (item: ListInspectorItem | null) => ReactNode;
  emptyState?: ReactNode;
  noResultsState?: ReactNode;
  loadingState?: ReactNode;
  filterItem?: (item: ListInspectorItem) => boolean;
  loading?: boolean;
  error?: ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchTestId?: string;
  className?: string;
  listWidth?: number;
  listFooter?: ReactNode;
  listTestId?: string;
  emptySelection?: ReactNode;
}

/** Controlled, host-neutral list/detail primitive. It owns no route or durable storage. */
export function ListInspector({ label, items, groups, selectedId, onSelect, identityKey = 'default', toolbar, inspector, emptyState, noResultsState, loadingState, filterItem, loading = false, error, searchable = false, searchPlaceholder, searchTestId, className, listWidth, listFooter, listTestId, emptySelection }: ListInspectorProps) {
  const instanceId = useId();
  const headingId = `${instanceId}-heading`;
  const defaultListWidth = listWidth !== undefined && Number.isFinite(listWidth) ? Math.max(240, listWidth) : 320;
  const [query, setQuery] = useState('');
  const [listPaneWidth, setListPaneWidth] = useState(defaultListWidth);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [showListForId, setShowListForId] = useState<string | null>();
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<'list' | 'detail' | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const hasError = error !== undefined && error !== null && error !== false;
  const missing = selectedId !== null && !selected && !loading && !hasError;
  const showList = loading || hasError || selectedId === null || showListForId === selectedId;

  useLayoutEffect(() => {
    setQuery('');
    setFocusedId(null);
    setShowListForId(undefined);
    setListPaneWidth(defaultListWidth);
    pendingFocus.current = null;
  }, [defaultListWidth, identityKey]);

  const visible = useMemo(() => {
    const terms = searchable ? query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
    return items.filter((item) => {
      if (filterItem && !filterItem(item)) return false;
      const text = [item.title, item.subtitle, item.meta, item.badge].filter(Boolean).join(' ').toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [filterItem, items, query, searchable]);
  const knownGroups = new Set(groups?.map((group) => group.id));
  const sections = [
    ...(groups ?? []).map((group) => ({ ...group, items: visible.filter((item) => item.group === group.id) })),
    { id: '', label: '', items: visible.filter((item) => !item.group || !knownGroups.has(item.group)) },
  ].filter((group) => group.items.length > 0);
  const enabled = sections.flatMap((group) => group.items).filter((item) => !item.disabled);
  const rovingId = enabled.find((item) => item.id === focusedId)?.id ?? enabled.find((item) => item.id === selectedId)?.id ?? enabled[0]?.id;

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (pending === 'list') (rowRefs.current.get(selectedId ?? '') ?? rowRefs.current.get(rovingId ?? '') ?? listRef.current)?.focus();
    else headingRef.current?.focus();
    pendingFocus.current = null;
  });

  const select = (item: ListInspectorItem) => {
    if (item.disabled || loading || hasError) return;
    setFocusedId(item.id);
    setShowListForId(undefined);
    pendingFocus.current = 'detail';
    onSelect(item.id);
  };
  const back = () => {
    setShowListForId(selectedId);
    pendingFocus.current = 'list';
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (loading || hasError || enabled.length === 0) return;
    const currentId = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]')?.dataset.itemId;
    const index = enabled.findIndex((item) => item.id === currentId);
    const next = event.key === 'Home' ? enabled[0]
      : event.key === 'End' ? enabled[enabled.length - 1]
        : event.key === 'ArrowDown' ? enabled[Math.min(index + 1, enabled.length - 1)]
          : event.key === 'ArrowUp' ? enabled[index < 0 ? enabled.length - 1 : Math.max(index - 1, 0)]
            : undefined;
    if (next) {
      event.preventDefault();
      setFocusedId(next.id);
      rowRefs.current.get(next.id)?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = enabled.find((candidate) => candidate.id === (currentId ?? rovingId));
      if (item) select(item);
    }
  };
  const title = loading ? `Loading ${label}` : hasError ? `${label} unavailable` : missing ? 'Item not found' : selected?.title ?? 'Select an item';
  const width = { '--list-inspector-list-width': `${listPaneWidth}px` } as CSSProperties;

  return <div className={`list-inspector${className ? ` ${className}` : ''}`} style={width} data-pane={showList ? 'list' : 'inspector'} data-identity-key={identityKey}>
    <div className="list-inspector-panes">
      <aside className="list-inspector-rail" aria-label={`${label} list`}>
        {toolbar && <div className="list-inspector-toolbar">{toolbar}</div>}
        {searchable && <label className="list-inspector-search"><span className="sr-only">Search {label}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder ?? `Search ${label}`} data-testid={searchTestId} /></label>}
        <div className="list-inspector-list" ref={listRef} role="listbox" aria-label={label} aria-busy={loading} tabIndex={0} onKeyDown={onKeyDown} data-testid={listTestId}>
          {!loading && !hasError && sections.map((group, groupIndex) => <div key={group.id} role={group.label ? 'group' : 'presentation'} aria-labelledby={group.label ? `${instanceId}-group-${groupIndex}` : undefined}>
            {group.label && <div id={`${instanceId}-group-${groupIndex}`} className="list-inspector-group-label">{group.label}</div>}
            {group.items.map((item) => <div
              key={item.id}
              ref={(element) => { if (element) rowRefs.current.set(item.id, element); else rowRefs.current.delete(item.id); }}
              role="option"
              aria-label={item.title}
              aria-selected={item.id === selectedId}
              aria-disabled={item.disabled || undefined}
              tabIndex={item.id === rovingId ? 0 : -1}
              className={`list-inspector-row${item.id === selectedId ? ' selected' : ''}`}
              data-item-id={item.id}
              data-testid={item.testId ?? item.id}
              onFocus={() => setFocusedId(item.id)}
              onClick={() => select(item)}
            >
              <strong title={item.title}>{item.title}</strong>
              <span className="list-inspector-row-meta">
                {(item.subtitle || item.meta) && <small>{[item.subtitle, item.meta].filter(Boolean).join(' · ')}</small>}
                {item.badge && <span className="list-inspector-badge" data-testid={item.badgeTestId}>{item.badge}</span>}
              </span>
              {item.testAliases?.map((testId) => <span key={testId} className="sr-only" aria-hidden="true" data-testid={testId} />)}
            </div>)}
          </div>)}
        </div>
        {loading ? <div className="list-inspector-state" role="status" aria-live="polite">{loadingState ?? `Loading ${label}…`}</div>
          : hasError ? <div className="list-inspector-state" role="alert">{error}</div>
            : items.length === 0 ? <div className="list-inspector-state" role="status">{emptyState ?? 'No items yet.'}</div>
              : visible.length === 0 ? <div className="list-inspector-state" role="status">{noResultsState ?? 'No results match your search.'}</div> : null}
        {listFooter && <div className="list-inspector-footer">{listFooter}</div>}
      </aside>
      <Splitter orientation="vertical" min={240} max={Math.max(520, defaultListWidth)} defaultSize={defaultListWidth} onResize={setListPaneWidth} ariaLabel={`Resize ${label} list`} className="list-inspector-splitter" />
      <div className="list-inspector-detail" aria-labelledby={headingId} tabIndex={0} data-testid="list-inspector-detail">
        <header className="list-inspector-header">
          <button type="button" className="list-inspector-back secondary-button" onClick={back} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); back(); } }}>Back to list</button>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>{title}</h2>
        </header>
        {loading || hasError ? null : missing ? <p role="status" aria-live="polite">This item was not found or is no longer available. Select another item from the list.</p> : selected ? inspector(selected) : emptySelection ?? inspector(null)}
      </div>
    </div>
  </div>;
}
