/**
 * Single place that writes an `agent_notifications` row and pushes it to
 * connected clients. Extracted from NotificationsAgentController so
 * server-side callers (the scheduler's infra-failure notice) raise the exact
 * same notification the `rhythm_notify` tool does, instead of duplicating the
 * INSERT + broadcast pair.
 */
import { getDb } from '../database/db';
import { broadcast } from './ws_gateway';

/** Both columns are surfaced in a compact UI; keep them short. */
export const AGENT_NOTIFICATION_MAX_LENGTH = 200;

function clamp(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= AGENT_NOTIFICATION_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, AGENT_NOTIFICATION_MAX_LENGTH - 1)}…`;
}

/**
 * Persist + broadcast a notification. `title`/`body` are clamped rather than
 * rejected: a caller that assembles a message from an error string must not be
 * able to lose the whole notification to a length check.
 */
export function pushAgentNotification(title: string, body: string): number {
  const safeTitle = clamp(title);
  const safeBody = clamp(body);
  const row = getDb()
    .prepare(`INSERT INTO agent_notifications (title, body) VALUES (?, ?) RETURNING id`)
    .get(safeTitle, safeBody) as { id: number };

  broadcast({ v: 1, type: 'notification.push', id: row.id, title: safeTitle, body: safeBody });
  return row.id;
}
