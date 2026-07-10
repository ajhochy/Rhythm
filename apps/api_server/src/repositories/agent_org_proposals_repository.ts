import Database from 'better-sqlite3';
import { getDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import type { AgentOrgProposal, AgentOrgProposalInput } from '../models/agent_org_proposal';

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
  created_at: string;
  updated_at: string;
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
  proposed: ['approved', 'rejected', 'applied'],
  approved: ['applied'],
  applied: ['measuring'],
  measuring: ['active', 'reverted'],
  rejected: [],
  active: ['reverted'],
  reverted: [],
};

/**
 * One prior attempt in the `workflow-fix:*` re-diagnosis family (#971-5):
 * the parsed attempt number `N` plus the full proposal row it came from.
 */
export interface OrgProposalAttempt {
  attempt: number;
  proposal: AgentOrgProposal;
}

/** Escape SQLite LIKE wildcards so a literal key fragment matches literally. */
function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class AgentOrgProposalsRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        // No global DB initialized — create an in-memory instance (e.g. in tests)
        this.db = makeInMemoryDb();
      }
    }
  }

  async findByIdAsync(id: string): Promise<AgentOrgProposal | null> {
    const row = this.db
      .prepare(`SELECT * FROM agent_org_proposals WHERE id = ?`)
      .get(id) as AgentOrgProposalRow | undefined;
    return row ? rowToModel(row) : null;
  }

  async listByStatusAsync(status: string): Promise<AgentOrgProposal[]> {
    const rows = this.db
      .prepare(`SELECT * FROM agent_org_proposals WHERE status = ? ORDER BY created_at DESC`)
      .all(status) as AgentOrgProposalRow[];
    return rows.map(rowToModel);
  }

  /** Convenience wrapper — the review queue's primary read. */
  async listProposedAsync(): Promise<AgentOrgProposal[]> {
    return this.listByStatusAsync('proposed');
  }

  async existsByDedupKeyAsync(key: string): Promise<boolean> {
    const row = this.db
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
    const rows = this.db
      .prepare(`SELECT * FROM agent_org_proposals WHERE dedup_key LIKE ? ESCAPE '\\'`)
      .all(`${escapeLikePattern(baseKey)}:a%`) as AgentOrgProposalRow[];
    const attempts: OrgProposalAttempt[] = [];
    for (const row of rows) {
      const m = /:a(\d+)$/.exec(row.dedup_key ?? '');
      if (m) attempts.push({ attempt: Number(m[1]), proposal: rowToModel(row) });
    }
    return attempts.sort((a, b) => a.attempt - b.attempt);
  }

  private findByDedupKey(key: string): AgentOrgProposal | null {
    const row = this.db
      .prepare(`SELECT * FROM agent_org_proposals WHERE dedup_key = ? LIMIT 1`)
      .get(key) as AgentOrgProposalRow | undefined;
    return row ? rowToModel(row) : null;
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
      const existing = this.findByDedupKey(input.dedupKey);
      if (existing) return existing;
    }

    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      this.db
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
        const existing = this.findByDedupKey(input.dedupKey);
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

    this.db
      .prepare(`UPDATE agent_org_proposals SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.findByIdAsync(id);
  }
}
