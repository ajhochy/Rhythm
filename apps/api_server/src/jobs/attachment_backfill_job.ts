import type Database from 'better-sqlite3';

import { getDb } from '../database/db';
import { appendRelayUpsert } from '../repositories/relay_outbox_repository';
import { hostPartAttachments } from '../services/attachment_hosting';
import { logger } from '../utils/logger';

// One-time move of attachment bytes already embedded in parts_json into the media store.
// Runs after boot in small id windows, yielding between them, so it never competes with
// startup or blocks requests; completion is recorded so later boots skip it entirely.
const DONE_KEY = 'attachments_hosted_v1';
const WINDOW_IDS = 100;

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Re-reads the row inside its own transaction, so a live upsertPart that landed while the job
// yielded is never overwritten with stale parts.
function rewriteMessage(db: Database.Database, id: number): boolean {
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT m.session_id, s.project_id, m.parts_json
        FROM agent_session_messages m
        JOIN agent_sessions s ON s.id = m.session_id
       WHERE m.id = ?`).get(id) as
      | { session_id: string; project_id: string | null; parts_json: string | null }
      | undefined;
    if (!row?.parts_json) return false;
    let parts: unknown;
    try {
      parts = JSON.parse(row.parts_json);
    } catch {
      return false;
    }
    if (!Array.isArray(parts)) return false;
    const session = { id: String(row.session_id), projectId: row.project_id };
    let changed = false;
    const next = parts.map((part: unknown) => {
      if (part === null || typeof part !== 'object') return part;
      const hosted = hostPartAttachments(part as Record<string, unknown>, session);
      if (hosted !== part) changed = true;
      return hosted;
    });
    if (!changed) return false;
    db.prepare(`UPDATE agent_session_messages SET parts_json = ? WHERE id = ?`)
      .run(JSON.stringify(next), id);
    appendRelayUpsert(db, 'agent_session_messages', String(id));
    return true;
  })();
}

export async function backfillHostedAttachments(
  db: Database.Database = getDb(),
): Promise<{ rewritten: number } | null> {
  if (db.prepare(`SELECT key FROM schema_meta WHERE key = ?`).get(DONE_KEY)) return null;
  const { maxId } = db.prepare(
    `SELECT COALESCE(MAX(id), 0) AS maxId FROM agent_session_messages`,
  ).get() as { maxId: number };
  const select = db.prepare(`
    SELECT id FROM agent_session_messages
     WHERE id > ? AND id <= ? AND instr(parts_json, ';base64,') > 0
     ORDER BY id`);
  let rewritten = 0;
  for (let from = 0; from < maxId; from += WINDOW_IDS) {
    // .all(), not .iterate(): better-sqlite3 forbids writes while a cursor is open.
    const ids = select.all(from, from + WINDOW_IDS) as Array<{ id: number }>;
    for (const { id } of ids) {
      if (rewriteMessage(db, id)) rewritten += 1;
      await tick();
    }
    await tick();
  }
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`)
    .run(DONE_KEY, new Date().toISOString());
  return { rewritten };
}

export function startAttachmentBackfill(delayMs = 30_000): void {
  setTimeout(() => {
    backfillHostedAttachments()
      .then((result) => {
        if (result) logger.info(`[attachment-backfill] hosted attachments in ${result.rewritten} message(s)`);
      })
      .catch((error) => logger.warn(`[attachment-backfill] failed (retries next boot): ${String(error)}`));
  }, delayMs).unref();
}
