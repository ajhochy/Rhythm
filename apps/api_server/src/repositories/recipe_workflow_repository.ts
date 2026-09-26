import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db';
import type { RecipeWorkflowDefinitionV1, RunInput, VerdictOutcomeV1 } from '../contracts/recipe_workflow_contract';

/**
 * #1485 S3a-1 — durable persistence for recipe-workflow runs. SQLite-only:
 * execution is local-agent-server only (see recipe_workflow_runner.ts's
 * start() gate), so there is no Postgres read/write path here even though
 * the tables exist on both engines for schema parity (postgres_bootstrap.ts).
 *
 * item_key/item_id use the '' (empty string) sentinel for "root scope", never
 * NULL — see the migrations.ts comment on recipe_workflow_stage_executions
 * for why (SQLite/SQL NULL is never equal to NULL, which would silently
 * break the UNIQUE/idempotent-claim invariant this repository relies on).
 * This module is the ONLY place that sentinel leaks into JS null/undefined.
 */

export type RunStatus =
  | 'pending' | 'running' | 'blocked_approval' | 'blocked_reconciliation'
  | 'succeeded' | 'failed' | 'budget_exhausted' | 'workflow_disabled' | 'cancelled';

export type StageExecutionStatus =
  | 'pending' | 'running' | 'blocked_approval' | 'blocked_reconciliation'
  | 'succeeded' | 'failed' | 'cancelled';

