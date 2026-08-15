/**
 * W6-c3 — the experiment store.
 *
 * Declaration is complete-or-nothing: the stopping rule and the maximum
 * exposure are written with the specs, BEFORE any result exists, so no result
 * can retroactively author the rule it is judged by. The schema enforces the
 * same thing with triggers (see migrations.ts / postgres_bootstrap.ts), so a
 * future caller that bypasses this class still cannot rewrite a spec.
 *
 * Dual-engine, following AgentOrgProposalsRepository: SQLite uses synchronous
 * better-sqlite3 with the throwaway `:memory:` fallback for tests that never
 * called initDb(); Postgres queries the pool directly with no fallback.
 */

import Database from 'better-sqlite3';

import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  EXPERIMENT_DECISIONS,
  isExperimentResults,
  type AgentOrgExperiment,
  type DeclareExperimentInput,
  type ExperimentDecision,
  type ExperimentResults,
  type ExperimentStoppingRule,
} from '../models/agent_org_experiment';

interface ExperimentRow {
  id: string;
  proposal_id: string;
  adapter: string;
  evidence_bundle_json: string;
  baseline_spec_json: string;
  candidate_spec_json: string;
  assignment_key: string;
  stopping_rule_json: string;
  max_exposure: number;
  results_json: string | null;
  decision: string | null;
  decision_reason: string | null;
  declared_at: string | Date;
  results_recorded_at: string | Date | null;
  decided_at: string | Date | null;
  created_at: string | Date;
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToModel(row: ExperimentRow): AgentOrgExperiment {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    adapter: row.adapter,
    evidenceBundleJson: row.evidence_bundle_json,
    baselineSpecJson: row.baseline_spec_json,
    candidateSpecJson: row.candidate_spec_json,
    assignmentKey: row.assignment_key,
    stoppingRule: JSON.parse(row.stopping_rule_json) as ExperimentStoppingRule,
    maxExposure: Number(row.max_exposure),
    results: row.results_json ? (JSON.parse(row.results_json) as ExperimentResults) : null,
    decision: (row.decision as ExperimentDecision | null) ?? null,
    decisionReason: row.decision_reason ?? null,
    declaredAt: toIso(row.declared_at),
    resultsRecordedAt: row.results_recorded_at ? toIso(row.results_recorded_at) : null,
    decidedAt: row.decided_at ? toIso(row.decided_at) : null,
    createdAt: toIso(row.created_at),
  };
}

