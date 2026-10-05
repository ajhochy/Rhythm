import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import {
  COORDINATOR_CONVERSATION_SCHEMA_VERSION,
  MAX_COORDINATOR_CONVERSATION_AUTHORIZATIONS,
  MAX_COORDINATOR_CONVERSATION_COMMANDS,
  MAX_COORDINATOR_CONVERSATION_GOALS,
  parseStoredCoordinatorConversation,
  type CoordinatorConversation,
  type CoordinatorConversationCommand,
  type CoordinatorConversationContinuationAuthority,
  type CoordinatorConversationGoal,
} from '../contracts/coordinator_conversation_contract';
import { COORDINATOR_CONVERSATION_COLUMN } from '../database/coordinator_conversation_schema';
import { getDb } from '../database/db';

export interface CoordinatorConversationScope {
  ownerUserId: number;
  projectId: string;
  sessionId: string;
}

export type CoordinatorConversationRead =
  | { kind: 'found'; conversation: CoordinatorConversation }
  | { kind: 'not_found' }
  | { kind: 'schema_unavailable' }
  | { kind: 'integrity_hold' };

export type CoordinatorConversationOpen =
  | { kind: 'created'; conversation: CoordinatorConversation }
  | { kind: 'replay'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

export type CoordinatorConversationGoalWrite =
  | { kind: 'created'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'replay'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | { kind: 'goal_limit'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

export type CoordinatorConversationAuthorityWrite =
  | { kind: 'updated'; conversation: CoordinatorConversation }
  | { kind: 'replay'; conversation: CoordinatorConversation }
  | { kind: 'authority_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/** A transcript-backed, zero-inference user control. */
export type CoordinatorConversationStatusControlWrite =
  | { kind: 'stored'; conversation: CoordinatorConversation; messageId: number }
  | { kind: 'replay'; conversation: CoordinatorConversation; messageId: number }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | { kind: 'command_limit'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/** A transport reservation whose real user/assistant events stay SDK-owned. */
export type CoordinatorConversationForegroundWrite =
  | { kind: 'reserved'; conversation: CoordinatorConversation }
  | { kind: 'accepted_replay'; conversation: CoordinatorConversation }
  | { kind: 'uncertain'; conversation: CoordinatorConversation }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | { kind: 'command_limit'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

export type CoordinatorConversationForegroundSettle =
  | { kind: 'accepted'; conversation: CoordinatorConversation }
  | { kind: 'uncertain'; conversation: CoordinatorConversation }
  | { kind: 'command_conflict'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/** A durable conversation goal may bind exactly one server-created workstream. */
export type CoordinatorConversationGoalLinkWrite =
  | { kind: 'updated'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'replay'; conversation: CoordinatorConversation; goal: CoordinatorConversationGoal }
  | { kind: 'goal_link_conflict'; conversation: CoordinatorConversation }
  | { kind: 'revision_conflict'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

/**
 * A dedicated owner root is created exactly once. `createSession` is the
 * existing metadata-only session insert, invoked inside this repository's
 * SQLite transaction; it must not call an engine/SDK boundary or await.
 */
export type CoordinatorConversationPrimaryRootWrite =
  | { kind: 'created'; conversation: CoordinatorConversation }
  | { kind: 'replay'; conversation: CoordinatorConversation }
  | Exclude<CoordinatorConversationRead, { kind: 'found' }>;

type SessionRow = {
  id: string;
  owner_user_id: number;
  project_id: string;
  coordinator_conversation_json: string | null;
};

/**
 * Internal scheduler inventory only. It deliberately returns parsed durable
 * controls rather than JSON bytes, and never creates a root/session/job.
 */
export interface CoordinatorConversationFiniteReconciliationPage {
  items: CoordinatorConversation[];
  nextCursor: string | null;
}

const MAX_PRIMARY_ROOT_SCAN = 500;

function nowIso(clock: () => Date): string {
  return clock().toISOString();
}

function intentHash(objective: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'add_goal', objective }))
    .digest('hex');
}

function controlIntentHash(kind: 'status' | 'foreground', message: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind, message }))
    .digest('hex');
}

class ConversationCommandRace extends Error {}
class ConversationTranscriptUnavailable extends Error {}

function parseRow(row: SessionRow): CoordinatorConversationRead {
  if (row.coordinator_conversation_json === null) return { kind: 'not_found' };
  try {
    const conversation = parseStoredCoordinatorConversation(JSON.parse(row.coordinator_conversation_json));
    if (
      conversation.sessionId !== row.id ||
      conversation.ownerUserId !== row.owner_user_id ||
      conversation.projectId !== row.project_id
    ) {
      return { kind: 'integrity_hold' };
    }
    return { kind: 'found', conversation };
  } catch {
    return { kind: 'integrity_hold' };
  }
}

function isValidAuthorityFor(
  conversation: CoordinatorConversation,
  authority: CoordinatorConversationContinuationAuthority,
): boolean {
  try {
    parseStoredCoordinatorConversation({ ...conversation, continuations: [authority] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Durable, exact-session binding for C1/C2. Literal/status user controls are
 * inserted as ordinary local `agent_session_messages` input rows in the same
 * SQLite transaction as their metadata CAS. The repository never invents an
 * SDK id, assistant event, workstream/job/permission, or engine history read.
 * Its SQL is local SQLite only until the C2/C3 owners explicitly provide a
 * dual-DB migration/relay contract.
 */
export class CoordinatorConversationsRepository {
  constructor(
    private readonly db: Database.Database = getDb(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private session(scope: CoordinatorConversationScope): SessionRow | null {
    try {
      const row = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
          FROM agent_sessions
         WHERE id=? AND owner_user_id=? AND project_id=?
           AND parent_session_id IS NULL AND is_system=0 AND category='chat'
         LIMIT 1`).get(
        scope.sessionId,
        scope.ownerUserId,
        scope.projectId,
      ) as SessionRow | undefined;
      return row ?? null;
    } catch {
      return null;
    }
  }

  private record(scope: CoordinatorConversationScope): {
    result: CoordinatorConversationRead;
    serialized: string | null;
  } {
    const row = this.session(scope);
    if (!row) {
      try {
        // A column check distinguishes an unavailable installer/schema from an
        // ordinary non-disclosing scope miss without exposing SQL errors.
        const hasColumn = (this.db.prepare('PRAGMA table_info(agent_sessions)').all() as Array<{ name: string }>)
          .some((column) => column.name === COORDINATOR_CONVERSATION_COLUMN);
        return { result: hasColumn ? { kind: 'not_found' } : { kind: 'schema_unavailable' }, serialized: null };
      } catch {
        return { result: { kind: 'schema_unavailable' }, serialized: null };
      }
    }
    return { result: parseRow(row), serialized: row.coordinator_conversation_json };
  }

  private read(scope: CoordinatorConversationScope): CoordinatorConversationRead {
    return this.record(scope).result;
  }

  get(scope: CoordinatorConversationScope): CoordinatorConversationRead {
    return this.read(scope);
  }

  /**
   * Server-side only root discovery. The browser never chooses an owner or a
   * session. A malformed durable control is a hold rather than an opportunity
   * to create a second primary root.
   */
  findPrimaryOwnerRoot(ownerUserId: number): CoordinatorConversationRead {
    try {
      const rows = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
          FROM agent_sessions
         WHERE owner_user_id=? AND parent_session_id IS NULL AND is_system=0 AND category='chat'
           AND ${COORDINATOR_CONVERSATION_COLUMN} IS NOT NULL
         ORDER BY created_at, id LIMIT ?`).all(ownerUserId, MAX_PRIMARY_ROOT_SCAN + 1) as SessionRow[];
      if (rows.length > MAX_PRIMARY_ROOT_SCAN) return { kind: 'integrity_hold' };
      const roots: CoordinatorConversation[] = [];
      for (const row of rows) {
        const parsed = parseRow(row);
        if (parsed.kind === 'integrity_hold') return parsed;
        if (parsed.kind === 'found' && parsed.conversation.primaryOwnerRoot) roots.push(parsed.conversation);
      }
      return roots.length === 0
        ? { kind: 'not_found' }
        : roots.length === 1
          ? { kind: 'found', conversation: roots[0] }
          : { kind: 'integrity_hold' };
    } catch {
      return { kind: 'schema_unavailable' };
    }
  }

  /**
   * Bounded, read-only inventory for the already-owned scheduler callback.
   * The cursor is a durable local session id, not an authorization token. A
   * malformed row is omitted rather than being treated as a candidate; its
   * normal scoped read remains an integrity hold.
   */
  listFiniteReconciliationCandidates(
    limit: number,
    after?: string,
  ): CoordinatorConversationFiniteReconciliationPage {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    try {
      const rows = (after
        ? this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
            FROM agent_sessions
           WHERE ${COORDINATOR_CONVERSATION_COLUMN} IS NOT NULL AND id>?
           ORDER BY id LIMIT ?`).all(after, bounded)
        : this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
            FROM agent_sessions
           WHERE ${COORDINATOR_CONVERSATION_COLUMN} IS NOT NULL
           ORDER BY id LIMIT ?`).all(bounded)) as SessionRow[];
      const items = rows.flatMap((row) => {
        const parsed = parseRow(row);
        return parsed.kind === 'found' && parsed.conversation.primaryOwnerRoot &&
          parsed.conversation.continuations.some((authority) =>
            authority.status === 'consumed' && authority.consumedTurns >= 1 && authority.consumedTurns <= authority.maxTurns,
          )
          ? [parsed.conversation]
          : [];
      });
      return {
        items,
        nextCursor: rows.length === bounded ? rows.at(-1)?.id ?? null : null,
      };
    } catch {
      // The scheduler has no authority to reinterpret unavailable storage as
      // an empty inventory. Returning an empty terminal page is a safe no-op;
      // scoped UI reads continue to expose the concrete schema/integrity hold.
      return { items: [], nextCursor: null };
    }
  }

  /** Candidate discovery is bounded and never creates a session or SDK turn. */
  listPrimaryRootCandidates(input: { ownerUserId: number; projectHint?: string }): Array<{ sessionId: string; projectId: string }> {
    try {
      const rows = input.projectHint === undefined
        ? this.db.prepare(`SELECT id, project_id FROM agent_sessions
            WHERE owner_user_id=? AND parent_session_id IS NULL AND is_system=0 AND category='chat'
              AND archived_at IS NULL AND project_id IS NOT NULL AND sdk_session_id IS NOT NULL AND profile_id IS NOT NULL
            ORDER BY created_at, id LIMIT ?`).all(input.ownerUserId, MAX_PRIMARY_ROOT_SCAN) as Array<{ id: string; project_id: string }>
        : this.db.prepare(`SELECT id, project_id FROM agent_sessions
            WHERE owner_user_id=? AND project_id=? AND parent_session_id IS NULL AND is_system=0 AND category='chat'
              AND archived_at IS NULL AND sdk_session_id IS NOT NULL AND profile_id IS NOT NULL
            ORDER BY created_at, id LIMIT ?`).all(input.ownerUserId, input.projectHint, MAX_PRIMARY_ROOT_SCAN) as Array<{ id: string; project_id: string }>;
      return rows.filter((row) => typeof row.id === 'string' && typeof row.project_id === 'string')
        .map((row) => ({ sessionId: row.id, projectId: row.project_id }));
    } catch {
      return [];
    }
  }

  /**
   * Atomically creates/designates one owner primary root on an existing chat.
   * This cannot move a root between projects or touch an SDK/job/capture row.
   */
  designatePrimaryOwnerRoot(
    scope: CoordinatorConversationScope,
    options: { allowUnboundSdk?: boolean } = {},
  ): CoordinatorConversationRead {
    try {
      return this.db.transaction((): CoordinatorConversationRead => {
        const existing = this.findPrimaryOwnerRoot(scope.ownerUserId);
        if (existing.kind !== 'not_found') return existing;
        const boundSdkClause = options.allowUnboundSdk ? '' : ' AND sdk_session_id IS NOT NULL';
        const row = this.db.prepare(`SELECT id, owner_user_id, project_id, ${COORDINATOR_CONVERSATION_COLUMN}
            FROM agent_sessions
           WHERE id=? AND owner_user_id=? AND project_id=?
             AND parent_session_id IS NULL AND is_system=0 AND category='chat'
             AND archived_at IS NULL${boundSdkClause} AND profile_id IS NOT NULL
           LIMIT 1`).get(scope.sessionId, scope.ownerUserId, scope.projectId) as SessionRow | undefined;
        if (!row) return { kind: 'not_found' };
        const now = nowIso(this.clock);
        let next: CoordinatorConversation;
        if (row.coordinator_conversation_json === null) {
          next = {
            schemaVersion: COORDINATOR_CONVERSATION_SCHEMA_VERSION,
            id: randomUUID(),
            sessionId: scope.sessionId,
            ownerUserId: scope.ownerUserId,
            projectId: scope.projectId,
            controlRevision: 1,
            primaryOwnerRoot: true,
            goals: [],
            commandDedupe: [],
            continuations: [],
            createdAt: now,
            updatedAt: now,
          };
        } else {
          const parsed = parseRow(row);
          if (parsed.kind !== 'found') return parsed;
          next = { ...parsed.conversation, primaryOwnerRoot: true, updatedAt: now };
        }
        const changed = this.db.prepare(`UPDATE agent_sessions
            SET ${COORDINATOR_CONVERSATION_COLUMN}=?, updated_at=?
          WHERE id=? AND owner_user_id=? AND project_id=?
            AND parent_session_id IS NULL AND is_system=0 AND category='chat'
            AND ${COORDINATOR_CONVERSATION_COLUMN} IS ?`).run(
          JSON.stringify(next), next.updatedAt, scope.sessionId, scope.ownerUserId, scope.projectId,
          row.coordinator_conversation_json,
        ).changes;
        return changed === 1 ? { kind: 'found', conversation: next } : this.findPrimaryOwnerRoot(scope.ownerUserId);
      })();
    } catch {
      return { kind: 'schema_unavailable' };
    }
  }

  /**
   * Create an inert dedicated root and mark it primary as one local durable
   * operation. A competing owner root rolls this transaction back instead of
   * committing an unbound extra chat; a later resolve can safely replay it.
   */
  createPrimaryOwnerRoot(input: {
    ownerUserId: number;
    projectId: string;
    createSession: () => { id: string };
  }): CoordinatorConversationPrimaryRootWrite {
    try {
      return this.db.transaction((): CoordinatorConversationPrimaryRootWrite => {
        const existing = this.findPrimaryOwnerRoot(input.ownerUserId);
        if (existing.kind === 'found') return { kind: 'replay', conversation: existing.conversation };
        if (existing.kind !== 'not_found') return existing;

        const created = input.createSession();
        if (!created || typeof created.id !== 'string' || created.id.length === 0) {
          throw new Error('metadata root insert did not return a session id');
        }
        const designated = this.designatePrimaryOwnerRoot({
          ownerUserId: input.ownerUserId,
          projectId: input.projectId,
          sessionId: created.id,
        }, { allowUnboundSdk: true });
        if (designated.kind !== 'found') return designated;
        // Do not commit a duplicate inert session if an independently durable
        // primary appeared while the metadata insert was in flight.
        if (designated.conversation.sessionId !== created.id) {
          throw new Error('primary root changed during creation');
        }
        return { kind: 'created', conversation: designated.conversation };
      })();
    } catch {
      return { kind: 'schema_unavailable' };
    }
  }

  /** Explicit install only; there is no boot-time, list-time, or idle auto-create. */
  open(scope: CoordinatorConversationScope): CoordinatorConversationOpen {
    const first = this.read(scope);
    if (first.kind === 'found') return { kind: 'replay', conversation: first.conversation };
    if (first.kind !== 'not_found') return first;

    const now = nowIso(this.clock);
    const conversation: CoordinatorConversation = {
      schemaVersion: COORDINATOR_CONVERSATION_SCHEMA_VERSION,
      id: randomUUID(),
      sessionId: scope.sessionId,
      ownerUserId: scope.ownerUserId,
      projectId: scope.projectId,
      controlRevision: 1,
      primaryOwnerRoot: false,
      goals: [],
      commandDedupe: [],
      continuations: [],
      createdAt: now,
      updatedAt: now,
    };
    const serialized = JSON.stringify(conversation);
    try {
      const changes = this.db.prepare(`UPDATE agent_sessions
          SET ${COORDINATOR_CONVERSATION_COLUMN}=?, updated_at=?
        WHERE id=? AND owner_user_id=? AND project_id=?
          AND parent_session_id IS NULL AND is_system=0 AND category='chat'
          AND ${COORDINATOR_CONVERSATION_COLUMN} IS NULL`).run(
        serialized,
        now,
        scope.sessionId,
        scope.ownerUserId,
        scope.projectId,
      ).changes;
      if (changes === 1) return { kind: 'created', conversation };
    } catch {
      return { kind: 'schema_unavailable' };
    }

    const reread = this.read(scope);
    return reread.kind === 'found'
      ? { kind: 'replay', conversation: reread.conversation }
      : reread;
  }

  /**
   * Dedupe is durable on the existing chat binding. An exact replay returns
   * the original goal even after the control revision advanced; a changed
   * payload under the same command key is a conflict and never overwrites it.
   */
  addGoal(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    objective: string;
  }): CoordinatorConversationGoalWrite {
    return this.addGoalInternal(input, null);
  }

  /**
   * Record the exact literal control as an existing transcript input and add
   * its goal in one local transaction. The input row has no SDK message id and
   * never stands in for an assistant event.
   */
  addGoalFromMessage(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    objective: string;
    message: string;
  }): CoordinatorConversationGoalWrite {
    const hash = intentHash(input.objective);
    try {
      return this.db.transaction(() => this.addGoalInternal(input, input.message, true))();
    } catch (error) {
      if (error instanceof ConversationTranscriptUnavailable) return { kind: 'schema_unavailable' };
      if (error instanceof ConversationCommandRace) return this.goalReread(input, hash);
      return { kind: 'schema_unavailable' };
    }
  }

  private addGoalInternal(
    input: CoordinatorConversationScope & {
      expectedControlRevision: number;
      commandKey: string;
      objective: string;
    },
    message: string | null,
    transactional = false,
  ): CoordinatorConversationGoalWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const hash = intentHash(input.objective);
    const matchingCommand = current.conversation.commandDedupe.find((command) => command.key === input.commandKey);
    if (matchingCommand) {
      const goal = matchingCommand.kind === 'add_goal'
        ? current.conversation.goals.find((candidate) => candidate.id === matchingCommand.goalId)
        : undefined;
      return matchingCommand.kind === 'add_goal' && goal && matchingCommand.intentHash === hash
        ? { kind: 'replay', conversation: current.conversation, goal }
        : { kind: 'command_conflict', conversation: current.conversation };
    }
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    if (
      current.conversation.goals.length >= MAX_COORDINATOR_CONVERSATION_GOALS ||
      current.conversation.commandDedupe.length >= MAX_COORDINATOR_CONVERSATION_COMMANDS
    ) {
      return { kind: 'goal_limit', conversation: current.conversation };
    }
    const goal: CoordinatorConversationGoal = {
      id: randomUUID(),
      commandKey: input.commandKey,
      intentHash: hash,
      objective: input.objective,
      state: 'captured',
      linkedWorkstreamId: null,
      revision: 1,
      createdAt: nowIso(this.clock),
    };
    const messageId = message === null ? null : this.appendCanonicalUserInput(input, message);
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      goals: [...current.conversation.goals, goal],
      commandDedupe: [...current.conversation.commandDedupe, {
        key: input.commandKey,
        intentHash: hash,
        kind: 'add_goal',
        goalId: goal.id,
        messageId,
      }],
      updatedAt: nowIso(this.clock),
    };
    const saved = this.saveCurrent(input, snapshot.serialized!, next);
    if (saved) return { kind: 'created', conversation: next, goal };
    if (transactional) throw new ConversationCommandRace();
    return this.goalReread(input, hash);
  }

  private goalReread(
    input: CoordinatorConversationScope & { commandKey: string },
    hash: string,
  ): CoordinatorConversationGoalWrite {
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const raced = reread.conversation.commandDedupe.find((command) => command.key === input.commandKey);
    if (raced?.kind === 'add_goal') {
      const racedGoal = reread.conversation.goals.find((candidate) => candidate.id === raced.goalId)!;
      return raced.intentHash === hash
        ? { kind: 'replay', conversation: reread.conversation, goal: racedGoal }
        : { kind: 'command_conflict', conversation: reread.conversation };
    }
    if (raced) return { kind: 'command_conflict', conversation: reread.conversation };
    return { kind: 'revision_conflict', conversation: reread.conversation };
  }

  /**
   * Store a deterministic status question as a normal input event. It does
   * not advance `controlRevision`: status is a read, not a new grant or goal.
   * The durable command still prevents a transport replay from duplicating the
   * visible user event.
   */
  recordStatusMessage(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    message: string;
  }): CoordinatorConversationStatusControlWrite {
    const hash = controlIntentHash('status', input.message);
    try {
      return this.db.transaction(() => {
        const snapshot = this.record(input);
        const current = snapshot.result;
        if (current.kind !== 'found') return current;
        const existing = current.conversation.commandDedupe.find((command) => command.key === input.commandKey);
        if (existing) {
          return existing.kind === 'status' && existing.intentHash === hash
            ? { kind: 'replay' as const, conversation: current.conversation, messageId: existing.messageId }
            : { kind: 'command_conflict' as const, conversation: current.conversation };
        }
        if (current.conversation.controlRevision !== input.expectedControlRevision) {
          return { kind: 'revision_conflict' as const, conversation: current.conversation };
        }
        if (current.conversation.commandDedupe.length >= MAX_COORDINATOR_CONVERSATION_COMMANDS) {
          return { kind: 'command_limit' as const, conversation: current.conversation };
        }
        const messageId = this.appendCanonicalUserInput(input, input.message);
        const next: CoordinatorConversation = {
          ...current.conversation,
          commandDedupe: [...current.conversation.commandDedupe, {
            key: input.commandKey,
            intentHash: hash,
            kind: 'status',
            messageId,
          }],
          updatedAt: nowIso(this.clock),
        };
        if (!this.saveCurrent(input, snapshot.serialized!, next)) throw new ConversationCommandRace();
        return { kind: 'stored' as const, conversation: next, messageId };
      })();
    } catch (error) {
      if (error instanceof ConversationTranscriptUnavailable) return { kind: 'schema_unavailable' };
      if (!(error instanceof ConversationCommandRace)) return { kind: 'schema_unavailable' };
      return this.statusReread(input, hash);
    }
  }

  /** Reserve one ordinary SDK prompt; a reserved row is intentionally not replayed. */
  reserveForegroundMessage(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    commandKey: string;
    message: string;
  }): CoordinatorConversationForegroundWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const hash = controlIntentHash('foreground', input.message);
    const existing = current.conversation.commandDedupe.find((command) => command.key === input.commandKey);
    if (existing) {
      if (existing.kind !== 'foreground' || existing.intentHash !== hash) {
        return { kind: 'command_conflict', conversation: current.conversation };
      }
      if (existing.state === 'accepted') return { kind: 'accepted_replay', conversation: current.conversation };
      return { kind: 'uncertain', conversation: current.conversation };
    }
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    if (current.conversation.commandDedupe.length >= MAX_COORDINATOR_CONVERSATION_COMMANDS) {
      return { kind: 'command_limit', conversation: current.conversation };
    }
    const next: CoordinatorConversation = {
      ...current.conversation,
      commandDedupe: [...current.conversation.commandDedupe, {
        key: input.commandKey,
        intentHash: hash,
        kind: 'foreground',
        state: 'reserved',
      }],
      updatedAt: nowIso(this.clock),
    };
    if (this.saveCurrent(input, snapshot.serialized!, next)) {
      return { kind: 'reserved', conversation: next };
    }
    return this.foregroundReread(input, hash);
  }

  /** Once reserved, any failed or ambiguous adapter result remains non-replayable. */
  settleForegroundMessage(input: CoordinatorConversationScope & {
    commandKey: string;
    message: string;
    outcome: 'accepted' | 'uncertain';
  }): CoordinatorConversationForegroundSettle {
    const hash = controlIntentHash('foreground', input.message);
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const command = current.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (!command || command.kind !== 'foreground' || command.intentHash !== hash) {
      return { kind: 'command_conflict', conversation: current.conversation };
    }
    if (command.state === 'accepted') return { kind: 'accepted', conversation: current.conversation };
    if (command.state === 'uncertain') return { kind: 'uncertain', conversation: current.conversation };
    const next: CoordinatorConversation = {
      ...current.conversation,
      commandDedupe: current.conversation.commandDedupe.map((candidate): CoordinatorConversationCommand =>
        candidate.key === command.key
          ? { ...command, state: input.outcome }
          : candidate,
      ),
      updatedAt: nowIso(this.clock),
    };
    if (this.saveCurrent(input, snapshot.serialized!, next)) {
      return { kind: input.outcome, conversation: next };
    }
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const raced = reread.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (raced?.kind !== 'foreground' || raced.intentHash !== hash) {
      return { kind: 'command_conflict', conversation: reread.conversation };
    }
    return { kind: raced.state === 'accepted' ? 'accepted' : 'uncertain', conversation: reread.conversation };
  }

  private statusReread(
    input: CoordinatorConversationScope & { commandKey: string },
    hash: string,
  ): CoordinatorConversationStatusControlWrite {
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const command = reread.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (command?.kind === 'status' && command.intentHash === hash) {
      return { kind: 'replay', conversation: reread.conversation, messageId: command.messageId };
    }
    return command
      ? { kind: 'command_conflict', conversation: reread.conversation }
      : { kind: 'revision_conflict', conversation: reread.conversation };
  }

  private foregroundReread(
    input: CoordinatorConversationScope & { commandKey: string },
    hash: string,
  ): CoordinatorConversationForegroundWrite {
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const command = reread.conversation.commandDedupe.find((candidate) => candidate.key === input.commandKey);
    if (command?.kind === 'foreground' && command.intentHash === hash) {
      return command.state === 'accepted'
        ? { kind: 'accepted_replay', conversation: reread.conversation }
        : { kind: 'uncertain', conversation: reread.conversation };
    }
    return command
      ? { kind: 'command_conflict', conversation: reread.conversation }
      : { kind: 'revision_conflict', conversation: reread.conversation };
  }

  private appendCanonicalUserInput(scope: CoordinatorConversationScope, message: string): number {
    try {
      const result = this.db.prepare(`INSERT INTO agent_session_messages
        (session_id, role, raw_text, stripped_text) VALUES (?, 'input', ?, ?)`)
        .run(scope.sessionId, message, message);
      const id = Number(result.lastInsertRowid);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('message insert id unavailable');
      return id;
    } catch {
      throw new ConversationTranscriptUnavailable();
    }
  }

  /**
   * Bind an already-created owner/project-scoped workstream exactly once.
   * The workstream is created first so an interrupted request cannot leave a
   * conversation pointing at an invented identifier.  A matching binding is
   * an idempotent replay; any other existing binding is a hold.
   */
  linkGoal(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    goalId: string;
    workstreamId: string;
  }): CoordinatorConversationGoalLinkWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const goal = current.conversation.goals.find((candidate) => candidate.id === input.goalId);
    if (!goal || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.workstreamId)) {
      return { kind: 'goal_link_conflict', conversation: current.conversation };
    }
    if (goal.state === 'linked') {
      return goal.linkedWorkstreamId === input.workstreamId
        ? { kind: 'replay', conversation: current.conversation, goal }
        : { kind: 'goal_link_conflict', conversation: current.conversation };
    }
    if (goal.state !== 'captured' || goal.linkedWorkstreamId !== null) {
      return { kind: 'goal_link_conflict', conversation: current.conversation };
    }
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    const linkedGoal: CoordinatorConversationGoal = {
      ...goal,
      state: 'linked',
      linkedWorkstreamId: input.workstreamId,
      revision: goal.revision + 1,
    };
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      goals: current.conversation.goals.map((candidate) => candidate.id === goal.id ? linkedGoal : candidate),
      updatedAt: nowIso(this.clock),
    };
    if (this.saveCurrent(input, snapshot.serialized!, next)) {
      return { kind: 'updated', conversation: next, goal: linkedGoal };
    }
    const reread = this.read(input);
    if (reread.kind !== 'found') return reread;
    const racedGoal = reread.conversation.goals.find((candidate) => candidate.id === input.goalId);
    if (racedGoal?.state === 'linked' && racedGoal.linkedWorkstreamId === input.workstreamId) {
      return { kind: 'replay', conversation: reread.conversation, goal: racedGoal };
    }
    return racedGoal ? { kind: 'goal_link_conflict', conversation: reread.conversation } : { kind: 'revision_conflict', conversation: reread.conversation };
  }

  /**
   * C2-only internal hook. There is intentionally no HTTP request that can
   * set this field. The shared owner must invoke it from an already-verified
   * one-shot authority path and compose its workstream/job transaction there.
   */
  setContinuationAuthority(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    authority: CoordinatorConversationContinuationAuthority;
    /**
     * Service-only proof that a live saved control no longer matches current
     * server-owned authority and this is a fresh explicit acknowledgement.
     * The repository still CASes the exact durable conversation before it can
     * replace an unused or settled finite record.
     */
    replaceInvalidatedAuthority?: boolean;
  }): CoordinatorConversationAuthorityWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    if (current.conversation.controlRevision !== input.expectedControlRevision) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    const authority = input.authority;
    const goal = current.conversation.goals.find((candidate) => candidate.id === authority.goalId);
    if (
      !goal || goal.state !== 'linked' || goal.linkedWorkstreamId !== authority.workstreamId ||
      authority.projectId !== current.conversation.projectId ||
      authority.status !== 'authorized' || authority.maxTurns < 1 || authority.maxTurns > 8 ||
      authority.consumedTurns !== 0 || !isValidAuthorityFor(current.conversation, authority)
    ) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    const existing = current.conversation.continuations.find((candidate) => candidate.goalId === authority.goalId);
    if (existing) {
      const existingLive = new Date(existing.expiresAt).valueOf() > this.clock().valueOf();
      const replaceInvalidated = input.replaceInvalidatedAuthority === true &&
        existingLive && existing.status !== 'blocked';
      return JSON.stringify(existing) === JSON.stringify(authority)
        ? { kind: 'replay', conversation: current.conversation }
        : (existing.status === 'authorized' || existing.consumedTurns < existing.maxTurns) && existingLive && !replaceInvalidated
          ? { kind: 'authority_conflict', conversation: current.conversation }
          : this.replaceConsumedAuthority(input, snapshot.serialized!, current.conversation, authority);
    }
    if (current.conversation.continuations.length >= MAX_COORDINATOR_CONVERSATION_AUTHORIZATIONS) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      continuations: [...current.conversation.continuations, authority],
      updatedAt: nowIso(this.clock),
    };
    return this.saveCurrent(input, snapshot.serialized!, next)
      ? { kind: 'updated', conversation: next }
      : this.authorityReread(input);
  }

  private replaceConsumedAuthority(
    input: CoordinatorConversationScope & {
      expectedControlRevision: number;
      authority: CoordinatorConversationContinuationAuthority;
      replaceInvalidatedAuthority?: boolean;
    },
    serialized: string,
    conversation: CoordinatorConversation,
    authority: CoordinatorConversationContinuationAuthority,
  ): CoordinatorConversationAuthorityWrite {
    const next: CoordinatorConversation = {
      ...conversation,
      controlRevision: conversation.controlRevision + 1,
      continuations: conversation.continuations.map((candidate) =>
        candidate.goalId === authority.goalId ? authority : candidate,
      ),
      updatedAt: nowIso(this.clock),
    };
    return this.saveCurrent(input, serialized, next)
      ? { kind: 'updated', conversation: next }
      : this.authorityReread(input);
  }

  /**
   * Reserve exactly one outer-authorized turn before asynchronous dispatch.
   * `expectedConsumedTurns` makes retries idempotent without allowing a later
   * request to reuse the same reservation for a second SDK call.
   */
  reserveContinuationTurn(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    authorizationId: string;
    expectedConsumedTurns: number;
    /**
     * A later independent goal may advance the conversation-wide UI revision.
     * The bounded authorization remains fenced to its own authored goal, so a
     * sibling idea cannot revoke or consume it by itself.
     */
    expectedGoalRevision?: number;
    /** Rebound only after the service observed a settled current workstream. */
    workstreamRevision?: number;
  }): CoordinatorConversationAuthorityWrite {
    const snapshot = this.record(input);
    const current = snapshot.result;
    if (current.kind !== 'found') return current;
    const authority = current.conversation.continuations
      .find((candidate) => candidate.authorizationId === input.authorizationId);
    const goal = authority
      ? current.conversation.goals.find((candidate) => candidate.id === authority.goalId)
      : null;
    if (
      !authority || authority.authorizationId !== input.authorizationId || !goal ||
      goal.state !== 'linked' || goal.linkedWorkstreamId !== authority.workstreamId ||
      goal.revision !== authority.goalRevision ||
      (input.expectedGoalRevision !== undefined && goal.revision !== input.expectedGoalRevision)
    ) {
      return { kind: 'revision_conflict', conversation: current.conversation };
    }
    if (
      authority.status === 'consumed' &&
      authority.consumedTurns === input.expectedConsumedTurns + 1
    ) {
      return { kind: 'replay', conversation: current.conversation };
    }
    if (
      authority.consumedTurns !== input.expectedConsumedTurns ||
      authority.consumedTurns >= authority.maxTurns ||
      (authority.consumedTurns === 0 && authority.status !== 'authorized') ||
      (authority.consumedTurns > 0 && authority.status !== 'consumed')
    ) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    // This is deliberately a repository-side requirement rather than a
    // service-only recheck.  The parent permission/approval state lives on
    // the same durable session row as this control, so the final CAS below
    // can fence a change that lands after an awaited context read but before
    // the ordinal would otherwise be consumed.  A legacy schema-2/3 grant is
    // readable for status but has no such proof and therefore cannot reserve.
    if (!this.hasUsableParentPermissionAuthority(authority, input)) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    if (input.workstreamRevision !== undefined &&
        (!Number.isSafeInteger(input.workstreamRevision) || input.workstreamRevision < 1)) {
      return { kind: 'authority_conflict', conversation: current.conversation };
    }
    const next: CoordinatorConversation = {
      ...current.conversation,
      controlRevision: current.conversation.controlRevision + 1,
      continuations: current.conversation.continuations.map((candidate) =>
        candidate.authorizationId !== authority.authorizationId ? candidate : {
          ...authority,
          status: 'consumed' as const,
          consumedTurns: authority.consumedTurns + 1,
          ...(input.workstreamRevision === undefined ? {} : { workstreamRevision: input.workstreamRevision }),
        },
      ),
      updatedAt: nowIso(this.clock),
    };
    return this.saveCurrent(input, snapshot.serialized!, next, authority)
      ? { kind: 'updated', conversation: next }
      : this.authorityReread(input);
  }

  /** Backward-compatible one-turn helper retained for existing C1 callers. */
  markContinuationConsumed(input: CoordinatorConversationScope & {
    expectedControlRevision: number;
    authorizationId: string;
  }): CoordinatorConversationAuthorityWrite {
    return this.reserveContinuationTurn({ ...input, expectedConsumedTurns: 0 });
  }

  private authorityReread(scope: CoordinatorConversationScope): CoordinatorConversationAuthorityWrite {
    const reread = this.read(scope);
    return reread.kind === 'found'
      ? { kind: 'revision_conflict', conversation: reread.conversation }
      : reread;
  }

  private saveCurrent(
    scope: CoordinatorConversationScope,
    currentSerialized: string,
    next: CoordinatorConversation,
    /**
     * Optional only for finite-turn reservation.  When present it becomes
     * part of the exact SQLite UPDATE predicate rather than a stale read, so
     * a changed parent permission cannot consume an ordinal.
     */
    expectedAuthority?: CoordinatorConversationContinuationAuthority,
  ): boolean {
    const permission = expectedAuthority?.permissionAuthority;
    if (expectedAuthority && !this.hasUsableParentPermissionAuthority(expectedAuthority, scope)) {
      return false;
    }
    try {
      const permissionPredicate = permission === null || permission === undefined
        ? ''
        : ' AND profile_id=? AND permission_mode=? AND approval_bypass_explicit=?';
      return this.db.prepare(`UPDATE agent_sessions
          SET ${COORDINATOR_CONVERSATION_COLUMN}=?, updated_at=?
        WHERE id=? AND owner_user_id=? AND project_id=?
          AND parent_session_id IS NULL AND is_system=0 AND category='chat'
          AND ${COORDINATOR_CONVERSATION_COLUMN} IS ?${permissionPredicate}`).run(
        JSON.stringify(next),
        next.updatedAt,
        scope.sessionId,
        scope.ownerUserId,
        scope.projectId,
        currentSerialized,
        ...(permission === null || permission === undefined
          ? []
          : [
            expectedAuthority!.profileId,
            permission.parent.permissionMode,
            permission.parent.approvalBypassExplicit ? 1 : 0,
          ]),
      ).changes === 1;
    } catch {
      return false;
    }
  }

  /**
   * Structural validation is repeated here because callers of this repository
   * include recovery/terminal paths.  No caller may turn a stored nullable
   * legacy permission field into permission to reserve a new SDK turn.
   */
  private hasUsableParentPermissionAuthority(
    authority: CoordinatorConversationContinuationAuthority,
    scope: CoordinatorConversationScope,
  ): boolean {
    const permission = authority.permissionAuthority;
    if (!(permission !== null &&
      permission.schemaVersion === 1 &&
      permission.parent.sessionId === scope.sessionId &&
      permission.worker.parentSessionId === scope.sessionId &&
      permission.worker.permissionMode === 'default' &&
      permission.worker.managedReadOnly === true &&
      (permission.parent.permissionMode !== 'bypassPermissions' || permission.parent.approvalBypassExplicit === true))) {
      return false;
    }
    // The following local read gives callers a precise hold before the final
    // CAS. `saveCurrent` repeats these fields in that CAS predicate, so this
    // is explanatory only; it cannot create a check-then-use window.
    try {
      const row = this.db.prepare(`SELECT 1 AS present FROM agent_sessions
        WHERE id=? AND owner_user_id=? AND project_id=?
          AND parent_session_id IS NULL AND is_system=0 AND category='chat'
          AND profile_id=? AND permission_mode=? AND approval_bypass_explicit=?
        LIMIT 1`).get(
        scope.sessionId,
        scope.ownerUserId,
        scope.projectId,
        authority.profileId,
        permission.parent.permissionMode,
        permission.parent.approvalBypassExplicit ? 1 : 0,
      ) as { present: number } | undefined;
      return row?.present === 1;
    } catch {
      return false;
    }
  }
}
