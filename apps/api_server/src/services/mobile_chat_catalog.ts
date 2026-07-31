import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';

interface MobileChatCatalogRow {
  sdk_session_id: string;
  name: string;
  status: string;
  parent_sdk_session_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MobileChatCatalogPage {
  items: Array<Record<string, unknown>>;
  nextCursor: number | null;
}

function timestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function listOwnerUnscopedMobileChats(input: {
  ownerUserId: number;
  archived: boolean;
  cursor: number;
  limit: number;
}): Promise<MobileChatCatalogPage> {
  const archiveClause = input.archived
    ? 'session.archived_at IS NOT NULL'
    : 'session.archived_at IS NULL';
  const select = `
    SELECT session.sdk_session_id, session.name, session.status,
           parent.sdk_session_id AS parent_sdk_session_id,
           session.archived_at, session.created_at, session.updated_at
      FROM agent_sessions session
      LEFT JOIN agent_sessions parent ON parent.id = session.parent_session_id
     WHERE session.owner_user_id = %OWNER%
       AND (session.project_id IS NULL OR TRIM(session.project_id) = '')
       AND session.category = 'chat'
       AND session.is_system = 0
       AND session.scheduled_task_id IS NULL
       AND session.sdk_session_id IS NOT NULL
       AND ${archiveClause}
     ORDER BY COALESCE(session.last_activity_at, session.updated_at, session.created_at) DESC,
              session.sdk_session_id DESC
     LIMIT %LIMIT% OFFSET %OFFSET%`;
  const pageSize = input.limit + 1;
  const rows = env.dbClient === 'postgres'
    ? (await getPostgresPool().query<MobileChatCatalogRow>(
        select
          .replace('%OWNER%', '$1')
          .replace('%LIMIT%', '$2')
          .replace('%OFFSET%', '$3'),
        [input.ownerUserId, pageSize, input.cursor],
      )).rows
    : getDb().prepare(
        select
          .replace('%OWNER%', '?')
          .replace('%LIMIT%', '?')
          .replace('%OFFSET%', '?'),
      ).all(input.ownerUserId, pageSize, input.cursor) as MobileChatCatalogRow[];
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit).map((row) => ({
    id: row.sdk_session_id,
    title: row.name || 'Untitled chat',
    status: row.status || 'idle',
    ...(row.parent_sdk_session_id
      ? { parentID: row.parent_sdk_session_id }
      : {}),
    time: {
      created: timestamp(row.created_at) ?? 0,
      updated: timestamp(row.updated_at) ?? 0,
      ...(row.archived_at
        ? { archived: timestamp(row.archived_at) ?? 0 }
        : {}),
    },
    projectId: null,
    interaction: 'read-only',
  }));
  return {
    items,
    nextCursor: hasMore ? input.cursor + input.limit : null,
  };
}
