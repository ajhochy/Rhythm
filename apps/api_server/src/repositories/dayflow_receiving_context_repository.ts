import type Database from 'better-sqlite3';

import {
  parseDayflowCanonicalSourceKey,
  sameDayflowQualifiedEvidenceCandidate,
  type DayflowQualifiedEvidenceCandidate,
} from '../contracts/dayflow_coordinator_reader_contract';
import { parseDayflowWorkstreamReferenceV1 } from '../contracts/dayflow_workstream_reference_contract';

export type DayflowContextUnsafeCode =
  | 'dayflow_dependency_persistence_failure'
  | 'dayflow_receiving_context_changed'
  | 'dayflow_dependency_revalidation_failed'
  | 'dayflow_manifest_malformed'
  | 'dayflow_binding_ambiguous';

export interface DayflowReceivingBinding {
  dispatchId: string;
  ownerUserId: number;
  projectId: string;
  sdkSessionId: string;
  sdkTurnId: string;
  sdkUserMessageId: string;
}

export interface DayflowStoredReceivingDependency {
  binding: DayflowReceivingBinding;
  candidates: DayflowQualifiedEvidenceCandidate[];
}

interface Row {
  dispatch_id: string;
  dispatch_session_id: string;
  sdk_session_id: string | null;
  sdk_user_message_id: string | null;
  route_authed: number | null;
  outcome: string;
  dayflow_context_schema_version: number | null;
  dayflow_context_owner_user_id: number | null;
  dayflow_context_project_id: string | null;
  dayflow_context_sdk_session_id: string | null;
  dayflow_context_sdk_turn_id: string | null;
  dayflow_context_manifest_json: string | null;
  dayflow_context_manifest_revision: number | null;
  dayflow_context_recorded_at: string | null;
  session_owner_user_id: number | null;
  session_project_id: string | null;
  session_sdk_session_id: string | null;
  session_parent_session_id: string | null;
  session_cwd: string;
  session_is_system: number;
  session_category: string;
  dayflow_context_nonreuse_code: string | null;
  dayflow_context_nonreuse_at: string | null;
}

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAX_CANDIDATES = 100;
const MAX_MANIFEST_BYTES = 96_000;

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('dayflow manifest malformed');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new Error('dayflow manifest malformed');
  }
  return record;
}

function parseCandidate(value: unknown): DayflowQualifiedEvidenceCandidate {
  const raw = exactRecord(value, ['reference', 'canonicalContentHash', 'contentHash', 'canonicalSourceKey']);
  if (typeof raw.canonicalContentHash !== 'string' || !HASH.test(raw.canonicalContentHash) ||
      typeof raw.contentHash !== 'string' || !HASH.test(raw.contentHash)) {
    throw new Error('dayflow manifest malformed');
  }
  return {
    reference: parseDayflowWorkstreamReferenceV1(raw.reference),
    canonicalContentHash: raw.canonicalContentHash,
    contentHash: raw.contentHash,
    canonicalSourceKey: parseDayflowCanonicalSourceKey(raw.canonicalSourceKey),
  };
}

function parseManifest(value: string | null, revision: number | null): DayflowQualifiedEvidenceCandidate[] | null {
  if (value === null && revision === null) return [];
  if (typeof value !== 'string' || revision === null || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (Buffer.byteLength(value, 'utf8') > MAX_MANIFEST_BYTES) return null;
  try {
    const raw = exactRecord(JSON.parse(value), ['schemaVersion', 'candidates']);
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.candidates) || raw.candidates.length > MAX_CANDIDATES) return null;
    return raw.candidates.map(parseCandidate);
  } catch {
    return null;
  }
}

function bindingFromRow(row: Row): DayflowReceivingBinding | null {
  if (!ID.test(row.dispatch_id) || !Number.isSafeInteger(row.session_owner_user_id) ||
      (row.session_owner_user_id as number) <= 0 || !row.session_project_id ||
      !ID.test(row.session_project_id) || !row.sdk_session_id || !ID.test(row.sdk_session_id) ||
      !row.sdk_user_message_id || !ID.test(row.sdk_user_message_id)) return null;
  return {
    dispatchId: row.dispatch_id,
    ownerUserId: row.session_owner_user_id as number,
    projectId: row.session_project_id,
    sdkSessionId: row.sdk_session_id,
    sdkTurnId: '',
    sdkUserMessageId: row.sdk_user_message_id,
  };
}

