import { env } from '../config/env';
import { getDb } from '../database/db';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  RecipeWorkflowRepository,
  type RunRow,
  type RunStatus,
  type StageExecutionRow,
} from '../repositories/recipe_workflow_repository';
import * as AgentRunner from './agent_runner';
import { dispatchAgentStage } from './dispatch_agent_stage';
import type {
  AgentStageV1,
  BindingV1,
  FanOutStageV1,
  GateStageV1,
  RecipeStageV1,
  RecipeWorkflowDefinitionV1,
  RunInput,
  VerdictOutcomeV1,
} from '../contracts/recipe_workflow_contract';

export type Runner = Pick<typeof AgentRunner, 'run'>;

/** #1485 S3a-2 — aborts the engine session bound to a local session id. Best-effort; never throws. */
export type SessionAborter = (localSessionId: string) => Promise<void>;

async function defaultAborter(localSessionId: string): Promise<void> {
  try {
    const [{ opencodeClient, opencodeSessionMap }] = await Promise.all([import('./opencode_engine')]);
    const session = new AgentSessionsRepository().findById(localSessionId);
    if (!session) return;
    const sdkSessionId = opencodeSessionMap.get(localSessionId) ?? session.sdkSessionId ?? undefined;
    if (!sdkSessionId) return;
    await opencodeClient.abortSession(sdkSessionId, session.cwd);
  } catch {
    // Best-effort — an abort failure must never block a durable state transition.
  }
}

/**
 * #1485 S3a-1 — the durable recipe-workflow transition engine.
 *
 * Deliberately pure/testable: dispatch is an INJECTED function
 * ({@link StageDispatcher}), never a direct AgentRunner call — AgentRunner
 * wiring (session binding, restart recovery, cancellation slot release) is
 * S3a-2. `tick()` processes exactly the currently-ready frontier of a run and
 * returns; nothing here starts a timer or background loop — repeated calls
 * (a scheduler heartbeat, in production) drive a run to completion.
 *
 * Gates never dispatch: they read a prior "producer" stage's already-stored
 * output. Convention (not enforced by the S1b schema, which is intentionally
 * silent on which output field carries the verdict): the producer's output
 * fields must include an `outcome` field valued 'pass' | 'fail' | 'repair' —
 * anything else (missing, wrong type, unknown string) is treated as an
 * invalid verdict and fails closed via `onInvalid`.
 */

export interface StageDispatchOutcome {
  status: 'succeeded' | 'failed';
  outputFields?: Record<string, unknown>;
  /** Capacity/profile-unavailable failures create no attempt (see unclaim()). */
  errorCode?: 'capacity' | 'profile_unavailable';
  costUsd?: number;
  tokens?: number;
  observedProviderId?: string | null;
  observedModelId?: string | null;
}

export type StageDispatcher = (ctx: {
  runId: string;
  stageExecutionId: string;
  stage: AgentStageV1;
  itemKey: string | null;
  itemId: string | null;
  resolvedInputs: Record<string, unknown>;
}) => Promise<StageDispatchOutcome>;

export type StartResult =
  | { ok: true; runId: string; status: RunStatus }
  | { ok: false; reason: 'disabled' | 'workflow_execution_unavailable' | 'invalid_recipe' };

export type RecipeWorkflowStageDtoV1 = {
  stageExecutionId: string;
  stageId: string;
  itemKey: string | null;
  attemptId: string | null;
  status: StageExecutionRow['status'];
  profileId: string | null;
  configuredProviderId: string | null;
  configuredModelId: string | null;
  observedProviderId: string | null;
  observedModelId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  outcome: VerdictOutcomeV1 | null;
};

