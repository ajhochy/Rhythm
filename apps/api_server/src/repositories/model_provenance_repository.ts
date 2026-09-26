import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { getDb } from '../database/db';
import type {
  DispatchInput,
  DispatchOutcome,
  DispatchRecord,
  ServedStepInput,
  ServedStepRecord,
} from '../models/model_provenance';

type Row = Record<string, string | number | null>;
const fields = ['sdkSessionId', 'sdkUserMessageId', 'origin', 'requestedSource', 'requestedProviderId', 'requestedModelId', 'requestedTier', 'resolvedProviderId', 'resolvedModelId', 'resolvedTier', 'finalProviderId', 'finalModelId', 'reasonCode', 'predecessorId'] as const;
const origins = new Set(['ws_input', 'fallback_redispatch', 'agent_runner', 'delegation', 'delegation_completion', 'approval_continuation', 'prompt_api', 'unspecified']);
const sources = new Set(['turn_override', 'session', 'agent_config', 'agent_default', 'tier', 'fallback_chain', 'caller']);
const outcomes = new Set<DispatchOutcome>(['pending', 'accepted', 'rejected', 'unknown']);
// ponytail: codes are an allowlisted shape, not arbitrary descriptions; add a
// new short code when a caller needs another reason, never copy provider errors.
const safeCode = /^[a-z][a-z0-9_]{0,63}$/;
const safeIdentifier = /^[a-zA-Z0-9._:/@+\-]{1,200}$/;
// #1576 S2 — a provider-reported model/response id is untrusted input, unlike
// the server-owned fields above. Rather than fail the write closed (losing the
// whole step's attribution), an out-of-shape value is replaced with this
// sentinel so a reviewer sees "something served this, shape unrecognized"
// instead of silence or a thrown error mid-stream.
const UNRECOGNIZED_MODEL = '<unrecognized>';

function localOnly(): void {
  if (env.dbClient !== 'sqlite') throw new Error('Model provenance unavailable: local SQLite only');
}

/** Valid identifier, or null — never throws. For provider-supplied strings only. */
function sanitizeIdentifierOrNull(value: unknown): string | null {
  return typeof value === 'string' && safeIdentifier.test(value) ? value : null;
}

function model(row: Row): DispatchRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    sdkSessionId: row.sdk_session_id as string | null,
    sdkUserMessageId: row.sdk_user_message_id as string | null,
    origin: row.origin as DispatchRecord['origin'],
    requestedSource: row.requested_source as DispatchRecord['requestedSource'],
    requestedProviderId: row.requested_provider_id as string | null,
    requestedModelId: row.requested_model_id as string | null,
    requestedTier: row.requested_tier as string | null,
    resolvedProviderId: row.resolved_provider_id as string | null,
    resolvedModelId: row.resolved_model_id as string | null,
    resolvedTier: row.resolved_tier as string | null,
    overrideApplied: row.override_applied === 1,
    downgraded: row.downgraded === 1,
    routeAuthed: row.route_authed === null ? null : row.route_authed === 1,
    finalProviderId: row.final_provider_id as string | null,
    finalModelId: row.final_model_id as string | null,
    reasonCode: row.reason_code as string | null,
    predecessorId: row.predecessor_id as string | null,
    outcome: row.outcome as DispatchOutcome,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function servedStepModel(row: Row): ServedStepRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    sdkMessageId: row.sdk_message_id as string,
    sdkPartId: row.sdk_part_id as string,
    requestModelId: row.request_model_id as string | null,
    servedModelId: row.served_model_id as string,
    servedResponseId: row.served_response_id as string | null,
    createdAt: row.created_at as string,
  };
}

export class ModelProvenanceRepository {
  insert(input: DispatchInput): DispatchRecord {
    localOnly(); // before any getDb/prepare, even on errors
    if (typeof input.sessionId !== 'string' || !safeIdentifier.test(input.sessionId) || !origins.has(input.origin) || !sources.has(input.requestedSource)) throw new Error('Invalid dispatch metadata');
    for (const field of fields) {
      const value = input[field];
      if (value != null && (typeof value !== 'string' || !safeIdentifier.test(value))) throw new Error('Invalid dispatch metadata');
    }
    if (input.reasonCode != null && !safeCode.test(input.reasonCode)) throw new Error('Invalid dispatch reason code');
    const id = randomUUID();
    const now = new Date().toISOString();
    const values = [id, input.sessionId, ...fields.map((field) => input[field] ?? null), input.overrideApplied ? 1 : 0, input.downgraded ? 1 : 0, input.routeAuthed == null ? null : Number(input.routeAuthed), 'pending', now, now];
    getDb().prepare(`INSERT INTO agent_turn_dispatches (
      id, session_id, sdk_session_id, sdk_user_message_id, origin, requested_source,
      requested_provider_id, requested_model_id, requested_tier, resolved_provider_id,
      resolved_model_id, resolved_tier, final_provider_id, final_model_id, reason_code,
      predecessor_id, override_applied, downgraded, route_authed, outcome, created_at, updated_at
    ) VALUES (${Array(values.length).fill('?').join(',')})`).run(...values);
    return this.get(id)!;
  }

  get(id: string): DispatchRecord | null {
    localOnly();
    const row = getDb().prepare('SELECT * FROM agent_turn_dispatches WHERE id = ?').get(id) as Row | undefined;
    return row ? model(row) : null;
  }