function markerIsValid(row: Row): boolean {
  if (row.dayflow_context_nonreuse_code === null && row.dayflow_context_nonreuse_at === null) return true;
  return false;
}

/**
 * Durable ordinary/Hermes receiving dependencies. This intentionally shares
 * the existing dispatch/session tables but has its own columns and sticky
 * marker; managed workstream enrollment is never inferred or repurposed.
 */
export class DayflowReceivingContextRepository {
  constructor(private readonly db: Database.Database) {}

  activeSessionScope(sdkSessionId: string): { ownerUserId: number; projectId: string; directory: string } | null {
    try {
      const rows = this.db.prepare(`SELECT owner_user_id, project_id, parent_session_id, cwd, is_system, category,
        dayflow_context_nonreuse_code, dayflow_context_nonreuse_at
        FROM agent_sessions WHERE sdk_session_id=? LIMIT 2`).all(sdkSessionId) as Array<{
        owner_user_id: number | null; project_id: string | null; parent_session_id: string | null;
        cwd: string | null;
        is_system: number; category: string; dayflow_context_nonreuse_code: string | null;
        dayflow_context_nonreuse_at: string | null;
      }>;
      const row = rows.length === 1 ? rows[0] : null;
      if (!row || !Number.isSafeInteger(row.owner_user_id) || (row.owner_user_id as number) <= 0 ||
          !row.project_id || !ID.test(row.project_id) || row.parent_session_id !== null ||
          typeof row.cwd !== 'string' || row.cwd.length === 0 || row.cwd.length > 4096 ||
          row.is_system !== 0 || row.category !== 'chat' ||
          row.dayflow_context_nonreuse_code !== null || row.dayflow_context_nonreuse_at !== null) return null;
      return { ownerUserId: row.owner_user_id as number, projectId: row.project_id, directory: row.cwd };
    } catch {
      return null;
    }
  }

  resolve(input: DayflowReceivingBinding): DayflowReceivingBinding | null {
    const row = this.row(input.dispatchId);
    if (!row || !this.matchesLiveDispatch(row, input) || !markerIsValid(row)) return null;
    if (row.dayflow_context_schema_version !== null && !this.matchesStoredBinding(row, input)) return null;
    if (row.dayflow_context_schema_version !== null && parseManifest(
      row.dayflow_context_manifest_json,
      row.dayflow_context_manifest_revision,
    ) === null) return null;
    return input;
  }

  findByActiveTool(input: {
    ownerUserId: number;
    sdkSessionId: string;
    sdkTurnId: string;
    sdkUserMessageId: string;
  }): DayflowReceivingBinding | null {
    try {
      const rows = this.db.prepare(`SELECT
        d.id AS dispatch_id, d.session_id AS dispatch_session_id, d.sdk_session_id,
        d.sdk_user_message_id, d.route_authed, d.outcome,
        d.dayflow_context_schema_version, d.dayflow_context_owner_user_id,
        d.dayflow_context_project_id, d.dayflow_context_sdk_session_id,
        d.dayflow_context_sdk_turn_id, d.dayflow_context_manifest_json,
        d.dayflow_context_manifest_revision, d.dayflow_context_recorded_at,
        s.owner_user_id AS session_owner_user_id, s.project_id AS session_project_id,
        s.sdk_session_id AS session_sdk_session_id, s.parent_session_id AS session_parent_session_id,
        s.cwd AS session_cwd, s.is_system AS session_is_system, s.category AS session_category,
        s.dayflow_context_nonreuse_code, s.dayflow_context_nonreuse_at
        FROM agent_turn_dispatches d JOIN agent_sessions s ON s.id=d.session_id
        WHERE d.sdk_session_id=? AND d.sdk_user_message_id=? LIMIT 2`)
        .all(input.sdkSessionId, input.sdkUserMessageId) as Row[];
      if (rows.length !== 1) return null;
      const base = bindingFromRow(rows[0]);
      if (!base) return null;
      const binding = { ...base, sdkTurnId: input.sdkTurnId };
      return binding.ownerUserId === input.ownerUserId ? this.resolve(binding) : null;
    } catch {
      return null;
    }
  }

