import type Database from 'better-sqlite3';

import {
  parseDayflowCanonicalSourceKey,
  sameDayflowQualifiedEvidenceCandidate,
  type DayflowQualifiedEvidenceCandidate,
} from '../contracts/dayflow_coordinator_reader_contract';
import { parseCoordinatorCallbackMarker } from '../contracts/coordinator_callback_marker';
import { parseDayflowWorkstreamReferenceV1 } from '../contracts/dayflow_workstream_reference_contract';
import { CoordinatorConversationsRepository } from './coordinator_conversations_repository';

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

export interface DayflowProviderSessionScope {
  sessionId: string;
  ownerUserId: number;
  projectId: string;
  directory: string;
  sdkSessionId: string;
  profileId: string | null;
  /** Nonarchived, nonchild, nonsystem chat. */
  rootChat: boolean;
  /** Recognized sticky raw-history-unsafe marker, if any (never cleared here). */
  unsafeCode: string | null;
}

/** The typed receiver of one actual native user message (never a fabricated tool identity). */
export type DayflowProviderReceiver =
  | { kind: 'foreground'; dispatchId: string; sdkUserMessageId: string }
  | {
    kind: 'delegation_callback'; dispatchId: string; sdkUserMessageId: string;
    goalId: string; delegationId: string; childSessionId: string;
  };

export interface DayflowProviderDependency {
  binding: DayflowReceivingBinding;
  /** V1 tool-turn candidates (anchor: the assistant turn id in `binding.sdkTurnId`). */
  v1Candidates: DayflowQualifiedEvidenceCandidate[];
  /** V2 provider-exposure candidates (anchor: the native user message). */
  v2Candidates: DayflowQualifiedEvidenceCandidate[];
  v2UserMessageId: string | null;
}

export type DayflowProviderHistory =
  | { state: 'none' }
  | { state: 'ok'; entries: DayflowProviderDependency[]; marker: string | null }
  | { state: 'ambiguous' };

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

/**
 * V1 manifests are `{schemaVersion:1, candidates}` bound to an assistant tool
 * turn. The additive V2 provider exposure is one optional `userExposure`
 * beside it, bound to the dispatch's own native user message (no invented tool
 * turn). V1-only rows keep their exact bytes; both kinds share the 100
 * reference / 96 KiB bound.
 */
interface ParsedManifest {
  candidates: DayflowQualifiedEvidenceCandidate[];
  exposure: { userMessageId: string; candidates: DayflowQualifiedEvidenceCandidate[] } | null;
}

function parseManifestFull(value: string | null, revision: number | null): ParsedManifest | null {
  if (value === null && revision === null) return { candidates: [], exposure: null };
  if (typeof value !== 'string' || revision === null || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (Buffer.byteLength(value, 'utf8') > MAX_MANIFEST_BYTES) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const keys = Object.keys(parsed as Record<string, unknown>);
    const withExposure = keys.length === 3 && keys.includes('userExposure');
    const raw = exactRecord(parsed, withExposure ? ['schemaVersion', 'candidates', 'userExposure'] : ['schemaVersion', 'candidates']);
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.candidates) || raw.candidates.length > MAX_CANDIDATES) return null;
    const candidates = raw.candidates.map(parseCandidate);
    let exposure: ParsedManifest['exposure'] = null;
    if (withExposure) {
      const rawExposure = exactRecord(raw.userExposure, ['userMessageId', 'candidates']);
      if (typeof rawExposure.userMessageId !== 'string' || !ID.test(rawExposure.userMessageId) ||
          !Array.isArray(rawExposure.candidates) || rawExposure.candidates.length === 0 ||
          rawExposure.candidates.length > MAX_CANDIDATES) return null;
      exposure = { userMessageId: rawExposure.userMessageId, candidates: rawExposure.candidates.map(parseCandidate) };
    }
    if (candidates.length + (exposure?.candidates.length ?? 0) > MAX_CANDIDATES) return null;
    return { candidates, exposure };
  } catch {
    return null;
  }
}

function parseManifest(value: string | null, revision: number | null): DayflowQualifiedEvidenceCandidate[] | null {
  return parseManifestFull(value, revision)?.candidates ?? null;
}

function serializeManifest(candidates: readonly DayflowQualifiedEvidenceCandidate[], exposure: ParsedManifest['exposure']): string {
  return JSON.stringify(exposure
    ? { schemaVersion: 1, candidates, userExposure: exposure }
    : { schemaVersion: 1, candidates });
}