  /** SQLite rowid preserves insertion order even for same-millisecond writes. */
  list(sessionId: string, options: { limit?: number; afterId?: string } = {}): DispatchRecord[] {
    localOnly();
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 100)));
    return (getDb().prepare(`SELECT * FROM agent_turn_dispatches WHERE session_id = ?
      AND (? IS NULL OR rowid > (SELECT rowid FROM agent_turn_dispatches WHERE id = ? AND session_id = ?))
      ORDER BY rowid LIMIT ?`)
      .all(sessionId, options.afterId ?? null, options.afterId ?? null, sessionId, limit) as Row[]).map(model);
  }

  /** Only pending attempts can settle. A repeated outcome is idempotent. */
  setOutcome(id: string, outcome: DispatchOutcome, sdkUserMessageId?: string | null): boolean {
    localOnly();
    if (typeof id !== 'string' || !outcomes.has(outcome) || outcome === 'pending' || (sdkUserMessageId != null && (typeof sdkUserMessageId !== 'string' || !safeIdentifier.test(sdkUserMessageId)))) throw new Error('Invalid dispatch outcome');
    const changed = getDb().prepare(`UPDATE agent_turn_dispatches
      SET outcome = ?, sdk_user_message_id = COALESCE(?, sdk_user_message_id), updated_at = ?
      WHERE id = ? AND outcome = 'pending'`).run(outcome, sdkUserMessageId ?? null, new Date().toISOString(), id).changes;
    const current = changed === 1 ? null : this.get(id);
    return changed === 1 || (current?.outcome === outcome && (sdkUserMessageId == null || current.sdkUserMessageId === sdkUserMessageId));
  }

  /** B2 may learn the SDK user message after the dispatch has already settled. */
  linkUserMessage(id: string, sdkUserMessageId: string): boolean {
    localOnly();
    if (typeof id !== 'string' || typeof sdkUserMessageId !== 'string' || !safeIdentifier.test(sdkUserMessageId)) throw new Error('Invalid SDK message id');
    const changed = getDb().prepare(`UPDATE agent_turn_dispatches
      SET sdk_user_message_id = ?, updated_at = ?
      WHERE id = ? AND sdk_user_message_id IS NULL AND outcome != 'rejected'`)
      .run(sdkUserMessageId, new Date().toISOString(), id).changes;
    return changed === 1 || this.get(id)?.sdkUserMessageId === sdkUserMessageId;
  }

  /**
   * #1576 S2 — record one step-finish's served identity. Idempotent: a
   * re-delivered event for the same (session, message, part) leaves exactly
   * one row (UNIQUE constraint + INSERT OR IGNORE). sessionId/sdkMessageId/
   * sdkPartId are server-owned (the bridge's own ids) and fail closed if
   * malformed; servedModelId/servedResponseId/requestModelId are provider-
   * reported and degrade to a sentinel/null rather than throw — losing one
   * step's attribution shape must never break the stream.
   */
  insertServedStep(input: ServedStepInput): ServedStepRecord {
    localOnly();
    if (typeof input.sessionId !== 'string' || !safeIdentifier.test(input.sessionId)) throw new Error('Invalid served step metadata');
    if (typeof input.sdkMessageId !== 'string' || !safeIdentifier.test(input.sdkMessageId)) throw new Error('Invalid served step metadata');
    if (typeof input.sdkPartId !== 'string' || !safeIdentifier.test(input.sdkPartId)) throw new Error('Invalid served step metadata');
    const servedModelId = sanitizeIdentifierOrNull(input.servedModelId) ?? UNRECOGNIZED_MODEL;
    const requestModelId = input.requestModelId == null
      ? null
      : (sanitizeIdentifierOrNull(input.requestModelId) ?? UNRECOGNIZED_MODEL);
    const servedResponseId = sanitizeIdentifierOrNull(input.servedResponseId ?? null);
    const now = new Date().toISOString();
    getDb().prepare(`INSERT OR IGNORE INTO agent_served_steps (
      id, session_id, sdk_message_id, sdk_part_id, request_model_id, served_model_id, served_response_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), input.sessionId, input.sdkMessageId, input.sdkPartId, requestModelId, servedModelId, servedResponseId, now);
    const row = getDb().prepare(`SELECT * FROM agent_served_steps
      WHERE session_id = ? AND sdk_message_id = ? AND sdk_part_id = ?`)
      .get(input.sessionId, input.sdkMessageId, input.sdkPartId) as Row;
    return servedStepModel(row);
  }

  /**
   * Distinct served model ids for a session, in first-seen (insertion) order,
   * plus whether any step's served identity differed from what was requested.
   */
  servedSummary(sessionId: string): { servedModels: string[]; routed: boolean } {
    localOnly();
    if (typeof sessionId !== 'string' || !safeIdentifier.test(sessionId)) throw new Error('Invalid session id');
    const rows = getDb().prepare(`SELECT served_model_id, request_model_id FROM agent_served_steps
      WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as { served_model_id: string; request_model_id: string | null }[];
    const servedModels: string[] = [];
    let routed = false;
    for (const row of rows) {
      if (!servedModels.includes(row.served_model_id)) servedModels.push(row.served_model_id);
      if (row.request_model_id != null && row.request_model_id !== row.served_model_id) routed = true;
    }
    return { servedModels, routed };
  }
}
