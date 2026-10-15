import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

import type { AuthContext } from '../middleware/auth_middleware';
import type {
  ManagedContextReference,
  ManagedContextScope,
  ManagedWorkstreamContextRepository,
} from '../repositories/managed_workstream_context_repository';
import { scanContextContent } from '../security/context_scanner';
import { untrustedContext } from '../security/untrusted_fence';
import {
  verifyTrustedMcpCall,
  type VerifiedTrustedMcpCall,
} from '../security/trusted_mcp_call';
import { agentMemoryService } from './agentMemoryService';
import type {
  CanonicalMemoryReadReceipt,
  MemoryReference,
  MemoryReferenceSearchResult,
} from './memory_retrieval';
import type { ManagedActiveToolCall, OpencodeClientService } from './opencode_client_service';

const SOURCE_LABEL = 'user-authored agent memory search results';
const MAX_FINAL_TEXT_BYTES = 12_000;

export interface ManagedMemorySearchPolicy {
  enabled(): boolean;
  dbClient: 'sqlite' | 'postgres';
  role: 'all' | 'local' | 'cloud' | 'relay';
  currentHostEpoch(): string | null;
  rhythmMcpServerName: string;
}

interface ManagedMemorySearchDependencies {
  db: Database.Database;
  records: Pick<ManagedWorkstreamContextRepository, 'read' | 'append' | 'markUnsafe'>;
  engine: Pick<OpencodeClientService, 'getManagedActiveToolCall'>;
  policy: ManagedMemorySearchPolicy;
  memory?: Pick<typeof agentMemoryService, 'searchReferencesWithReceipts'>;
  verify?: typeof verifyTrustedMcpCall;
}

interface BoundDispatchRow {
  dispatch_id: string;
  session_id: string;
  sdk_session_id: string;
  sdk_user_message_id: string;
  route_authed: number;
  managed_context_owner_user_id: number;
  managed_context_project_id: string;
  managed_context_workstream_id: string;
  managed_context_workstream_revision: number;
  managed_context_role: 'parent' | 'worker';
  managed_context_host_epoch: string;
  managed_context_sdk_session_id: string;
  managed_context_sdk_turn_id: string | null;
  session_owner_user_id: number;
  session_project_id: string;
  session_sdk_session_id: string;
  session_parent_session_id: string | null;
  session_cwd: string;
  workstream_owner_user_id: number;
  workstream_project_id: string;
  workstream_state: string;
  workstream_revision: number;
}

export interface ManagedMemorySearchResponse {
  schemaVersion: 1;
  blocked: boolean;
  text: string;
}

/** Private control response consumed by the shared MCP process, never model text. */
export type ManagedMemorySelectionResponse =
  | { schemaVersion: 1; mode: 'ordinary' }
  | { schemaVersion: 1; mode: 'managed'; response: ManagedMemorySearchResponse };

export class ManagedMemorySearchRefusal extends Error {
  readonly code = 'managed_memory_search_refused';

  constructor() {
    super('Managed memory search refused');
  }
}

/**
 * Explicit managed-worker search admission. Construction is opt-in and the
 * shared MCP process selects this path only for one enrolled worker dispatch.
 */
export class ManagedMemorySearchService {
  private readonly memory: Pick<typeof agentMemoryService, 'searchReferencesWithReceipts'>;
  private readonly verify: typeof verifyTrustedMcpCall;

  constructor(private readonly dependencies: ManagedMemorySearchDependencies) {
    this.memory = dependencies.memory ?? agentMemoryService;
    this.verify = dependencies.verify ?? verifyTrustedMcpCall;
  }

  /**
   * Read-only startup proof for the coordinator. A constructed service alone
   * is not enough: its local persistence tables and policy must be usable.
   */
  coordinatorCaptureAvailable(): boolean {
    if (!this.enabled()) return false;
    try {
      const rows = this.dependencies.db.prepare(`SELECT name FROM sqlite_master
        WHERE type='table' AND name IN ('agent_turn_dispatches','agent_workstreams')`).all() as Array<{ name: string }>;
      return rows.length === 2;
    } catch {
      return false;
    }
  }

  async search(auth: AuthContext, body: unknown): Promise<ManagedMemorySearchResponse> {
    if (!this.enabled() || !auth?.sessionToken || !Number.isSafeInteger(auth.user?.id)) this.refuse();
    const { verified, args } = await this.verifyRequest(body);
    return this.searchVerified(auth, verified, args);
  }

