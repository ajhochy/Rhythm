import type Database from 'better-sqlite3';

import {
  MANAGED_CONTEXT_MAX_REFERENCES,
  MANAGED_CONTEXT_MAX_SERIALIZED_BYTES,
  ManagedContextContractError,
  parseManagedContextAppend,
  parseManagedContextEnrollment,
  parseManagedContextManifest,
  parseManagedContextScope,
  parseManagedContextUnsafeCode,
  type ManagedContextAppend,
  ManagedContextEnrollment,
  ManagedContextManifest,
  ManagedContextReference,
  ManagedContextRole,
  ManagedContextScope,
  ManagedContextUnsafeCode,
} from '../contracts/managed_workstream_context_contract';

export interface ManagedContextRecordsPolicy {
  enabled(): boolean;
  dbClient?: 'sqlite' | 'postgres';
  role?: 'all' | 'local' | 'cloud' | 'relay';
}

export interface ManagedContextSnapshot {
  state: 'bound' | 'unbound';
  binding: ManagedContextEnrollment | null;
  manifest: ManagedContextManifest | null;
  manifestRevision: number | null;
  nonreuse: { code: ManagedContextUnsafeCode; markedAt: string } | null;
}

export type ManagedContextPersistenceOutcome =
  | 'recorded'
  | 'unsafe_recorded'
  | 'persistence_unavailable';

export interface ManagedContextPersistenceResult {
  outcome: ManagedContextPersistenceOutcome;
  snapshot: ManagedContextSnapshot | null;
}

export const DISABLED_MANAGED_CONTEXT_RECORDS_POLICY: ManagedContextRecordsPolicy = {
  enabled: () => false,
  dbClient: 'sqlite',
  role: 'local',
};

/**
 * Read-only nonreuse lookup used at the shared SDK dispatch boundary.  This
 * deliberately does not consult the current feature flag or records policy:
 * a session that was once enrolled must never become ordinary merely because
 * the coordinator is now disabled or a later caller omitted managed context.
 *
 * `exceptDispatchId` is only for the just-created managed dispatch.  Its own
 * enrollment is durable before exposure, so the final pre-SDK check excludes
 * that one row while still refusing every earlier enrollment for the same SDK
 * session.  A durable session nonreuse marker is also history for ordinary
 * callers.  The just-created managed dispatch is the one narrow exception:
 * it deliberately writes that marker before its first exposure, so its final
 * guard relies on the enrolled-dispatch query while the early managed guard
 * has already rejected any pre-existing marker.
 */
export function hasManagedSdkSessionHistory(
  db: Database.Database,
  sdkSessionId: string,
  exceptDispatchId?: string,
): boolean {
  if (typeof sdkSessionId !== 'string' || sdkSessionId.length === 0) {
    throw new ManagedContextRepositoryError('managed_context_sdk_session_invalid');
  }
  if (exceptDispatchId !== undefined && (typeof exceptDispatchId !== 'string' || exceptDispatchId.length === 0)) {
    throw new ManagedContextRepositoryError('managed_context_dispatch_invalid');
  }
  const rows = db.prepare(`SELECT id FROM agent_turn_dispatches
    WHERE managed_context_schema_version=1
      AND (managed_context_sdk_session_id=? OR sdk_session_id=?)
      AND (? IS NULL OR id<>?)
    LIMIT 1`).all(
    sdkSessionId,
    sdkSessionId,
    exceptDispatchId ?? null,
    exceptDispatchId ?? null,
  ) as Array<{ id: string }>;
  if (rows.length === 1) return true;

  // A sticky marker preserves the nonreuse boundary even when an old
  // dispatch receipt is unavailable.  Do not treat the current managed
  // dispatch's own pre-exposure marker as prior history; its first guard ran
  // before that marker was written, and its final guard still sees any other
  // durable dispatch above.
  if (exceptDispatchId !== undefined) return false;
  const markers = db.prepare(`SELECT id FROM agent_sessions
    WHERE sdk_session_id=? AND managed_context_nonreuse_code IS NOT NULL
    LIMIT 1`).all(sdkSessionId) as Array<{ id: string }>;
  return markers.length === 1;
}

