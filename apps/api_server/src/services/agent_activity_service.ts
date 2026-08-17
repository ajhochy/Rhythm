import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';

export const AGENT_ACTIVITY_SOURCES = [
  'human',
  'scheduler',
  'webhook',
  'research',
  'cookbook',
  'optimizer',
] as const;

export const AGENT_ACTIVITY_STATUSES = [
  'active',
  'waiting',
  'failed',
  'completed',
] as const;

export type AgentActivitySource = (typeof AGENT_ACTIVITY_SOURCES)[number];
export type AgentActivityStatus = (typeof AGENT_ACTIVITY_STATUSES)[number];

export interface AgentActivityItem {
  id: string;
  source: AgentActivitySource;
  status: AgentActivityStatus;
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

export interface ListAgentActivityOptions {
  /**
   * Authenticated owner scope. When present, every source query is filtered
   * before previews/reports leave the database; NULL-owned system/org records
   * are intentionally excluded.
   */
  userId?: number;
  /**
   * Explicit escape hatch for the trusted, unauthenticated local desktop
   * surface. Callers must opt in so an accidentally omitted userId can never
   * turn a paired/cloud request into a global feed.
   */
  trustedGlobal?: boolean;
  source?: AgentActivitySource;
  profileId?: string;
  projectId?: string;
  status?: AgentActivityStatus;
  cursor?: string;
  limit?: number;
}

export interface AgentActivityPage {
  items: AgentActivityItem[];
  nextCursor: string | null;
}

interface ActivityCursor {
  occurredAt: string;
  id: string;
}

type DbRow = Record<string, unknown>;

interface SelectRowsParams {
  sqlite?: unknown[];
  postgres?: unknown[];
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

function isoValue(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function safeTitle(value: unknown, fallback: string): string {
  const title = stringValue(value)?.trim();
  return title || fallback;
}

export function normalizeAgentActivityStatus(
  rawStatus: unknown,
): AgentActivityStatus {
  const status = String(rawStatus ?? '').trim().toLowerCase();
  if (
    [
      'working',
      'running',
      'gathering',
      'reading',
      'synthesizing',
      'applying',
      'measuring',
      'processing',
    ].includes(status)
  ) {
    return 'active';
  }
  if (
    [
      'pending',
      'queued',
      'starting',
      'waiting',
      'proposed',
      'approved',
      'ready',
    ].includes(status)
  ) {
    return 'waiting';
  }
  if (
    [
      'error',
      'failed',
      'failure',
      'cancelled',
      'canceled',
      'aborted',
      'rejected',
      'reverted',
      'revoked',
      'denied',
    ].includes(status)
  ) {
    return 'failed';
  }
  return 'completed';
}

function encodeCursor(item: Pick<AgentActivityItem, 'occurredAt' | 'id'>): string {
  return Buffer.from(
    JSON.stringify({ occurredAt: item.occurredAt, id: item.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(cursor: string): ActivityCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const occurredAt = isoValue(decoded.occurredAt);
    const id = stringValue(decoded.id);
    if (!occurredAt || !id || Object.keys(decoded).some((key) => !['occurredAt', 'id'].includes(key))) {
      throw new Error('invalid cursor payload');
    }
    return { occurredAt, id };
  } catch {
    throw AppError.badRequest('Invalid agent activity cursor');
  }
}

async function selectRows(
  sqliteSql: string,
  postgresSql = sqliteSql,
  params: SelectRowsParams = {},
): Promise<DbRow[]> {
  if (env.dbClient === 'postgres') {
    const result = await getPostgresPool().query(
      postgresSql,
      params.postgres ?? [],
    );
    return result.rows as DbRow[];
  }
  return getDb()
    .prepare(sqliteSql)
    .all(...(params.sqlite ?? [])) as DbRow[];
}

function compareActivity(left: AgentActivityItem, right: AgentActivityItem): number {
  const timeOrder = right.occurredAt.localeCompare(left.occurredAt);
  return timeOrder !== 0 ? timeOrder : right.id.localeCompare(left.id);
}

function isAfterCursor(item: AgentActivityItem, cursor: ActivityCursor): boolean {
  if (item.occurredAt < cursor.occurredAt) return true;
  if (item.occurredAt > cursor.occurredAt) return false;
  return item.id < cursor.id;
}

function itemFromSession(
  row: DbRow,
  source: AgentActivitySource,
  title: string,
  profileId: string | null,
): AgentActivityItem | null {
  const id = stringValue(row.id);
  const occurredAt = isoValue(row.last_activity_at) ??
    isoValue(row.updated_at) ??
    isoValue(row.created_at);
  if (!id || !occurredAt) return null;
  const status = normalizeAgentActivityStatus(row.status);
  const startedAt = isoValue(row.created_at);
  return {
    id: `${source}:${id}`,
    source,
    status,
    title,
    summary: stringValue(row.last_preview) ?? stringValue(row.status_message),
    occurredAt,
    startedAt,
    completedAt:
      status === 'completed' || status === 'failed' ? occurredAt : null,
    // Mobile chat routes address OpenCode sessions. The activity row id is
    // Rhythm's local agent_sessions primary key, so passing it to the chat
    // router makes an otherwise healthy session look missing.
    sessionId: stringValue(row.sdk_session_id),
    resultUrl: `/agent-sessions/${encodeURIComponent(id)}`,
    profileId,
    projectId: stringValue(row.project_id),
  };
}

async function loadActivityItems(userId: number | null): Promise<AgentActivityItem[]> {
  const sqliteParams = userId === null ? [] : [userId];
  const postgresParams = userId === null ? [] : [userId];
  const params = { sqlite: sqliteParams, postgres: postgresParams };
  const sqliteOwnerWhere = (column: string, hasWhere = false): string =>
    userId === null ? '' : `${hasWhere ? 'AND' : 'WHERE'} ${column} = ?`;
  const postgresOwnerWhere = (column: string, hasWhere = false): string =>
    userId === null ? '' : `${hasWhere ? 'AND' : 'WHERE'} ${column} = $1`;

  const [
    sessionRows,
    scheduledRows,
    webhookRows,
    researchRows,
    cookbookRows,
    proposalRows,
  ] = await Promise.all([
    selectRows(
      `
        SELECT id, sdk_session_id, status, status_message, name, project_id, agent_kind, mcp_role,
               scheduled_task_id, category, is_system, last_preview,
               last_activity_at, created_at, updated_at
        FROM agent_sessions
        ${sqliteOwnerWhere('owner_user_id')}
      `,
      `
        SELECT id, sdk_session_id, status, status_message, name, project_id, agent_kind, mcp_role,
               scheduled_task_id, category, is_system, last_preview,
               last_activity_at, created_at, updated_at
        FROM agent_sessions
        ${postgresOwnerWhere('owner_user_id')}
      `,
      params,
    ),
    selectRows(
      `
        SELECT id, name, description, agent_config_id, last_run_at,
               last_run_status, last_error, created_at, updated_at
        FROM agent_scheduled_tasks
        WHERE last_run_at IS NOT NULL
        ${sqliteOwnerWhere('created_by_user_id', true)}
      `,
      `
        SELECT id, name, description, agent_config_id, last_run_at,
               last_run_status, last_error, created_at, updated_at
        FROM agent_scheduled_tasks
        WHERE last_run_at IS NOT NULL
        ${postgresOwnerWhere('created_by_user_id', true)}
      `,
      params,
    ),
    selectRows(
      `
        SELECT id, name, last_triggered_at, trigger_count, created_at, updated_at
        FROM agent_webhook_endpoints
        WHERE last_triggered_at IS NOT NULL AND trigger_count > 0
        ${sqliteOwnerWhere('created_by_user_id', true)}
      `,
      `
        SELECT id, name, last_triggered_at, trigger_count, created_at, updated_at
        FROM agent_webhook_endpoints
        WHERE last_triggered_at IS NOT NULL AND trigger_count > 0
        ${postgresOwnerWhere('created_by_user_id', true)}
      `,
      params,
    ),
    selectRows(
      `
        SELECT id, query, status, report, error, created_at, updated_at
        FROM agent_research_jobs
        ${sqliteOwnerWhere('requested_by_user_id')}
      `,
      `
        SELECT id, query, status, report, error, created_at, updated_at
        FROM agent_research_jobs
        ${postgresOwnerWhere('requested_by_user_id')}
      `,
      params,
    ),
    selectRows(
      `
        SELECT id, title, description, bound_config_id, created_at, updated_at
        FROM agent_cookbook
        ${sqliteOwnerWhere('owner_user_id')}
      `,
      `
        SELECT id, title, description, bound_config_id, created_at, updated_at
        FROM agent_cookbook
        ${postgresOwnerWhere('owner_user_id')}
      `,
      params,
    ),
    selectRows(
      `
        SELECT id, audit_run_id, status, title, rationale, target_ref,
               created_at, updated_at
        FROM agent_org_proposals
        WHERE audit_run_id IS NOT NULL
        ${sqliteOwnerWhere('owner_user_id', true)}
      `,
      `
        SELECT id, audit_run_id, status, title, rationale, target_ref,
               created_at, updated_at
        FROM agent_org_proposals
        WHERE audit_run_id IS NOT NULL
        ${postgresOwnerWhere('owner_user_id', true)}
      `,
      params,
    ),
  ]);

  const items: AgentActivityItem[] = [];
  const scheduledById = new Map(
    scheduledRows.map((row) => [stringValue(row.id), row] as const),
  );
  const cookbookByTitle = new Map<string, DbRow>();
  for (const recipe of cookbookRows
    .slice()
    .sort((left, right) =>
      (isoValue(right.updated_at) ?? '').localeCompare(
        isoValue(left.updated_at) ?? '',
      ))) {
    const title = stringValue(recipe.title)?.trim().toLowerCase();
    if (title && !cookbookByTitle.has(title)) cookbookByTitle.set(title, recipe);
  }
  const scheduledTaskIdsWithSession = new Set<string>();

  for (const row of sessionRows) {
    const sessionName = safeTitle(row.name, 'Agent session');
    const scheduledTaskId = stringValue(row.scheduled_task_id);
    const category = stringValue(row.category);
    const isOptimizer =
      category === 'self_improvement' ||
      stringValue(row.mcp_role)?.includes('optimizer') === true;
    const recipe = cookbookByTitle.get(sessionName.trim().toLowerCase());

    if (scheduledTaskId) {
      scheduledTaskIdsWithSession.add(scheduledTaskId);
      const task = scheduledById.get(scheduledTaskId);
      const item = itemFromSession(
        row,
        'scheduler',
        safeTitle(task?.name, sessionName),
        stringValue(task?.agent_config_id) ?? stringValue(row.mcp_role) ?? stringValue(row.agent_kind),
      );
      if (item) items.push(item);
      continue;
    }
    if (isOptimizer) {
      const item = itemFromSession(
        row,
        'optimizer',
        sessionName,
        stringValue(row.mcp_role) ?? stringValue(row.agent_kind),
      );
      if (item) items.push(item);
      continue;
    }
    if (recipe) {
      const item = itemFromSession(
        row,
        'cookbook',
        sessionName,
        stringValue(recipe.bound_config_id) ??
          stringValue(row.mcp_role) ??
          stringValue(row.agent_kind),
      );
      if (item) {
        const recipeId = stringValue(recipe.id);
        if (recipeId) item.resultUrl = `/agent-cookbook/${encodeURIComponent(recipeId)}`;
        items.push(item);
      }
      continue;
    }
    if (Number(row.is_system ?? 0) !== 0) continue;
    const item = itemFromSession(
      row,
      'human',
      sessionName,
      stringValue(row.mcp_role) ?? stringValue(row.agent_kind),
    );
    if (item) items.push(item);
  }

  for (const row of scheduledRows) {
    const id = stringValue(row.id);
    const occurredAt = isoValue(row.last_run_at);
    if (!id || !occurredAt || scheduledTaskIdsWithSession.has(id)) continue;
    const status = normalizeAgentActivityStatus(row.last_run_status);
    items.push({
      id: `scheduler:task:${id}:${occurredAt}`,
      source: 'scheduler',
      status,
      title: safeTitle(row.name, 'Scheduled agent run'),
      summary: stringValue(row.last_error) ?? stringValue(row.description),
      occurredAt,
      startedAt: occurredAt,
      completedAt: status === 'active' || status === 'waiting' ? null : occurredAt,
      sessionId: null,
      resultUrl: `/agent-schedules/${encodeURIComponent(id)}`,
      profileId: stringValue(row.agent_config_id),
      projectId: null,
    });
  }

  for (const row of webhookRows) {
    const id = stringValue(row.id);
    const occurredAt = isoValue(row.last_triggered_at);
    if (!id || !occurredAt) continue;
    items.push({
      id: `webhook:${id}:${occurredAt}`,
      source: 'webhook',
      status: 'completed',
      title: safeTitle(row.name, 'Webhook execution'),
      summary: 'Webhook accepted and queued for agent execution.',
      occurredAt,
      startedAt: occurredAt,
      completedAt: occurredAt,
      sessionId: null,
      resultUrl: `/agent-webhooks/${encodeURIComponent(id)}`,
      profileId: null,
      projectId: null,
    });
  }

  for (const row of researchRows) {
    const id = stringValue(row.id);
    const occurredAt = isoValue(row.updated_at) ?? isoValue(row.created_at);
    if (!id || !occurredAt) continue;
    const status = normalizeAgentActivityStatus(row.status);
    items.push({
      id: `research:${id}`,
      source: 'research',
      status,
      title: safeTitle(row.query, 'Research job'),
      summary: stringValue(row.error) ?? stringValue(row.report),
      occurredAt,
      startedAt: isoValue(row.created_at),
      completedAt: status === 'completed' || status === 'failed' ? occurredAt : null,
      sessionId: null,
      resultUrl: `/agent-research/${encodeURIComponent(id)}`,
      profileId: null,
      projectId: null,
    });
  }

  const proposalsByRun = new Map<string, DbRow[]>();
  for (const proposal of proposalRows) {
    const runId = stringValue(proposal.audit_run_id);
    if (!runId) continue;
    const rows = proposalsByRun.get(runId) ?? [];
    rows.push(proposal);
    proposalsByRun.set(runId, rows);
  }
  for (const [runId, proposals] of proposalsByRun) {
    const sorted = proposals.slice().sort((left, right) =>
      (isoValue(right.updated_at) ?? '').localeCompare(
        isoValue(left.updated_at) ?? '',
      ));
    const occurredAt = isoValue(sorted[0]?.updated_at) ??
      isoValue(sorted[0]?.created_at);
    if (!occurredAt) continue;
    const statuses = proposals.map((proposal) =>
      normalizeAgentActivityStatus(proposal.status));
    const status: AgentActivityStatus = statuses.includes('failed')
      ? 'failed'
      : statuses.includes('active')
        ? 'active'
        : statuses.includes('waiting')
          ? 'waiting'
          : 'completed';
    items.push({
      id: `optimizer:${runId}`,
      source: 'optimizer',
      status,
      title: `Organization optimizer run`,
      summary: `${proposals.length} proposal${proposals.length === 1 ? '' : 's'} evaluated`,
      occurredAt,
      startedAt: proposals
        .map((proposal) => isoValue(proposal.created_at))
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null,
      completedAt: status === 'completed' || status === 'failed' ? occurredAt : null,
      sessionId: null,
      resultUrl: `/agent-org-proposals?auditRunId=${encodeURIComponent(runId)}`,
      profileId: 'org-optimizer',
      projectId: null,
    });
  }

  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort(compareActivity);
}

export async function listAgentActivity(
  options: ListAgentActivityOptions = {},
): Promise<AgentActivityPage> {
  if (
    options.userId !== undefined &&
    (!Number.isInteger(options.userId) || options.userId < 1)
  ) {
    throw AppError.badRequest('userId must be a positive integer');
  }
  if (options.userId === undefined && options.trustedGlobal !== true) {
    throw AppError.forbidden(
      'agent activity requires an authenticated user scope',
    );
  }
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const all = await loadActivityItems(options.userId ?? null);
  const filtered = all.filter((item) => {
    if (options.source && item.source !== options.source) return false;
    if (options.status && item.status !== options.status) return false;
    if (options.profileId && item.profileId !== options.profileId) return false;
    if (options.projectId && item.projectId !== options.projectId) return false;
    return !cursor || isAfterCursor(item, cursor);
  });
  const items = filtered.slice(0, limit);
  return {
    items,
    nextCursor:
      filtered.length > limit && items.length > 0
        ? encodeCursor(items[items.length - 1])
        : null,
  };
}
