import Database from 'better-sqlite3';
import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';
import type { AgentOrgProposal, AgentOrgProposalInput } from '../models/agent_org_proposal';
import {
  mapAgentConfigRow,
  type AgentConfig,
  type AgentConfigRow,
} from './agent_configs_repository';

/**
 * Dual-engine (proposals-parity fix, #1113 sibling): every method branches on
 * `env.dbClient`. SQLite keeps the original synchronous better-sqlite3 calls
 * (with the constructor's throwaway `:memory:` fallback preserved ONLY for
 * "no global DB initialized" under SQLite, e.g. a unit test that never called
 * initDb()). Postgres queries `getPostgresPool()` directly — there is no
 * in-memory fallback for Postgres: before this fix, `getDb()` unconditionally
 * threw under Postgres (no local `_db`), so every instance silently fell back
 * to a throwaway in-memory SQLite DB and every proposal vanished per-instance,
 * the exact same drift #1113 fixed for agent_capability_gaps. See
 * docs/ai/current-plan.md (proposals-parity) and postgres_bootstrap.ts for the
 * matching `agent_org_proposals` table.
 *
 * This reverses docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §5's
 * "proposals are local-only, never synced to production" call: that decision
 * predates #1111/#1113, which made the org-optimizer's own seed run under the
 * default 'all' deployment role regardless of DB engine (gated on
 * env.agentExecutionEnabled, not env.dbClient) — so the optimizer, and every
 * proposal it writes, now genuinely runs against Postgres-backed prod. A
 * proposal store that silently discards every row there defeats the review
 * queue entirely, and #1114 (MCP discovery/adoption) depends on proposals
 * actually persisting to be reviewable.
 */

interface AgentOrgProposalRow {
  id: string;
  audit_run_id: string | null;
  kind: string;
  risk: string;
  external: number | null;
  status: string;
  title: string;
  rationale: string | null;
  signal_ref: string | null;
  target_ref: string | null;
  change_json: string | null;
  before_snapshot_json: string | null;
  provenance_json: string | null;
  dedup_key: string | null;
  baseline_score: number | null;
  post_score: number | null;
  measure_reason: string | null;
  decided_by_user_id: number | null;
  // created_at/updated_at come back as a plain string from SQLite (TEXT) but
  // as a native Date from the `pg` driver (Postgres columns are TIMESTAMPTZ,
  // matching every other agent_* table in postgres_bootstrap.ts) — rowToModel
  // normalizes both to an ISO string.
  created_at: string | Date;
  updated_at: string | Date;
}

/**
 * The proposal status state machine (#817, extended by #857). Fail-closed:
 * any transition not explicitly listed here is rejected. `proposed ->
 * applied` (skipping `approved`) is the auto-apply lane for low-risk,
 * reversible proposals per the maintainer's full-autonomy-with-rollback
 * policy (2026-07-02) — the repository permits it unconditionally; gating
 * specific proposal `kind`s to human approval is a caller-side policy
 * decision made before calling updateStatusAsync.
 *
 * #857 — `active -> reverted`: a proposal that was already measured and kept
 * (`active`) can still need a human-triggered undo later (e.g. a reviewer
 * notices a bad prune after the fact, as happened on the first live
 * optimizer run — see docs/ai/runs/2026-07-02-mega-buildout-fork-eval-memory.md).
 * Before this, `revertProposal` calling `updateStatusAsync(id, 'reverted')`
 * on an `active` row threw "Illegal status transition 'active' -> 'reverted'",
 * so the only way to undo an already-kept proposal was a manual DB edit.
 *
 * `rejected` and `reverted` are terminal — no outgoing transitions.
 * `active`'s only outgoing transition is the new revert path.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  proposed: ['approved', 'rejected', 'applied', 'failed'],
  approved: ['applied'],
  applied: ['measuring'],
  measuring: ['active', 'reverted', 'rejected'],
  rejected: [],
  active: ['reverted'],
  reverted: [],
  /**
   * #1056 — publish-skill-to-org's applier marks a prod-down/unreachable
   * publish attempt 'failed' instead of leaving the proposal stuck at
   * 'proposed' with no record an attempt was made. Retryable: a human
   * re-approving a 'failed' proposal (org_proposals_controller.ts's approve()
   * guard accepts 'failed' the same as 'proposed') re-runs the SAME apply
   * step; 'failed' -> 'failed' lets a repeat failure re-mark the same status.
   */
  failed: ['applied', 'failed'],
};

