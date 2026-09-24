import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { getDb } from '../database/db';
import type { DispatchInput, DispatchOutcome, DispatchRecord } from '../models/model_provenance';

type Row = Record<string, string | number | null>;
const fields = ['sdkSessionId', 'sdkUserMessageId', 'origin', 'requestedSource', 'requestedProviderId', 'requestedModelId', 'requestedTier', 'resolvedProviderId', 'resolvedModelId', 'resolvedTier', 'finalProviderId', 'finalModelId', 'reasonCode', 'predecessorId'] as const;
const origins = new Set(['ws_input', 'fallback_redispatch', 'agent_runner', 'delegation', 'delegation_completion', 'approval_continuation', 'prompt_api', 'unspecified']);
const sources = new Set(['turn_override', 'session', 'agent_config', 'agent_default', 'tier', 'fallback_chain', 'caller']);
const outcomes = new Set<DispatchOutcome>(['pending', 'accepted', 'rejected', 'unknown']);
// ponytail: codes are an allowlisted shape, not arbitrary descriptions; add a
// new short code when a caller needs another reason, never copy provider errors.
const safeCode = /^[a-z][a-z0-9_]{0,63}$/;
const safeIdentifier = /^[a-zA-Z0-9._:/@+\-]{1,200}$/;

function localOnly(): void {
  if (env.dbClient !== 'sqlite') throw new Error('Model provenance unavailable: local SQLite only');
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
}
