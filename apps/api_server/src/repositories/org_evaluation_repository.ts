import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import type {
  OrgEvaluationBudget, OrgEvaluationCandidate, OrgEvaluationJob, OrgEvaluationResult,
  OrgEvaluationStage, OrgEvaluationTokenReservation, OrgEvaluationTokenUsage,
  OrgEvaluationExecutionReceipt,
} from '../models/org_evaluation';
import { ORG_EVALUATION_PROPOSAL_KINDS } from '../models/org_evaluation';
import { verifyObservedEffects } from '../models/org_evaluation_effect_evidence';
import { evaluationCanonicalJson } from '../services/org_evaluation_integrity';
import { deriveSingletonPublicationAction } from '../services/org_evaluation_singleton_action';

export type CreateOrgEvaluationJobInput = Omit<OrgEvaluationJob,
  'budgetRootId' | 'status' | 'finalCandidateId' | 'qualifiedProposalId' | 'failureReason' | 'revision' | 'createdAt' | 'updatedAt'> &
  { budgetRootId?: string | null };
export type AddOrgEvaluationCandidateInput = Omit<OrgEvaluationCandidate, 'createdAt'>;
export type AddOrgEvaluationResultInput = Omit<OrgEvaluationResult, 'createdAt'>;
type Row = Record<string, unknown>;

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
const parseJson = (value: unknown) => JSON.parse(String(value));

function pointer(root: unknown, path: string): { exists: boolean; value: unknown } {
  if (!path.startsWith('/') || path.length > 300) return { exists: false, value: undefined };
  let current = root;
  for (const raw of path.slice(1).split('/')) {
    if (/~(?![01])/.test(raw)) return { exists: false, value: undefined };
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return { exists: false, value: undefined };
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length) return { exists: false, value: undefined };
      current = current[Number(key)];
    } else if (current && typeof current === 'object' && Object.hasOwn(current, key)) {
      current = (current as Record<string, unknown>)[key];
    } else return { exists: false, value: undefined };
  }
  return { exists: true, value: current };
}

function portionMatches(sourceJson: string, composedJson: string,
  part: NonNullable<OrgEvaluationCandidate['compositionParts']>[number]): boolean {
  const source = pointer(parseJson(sourceJson), part.changePath);
  const composed = pointer(parseJson(composedJson), part.changePath);
  if (!source.exists || part.sourceFragment !== undefined && (
    typeof part.sourceFragment !== 'string' || !part.sourceFragment || part.sourceFragment.length > 4096
    || typeof source.value !== 'string' || !source.value.includes(part.sourceFragment))) return false;
  const copied = part.sourceFragment !== undefined
    ? composed.exists && typeof composed.value === 'string' && composed.value.includes(part.sourceFragment)
    : composed.exists && evaluationCanonicalJson(source.value) === evaluationCanonicalJson(composed.value);
  return part.retained ? copied : !copied;
}

