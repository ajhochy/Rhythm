export type ActivitySource =
  | 'human'
  | 'scheduler'
  | 'webhook'
  | 'research'
  | 'cookbook'
  | 'optimizer';

export type ActivityStatus =
  | 'active'
  | 'waiting'
  | 'failed'
  | 'completed';

export interface ActivityItem {
  id: string;
  source: ActivitySource;
  status: ActivityStatus;
  title: string;
  summary: string | null;
  occurredAt: string;
  startedAt: string | null;
  completedAt: string | null;
  sessionId: string | null;
  resultUrl: string | null;
  profileId: string | null;
  projectId: string | null;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface ActivityTransport {
  request<T>(
    path: string,
    init: Omit<RequestInit, 'headers'> & {
      headers?: Record<string, string>;
    },
  ): Promise<T>;
}

export interface ActivityFilters {
  source?: ActivitySource;
  status?: ActivityStatus;
  profileId?: string;
  projectId?: string;
  cursor?: string;
  limit?: number;
}

function activityItem(value: unknown): ActivityItem | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    ![
      'human',
      'scheduler',
      'webhook',
      'research',
      'cookbook',
      'optimizer',
    ].includes(String(record.source)) ||
    !['active', 'waiting', 'failed', 'completed'].includes(
      String(record.status),
    ) ||
    typeof record.title !== 'string' ||
    typeof record.occurredAt !== 'string'
  ) {
    return null;
  }
  const optionalString = (key: string): string | null =>
    typeof record[key] === 'string' ? record[key] : null;
  return {
    id: record.id,
    source: record.source as ActivityItem['source'],
    status: record.status as ActivityItem['status'],
    title: record.title,
    summary: optionalString('summary'),
    occurredAt: record.occurredAt,
    startedAt: optionalString('startedAt'),
    completedAt: optionalString('completedAt'),
    sessionId: optionalString('sessionId'),
    resultUrl: optionalString('resultUrl'),
    profileId: optionalString('profileId'),
    projectId: optionalString('projectId'),
  };
}

export function sanitizeActivityCache(value: unknown): ActivityItem[] {
  const source = Array.isArray(value)
    ? value
    : value &&
        typeof value === 'object' &&
        Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  return source
    .map(activityItem)
    .filter((item): item is ActivityItem => item !== null)
    .sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.id.localeCompare(left.id),
    );
}

export function normalizeActivityStatus(rawStatus: string): ActivityStatus {
  const status = rawStatus.trim().toLowerCase();
  if (
    ['working', 'running', 'gathering', 'reading', 'synthesizing'].includes(
      status,
    )
  ) {
    return 'active';
  }
  if (['pending', 'queued', 'starting', 'waiting'].includes(status)) {
    return 'waiting';
  }
  if (
    ['error', 'failed', 'cancelled', 'canceled', 'aborted', 'rejected'].includes(
      status,
    )
  ) {
    return 'failed';
  }
  return 'completed';
}

export function getActivityDeepLink(item: {
  source: ActivitySource;
  sessionId: string | null;
  resultUrl: string | null;
}): string | null {
  if (item.sessionId) {
    return `/agents/chats/${encodeURIComponent(item.sessionId)}`;
  }
  if (!item.resultUrl?.startsWith('/')) return null;
  const routes: [RegExp, string][] = [
    [/^\/agent-research\/([^/?#]+)$/, '/tools/research/$1'],
    [/^\/agent-schedules\/([^/?#]+)$/, '/tools/schedules/$1'],
    [/^\/agent-webhooks\/([^/?#]+)$/, '/tools/webhooks/$1'],
    [/^\/agent-cookbook\/([^/?#]+)$/, '/tools/cookbook/$1'],
    [/^\/agent-org-proposals(?:\?.*)?$/, '/tools/review'],
  ];
  for (const [pattern, replacement] of routes) {
    if (pattern.test(item.resultUrl)) {
      return item.resultUrl.replace(pattern, replacement);
    }
  }
  return null;
}

export async function listActivity(
  transport: ActivityTransport,
  filters: ActivityFilters = {},
): Promise<ActivityPage> {
  const params = new URLSearchParams();
  for (const key of [
    'source',
    'status',
    'profileId',
    'projectId',
    'cursor',
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return transport.request<ActivityPage>(
    `/mobile-gateway/agent-activity${query ? `?${query}` : ''}`,
    { method: 'GET' },
  );
}