/**
 * One prior attempt in the `workflow-fix:*` re-diagnosis family (#971-5):
 * the parsed attempt number `N` plus the full proposal row it came from.
 */
export interface OrgProposalAttempt {
  attempt: number;
  proposal: AgentOrgProposal;
}

export interface AtomicScopeTransitionInput {
  proposalId: string;
  expectedProposalStatus: 'active' | 'measuring' | 'reverted';
  nextProposalStatus: 'active' | 'measuring' | 'reverted';
  expectedKind: string;
  expectedChangeJson: string;
  expectedBeforeSnapshotJson: string;
  targetId: string;
  field: 'allowedMcpsJson' | 'allowedSkillsJson' | 'corePermissionsJson';
  expectedTargetValue: string | null;
  nextTargetValue: string | null;
  nextBaselineScore: number | null;
  nextPostScore: number | null;
  nextMeasureReason: string | null;
}

export interface AtomicScopeTransitionResult {
  proposal: AgentOrgProposal;
  target: AgentConfig;
}

class AtomicScopeConflict extends Error {}

/** Escape SQLite LIKE wildcards so a literal key fragment matches literally. */
function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToModel(row: AgentOrgProposalRow): AgentOrgProposal {
  return {
    id: row.id,
    auditRunId: row.audit_run_id ?? null,
    kind: row.kind,
    risk: row.risk,
    external: row.external ?? 0,
    status: row.status,
    title: row.title,
    rationale: row.rationale ?? null,
    signalRef: row.signal_ref ?? null,
    targetRef: row.target_ref ?? null,
    changeJson: row.change_json ?? null,
    beforeSnapshotJson: row.before_snapshot_json ?? null,
    provenanceJson: row.provenance_json ?? null,
    dedupKey: row.dedup_key ?? null,
    baselineScore: row.baseline_score ?? null,
    postScore: row.post_score ?? null,
    measureReason: row.measure_reason ?? null,
    decidedByUserId: row.decided_by_user_id ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class AgentOrgProposalsRepository {
  /** SQLite-only handle. Never populated (and never used) under Postgres. */
  private db: Database.Database | null;

  constructor(db?: Database.Database) {
    if (env.dbClient === 'postgres') {
      this.db = null;
      return;
    }
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        // No global DB initialized (e.g. a unit test that never called
        // initDb()) — create a throwaway in-memory instance. SQLite-only:
        // Postgres never falls back here (see constructor guard above).
        this.db = makeInMemoryDb();
      }
    }
  }

  private async findByIdPg(id: string): Promise<AgentOrgProposal | null> {
    const r = await getPostgresPool().query(`SELECT * FROM agent_org_proposals WHERE id = $1`, [id]);
    return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
  }

  async findByIdAsync(id: string): Promise<AgentOrgProposal | null> {
    if (env.dbClient === 'postgres') return this.findByIdPg(id);
    const row = this.db!
      .prepare(`SELECT * FROM agent_org_proposals WHERE id = ?`)
      .get(id) as AgentOrgProposalRow | undefined;
    return row ? rowToModel(row) : null;
  }

  async listByStatusAsync(status: string): Promise<AgentOrgProposal[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_org_proposals WHERE status = $1 ORDER BY created_at DESC`,
        [status],
      );
      return r.rows.map(rowToModel);
    }
    const rows = this.db!
      .prepare(`SELECT * FROM agent_org_proposals WHERE status = ? ORDER BY created_at DESC`)
      .all(status) as AgentOrgProposalRow[];
    return rows.map(rowToModel);
  }

  /** Convenience wrapper — the review queue's primary read. */
  async listProposedAsync(): Promise<AgentOrgProposal[]> {
    return this.listByStatusAsync('proposed');
  }

  async existsByDedupKeyAsync(key: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT 1 FROM agent_org_proposals WHERE dedup_key = $1 LIMIT 1`,
        [key],
      );
      return r.rows.length > 0;
    }
    const row = this.db!
      .prepare(`SELECT 1 FROM agent_org_proposals WHERE dedup_key = ? LIMIT 1`)
      .get(key);
    return row !== undefined;
  }

  /**
   * List all prior attempts for a `workflow-fix:*` base key (rows whose
   * `dedup_key` is `<baseKey>:a<N>`), parsed and ordered by attempt number
   * ascending. Backs the #971-5 attempt-aware re-diagnosis decision: the
   * caller inspects each row's `status` (all-`reverted` permits the next
   * attempt; any other status still blocks) and `measureReason` (fed back to
   * the LLM as "what was already tried and why it reverted"). Returns [] when
   * no attempt has ever been recorded for this base.
   */
  async listAttemptsForBaseAsync(baseKey: string): Promise<OrgProposalAttempt[]> {
    const pattern = `${escapeLikePattern(baseKey)}:a%`;
    let rows: AgentOrgProposalRow[];
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_org_proposals WHERE dedup_key LIKE $1 ESCAPE '\\'`,
        [pattern],
      );
      rows = r.rows;
    } else {
      rows = this.db!
        .prepare(`SELECT * FROM agent_org_proposals WHERE dedup_key LIKE ? ESCAPE '\\'`)
        .all(pattern) as AgentOrgProposalRow[];
    }
    const attempts: OrgProposalAttempt[] = [];
    for (const row of rows) {
      const m = /:a(\d+)$/.exec(row.dedup_key ?? '');
      if (m) attempts.push({ attempt: Number(m[1]), proposal: rowToModel(row) });
    }
    return attempts.sort((a, b) => a.attempt - b.attempt);
  }

  private findByDedupKeySync(key: string): AgentOrgProposal | null {
    const row = this.db!
      .prepare(`SELECT * FROM agent_org_proposals WHERE dedup_key = ? LIMIT 1`)
      .get(key) as AgentOrgProposalRow | undefined;
    return row ? rowToModel(row) : null;
  }

  private async findByDedupKeyPg(key: string): Promise<AgentOrgProposal | null> {
    const r = await getPostgresPool().query(
      `SELECT * FROM agent_org_proposals WHERE dedup_key = $1 LIMIT 1`,
      [key],
    );
    return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
  }

  private async findByDedupKeyAny(key: string): Promise<AgentOrgProposal | null> {
    return env.dbClient === 'postgres' ? this.findByDedupKeyPg(key) : this.findByDedupKeySync(key);
  }

  /**
   * Create a proposal. Idempotent on `dedupKey`: if a row with the same
   * dedup_key already exists, that EXISTING row is returned unchanged — no
   * duplicate insert, no throw, and the existing row's content (e.g. title)
   * is never overwritten by the new call. This is proactive (checked before
   * inserting) so callers never have to catch a UNIQUE constraint error; the
   * `idx_org_proposals_dedup` UNIQUE index is defense-in-depth for any
   * concurrent-writer race.
   */
  async createAsync(input: AgentOrgProposalInput): Promise<AgentOrgProposal> {
    if (input.dedupKey) {
      const existing = await this.findByDedupKeyAny(input.dedupKey);
      if (existing) return existing;
    }

    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    if (env.dbClient === 'postgres') {
      try {
        const inserted = await getPostgresPool().query(
          `INSERT INTO agent_org_proposals
             (id, audit_run_id, kind, risk, external, status, title, rationale,
              signal_ref, target_ref, change_json, before_snapshot_json,
              provenance_json, dedup_key, baseline_score, post_score,
              measure_reason, decided_by_user_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)
           ON CONFLICT (dedup_key) DO NOTHING
           RETURNING *`,
          [
            id,
            input.auditRunId ?? null,
            input.kind,
            input.risk,
            input.external ?? 0,
            input.status ?? 'proposed',
            input.title,
            input.rationale ?? null,
            input.signalRef ?? null,
            input.targetRef ?? null,
            input.changeJson ?? null,
            input.beforeSnapshotJson ?? null,
            input.provenanceJson ?? null,
            input.dedupKey ?? null,
            input.baselineScore ?? null,
            input.postScore ?? null,
            input.measureReason ?? null,
            input.decidedByUserId ?? null,
            now,
          ],
        );
        if (inserted.rows.length > 0) return rowToModel(inserted.rows[0]);
        // Conflict — a row with this dedup_key already existed. Re-select it.
        if (input.dedupKey) {
          const existing = await this.findByDedupKeyPg(input.dedupKey);
          if (existing) return existing;
        }
        throw new Error(
          `agent_org_proposals: insert for id '${id}' reported no row and dedup_key did not resolve on re-select`,
        );
      } catch (err) {
        // Defense-in-depth: a concurrent writer raced us between the
        // findByDedupKeyAny check and this insert.
        if (input.dedupKey) {
          const existing = await this.findByDedupKeyPg(input.dedupKey);
          if (existing) return existing;
        }
        throw err;
      }
    }

    try {
      this.db!
        .prepare(
          `INSERT INTO agent_org_proposals
            (id, audit_run_id, kind, risk, external, status, title, rationale,
             signal_ref, target_ref, change_json, before_snapshot_json,
             provenance_json, dedup_key, baseline_score, post_score,
             measure_reason, decided_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.auditRunId ?? null,
          input.kind,
          input.risk,
          input.external ?? 0,
          input.status ?? 'proposed',
          input.title,
          input.rationale ?? null,
          input.signalRef ?? null,
          input.targetRef ?? null,
          input.changeJson ?? null,
          input.beforeSnapshotJson ?? null,
          input.provenanceJson ?? null,
          input.dedupKey ?? null,
          input.baselineScore ?? null,
          input.postScore ?? null,
          input.measureReason ?? null,
          input.decidedByUserId ?? null,
          now,
          now,
        );
    } catch (err) {
      // Defense-in-depth: a concurrent writer raced us between the
      // findByDedupKey check and this insert. Treat it the same as the
      // proactive check — return the now-existing row, don't crash.
      if (input.dedupKey) {
        const existing = this.findByDedupKeySync(input.dedupKey);
        if (existing) return existing;
      }
      throw err;
    }

    return (await this.findByIdAsync(id))!;
  }

  /**
   * Advance a proposal's status, enforcing the {@link ALLOWED_TRANSITIONS}
   * state machine. Throws on an illegal transition (fail-closed — unknown
   * current status is also rejected). Returns null if `id` does not exist.
   * `patch` fields (e.g. baselineScore, postScore, measureReason,
   * beforeSnapshotJson) are applied in the same update as the status change.
   */
  async updateStatusAsync(
    id: string,
    status: string,
    patch?: Partial<AgentOrgProposalInput>,
  ): Promise<AgentOrgProposal | null> {
    const existing = await this.findByIdAsync(id);
    if (!existing) return null;

    const allowedNext = ALLOWED_TRANSITIONS[existing.status];
    if (!allowedNext || !allowedNext.includes(status)) {
      throw new Error(
        `Illegal agent_org_proposals status transition: '${existing.status}' -> '${status}' (proposal ${id})`,
      );
    }

    const fields: string[] = ['status = ?'];
    const values: unknown[] = [status];

    if (patch) {
      if (patch.auditRunId !== undefined) {
        fields.push('audit_run_id = ?');
        values.push(patch.auditRunId ?? null);
      }
      if (patch.rationale !== undefined) {
        fields.push('rationale = ?');
        values.push(patch.rationale ?? null);
      }
      if (patch.signalRef !== undefined) {
        fields.push('signal_ref = ?');
        values.push(patch.signalRef ?? null);
      }
      if (patch.targetRef !== undefined) {
        fields.push('target_ref = ?');
        values.push(patch.targetRef ?? null);
      }
      if (patch.changeJson !== undefined) {
        fields.push('change_json = ?');
        values.push(patch.changeJson ?? null);
      }
      if (patch.beforeSnapshotJson !== undefined) {
        fields.push('before_snapshot_json = ?');
        values.push(patch.beforeSnapshotJson ?? null);
      }
      if (patch.provenanceJson !== undefined) {
        fields.push('provenance_json = ?');
        values.push(patch.provenanceJson ?? null);
      }
      if (patch.baselineScore !== undefined) {
        fields.push('baseline_score = ?');
        values.push(patch.baselineScore ?? null);
      }
      if (patch.postScore !== undefined) {
        fields.push('post_score = ?');
        values.push(patch.postScore ?? null);
      }
      if (patch.measureReason !== undefined) {
        fields.push('measure_reason = ?');
        values.push(patch.measureReason ?? null);
      }
      if (patch.decidedByUserId !== undefined) {
        fields.push('decided_by_user_id = ?');
        values.push(patch.decidedByUserId ?? null);
      }
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    values.push(existing.status);

    if (env.dbClient === 'postgres') {
      // Same fields/values built above (shared between engines) — only the
      // placeholder syntax differs. `values` has exactly fields.length + 1
      // entries (the trailing id/source status are for the WHERE clause).
      const pgSetClause = fields.map((f, i) => f.replace('?', `$${i + 1}`)).join(', ');
      const idParam = `$${fields.length + 1}`;
      const sourceStatusParam = `$${fields.length + 2}`;
      const result = await getPostgresPool().query(
        `UPDATE agent_org_proposals
            SET ${pgSetClause}
          WHERE id = ${idParam} AND status = ${sourceStatusParam}
          RETURNING *`,
        values,
      );
      if (result.rows.length === 1) return rowToModel(result.rows[0]);
      const current = await this.findByIdAsync(id);
      if (!current) return null;
      throw new Error(
        `Concurrent agent_org_proposals status conflict: expected '${existing.status}' ` +
        `but found '${current.status}' (proposal ${id})`,
      );
    }

    const row = this.db!
      .prepare(
        `UPDATE agent_org_proposals
            SET ${fields.join(', ')}
          WHERE id = ? AND status = ?
          RETURNING *`,
      )
      .get(...values) as AgentOrgProposalRow | undefined;
    if (row) return rowToModel(row);
    const current = await this.findByIdAsync(id);
    if (!current) return null;
    throw new Error(
      `Concurrent agent_org_proposals status conflict: expected '${existing.status}' ` +
      `but found '${current.status}' (proposal ${id})`,
    );
  }

  /**
   * Atomically transitions one fixed agent-config scope column and the bound
   * proposal row on the same SQLite transaction. PostgreSQL is refused before
   * either write because the current scope target store is SQLite-only.
   */
  async transitionScopeAtomicallyAsync(
    input: AtomicScopeTransitionInput,
  ): Promise<AtomicScopeTransitionResult | null> {
    if (env.dbClient === 'postgres' || !this.db) {
      throw new Error('Atomic scope transition is unavailable for PostgreSQL split-store runtime');
    }
    const forward =
      (input.expectedProposalStatus === 'active' || input.expectedProposalStatus === 'measuring') &&
      input.nextProposalStatus === 'reverted';
    const inverse =
      input.expectedProposalStatus === 'reverted' &&
      (input.nextProposalStatus === 'active' || input.nextProposalStatus === 'measuring');
    if (!forward && !inverse) throw new Error('Unsupported atomic scope proposal transition');

    const columnByField = {
      allowedMcpsJson: 'allowed_mcps_json',
      allowedSkillsJson: 'allowed_skills_json',
      corePermissionsJson: 'core_permissions_json',
    } as const;
    const column = columnByField[input.field];
    if (!column) throw new Error(`Unsupported atomic scope field: ${String(input.field)}`);

    const execute = this.db.transaction((): AtomicScopeTransitionResult => {
      const target = this.db!
        .prepare(
          `UPDATE agent_configs
              SET ${column} = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND ${column} IS ?
            RETURNING *`,
        )
        .get(input.nextTargetValue, input.targetId, input.expectedTargetValue) as
        | AgentConfigRow
        | undefined;
      if (!target) throw new AtomicScopeConflict('scope target CAS conflict');

      const proposal = this.db!
        .prepare(
          `UPDATE agent_org_proposals
              SET status = ?,
                  baseline_score = ?,
                  post_score = ?,
                  measure_reason = ?,
                  updated_at = ?
            WHERE id = ?
              AND status = ?
              AND kind = ?
              AND change_json IS ?
              AND before_snapshot_json IS ?
            RETURNING *`,
        )
        .get(
          input.nextProposalStatus,
          input.nextBaselineScore,
          input.nextPostScore,
          input.nextMeasureReason,
          new Date().toISOString(),
          input.proposalId,
          input.expectedProposalStatus,
          input.expectedKind,
          input.expectedChangeJson,
          input.expectedBeforeSnapshotJson,
        ) as AgentOrgProposalRow | undefined;
      if (!proposal) throw new AtomicScopeConflict('scope proposal CAS conflict');
      return { proposal: rowToModel(proposal), target: mapAgentConfigRow(target) };
    });

    try {
      return execute();
    } catch (error) {
      if (error instanceof AtomicScopeConflict) return null;
      throw error;
    }
  }

  /**
   * Atomically wins a human approval and stores its rollback snapshot in the
   * same conditional UPDATE. There is deliberately no read-before-write:
   * concurrent approvers race on status and exactly one can move a proposed
   * or retryable failed row to applied.
   */
  async claimAppliedWithSnapshotAsync(
    id: string,
    decidedByUserId: number,
    beforeSnapshotJson: string | null,
    changeJson?: string | null,
  ): Promise<AgentOrgProposal | null> {
    if (!Number.isSafeInteger(decidedByUserId) || decidedByUserId < 0) {
      throw new Error('Scope proposal claim requires a non-negative integer audit actor');
    }
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      const values: unknown[] = [decidedByUserId, beforeSnapshotJson];
      const changeSet = changeJson === undefined ? '' : ', change_json = $3';
      if (changeJson !== undefined) values.push(changeJson);
      values.push(now, id);
      const updatedAtParam = `$${values.length - 1}`;
      const idParam = `$${values.length}`;
      const result = await getPostgresPool().query(
        `UPDATE agent_org_proposals
            SET status = 'applied',
                decided_by_user_id = $1,
                before_snapshot_json = $2${changeSet},
                updated_at = ${updatedAtParam}
          WHERE id = ${idParam}
            AND status IN ('proposed', 'failed')
          RETURNING *`,
        values,
      );
      return result.rows.length === 1 ? rowToModel(result.rows[0]) : null;
    }

    const statement = changeJson === undefined
      ? this.db!.prepare(
          `UPDATE agent_org_proposals
              SET status = 'applied',
                  decided_by_user_id = ?,
                  before_snapshot_json = ?,
                  updated_at = ?
            WHERE id = ?
              AND status IN ('proposed', 'failed')
            RETURNING *`,
        )
      : this.db!.prepare(
          `UPDATE agent_org_proposals
              SET status = 'applied',
                  decided_by_user_id = ?,
                  before_snapshot_json = ?,
                  change_json = ?,
                  updated_at = ?
            WHERE id = ?
              AND status IN ('proposed', 'failed')
            RETURNING *`,
        );
    const row = (changeJson === undefined
      ? statement.get(decidedByUserId, beforeSnapshotJson, now, id)
      : statement.get(decidedByUserId, beforeSnapshotJson, changeJson, now, id)) as
      | AgentOrgProposalRow
      | undefined;
    return row ? rowToModel(row) : null;
  }
}