export type RecipeWorkflowRunDtoV1 = {
  version: 1;
  runId: string;
  recipeId: string;
  status: RunStatus;
  stages: RecipeWorkflowStageDtoV1[];
  pendingApprovalId: string | null;
  createdAt: string;
  updatedAt: string;
};

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'succeeded', 'failed', 'budget_exhausted', 'workflow_disabled', 'cancelled',
]);
function isTerminalRun(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

function isVerdictOutcome(value: unknown): value is VerdictOutcomeV1 {
  return value === 'pass' || value === 'fail' || value === 'repair';
}

function flattenStages(def: RecipeWorkflowDefinitionV1): Map<string, RecipeStageV1> {
  const map = new Map<string, RecipeStageV1>();
  for (const stage of def.stages) {
    map.set(stage.id, stage);
    if (stage.kind === 'fanOut') for (const child of stage.stages) map.set(child.id, child);
  }
  return map;
}

function occurrenceKey(stageId: string, itemKey: string | null, itemId: string | null): string {
  return `${stageId}\u0000${itemKey ?? ''}\u0000${itemId ?? ''}`;
}

function budgetExceeded(run: RunRow, def: RecipeWorkflowDefinitionV1): boolean {
  return (
    run.usageCostUsd >= def.budgets.maxCostUsd ||
    run.usageTokens >= def.budgets.maxTokens ||
    Date.now() - Date.parse(run.createdAt) >= def.budgets.maxWallTimeMs ||
    run.stageExecutionCount >= def.budgets.maxStageExecutions
  );
}

export function toRunDto(run: RunRow, stages: StageExecutionRow[]): RecipeWorkflowRunDtoV1 {
  return {
    version: 1,
    runId: run.id,
    recipeId: run.recipeId,
    status: run.status,
    stages: stages.map((s) => ({
      stageExecutionId: s.id,
      stageId: s.stageId,
      itemKey: s.itemKey,
      attemptId: s.attemptId,
      status: s.status,
      profileId: s.profileId,
      configuredProviderId: s.configuredProviderId,
      configuredModelId: s.configuredModelId,
      observedProviderId: s.observedProviderId,
      observedModelId: s.observedModelId,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      outcome: s.outcome,
    })),
    pendingApprovalId: run.pendingApprovalId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export class RecipeWorkflowRunner {
  constructor(
    private readonly repo: RecipeWorkflowRepository = new RecipeWorkflowRepository(),
    private readonly cookbookRepo: AgentCookbookRepository = new AgentCookbookRepository(),
    private readonly aborter: SessionAborter = defaultAborter,
  ) {}

  /** Persists the run (+ entry stage) and returns before any dispatch. Creates no row when disabled/unavailable. */
  async start(input: { recipeId: string; ownerUserId: number | null; input: RunInput }): Promise<StartResult> {
    if (!env.recipeWorkflowsEnabled) return { ok: false, reason: 'disabled' };
    // Execution is local-agent-server-only; a hosted/Postgres deployment
    // never dispatches (docs/ai/current-plan-recipes-1485.md).
    if (env.dbClient === 'postgres') return { ok: false, reason: 'workflow_execution_unavailable' };

    const recipe = await this.cookbookRepo.findByIdAsync(input.recipeId);
    if (!recipe || recipe.format !== 'v1' || !recipe.definitionJson) {
      return { ok: false, reason: 'invalid_recipe' };
    }
    const definition = JSON.parse(recipe.definitionJson) as RecipeWorkflowDefinitionV1;
    const run = this.repo.createRun({
      recipeId: input.recipeId,
      ownerUserId: input.ownerUserId,
      definition,
      input: input.input,
    });
    return { ok: true, runId: run.id, status: run.status };
  }

  /**
   * `ownerUserId` omitted/undefined = an internal/trusted caller (tests, the
   * tick loop) that intentionally bypasses ownership scoping. An HTTP caller
   * MUST always pass its resolved identity (including explicit `null` for a
   * local/no-auth caller) so a mismatched or another-user's run 404s instead
   * of leaking existence/content — see agentWorkflowController.ts.
   */
  getDto(runId: string, ownerUserId?: number | null): RecipeWorkflowRunDtoV1 | null {
    const run = ownerUserId != null ? this.repo.getRunForOwner(runId, ownerUserId) : this.repo.getRun(runId);
    if (!run) return null;
    return toRunDto(run, this.repo.listStageExecutions(runId));
  }

  /**
   * Idempotent: cancelling an already-terminal run leaves its terminal status
   * unchanged. Fences the run/stages FIRST (durable), then best-effort aborts
   * every bound engine session so AgentRunner's blocking run() settles and
   * releases its slot promptly (see agent_runner.ts's _releaseSlot/finally —
   * unchanged; this reuses the same abort path agent_sessions_controller.ts's
   * cancel() already uses for a regular session, no new AgentRunner code
   * needed). A late completion cannot resurrect the run: recordCompletion
   * only ever targets a specific stageExecutionId, and every one of this
   * run's stages is already fenced to 'cancelled' before the abort call.
   */
  async cancel(runId: string, ownerUserId?: number | null): Promise<{ ok: true; status: RunStatus } | { ok: false }> {
    const run = ownerUserId != null ? this.repo.getRunForOwner(runId, ownerUserId) : this.repo.getRun(runId);
    if (!run) return { ok: false };
    if (isTerminalRun(run.status)) return { ok: true, status: run.status };
    const boundSessionIds = this.repo.listBoundSessionIds(runId);
    this.repo.cancelRun(runId);
    await Promise.all(boundSessionIds.map((id) => this.aborter(id)));
    return { ok: true, status: 'cancelled' };
  }

  /**
   * Restart recovery (S0 has not run; per the lane's assumption, sync run()
   * plus durable completion — see createAgentRunnerDispatcher below). Any
   * occurrence still 'running' after a restart is AMBIGUOUS (the process
   * cannot tell whether its side effect committed before it died), so it
   * becomes 'blocked_reconciliation' rather than being silently re-dispatched
   * — only an explicit human-unblock action exists (no automatic recovery is
   * implemented here). Committed ('succeeded'/'failed') stages are never
   * touched, so they are never re-dispatched. Call once at server startup.
   *
   * Also sweeps for a STALLED run: non-terminal, but with no running/pending
   * stage left at all (every occurrence already reached a terminal per-stage
   * status). That is the crash-between-steps window a process kill between
   * recordCompletion committing and advanceTo/updateRunStatus running could
   * leave behind — now closed for future runs by wrapping that sequence in
   * one db.transaction() (see processAgent/processGate/tryJoinFanOut), but
   * still detected here defensively. There is nothing to "resend" for a
   * stalled run (nothing is pending/running to dispatch); marking it
   * blocked_reconciliation only surfaces the stall for a human to unblock.
   */
  reconcileAfterRestart(): { reconciledStages: number; affectedRuns: number } {
    const runningStages = this.repo.listRunningStageExecutions();
    const affectedRuns = new Set<string>();
    for (const stage of runningStages) {
      this.repo.markBlockedReconciliation(stage.id);
      affectedRuns.add(stage.runId);
    }
    for (const runId of this.repo.listStalledRunIds()) affectedRuns.add(runId);
    for (const runId of affectedRuns) {
      const run = this.repo.getRun(runId);
      if (run && !isTerminalRun(run.status)) this.repo.updateRunStatus(runId, 'blocked_reconciliation');
    }
    return { reconciledStages: runningStages.length, affectedRuns: affectedRuns.size };
  }

  /**
   * Processes exactly the currently-ready frontier once and returns. Safe to
   * call repeatedly/concurrently for the same run: every state change is
   * gated by an atomic claim (see RecipeWorkflowRepository.claim), so a
   * duplicated tick dispatches nothing twice.
   */
  async tick(runId: string, dispatcher: StageDispatcher): Promise<void> {
    const run = this.repo.getRun(runId);
    if (!run || isTerminalRun(run.status)) return;

    // #1485 S3a-2 — turning the flag off makes every in-flight run terminal
    // at the next heartbeat: fence stages, abort sessions, release slots.
    // Rows stay visible for monitoring; the flag never silently orphans work.
    if (!env.recipeWorkflowsEnabled) {
      const boundSessionIds = this.repo.listBoundSessionIds(runId);
      this.repo.disableRun(runId);
      await Promise.all(boundSessionIds.map((id) => this.aborter(id)));
      return;
    }

    const def = run.definition;
    if (budgetExceeded(run, def)) {
      this.repo.updateRunStatus(runId, 'budget_exhausted');
      return;
    }
    const stageDefs = flattenStages(def);

    // ponytail: a flat iteration ceiling rather than proving graph
    // termination — the S1b validator already rejects unbounded back edges,
    // so this only guards against a defect in this engine, not a legitimate
    // workflow shape.
    for (let pass = 0; pass < 1000; pass++) {
      let progressed = false;
      const stages = this.repo.listStageExecutions(runId);
      const byOccurrence = new Map(stages.map((s) => [occurrenceKey(s.stageId, s.itemKey, s.itemId), s]));

      for (const row of stages) {
        if (row.status !== 'pending') continue;
        const stageDef = stageDefs.get(row.stageId);
        if (!stageDef) continue;
        if (stageDef.kind === 'agent') {
          if (await this.processAgent(run, row, stageDef, dispatcher)) progressed = true;
        } else if (stageDef.kind === 'gate') {
          if (this.processGate(run, row, stageDef, byOccurrence)) progressed = true;
        } else if (stageDef.kind === 'fanOut') {
          if (this.processFanOutStart(run, row, stageDef, byOccurrence)) progressed = true;
        } else if (stageDef.kind === 'approval') {
          if (this.repo.claim(row.id, 'pending', 'blocked_approval')) {
            this.repo.updateRunStatus(runId, 'blocked_approval', { pendingApprovalId: row.id });
            progressed = true;
          }
        }
      }

      for (const row of stages) {
        if (row.status !== 'running') continue;
        const stageDef = stageDefs.get(row.stageId);
        if (stageDef?.kind === 'fanOut' && this.tryJoinFanOut(run, row, stageDef)) progressed = true;
      }

      const refreshed = this.repo.getRun(runId)!;
      if (isTerminalRun(refreshed.status)) return;
      if (budgetExceeded(refreshed, def)) {
        this.repo.updateRunStatus(runId, 'budget_exhausted');
        return;
      }
      if (!progressed) return;
    }
  }

  private resolveInputs(
    bindings: Record<string, BindingV1>,
    ctx: { runId: string; runInput: RunInput; itemData: Record<string, unknown> | null; itemKey: string | null; itemId: string | null },
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, binding] of Object.entries(bindings)) {
      if (binding.source === 'runInput') out[name] = ctx.runInput[binding.key];
      else if (binding.source === 'currentItem') out[name] = ctx.itemData?.[binding.field];
      else out[name] = this.findProducerOutput(ctx.runId, binding.stageId, ctx.itemKey, ctx.itemId)?.[binding.field];
    }
    return out;
  }

  /** "Current item, else run root" — no scopePath/ancestor walk (matches the S1b binding-resolution rule). */
  private findProducerOutput(
    runId: string, stageId: string, itemKey: string | null, itemId: string | null,
  ): Record<string, unknown> | null {
    const rows = this.repo.listStageExecutions(runId);
    const sameScope = rows.find((r) => r.stageId === stageId && r.itemKey === itemKey && r.itemId === itemId);
    if (sameScope) return sameScope.outputFields ?? null;
    const root = rows.find((r) => r.stageId === stageId && r.itemKey === null);
    return root?.outputFields ?? null;
  }

  private async processAgent(
    run: RunRow, row: StageExecutionRow, stageDef: AgentStageV1, dispatcher: StageDispatcher,
  ): Promise<boolean> {
    if (!this.repo.claim(row.id, 'pending', 'running')) return false;

    const resolvedInputs = this.resolveInputs(stageDef.inputs, {
      runId: run.id, runInput: run.input, itemData: row.itemData, itemKey: row.itemKey, itemId: row.itemId,
    });

    let result: StageDispatchOutcome;
    try {
      result = await dispatcher({
        runId: run.id, stageExecutionId: row.id, stage: stageDef,
        itemKey: row.itemKey, itemId: row.itemId, resolvedInputs,
      });
    } catch {
      result = { status: 'failed' };
    }

    if (result.errorCode === 'capacity' || result.errorCode === 'profile_unavailable') {
      this.repo.unclaim(row.id);
      return false;
    }

    const outcome = isVerdictOutcome(result.outputFields?.outcome) ? (result.outputFields!.outcome as VerdictOutcomeV1) : null;
    const isRootScope = !row.itemKey;
    // Atomic: a process kill between recording this completion and advancing
    // to the next occurrence (or finalizing the run) must never leave a run
    // with no running/pending stage and no successor — see
    // reconcileAfterRestart()'s stalled-run sweep for the remaining case
    // (a crash between this transaction committing and the NEXT tick).
    this.repo.transaction(() => {
      this.repo.recordCompletion(row.id, {
        status: result.status === 'succeeded' ? 'succeeded' : 'failed',
        outcome,
        outputFields: result.outputFields ?? null,
        profileId: stageDef.profileId,
        configuredProviderId: stageDef.provider?.providerId ?? null,
        configuredModelId: stageDef.provider?.modelId ?? null,
        observedProviderId: result.observedProviderId ?? null,
        observedModelId: result.observedModelId ?? null,
        costUsd: result.costUsd ?? 0,
        tokens: result.tokens ?? 0,
      });
      this.repo.recordRunUsage(run.id, { costUsd: result.costUsd ?? 0, tokens: result.tokens ?? 0 });

      if (result.status === 'failed') {
        if (isRootScope) this.repo.updateRunStatus(run.id, 'failed');
        return;
      }
      if (stageDef.terminal) {
        if (isRootScope) this.repo.updateRunStatus(run.id, 'succeeded');
        // else: a fan-out item reached its terminal — tryJoinFanOut notices it.
      } else if (stageDef.next) {
        this.repo.advanceTo({ runId: run.id, stageId: stageDef.next, itemKey: row.itemKey, itemId: row.itemId });
      }
    });
    return true;
  }

  private processGate(
    run: RunRow, row: StageExecutionRow, stageDef: GateStageV1, byOccurrence: Map<string, StageExecutionRow>,
  ): boolean {
    const producer = byOccurrence.get(occurrenceKey(stageDef.producerStageId, row.itemKey, row.itemId));
    if (!producer || producer.status !== 'succeeded') return false;
    if (!this.repo.claim(row.id, 'pending', 'running')) return false;

    const outcome = isVerdictOutcome(producer.outcome) ? producer.outcome : null;

    if (outcome === null) {
      // Fail-closed: a missing/malformed/ambiguous verdict can NEVER succeed.
      this.repo.transaction(() => {
        this.repo.recordCompletion(row.id, { status: 'failed', outcome: null });
        this.repo.advanceTo({ runId: run.id, stageId: stageDef.onInvalid, itemKey: row.itemKey, itemId: row.itemId });
      });
      return true;
    }
    if (outcome === 'pass' || outcome === 'fail') {
      const target = outcome === 'pass' ? stageDef.branches.pass : stageDef.branches.fail;
      this.repo.transaction(() => {
        this.repo.recordCompletion(row.id, { status: 'succeeded', outcome });
        this.repo.advanceTo({ runId: run.id, stageId: target, itemKey: row.itemKey, itemId: row.itemId });
      });
      return true;
    }

    // outcome === 'repair'
    if (!stageDef.loop || !stageDef.branches.repair) {
      // S1b's validator guarantees this pairing; fail closed defensively anyway.
      this.repo.transaction(() => {
        this.repo.recordCompletion(row.id, { status: 'failed', outcome: null });
        this.repo.advanceTo({ runId: run.id, stageId: stageDef.onInvalid, itemKey: row.itemKey, itemId: row.itemId });
      });
      return true;
    }

    // Iteration cap: checked against the count of repair cycles ALREADY RUN
    // (before this decision), consistent with budgetExceeded()'s "usage >=
    // cap" style — this is what makes maxIterations:N mean "N repair cycles
    // actually run, then the (N+1)th decision is exhausted" rather than
    // silently allowing one extra cycle past the configured cap. Cost/tokens/
    // wall-time remain checked AFTER recording this decision's usage, since
    // (unlike a pure counter) they are only knowable retrospectively, once
    // the just-finished producer attempt's actual usage is in hand.
    const priorIterations = this.repo.getLoopUsage(run.id, stageDef.loop.loopId, row.itemKey, row.itemId)?.iterations ?? 0;
    if (priorIterations >= stageDef.loop.maxIterations) {
      this.repo.transaction(() => {
        this.repo.recordCompletion(row.id, { status: 'failed', outcome: 'repair' });
        this.repo.advanceTo({ runId: run.id, stageId: stageDef.loop!.exhaustedTarget, itemKey: row.itemKey, itemId: row.itemId });
      });
      return true;
    }

    const usage = this.repo.recordLoopIteration(run.id, stageDef.loop.loopId, row.itemKey, row.itemId, {
      costUsd: producer.costUsd, tokens: producer.tokens,
    });
    const exceeded =
      usage.costUsd >= stageDef.loop.maxCostUsd ||
      usage.tokens >= stageDef.loop.maxTokens ||
      Date.now() - Date.parse(usage.startedAt) >= stageDef.loop.maxWallTimeMs;

    if (exceeded) {
      this.repo.transaction(() => {
        this.repo.recordCompletion(row.id, { status: 'failed', outcome: 'repair' });
        this.repo.advanceTo({ runId: run.id, stageId: stageDef.loop!.exhaustedTarget, itemKey: row.itemKey, itemId: row.itemId });
      });
    } else {
      // Record this decision as a genuine completion — do NOT reset the gate
      // to 'pending' here. Found while adding the exact-iteration-count test
      // below: resetting it immediately let it be re-evaluated against the
      // SAME (already-consumed) producer output before the repair cycle
      // even ran, double-counting iterations and exhausting the loop with
      // fewer real repair dispatches than maxIterations. The gate is
      // naturally re-armed later: the producer stage's OWN `next` already
      // points back to this gate, so advanceTo() resets THIS row from
      // 'succeeded' back to 'pending' exactly when — and only when — the
      // producer's redo attempt next completes.
      this.repo.transaction(() => {
        this.repo.recordCompletion(row.id, { status: 'succeeded', outcome: 'repair' });
        this.repo.advanceTo({ runId: run.id, stageId: stageDef.branches.repair!, itemKey: row.itemKey, itemId: row.itemId });
      });
    }
    return true;
  }

  private processFanOutStart(
    run: RunRow, row: StageExecutionRow, stageDef: FanOutStageV1, byOccurrence: Map<string, StageExecutionRow>,
  ): boolean {
    const producer = byOccurrence.get(occurrenceKey(stageDef.itemsFrom.stageId, null, null));
    if (!producer || producer.status !== 'succeeded') return false;
    if (!this.repo.claim(row.id, 'pending', 'running')) return false;

    const items = Array.isArray(producer.outputFields?.items)
      ? (producer.outputFields!.items as Record<string, unknown>[])
      : [];

    if (items.length === 0) {
      // Empty fan-out joins immediately.
      this.repo.transaction(() => {
        this.repo.recordCompletion(row.id, { status: 'succeeded' });
        this.repo.advanceTo({ runId: run.id, stageId: stageDef.next, itemKey: null, itemId: null });
      });
      return true;
    }

    const producerDef = this.findProducerStageDef(run.definition, stageDef.itemsFrom.stageId);
    const keyField = producerDef?.kind === 'agent' ? producerDef.output.items?.keyField : undefined;
    this.repo.transaction(() => {
      for (const item of items) {
        const itemId = String(keyField ? item[keyField] : Object.values(item)[0]);
        this.repo.advanceTo({ runId: run.id, stageId: stageDef.entryStageId, itemKey: stageDef.itemKey, itemId, itemData: item });
      }
    });
    // Row stays 'running' — tryJoinFanOut resolves it once every item is terminal.
    return true;
  }

  private findProducerStageDef(def: RecipeWorkflowDefinitionV1, stageId: string): RecipeStageV1 | undefined {
    return flattenStages(def).get(stageId);
  }

  private tryJoinFanOut(run: RunRow, row: StageExecutionRow, stageDef: FanOutStageV1): boolean {
    const terminalIds = new Set(
      stageDef.stages.filter((s): s is AgentStageV1 => s.kind === 'agent' && s.terminal === true).map((s) => s.id),
    );
    if (terminalIds.size === 0) return false;

    const stages = this.repo.listStageExecutions(run.id);
    const itemIds = new Set(
      stages.filter((s) => s.itemKey === stageDef.itemKey).map((s) => s.itemId).filter((v): v is string => v !== null),
    );
    if (itemIds.size === 0) return false;

    for (const itemId of itemIds) {
      const done = stages.some(
        (s) => s.itemId === itemId && s.itemKey === stageDef.itemKey && terminalIds.has(s.stageId) &&
          (s.status === 'succeeded' || s.status === 'failed'),
      );
      if (!done) return false;
    }

    this.repo.transaction(() => {
      this.repo.recordCompletion(row.id, { status: 'succeeded' });
      this.repo.advanceTo({ runId: run.id, stageId: stageDef.next, itemKey: null, itemId: null });
    });
    return true;
  }
}

// ── Real AgentRunner-backed dispatcher (S3a-2) ──────────────────────────────
//
// S0 (the live restart-recovery probe) has not run. Per the lane's own
// assumption for this case: implement synchronous run() plus durable
// completion (the CURRENT, already-blocking AgentRunner.run() shape) rather
// than a new AgentRunner-owned async start API, and record that assumption
// here. If S0 later proves run() cannot be recovered after a restart, this
// factory is the one place that needs to change to an async-start model —
// nothing in RecipeWorkflowRunner's tick()/StageDispatcher contract does.

function buildStagePrompt(stage: AgentStageV1, resolvedInputs: Record<string, unknown>): string {
  // ponytail: structured completion (rhythm_complete_workflow_stage) is S3b;
  // until then this just asks for a JSON reply and best-effort parses it
  // (parseStageOutputFields below) — a reply that isn't JSON yields {}, which
  // correctly fails a downstream gate closed rather than fabricating a verdict.
  return [
    `Workflow stage "${stage.id}" (profile: ${stage.profileId}).`,
    `Inputs: ${JSON.stringify(resolvedInputs)}`,
    `Reply with a single JSON object with exactly these fields: ${JSON.stringify(stage.output.fields)}.`,
  ].join('\n\n');
}

function parseStageOutputFields(resultText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(resultText) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Observed provider/model comes ONLY from assistant agent_session_messages
 * .info_json (never agent_sessions.provider_id/model_id, which is
 * first-write configured/backfill data, not authoritative observation).
 * Zero, mixed, or mismatched values fail closed (return null).
 */
function observedProviderModel(sessionId: string): { providerId: string; modelId: string } | null {
  const rows = getDb()
    .prepare(
      `SELECT info_json FROM agent_session_messages WHERE session_id = ? AND role = 'output' AND info_json IS NOT NULL`,
    )
    .all(sessionId) as { info_json: string }[];
  const pairs = new Set<string>();
  let sawAssistantMessage = false;
  for (const row of rows) {
    let info: Record<string, unknown>;
    try {
      info = JSON.parse(row.info_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (info.role !== 'assistant') continue;
    if (typeof info.providerID !== 'string' || typeof info.modelID !== 'string') continue;
    sawAssistantMessage = true;
    pairs.add(`${info.providerID}\u0000${info.modelID}`);
  }
  if (!sawAssistantMessage || pairs.size !== 1) return null;
  const [providerId, modelId] = [...pairs][0].split('\u0000');
  return { providerId, modelId };
}

/**
 * The real dispatcher: wires a recipe-workflow stage to AgentRunner through
 * the S2 dispatchAgentStage seam. `runner` is injectable (defaults to the
 * real agent_runner module) so this factory's own binding/mismatch/
 * observed-provider logic is unit-testable without a real engine.
 */
export function createAgentRunnerDispatcher(
  workflowRepo: RecipeWorkflowRepository = new RecipeWorkflowRepository(),
  sessionsRepo: AgentSessionsRepository = new AgentSessionsRepository(),
  runner: Runner = AgentRunner,
): StageDispatcher {
  return async ({ runId, stageExecutionId, stage, resolvedInputs }) => {
    let provisionalSessionId: string | null = null;
    let bindingFailed = false;

    let result: AgentRunner.AgentRunResult;
    try {
      result = await dispatchAgentStage(
        {
          prompt: buildStagePrompt(stage, resolvedInputs),
          outputTarget: 'session',
          sessionName: `Workflow ${runId} · ${stage.id}`,
          // Pinned stages never silently re-run on a different (teacher)
          // model — that would invalidate the exact provider this dispatch
          // was asked for. See agent_runner.ts's suppressTeacherEscalation (S2).
          suppressTeacherEscalation: true,
          ...(stage.provider ? { modelOverride: { providerID: stage.provider.providerId, modelID: stage.provider.modelId } } : {}),
          onSessionCreated: async (sessionId) => {
            // The FIRST call atomically writes the provisional binding BEFORE
            // any engine work; a second call (or a binding write that fails)
            // throws, which fails the dispatch closed before the model runs
            // (agent_runner.ts calls onSessionCreated before opencodeClient
            // .createSession/.prompt — see the S2/S3a-1 notes).
            if (provisionalSessionId !== null) {
              bindingFailed = true;
              throw new Error('workflow stage dispatch received a second onSessionCreated call');
            }
            provisionalSessionId = sessionId;
            const boundStage = workflowRepo.bindProvisionalSession(stageExecutionId, sessionId);
            const boundSession = sessionsRepo.bindWorkflowSession(sessionId, runId, stageExecutionId);
            if (!boundStage || !boundSession) {
              bindingFailed = true;
              throw new Error('failed to persist the provisional workflow session binding');
            }
          },
        },
        runner,
      );
    } catch {
      return { status: 'failed' };
    }

    // A capacity/profile-unavailable rejection happens BEFORE session
    // creation (no onSessionCreated call at all) — forward it as-is so the
    // tick engine's unclaim() path creates no attempt and consumes no
    // repair budget, regardless of the (never-set) provisional binding.
    if (result.errorCode === 'capacity' || result.errorCode === 'profile_unavailable') {
      return { status: 'failed', errorCode: result.errorCode };
    }
    // Commit only when the final result's session equals the SOLE
    // provisional session — a second/mismatched session fails closed.
    if (bindingFailed || !provisionalSessionId || result.sessionId !== provisionalSessionId) {
      return { status: 'failed' };
    }
    if (result.status !== 'done') {
      return { status: 'failed' };
    }
    workflowRepo.commitSession(stageExecutionId, result.sessionId);

    const observed = observedProviderModel(result.sessionId);
    const requiresProvenProvider = Boolean(stage.provider || stage.differentProviderFromStageId);
    if (requiresProvenProvider && !observed) {
      // A pinned/cross-provider stage's whole point is a provable provider —
      // zero/mixed observed values fail the dispatch closed, not just the field.
      return { status: 'failed' };
    }

    return {
      status: 'succeeded',
      outputFields: parseStageOutputFields(result.result),
      observedProviderId: observed?.providerId ?? null,
      observedModelId: observed?.modelId ?? null,
    };
  };
}