function isStoppingRule(v: unknown): v is ExperimentStoppingRule {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as ExperimentStoppingRule).minSamplesPerCohort) &&
    (v as ExperimentStoppingRule).minSamplesPerCohort > 0 &&
    Number.isFinite((v as ExperimentStoppingRule).minEffect) &&
    (v as ExperimentStoppingRule).minEffect >= 0
  );
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class AgentOrgExperimentsRepository {
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
        this.db = makeInMemoryDb();
      }
    }
  }

  async declareAsync(input: DeclareExperimentInput): Promise<AgentOrgExperiment> {
    for (const [field, value] of Object.entries({
      proposalId: input.proposalId,
      adapter: input.adapter,
      evidenceBundleJson: input.evidenceBundleJson,
      baselineSpecJson: input.baselineSpecJson,
      candidateSpecJson: input.candidateSpecJson,
      assignmentKey: input.assignmentKey,
    })) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`agent org experiment: '${field}' is required at declaration`);
      }
    }
    if (!isStoppingRule(input.stoppingRule)) {
      throw new Error(
        'agent org experiment: a predeclared stopping rule (minSamplesPerCohort, minEffect) is required',
      );
    }
    if (!Number.isSafeInteger(input.maxExposure) || input.maxExposure <= 0) {
      throw new Error('agent org experiment: a positive maximum exposure is required');
    }
    // P2-2 — the adapter is stored in its own column but the decision path reads
    // the BUNDLE's adapter. If the two may diverge, an experiment declared
    // `llm-body-score` carrying a promotion-capable bundle promotes. They must
    // agree at declaration or the column is a lie.
    let declaredBundleAdapter: unknown;
    try {
      declaredBundleAdapter = (JSON.parse(input.evidenceBundleJson) as Record<string, unknown>)
        ?.experimentAdapter;
    } catch {
      throw new Error('agent org experiment: the evidence bundle is not parseable JSON');
    }
    if (declaredBundleAdapter !== undefined && declaredBundleAdapter !== input.adapter) {
      throw new Error(
        `agent org experiment: declared adapter '${input.adapter}' contradicts the bundle's ` +
        `adapter '${String(declaredBundleAdapter)}'`,
      );
    }

    const row = {
      id: input.id ?? crypto.randomUUID(),
      proposal_id: input.proposalId,
      adapter: input.adapter,
      evidence_bundle_json: input.evidenceBundleJson,
      baseline_spec_json: input.baselineSpecJson,
      candidate_spec_json: input.candidateSpecJson,
      assignment_key: input.assignmentKey,
      stopping_rule_json: JSON.stringify(input.stoppingRule),
      max_exposure: input.maxExposure,
      declared_at: new Date().toISOString(),
    };

    const insertSql = (ph: string) =>
      `INSERT INTO agent_org_experiments
         (id, proposal_id, adapter, evidence_bundle_json, baseline_spec_json,
          candidate_spec_json, assignment_key, stopping_rule_json, max_exposure, declared_at)
       VALUES (${ph})`;
    try {
      if (env.dbClient === 'postgres') {
        await getPostgresPool().query(
          insertSql('$1,$2,$3,$4,$5,$6,$7,$8,$9,$10'),
          Object.values(row),
        );
      } else {
        this.db!.prepare(insertSql('?,?,?,?,?,?,?,?,?,?')).run(...Object.values(row));
      }
    } catch (err) {
      // The partial unique index is the real enforcement (both engines); this
      // only translates it into the reason an operator needs.
      if (/unique/i.test(String(err))) {
        throw new Error(
          `agent org experiment: proposal '${input.proposalId}' already has an undecided experiment`,
        );
      }
      throw err;
    }

    const stored = await this.findByIdAsync(row.id);
    if (!stored) throw new Error(`agent org experiment '${row.id}' was not persisted`);
    return stored;
  }

  async findByIdAsync(id: string): Promise<AgentOrgExperiment | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_org_experiments WHERE id = $1`,
        [id],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0] as ExperimentRow) : null;
    }
    const row = this.db!
      .prepare(`SELECT * FROM agent_org_experiments WHERE id = ?`)
      .get(id) as ExperimentRow | undefined;
    return row ? rowToModel(row) : null;
  }

  async listByProposalAsync(proposalId: string): Promise<AgentOrgExperiment[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_org_experiments WHERE proposal_id = $1 ORDER BY declared_at`,
        [proposalId],
      );
      return (r.rows as ExperimentRow[]).map(rowToModel);
    }
    const rows = this.db!
      .prepare(`SELECT * FROM agent_org_experiments WHERE proposal_id = ? ORDER BY declared_at`)
      .all(proposalId) as ExperimentRow[];
    return rows.map(rowToModel);
  }

  /**
   * Every experiment still awaiting a decision, oldest declaration first.
   *
   * Read-only. The cohort wiring uses this to answer "is there an active,
   * undecided experiment a finishing run may be enrolled into?", and the
   * optimizer's judging sweep uses it to answer "is there anything to judge?".
   * A decided experiment is history and never appears here, so neither caller
   * can re-open one.
   */
  async listUndecidedAsync(): Promise<AgentOrgExperiment[]> {
    const sql = `SELECT * FROM agent_org_experiments WHERE decision IS NULL ORDER BY declared_at`;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(sql);
      return (r.rows as ExperimentRow[]).map(rowToModel);
    }
    return (this.db!.prepare(sql).all() as ExperimentRow[]).map(rowToModel);
  }

  async recordResultsAsync(
    id: string,
    results: ExperimentResults,
  ): Promise<AgentOrgExperiment> {
    if (!isExperimentResults(results)) {
      throw new Error(
        'agent org experiment: results must carry sampleCount and primaryMetricValue for both the baseline and the candidate cohort',
      );
    }
    const existing = await this.findByIdAsync(id);
    if (!existing) throw new Error(`agent org experiment '${id}' does not exist`);
    if (existing.results) {
      throw new Error(`agent org experiment '${id}' already has recorded results`);
    }
    const now = new Date().toISOString();
    const payload = JSON.stringify(results);
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_org_experiments
            SET results_json = $1, results_recorded_at = $2
          WHERE id = $3 AND results_json IS NULL`,
        [payload, now, id],
      );
    } else {
      this.db!
        .prepare(
          `UPDATE agent_org_experiments
              SET results_json = ?, results_recorded_at = ?
            WHERE id = ? AND results_json IS NULL`,
        )
        .run(payload, now, id);
    }
    return (await this.findByIdAsync(id))!;
  }

  async recordDecisionAsync(
    id: string,
    decision: ExperimentDecision,
    reason: string,
  ): Promise<AgentOrgExperiment> {
    if (!EXPERIMENT_DECISIONS.includes(decision)) {
      throw new Error(
        `agent org experiment: decision must be one of ${EXPERIMENT_DECISIONS.join(' | ')}, got '${String(decision)}'`,
      );
    }
    const existing = await this.findByIdAsync(id);
    if (!existing) throw new Error(`agent org experiment '${id}' does not exist`);
    if (existing.decision) {
      throw new Error(`agent org experiment '${id}' is already decided`);
    }
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_org_experiments
            SET decision = $1, decision_reason = $2, decided_at = $3
          WHERE id = $4 AND decision IS NULL`,
        [decision, reason, now, id],
      );
    } else {
      this.db!
        .prepare(
          `UPDATE agent_org_experiments
              SET decision = ?, decision_reason = ?, decided_at = ?
            WHERE id = ? AND decision IS NULL`,
        )
        .run(decision, reason, now, id);
    }
    return (await this.findByIdAsync(id))!;
  }
}
