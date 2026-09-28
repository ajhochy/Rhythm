import type { ReactNode } from 'react';
import { ListInspector, type ListInspectorItem } from '../../components/ListInspector';
import { buildColonyRailModel, type ColonyFilters, type ColonyThread } from './model';

export function ColonyRail({ threads, filters, selectedId, loading, error, onFilters, onSelect, detail }: {
  threads: ColonyThread[];
  filters: ColonyFilters;
  selectedId: string | null;
  loading: boolean;
  error?: string;
  onFilters(filters: ColonyFilters): void;
  onSelect(id: string): void;
  detail(thread: ColonyThread | null): ReactNode;
}) {
  const model = buildColonyRailModel(threads, filters);
  const byId = new Map(model.visible.map((row) => [row.thread.id, row.thread]));
  const items: ListInspectorItem[] = model.visible.map((row) => ({
    id: row.thread.id,
    title: row.thread.title?.trim() || 'Untitled task',
    subtitle: row.statusLabel,
    meta: [row.thread.harnessName || row.thread.harness || 'Unknown harness', row.thread.gitBranch].filter(Boolean).join(' · '),
    badge: row.thread.parentId ? 'Worker' : undefined,
    group: row.group,
  }));
  const harnesses = [...new Set(threads.map((thread) => thread.harness).filter((value): value is string => Boolean(value)))].sort();

  return <ListInspector
    label="Bot Crossing tasks"
    className="colony-workspace"
    items={items}
    groups={[
      { id: 'repository', label: 'Repositories' },
      { id: 'workspace', label: 'Other workspaces' },
      { id: 'historical', label: 'Historical locations' },
    ]}
    selectedId={selectedId}
    onSelect={onSelect}
    listWidth={304}
    loading={loading}
    error={error}
    emptyState={threads.length ? 'No results match your filters.' : 'No local tasks were found in the enabled sources.'}
    noResultsState="No results match your filters."
    toolbar={<div className="colony-rail-controls">
      <label className="colony-search"><span>Search</span><input aria-label="Search Bot Crossing tasks" type="search" value={filters.query} onChange={(event) => onFilters({ ...filters, query: event.currentTarget.value })} /></label>
      <label><span>Harness</span><select aria-label="Harness" value={filters.harness[0] ?? ''} onChange={(event) => onFilters({ ...filters, harness: event.currentTarget.value ? [event.currentTarget.value] : [] })}><option value="">All</option>{harnesses.map((harness) => <option key={harness} value={harness}>{harness}</option>)}</select></label>
      <label><span>Status</span><select aria-label="Status" value={filters.activity[0] ?? ''} onChange={(event) => onFilters({ ...filters, activity: event.currentTarget.value ? [event.currentTarget.value] : [] })}><option value="">All</option><option value="working">Working</option><option value="waiting">Waiting on you</option><option value="blocked">Blocked</option><option value="celebrating">Shipped</option><option value="idle">Quiet</option><option value="unknown">Unknown</option></select></label>
      <label className="colony-historical"><input type="checkbox" checked={filters.includeHistorical} onChange={(event) => onFilters({ ...filters, includeHistorical: event.currentTarget.checked })} />Include historical locations</label>
      <div className="colony-counts" aria-live="polite"><span data-testid="colony-active-count">Active {model.counts.active}</span><span data-testid="colony-attention-count">Needs attention {model.counts.needsAttention}</span></div>
    </div>}
    inspector={(item) => detail(item ? byId.get(item.id) ?? null : null)}
  />;
}