export class ManagedContextRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface DispatchBindingRow {
  id: string;
  session_id: string;
  sdk_session_id: string | null;
  sdk_user_message_id: string | null;
  managed_context_schema_version: number | null;
  managed_context_owner_user_id: number | null;
  managed_context_project_id: string | null;
  managed_context_workstream_id: string | null;
  managed_context_workstream_revision: number | null;
  managed_context_role: ManagedContextRole | null;
  managed_context_host_epoch: string | null;
  managed_context_sdk_session_id: string | null;
  managed_context_sdk_turn_id: string | null;
  managed_context_manifest_json: string | null;
  managed_context_manifest_revision: number | null;
  managed_context_enrolled_at: string | null;
  session_owner_user_id: number | null;
  session_project_id: string | null;
  session_sdk_session_id: string | null;
  session_parent_session_id: string | null;
  managed_context_nonreuse_code: string | null;
  managed_context_nonreuse_at: string | null;
}

interface WorkstreamRow {
  owner_user_id: number;
  project_id: string;
  state: string;
  revision: number;
}

function sameNullable(left: string | null, right: string | null): boolean {
  return left === right;
}

function exactReferenceKey(reference: ManagedContextReference): string {
  return JSON.stringify(reference);
}

function identityConflicts(
  left: ManagedContextReference,
  right: ManagedContextReference,
): boolean {
  if (exactReferenceKey(left) === exactReferenceKey(right)) return false;
  return left.dependencyId === right.dependencyId || left.canonicalId === right.canonicalId;
}

type StickyMarkerState =
  | { kind: 'absent' }
  | { kind: 'valid'; code: ManagedContextUnsafeCode; markedAt: string }
  | { kind: 'repairable'; code: ManagedContextUnsafeCode | null }
  | { kind: 'invalid' };