function jobFromRow(row: Row): OrgEvaluationJob {
  return {
    id: String(row.id), budgetRootId: (row.budget_root_id as string | null) ?? null,
    sourceAuditRunId: row.source_audit_run_id as string | null,
    ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
    status: row.status as OrgEvaluationJob['status'], maxTokens: Number(row.max_tokens),
    validationReserveTokens: Number(row.validation_reserve_tokens), originalHash: String(row.original_hash),
    targetRef: String(row.target_ref), targetRevision: String(row.target_revision), inputJson: String(row.input_json),
    finalCandidateId: row.final_candidate_id as string | null,
    qualifiedProposalId: row.qualified_proposal_id as string | null,
    failureReason: row.failure_reason as string | null, revision: Number(row.revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function candidateFromRow(row: Row): OrgEvaluationCandidate {
  return {
    id: String(row.id), jobId: String(row.job_id), role: row.role as OrgEvaluationCandidate['role'],
    ordinal: Number(row.ordinal), kind: row.kind as OrgEvaluationCandidate['kind'],
    targetRef: String(row.target_ref), configHash: String(row.config_hash),
    effectiveConfigJson: String(row.effective_config_json), changeJson: String(row.change_json),
    parentCandidateIds: parseJson(row.parent_candidate_ids_json),
    compositionParts: parseJson(row.composition_parts_json ?? '[]'), createdAt: String(row.created_at),
  };
}

function resultFromRow(row: Row): OrgEvaluationResult {
  return {
    id: String(row.id), jobId: String(row.job_id), candidateId: String(row.candidate_id),
    phase: row.phase as OrgEvaluationResult['phase'], taskKey: String(row.task_key),
    receiptHash: String(row.receipt_hash), receiptJson: String(row.receipt_json),
    status: row.status as OrgEvaluationResult['status'],
    score: row.score === null ? null : Number(row.score),
    tokenUsage: row.token_usage_json === null ? null : parseJson(row.token_usage_json),
    failureReason: row.failure_reason as string | null, createdAt: String(row.created_at),
  };
}

function reservationFromRow(row: Row): OrgEvaluationTokenReservation {
  return {
    jobId: String(row.job_id), reservationKey: String(row.reservation_key),
    stage: row.stage as OrgEvaluationStage, maxTokens: Number(row.max_tokens),
    status: row.status as OrgEvaluationTokenReservation['status'],
    actualTokens: row.actual_tokens === null ? null : Number(row.actual_tokens),
    createdAt: String(row.created_at), settledAt: row.settled_at as string | null,
  };
}

function budgetFromRows(job: OrgEvaluationJob, reservations: OrgEvaluationTokenReservation[]): OrgEvaluationBudget {
  const settledTokens = reservations.reduce((sum, r) => sum + (r.status === 'settled' ? r.actualTokens! : 0), 0);
  // Unknown provider usage holds the full reservation. A restart must not
  // refund tokens merely because the provider's final accounting was lost.
  const outstandingTokens = reservations.reduce((sum, r) => sum + (r.status !== 'settled' ? r.maxTokens : 0), 0);
  const validationCommitted = reservations.reduce((sum, r) => sum + (r.stage === 'final-validation'
    ? r.status === 'settled' ? r.actualTokens! : r.maxTokens : 0), 0);
  const held = Math.max(0, job.validationReserveTokens - validationCommitted);
  return {
    maxTokens: job.maxTokens, validationReserveTokens: job.validationReserveTokens,
    settledTokens, outstandingTokens,
    explorationAvailableTokens: Math.max(0, job.maxTokens - settledTokens - outstandingTokens - held),
    totalAvailableTokens: Math.max(0, job.maxTokens - settledTokens - outstandingTokens),
    hasUnknownUsage: reservations.some((r) => r.status === 'unknown'),
  };
}

function assertQualificationEvidence(
  job: OrgEvaluationJob, budgetRoot: OrgEvaluationJob,
  candidates: OrgEvaluationCandidate[], results: OrgEvaluationResult[],
  reservations: OrgEvaluationTokenReservation[], finalId: string | null,
): void {
  const original = candidates.find((c) => c.role === 'original');
  const final = candidates.find((c) => c.id === finalId && c.role === 'final');
  const variants = candidates.filter((c) => c.role === 'variant');
  const composition = candidates.find((c) => c.id === final?.parentCandidateIds[0] && c.role === 'composition');
  const frozenInput = parseJson(job.inputJson) as Record<string, unknown>;
  const singleton = frozenInput.candidateStrategy === 'singleton-action';
  const budget = budgetFromRows(budgetRoot, reservations);
  if (!original || candidates.filter((c) => c.role === 'original').length !== 1 || !final
    || budget.hasUnknownUsage
    || budget.settledTokens > budgetRoot.maxTokens || budget.outstandingTokens > 0)
    throw new Error('Evaluation is not qualified');
  if (singleton) {
    const problem = frozenInput.problem as Record<string, unknown> | undefined;
    const action = deriveSingletonPublicationAction({ kind: variants[0]?.kind ?? original.kind,
      targetRef: job.targetRef, snapshot: frozenInput.snapshot as Record<string, unknown>, change: problem?.change });
    if (!action || variants.length !== 1 || candidates.length !== 3 || composition
      || candidates.some((candidate) => candidate.kind !== 'publish-skill-to-org'
        || candidate.targetRef !== job.targetRef)
      || variants[0].parentCandidateIds.length || variants[0].changeJson !== evaluationCanonicalJson(action)
      || final.parentCandidateIds.length !== 1 || final.parentCandidateIds[0] !== variants[0].id
      || final.changeJson !== variants[0].changeJson || final.configHash !== variants[0].configHash
      || final.effectiveConfigJson !== variants[0].effectiveConfigJson
      || (final.compositionParts ?? []).length)
      throw new Error('Singleton action does not match its frozen publication lineage');
    const probeKeys = Array.isArray(frozenInput.probes)
      ? frozenInput.probes.map((item) => item && typeof item === 'object'
        ? (item as Record<string, unknown>).key : null) : [];
    const originalProbe = results.filter((result) => result.phase === 'probe' && result.candidateId === original.id);
    const variantProbe = results.filter((result) => result.phase === 'probe' && result.candidateId === variants[0].id);
    if (!probeKeys.length || probeKeys.some((key) => typeof key !== 'string' || !key)
      || new Set(probeKeys).size !== probeKeys.length
      || originalProbe.length !== probeKeys.length || variantProbe.length !== probeKeys.length
      || probeKeys.some((key) => {
        const baseline = originalProbe.find((result) => result.taskKey === key);
        const treatment = variantProbe.find((result) => result.taskKey === key);
        if (!baseline || !treatment || baseline.status !== 'pass' || treatment.status !== 'pass'
          || baseline.score === null || treatment.score !== 1 || treatment.score < baseline.score) return true;
        const baselineReceipt = parseJson(baseline.receiptJson) as OrgEvaluationExecutionReceipt;
        const treatmentReceipt = parseJson(treatment.receiptJson) as OrgEvaluationExecutionReceipt;
        return !baselineReceipt.sessionId || !treatmentReceipt.sessionId
          || baselineReceipt.sessionId === treatmentReceipt.sessionId
          || baselineReceipt.taskFixtureHash !== treatmentReceipt.taskFixtureHash;
      }) || !probeKeys.some((key) => variantProbe.find((result) => result.taskKey === key)!.score!
        > originalProbe.find((result) => result.taskKey === key)!.score!))
      throw new Error('Singleton action lacks paired improved original probe evidence');
  } else if (!composition || final.parentCandidateIds.length !== 1
    || final.changeJson !== composition.changeJson || final.configHash !== composition.configHash
    || final.effectiveConfigJson !== composition.effectiveConfigJson
    || JSON.stringify(final.compositionParts ?? []) !== JSON.stringify(composition.compositionParts ?? [])
    || !composition.compositionParts?.some((part) => part.retained)
    || variants.length < 2 || variants.length > 3 || original.kind === 'publish-skill-to-org')
    throw new Error('Evaluation is not qualified');
  const probed = singleton ? [original, ...variants] : [original, ...variants, composition!];
  if (probed.some((candidate) => !results.some((result) => result.candidateId === candidate.id
    && result.phase === 'probe' && result.status === 'pass' && result.score !== null)))
    throw new Error('Every variant and the original need actual probe evidence');
  const baseline = results.filter((r) => r.phase === 'validation' && r.candidateId === original.id);
  const treatment = results.filter((r) => r.phase === 'validation' && r.candidateId === final.id);
  if (singleton) {
    const withheldKeys = Array.isArray(frozenInput.validation)
      ? frozenInput.validation.map((item) => item && typeof item === 'object'
        ? (item as Record<string, unknown>).key : null) : [];
    if (!withheldKeys.length || withheldKeys.some((key) => typeof key !== 'string' || !key)
      || new Set(withheldKeys).size !== withheldKeys.length || baseline.length !== withheldKeys.length
      || treatment.length !== withheldKeys.length
      || withheldKeys.some((key) => !baseline.some((result) => result.taskKey === key)
        || !treatment.some((result) => result.taskKey === key)))
      throw new Error('Singleton final lacks the frozen independent validation tasks');
  }
  if (!baseline.length || baseline.length !== treatment.length || baseline.some((b) => {
    const f = treatment.find((r) => r.taskKey === b.taskKey);
    if (!f || b.status !== 'pass' || f.status !== 'pass' || b.score === null || f.score !== 1 || f.score < b.score)
      return true;
    const originalReceipt = parseJson(b.receiptJson) as OrgEvaluationExecutionReceipt;
    const finalReceipt = parseJson(f.receiptJson) as OrgEvaluationExecutionReceipt;
    return !originalReceipt.sessionId || !finalReceipt.sessionId
      || originalReceipt.sessionId === finalReceipt.sessionId
      || originalReceipt.taskFixtureHash !== finalReceipt.taskFixtureHash
      || originalReceipt.effectiveConfigHash !== original.configHash
      || finalReceipt.effectiveConfigHash !== final.configHash;
  }) || !baseline.some((b) => treatment.some((f) => f.taskKey === b.taskKey && f.score! > b.score!)))
    throw new Error('Independent final validation has not improved on the original');
}

/** All budget admissions lock the parent job row (Postgres) or SQLite writer (BEGIN IMMEDIATE). */
export class OrgEvaluationRepository {
  private readonly db: Database.Database | null;
  private readonly postgres: boolean;

  constructor(db?: Database.Database) {
    this.postgres = !db && env.dbClient === 'postgres';
    this.db = this.postgres ? null : db ?? getDb();
  }

  private async rows(table: string, jobId: string): Promise<Row[]> {
    if (this.postgres) return (await getPostgresPool().query(`SELECT * FROM ${table} WHERE job_id = $1 ORDER BY created_at`, [jobId])).rows;
    return this.db!.prepare(`SELECT * FROM ${table} WHERE job_id = ? ORDER BY created_at`).all(jobId) as Row[];
  }

  private async budgetReservations(rootId: string): Promise<OrgEvaluationTokenReservation[]> {
    const sql = `SELECT r.* FROM org_evaluation_token_reservations r
      JOIN org_evaluation_jobs j ON j.id = r.job_id
      WHERE j.id = ? OR j.budget_root_id = ? ORDER BY r.created_at`;
    if (this.postgres) {
      return (await getPostgresPool().query(`SELECT r.* FROM org_evaluation_token_reservations r
        JOIN org_evaluation_jobs j ON j.id = r.job_id
        WHERE j.id = $1 OR j.budget_root_id = $1 ORDER BY r.created_at`, [rootId])).rows.map(reservationFromRow);
    }
    return (this.db!.prepare(sql).all(rootId, rootId) as Row[]).map(reservationFromRow);
  }

  async createJobAsync(input: CreateOrgEvaluationJobInput): Promise<OrgEvaluationJob> {
    if (!integer(input.maxTokens) || input.maxTokens === 0 || !integer(input.validationReserveTokens)
      || input.validationReserveTokens >= input.maxTokens) throw new Error('Invalid evaluation token limits');
    parseJson(input.inputJson);
    if (input.budgetRootId) {
      const root = await this.getJobAsync(input.budgetRootId);
      if (!root || root.budgetRootId || root.ownerUserId !== input.ownerUserId || root.id === input.id
        || ['qualified', 'failed', 'inconclusive'].includes(root.status)
        || input.maxTokens > root.maxTokens)
        throw new Error('Invalid shared evaluation budget root');
    }
    const timestamp = now();
    const values = [input.id, input.budgetRootId ?? null, input.sourceAuditRunId, input.ownerUserId, 'planning', input.maxTokens,
      input.validationReserveTokens, input.originalHash, input.targetRef, input.targetRevision, input.inputJson,
      timestamp, timestamp];
    if (this.postgres) {
      const client = await getPostgresPool().connect();
      try {
        await client.query('BEGIN');
        if (input.budgetRootId) {
          const root = (await client.query('SELECT * FROM org_evaluation_jobs WHERE id=$1 FOR UPDATE', [input.budgetRootId])).rows[0];
          if (!root || root.budget_root_id || root.owner_user_id !== input.ownerUserId
            || ['qualified', 'failed', 'inconclusive'].includes(root.status) || input.maxTokens > Number(root.max_tokens))
            throw new Error('Invalid shared evaluation budget root');
        }
        await client.query(`INSERT INTO org_evaluation_jobs
          (id, budget_root_id, source_audit_run_id, owner_user_id, status, max_tokens, validation_reserve_tokens,
           original_hash, target_ref, target_revision, input_json, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, values);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    } else {
      this.db!.transaction(() => {
        if (input.budgetRootId) {
          const root = this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id=?').get(input.budgetRootId) as Row | undefined;
          if (!root || root.budget_root_id || root.owner_user_id !== input.ownerUserId
            || ['qualified', 'failed', 'inconclusive'].includes(String(root.status)) || input.maxTokens > Number(root.max_tokens))
            throw new Error('Invalid shared evaluation budget root');
        }
        this.db!.prepare(`INSERT INTO org_evaluation_jobs
          (id, budget_root_id, source_audit_run_id, owner_user_id, status, max_tokens, validation_reserve_tokens,
           original_hash, target_ref, target_revision, input_json, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values);
      })();
    }
    return (await this.getJobAsync(input.id))!;
  }

  async getJobAsync(id: string): Promise<OrgEvaluationJob | null> {
    const row = this.postgres
      ? (await getPostgresPool().query('SELECT * FROM org_evaluation_jobs WHERE id = $1', [id])).rows[0]
      : this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id = ?').get(id);
    return row ? jobFromRow(row as Row) : null;
  }

  async listJobsAsync(ownerUserId?: number | null): Promise<OrgEvaluationJob[]> {
    if (this.postgres) {
      const sql = ownerUserId === undefined ? 'SELECT * FROM org_evaluation_jobs ORDER BY created_at DESC, id'
        : 'SELECT * FROM org_evaluation_jobs WHERE owner_user_id IS NOT DISTINCT FROM $1 ORDER BY created_at DESC, id';
      return (await getPostgresPool().query(sql, ownerUserId === undefined ? [] : [ownerUserId])).rows.map(jobFromRow);
    }
    const sql = ownerUserId === undefined ? 'SELECT * FROM org_evaluation_jobs ORDER BY created_at DESC, id'
      : 'SELECT * FROM org_evaluation_jobs WHERE owner_user_id IS ? ORDER BY created_at DESC, id';
    return (ownerUserId === undefined ? this.db!.prepare(sql).all() : this.db!.prepare(sql).all(ownerUserId)).map((r) => jobFromRow(r as Row));
  }

  /** Close a review-cycle budget after every child and provider call has terminated. */
  async finishReviewCycleAsync(id: string): Promise<OrgEvaluationJob> {
    if (this.postgres) {
      const client = await getPostgresPool().connect();
      try {
        await client.query('BEGIN');
        const rootRow = (await client.query('SELECT * FROM org_evaluation_jobs WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!rootRow || rootRow.budget_root_id || !String(rootRow.target_ref).startsWith('org-review-cycle:'))
          throw new Error('Evaluation is not a review cycle root');
        const root = jobFromRow(rootRow);
        if (root.status === 'qualified') { await client.query('COMMIT'); return root; }
        if (['inconclusive', 'failed'].includes(root.status)) throw new Error('Review cycle is inconclusive');
        const children = (await client.query('SELECT status FROM org_evaluation_jobs WHERE budget_root_id=$1', [id])).rows;
        if (children.some((child) => !['qualified', 'inconclusive', 'failed'].includes(child.status)))
          throw new Error('Review cycle has active children');
        const reservations = (await client.query(`SELECT r.* FROM org_evaluation_token_reservations r
          JOIN org_evaluation_jobs j ON j.id=r.job_id WHERE j.id=$1 OR j.budget_root_id=$1`, [id])).rows.map(reservationFromRow);
        const budget = budgetFromRows(root, reservations);
        if (budget.hasUnknownUsage || budget.outstandingTokens > 0 || budget.settledTokens > root.maxTokens)
          throw new Error('Review cycle has unsettled provider calls');
        const row = (await client.query(`UPDATE org_evaluation_jobs SET status='qualified', revision=revision+1,
          updated_at=$2 WHERE id=$1 RETURNING *`, [id, now()])).rows[0];
        await client.query('COMMIT'); return jobFromRow(row);
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    return this.db!.transaction(() => {
      const rootRow = this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id=?').get(id) as Row | undefined;
      if (!rootRow || rootRow.budget_root_id || !String(rootRow.target_ref).startsWith('org-review-cycle:'))
        throw new Error('Evaluation is not a review cycle root');
      const root = jobFromRow(rootRow);
      if (root.status === 'qualified') return root;
      if (['inconclusive', 'failed'].includes(root.status)) throw new Error('Review cycle is inconclusive');
      const children = this.db!.prepare('SELECT status FROM org_evaluation_jobs WHERE budget_root_id=?').all(id) as Row[];
      if (children.some((child) => !['qualified', 'inconclusive', 'failed'].includes(String(child.status))))
        throw new Error('Review cycle has active children');
      const reservations = (this.db!.prepare(`SELECT r.* FROM org_evaluation_token_reservations r
        JOIN org_evaluation_jobs j ON j.id=r.job_id WHERE j.id=? OR j.budget_root_id=?`).all(id, id) as Row[])
        .map(reservationFromRow);
      const budget = budgetFromRows(root, reservations);
      if (budget.hasUnknownUsage || budget.outstandingTokens > 0 || budget.settledTokens > root.maxTokens)
        throw new Error('Review cycle has unsettled provider calls');
      const row = this.db!.prepare(`UPDATE org_evaluation_jobs SET status='qualified', revision=revision+1,
        updated_at=? WHERE id=? RETURNING *`).get(now(), id) as Row;
      return jobFromRow(row);
    })();
  }

  async updateJobAsync(id: string, expectedRevision: number,
    patch: Partial<Pick<OrgEvaluationJob, 'status' | 'finalCandidateId' | 'qualifiedProposalId' | 'failureReason'>>,
  ): Promise<OrgEvaluationJob | null> {
    if (!integer(expectedRevision)) throw new Error('Invalid evaluation revision');
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) throw new Error('Empty evaluation update');
    const columns: Record<string, string> = {
      status: 'status', finalCandidateId: 'final_candidate_id',
      qualifiedProposalId: 'qualified_proposal_id', failureReason: 'failure_reason',
    };
    if (keys.some((key) => !columns[key])) throw new Error('Unsupported evaluation update');
    const timestamp = now();
    if (this.postgres) {
      const client = await getPostgresPool().connect();
      try {
        await client.query('BEGIN');
        const initialRow = (await client.query('SELECT * FROM org_evaluation_jobs WHERE id = $1', [id])).rows[0];
        if (!initialRow) { await client.query('COMMIT'); return null; }
        const rootId = initialRow.budget_root_id ?? id;
        const rootRow = (await client.query('SELECT * FROM org_evaluation_jobs WHERE id = $1 FOR UPDATE', [rootId])).rows[0];
        const currentRow = rootId === id ? rootRow
          : (await client.query('SELECT * FROM org_evaluation_jobs WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!currentRow || Number(currentRow.revision) !== expectedRevision) { await client.query('COMMIT'); return null; }
        if (patch.status === 'qualified' || patch.qualifiedProposalId) {
          const candidates = (await client.query('SELECT * FROM org_evaluation_candidates WHERE job_id = $1', [id])).rows.map(candidateFromRow);
          const results = (await client.query('SELECT * FROM org_evaluation_results WHERE job_id = $1', [id])).rows.map(resultFromRow);
          const reservations = (await client.query(`SELECT r.* FROM org_evaluation_token_reservations r
            JOIN org_evaluation_jobs j ON j.id = r.job_id
            WHERE j.id = $1 OR j.budget_root_id = $1`, [rootId])).rows.map(reservationFromRow);
          if (!rootRow || ['inconclusive', 'failed'].includes(rootRow.status)
            || (patch.qualifiedProposalId && rootId !== id && rootRow.status !== 'qualified'))
            throw new Error('Shared evaluation budget is not qualified');
          assertQualificationEvidence(jobFromRow(currentRow), jobFromRow(rootRow), candidates, results, reservations,
            patch.finalCandidateId ?? currentRow.final_candidate_id ?? null);
        }
        const values = keys.map((key) => patch[key]);
        const assignments = keys.map((key, i) => `${columns[key]} = $${i + 1}`).join(', ');
        const result = await client.query(`UPDATE org_evaluation_jobs SET ${assignments}, revision = revision + 1,
          updated_at = $${values.length + 1} WHERE id = $${values.length + 2} AND revision = $${values.length + 3}
          RETURNING *`, [...values, timestamp, id, expectedRevision]);
        await client.query('COMMIT');
        return result.rows[0] ? jobFromRow(result.rows[0]) : null;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    return this.db!.transaction(() => {
      const currentRow = this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id = ?').get(id) as Row | undefined;
      if (!currentRow || Number(currentRow.revision) !== expectedRevision) return null;
      if (patch.status === 'qualified' || patch.qualifiedProposalId) {
        const rootId = (currentRow.budget_root_id as string | null) ?? id;
        const rootRow = this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id = ?').get(rootId) as Row | undefined;
        const candidates = (this.db!.prepare('SELECT * FROM org_evaluation_candidates WHERE job_id = ?').all(id) as Row[]).map(candidateFromRow);
        const results = (this.db!.prepare('SELECT * FROM org_evaluation_results WHERE job_id = ?').all(id) as Row[]).map(resultFromRow);
        const reservations = (this.db!.prepare(`SELECT r.* FROM org_evaluation_token_reservations r
          JOIN org_evaluation_jobs j ON j.id = r.job_id
          WHERE j.id = ? OR j.budget_root_id = ?`).all(rootId, rootId) as Row[]).map(reservationFromRow);
        if (!rootRow || ['inconclusive', 'failed'].includes(String(rootRow.status))
          || (patch.qualifiedProposalId && rootId !== id && rootRow.status !== 'qualified'))
          throw new Error('Shared evaluation budget is not qualified');
        assertQualificationEvidence(jobFromRow(currentRow), jobFromRow(rootRow), candidates, results, reservations,
          patch.finalCandidateId ?? currentRow.final_candidate_id as string | null);
      }
      const values = keys.map((key) => patch[key]);
      const assignments = keys.map((key) => `${columns[key]} = ?`).join(', ');
      const row = this.db!.prepare(`UPDATE org_evaluation_jobs SET ${assignments}, revision = revision + 1,
        updated_at = ? WHERE id = ? AND revision = ? RETURNING *`).get(...values, timestamp, id, expectedRevision) as Row | undefined;
      return row ? jobFromRow(row) : null;
    })();
  }

  async addCandidateAsync(input: AddOrgEvaluationCandidateInput): Promise<OrgEvaluationCandidate> {
    if (!ORG_EVALUATION_PROPOSAL_KINDS.includes(input.kind) || !integer(input.ordinal)
      || digest(input.effectiveConfigJson) !== input.configHash) throw new Error('Invalid immutable candidate');
    parseJson(input.effectiveConfigJson); parseJson(input.changeJson);
    if (input.role === 'original' && input.parentCandidateIds.length) throw new Error('Original cannot have parents');
    if (input.role === 'composition' && input.parentCandidateIds.length === 0) throw new Error('Composition requires parents');
    const job = await this.getJobAsync(input.jobId);
    if (!job || job.targetRef !== input.targetRef || job.status === 'qualified') throw new Error('Candidate target mismatch');
    const existing = await this.listCandidatesAsync(input.jobId);
    const frozenInput = parseJson(job.inputJson) as Record<string, unknown>;
    const singleton = frozenInput.candidateStrategy === 'singleton-action';
    if (singleton) {
      const problem = frozenInput.problem as Record<string, unknown> | undefined;
      const action = deriveSingletonPublicationAction({ kind: input.kind, targetRef: job.targetRef,
        snapshot: frozenInput.snapshot as Record<string, unknown>, change: problem?.change });
      if (!action || input.role === 'composition' || input.kind !== 'publish-skill-to-org'
        || input.role !== 'original' && input.changeJson !== evaluationCanonicalJson(action)
        || input.role === 'variant' && existing.some((candidate) => candidate.role === 'variant'))
        throw new Error('Singleton publication candidate differs from its frozen action');
    }
    if (input.parentCandidateIds.some((id) => !existing.some((c) => c.id === id)))
      throw new Error('Candidate parent missing from evaluation');
    const parts = input.compositionParts ?? [];
    if (input.role === 'composition' || input.role === 'final' && !singleton) {
      if (!parts.length || parts.some((part) => !part.sourceCandidateId || !part.changePath || !part.reason
        || !part.evidenceResultIds.length || !part.evidenceResultIds.every((id) => typeof id === 'string')))
        throw new Error('Composition portions need evidence');
      const evidence = await this.listResultsAsync(input.jobId);
      if (parts.some((part) => !existing.some((candidate) => candidate.id === part.sourceCandidateId && candidate.role === 'variant')
        || part.evidenceResultIds.some((id) => !evidence.some((result) => result.id === id
          && result.candidateId === part.sourceCandidateId && result.phase === 'probe'))))
        throw new Error('Composition portions reference missing probe evidence');
      const original = existing.find((candidate) => candidate.role === 'original');
      if (parts.some((part) => part.retained && !part.evidenceResultIds.some((id) => {
        const observed = evidence.find((result) => result.id === id);
        const baseline = evidence.find((result) => result.candidateId === original?.id
          && result.phase === 'probe' && result.taskKey === observed?.taskKey);
        return observed?.status === 'pass' && observed.score !== null && baseline?.status === 'pass'
          && baseline.score !== null && observed.score > baseline.score;
      }))) throw new Error('Retained composition portion has no improved probe evidence');
      if (parts.some((part) => {
        const source = existing.find((candidate) => candidate.id === part.sourceCandidateId)!;
        return !portionMatches(source.changeJson, input.changeJson, part);
      })) throw new Error('Composition portion does not match source change bytes');
    } else if (parts.length) throw new Error('Uncomposed candidate cannot claim portions');
    if (input.role === 'final') {
      const parent = existing.find((candidate) => candidate.id === input.parentCandidateIds[0]
        && candidate.role === (singleton ? 'variant' : 'composition'));
      if (!parent || input.parentCandidateIds.length !== 1 || input.changeJson !== parent.changeJson
        || input.effectiveConfigJson !== parent.effectiveConfigJson || input.configHash !== parent.configHash
        || JSON.stringify(parts) !== JSON.stringify(parent.compositionParts ?? []))
        throw new Error('Final candidate differs from tested parent');
    }
    const timestamp = now();
    const values = [input.id, input.jobId, input.role, input.ordinal, input.kind, input.targetRef,
      input.configHash, input.effectiveConfigJson, input.changeJson, JSON.stringify(input.parentCandidateIds),
      JSON.stringify(parts), timestamp];
    if (this.postgres) await getPostgresPool().query(`INSERT INTO org_evaluation_candidates
      (id, job_id, role, ordinal, kind, target_ref, config_hash, effective_config_json,
       change_json, parent_candidate_ids_json, composition_parts_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, values);
    else this.db!.prepare(`INSERT INTO org_evaluation_candidates
      (id, job_id, role, ordinal, kind, target_ref, config_hash, effective_config_json,
       change_json, parent_candidate_ids_json, composition_parts_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values);
    return (await this.listCandidatesAsync(input.jobId)).find((c) => c.id === input.id)!;
  }

  async listCandidatesAsync(jobId: string): Promise<OrgEvaluationCandidate[]> {
    return (await this.rows('org_evaluation_candidates', jobId)).map(candidateFromRow);
  }

  async addResultAsync(input: AddOrgEvaluationResultInput): Promise<OrgEvaluationResult> {
    const candidate = (await this.listCandidatesAsync(input.jobId)).find((c) => c.id === input.candidateId);
    if (!candidate || (input.phase === 'validation' && !['original', 'final'].includes(candidate.role))
      || digest(input.receiptJson) !== input.receiptHash || !input.taskKey) throw new Error('Invalid evaluation receipt binding');
    const receipt = parseJson(input.receiptJson) as Record<string, unknown>;
    if (!receipt.sessionId || !receipt.engineVersion || !receipt.taskFixtureHash
      || receipt.effectiveConfigHash !== candidate.configHash || !Array.isArray(receipt.toolEvents))
      throw new Error('Evaluation receipt lacks actual execution proof');
    if (input.status === 'pass' && (!Number.isFinite(input.score) || input.score! < 0 || input.score! > 1))
      throw new Error('Passing receipt requires bounded score');
    if (input.status === 'pass' && !input.tokenUsage) throw new Error('Passing receipt requires measured token usage');
    if (input.status === 'pass') {
      const proof = (receipt as unknown as OrgEvaluationExecutionReceipt).effectProof;
      if (!proof || proof.manifestHash !== candidate.configHash || proof.negativeGuardsPassed !== true
        || !proof.workerId || !proof.workerRootHash || !proof.engineBootId
        || !Array.isArray(proof.events) || proof.events.length === 0
        || proof.events.some((event) => !event.kind || !event.source || !event.subject || !event.evidenceHash))
        throw new Error('Passing receipt lacks isolated effect proof');
      const effectKinds = proof.events.map((event) => event.kind);
      const required = candidate.role === 'original' ? ['agent-output'] : null;
      const missing = required ? required.filter((kind) => !effectKinds.includes(kind))
        : verifyObservedEffects(candidate.kind, effectKinds, candidate.changeJson).missing;
      if (missing.length) throw new Error('Passing receipt lacks required effect evidence');
    }
    if (input.tokenUsage && !validUsage(input.tokenUsage)) throw new Error('Invalid evaluation token usage');
    const timestamp = now();
    const values = [input.id, input.jobId, input.candidateId, input.phase, input.taskKey, input.receiptHash,
      input.receiptJson, input.status, input.score, input.tokenUsage ? JSON.stringify(input.tokenUsage) : null,
      input.failureReason, timestamp];
    if (this.postgres) await getPostgresPool().query(`INSERT INTO org_evaluation_results
      (id, job_id, candidate_id, phase, task_key, receipt_hash, receipt_json, status, score,
       token_usage_json, failure_reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, values);
    else this.db!.prepare(`INSERT INTO org_evaluation_results
      (id, job_id, candidate_id, phase, task_key, receipt_hash, receipt_json, status, score,
       token_usage_json, failure_reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values);
    return (await this.listResultsAsync(input.jobId)).find((r) => r.id === input.id)!;
  }

  async listResultsAsync(jobId: string): Promise<OrgEvaluationResult[]> {
    return (await this.rows('org_evaluation_results', jobId)).map(resultFromRow);
  }

  async reserveTokensAsync(input: { jobId: string; reservationKey: string; stage: OrgEvaluationStage; maxTokens: number }):
    Promise<OrgEvaluationTokenReservation | null> {
    return (await this.admitProviderCallAsync(input)).reservation;
  }

  /** Atomic admission receipt; only created=true grants permission to contact a provider. */
  async admitProviderCallAsync(input: { jobId: string; reservationKey: string; stage: OrgEvaluationStage; maxTokens: number }):
    Promise<{ reservation: OrgEvaluationTokenReservation | null; created: boolean }> {
    if (!input.reservationKey || !integer(input.maxTokens) || input.maxTokens === 0) throw new Error('Invalid reservation');
    if (this.postgres) {
      const client = await getPostgresPool().connect();
      try {
        await client.query('BEGIN');
        const jobRow = (await client.query('SELECT * FROM org_evaluation_jobs WHERE id = $1', [input.jobId])).rows[0];
        if (!jobRow) throw new Error('Evaluation job missing');
        const rootId = jobRow.budget_root_id ?? input.jobId;
        const rootRow = (await client.query('SELECT * FROM org_evaluation_jobs WHERE id = $1 FOR UPDATE', [rootId])).rows[0];
        if (!rootRow || rootRow.budget_root_id || rootRow.owner_user_id !== jobRow.owner_user_id)
          throw new Error('Invalid evaluation budget root');
        const old = (await client.query('SELECT * FROM org_evaluation_token_reservations WHERE job_id = $1 AND reservation_key = $2',
          [input.jobId, input.reservationKey])).rows[0];
        if (old) {
          if (old.stage !== input.stage || Number(old.max_tokens) !== input.maxTokens) throw new Error('Reservation key reused with different terms');
          await client.query('COMMIT'); return { reservation: reservationFromRow(old), created: false };
        }
        const rows = (await client.query(`SELECT r.* FROM org_evaluation_token_reservations r
          JOIN org_evaluation_jobs j ON j.id = r.job_id
          WHERE j.id = $1 OR j.budget_root_id = $1`, [rootId])).rows;
        const job = jobFromRow(jobRow); const root = jobFromRow(rootRow);
        const budget = budgetFromRows(root, rows.map(reservationFromRow));
        const available = input.stage === 'final-validation' ? budget.totalAvailableTokens : budget.explorationAvailableTokens;
        if (['inconclusive', 'failed', 'qualified'].includes(job.status)
          || ['inconclusive', 'failed', 'qualified'].includes(root.status)
          || budget.hasUnknownUsage || input.maxTokens > available) { await client.query('COMMIT'); return { reservation: null, created: false }; }
        const timestamp = now();
        const result = await client.query(`INSERT INTO org_evaluation_token_reservations
          (job_id,reservation_key,stage,max_tokens,status,actual_tokens,created_at,settled_at)
          VALUES ($1,$2,$3,$4,'reserved',NULL,$5,NULL) RETURNING *`,
        [input.jobId, input.reservationKey, input.stage, input.maxTokens, timestamp]);
        await client.query('COMMIT'); return { reservation: reservationFromRow(result.rows[0]), created: true };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    return this.db!.transaction(() => {
      const jobRow = this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id = ?').get(input.jobId) as Row | undefined;
      if (!jobRow) throw new Error('Evaluation job missing');
      const rootId = (jobRow.budget_root_id as string | null) ?? input.jobId;
      const rootRow = this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id = ?').get(rootId) as Row | undefined;
      if (!rootRow || rootRow.budget_root_id || rootRow.owner_user_id !== jobRow.owner_user_id)
        throw new Error('Invalid evaluation budget root');
      const old = this.db!.prepare('SELECT * FROM org_evaluation_token_reservations WHERE job_id = ? AND reservation_key = ?')
        .get(input.jobId, input.reservationKey) as Row | undefined;
      if (old) {
        if (old.stage !== input.stage || Number(old.max_tokens) !== input.maxTokens) throw new Error('Reservation key reused with different terms');
        return { reservation: reservationFromRow(old), created: false };
      }
      const rows = this.db!.prepare(`SELECT r.* FROM org_evaluation_token_reservations r
        JOIN org_evaluation_jobs j ON j.id = r.job_id
        WHERE j.id = ? OR j.budget_root_id = ?`).all(rootId, rootId) as Row[];
      const job = jobFromRow(jobRow); const root = jobFromRow(rootRow);
      const budget = budgetFromRows(root, rows.map(reservationFromRow));
      const available = input.stage === 'final-validation' ? budget.totalAvailableTokens : budget.explorationAvailableTokens;
      if (['inconclusive', 'failed', 'qualified'].includes(job.status)
        || ['inconclusive', 'failed', 'qualified'].includes(root.status)
        || budget.hasUnknownUsage || input.maxTokens > available) return { reservation: null, created: false };
      const timestamp = now();
      this.db!.prepare(`INSERT INTO org_evaluation_token_reservations
        (job_id,reservation_key,stage,max_tokens,status,actual_tokens,created_at,settled_at)
        VALUES (?,?,?,?,'reserved',NULL,?,NULL)`).run(input.jobId, input.reservationKey, input.stage, input.maxTokens, timestamp);
      return { reservation: reservationFromRow(this.db!.prepare('SELECT * FROM org_evaluation_token_reservations WHERE job_id = ? AND reservation_key = ?')
        .get(input.jobId, input.reservationKey) as Row), created: true };
    })();
  }

  async settleTokensAsync(input: { jobId: string; reservationKey: string; usage: OrgEvaluationTokenUsage | null }):
    Promise<OrgEvaluationTokenReservation> {
    if (input.usage && !validUsage(input.usage)) throw new Error('Invalid provider usage');
    if (this.postgres) {
      const client = await getPostgresPool().connect();
      try {
        await client.query('BEGIN');
        const jobRow = (await client.query('SELECT * FROM org_evaluation_jobs WHERE id = $1', [input.jobId])).rows[0];
        if (!jobRow) throw new Error('Evaluation job missing');
        const rootId = jobRow.budget_root_id ?? input.jobId;
        const rootRow = (await client.query('SELECT * FROM org_evaluation_jobs WHERE id = $1 FOR UPDATE', [rootId])).rows[0];
        if (!rootRow || rootRow.budget_root_id || rootRow.owner_user_id !== jobRow.owner_user_id)
          throw new Error('Invalid evaluation budget root');
        const old = (await client.query('SELECT * FROM org_evaluation_token_reservations WHERE job_id = $1 AND reservation_key = $2',
          [input.jobId, input.reservationKey])).rows[0];
        if (!old) throw new Error('Reservation missing');
        if (old.status !== 'reserved') {
          if (old.status !== (input.usage ? 'settled' : 'unknown') || (input.usage && Number(old.actual_tokens) !== input.usage.totalTokens))
            throw new Error('Settlement key reused with different usage');
          await client.query('COMMIT'); return reservationFromRow(old);
        }
        const status = input.usage ? 'settled' : 'unknown'; const actual = input.usage?.totalTokens ?? null;
        const result = await client.query(`UPDATE org_evaluation_token_reservations
          SET status=$1, actual_tokens=$2, settled_at=$3 WHERE job_id=$4 AND reservation_key=$5 RETURNING *`,
        [status, actual, now(), input.jobId, input.reservationKey]);
        if (!input.usage || actual! > Number(old.max_tokens)) await client.query(`UPDATE org_evaluation_jobs
          SET status='inconclusive', failure_reason=$1, revision=revision+1, updated_at=$2
          WHERE id=$3 OR id=$4`,
        [input.usage ? 'Provider token usage exceeded reservation' : 'Provider token usage unavailable', now(), input.jobId, rootId]);
        await client.query('COMMIT'); return reservationFromRow(result.rows[0]);
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    return this.db!.transaction(() => {
      const jobRow = this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id = ?').get(input.jobId) as Row | undefined;
      if (!jobRow) throw new Error('Evaluation job missing');
      const rootId = (jobRow.budget_root_id as string | null) ?? input.jobId;
      const rootRow = this.db!.prepare('SELECT * FROM org_evaluation_jobs WHERE id = ?').get(rootId) as Row | undefined;
      if (!rootRow || rootRow.budget_root_id || rootRow.owner_user_id !== jobRow.owner_user_id)
        throw new Error('Invalid evaluation budget root');
      const old = this.db!.prepare('SELECT * FROM org_evaluation_token_reservations WHERE job_id = ? AND reservation_key = ?')
        .get(input.jobId, input.reservationKey) as Row | undefined;
      if (!old) throw new Error('Reservation missing');
      if (old.status !== 'reserved') {
        if (old.status !== (input.usage ? 'settled' : 'unknown') || (input.usage && Number(old.actual_tokens) !== input.usage.totalTokens))
          throw new Error('Settlement key reused with different usage');
        return reservationFromRow(old);
      }
      const status = input.usage ? 'settled' : 'unknown'; const actual = input.usage?.totalTokens ?? null;
      const timestamp = now();
      this.db!.prepare(`UPDATE org_evaluation_token_reservations SET status=?, actual_tokens=?, settled_at=?
        WHERE job_id=? AND reservation_key=?`).run(status, actual, timestamp, input.jobId, input.reservationKey);
      if (!input.usage || actual! > Number(old.max_tokens)) this.db!.prepare(`UPDATE org_evaluation_jobs
        SET status='inconclusive', failure_reason=?, revision=revision+1, updated_at=? WHERE id=? OR id=?`)
        .run(input.usage ? 'Provider token usage exceeded reservation' : 'Provider token usage unavailable', timestamp, input.jobId, rootId);
      return reservationFromRow(this.db!.prepare('SELECT * FROM org_evaluation_token_reservations WHERE job_id = ? AND reservation_key = ?')
        .get(input.jobId, input.reservationKey) as Row);
    })();
  }

  async getBudgetAsync(jobId: string): Promise<OrgEvaluationBudget> {
    const job = await this.getJobAsync(jobId);
    if (!job) throw new Error('Evaluation job missing');
    const root = job.budgetRootId ? await this.getJobAsync(job.budgetRootId) : job;
    if (!root) throw new Error('Evaluation budget root missing');
    return budgetFromRows(root, await this.budgetReservations(root.id));
  }
}

function validUsage(usage: OrgEvaluationTokenUsage): boolean {
  if (!integer(usage.totalTokens) || usage.totalTokens === 0 ||
    ![usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.reasoningTokens]
      .every((part) => part === null || integer(part))) return false;
  // Cache reads are part of input and reasoning is part of output for many
  // providers. They are metadata, never added to the billable total again.
  if (usage.inputTokens !== null && usage.outputTokens !== null &&
    usage.inputTokens + usage.outputTokens > usage.totalTokens) return false;
  if (usage.cacheReadTokens !== null && usage.inputTokens !== null && usage.cacheReadTokens > usage.inputTokens) return false;
  if (usage.reasoningTokens !== null && usage.outputTokens !== null && usage.reasoningTokens > usage.outputTokens) return false;
  return true;
}