  directory(input: DayflowReceivingBinding): string | null {
    const row = this.row(input.dispatchId);
    return row && this.matchesLiveDispatch(row, input) &&
      typeof row.session_cwd === 'string' && row.session_cwd.length > 0
      ? row.session_cwd
      : null;
  }

  /**
   * Final local admission after a producer re-read. This is intentionally
   * synchronous and uses only existing server-owned dispatch/session storage:
   * a durable turn revoke, changed owner/project/session binding, malformed
   * manifest, or sticky marker therefore fails before response construction.
   */
  finalAdmissionCurrent(
    input: DayflowReceivingBinding,
    expected: readonly DayflowQualifiedEvidenceCandidate[],
  ): boolean {
    let admitted: DayflowQualifiedEvidenceCandidate[];
    try { admitted = expected.map(parseCandidate); }
    catch { return false; }
    try {
      const row = this.row(input.dispatchId);
      if (!row || !this.matchesLiveDispatch(row, input) || !markerIsValid(row)) return false;
      const stored = parseManifest(row.dayflow_context_manifest_json, row.dayflow_context_manifest_revision);
      if (stored === null) return false;
      if (row.dayflow_context_schema_version === null) return admitted.length === 0;
      return this.matchesStoredBinding(row, input) && admitted.every((candidate) =>
        stored.some((retained) => sameDayflowQualifiedEvidenceCandidate(retained, candidate)));
    } catch {
      return false;
    }
  }

