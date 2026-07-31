export type AgentChatLifecycle = 'active' | 'completed' | 'archived';

export interface AgentChatRecord {
  id: string;
  title: string;
  projectId: string | null;
  status: string;
  parentId: string | null;
  archivedAt: number | null;
  updatedAt: number;
  children: AgentChatRecord[];
  interaction?: 'read-only';
  [key: string]: unknown;
}

export interface AgentChatFilter {
  projectId?: string | null;
  lifecycle?: AgentChatLifecycle | 'all';
  activities?: Array<{
    source: string;
    sessionId: string | null;
  }>;
}

const SECRET_KEY_PATTERN =
  /^(?:authorization|accessToken|refreshToken|deviceToken|token|secret|password|pairingCode|codeVerifier|cookie|headers)$/i;

function readString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sessionStatus(record: Record<string, unknown>): string {
  const raw = record.status;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return readString(raw as Record<string, unknown>, 'type') ?? 'idle';
  }
  return 'idle';
}

function lifecycleFor(record: AgentChatRecord): AgentChatLifecycle {
  if (record.archivedAt) return 'archived';
  return ['working', 'busy', 'retry', 'starting', 'running', 'queued'].includes(
    record.status.toLowerCase(),
  )
    ? 'active'
    : 'completed';
}

function normalizeSession(value: unknown): AgentChatRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = readString(source, 'id');
  if (!id) return null;
  const time =
    source.time && typeof source.time === 'object' && !Array.isArray(source.time)
      ? (source.time as Record<string, unknown>)
      : {};
  return {
    ...source,
    id,
    title: readString(source, 'title', 'name') ?? 'Untitled chat',
    projectId: readString(source, 'projectId', 'projectID', 'directory'),
    status: sessionStatus(source),
    parentId: readString(source, 'parentId', 'parentID', 'parentSessionId'),
    archivedAt:
      readNumber(source, 'archivedAt') ?? readNumber(time, 'archived'),
    updatedAt:
      readNumber(source, 'updatedAt') ??
      readNumber(time, 'updated') ??
      readNumber(time, 'created') ??
      0,
    children: [],
  };
}

export function buildAgentChatReadModel(
  sessions: unknown[],
  filter: AgentChatFilter = {},
): AgentChatRecord[] {
  const normalized = sessions
    .map(normalizeSession)
    .filter((session): session is AgentChatRecord => Boolean(session));
  const nonHumanActivitySessionIds = new Set(
    (filter.activities ?? [])
      .filter((activity) =>
        activity.source !== 'human' && Boolean(activity.sessionId))
      .map((activity) => activity.sessionId as string),
  );
  const visible = normalized.filter(
    (session) => !nonHumanActivitySessionIds.has(session.id),
  );
  const byId = new Map(visible.map((session) => [session.id, session]));
  const roots: AgentChatRecord[] = [];

  for (const session of visible) {
    const parent = session.parentId ? byId.get(session.parentId) : undefined;
    if (parent) {
      parent.children.push(session);
    } else {
      roots.push(session);
    }
  }

  const lifecycle = filter.lifecycle ?? 'active';
  const sortTree = (records: AgentChatRecord[]): AgentChatRecord[] =>
    records
      .map((record) => ({
        ...record,
        children: sortTree(record.children),
      }))
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
      );

  return sortTree(
    roots.filter((session) => {
      if (
        filter.projectId &&
        session.projectId !== filter.projectId
      ) {
        return false;
      }
      return lifecycle === 'all' || lifecycleFor(session) === lifecycle;
    }),
  );
}

export function getStableRecoveryEventId(event: unknown): string | null {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  const properties =
    record.properties &&
    typeof record.properties === 'object' &&
    !Array.isArray(record.properties)
      ? (record.properties as Record<string, unknown>)
      : {};
  const explicitId =
    readString(record, 'id', 'eventId', 'eventID') ??
    readString(
      properties,
      'id',
      'eventId',
      'eventID',
      'requestID',
      'requestId',
      'messageID',
      'messageId',
      'partID',
      'partId',
    );
  if (!explicitId) return null;
  const type = readString(record, 'type') ?? 'event';
  const sessionId = readString(
    properties,
    'sessionID',
    'sessionId',
  ) ?? '';
  return `${type}:${sessionId}:${explicitId}`;
}

export function dedupeRecoveryEvents<T>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const id = getStableRecoveryEventId(event);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function getRecoveryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(500 * 2 ** safeAttempt, 30_000);
}

function sanitizeCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeCacheValue);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    output[key] = sanitizeCacheValue(entry);
  }
  return output;
}

export function sanitizeOfflineChatCache<T>(value: T): T {
  return sanitizeCacheValue(value) as T;
}

export function assertOnlineMutation(isOnline: boolean): void {
  if (!isOnline) {
    throw new Error(
      'This action is unavailable offline. Reconnect to your paired Mac and try again.',
    );
  }
}
