import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../icons';
import { Splitter } from './Splitter';
import './ColumnBrowser.css';

/**
 * Finder-style column browser shared by Agent Settings and Profiles.
 * The host derives the columns from its own selection state; this component owns
 * layout, per-column scrolling, roving keyboard focus, and the narrow drill-in view.
 */
export type ColumnItem = { id: string; title: string; subtitle?: string; badge?: string; group?: string; testId?: string; leading?: ReactNode; disabled?: boolean; muted?: boolean };
type ColumnBase = { key: string; label: string; testId: string; header?: ReactNode };
export type ListColumn = ColumnBase & {
  kind: 'list';
  items: ColumnItem[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** "+ Add …" actions pinned above the rows. */
  adds?: { label: string; testId: string; selected?: boolean; disabled?: boolean; onClick(): void }[];
  loading?: boolean;
  emptyState?: ReactNode;
  /** Persisted Splitter width key; omit for a fixed-width column. */
  resizeKey?: string;
  /** Pinned below the rows (not part of the scroll area) — e.g. a "show deprecated" checkbox or a "Load more" button. */
  footer?: ReactNode;
  /** Title on its own line with the subtitle beneath it (muted), instead of the default single dense line. For rows whose title is often too long to leave room for an inline subtitle. */
  stackedRows?: boolean;
};
export type PanelColumn = ColumnBase & { kind: 'panel'; title?: string; bodyTestId?: string; children: ReactNode };
export type BrowserColumn = ListColumn | PanelColumn;

function ListRows({ column, instanceId, focusedId, setFocusedId, rowRefs }: {
  column: ListColumn; instanceId: string; focusedId?: string; setFocusedId(id: string): void;
  rowRefs: Map<string, HTMLDivElement>;
}) {
  const enabled = column.items.filter((item) => !item.disabled);
  const rovingId = enabled.find((item) => item.id === focusedId)?.id ?? enabled.find((item) => item.id === column.selectedId)?.id ?? enabled[0]?.id;
  const groups: { label: string; items: ColumnItem[] }[] = [];
  for (const item of column.items) {
    const label = item.group ?? '';
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item); else groups.push({ label, items: [item] });
  }
  return <>{groups.map((group, groupIndex) => <div key={`${group.label}-${groupIndex}`} role={group.label ? 'group' : 'presentation'} aria-labelledby={group.label ? `${instanceId}-${column.key}-g${groupIndex}` : undefined}>
    {group.label && <div className="column-browser-group-label" id={`${instanceId}-${column.key}-g${groupIndex}`}>{group.label}</div>}
    {group.items.map((item) => {
      const selected = item.id === column.selectedId;
      const detail = [item.subtitle, item.badge].filter(Boolean).join(' · ');
      return <div
        key={item.id}
        ref={(element) => { if (element) rowRefs.set(item.id, element); else rowRefs.delete(item.id); }}
        role="option"
        aria-label={item.title}
        aria-selected={selected}
        aria-disabled={item.disabled || undefined}
        aria-describedby={item.subtitle ? `${instanceId}-${column.key}-d-${encodeURIComponent(item.id)}` : undefined}
        tabIndex={item.id === rovingId ? 0 : -1}
        className={`column-browser-row${selected ? ' selected' : ''}${item.muted ? ' muted' : ''}`}
        data-item-id={item.id}
        data-testid={item.testId ?? item.id}
        title={detail ? `${item.title} · ${detail}` : item.title}
        onFocus={() => setFocusedId(item.id)}
        onClick={() => { if (!item.disabled) column.onSelect(item.id); }}
      >
        {item.leading}
        <strong>{item.title}</strong>
        {item.subtitle && <small id={`${instanceId}-${column.key}-d-${encodeURIComponent(item.id)}`}>{item.subtitle}</small>}
        {item.badge && <em className="column-browser-badge">{item.badge}</em>}
      </div>;
    })}
  </div>)}</>;
}

