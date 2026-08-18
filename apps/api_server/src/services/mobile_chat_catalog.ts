import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { toUtcIsoInstant } from '../repositories/agent_session_messages_repository';
import { safeMobileSessionProfileState } from './mobile_profile_catalog';
import {
  canUpdateMobileSessionState,
  hasMobileSessionExecutionBinding,
} from './mobile_session_state_scope';

/**
 * The mirror-served mobile chat catalog (#1379).
 *
 * Every read here is answered entirely from SQLite (`agent_sessions`), which
 * the consolidated `/global/event` ingest keeps current — for desktop-driven
 * and background turns too, not only mobile-initiated ones. Items are
 * assembled from named safe columns rather than scrubbed out of an engine
 * blob, so no host path or secret can reach the phone by construction.
 */

interface MobileChatCatalogRow {
  sdk_session_id: string;
  name: string;
  status: string;
  project_id: string | null;
  project_name: string | null;
  parent_sdk_session_id: string | null;
  archived_at: string | null;
  created_at: string;
  activity_at: string;
}

export interface MobileChatCatalogPage {
  items: Array<Record<string, unknown>>;
  nextCursor: number | null;
}

function timestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  // Zone-normalize first: a designator-less SQLite `datetime('now')` value is
  // read as LOCAL time by Date.parse, which shifts a session by the reader's
  // offset and scrambles list ordering — the same defect class documented on
  // toUtcIsoInstant for transcripts.
  const parsed = Date.parse(toUtcIsoInstant(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

const SELECT_COLUMNS = `
    SELECT session.sdk_session_id, session.name, session.status,
           session.project_id, project_scope.name AS project_name,
           parent.sdk_session_id AS parent_sdk_session_id,
           session.archived_at, session.created_at,
           COALESCE(session.last_activity_at, session.updated_at, session.created_at) AS activity_at
      FROM agent_sessions session
      LEFT JOIN agent_sessions parent ON parent.id = session.parent_session_id
      LEFT JOIN projects project_scope
        ON project_scope.id = session.project_id
       AND project_scope.archived_at IS NULL`;

/**
 * Chat-catalog visibility, matching the desktop `/agent-sessions` contract:
 * user-visible chat sessions only, never system or scheduled rows.
 */
const CHAT_VISIBILITY = `
       AND session.category = 'chat'
       AND session.is_system = 0
       AND session.scheduled_task_id IS NULL
       AND session.sdk_session_id IS NOT NULL`;

const ACTIVITY_ORDER = `
     ORDER BY COALESCE(session.last_activity_at, session.updated_at, session.created_at) DESC,
              session.sdk_session_id DESC`;

/**
 * Collect bound values while emitting the right placeholder per DB client.
 * Static SQL fragments carry no value and are simply concatenated.
 */
function binder() {
  const values: unknown[] = [];
  const postgres = env.dbClient === 'postgres';
  return {
    values,
    bind(value: unknown): string {
      values.push(value);
      return postgres ? `$${values.length}` : '?';
    },
    async rows(sql: string): Promise<MobileChatCatalogRow[]> {
      return postgres
        ? (await getPostgresPool().query<MobileChatCatalogRow>(sql, values)).rows
        : getDb().prepare(sql).all(...values) as MobileChatCatalogRow[];
    },
  };
}

function decorate(
  rows: MobileChatCatalogRow[],
  ownerUserId: number,
  routingProjectId: string,
): Array<Record<string, unknown>> {
  const sessions = new AgentSessionsRepository();
  const configs = new AgentConfigsRepository().list();
  return rows.map((row) => {
    const local = sessions.findBySdkSessionId(row.sdk_session_id);
    return {
      id: row.sdk_session_id,
      title: row.name || 'Untitled chat',
      status: row.status || 'idle',
      ...(row.parent_sdk_session_id
        ? { parentID: row.parent_sdk_session_id }
        : {}),
      time: {
        created: timestamp(row.created_at) ?? 0,
        updated: timestamp(row.activity_at) ?? 0,
        ...(row.archived_at
          ? { archived: timestamp(row.archived_at) ?? 0 }
          : {}),
      },
      projectId: row.project_id?.trim() || null,
      projectName: row.project_name?.trim() || null,
      ...(local &&
          canUpdateMobileSessionState(local, ownerUserId, routingProjectId) &&
          hasMobileSessionExecutionBinding(local)
        ? { rhythm: safeMobileSessionProfileState(local, configs) }
        : {}),
    };
  });
}

function archiveClause(archived: boolean): string {
  return archived
    ? 'AND session.archived_at IS NOT NULL'
    : 'AND session.archived_at IS NULL';
}

/**
 * Cross-project chat discovery for the owner. Includes rows whose project is
 * unknown (created out-of-band) so nothing the owner has disappears from the
 * catalog just because its project could not be resolved.
 */
export async function listOwnerUnscopedMobileChats(input: {
  ownerUserId: number;
  projectId: string;
  archived: boolean;
  cursor: number;
  limit: number;
  sessionId?: string;
}): Promise<MobileChatCatalogPage> {
  const query = binder();
  const owner = query.bind(input.ownerUserId);
  const sessionClause = input.sessionId
    ? `AND session.sdk_session_id = ${query.bind(input.sessionId)}`
    : '';
  const limit = query.bind(input.limit + 1);
  const offset = query.bind(input.cursor);
  const rows = await query.rows(`${SELECT_COLUMNS}
     WHERE session.owner_user_id = ${owner}
       AND (
         session.project_id IS NULL
         OR TRIM(session.project_id) = ''
         OR project_scope.id IS NOT NULL
       )
       ${CHAT_VISIBILITY}
       ${sessionClause}
       ${archiveClause(input.archived)}
     ${ACTIVITY_ORDER}
     LIMIT ${limit} OFFSET ${offset}`);
  return paginate(rows, input);
}

/**
 * Project-scoped chat list — the mirror equivalent of a project-scoped
 * `experimental.session.list`.
 *
 * Only rows whose `project_id` matches are returned. A row with a NULL project
 * is deliberately excluded here: its project is unknown, so claiming it belongs
 * to *this* one would be a guess. Those rows remain reachable through
 * owner-unscoped discovery, which labels them with `routingProjectId`.
 */
export async function listProjectScopedMobileChats(input: {
  ownerUserId: number;
  projectId: string;
  archived: boolean;
  cursor: number;
  limit: number;
  sessionId?: string;
}): Promise<MobileChatCatalogPage> {
  const query = binder();
  const owner = query.bind(input.ownerUserId);
  const project = query.bind(input.projectId);
  const sessionClause = input.sessionId
    ? `AND session.sdk_session_id = ${query.bind(input.sessionId)}`
    : '';
  const limit = query.bind(input.limit + 1);
  const offset = query.bind(input.cursor);
  const rows = await query.rows(`${SELECT_COLUMNS}
     WHERE session.owner_user_id = ${owner}
       AND session.project_id = ${project}
       ${CHAT_VISIBILITY}
       ${sessionClause}
       ${archiveClause(input.archived)}
     ${ACTIVITY_ORDER}
     LIMIT ${limit} OFFSET ${offset}`);
  return paginate(rows, input);
}

/**
 * Children of one session, from the mirror's `parent_session_id` edge.
 *
 * Scoped to the caller's own rows in the caller's own project — the parent is
 * theirs, so its delegated children are their own data. Archived children are
 * included, matching the engine's `session.children`, which does not filter on
 * archive state.
 */
export async function listMobileChatChildren(input: {
  ownerUserId: number;
  projectId: string;
  parentSdkSessionId: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const query = binder();
  const owner = query.bind(input.ownerUserId);
  const project = query.bind(input.projectId);
  const parentId = query.bind(input.parentSdkSessionId);
  const limit = query.bind(input.limit ?? 200);
  const rows = await query.rows(`${SELECT_COLUMNS}
     WHERE session.owner_user_id = ${owner}
       AND session.project_id = ${project}
       AND parent.sdk_session_id = ${parentId}
       ${CHAT_VISIBILITY}
     ${ACTIVITY_ORDER}
     LIMIT ${limit}`);
  return decorate(rows, input.ownerUserId, input.projectId);
}

function paginate(
  rows: MobileChatCatalogRow[],
  input: {
    ownerUserId: number;
    projectId: string;
    cursor: number;
    limit: number;
  },
): MobileChatCatalogPage {
  const hasMore = rows.length > input.limit;
  return {
    items: decorate(
      rows.slice(0, input.limit),
      input.ownerUserId,
      input.projectId,
    ),
    nextCursor: hasMore ? input.cursor + input.limit : null,
  };
}