  /**
   * The normal MCP process is shared by ordinary chats and managed workers.
   * Enrollment is authoritative: once a session has one, a stale/mismatched
   * capture is refused rather than silently taking the old search path.
   */
  async select(auth: AuthContext, body: unknown): Promise<ManagedMemorySelectionResponse> {
    if (!this.enabled() || !auth?.sessionToken || !Number.isSafeInteger(auth.user?.id)) this.refuse();
    const { verified, args } = await this.verifyRequest(body);
    const enrolled = this.enrolledDispatchCount(verified.context.sdkSessionId);
    if (enrolled === 0) return { schemaVersion: 1, mode: 'ordinary' };
    if (enrolled !== 1) this.refuse();
    return {
      schemaVersion: 1,
      mode: 'managed',
      response: await this.searchVerified(auth, verified, args),
    };
  }

  private async verifyRequest(body: unknown): Promise<{
    verified: VerifiedTrustedMcpCall;
    args: Record<string, unknown>;
  }> {
    const request = exactRecord(body, ['trustedCall']);
    let verified: VerifiedTrustedMcpCall;
    try {
      verified = await this.verify(request.trustedCall, 'rhythm_search_memory');
    } catch {
      return this.refuse();
    }
    const args = exactRecord(verified.arguments, ['q'], ['limit']);
    if (typeof args.q !== 'string' || args.q.length === 0) this.refuse();
    if (
      args.limit !== undefined &&
      (!Number.isInteger(args.limit) || (args.limit as number) < 0 || (args.limit as number) > 5)
    ) this.refuse();
    return { verified, args };
  }

  private async searchVerified(
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    args: Record<string, unknown>,
  ): Promise<ManagedMemorySearchResponse> {

    const directory = this.sessionDirectory(verified.context.sdkSessionId, auth.user.id);
    const active = await this.dependencies.engine.getManagedActiveToolCall(
      verified.context.sdkSessionId,
      verified.context.turnId,
      verified.context.toolCallId,
      directory,
    );
    this.assertActive(active, verified);
    const rows = this.boundDispatches(active.userMessageId, verified.context.sdkSessionId);
    if (rows.length !== 1) this.refuse();
    const row = rows[0];
    const scope = this.scope(row);
    if (!this.authorized(auth, row, scope)) this.refuse();

    const read = await this.memory.searchReferencesWithReceipts(
      args.q as string,
      auth.user.id,
      args.limit as number | undefined,
    );
    const finalized = finalizeLegacyMemorySearch(read.result);
    const references = managedReferences(finalized.survivors, read.canonicalReceipts, scope);

    const rechecked = await this.dependencies.engine.getManagedActiveToolCall(
      verified.context.sdkSessionId,
      verified.context.turnId,
      verified.context.toolCallId,
      directory,
    );
    this.assertActive(rechecked, verified);
    const currentRows = this.boundDispatches(active.userMessageId, verified.context.sdkSessionId);
    if (currentRows.length !== 1) this.refuse();
    const currentScope = this.scope(currentRows[0]);
    if (
      !sameActiveCall(active, rechecked) ||
      JSON.stringify(currentScope) !== JSON.stringify(scope) ||
      !this.authorized(auth, currentRows[0], currentScope)
    ) this.refuse();

    let persisted = false;
    try {
      const result = this.dependencies.records.append({
        schemaVersion: 1,
        scope,
        references,
      });
      persisted = result.outcome !== 'persistence_unavailable' && result.snapshot !== null;
    } catch {
      // The independent sticky write below owns fail-closed recovery.
    }
    if (!persisted) {
      try {
        const unsafe = this.dependencies.records.markUnsafe(scope, 'persistence_failure');
        persisted = unsafe.outcome === 'unsafe_recorded' && unsafe.snapshot !== null;
      } catch {
        persisted = false;
      }
    }
    if (!persisted) this.refuse();
    return {
      schemaVersion: 1,
      blocked: finalized.blocked,
      text: finalized.text,
    };
  }

  private enabled(): boolean {
    try {
      return this.dependencies.policy.enabled() &&
        this.dependencies.policy.dbClient === 'sqlite' &&
        (this.dependencies.policy.role === 'local' || this.dependencies.policy.role === 'all') &&
        this.dependencies.policy.rhythmMcpServerName.length > 0 &&
        !!this.dependencies.policy.currentHostEpoch();
    } catch {
      return false;
    }
  }

  private assertActive(
    active: ManagedActiveToolCall | null,
    verified: VerifiedTrustedMcpCall,
  ): asserts active is ManagedActiveToolCall {
    if (
      !active ||
      active.sdkSessionId !== verified.context.sdkSessionId ||
      active.assistantId !== verified.context.turnId ||
      active.toolCallId !== verified.context.toolCallId ||
      active.agentName !== verified.context.agentName ||
      active.toolName !== 'rhythm_search_memory' ||
      active.serverName !== this.dependencies.policy.rhythmMcpServerName
    ) this.refuse();
  }