  append(input: DayflowReceivingBinding, candidates: readonly DayflowQualifiedEvidenceCandidate[]): boolean {
    let admitted: DayflowQualifiedEvidenceCandidate[];
    try { admitted = candidates.map(parseCandidate); }
    catch { return false; }
    if (admitted.length === 0 || admitted.length > MAX_CANDIDATES ||
        admitted.some((candidate) => candidate.reference.ownerUserId !== input.ownerUserId ||
          candidate.reference.projectId !== input.projectId || candidate.reference.eligibility !== 'active' ||
          Date.parse(candidate.reference.expiresAt) <= Date.now())) return false;
    try {
      return this.db.transaction(() => {
        const row = this.row(input.dispatchId);
        const boundInput = { ...input, sdkUserMessageId: row?.sdk_user_message_id ?? '' };
        if (!row || !this.matchesLiveDispatch(row, boundInput) || !markerIsValid(row)) return false;
        const existing = parseManifest(row.dayflow_context_manifest_json, row.dayflow_context_manifest_revision);
        if (existing === null) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_manifest_malformed');
          return false;
        }
        if (row.dayflow_context_schema_version !== null && !this.matchesStoredBinding(row, boundInput)) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_binding_ambiguous');
          return false;
        }
        const next = [...existing];
        for (const candidate of admitted) {
          const conflicting = next.find((current) =>
            (current.canonicalSourceKey === candidate.canonicalSourceKey ||
              current.reference.canonicalId === candidate.reference.canonicalId) &&
            !sameDayflowQualifiedEvidenceCandidate(current, candidate));
          if (conflicting) {
            this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_binding_ambiguous');
            return false;
          }
          if (!next.some((current) => sameDayflowQualifiedEvidenceCandidate(current, candidate))) next.push(candidate);
        }
        if (next.length > MAX_CANDIDATES) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_dependency_persistence_failure');
          return false;
        }
        const manifest = JSON.stringify({ schemaVersion: 1, candidates: next });
        if (Buffer.byteLength(manifest, 'utf8') > MAX_MANIFEST_BYTES) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_dependency_persistence_failure');
          return false;
        }
        const revision = row.dayflow_context_manifest_revision ?? 0;
        const now = new Date().toISOString();
        const changed = this.db.prepare(`UPDATE agent_turn_dispatches SET
          dayflow_context_schema_version=1,
          dayflow_context_owner_user_id=?, dayflow_context_project_id=?,
          dayflow_context_sdk_session_id=?, dayflow_context_sdk_turn_id=?,
          dayflow_context_manifest_json=?, dayflow_context_manifest_revision=?,
          dayflow_context_recorded_at=?
          WHERE id=?
            AND (dayflow_context_schema_version IS NULL OR (
              dayflow_context_schema_version=1 AND dayflow_context_owner_user_id=?
              AND dayflow_context_project_id=? AND dayflow_context_sdk_session_id=?
              AND dayflow_context_sdk_turn_id=? AND dayflow_context_manifest_revision=?))`).run(
          boundInput.ownerUserId, boundInput.projectId, boundInput.sdkSessionId, boundInput.sdkTurnId,
          manifest, revision + 1, now, input.dispatchId,
          boundInput.ownerUserId, boundInput.projectId, boundInput.sdkSessionId, boundInput.sdkTurnId, revision,
        ).changes;
        if (changed !== 1) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_dependency_persistence_failure');
          return false;
        }
        return true;
      })();
    } catch {
      return false;
    }
  }

  markUnsafe(input: Pick<DayflowReceivingBinding, 'dispatchId'>, code: DayflowContextUnsafeCode): boolean {
    try {
      const row = this.row(input.dispatchId);
      if (!row) return false;
      return this.markUnsafeForSession(row.dispatch_session_id, code);
    } catch {
      return false;
    }
  }

  markSdkUnsafe(sdkSessionId: string, code: DayflowContextUnsafeCode): boolean {
    try {
      const rows = this.db.prepare(`SELECT id FROM agent_sessions WHERE sdk_session_id=? LIMIT 2`)
        .all(sdkSessionId) as Array<{ id: string }>;
      return rows.length === 1 && this.markUnsafeForSession(rows[0].id, code);
    } catch {
      return false;
    }
  }

  listSdkHistory(sdkSessionId: string): DayflowStoredReceivingDependency[] | null {
    try {
      // A marker may exist even when persistence failed before a manifest row
      // was written. Do not turn that sticky unsafe state into an empty safe
      // history on the next SDK operation.
      if (!this.activeSessionScope(sdkSessionId)) return null;
      const rows = this.db.prepare(`SELECT
        d.id AS dispatch_id, d.session_id AS dispatch_session_id, d.sdk_session_id,
        d.sdk_user_message_id, d.route_authed, d.outcome,
        d.dayflow_context_schema_version, d.dayflow_context_owner_user_id,
        d.dayflow_context_project_id, d.dayflow_context_sdk_session_id,
        d.dayflow_context_sdk_turn_id, d.dayflow_context_manifest_json,
        d.dayflow_context_manifest_revision, d.dayflow_context_recorded_at,
        s.owner_user_id AS session_owner_user_id, s.project_id AS session_project_id,
        s.sdk_session_id AS session_sdk_session_id, s.parent_session_id AS session_parent_session_id,
        s.cwd AS session_cwd,
        s.is_system AS session_is_system, s.category AS session_category,
        s.dayflow_context_nonreuse_code, s.dayflow_context_nonreuse_at
        FROM agent_turn_dispatches d JOIN agent_sessions s ON s.id=d.session_id
        WHERE d.dayflow_context_schema_version=1
          AND (d.dayflow_context_sdk_session_id=? OR d.sdk_session_id=?)
        ORDER BY d.rowid`).all(sdkSessionId, sdkSessionId) as Row[];
      if (rows.length === 0) return [];
      const result: DayflowStoredReceivingDependency[] = [];
      for (const row of rows) {
        const base = bindingFromRow(row);
        if (!base || !markerIsValid(row) || row.dayflow_context_schema_version !== 1 ||
            !row.dayflow_context_sdk_turn_id || !this.matchesStoredBinding(row, {
              ...base,
              sdkTurnId: row.dayflow_context_sdk_turn_id,
            })) return null;
        const candidates = parseManifest(row.dayflow_context_manifest_json, row.dayflow_context_manifest_revision);
        if (!candidates || candidates.length === 0) return null;
        result.push({ binding: { ...base, sdkTurnId: row.dayflow_context_sdk_turn_id }, candidates });
      }
      return result;
    } catch {
      return null;
    }
  }

  private row(dispatchId: string): Row | null {
    const rows = this.db.prepare(`SELECT
      d.id AS dispatch_id, d.session_id AS dispatch_session_id, d.sdk_session_id,
      d.sdk_user_message_id, d.route_authed, d.outcome,
      d.dayflow_context_schema_version, d.dayflow_context_owner_user_id,
      d.dayflow_context_project_id, d.dayflow_context_sdk_session_id,
      d.dayflow_context_sdk_turn_id, d.dayflow_context_manifest_json,
      d.dayflow_context_manifest_revision, d.dayflow_context_recorded_at,
      s.owner_user_id AS session_owner_user_id, s.project_id AS session_project_id,
      s.sdk_session_id AS session_sdk_session_id, s.parent_session_id AS session_parent_session_id,
      s.cwd AS session_cwd,
      s.is_system AS session_is_system, s.category AS session_category,
      s.dayflow_context_nonreuse_code, s.dayflow_context_nonreuse_at
      FROM agent_turn_dispatches d JOIN agent_sessions s ON s.id=d.session_id
      WHERE d.id=? LIMIT 2`).all(dispatchId) as Row[];
    return rows.length === 1 ? rows[0] : null;
  }

  private matchesLiveDispatch(row: Row, input: DayflowReceivingBinding): boolean {
    return row.dispatch_id === input.dispatchId && row.sdk_session_id === input.sdkSessionId &&
      row.sdk_user_message_id === input.sdkUserMessageId && row.route_authed === 1 &&
      (row.outcome === 'pending' || row.outcome === 'accepted') &&
      row.session_owner_user_id === input.ownerUserId && row.session_project_id === input.projectId &&
      row.session_sdk_session_id === input.sdkSessionId && row.session_parent_session_id === null &&
      row.session_is_system === 0 && row.session_category === 'chat';
  }

  private matchesStoredBinding(row: Row, input: DayflowReceivingBinding): boolean {
    return row.dayflow_context_schema_version === 1 &&
      row.dayflow_context_owner_user_id === input.ownerUserId &&
      row.dayflow_context_project_id === input.projectId &&
      row.dayflow_context_sdk_session_id === input.sdkSessionId &&
      row.dayflow_context_sdk_turn_id === input.sdkTurnId;
  }

  private markUnsafeForSession(sessionId: string, code: DayflowContextUnsafeCode): boolean {
    const changed = this.db.prepare(`UPDATE agent_sessions SET
      dayflow_context_nonreuse_code=COALESCE(dayflow_context_nonreuse_code, ?),
      dayflow_context_nonreuse_at=COALESCE(dayflow_context_nonreuse_at, ?)
      WHERE id=?`).run(code, new Date().toISOString(), sessionId).changes;
    return changed === 1;
  }
}

/** Read-only SDK boundary classifier; feature flags cannot erase this history. */
export function hasDayflowSdkSessionHistory(
  db: Database.Database,
  sdkSessionId: string,
): boolean {
  if (typeof sdkSessionId !== 'string' || !ID.test(sdkSessionId)) {
    throw new Error('dayflow_context_sdk_session_invalid');
  }
  const dispatch = db.prepare(`SELECT id FROM agent_turn_dispatches
    WHERE dayflow_context_schema_version=1
      AND (dayflow_context_sdk_session_id=? OR sdk_session_id=?) LIMIT 1`)
    .all(sdkSessionId, sdkSessionId) as Array<{ id: string }>;
  if (dispatch.length === 1) return true;
  const markers = db.prepare(`SELECT id FROM agent_sessions
    WHERE sdk_session_id=? AND dayflow_context_nonreuse_code IS NOT NULL LIMIT 1`)
    .all(sdkSessionId) as Array<{ id: string }>;
  return markers.length === 1;
}