function validMarkerTimestamp(value: string | null): value is string {
  if (value === null) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function stickyMarkerState(row: DispatchBindingRow): StickyMarkerState {
  const rawCode = row.managed_context_nonreuse_code;
  const rawTime = row.managed_context_nonreuse_at;
  if (rawCode === null && rawTime === null) return { kind: 'absent' };
  if (rawCode === null) return { kind: 'repairable', code: null };
  let code: ManagedContextUnsafeCode;
  try {
    code = parseManagedContextUnsafeCode(rawCode);
  } catch {
    return { kind: 'invalid' };
  }
  if (!validMarkerTimestamp(rawTime)) return { kind: 'repairable', code };
  return { kind: 'valid', code, markedAt: rawTime };
}

export class ManagedWorkstreamContextRepository {
  constructor(
    private readonly _db: Database.Database,
    private readonly _policy: ManagedContextRecordsPolicy =
      DISABLED_MANAGED_CONTEXT_RECORDS_POLICY,
  ) {}

  enroll(input: unknown): ManagedContextSnapshot {
    this.assertEnabled();
    const enrollment = parseManagedContextEnrollment(input);
    return this._db.transaction(() => {
      const row = this.dispatch(enrollment.dispatchId);
      if (!row) throw new ManagedContextRepositoryError('managed_context_scope_mismatch');
      if (row.managed_context_schema_version !== null) {
        if (!this.matchesStoredBinding(row, enrollment)) {
          throw new ManagedContextRepositoryError('managed_context_binding_ambiguous');
        }
        this.assertLiveBinding(row, enrollment);
        return this.snapshot(row, enrollment);
      }
      this.assertEnrollmentRelationship(row, enrollment);
      const now = new Date().toISOString();
      const empty: ManagedContextManifest = { schemaVersion: 1, references: [] };
      const changed = this._db.prepare(`UPDATE agent_turn_dispatches SET
        managed_context_schema_version=1,
        managed_context_owner_user_id=?, managed_context_project_id=?,
        managed_context_workstream_id=?, managed_context_workstream_revision=?,
        managed_context_role=?, managed_context_host_epoch=?,
        managed_context_sdk_session_id=?, managed_context_sdk_turn_id=?,
        managed_context_manifest_json=?, managed_context_manifest_revision=0,
        managed_context_enrolled_at=?
        WHERE id=? AND managed_context_schema_version IS NULL`).run(
        enrollment.ownerUserId,
        enrollment.projectId,
        enrollment.workstreamId,
        enrollment.workstreamRevision,
        enrollment.role,
        enrollment.hostEpoch,
        enrollment.sdkSessionId,
        enrollment.sdkTurnId,
        JSON.stringify(empty),
        now,
        enrollment.dispatchId,
      ).changes;
      if (changed !== 1) {
        throw new ManagedContextRepositoryError('managed_context_binding_ambiguous');
      }
      const enrolled = this.dispatch(enrollment.dispatchId)!;
      return this.snapshot(enrolled, enrollment);
    }).immediate();
  }

  read(input: unknown): ManagedContextSnapshot | null {
    this.assertEnabled();
    const scope = parseManagedContextScope(input);
    const row = this.dispatch(scope.dispatchId);
    if (!row || !this.matchesStoredBinding(row, scope)) return null;
    if (!this.hasCurrentAuthority(row, scope)) return null;
    return this.snapshot(row, scope);
  }

  append(input: unknown): ManagedContextPersistenceResult {
    this.assertEnabled();
    let parsed: ManagedContextAppend;
    try {
      parsed = parseManagedContextAppend(input);
    } catch (error) {
      if (
        error instanceof ManagedContextContractError &&
        error.detail === 'dependency_overflow'
      ) {
        const candidate = input as { scope?: unknown };
        const overflowScope = parseManagedContextScope(candidate?.scope);
        return this.markUnsafe(overflowScope, 'dependency_overflow');
      }
      throw error;
    }

    try {
      return this._db.transaction(() => this.appendTransaction(parsed)).immediate();
    } catch (error) {
      if (
        error instanceof ManagedContextRepositoryError &&
        error.code === 'managed_context_scope_drift'
      ) {
        return this.markUnsafe(parsed.scope, 'scope_mismatch');
      }
      if (
        error instanceof ManagedContextRepositoryError &&
        error.code === 'managed_context_manifest_malformed'
      ) {
        return this.markUnsafe(parsed.scope, 'manifest_malformed');
      }
      if (error instanceof ManagedContextRepositoryError) throw error;
      return this.markUnsafeAfterFailure(parsed.scope);
    }
  }

  markUnsafe(scopeInput: unknown, codeInput: unknown): ManagedContextPersistenceResult {
    this.assertEnabled();
    const scope = parseManagedContextScope(scopeInput);
    const code = parseManagedContextUnsafeCode(codeInput);
    try {
      return this._db.transaction(() => {
        const row = this.dispatch(scope.dispatchId);
        if (!row || !this.matchesStoredBinding(row, scope)) {
          throw new ManagedContextRepositoryError('managed_context_scope_mismatch');
        }
        this.assertCurrentAuthority(row, scope);
        this.persistStickyUnsafe(scope, code);
        return {
          outcome: 'unsafe_recorded' as const,
          snapshot: this.snapshot(this.dispatch(scope.dispatchId)!, scope),
        };
      }).immediate();
    } catch (error) {
      if (
        error instanceof ManagedContextRepositoryError &&
        error.code === 'managed_context_sticky_malformed'
      ) {
        return { outcome: 'persistence_unavailable', snapshot: null };
      }
      if (error instanceof ManagedContextRepositoryError) throw error;
      return { outcome: 'persistence_unavailable', snapshot: null };
    }
  }

  private assertEnabled(): void {
    if (
      !this._policy.enabled() || this._policy.dbClient !== 'sqlite' ||
      (this._policy.role !== 'local' && this._policy.role !== 'all')
    ) {
      throw new ManagedContextRepositoryError('managed_context_records_disabled');
    }
  }

  private dispatch(dispatchId: string): DispatchBindingRow | null {
    return (this._db.prepare(`SELECT
      d.*,
      s.owner_user_id AS session_owner_user_id,
      s.project_id AS session_project_id,
      s.sdk_session_id AS session_sdk_session_id,
      s.parent_session_id AS session_parent_session_id,
      s.managed_context_nonreuse_code,
      s.managed_context_nonreuse_at
      FROM agent_turn_dispatches d
      JOIN agent_sessions s ON s.id=d.session_id
      WHERE d.id=?`).get(dispatchId) as DispatchBindingRow | undefined) ?? null;
  }

  private workstream(scope: ManagedContextScope): WorkstreamRow | null {
    return (this._db.prepare(`SELECT owner_user_id, project_id, state, revision
      FROM agent_workstreams WHERE id=?`).get(scope.workstreamId) as WorkstreamRow | undefined) ?? null;
  }

  private assertEnrollmentRelationship(
    row: DispatchBindingRow,
    scope: ManagedContextScope,
  ): void {
    if (
      row.session_id !== scope.sessionId ||
      row.session_owner_user_id !== scope.ownerUserId ||
      row.session_project_id !== scope.projectId ||
      row.session_sdk_session_id !== scope.sdkSessionId ||
      row.sdk_session_id !== scope.sdkSessionId ||
      !this.hasRoleRelationship(row, scope, false)
    ) {
      throw new ManagedContextRepositoryError('managed_context_scope_mismatch');
    }
    const workstream = this.workstream(scope);
    if (
      !workstream || workstream.owner_user_id !== scope.ownerUserId ||
      workstream.project_id !== scope.projectId || !this.isAdmissibleWorkstreamState(workstream.state) ||
      workstream.revision !== scope.workstreamRevision
    ) {
      throw new ManagedContextRepositoryError('managed_context_scope_mismatch');
    }
  }

  private hasCurrentAuthority(row: DispatchBindingRow, scope: ManagedContextScope): boolean {
    return row.session_id === scope.sessionId &&
      row.session_owner_user_id === scope.ownerUserId &&
      row.session_project_id === scope.projectId &&
      row.session_sdk_session_id === scope.sdkSessionId &&
      row.sdk_session_id === scope.sdkSessionId &&
      this.hasRoleRelationship(row, scope, true);
  }

  private assertCurrentAuthority(row: DispatchBindingRow, scope: ManagedContextScope): void {
    if (!this.hasCurrentAuthority(row, scope)) {
      throw new ManagedContextRepositoryError('managed_context_scope_mismatch');
    }
  }

  private assertLiveBinding(row: DispatchBindingRow, scope: ManagedContextScope): void {
    if (
      row.session_owner_user_id !== scope.ownerUserId ||
      row.session_project_id !== scope.projectId ||
      row.session_sdk_session_id !== scope.sdkSessionId ||
      row.sdk_session_id !== scope.sdkSessionId ||
      !this.hasRoleRelationship(row, scope, true)
    ) {
      throw new ManagedContextRepositoryError('managed_context_scope_drift');
    }
    const workstream = this.workstream(scope);
    if (
      !workstream || workstream.owner_user_id !== scope.ownerUserId ||
      workstream.project_id !== scope.projectId || !this.isAdmissibleWorkstreamState(workstream.state) ||
      workstream.revision !== scope.workstreamRevision
    ) {
      throw new ManagedContextRepositoryError('managed_context_scope_drift');
    }
  }

  private matchesStoredBinding(row: DispatchBindingRow, scope: ManagedContextScope): boolean {
    return row.managed_context_schema_version === 1 &&
      row.id === scope.dispatchId && row.session_id === scope.sessionId &&
      row.managed_context_owner_user_id === scope.ownerUserId &&
      row.managed_context_project_id === scope.projectId &&
      row.managed_context_workstream_id === scope.workstreamId &&
      row.managed_context_workstream_revision === scope.workstreamRevision &&
      row.managed_context_role === scope.role &&
      row.managed_context_host_epoch === scope.hostEpoch &&
      row.managed_context_sdk_session_id === scope.sdkSessionId &&
      sameNullable(row.managed_context_sdk_turn_id, scope.sdkTurnId);
  }

  private isAdmissibleWorkstreamState(state: string): boolean {
    return state === 'queued' || state === 'running';
  }

  /**
   * Parent records remain root-only.  A worker record additionally proves its
   * local parent edge and a coordinator-owned native job; a role string alone
   * can never turn an arbitrary child into a managed worker.
   */
  private hasRoleRelationship(
    row: DispatchBindingRow,
    scope: ManagedContextScope,
    requireDispatchBinding: boolean,
  ): boolean {
    if (scope.role === 'parent') return row.session_parent_session_id === null;
    if (scope.role !== 'worker' || !row.session_parent_session_id) return false;
    const parent = this._db.prepare(`SELECT id FROM agent_sessions
      WHERE id=? AND owner_user_id=? AND project_id=? AND parent_session_id IS NULL
      LIMIT 2`).all(
      row.session_parent_session_id,
      scope.ownerUserId,
      scope.projectId,
    ) as Array<{ id: string }>;
    if (parent.length !== 1) return false;
    const dispatchClause = requireDispatchBinding
      ? `AND native_dispatch_id=? AND native_sdk_user_message_id=?`
      : '';
    const params: Array<string | number> = [
      scope.ownerUserId,
      scope.workstreamId,
      scope.projectId,
      scope.workstreamRevision,
      scope.hostEpoch,
      scope.sessionId,
      scope.sdkSessionId,
    ];
    if (requireDispatchBinding) params.push(scope.dispatchId, row.sdk_user_message_id ?? '');
    const jobs = this._db.prepare(`SELECT id FROM agent_bridge_jobs
      WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND workstream_project_id=?
        AND workstream_revision=? AND host_epoch=?
        AND native_child_session_id=? AND native_child_sdk_session_id=?
        AND state ${requireDispatchBinding ? "='running'" : "IN ('claimed','running')"}
        ${dispatchClause}
      LIMIT 2`).all(...params) as Array<{ id: string }>;
    return jobs.length === 1;
  }

  private appendTransaction(input: ManagedContextAppend): ManagedContextPersistenceResult {
    const row = this.dispatch(input.scope.dispatchId);
    if (!row) throw new ManagedContextRepositoryError('managed_context_unbound');
    if (!this.matchesStoredBinding(row, input.scope)) {
      throw new ManagedContextRepositoryError(
        row.managed_context_schema_version === null
          ? 'managed_context_unbound'
          : 'managed_context_scope_mismatch',
      );
    }
    this.assertLiveBinding(row, input.scope);
    const incoming = [
      ...input.references,
      ...(input.transitiveManifests ?? []).flatMap((manifest) => manifest.references),
    ];
    for (const reference of incoming) {
      if (
        reference.ownerUserId !== input.scope.ownerUserId ||
        reference.projectId !== input.scope.projectId ||
        reference.workstreamId !== input.scope.workstreamId ||
        reference.workstreamRevision !== input.scope.workstreamRevision
      ) {
        throw new ManagedContextRepositoryError('managed_context_reference_scope_mismatch');
      }
    }
    let current: ManagedContextManifest;
    try {
      current = parseManagedContextManifest(JSON.parse(row.managed_context_manifest_json ?? ''));
    } catch {
      throw new ManagedContextRepositoryError('managed_context_manifest_malformed');
    }
    let conflict = false;
    const exact = new Map(current.references.map((item) => [exactReferenceKey(item), item]));
    for (const candidate of incoming) {
      if ([...exact.values()].some((existing) => identityConflicts(existing, candidate))) {
        conflict = true;
      }
      exact.set(exactReferenceKey(candidate), candidate);
    }
    const references = [...exact.values()].sort((left, right) =>
      exactReferenceKey(left).localeCompare(exactReferenceKey(right)));
    const manifest: ManagedContextManifest = { schemaVersion: 1, references };
    const serialized = JSON.stringify(manifest);
    if (
      references.length > MANAGED_CONTEXT_MAX_REFERENCES ||
      Buffer.byteLength(serialized, 'utf8') > MANAGED_CONTEXT_MAX_SERIALIZED_BYTES ||
      row.managed_context_manifest_revision === null
    ) {
      this.persistStickyUnsafe(input.scope, 'dependency_overflow');
      return {
        outcome: 'unsafe_recorded',
        snapshot: this.snapshot(this.dispatch(input.scope.dispatchId)!, input.scope),
      };
    }
    const changed = serialized !== row.managed_context_manifest_json;
    if (changed) {
      if (row.managed_context_manifest_revision >= Number.MAX_SAFE_INTEGER) {
        this.persistStickyUnsafe(input.scope, 'dependency_overflow');
        return {
          outcome: 'unsafe_recorded',
          snapshot: this.snapshot(this.dispatch(input.scope.dispatchId)!, input.scope),
        };
      }
      const updated = this._db.prepare(`UPDATE agent_turn_dispatches
        SET managed_context_manifest_json=?, managed_context_manifest_revision=managed_context_manifest_revision+1
        WHERE id=? AND managed_context_manifest_revision=?`).run(
        serialized,
        input.scope.dispatchId,
        row.managed_context_manifest_revision,
      ).changes;
      if (updated !== 1) throw new Error('managed_context_cas_failed');
    }
    if (conflict) this.persistStickyUnsafe(input.scope, 'dependency_conflict');
    return {
      outcome: conflict ? 'unsafe_recorded' : 'recorded',
      snapshot: this.snapshot(this.dispatch(input.scope.dispatchId)!, input.scope),
    };
  }

  private persistStickyUnsafe(scope: ManagedContextScope, code: ManagedContextUnsafeCode): void {
    const row = this.dispatch(scope.dispatchId);
    if (!row || !this.matchesStoredBinding(row, scope)) {
      throw new ManagedContextRepositoryError('managed_context_scope_mismatch');
    }
    this.assertCurrentAuthority(row, scope);
    const marker = stickyMarkerState(row);
    if (marker.kind === 'invalid') {
      throw new ManagedContextRepositoryError('managed_context_sticky_malformed');
    }
    const now = new Date().toISOString();
    const storedCode = marker.kind === 'valid' || marker.kind === 'repairable'
      ? marker.code ?? code
      : code;
    const storedAt = marker.kind === 'valid' ? marker.markedAt : now;
    const changed = this._db.prepare(`UPDATE agent_sessions SET
      managed_context_nonreuse_code=?, managed_context_nonreuse_at=?
      WHERE id=? AND owner_user_id=? AND project_id=?`).run(
      storedCode,
      storedAt,
      scope.sessionId,
      scope.ownerUserId,
      scope.projectId,
    ).changes;
    if (changed !== 1) throw new Error('managed_context_session_missing');
    const persisted = this.dispatch(scope.dispatchId);
    if (!persisted || stickyMarkerState(persisted).kind !== 'valid') {
      throw new Error('managed_context_sticky_unreadable');
    }
  }

  private markUnsafeAfterFailure(scope: ManagedContextScope): ManagedContextPersistenceResult {
    try {
      return this.markUnsafe(scope, 'persistence_failure');
    } catch {
      return { outcome: 'persistence_unavailable', snapshot: null };
    }
  }

  private snapshot(
    row: DispatchBindingRow,
    scope: ManagedContextScope,
  ): ManagedContextSnapshot {
    const marker = stickyMarkerState(row);
    if (marker.kind === 'repairable' || marker.kind === 'invalid') {
      return {
        state: 'unbound',
        binding: null,
        manifest: null,
        manifestRevision: null,
        nonreuse: null,
      };
    }
    let manifest: ManagedContextManifest | null = null;
    if (row.managed_context_manifest_json !== null) {
      try {
        manifest = parseManagedContextManifest(JSON.parse(row.managed_context_manifest_json));
      } catch {
        manifest = null;
      }
    }
    const nonreuse: ManagedContextSnapshot['nonreuse'] = marker.kind === 'valid'
      ? { code: marker.code, markedAt: marker.markedAt }
      : null;
    return {
      state: 'bound',
      binding: {
        schemaVersion: 1,
        ...scope,
      },
      manifest,
      manifestRevision: row.managed_context_manifest_revision,
      nonreuse,
    };
  }
}

export type {
  ManagedContextEnrollment,
  ManagedContextManifest,
  ManagedContextReference,
  ManagedContextRole,
  ManagedContextScope,
  ManagedContextUnsafeCode,
};