function uniqueCandidates(candidates: readonly DayflowQualifiedEvidenceCandidate[]): DayflowQualifiedEvidenceCandidate[] {
  const result: DayflowQualifiedEvidenceCandidate[] = [];
  for (const candidate of candidates) {
    if (!result.some((retained) => sameDayflowQualifiedEvidenceCandidate(retained, candidate))) result.push(candidate);
  }
  return result;
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
        const parsedManifest = parseManifestFull(row.dayflow_context_manifest_json, row.dayflow_context_manifest_revision);
        if (parsedManifest === null) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_manifest_malformed');
          return false;
        }
        const existing = parsedManifest.candidates;
        // A V2-only row has no tool turn yet: the first V1 append binds it.
        // Once bound, a different turn is still an ambiguous binding (sticky unsafe).
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
        if (next.length + (parsedManifest.exposure?.candidates.length ?? 0) > MAX_CANDIDATES) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_dependency_persistence_failure');
          return false;
        }
        // Any retained V2 exposure is carried through unchanged.
        const manifest = serializeManifest(next, parsedManifest.exposure);
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
              AND (dayflow_context_sdk_turn_id IS NULL OR dayflow_context_sdk_turn_id=?)
              AND dayflow_context_manifest_revision=?))`).run(
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
        const manifest = parseManifestFull(row.dayflow_context_manifest_json, row.dayflow_context_manifest_revision);
        if (!base || !manifest || !markerIsValid(row) || row.dayflow_context_schema_version !== 1) return null;
        // A tool turn is mandatory exactly when V1 candidates exist; a V2-only
        // row (provider exposure) legitimately has none and reports ''.
        if (manifest.candidates.length > 0 && !row.dayflow_context_sdk_turn_id) return null;
        const sdkTurnId = row.dayflow_context_sdk_turn_id ?? '';
        if (!this.matchesStoredBinding(row, { ...base, sdkTurnId })) return null;
        if (manifest.exposure && manifest.exposure.userMessageId !== row.sdk_user_message_id) return null;
        // Raw reuse must revalidate BOTH kinds: a V2 exposure is a dependency too.
        const candidates = uniqueCandidates([...manifest.candidates, ...(manifest.exposure?.candidates ?? [])]);
        if (candidates.length === 0) return null;
        result.push({ binding: { ...base, sdkTurnId }, candidates });
      }
      return result;
    } catch {
      return null;
    }
  }

  // ── Provider-admission receiving (V2) ───────────────────────────────────────
  // Typed actual-native-user receivers for the per-attempt provider guard. These
  // never reuse the signed-tool receiver above: a native provider frame has no
  // assistant/tool identity and must not be given one.

  /**
   * Exact session row for an SDK id (marker-tolerant: the sticky marker is
   * reported, not hidden). `none` = no such session; `ambiguous` = several rows
   * or a malformed one — never silently treated as "no session".
   */
  lookupProviderSession(sdkSessionId: string): { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'found'; scope: DayflowProviderSessionScope } {
    try {
      const rows = this.db.prepare(`SELECT id, owner_user_id, project_id, parent_session_id, cwd, is_system,
        category, archived_at, profile_id, dayflow_context_nonreuse_code, dayflow_context_nonreuse_at
        FROM agent_sessions WHERE sdk_session_id=? LIMIT 2`).all(sdkSessionId) as Array<{
        id: string; owner_user_id: number | null; project_id: string | null; parent_session_id: string | null;
        cwd: string | null; is_system: number; category: string; archived_at: string | null;
        profile_id: string | null; dayflow_context_nonreuse_code: string | null;
        dayflow_context_nonreuse_at: string | null;
      }>;
      if (rows.length === 0) return { kind: 'none' };
      if (rows.length !== 1) return { kind: 'ambiguous' };
      const row = rows[0];
      if (!Number.isSafeInteger(row.owner_user_id) || (row.owner_user_id as number) <= 0 ||
          !row.project_id || !ID.test(row.project_id) || typeof row.cwd !== 'string' || row.cwd.length === 0 ||
          row.cwd.length > 4096 || !ID.test(row.id) || !ID.test(sdkSessionId)) return { kind: 'ambiguous' };
      return {
        kind: 'found',
        scope: {
          sessionId: row.id,
          ownerUserId: row.owner_user_id as number,
          projectId: row.project_id,
          directory: row.cwd,
          sdkSessionId,
          profileId: row.profile_id,
          rootChat: row.parent_session_id === null && row.is_system === 0 && row.category === 'chat' && row.archived_at === null,
          unsafeCode: row.dayflow_context_nonreuse_code,
        },
      };
    } catch {
      return { kind: 'ambiguous' };
    }
  }

  providerSessionScope(sdkSessionId: string): DayflowProviderSessionScope | null {
    const found = this.lookupProviderSession(sdkSessionId);
    return found.kind === 'found' ? found.scope : null;
  }

  /** Read-only: does any dispatch/marker already retain Dayflow history for this SDK? */
  hasSdkHistory(sdkSessionId: string): boolean {
    try { return hasDayflowSdkSessionHistory(this.db, sdkSessionId); } catch { return true; }
  }

  /** The owner's current designated primary root (read-only; never creates one). */
  isCurrentPrimaryRoot(scope: DayflowProviderSessionScope): boolean {
    try {
      const read = new CoordinatorConversationsRepository(this.db).get({
        ownerUserId: scope.ownerUserId, projectId: scope.projectId, sessionId: scope.sessionId,
      });
      return scope.rootChat && read.kind === 'found' && read.conversation.primaryOwnerRoot === true;
    } catch {
      return false;
    }
  }

  /** The agent name the selected Secretary profile runs under, only for an enabled executable agent profile. */
  selectedAgentName(profileId: string | null): string | null {
    if (!profileId) return null;
    try {
      const row = this.db.prepare(`SELECT id, oc_agent, enabled, is_agent, locked FROM agent_configs WHERE id=?`)
        .get(profileId) as { id: string; oc_agent: string | null; enabled: number; is_agent: number; locked: number | null } | undefined;
      if (!row || row.enabled !== 1 || row.is_agent !== 1 || row.locked === 1) return null;
      return row.oc_agent && row.oc_agent.length > 0 ? row.oc_agent : row.id;
    } catch {
      return null;
    }
  }

  /**
   * The exact durable receiver of one native user message: either the typed
   * route-authenticated C2 foreground dispatch, or the exact null-auth
   * goal/delegation callback dispatch joined to its durable conversation
   * command and delegation row. Both require the current primary owner root.
   * An enqueue, marker text or heuristic late linkage alone never qualifies.
   */
  findProviderReceiver(scope: DayflowProviderSessionScope, sdkUserMessageId: string): DayflowProviderReceiver | null {
    if (!scope.rootChat || !ID.test(sdkUserMessageId)) return null;
    try {
      const rows = this.db.prepare(`SELECT id, origin, requested_source, route_authed, reason_code, outcome
        FROM agent_turn_dispatches
        WHERE session_id=? AND sdk_session_id=? AND sdk_user_message_id=? LIMIT 2`)
        .all(scope.sessionId, scope.sdkSessionId, sdkUserMessageId) as Array<{
        id: string; origin: string; requested_source: string; route_authed: number | null;
        reason_code: string | null; outcome: string;
      }>;
      if (rows.length !== 1 || (rows[0].outcome !== 'pending' && rows[0].outcome !== 'accepted')) return null;
      const dispatch = rows[0];
      const conversation = new CoordinatorConversationsRepository(this.db).get({
        ownerUserId: scope.ownerUserId, projectId: scope.projectId, sessionId: scope.sessionId,
      });
      if (conversation.kind !== 'found' || !conversation.conversation.primaryOwnerRoot) return null;
      if (
        dispatch.origin === 'prompt_api' && dispatch.requested_source === 'session' &&
        dispatch.route_authed === 1 && dispatch.reason_code === 'c2_foreground'
      ) {
        return { kind: 'foreground', dispatchId: dispatch.id, sdkUserMessageId };
      }
      const delegationId = parseCoordinatorCallbackMarker(dispatch.reason_code);
      if (
        dispatch.origin !== 'delegation_completion' || dispatch.requested_source !== 'agent_config' ||
        dispatch.route_authed !== null || delegationId === null
      ) return null;
      const command = conversation.conversation.commandDedupe.find((candidate) =>
        candidate.kind === 'delegate_goal' && candidate.state === 'dispatched' &&
        candidate.delegationId === delegationId && candidate.parentSdkSessionId === scope.sdkSessionId &&
        candidate.targetAgentConfigId === 'workflow-orchestrator' && candidate.childSessionId !== null);
      if (!command || command.kind !== 'delegate_goal' || !command.childSessionId) return null;
      const delegation = this.db.prepare(`SELECT id FROM agent_async_delegations
        WHERE id=? AND parent_session_id=? AND child_session_id=?
          AND target_agent_config_id='workflow-orchestrator' AND status IN ('waking','notified') LIMIT 2`)
        .all(delegationId, scope.sessionId, command.childSessionId) as Array<{ id: string }>;
      if (delegation.length !== 1) return null;
      return {
        kind: 'delegation_callback', dispatchId: dispatch.id, sdkUserMessageId,
        goalId: command.goalId, delegationId, childSessionId: command.childSessionId,
      };
    } catch {
      return null;
    }
  }

  /**
   * Every retained dependency of this SDK — V1 tool-turn manifests and V2
   * provider exposures — read marker-tolerantly. `ambiguous` = an unreadable
   * row, a binding that disagrees with the session, or a sticky marker with no
   * readable exposure (nothing to project from). `none` = authoritative zero.
   */
  providerHistory(scope: DayflowProviderSessionScope): DayflowProviderHistory {
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
        WHERE d.dayflow_context_schema_version=1
          AND (d.dayflow_context_sdk_session_id=? OR d.sdk_session_id=?)
        ORDER BY d.rowid`).all(scope.sdkSessionId, scope.sdkSessionId) as Row[];
      const entries: DayflowProviderDependency[] = [];
      for (const row of rows) {
        const base = bindingFromRow(row);
        const manifest = parseManifestFull(row.dayflow_context_manifest_json, row.dayflow_context_manifest_revision);
        if (!base || !manifest || base.ownerUserId !== scope.ownerUserId || base.projectId !== scope.projectId ||
            row.dispatch_session_id !== scope.sessionId) return { state: 'ambiguous' };
        if (manifest.candidates.length > 0 && !row.dayflow_context_sdk_turn_id) return { state: 'ambiguous' };
        const sdkTurnId = row.dayflow_context_sdk_turn_id ?? '';
        if (!this.matchesStoredBinding(row, { ...base, sdkTurnId })) return { state: 'ambiguous' };
        if (manifest.exposure && manifest.exposure.userMessageId !== row.sdk_user_message_id) return { state: 'ambiguous' };
        if (manifest.candidates.length === 0 && !manifest.exposure) return { state: 'ambiguous' };
        entries.push({
          binding: { ...base, sdkTurnId },
          v1Candidates: manifest.candidates,
          v2Candidates: manifest.exposure?.candidates ?? [],
          v2UserMessageId: manifest.exposure?.userMessageId ?? null,
        });
      }
      if (entries.length === 0) return scope.unsafeCode === null ? { state: 'none' } : { state: 'ambiguous' };
      return { state: 'ok', entries, marker: scope.unsafeCode };
    } catch {
      return { state: 'ambiguous' };
    }
  }

  /**
   * Persist the V2 provider exposure for this exact native user message BEFORE
   * any dependent text leaves the receiver. Additive and monotonic: prior V1
   * and V2 candidates are never removed or overwritten (a renewed reference
   * coexists with the old version). A recognized sticky marker may coexist —
   * the decision is then projected-only. False on any failure (the caller
   * holds); a malformed/ambiguous row is marked unsafe like V1.
   */
  appendProviderExposure(
    scope: DayflowProviderSessionScope,
    receiver: DayflowProviderReceiver,
    candidates: readonly DayflowQualifiedEvidenceCandidate[],
  ): boolean {
    let admitted: DayflowQualifiedEvidenceCandidate[];
    try { admitted = candidates.map(parseCandidate); } catch { return false; }
    if (admitted.length === 0 || admitted.length > MAX_CANDIDATES ||
        admitted.some((candidate) => candidate.reference.ownerUserId !== scope.ownerUserId ||
          candidate.reference.projectId !== scope.projectId || candidate.reference.eligibility !== 'active' ||
          Date.parse(candidate.reference.expiresAt) <= Date.now())) return false;
    try {
      return this.db.transaction(() => {
        const current = this.providerSessionScope(scope.sdkSessionId);
        const bound = current ? this.findProviderReceiver(current, receiver.sdkUserMessageId) : null;
        if (!current || !bound || bound.kind !== receiver.kind || bound.dispatchId !== receiver.dispatchId ||
            current.sessionId !== scope.sessionId || current.ownerUserId !== scope.ownerUserId ||
            current.projectId !== scope.projectId) return false;
        const row = this.row(receiver.dispatchId);
        if (!row || row.sdk_user_message_id !== receiver.sdkUserMessageId) return false;
        const manifest = parseManifestFull(row.dayflow_context_manifest_json, row.dayflow_context_manifest_revision);
        if (manifest === null) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_manifest_malformed');
          return false;
        }
        const base = bindingFromRow(row);
        if (!base) return false;
        const sdkTurnId = row.dayflow_context_sdk_turn_id ?? '';
        if (row.dayflow_context_schema_version !== null && !this.matchesStoredBinding(row, { ...base, sdkTurnId })) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_binding_ambiguous');
          return false;
        }
        if (manifest.exposure && manifest.exposure.userMessageId !== receiver.sdkUserMessageId) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_binding_ambiguous');
          return false;
        }
        const exposureCandidates = uniqueCandidates([...(manifest.exposure?.candidates ?? []), ...admitted]);
        if (manifest.candidates.length + exposureCandidates.length > MAX_CANDIDATES) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_dependency_persistence_failure');
          return false;
        }
        const serialized = serializeManifest(manifest.candidates, {
          userMessageId: receiver.sdkUserMessageId, candidates: exposureCandidates,
        });
        if (Buffer.byteLength(serialized, 'utf8') > MAX_MANIFEST_BYTES) {
          this.markUnsafeForSession(row.dispatch_session_id, 'dayflow_dependency_persistence_failure');
          return false;
        }
        const revision = row.dayflow_context_manifest_revision ?? 0;
        const changed = this.db.prepare(`UPDATE agent_turn_dispatches SET
          dayflow_context_schema_version=1,
          dayflow_context_owner_user_id=?, dayflow_context_project_id=?,
          dayflow_context_sdk_session_id=?, dayflow_context_manifest_json=?,
          dayflow_context_manifest_revision=?, dayflow_context_recorded_at=?
          WHERE id=?
            AND (dayflow_context_schema_version IS NULL OR (
              dayflow_context_schema_version=1 AND dayflow_context_owner_user_id=?
              AND dayflow_context_project_id=? AND dayflow_context_sdk_session_id=?
              AND dayflow_context_manifest_revision=?))`).run(
          scope.ownerUserId, scope.projectId, scope.sdkSessionId, serialized, revision + 1,
          new Date().toISOString(), receiver.dispatchId,
          scope.ownerUserId, scope.projectId, scope.sdkSessionId, revision,
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

  /**
   * Synchronous durable half of a provider response: the SDK still maps to the
   * same session/owner/project/root, the same typed receiver holds, and every
   * expected candidate is retained in this receiver's V2 exposure. Pair with a
   * preceding live frame/source proof; it is not a lease.
   */
  providerFinalAdmissionCurrent(
    scope: DayflowProviderSessionScope,
    receiver: DayflowProviderReceiver | null,
    expected: readonly DayflowQualifiedEvidenceCandidate[],
  ): boolean {
    try {
      const current = this.providerSessionScope(scope.sdkSessionId);
      if (!current || current.sessionId !== scope.sessionId || current.ownerUserId !== scope.ownerUserId ||
          current.projectId !== scope.projectId || current.rootChat !== scope.rootChat ||
          current.profileId !== scope.profileId) return false;
      if (expected.length === 0) return receiver === null || (
        (() => { const again = this.findProviderReceiver(current, receiver.sdkUserMessageId); return !!again && again.kind === receiver.kind && again.dispatchId === receiver.dispatchId; })()
      );
      if (!receiver) return false;
      const again = this.findProviderReceiver(current, receiver.sdkUserMessageId);
      if (!again || again.kind !== receiver.kind || again.dispatchId !== receiver.dispatchId) return false;
      const row = this.row(receiver.dispatchId);
      const manifest = row ? parseManifestFull(row.dayflow_context_manifest_json, row.dayflow_context_manifest_revision) : null;
      return !!manifest?.exposure && manifest.exposure.userMessageId === receiver.sdkUserMessageId &&
        expected.every((candidate) => manifest.exposure!.candidates.some((retained) =>
          sameDayflowQualifiedEvidenceCandidate(retained, candidate)));
    } catch {
      return false;
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
      // A NULL stored turn is a V2-only row (a provider exposure bound to the
      // native user message, no tool turn yet); a bound turn must match exactly.
      (row.dayflow_context_sdk_turn_id === null || row.dayflow_context_sdk_turn_id === input.sdkTurnId);
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