  private boundDispatches(userMessageId: string, sdkSessionId: string): BoundDispatchRow[] {
    return this.dependencies.db.prepare(`SELECT
      d.id AS dispatch_id, d.session_id, d.sdk_session_id, d.sdk_user_message_id,
      d.route_authed, d.managed_context_owner_user_id, d.managed_context_project_id,
      d.managed_context_workstream_id, d.managed_context_workstream_revision,
      d.managed_context_role, d.managed_context_host_epoch,
      d.managed_context_sdk_session_id, d.managed_context_sdk_turn_id,
      s.owner_user_id AS session_owner_user_id, s.project_id AS session_project_id,
      s.sdk_session_id AS session_sdk_session_id,
      s.parent_session_id AS session_parent_session_id, s.cwd AS session_cwd,
      w.owner_user_id AS workstream_owner_user_id, w.project_id AS workstream_project_id,
      w.state AS workstream_state, w.revision AS workstream_revision
      FROM agent_turn_dispatches d
      JOIN agent_sessions s ON s.id=d.session_id
      JOIN agent_workstreams w ON w.id=d.managed_context_workstream_id
      WHERE d.sdk_session_id=? AND d.sdk_user_message_id=?
        AND d.managed_context_schema_version=1
        AND d.outcome IN ('pending','accepted')
      LIMIT 2`).all(sdkSessionId, userMessageId) as BoundDispatchRow[];
  }

  private enrolledDispatchCount(sdkSessionId: string): number {
    const rows = this.dependencies.db.prepare(`SELECT id FROM agent_turn_dispatches
      WHERE sdk_session_id=? AND managed_context_schema_version=1
      LIMIT 2`).all(sdkSessionId) as Array<{ id: string }>;
    return rows.length;
  }

  private sessionDirectory(sdkSessionId: string, ownerUserId: number): string {
    const rows = this.dependencies.db.prepare(`SELECT cwd FROM agent_sessions
      WHERE sdk_session_id=? AND owner_user_id=? LIMIT 2`).all(sdkSessionId, ownerUserId) as Array<{ cwd: string }>;
    if (rows.length !== 1 || typeof rows[0].cwd !== 'string' || rows[0].cwd.length === 0) this.refuse();
    return rows[0].cwd;
  }

  private scope(row: BoundDispatchRow): ManagedContextScope {
    return {
      dispatchId: row.dispatch_id,
      sessionId: row.session_id,
      ownerUserId: row.managed_context_owner_user_id,
      projectId: row.managed_context_project_id,
      workstreamId: row.managed_context_workstream_id,
      workstreamRevision: row.managed_context_workstream_revision,
      role: row.managed_context_role,
      hostEpoch: row.managed_context_host_epoch,
      sdkSessionId: row.managed_context_sdk_session_id,
      sdkTurnId: row.managed_context_sdk_turn_id,
    };
  }

  private authorized(auth: AuthContext, row: BoundDispatchRow, scope: ManagedContextScope): boolean {
    try {
      const epoch = this.dependencies.policy.currentHostEpoch();
      const roleBound = scope.role === 'parent'
        ? row.session_parent_session_id === null
        : scope.role === 'worker' && this.workerBinding(row, scope);
      return this.enabled() &&
        row.route_authed === 1 &&
        scope.sdkTurnId === null &&
        auth.user.id === scope.ownerUserId &&
        row.session_owner_user_id === scope.ownerUserId &&
        row.session_project_id === scope.projectId &&
        row.session_sdk_session_id === scope.sdkSessionId &&
        roleBound &&
        row.workstream_owner_user_id === scope.ownerUserId &&
        row.workstream_project_id === scope.projectId &&
        (row.workstream_state === 'queued' || row.workstream_state === 'running') &&
        row.workstream_revision === scope.workstreamRevision &&
        epoch === scope.hostEpoch &&
        this.dependencies.records.read(scope)?.state === 'bound';
    } catch {
      return false;
    }
  }

  private workerBinding(row: BoundDispatchRow, scope: ManagedContextScope): boolean {
    if (!row.session_parent_session_id) return false;
    const parents = this.dependencies.db.prepare(`SELECT id FROM agent_sessions
      WHERE id=? AND owner_user_id=? AND project_id=? AND parent_session_id IS NULL
      LIMIT 2`).all(
      row.session_parent_session_id,
      scope.ownerUserId,
      scope.projectId,
    ) as Array<{ id: string }>;
    if (parents.length !== 1) return false;
    const jobs = this.dependencies.db.prepare(`SELECT id FROM agent_bridge_jobs
      WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND workstream_project_id=?
        AND workstream_revision=? AND host_epoch=?
        AND native_child_session_id=? AND native_child_sdk_session_id=?
        AND native_dispatch_id=? AND native_sdk_user_message_id=?
        AND state='running'
      LIMIT 2`).all(
      scope.ownerUserId,
      scope.workstreamId,
      scope.projectId,
      scope.workstreamRevision,
      scope.hostEpoch,
      scope.sessionId,
      scope.sdkSessionId,
      scope.dispatchId,
      row.sdk_user_message_id,
    ) as Array<{ id: string }>;
    return jobs.length === 1;
  }

