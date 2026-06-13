import { getDb } from '../database/db';
import type { AgentSessionMessage, StructuredAgentSessionMessage } from '../models/agent_session';

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
}

function rowToModel(row: AgentSessionMessageRow): AgentSessionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as AgentSessionMessage['role'],
    rawText: row.raw_text,
    strippedText: row.stripped_text,
    createdAt: row.created_at,
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
    sessionId: string,
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

    // Check if a row already exists for this (session_id, sdk_message_id) pair.
    // SQLite partial indexes (WHERE sdk_message_id IS NOT NULL) do not support
    // ON CONFLICT clauses in INSERT statements, so we use an explicit
    // check-then-insert-or-update pattern inside a single DB transaction.
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
    return rowToModel(row);
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
    sessionId: string,
    sdkMessageId: string,
    role: 'output' | 'input' | 'system',
    tokensJson: string | null,
    cost: number | null,
  ): void {
    const db = getDb();
    const existing = db.prepare(
      `SELECT id, raw_text FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
    ).get(sessionId, sdkMessageId) as { id: number; raw_text: string } | undefined;

    if (existing) {
      // Only update info-level columns. Do NOT touch parts_json.
      db.prepare(`
        UPDATE agent_session_messages
        SET role = ?, tokens_json = ?, cost = ?
        WHERE session_id = ? AND sdk_message_id = ?
      `).run(role, tokensJson, cost, sessionId, sdkMessageId);
    } else {
      // Row doesn't exist yet — insert a placeholder with NULL parts_json.
      // Parts will be filled in as message.part.updated events arrive.
      db.prepare(`
        INSERT INTO agent_session_messages
          (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, tokens_json, cost)
        VALUES (?, ?, '', '', ?, NULL, ?, ?)
      `).run(sessionId, role, sdkMessageId, tokensJson, cost);
    }
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
    sessionId: string,
    sdkMessageId: string,
    part: Record<string, unknown>,
  ): void {
    const db = getDb();

    // Ensure a row exists for this message. If message.updated hasn't fired yet
    // we create a placeholder with NULL role (filled in later by upsertMessageInfo).
    const existing = db.prepare(
      `SELECT id, parts_json FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
    ).get(sessionId, sdkMessageId) as { id: number; parts_json: string | null } | undefined;

    if (!existing) {
      // Create placeholder row — role will be set by subsequent message.updated.
      db.prepare(`
        INSERT INTO agent_session_messages
          (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, tokens_json, cost)
        VALUES (?, 'output', '', '', ?, '[]', NULL, NULL)
      `).run(sessionId, sdkMessageId);
    }

    // Read current parts array.
    const row = db.prepare(
      `SELECT parts_json, raw_text FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`
    ).get(sessionId, sdkMessageId) as { parts_json: string | null; raw_text: string };

    let parts: Array<Record<string, unknown>> = [];
    if (row.parts_json != null) {
      try {
        parts = JSON.parse(row.parts_json) as Array<Record<string, unknown>>;
      } catch {
        parts = [];
      }
    }

    // Upsert by part id — replace in-place if found, else append.
    const partId = part.id as string | undefined;
    const idx = partId ? parts.findIndex((p) => p.id === partId) : -1;
    if (idx >= 0) {
      parts[idx] = part;
    } else {
      parts.push(part);
    }

    // Rebuild raw_text from text parts.
    const rawText = parts
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');

    db.prepare(`
      UPDATE agent_session_messages
      SET parts_json = ?, raw_text = ?, stripped_text = ?
      WHERE session_id = ? AND sdk_message_id = ?
    `).run(JSON.stringify(parts), rawText, rawText, sessionId, sdkMessageId);
  }

  /**
   * Apply a text-field delta to a part already stored in parts_json.
   * Appends `delta` to `part.field` (typically `part.text`).
   * No-op if the part or message row doesn't exist.
   */
  applyPartDelta(
    sessionId: string,
    sdkMessageId: string,
    partId: string,
    field: string,
    delta: string,
  ): void {
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
  deleteBySdkMessageId(sessionId: string, sdkMessageId: string): number {
    const result = getDb()
      .prepare(`DELETE FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?`)
      .run(sessionId, sdkMessageId);
    return result.changes;
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
