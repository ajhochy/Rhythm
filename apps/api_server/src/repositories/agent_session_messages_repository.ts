import { getDb } from '../database/db';
import type { AgentSessionMessage, StructuredAgentSessionMessage } from '../models/agent_session';
import {
  appendRelayDelete,
  appendRelayUpsert,
} from './relay_outbox_repository';

interface AgentSessionMessageRow {
  id: number;
  session_id: string;
  role: string;
  raw_text: string;
  stripped_text: string;
  created_at: string;
  sdk_message_id: string | null;
  parts_json: string | null;
  tokens_json: string | null;
  cost: number | null;
  info_json: string | null;
}

/** One engine-shaped transcript message: exactly `{ info, parts }`. */
export interface EngineShapedMirrorMessage {
  info: Record<string, unknown>;
  parts: unknown[];
}

export interface EngineShapedMirrorPage {
  messages: EngineShapedMirrorMessage[];
  /**
   * False when any row in the window predates `info_json` (or the session has
   * no mirrored rows at all). Callers must fall back to a live engine read
   * rather than serving a reconstructed shape.
   */
  complete: boolean;
  hasMore: boolean;
}

export interface StructuredAgentSessionMessagePage {
  messages: StructuredAgentSessionMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Normalise a stored timestamp to an unambiguous UTC ISO-8601 instant.
 *
 * `agent_session_messages.created_at` is filled by the column's SQLite DEFAULT
 * `datetime('now')`, which yields `2026-08-05 22:23:01` — UTC, but with NO zone
 * designator. `agent_sessions.created_at` is written from JS and already carries
 * one (`2026-08-05T22:18:21.279Z`), so the API was handing clients two different
 * formats from the same feature.
 *
 * A designator-less string is LOCAL time to most parsers (Dart, `new Date()` in
 * some engines), so every message came out shifted by the reader's UTC offset —
 * seven hours on PDT. That put every REST-loaded message after every live-streamed
 * one and scrambled transcript order. Reported live 2026-08-05.
 *
 * Normalising on READ rather than changing the column fixes existing rows and
 * every consumer at once (desktop chat, session history, messages, mobile) with no
 * migration. Values that already state a zone are returned untouched.
 */
export function toUtcIsoInstant(value: string): string {
  if (!value) return value;
  // Already zoned: trailing Z, or an offset in the TIME portion (never the date's
  // own hyphens).
  if (/[zZ]$/.test(value)) return value;
  const timeIndex = value.search(/[T ]/);
  if (timeIndex >= 0 && /[+-]/.test(value.slice(timeIndex))) return value;
  const isoish = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(`${isoish}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function rowToModel(row: AgentSessionMessageRow): AgentSessionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as AgentSessionMessage['role'],
    rawText: row.raw_text,
    strippedText: row.stripped_text,
    createdAt: toUtcIsoInstant(row.created_at),
    sdkMessageId: row.sdk_message_id ?? null,
    partsJson: row.parts_json ?? null,
    tokensJson: row.tokens_json ?? null,
    cost: row.cost ?? null,
  };
}

/**
 * Apply back-compat shim: legacy rows (parts_json IS NULL) get a synthetic
 * single-element text part so the caller always sees a non-empty parts array.
 */
function rowToStructured(row: AgentSessionMessageRow): StructuredAgentSessionMessage {
  const base = rowToModel(row);
  let parts: unknown[];
  if (row.parts_json != null) {
    try {
      parts = JSON.parse(row.parts_json) as unknown[];
    } catch {
      parts = [{ type: 'text', text: row.raw_text }];
    }
  } else {
    // Legacy back-compat shim
    parts = [{ type: 'text', text: row.raw_text }];
  }

  let tokens: Record<string, unknown> | null = null;
  if (row.tokens_json != null) {
    try {
      tokens = JSON.parse(row.tokens_json) as Record<string, unknown>;
    } catch {
      tokens = null;
    }
  }

  const { partsJson: _p, tokensJson: _t, ...rest } = base;
  void _p; void _t;
  return {
    ...rest,
    parts,
    tokens,
  };
}

export class AgentSessionMessagesRepository {
  /** Latest persisted agent-message timestamp across all sessions. */
  latestPersistedAt(): number | null {
    const row = getDb()
      .prepare('SELECT MAX(created_at) AS created_at FROM agent_session_messages')
      .get() as { created_at: string | null };
    if (!row.created_at) return null;
    const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/.test(row.created_at)
      ? row.created_at
      : `${row.created_at.replace(' ', 'T')}Z`;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }

  append(
    sessionId: string,
    role: 'output' | 'input' | 'system',
    rawText: string,
    strippedText: string,
  ): AgentSessionMessage {
    const result = getDb()
      .prepare(
        `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text)
         VALUES (?, ?, ?, ?)`,
      )
      .run(sessionId, role, rawText, strippedText);
    const row = getDb()
      .prepare(`SELECT * FROM agent_session_messages WHERE id = ?`)
      .get(result.lastInsertRowid) as AgentSessionMessageRow;
    return rowToModel(row);
  }

  /**
   * Upsert a structured message row keyed by (session_id, sdk_message_id).
   * If a row with the same sdk_message_id already exists for this session,
   * it is updated in place (no duplicate created). The unique index
   * idx_asm_sdk_msg enforces this at the DB level.
   *
   * @param sessionId   Local session UUID
   * @param sdkMessageId  SDK message id (e.g. 'msg_abc001')
   * @param role        'output' | 'input' | 'system'
   * @param partsJson   JSON.stringified part array
   * @param tokensJson  JSON.stringified token usage object, or null
   * @param cost        Cost in USD, or null
   */
  upsertStructured(
    sessionId: string | number,
    sdkMessageId: string,
    role: 'output' | 'input' | 'system',
    partsJson: string,
    tokensJson: string | null,
    cost: number | null,
  ): AgentSessionMessage {
    // Extract a plain-text summary from the parts array for raw_text/stripped_text
    // (used by the legacy transcript.append broadcast and preview snippets).
    let rawText = '';
    try {
      const parts = JSON.parse(partsJson) as Array<{ type: string; text?: string }>;
      rawText = parts
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n');
    } catch {
      rawText = '';
    }

    const db = getDb();

    return db.transaction(() => {
      // SQLite partial indexes (WHERE sdk_message_id IS NOT NULL) do not
      // support ON CONFLICT clauses, so use one transactional check + write.
      const existing = db.prepare(
        `SELECT id FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
      ).get(sessionId, sdkMessageId) as { id: number } | undefined;