export interface RunRow {
  id: string;
  recipeId: string;
  ownerUserId: number | null;
  definition: RecipeWorkflowDefinitionV1;
  input: RunInput;
  status: RunStatus;
  pendingApprovalId: string | null;
  usageCostUsd: number;
  usageTokens: number;
  stageExecutionCount: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface StageExecutionRow {
  id: string;
  runId: string;
  stageId: string;
  itemKey: string | null;
  itemId: string | null;
  status: StageExecutionStatus;
  attemptId: string | null;
  attemptCount: number;
  profileId: string | null;
  configuredProviderId: string | null;
  configuredModelId: string | null;
  observedProviderId: string | null;
  observedModelId: string | null;
  outcome: VerdictOutcomeV1 | null;
  outputFields: Record<string, unknown> | null;
  itemData: Record<string, unknown> | null;
  costUsd: number;
  tokens: number;
  /** #1485 S3a-2 — see RecipeWorkflowRunner's two-phase session binding. */
  provisionalSessionId: string | null;
  committedSessionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoopUsageRow {
  runId: string;
  loopId: string;
  itemKey: string | null;
  itemId: string | null;
  iterations: number;
  costUsd: number;
  tokens: number;
  startedAt: string;
}

const norm = (v: string | null | undefined): string => v ?? '';
const denorm = (v: string): string | null => (v === '' ? null : v);

function runFromRow(row: Record<string, unknown>): RunRow {
  return {
    id: row.id as string,
    recipeId: row.recipe_id as string,
    ownerUserId: (row.owner_user_id as number | null) ?? null,
    definition: JSON.parse(row.definition_json as string),
    input: JSON.parse((row.input_json as string) ?? '{}'),
    status: row.status as RunStatus,
    pendingApprovalId: (row.pending_approval_id as string | null) ?? null,
    usageCostUsd: (row.usage_cost_usd as number) ?? 0,
    usageTokens: (row.usage_tokens as number) ?? 0,
    stageExecutionCount: (row.stage_execution_count as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
  };
}

function stageFromRow(row: Record<string, unknown>): StageExecutionRow {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    stageId: row.stage_id as string,
    itemKey: denorm(row.item_key as string),
    itemId: denorm(row.item_id as string),
    status: row.status as StageExecutionStatus,
    attemptId: (row.attempt_id as string | null) ?? null,
    attemptCount: (row.attempt_count as number) ?? 0,
    profileId: (row.profile_id as string | null) ?? null,
    configuredProviderId: (row.configured_provider_id as string | null) ?? null,
    configuredModelId: (row.configured_model_id as string | null) ?? null,
    observedProviderId: (row.observed_provider_id as string | null) ?? null,
    observedModelId: (row.observed_model_id as string | null) ?? null,
    outcome: (row.outcome as VerdictOutcomeV1 | null) ?? null,
    outputFields: row.output_json ? JSON.parse(row.output_json as string) : null,
    itemData: row.item_data_json ? JSON.parse(row.item_data_json as string) : null,
    costUsd: (row.cost_usd as number) ?? 0,
    tokens: (row.tokens as number) ?? 0,
    provisionalSessionId: (row.provisional_session_id as string | null) ?? null,
    committedSessionId: (row.committed_session_id as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function loopUsageFromRow(row: Record<string, unknown>): LoopUsageRow {
  return {
    runId: row.run_id as string,
    loopId: row.loop_id as string,
    itemKey: denorm(row.item_key as string),
    itemId: denorm(row.item_id as string),
    iterations: (row.iterations as number) ?? 0,
    costUsd: (row.cost_usd as number) ?? 0,
    tokens: (row.tokens as number) ?? 0,
    startedAt: row.started_at as string,
  };
}

export class RecipeWorkflowRepository {
  /**
   * Generic atomic wrapper for a multi-statement write sequence, matching
   * the pattern createRun()/cancelRun()/disableRun() already use below.
   * Every method this repository exposes issues its own single statement
   * against the SAME `getDb()` singleton, so composing several of them
   * inside one `transaction()` callback commits them together — a caller
   * (the runner) uses this to make its own recordCompletion -> advanceTo /
   * recordRunUsage sequences atomic without this repository needing a
   * bespoke composite method per call site.
   */
  transaction<T>(fn: () => T): T {
    return getDb().transaction(fn)();
  }

  /** Persists the run row AND its entry stage_execution row atomically. */
  createRun(input: {
    recipeId: string;
    ownerUserId: number | null;
    definition: RecipeWorkflowDefinitionV1;
    input: RunInput;
  }): RunRow {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const definitionJson = JSON.stringify(input.definition);
    const inputJson = JSON.stringify(input.input);

    db.transaction(() => {
      db.prepare(
        `INSERT INTO recipe_workflow_runs
           (id, recipe_id, owner_user_id, definition_json, input_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(id, input.recipeId, input.ownerUserId, definitionJson, inputJson, now, now);

      db.prepare(
        `INSERT INTO recipe_workflow_stage_executions
           (id, run_id, stage_id, item_key, item_id, status, created_at, updated_at)
         VALUES (?, ?, ?, '', '', 'pending', ?, ?)`,
      ).run(randomUUID(), id, input.definition.entryStageId, now, now);
    })();

    return this.getRun(id)!;
  }

  getRun(runId: string): RunRow | null {
    const row = getDb().prepare(`SELECT * FROM recipe_workflow_runs WHERE id = ?`).get(runId);
    return row ? runFromRow(row as Record<string, unknown>) : null;
  }

  getRunForOwner(runId: string, ownerUserId: number): RunRow | null {
    const row = getDb()
      .prepare(`SELECT * FROM recipe_workflow_runs WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)`)
      .get(runId, ownerUserId);
    return row ? runFromRow(row as Record<string, unknown>) : null;
  }

  listStageExecutions(runId: string): StageExecutionRow[] {
    const rows = getDb()
      .prepare(`SELECT * FROM recipe_workflow_stage_executions WHERE run_id = ? ORDER BY created_at, id`)
      .all(runId);
    return (rows as Record<string, unknown>[]).map(stageFromRow);
  }

  /**
   * Idempotent creation of a new logical stage occurrence. A duplicated tick
   * calling this twice for the same (runId, stageId, itemKey, itemId) is a
   * no-op the second time (INSERT OR IGNORE), so callers can always call this
   * before checking "is this occurrence already known" without a race.
   */
  ensureStageExecution(input: {
    runId: string;
    stageId: string;
    itemKey?: string | null;
    itemId?: string | null;
    itemData?: Record<string, unknown> | null;
  }): StageExecutionRow {
    const db = getDb();
    const now = new Date().toISOString();
    const itemKey = norm(input.itemKey);
    const itemId = norm(input.itemId);
    db.prepare(
      `INSERT OR IGNORE INTO recipe_workflow_stage_executions
         (id, run_id, stage_id, item_key, item_id, status, item_data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(
      randomUUID(), input.runId, input.stageId, itemKey, itemId,
      input.itemData ? JSON.stringify(input.itemData) : null, now, now,
    );
    return stageFromRow(
      db
        .prepare(
          `SELECT * FROM recipe_workflow_stage_executions WHERE run_id = ? AND stage_id = ? AND item_key = ? AND item_id = ?`,
        )
        .get(input.runId, input.stageId, itemKey, itemId) as Record<string, unknown>,
    );
  }

  /**
   * Atomically claims a stage_execution for dispatch: only succeeds (returns
   * true) when the row is currently in `fromStatus`. This is the sole
   * idempotency guard against a duplicated tick claiming/dispatching the same
   * occurrence twice — better-sqlite3 is synchronous, so this UPDATE...WHERE
   * is a single atomic statement with no interleaving possible.
   */
  claim(id: string, fromStatus: StageExecutionStatus, toStatus: StageExecutionStatus): boolean {
    const db = getDb();
    const now = new Date().toISOString();
    const isStarting = toStatus === 'running';
    const result = db
      .prepare(
        `UPDATE recipe_workflow_stage_executions
           SET status = ?, updated_at = ?
             ${isStarting ? ", attempt_id = ?, attempt_count = attempt_count + 1, started_at = COALESCE(started_at, ?)" : ''}
         WHERE id = ? AND status = ?`,
      )
      .run(
        ...(isStarting ? [toStatus, now, randomUUID(), now, id, fromStatus] : [toStatus, now, id, fromStatus]),
      );
    return result.changes > 0;
  }

  /**
   * The one transition-target primitive: create the target occurrence if it
   * doesn't exist yet; if it does and is already terminal (a repair loop
   * re-entering the same logical stage), reset it to 'pending' for a fresh
   * attempt; if it's already pending/running, leave it alone (idempotent
   * no-op under a duplicated tick).
   */
  advanceTo(input: {
    runId: string;
    stageId: string;
    itemKey?: string | null;
    itemId?: string | null;
    itemData?: Record<string, unknown> | null;
  }): StageExecutionRow {
    const existing = getDb()
      .prepare(
        `SELECT * FROM recipe_workflow_stage_executions WHERE run_id = ? AND stage_id = ? AND item_key = ? AND item_id = ?`,
      )
      .get(input.runId, input.stageId, norm(input.itemKey), norm(input.itemId));
    if (!existing) return this.ensureStageExecution(input);
    const row = stageFromRow(existing as Record<string, unknown>);
    if (row.status === 'succeeded' || row.status === 'failed') this.resetForRetry(row.id);
    return row;
  }

  /** Reverts a claim that turned out not to be a real attempt (capacity/profile failure — consumes no budget). */
  unclaim(id: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE recipe_workflow_stage_executions
         SET status = 'pending', attempt_count = MAX(attempt_count - 1, 0), attempt_id = NULL, started_at = NULL,
             provisional_session_id = NULL, committed_session_id = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), id);
  }

  /**
   * #1485 S3a-2 — atomically records the FIRST onSessionCreated call's
   * session id for the current attempt. Returns false when one is already
   * set (a second onSessionCreated call for the same attempt) — the caller
   * must fail the dispatch closed.
   */
  bindProvisionalSession(id: string, sessionId: string): boolean {
    const result = getDb()
      .prepare(
        `UPDATE recipe_workflow_stage_executions
           SET provisional_session_id = ?, updated_at = ?
         WHERE id = ? AND provisional_session_id IS NULL`,
      )
      .run(sessionId, new Date().toISOString(), id);
    return result.changes > 0;
  }

  /** Commits the provisional session as final — only once AgentRunResult.sessionId is confirmed to match it. */
  commitSession(id: string, sessionId: string): void {
    getDb()
      .prepare(`UPDATE recipe_workflow_stage_executions SET committed_session_id = ?, updated_at = ? WHERE id = ?`)
      .run(sessionId, new Date().toISOString(), id);
  }

  recordCompletion(id: string, patch: {
    status: StageExecutionStatus;
    outcome?: VerdictOutcomeV1 | null;
    outputFields?: Record<string, unknown> | null;
    profileId?: string | null;
    configuredProviderId?: string | null;
    configuredModelId?: string | null;
    observedProviderId?: string | null;
    observedModelId?: string | null;
    costUsd?: number;
    tokens?: number;
  }): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE recipe_workflow_stage_executions
           SET status = ?, outcome = ?, output_json = ?, profile_id = COALESCE(?, profile_id),
               configured_provider_id = COALESCE(?, configured_provider_id),
               configured_model_id = COALESCE(?, configured_model_id),
               observed_provider_id = COALESCE(?, observed_provider_id),
               observed_model_id = COALESCE(?, observed_model_id),
               cost_usd = cost_usd + ?, tokens = tokens + ?,
               completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status,
        patch.outcome ?? null,
        patch.outputFields !== undefined ? JSON.stringify(patch.outputFields) : null,
        patch.profileId ?? null,
        patch.configuredProviderId ?? null,
        patch.configuredModelId ?? null,
        patch.observedProviderId ?? null,
        patch.observedModelId ?? null,
        patch.costUsd ?? 0,
        patch.tokens ?? 0,
        now,
        now,
        id,
      );
  }

  /** Resets an existing occurrence back to 'pending' for a repair-loop re-attempt (keeps attempt_count history). */
  resetForRetry(id: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE recipe_workflow_stage_executions
           SET status = 'pending', outcome = NULL, output_json = NULL, started_at = NULL, completed_at = NULL,
               provisional_session_id = NULL, committed_session_id = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, id);
  }

  /** #1485 S3a-2 — every stage_execution currently bound to a session (used for cancel/flag-off session aborts). */
  listBoundSessionIds(runId: string): string[] {
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT provisional_session_id AS sid FROM recipe_workflow_stage_executions
         WHERE run_id = ? AND status IN ('running', 'blocked_approval') AND provisional_session_id IS NOT NULL`,
      )
      .all(runId) as { sid: string }[];
    return rows.map((r) => r.sid);
  }

  /** #1485 S3a-2 restart reconciliation — every 'running' occurrence, across all non-terminal runs when runId is omitted. */
  listRunningStageExecutions(runId?: string): StageExecutionRow[] {
    const rows = runId
      ? getDb().prepare(`SELECT * FROM recipe_workflow_stage_executions WHERE run_id = ? AND status = 'running'`).all(runId)
      : getDb().prepare(`SELECT * FROM recipe_workflow_stage_executions WHERE status = 'running'`).all();
    return (rows as Record<string, unknown>[]).map(stageFromRow);
  }

  /**
   * An in-flight ('running') occurrence caught mid-flight by a restart is
   * AMBIGUOUS — we cannot tell whether the underlying side effect committed —
   * so it becomes 'blocked_reconciliation' rather than being silently
   * re-dispatched or left stuck forever. Only an explicit human-unblock
   * action can move it past this state (no automatic recovery exists here).
   */
  markBlockedReconciliation(stageExecutionId: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(`UPDATE recipe_workflow_stage_executions SET status = 'blocked_reconciliation', updated_at = ? WHERE id = ?`)
      .run(now, stageExecutionId);
  }

  /** Every run not already in a terminal status (used by the flag-off sweep and restart reconciliation). */
  listNonTerminalRunIds(): string[] {
    const rows = getDb()
      .prepare(
        `SELECT id FROM recipe_workflow_runs
         WHERE status NOT IN ('succeeded', 'failed', 'budget_exhausted', 'workflow_disabled', 'cancelled')`,
      )
      .all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  /**
   * A non-terminal run with no 'running' or 'pending' stage_execution left is
   * STALLED — every occurrence already reached a terminal per-stage status,
   * yet nothing ever finalized (or advanced) the run itself. This is the
   * narrow crash window between recordCompletion committing a stage and the
   * same transaction's advanceTo/updateRunStatus running (now closed by
   * wrapping both in one db.transaction() — see recipe_workflow_runner.ts —
   * but reconcileAfterRestart() still needs to detect and surface any run
   * that stalled before that fix, or reached this state some other way).
   */
  listStalledRunIds(): string[] {
    const rows = getDb()
      .prepare(
        `SELECT id FROM recipe_workflow_runs
         WHERE status NOT IN ('succeeded', 'failed', 'budget_exhausted', 'workflow_disabled', 'cancelled')
           AND id NOT IN (
             SELECT DISTINCT run_id FROM recipe_workflow_stage_executions WHERE status IN ('running', 'pending')
           )`,
      )
      .all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  updateRunStatus(runId: string, status: RunStatus, patch: { pendingApprovalId?: string | null } = {}): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE recipe_workflow_runs
           SET status = ?, pending_approval_id = COALESCE(?, pending_approval_id),
               cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END,
               updated_at = ?
         WHERE id = ?`,
      )
      .run(status, patch.pendingApprovalId ?? null, status, now, now, runId);
  }

  recordRunUsage(runId: string, usage: { costUsd: number; tokens: number }): void {
    getDb()
      .prepare(
        `UPDATE recipe_workflow_runs
           SET usage_cost_usd = usage_cost_usd + ?, usage_tokens = usage_tokens + ?,
               stage_execution_count = stage_execution_count + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(usage.costUsd, usage.tokens, new Date().toISOString(), runId);
  }

  getLoopUsage(runId: string, loopId: string, itemKey: string | null, itemId: string | null): LoopUsageRow | null {
    const row = getDb()
      .prepare(`SELECT * FROM recipe_workflow_loop_usage WHERE run_id = ? AND loop_id = ? AND item_key = ? AND item_id = ?`)
      .get(runId, loopId, norm(itemKey), norm(itemId));
    return row ? loopUsageFromRow(row as Record<string, unknown>) : null;
  }

  /** Insert-or-increment: the first call for a given loop instance seeds `started_at` (for the wall-time cap). */
  recordLoopIteration(
    runId: string, loopId: string, itemKey: string | null, itemId: string | null,
    usage: { costUsd: number; tokens: number },
  ): LoopUsageRow {
    const db = getDb();
    const now = new Date().toISOString();
    const nKey = norm(itemKey);
    const nId = norm(itemId);
    db.prepare(
      `INSERT INTO recipe_workflow_loop_usage (run_id, loop_id, item_key, item_id, iterations, cost_usd, tokens, started_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(run_id, loop_id, item_key, item_id) DO UPDATE SET
         iterations = iterations + 1, cost_usd = cost_usd + excluded.cost_usd, tokens = tokens + excluded.tokens`,
    ).run(runId, loopId, nKey, nId, usage.costUsd, usage.tokens, now);
    return this.getLoopUsage(runId, loopId, itemKey, itemId)!;
  }

  /** #1485 S3a-2 — flag-off mid-run: fences the run/stages as workflow_disabled, distinct from a user cancellation. */
  disableRun(runId: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`UPDATE recipe_workflow_runs SET status = 'workflow_disabled', updated_at = ? WHERE id = ?`).run(now, runId);
      db.prepare(
        `UPDATE recipe_workflow_stage_executions
           SET status = 'cancelled', updated_at = ?
         WHERE run_id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).run(now, runId);
    })();
  }

  /** Cancels the run and every non-terminal stage_execution. */
  cancelRun(runId: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `UPDATE recipe_workflow_runs SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, runId);
      db.prepare(
        `UPDATE recipe_workflow_stage_executions
           SET status = 'cancelled', updated_at = ?
         WHERE run_id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')`,
      ).run(now, runId);
    })();
  }
}
