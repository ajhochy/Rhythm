export type ColonyThread = {
  id: string;
  title?: string;
  preview?: string;
  harness?: string;
  harnessName?: string;
  projectName?: string;
  cwd?: string;
  gitBranch?: string;
  activity?: string;
  running?: boolean | null;
  unread?: boolean | null;
  hasError?: boolean;
  prState?: string | null;
  lastActivityAt?: number;
  parentId?: string | null;
  archived?: boolean;
  stale?: boolean;
  checkout?: { repositoryId?: string; missing?: boolean; kind?: string };
};

export type ColonyFilters = {
  query: string;
  harness: string[];
  activity: string[];
  includeHistorical: boolean;
};

export type ColonyRailRow = {
  thread: ColonyThread;
  group: 'repository' | 'workspace' | 'historical';
  statusLabel: string;
  historical: boolean;
  activityKnown: boolean;
};

const text = (thread: ColonyThread) => [thread.title, thread.preview, thread.projectName, thread.cwd, thread.gitBranch, thread.harness, thread.harnessName].filter(Boolean).join(' ').toLocaleLowerCase();
const historical = (thread: ColonyThread) => thread.checkout?.missing === true || !thread.cwd?.trim();
const activity = (thread: ColonyThread, now = Date.now()) => {
  if (thread.hasError) return 'blocked';
  if (thread.running) return 'working';
  if (thread.prState === 'MERGED') return 'celebrating';
  if (thread.unread) return 'waiting';
  if (thread.activity === 'unknown' || thread.running === null || thread.stale === true) return 'unknown';
  if (thread.lastActivityAt && now - thread.lastActivityAt > 3 * 24 * 60 * 60 * 1000) return 'sleeping';
  return 'idle';
};
const statusLabels: Record<string, string> = {
  blocked: 'Blocked', working: 'Working', celebrating: 'Shipped', waiting: 'Waiting on you', unknown: 'Activity unknown', sleeping: 'Dormant', idle: 'Quiet',
};

export function buildColonyRailModel(threads: ColonyThread[], filters: ColonyFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  const harnesses = new Set(filters.harness);
  const activities = new Set(filters.activity);
  const rows: ColonyRailRow[] = threads.map((thread) => {
    const isHistorical = historical(thread);
    const status = activity(thread);
    const known = typeof thread.activity === 'string' && thread.activity !== 'unknown' && thread.running !== null && thread.stale !== true;
    return {
      thread,
      historical: isHistorical,
      activityKnown: known,
      group: isHistorical ? 'historical' : thread.checkout?.repositoryId ? 'repository' : 'workspace',
      statusLabel: isHistorical ? 'Folder missing' : known ? statusLabels[status] : 'Activity unknown',
    };
  });
  const visible = rows.filter((row) => (filters.includeHistorical || !row.historical)
    && (!query || text(row.thread).includes(query))
    && (!harnesses.size || harnesses.has(row.thread.harness ?? 'unknown'))
    && (!activities.size || activities.has(activity(row.thread))));
  const countable = rows.filter((row) => !row.historical && row.activityKnown);
  return {
    rows,
    visible,
    counts: {
      active: countable.filter((row) => row.thread.running === true).length,
      needsAttention: countable.filter((row) => row.thread.hasError === true).length,
    },
  };
}

export function reconcileColonySelection(selectedId: string | null, threads: ColonyThread[]) {
  return selectedId && threads.some((thread) => thread.id === selectedId) ? selectedId : null;
}