  private refuse(): never {
    throw new ManagedMemorySearchRefusal();
  }
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManagedMemorySearchRefusal();
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) throw new ManagedMemorySearchRefusal();
  return record;
}

function boundedReferenceEnvelope(value: MemoryReferenceSearchResult): MemoryReferenceSearchResult {
  const sourceReferences = value.references;
  const references = [...sourceReferences];
  const envelope = () => ({
    ...value,
    references,
    returned: references.length,
    truncated: references.length < sourceReferences.length || value.truncated === true,
  });
  while (references.length > 0 && JSON.stringify(envelope()).length > 3_800) references.pop();
  return envelope();
}

export function finalizeLegacyMemorySearch(result: MemoryReferenceSearchResult): {
  blocked: boolean;
  text: string;
  survivors: Array<Pick<MemoryReference, 'id' | 'sourceId'>>;
} {
  const envelope = boundedReferenceEnvelope(result);
  const raw = JSON.stringify(envelope);
  const scan = scanContextContent(raw, SOURCE_LABEL);
  if (!scan.blocked) {
    return {
      blocked: false,
      text: boundedFinalText(untrustedContext(raw, SOURCE_LABEL)),
      survivors: selectedPairs(envelope.references),
    };
  }
  if (envelope.references.length < 2) {
    return { blocked: true, text: scan.warning as string, survivors: [] };
  }
  const kept = envelope.references.filter(
    (item) => !scanContextContent(JSON.stringify(item, null, 2), SOURCE_LABEL).blocked,
  );
  if (kept.length === 0 || kept.length === envelope.references.length) {
    return { blocked: true, text: scan.warning as string, survivors: [] };
  }
  const salvaged = JSON.stringify({ ...envelope, references: kept }, null, 2);
  const withheld = envelope.references.length - kept.length;
  return {
    blocked: false,
    text: boundedFinalText(
      `${untrustedContext(salvaged, SOURCE_LABEL)}\n\n` +
      `[NOTE: ${withheld} of ${envelope.references.length} ${SOURCE_LABEL} item(s) were withheld by the ` +
      `prompt-injection scanner and are not shown. The ${kept.length} shown above are complete and unmodified. ` +
      `Treat this as a partial view of the collection.]`,
    ),
    survivors: selectedPairs(kept),
  };
}

function boundedFinalText(text: string): string {
  if (Buffer.byteLength(text, 'utf8') > MAX_FINAL_TEXT_BYTES) throw new ManagedMemorySearchRefusal();
  return text;
}

function selectedPairs(references: MemoryReference[]): Array<Pick<MemoryReference, 'id' | 'sourceId'>> {
  const pairs = references.map((reference) => ({ id: reference.id, sourceId: reference.sourceId }));
  if (pairs.some((pair) => !pair.id || !pair.sourceId)) throw new ManagedMemorySearchRefusal();
  return pairs;
}

function managedReferences(
  survivors: Array<Pick<MemoryReference, 'id' | 'sourceId'>>,
  receipts: CanonicalMemoryReadReceipt[],
  scope: ManagedContextScope,
): ManagedContextReference[] {
  return survivors.map((survivor) => {
    const matches = receipts.filter(
      (receipt) => receipt.indexMemoryId === survivor.id && receipt.sourceId === survivor.sourceId,
    );
    if (matches.length !== 1) throw new ManagedMemorySearchRefusal();
    const receipt = matches[0];
    const dependencyId = createHash('sha256').update(JSON.stringify([
      'rhythm.managed-context.dependency.v1',
      receipt.sourceNamespace,
      receipt.sourceInstance,
      receipt.sourceId,
    ])).digest('hex');
    return {
      schemaVersion: 1,
      dependencyId,
      canonicalId: receipt.sourceId,
      observedVersion: receipt.observedVersion,
      observedHash: receipt.observedHash,
      sourceNamespace: receipt.sourceNamespace,
      sourceInstance: receipt.sourceInstance,
      ownerUserId: scope.ownerUserId,
      projectId: scope.projectId,
      workstreamId: scope.workstreamId,
      workstreamRevision: scope.workstreamRevision,
      provenance: 'tool_read',
      lane: 'semantic',
    };
  });
}

function sameActiveCall(left: ManagedActiveToolCall, right: ManagedActiveToolCall): boolean {
  return Object.keys(left).every((key) =>
    left[key as keyof ManagedActiveToolCall] === right[key as keyof ManagedActiveToolCall]);
}