export function ColumnBrowser({ label, columns, className }: { label: string; columns: BrowserColumn[]; className?: string }) {
  const instanceId = useId();
  // null = show the deepest column. Only the narrow (drill-in) layout reads this.
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState<Record<string, string>>({});
  const [widths, setWidths] = useState<Record<string, number>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, Map<string, HTMLDivElement>>());
  const pendingFocus = useRef<number | null>(null);
  // Splitter re-runs its layout effect when onResize changes identity; keep one callback per column.
  const resizeHandlers = useRef(new Map<string, (size: number) => void>());
  const onResizeFor = (key: string) => {
    let handler = resizeHandlers.current.get(key);
    if (!handler) {
      handler = (size: number) => setWidths((current) => current[key] === size ? current : { ...current, [key]: size });
      resizeHandlers.current.set(key, handler);
    }
    return handler;
  };
  const shown = Math.min(active ?? columns.length - 1, columns.length - 1);
  const refsFor = (key: string) => {
    let refs = rowRefs.current.get(key);
    if (!refs) { refs = new Map(); rowRefs.current.set(key, refs); }
    return refs;
  };

  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    const column = rootRef.current?.querySelectorAll<HTMLElement>('.column-browser-column')[index];
    const target = column?.querySelector<HTMLElement>('[role="option"][tabindex="0"]') ?? column?.querySelector<HTMLElement>('.column-browser-body');
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });

  const moveTo = (index: number) => {
    if (index < 0 || index >= columns.length) return;
    setActive(index);
    pendingFocus.current = index;
  };
  // Must match the container query in ColumnBrowser.css.
  const narrow = () => (rootRef.current?.clientWidth ?? Infinity) < 900;
  const selectIn = (index: number, id: string, focusNext: boolean) => {
    const column = columns[index];
    if (column.kind !== 'list') return;
    column.onSelect(id);
    // Narrow drills into the next column; wide keeps "deepest" so a later resize shows the detail.
    setActive(narrow() ? index + 1 : null);
    if (focusNext) pendingFocus.current = index + 1;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const column = columns[index];
    const target = event.target as HTMLElement;
    const option = target.closest<HTMLElement>('[role="option"]');
    if (column.kind === 'list' && option) {
      const enabled = column.items.filter((item) => !item.disabled);
      const position = enabled.findIndex((item) => item.id === option.dataset.itemId);
      let next: ColumnItem | undefined;
      if (event.key === 'ArrowDown') next = enabled[Math.min(position + 1, enabled.length - 1)];
      if (event.key === 'ArrowUp') next = enabled[Math.max(position - 1, 0)];
      if (event.key === 'Home') next = enabled[0];
      if (event.key === 'End') next = enabled.at(-1);
      if (next) {
        event.preventDefault();
        setFocused((current) => ({ ...current, [column.key]: next.id }));
        refsFor(column.key).get(next.id)?.focus();
      } else if ((event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') && position >= 0) {
        event.preventDefault();
        selectIn(index, enabled[position].id, true);
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        moveTo(index - 1);
      }
      return;
    }
    // Panels: only the scroll body itself handles arrows, so text fields keep caret keys.
    if (!target.classList.contains('column-browser-body')) return;
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); moveTo(index - 1); }
    if (event.key === 'ArrowRight' && index < columns.length - 1) { event.preventDefault(); moveTo(index + 1); }
  };

  return <div ref={rootRef} className={`column-browser${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
    <div className="column-browser-track">
      {columns.map((column, index) => {
        const headingId = `${instanceId}-${column.key}-heading`;
        const width = column.kind === 'list' ? widths[column.key] ?? 240 : undefined;
        return [<section
          key={column.key}
          className={`column-browser-column column-browser-${column.kind}`}
          data-shown={index === shown || undefined}
          data-stacked={column.kind === 'list' && column.stackedRows || undefined}
          data-testid={column.testId}
          aria-labelledby={headingId}
          style={width ? { flexBasis: width, width } : undefined}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <header className="column-browser-header">
            {index > 0 && <button className="column-browser-back text-button" type="button" onClick={() => moveTo(index - 1)} aria-label={`Back to ${columns[index - 1].label}`}><Icon name="chevronRight" className="rotate-180" size={13} />{columns[index - 1].label}</button>}
            <h2 id={headingId}>{column.kind === 'panel' ? column.title ?? column.label : column.label}</h2>
            {column.header}
            {index < columns.length - 1 && column.kind === 'panel' && <button className="column-browser-forward secondary-button compact" type="button" onClick={() => moveTo(index + 1)}>{columns[index + 1].label}<Icon name="chevronRight" size={13} /></button>}
          </header>
          {column.kind === 'list' ? <>
            {column.adds?.map((add) => <button key={add.testId} className={`column-browser-add${add.selected ? ' selected' : ''}`} type="button" disabled={add.disabled} aria-pressed={add.selected ?? undefined} onClick={() => { add.onClick(); setActive(narrow() ? index + 1 : null); }} data-testid={add.testId}><Icon name="plus" size={13} />{add.label}</button>)}
            <div className="column-browser-options" role="listbox" aria-label={column.label} aria-busy={Boolean(column.loading)}>
              {!column.loading && <ListRows column={{ ...column, onSelect: (id) => selectIn(index, id, false) }} instanceId={instanceId} focusedId={focused[column.key]} setFocusedId={(id) => setFocused((current) => ({ ...current, [column.key]: id }))} rowRefs={refsFor(column.key)} />}
            </div>
            {column.loading ? <p className="column-browser-state" role="status">Loading {column.label}…</p>
              : !column.items.length && <div className="column-browser-state" role="status">{column.emptyState ?? 'Nothing here yet.'}</div>}
            {column.footer && <div className="column-browser-footer">{column.footer}</div>}
          </> : <div className="column-browser-body" tabIndex={0} data-testid={column.bodyTestId}>{column.children}</div>}
        </section>,
        column.kind === 'list' && column.resizeKey
          ? <Splitter key={`${column.key}-splitter`} orientation="vertical" storageKey={column.resizeKey} min={180} max={420} defaultSize={240} onResize={onResizeFor(column.key)} ariaLabel={`Resize ${column.label} column`} className="column-browser-splitter" />
          : null];
      })}
    </div>
  </div>;
}

/** name is the selection identity; label (default name) is what is shown and sorted. */
export type ChecklistRow = { name: string; label?: string; description?: string; checked: boolean; testId: string; actions?: ReactNode };
export type ChecklistGroup = { id: string; label?: string; meta?: ReactNode; rows: ChecklistRow[]; error?: string; disabled?: boolean; emptyText?: string; onChange(selected: string[]): void };

/** Long checkbox list for a list column: filter, name sort, bulk actions, optional collapsible groups. */
export function ColumnChecklist({ noun, groups, filter, onFilterChange, filterLabel, filterPlaceholder, filterTestId, disabled, sortGroups, onSelectAll, onClear, empty }: {
  noun: string; groups: ChecklistGroup[]; filter: string; onFilterChange(value: string): void;
  filterLabel: string; filterPlaceholder?: string; filterTestId?: string; disabled?: boolean; sortGroups?: boolean;
  /** Receives the names currently shown (after filtering). */
  onSelectAll?(shown: string[]): void; onClear?(shown: string[]): void; empty?: ReactNode;
}) {
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const query = filter.trim().toLowerCase();
  const order = (a: string, b: string) => direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
  const visible = groups.map((group) => ({
    ...group,
    shown: group.rows.filter((row) => `${group.label ?? ''} ${row.name} ${row.label ?? ''} ${row.description ?? ''}`.toLowerCase().includes(query)).sort((a, b) => order(a.label ?? a.name, b.label ?? b.name)),
  })).filter((group) => !query || group.shown.length);
  if (sortGroups) visible.sort((a, b) => order(a.label ?? '', b.label ?? ''));
  const shownNames = [...new Set(visible.flatMap((group) => group.shown.map((row) => row.name)))];
  const shownChecked = visible.some((group) => group.shown.some((row) => row.checked));
  const shownWord = query ? ' shown' : '';
  const rows = (group: typeof visible[number]) => <div className="column-check-rows">{group.shown.map((row) => <div className="column-check-row" key={row.name}>
    <label title={row.description ? `${row.label ?? row.name} — ${row.description}` : row.label ?? row.name}>
      <input type="checkbox" checked={row.checked} disabled={disabled || group.disabled} data-testid={row.testId}
        onChange={(event) => group.onChange(event.target.checked ? [...group.rows.filter((item) => item.checked).map((item) => item.name), row.name] : group.rows.filter((item) => item.checked && item.name !== row.name).map((item) => item.name))} />
      <span className="column-check-name">{row.label ?? row.name}</span>
      {row.description && <small>{row.description}</small>}
    </label>
    {row.actions && <span className="column-check-actions">{row.actions}</span>}
  </div>)}</div>;
  return <div className="column-checklist">
    <div className="column-checklist-toolbar">
      <label className="column-checklist-filter"><span className="sr-only">{filterLabel}</span><Icon name="search" size={13} /><input type="search" value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder={filterPlaceholder ?? filterLabel} data-testid={filterTestId} /></label>
      <button className="text-button column-checklist-sort" type="button" onClick={() => setDirection((current) => current === 'asc' ? 'desc' : 'asc')} aria-label={`Sort by name, ${direction === 'asc' ? 'A to Z' : 'Z to A'}`} data-testid="column-checklist-sort">{direction === 'asc' ? 'A→Z' : 'Z→A'}</button>
      {onSelectAll && <button className="text-button" type="button" disabled={disabled || !shownNames.length} onClick={() => onSelectAll(shownNames)} aria-label={`Select all ${query ? 'shown ' : ''}${noun}`}>Select all{shownWord}</button>}
      {onClear && <button className="text-button" type="button" disabled={disabled || !shownChecked} onClick={() => onClear(shownNames)} aria-label={`Clear all ${query ? 'shown ' : ''}${noun}`}>Clear all{shownWord}</button>}
    </div>
    {visible.map((group) => {
      const errorNote = group.error && <p role="alert" className="column-checklist-error">{group.error}</p>;
      if (!group.label) return <div key={group.id} className="column-check-group">{errorNote}{rows(group)}{!group.rows.length && group.emptyText && <p className="column-checklist-empty">{group.emptyText}</p>}</div>;
      const selectedCount = group.rows.filter((row) => row.checked).length;
      return <details key={group.id} className="column-check-group profile-capability-group" open={query ? true : !collapsed[group.id]} onToggle={(event) => { if (!query) { const open = event.currentTarget.open; setCollapsed((current) => ({ ...current, [group.id]: !open })); } }}>
        <summary><strong>{group.label}</strong><span>{selectedCount} of {group.rows.length} selected</span>{group.meta}</summary>
        {errorNote}
        <div className="column-check-group-actions">
          <button className="text-button" type="button" aria-label={`Select all ${query ? 'shown ' : ''}in group: ${group.label}`} disabled={disabled || group.disabled || !group.shown.length} onClick={() => group.onChange([...new Set([...group.rows.filter((row) => row.checked).map((row) => row.name), ...group.shown.map((row) => row.name)])])}>Select all{shownWord}</button>
          <button className="text-button" type="button" aria-label={`Clear ${query ? 'shown ' : ''}group: ${group.label}`} disabled={disabled || group.disabled || !group.shown.some((row) => row.checked)} onClick={() => group.onChange(group.rows.filter((row) => row.checked && !group.shown.some((shown) => shown.name === row.name)).map((row) => row.name))}>Clear{shownWord}</button>
        </div>
        {rows(group)}
        {!group.rows.length && <p className="column-checklist-empty">{group.emptyText ?? 'Nothing listed.'}</p>}
      </details>;
    })}
    {query && !shownNames.length && <p className="column-checklist-empty" role="status">No matching {noun}.</p>}
    {!query && !groups.some((group) => group.rows.length) && empty}
  </div>;
}
