/**
 * D1.1 (#1426) — ToolSafetyReportsRepository (additive, dual-engine).
 *
 * Dual-engine, following CalibrationObservationsRepository: SQLite uses
 * synchronous better-sqlite3 with the throwaway `:memory:` fallback for tests
 * that never called initDb(); Postgres queries the pool directly with no
 * fallback. The column set MUST stay identical to the SQLite schema in
 * migrations.ts and postgres_bootstrap.ts — enforced by
 * skill_schema_parity.test.ts.
 *
 * `redactSecrets` (the same shape-matching redactor post_apply_events_repository.ts
 * uses) runs on every free-text JSON blob column on the way IN — the
 * repository never trusts a caller to have redacted a raw secret shape first.
 */
import Database from 'better-sqlite3';

import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  isToolSafetyVerdict,
  type ToolSafetyReport,
  type ToolSafetyReportInput,
} from '../models/tool_safety_report';
import { redactSecrets } from '../services/run_outcome_service';

interface ToolSafetyReportRow {
  id: string;
  proposal_id: string;
  tool_name: string;
  tool_version: string | null;
  package_source: string;
  install_method: string;
  sandbox_duration_ms: number;
  test_prompts_run_count: number;
  forbidden_path_violations_json: string;
  network_calls_observed_json: string;
  file_system_writes_observed_json: string;
  credential_access_attempts_count: number;
  verdict: string;
  reason: string | null;
  evidence_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToModel(row: ToolSafetyReportRow): ToolSafetyReport {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    toolName: row.tool_name,
    toolVersion: row.tool_version ?? null,
    packageSource: row.package_source,
    installMethod: row.install_method,
    sandboxDurationMs: Number(row.sandbox_duration_ms),
    testPromptsRunCount: Number(row.test_prompts_run_count),
    forbiddenPathViolationsJson: row.forbidden_path_violations_json,
    networkCallsObservedJson: row.network_calls_observed_json,
    fileSystemWritesObservedJson: row.file_system_writes_observed_json,
    credentialAccessAttemptsCount: Number(row.credential_access_attempts_count),
    verdict: isToolSafetyVerdict(row.verdict) ? row.verdict : 'unknown',
    reason: row.reason ?? null,
    evidenceJson: row.evidence_json,
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

/** Fail-closed validation — a malformed report is rejected, never silently coerced. */
function assertRequiredFields(input: ToolSafetyReportInput): void {
  for (const [field, value] of Object.entries({
    proposalId: input.proposalId,
    toolName: input.toolName,
    packageSource: input.packageSource,
    installMethod: input.installMethod,
  })) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`tool safety report: '${field}' is required`);
    }
  }
  if (typeof input.sandboxDurationMs !== 'number' || !Number.isFinite(input.sandboxDurationMs)) {
    throw new Error(`tool safety report: 'sandboxDurationMs' must be a finite number`);
  }
  if (typeof input.testPromptsRunCount !== 'number' || !Number.isFinite(input.testPromptsRunCount)) {
    throw new Error(`tool safety report: 'testPromptsRunCount' must be a finite number`);
  }
  if (!isToolSafetyVerdict(input.verdict)) {
    throw new Error(`tool safety report: 'verdict' must be one of the closed enum values`);
  }
}

export class ToolSafetyReportsRepository {
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

  async createAsync(input: ToolSafetyReportInput): Promise<ToolSafetyReport> {
    assertRequiredFields(input);

    const row = {
      id: input.id ?? crypto.randomUUID(),
      proposal_id: input.proposalId,
      tool_name: input.toolName,
      tool_version: input.toolVersion ?? null,
      package_source: input.packageSource,
      install_method: input.installMethod,
      sandbox_duration_ms: input.sandboxDurationMs,
      test_prompts_run_count: input.testPromptsRunCount,
      forbidden_path_violations_json: redactSecrets(input.forbiddenPathViolationsJson ?? '[]'),
      network_calls_observed_json: redactSecrets(input.networkCallsObservedJson ?? '[]'),
      file_system_writes_observed_json: redactSecrets(input.fileSystemWritesObservedJson ?? '[]'),
      credential_access_attempts_count: input.credentialAccessAttemptsCount ?? 0,
      verdict: input.verdict,
      reason: input.reason ?? null,
      evidence_json: redactSecrets(input.evidenceJson ?? '{}'),
    };

    const insertSql = (ph: string) =>
      `INSERT INTO tool_safety_reports
         (id, proposal_id, tool_name, tool_version, package_source, install_method,
          sandbox_duration_ms, test_prompts_run_count, forbidden_path_violations_json,
          network_calls_observed_json, file_system_writes_observed_json,
          credential_access_attempts_count, verdict, reason, evidence_json)
       VALUES (${ph})`;

    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        insertSql('$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15'),
        Object.values(row),
      );
    } else {
      this.db!.prepare(insertSql('?,?,?,?,?,?,?,?,?,?,?,?,?,?,?')).run(...Object.values(row));
    }

    const stored = await this.findByIdAsync(row.id);
    if (!stored) throw new Error(`tool safety report '${row.id}' was not persisted`);
    return stored;
  }

  async findByIdAsync(id: string): Promise<ToolSafetyReport | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(`SELECT * FROM tool_safety_reports WHERE id = $1`, [id]);
      return r.rows.length > 0 ? rowToModel(r.rows[0] as ToolSafetyReportRow) : null;
    }
    const row = this.db!
      .prepare(`SELECT * FROM tool_safety_reports WHERE id = ?`)
      .get(id) as ToolSafetyReportRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /**
   * The most recently created report for a proposal, or null if none exists.
   * SQLite orders by its implicit `rowid` — a real, monotonic insertion-order
   * tiebreak, immune to two reports landing in the same millisecond (the
   * common case for a resumed sandbox-unavailable retry). Postgres has no
   * equivalent cheap tiebreak on this table's id (a random UUID, not an
   * insertion-ordered key); ponytail: falls back to `created_at DESC` alone,
   * which is exact except for two reports for the SAME proposal committed
   * within the same millisecond — not a realistic race for a human-triggered
   * re-vet, but upgrade to an explicit sequence column if that ever changes.
   */
  async findByProposalIdAsync(proposalId: string): Promise<ToolSafetyReport | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM tool_safety_reports WHERE proposal_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [proposalId],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0] as ToolSafetyReportRow) : null;
    }
    const row = this.db!
      .prepare(
        `SELECT * FROM tool_safety_reports WHERE proposal_id = ? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(proposalId) as ToolSafetyReportRow | undefined;
    return row ? rowToModel(row) : null;
  }
}