      if (existing) {
        db.prepare(`
          UPDATE agent_session_messages
          SET role = ?, raw_text = ?, stripped_text = ?, parts_json = ?, tokens_json = ?, cost = ?
          WHERE session_id = ? AND sdk_message_id = ?
        `).run(role, rawText, rawText, partsJson, tokensJson, cost, sessionId, sdkMessageId);
      } else {
        db.prepare(`
          INSERT INTO agent_session_messages
            (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, tokens_json, cost)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(sessionId, role, rawText, rawText, sdkMessageId, partsJson, tokensJson, cost);
      }

      const row = db.prepare(
        `SELECT * FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
      ).get(sessionId, sdkMessageId) as AgentSessionMessageRow;
      appendRelayUpsert(db, 'agent_session_messages', String(row.id));
      return rowToModel(row);
    })();
  }

  /**
   * Upsert info-level fields (role, tokens, cost) for a message row, WITHOUT
   * clobbering parts_json that may have already been accumulated from
   * message.part.updated events (which arrive before or after message.updated).
   *
   * Creates the row if it does not yet exist (parts_json starts as NULL / empty).
   * If the row already has parts_json set, that value is preserved.
   *
   * Used by the message.updated handler — the real UpdatedEventSchema carries
   * only { sessionID, info } with no parts field.
   */
  upsertMessageInfo(
    sessionId: string | number,
    sdkMessageId: string,
    role: 'output' | 'input' | 'system',
    tokensJson: string | null,
    cost: number | null,
    infoJson: string | null = null,
  ): void {
    const db = getDb();
    db.transaction(() => {
      const existing = db.prepare(
        `SELECT id, raw_text FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
      ).get(sessionId, sdkMessageId) as { id: number; raw_text: string } | undefined;

      if (existing) {
        // Only update info-level columns. Do NOT touch parts_json.
        // COALESCE keeps a previously-mirrored info when a later event carries
        // none, so a session never regresses to mirror-incomplete.
        db.prepare(`
          UPDATE agent_session_messages
          SET role = ?, tokens_json = ?, cost = ?, info_json = COALESCE(?, info_json)
          WHERE session_id = ? AND sdk_message_id = ?
        `).run(role, tokensJson, cost, infoJson, sessionId, sdkMessageId);
      } else {
        // Row doesn't exist yet — insert a placeholder with NULL parts_json.
        // Parts will be filled in as message.part.updated events arrive.
        db.prepare(`
          INSERT INTO agent_session_messages
            (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, tokens_json, cost, info_json)
          VALUES (?, ?, '', '', ?, NULL, ?, ?, ?)
        `).run(sessionId, role, sdkMessageId, tokensJson, cost, infoJson);
      }
      const row = db.prepare(
        `SELECT id FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
      ).get(sessionId, sdkMessageId) as { id: number };
      appendRelayUpsert(db, 'agent_session_messages', String(row.id));
    })();
  }

  /**
   * Upsert a single part into the parts_json array for a message row,
   * keyed by part.id. Preserves arrival order for new parts; replaces in-place
   * for existing part ids (idempotent on re-delivery).
   *
   * Creates the row with a minimal placeholder if it does not exist yet
   * (handles the case where message.part.updated arrives before message.updated).
   *
   * @param sessionId     Local session UUID
   * @param sdkMessageId  SDK message id the part belongs to
   * @param part          Full Part object from the event
   */
  upsertPart(
    sessionId: string | number,
    sdkMessageId: string,
    part: Record<string, unknown>,
  ): void {
    const db = getDb();
    db.transaction(() => {
      // Ensure a row exists for this message. If message.updated hasn't fired
      // yet, create a placeholder filled by the later info event.
      const existing = db.prepare(
        `SELECT id, parts_json FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
      ).get(sessionId, sdkMessageId) as { id: number; parts_json: string | null } | undefined;

      if (!existing) {
        db.prepare(`
          INSERT INTO agent_session_messages
            (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, tokens_json, cost)
          VALUES (?, 'output', '', '', ?, '[]', NULL, NULL)
        `).run(sessionId, sdkMessageId);
      }

      const row = db.prepare(
        `SELECT id, parts_json FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
      ).get(sessionId, sdkMessageId) as { id: number; parts_json: string | null };

      let parts: Array<Record<string, unknown>> = [];
      if (row.parts_json != null) {
        try {
          parts = JSON.parse(row.parts_json) as Array<Record<string, unknown>>;
        } catch {
          parts = [];
        }
      }

      const partId = part.id as string | undefined;
      const idx = partId ? parts.findIndex((p) => p.id === partId) : -1;
      if (idx >= 0) parts[idx] = part;
      else parts.push(part);

      const rawText = parts
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n');

      db.prepare(`
        UPDATE agent_session_messages
        SET parts_json = ?, raw_text = ?, stripped_text = ?
        WHERE session_id = ? AND sdk_message_id = ?
      `).run(JSON.stringify(parts), rawText, rawText, sessionId, sdkMessageId);
      appendRelayUpsert(db, 'agent_session_messages', String(row.id));
    })();
  }

  /**
   * Apply a text-field delta to a part already stored in parts_json.
   * Appends `delta` to `part.field` (typically `part.text`).
   * No-op if the part or message row doesn't exist.
   */
  applyPartDelta(
    sessionId: string | number,
    sdkMessageId: string,
    partId: string,
    field: string,
    delta: string,
  ): void {
    // ponytail: deliberately no relay outbox write for per-token deltas; the
    // next full-part upsert is the replication convergence point.
    const db = getDb();
    const row = db.prepare(
      `SELECT parts_json FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
    ).get(sessionId, sdkMessageId) as { parts_json: string | null } | undefined;
    if (!row || row.parts_json == null) return;

    let parts: Array<Record<string, unknown>>;
    try {
      parts = JSON.parse(row.parts_json) as Array<Record<string, unknown>>;
    } catch {
      return;
    }

    const idx = parts.findIndex((p) => p.id === partId);
    if (idx < 0) return;

    const existing = typeof parts[idx][field] === 'string' ? (parts[idx][field] as string) : '';
    parts[idx] = { ...parts[idx], [field]: existing + delta };

    // Also update raw_text if the field that changed is 'text'.
    const rawText =
      field === 'text'
        ? parts
            .filter((p) => p.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text as string)
            .join('\n')
        : undefined;

    if (rawText !== undefined) {
      db.prepare(`
        UPDATE agent_session_messages
        SET parts_json = ?, raw_text = ?, stripped_text = ?
        WHERE session_id = ? AND sdk_message_id = ?
      `).run(JSON.stringify(parts), rawText, rawText, sessionId, sdkMessageId);
    } else {
      db.prepare(`
        UPDATE agent_session_messages
        SET parts_json = ?
        WHERE session_id = ? AND sdk_message_id = ?
      `).run(JSON.stringify(parts), sessionId, sdkMessageId);
    }
  }

  /**
   * Delete the row associated with the given SDK message id.
   * Returns the number of deleted rows (0 or 1).
   */
  deleteBySdkMessageId(sessionId: string | number, sdkMessageId: string): number {
    const db = getDb();
    return db.transaction(() => {
      const row = db.prepare(
        `SELECT id FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`,
      ).get(sessionId, sdkMessageId) as { id: number } | undefined;
      const result = db
        .prepare(`DELETE FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`)
        .run(sessionId, sdkMessageId);
      if (result.changes > 0 && row) {
        appendRelayDelete('agent_session_messages', String(row.id));
      }
      return result.changes;
    })();
  }

  /**
   * Remove a single part from parts_json by part id.
   * No-ops if the message row or part doesn't exist.
   */
  removePart(sessionId: string, sdkMessageId: string, partId: string): void {
    const db = getDb();
    const row = db.prepare(
      `SELECT parts_json FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
    ).get(sessionId, sdkMessageId) as { parts_json: string | null } | undefined;
    if (!row || row.parts_json == null) return;

    let parts: Array<{ id?: string }>;
    try {
      parts = JSON.parse(row.parts_json) as Array<{ id?: string }>;
    } catch {
      return;
    }

    const filtered = parts.filter((p) => p.id !== partId);
    if (filtered.length === parts.length) return; // Part not found — no-op.

    db.prepare(
      `UPDATE agent_session_messages SET parts_json = ? WHERE session_id = ? AND sdk_message_id = ?`
    ).run(JSON.stringify(filtered), sessionId, sdkMessageId);
  }

  /**
   * The `state.input` of one persisted tool part, located by the
   * `{messageID, callID}` pair an engine `permission.asked` carries in its
   * `tool` field.
   *
   * #1322: the permission payload itself does NOT contain the tool's arguments,
   * and for the shell tool its `patterns` hold each parsed command NODE, not the
   * command line — so `curl URL | sh` arrives as `["curl URL", "sh"]` and the
   * pipe is lost. The full text lives on the tool part, which this reaches.
   *
   * Returns null when the part has not been persisted yet (the permission can
   * arrive before `message.part.updated`), so callers must keep their
   * `patterns`-based path as a fallback rather than treat null as "safe".
   */
  findToolPartInput(
    sessionId: string,
    sdkMessageId: string,
    callId: string,
  ): Record<string, unknown> | null {
    const row = getDb()
      .prepare(
        `SELECT parts_json FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`,
      )
      .get(sessionId, sdkMessageId) as { parts_json: string | null } | undefined;
    if (!row?.parts_json) return null;
    let parts: Array<Record<string, unknown>>;
    try {
      parts = JSON.parse(row.parts_json) as Array<Record<string, unknown>>;
    } catch {
      return null;
    }
    if (!Array.isArray(parts)) return null;
    for (const part of parts) {
      if (part?.type !== 'tool' || part.callID !== callId) continue;
      const input = (part.state as Record<string, unknown> | undefined)?.input;
      if (input && typeof input === 'object') return input as Record<string, unknown>;
    }
    return null;
  }

  listBySession(sessionId: string, limit = 200): AgentSessionMessage[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_session_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(sessionId, limit) as AgentSessionMessageRow[];
    return rows.map(rowToModel);
  }

  /**
   * Return messages with parts/tokens deserialized.
   * Legacy rows (parts_json IS NULL) get a synthetic text part.
   */
  listBySessionStructured(sessionId: string, limit = 200): StructuredAgentSessionMessage[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_session_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`,
      )
      .all(sessionId, limit) as AgentSessionMessageRow[];
    return rows.map(rowToStructured);
  }

  /**
   * Return a stable backward-looking transcript window.
   *
   * Rows are selected newest-first by the monotonic local row id, then reversed
   * before returning so clients can render each page in chronological order.
   * [beforeId] is exclusive and points at the first row of the current window.
   */
  listBySessionStructuredPage(
    sessionId: string,
    limit = 50,
    beforeId?: number,
  ): StructuredAgentSessionMessagePage {
    const queryLimit = limit + 1;
    const rows = beforeId === undefined
      ? getDb()
          .prepare(
            `SELECT * FROM agent_session_messages
             WHERE session_id = ?
             ORDER BY id DESC
             LIMIT ?`,
          )
          .all(sessionId, queryLimit) as AgentSessionMessageRow[]
      : getDb()
          .prepare(
            `SELECT * FROM agent_session_messages
             WHERE session_id = ? AND id < ?
             ORDER BY id DESC
             LIMIT ?`,
          )
          .all(sessionId, beforeId, queryLimit) as AgentSessionMessageRow[];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    return {
      messages: pageRows.map(rowToStructured),
      nextCursor:
        hasMore && pageRows.length > 0 ? String(pageRows[0].id) : null,
      hasMore,
    };
  }

  /**
   * A backward-looking transcript window in the *engine's* `session.messages`
   * shape — `[{ info, parts }]`, oldest-first within the page (#1379).
   *
   * The engine's cursor is a message id (`before=<sdk_message_id>`, exclusive),
   * not a local row id, so the caller's cursor is resolved against
   * sdk_message_id before paging on the monotonic local id.
   *
   * `complete: false` means at least one row in the window predates the
   * `info_json` column, so the mirror cannot reproduce the engine shape
   * faithfully — the caller must fall through to a live engine read instead of
   * serving a partial transcript.
   */
  listEngineShapedPage(
    sessionId: string,
    limit = 20,
    beforeSdkMessageId?: string,
  ): EngineShapedMirrorPage {
    const db = getDb();
    let beforeId: number | undefined;
    if (beforeSdkMessageId !== undefined) {
      const anchor = db
        .prepare(
          `SELECT id FROM agent_session_messages
            WHERE session_id = ? AND sdk_message_id = ?`,
        )
        .get(sessionId, beforeSdkMessageId) as { id: number } | undefined;
      // An unknown cursor means the mirror cannot honour the caller's paging
      // position. Fall through to live rather than silently restarting the page.
      if (!anchor) return { messages: [], complete: false, hasMore: false };
      beforeId = anchor.id;
    }

    const queryLimit = limit + 1;
    const rows = (beforeId === undefined
      ? db
          .prepare(
            `SELECT * FROM agent_session_messages
              WHERE session_id = ? AND sdk_message_id IS NOT NULL
              ORDER BY id DESC LIMIT ?`,
          )
          .all(sessionId, queryLimit)
      : db
          .prepare(
            `SELECT * FROM agent_session_messages
              WHERE session_id = ? AND sdk_message_id IS NOT NULL AND id < ?
              ORDER BY id DESC LIMIT ?`,
          )
          .all(sessionId, beforeId, queryLimit)) as AgentSessionMessageRow[];

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    if (pageRows.length === 0) {
      return { messages: [], complete: false, hasMore: false };
    }

    const messages: EngineShapedMirrorMessage[] = [];
    for (const row of pageRows) {
      if (row.info_json == null) return { messages: [], complete: false, hasMore };
      let info: unknown;
      try {
        info = JSON.parse(row.info_json);
      } catch {
        return { messages: [], complete: false, hasMore };
      }
      if (typeof info !== 'object' || info === null || Array.isArray(info)) {
        return { messages: [], complete: false, hasMore };
      }
      messages.push({
        info: info as Record<string, unknown>,
        parts: rowToStructured(row).parts,
      });
    }
    return { messages, complete: true, hasMore };
  }

  deleteBySession(sessionId: string): number {
    const result = getDb()
      .prepare(`DELETE FROM agent_session_messages WHERE session_id = ?`)
      .run(sessionId);
    return result.changes;
  }

  /**
   * Returns true if the session has at least one structured message row
   * (sdk_message_id IS NOT NULL). Used by the session.idle handler to decide
   * whether to skip the legacy transcript.append DB write (which would create
   * a duplicate row when structured parts have already been persisted).
   */
  hasStructuredMessages(sessionId: string): boolean {
    const row = getDb()
      .prepare(
        `SELECT 1 FROM agent_session_messages WHERE session_id = ? AND sdk_message_id IS NOT NULL LIMIT 1`
      )
      .get(sessionId);
    return row != null;
  }
}
