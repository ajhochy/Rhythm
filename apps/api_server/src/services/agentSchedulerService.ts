/**
 * Agent Scheduler Service
 *
 * Translates Odysseus's `task_scheduler.py` scheduling spine into Node/TS.
 * Every minute, checks `agent_scheduled_tasks` for rows with next_run_at <= now,
 * then inserts a row into `pending_claude_triggers` so the existing
 * AgentTriggerWatcher picks it up through the normal OpenCode path.
 *
 * Design differences from Odysseus:
 *  • No unsandboxed shell — tasks emit triggers, never run shell directly
 *  • No base_url SSRF surface — outbound calls are webhook-only + SSRF-guarded
 *  • Blast-radius isolation: scheduler state lives in `agent_scheduled_tasks`
 *    (separate conceptual schema); the only write to production tables is the
 *    INSERT into pending_claude_triggers
 *  • Uses node-cron (already in deps) for the tick, not a raw asyncio loop
 */

import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import * as AgentRunner from './agent_runner';
import { resolveProfileScope } from './agent_profile_scope';
import { opencodeClient } from './opencode_engine';

// ── scope inheritance (scheduled tasks inherit profile scope) ──────────────
//
// A scheduled task INHERITS its bound profile's MCP/skill scope at run time.
// The task's own allowlist is only an explicit OVERRIDE. AgentRunner passes
// these straight to resolveProfileScope, where `undefined` means "inherit the
// profile" and a concrete value means "override". So a task with no own
// allowlist (null) — OR an empty `[]`/`{}` — must resolve to `undefined`, NOT
// null: null is read by the helper as an explicit "unrestricted" override,
// which would silently drop the profile scope. Normalize here, once.
function resolveTaskScopeOverride(json: string | null | undefined): string | undefined {
  if (json == null || json.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(json);
    const isEmpty = Array.isArray(parsed)
      ? parsed.length === 0
      : parsed !== null && typeof parsed === 'object'
        ? Object.keys(parsed).length === 0
        : true; // a non-array/object scalar is not a usable allowlist → inherit
    return isEmpty ? undefined : json;
  } catch {
    // Malformed JSON: pass through; resolveProfileScope treats it as no scope.
    return json;
  }
}

// ── next_run computation ──────────────────────────────────────────────────

/**
 * Compute the next run datetime (naive UTC ISO string) from a schedule.
 *
 * Translated from Odysseus `src/task_scheduler.py:compute_next_run()`.
 * Timezone-aware: interprets scheduled_time / scheduled_day in the task's
 * timezone, then converts back to UTC for storage.
 */
export function computeNextRun(opts: {
  scheduleType: string;
  scheduledTime?: string | null;
  scheduledDay?: number | null;
  cronExpression?: string | null;
  runAt?: string | null;
  timezone?: string;
  after?: Date;
}): string | null {
  const { scheduleType, scheduledTime, scheduledDay, cronExpression, runAt, timezone, after } = opts;
  const afterDate = after ?? new Date();

  try {
    // Resolve local "now" in the task's timezone
    const tz = timezone ?? 'America/Los_Angeles';

    const localNow = new Date(
      afterDate.toLocaleString('en-US', { timeZone: tz }),
    );

    const toUtcIso = (d: Date): string => {
      // d is a "local-looking" Date from toLocaleString; we need to compute
      // the true UTC offset and convert properly.
      // Strategy: use Intl to format the original afterDate in the target tz,
      // compute the offset, and apply it.
      const offset = afterDate.getTime() - localNow.getTime();
      return new Date(d.getTime() + offset).toISOString();
    };

    if (scheduleType === 'once') {
      if (!runAt) return null;
      const runDate = new Date(runAt);
      if (runDate <= afterDate) return null;
      return runDate.toISOString();
    }

    if (scheduleType === 'cron') {
      if (!cronExpression) return null;
      // node-cron has no standalone next(); keep the existing minute scan but
      // match each candidate against WALL-CLOCK fields in the task timezone.
      return _computeNextCron(cronExpression, afterDate, tz);
    }

    if (!scheduledTime) return null;

    const parts = scheduledTime.split(':');
    if (parts.length < 2) return null;
    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);
    if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) return null;

    if (scheduleType === 'daily') {
      let candidate = new Date(localNow);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate <= localNow) candidate = new Date(candidate.getTime() + 86400_000);
      return toUtcIso(candidate);
    }

    if (scheduleType === 'weekly') {
      const targetDay = scheduledDay ?? 0; // 0=Sunday in JS Date
      let candidate = new Date(localNow);
      candidate.setHours(hour, minute, 0, 0);
      const currentDay = localNow.getDay(); // 0=Sunday
      let daysAhead = targetDay - currentDay;
      if (daysAhead < 0 || (daysAhead === 0 && candidate <= localNow)) daysAhead += 7;
      candidate = new Date(candidate.getTime() + daysAhead * 86400_000);
      return toUtcIso(candidate);
    }

    if (scheduleType === 'monthly') {
      const targetDate = scheduledDay ?? 1;
      let candidate = new Date(localNow);
      const lastDay = new Date(localNow.getFullYear(), localNow.getMonth() + 1, 0).getDate();
      candidate.setDate(Math.min(targetDate, lastDay));
      candidate.setHours(hour, minute, 0, 0);
      if (candidate <= localNow) {
        // Advance to next month
        const next = new Date(localNow.getFullYear(), localNow.getMonth() + 1, 1);
        const nextLastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(targetDate, nextLastDay));
        next.setHours(hour, minute, 0, 0);
        return toUtcIso(next);
      }
      return toUtcIso(candidate);
    }

    return null;
  } catch (err) {
    logger.warn(`[AgentScheduler] computeNextRun error: ${String(err)}`);
    return null;
  }
}

const _cronTzFormatterCache = new Map<string, Intl.DateTimeFormat>();

function _cronTzFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = _cronTzFormatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    _cronTzFormatterCache.set(tz, formatter);
  }
  return formatter;
}

const _cronWeekdayToNumber: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function _cronLocalFields(instant: Date, tz: string) {
  const parts = _cronTzFormatter(tz).formatToParts(instant);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return {
    minute: parseInt(part('minute'), 10),
    hour: parseInt(part('hour'), 10),
    dayOfMonth: parseInt(part('day'), 10),
    month: parseInt(part('month'), 10),
    dayOfWeek: _cronWeekdayToNumber[part('weekday')] ?? 0,
  };
}

/**
 * Compute next cron fire time by advancing minute-by-minute.
 * Cron expressions are wall-clock time in `tz`, not UTC. Each UTC candidate is
 * rendered in that timezone and matched on the local fields, so DST shifts are
 * handled automatically without adding a new dependency.
 */
function _computeNextCron(expression: string, after: Date, tz: string): string | null {
  // Advance in 1-minute steps up to 366 days = ~527,040 iterations (worst case)
  // This is acceptable for a scheduled background job.
  const MAX_ITERATIONS = 527_040;
  let candidate = new Date(after.getTime() + 60_000); // start 1 minute ahead
  candidate.setUTCSeconds(0, 0);

  // Parse the 5-field cron expression
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minPart, hourPart, domPart, monPart, rawDowPart] = parts;
  const dowPart = rawDowPart.replace(/\b7\b/g, '0');

  const matchField = (value: number, field: string, min: number): boolean => {
    if (field === '*') return true;
    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [range, step] = part.split('/');
        const stepNum = parseInt(step, 10);
        const rangeStart = range === '*' ? min : parseInt(range, 10);
        if (!isNaN(stepNum) && value >= rangeStart && (value - rangeStart) % stepNum === 0) return true;
      } else if (part.includes('-')) {
        const [lo, hi] = part.split('-').map(Number);
        if (value >= lo && value <= hi) return true;
      } else {
        if (parseInt(part, 10) === value) return true;
      }
    }
    return false;
  };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const local = _cronLocalFields(candidate, tz);

    if (
      matchField(local.minute, minPart, 0) &&
      matchField(local.hour, hourPart, 0) &&
      matchField(local.dayOfMonth, domPart, 1) &&
      matchField(local.month, monPart, 1) &&
      matchField(local.dayOfWeek, dowPart, 0)
    ) {
      return candidate.toISOString();
    }

    candidate = new Date(candidate.getTime() + 60_000);
  }

  return null;
}

// ── Boot-time engine readiness wait (#1222 Problem 2) ──────────────────────
//
// server.ts kicks off `opencodeClient.initialize()` in a separate,
// non-blocking `.then()` chain LATER in its startup sequence than
// `startAgentSchedulerJob()` is called. The scheduler's boot-time immediate
// catch-up pass (below) can therefore run any due task while the engine
// client is still null — every such task used to hit `createSession`
// instantly and permanently ("N schedules errored at the identical
// timestamp"). Wait, bounded, ONLY for this one boot-time pass before
// letting it fire — a genuinely broken engine still fails visibly (via
// createSession's own accurate error, see opencode_client_service.ts) rather
// than hanging forever. The regular 1-minute cron tick is untouched: by then
// the engine has had ample time and this would be pure overhead.

function _engineReadyBootWaitMs(): number {
  return Number(process.env.AGENT_SCHEDULER_BOOT_ENGINE_WAIT_MS ?? 90_000);
}

async function _waitForEngineReadyOnBoot(): Promise<void> {
  const POLL_INTERVAL_MS = 500;
  const deadline = Date.now() + _engineReadyBootWaitMs();
  while (!opencodeClient.isReady && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// ── Trigger insertion ─────────────────────────────────────────────────────

/**
 * Fire a scheduled task by inserting a pending trigger.
 * The trigger carries the scheduled task's prompt + tool scoping so the
 * downstream agent knows what it's supposed to do and which tools it can use.
 *
 * task_id is LEFT as NULL for scheduler-originated triggers (no Rhythm task
 * row required). The MCP tool `rhythm_list_pending_triggers` is updated to
 * surface `prompt` + `scheduledTaskId` when `taskId` is null.
 */
async function insertScheduledTrigger(task: {
  id: string;
  prompt: string;
  agentConfigId: string | null;
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
  modelProvider: string | null;
  modelId: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const scope = await resolveProfileScope(task.agentConfigId, {
    allowedMcpsJsonOverride: resolveTaskScopeOverride(task.allowedMcpsJson),
    allowedSkillsJsonOverride: resolveTaskScopeOverride(task.allowedSkillsJson),
  });
  const effectiveModel =
    task.modelProvider && task.modelId
      ? { providerID: task.modelProvider, modelID: task.modelId }
      : scope.model;
  const effectiveAllowedMcpsJson = scope.mcpRoleConfig?.allowedToolsJson ?? null;
  const effectiveAllowedSkillsJson = scope.allowedSkillsJson ?? null;

  if (env.dbClient === 'postgres') {
    // ON CONFLICT on (task_id) only applies when task_id IS NOT NULL.
    // For scheduler triggers, task_id IS NULL so there's no uniqueness constraint.
    await getPostgresPool().query(
      `INSERT INTO pending_claude_triggers
         (task_id, triggered_by_user_id, scheduled_task_id, prompt,
          allowed_mcps_json, allowed_skills_json, model_provider, model_id, created_at)
       VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, $7)`,
      [
        task.id,
        task.prompt,
        effectiveAllowedMcpsJson,
        effectiveAllowedSkillsJson,
        effectiveModel.providerID,
        effectiveModel.modelID,
        now,
      ],
    );
    return;
  }

  getDb().prepare(`
    INSERT INTO pending_claude_triggers
      (task_id, triggered_by_user_id, scheduled_task_id, prompt,
       allowed_mcps_json, allowed_skills_json, model_provider, model_id, created_at)
    VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.prompt,
    effectiveAllowedMcpsJson,
    effectiveAllowedSkillsJson,
    effectiveModel.providerID,
    effectiveModel.modelID,
    now,
  );
}

// ── Scheduler loop ────────────────────────────────────────────────────────

const repo = new AgentScheduledTasksRepository();
const CAPACITY_RETRY_MS = 60_000; // scheduler ticks once per minute

async function checkDueTasks(): Promise<void> {
  let dueTasks: Awaited<ReturnType<typeof repo.findDueAsync>>;
  try {
    dueTasks = await repo.findDueAsync();
  } catch (err) {
    logger.error(`[AgentScheduler] findDueAsync error: ${String(err)}`);
    return;
  }

  for (const task of dueTasks) {
    const runStart = new Date().toISOString();
    logger.info(`[AgentScheduler] Firing task "${task.name}" (${task.id})`);

    try {
      if (env.agentLocal) {
        // ── Local path: run directly via AgentRunner ──────────────────────────
        // Mark 'running' before the async call so the UI reflects progress.
        const nextRun = computeNextRun({
          scheduleType: task.scheduleType,
          scheduledTime: task.scheduledTime,
          scheduledDay: task.scheduledDay,
          cronExpression: task.cronExpression,
          runAt: task.runAt,
          timezone: task.timezone,
          after: new Date(),
        });
        await repo.updateNextRunAsync(task.id, nextRun, runStart, 'running');

        // Run async — one failure must not block the rest of the loop.
        // #738-fix: pass agentKind + scheduledTaskId so the runner can
        // resolve a model and record a session row visible in CHATS.
        AgentRunner.run({
          prompt: task.prompt,
          // scope-inheritance: inherit the profile scope when the task has no own allowlist
          // (null/empty → undefined); a concrete value overrides the profile.
          allowedMcpsJson: resolveTaskScopeOverride(task.allowedMcpsJson),
          allowedSkillsJson: resolveTaskScopeOverride(task.allowedSkillsJson),
          // model-override: per-task model override — only when BOTH columns are set;
          // otherwise undefined so the runner falls back to the profile model.
          modelOverride:
            task.modelProvider && task.modelId
              ? { providerID: task.modelProvider, modelID: task.modelId }
              : undefined,
          taskId: null,
          outputTarget: 'session',
          agentKind: task.agentKind ?? task.agentConfigId ?? 'claude-code',
          agentConfigId: task.agentConfigId ?? task.agentKind,
          scheduledTaskId: task.id,
          sessionName: `Scheduled: ${task.name}`,
          // FOLLOW-UP (memory injection): thread the task owner so memory
          // retrieval is OWNER-SCOPED to whoever created this scheduled task.
          // Null owner → only instance-global memory is injected (fail-safe).
          ownerUserId: task.createdByUserId ?? null,
        }).then(async (result) => {
          const capacityDeferred = result.errorCode === 'capacity';
          const status = result.status === 'done'
            ? 'success'
            : capacityDeferred
              ? 'queued'
              : 'error';
          const errMsg = result.error ?? undefined;
          // Capacity is transient, not a failed task execution. Preserve the
          // global resource cap and retry on the next scheduler tick instead
          // of waiting for the task's next normal recurrence.
          const resultNextRun = capacityDeferred
            ? new Date(Date.now() + CAPACITY_RETRY_MS).toISOString()
            : nextRun;
          try {
            await repo.updateNextRunAsync(task.id, resultNextRun, runStart, status, errMsg);
          } catch (updateErr) {
            logger.warn(`[AgentScheduler] Could not update last_run_status for "${task.name}": ${String(updateErr)}`);
          }
          if (status === 'success') {
            logger.info(`[AgentScheduler] Task "${task.name}" completed. Session: ${result.sessionId}`);
          } else if (capacityDeferred) {
            logger.warn(`[AgentScheduler] Task "${task.name}" deferred for capacity. Retry: ${resultNextRun}`);
          } else {
            logger.error(`[AgentScheduler] Task "${task.name}" failed: ${errMsg}`);
          }
        }).catch((err) => {
          logger.error(`[AgentScheduler] AgentRunner.run threw for task "${task.name}": ${String(err)}`);
        });

        logger.info(`[AgentScheduler] Task "${task.name}" dispatched to AgentRunner. Next run: ${nextRun ?? 'none'}`);
      } else {
        // ── Production path: insert pending trigger ───────────────────────────
        await insertScheduledTrigger({
          id: task.id,
          prompt: task.prompt,
          agentConfigId: task.agentConfigId ?? task.agentKind,
          allowedMcpsJson: task.allowedMcpsJson,
          allowedSkillsJson: task.allowedSkillsJson,
          modelProvider: task.modelProvider,
          modelId: task.modelId,
        });

        // Compute next run time
        const nextRun = computeNextRun({
          scheduleType: task.scheduleType,
          scheduledTime: task.scheduledTime,
          scheduledDay: task.scheduledDay,
          cronExpression: task.cronExpression,
          runAt: task.runAt,
          timezone: task.timezone,
          after: new Date(),
        });

        await repo.updateNextRunAsync(task.id, nextRun, runStart, 'running');
        logger.info(`[AgentScheduler] Task "${task.name}" queued. Next run: ${nextRun ?? 'none'}`);
      }
    } catch (err) {
      const errMsg = String(err);
      logger.error(`[AgentScheduler] Failed to fire task "${task.name}" (${task.id}): ${errMsg}`);
      // Advance next_run by 5 minutes to prevent tight re-fire loop on error
      const backoffRun = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      try {
        await repo.updateNextRunAsync(task.id, backoffRun, runStart, 'error', errMsg);
      } catch { /* ignore secondary error */ }
    }
  }
}

export function startAgentSchedulerJob(): { stop: () => void } | null {
  // #1214 — a Postgres-backed deployment (hosted/cloud production, per
  // AGENTS.md "Production is Postgres") never OWNS agent-schedule ticking,
  // regardless of RHYTHM_ROLE/AGENT_LOCAL drift on that specific host. The
  // scheduler's only ownership signal used to be `env.agentLocal` inside
  // `checkDueTasks()` below, which decides EXECUTION MECHANISM (direct
  // AgentRunner.run() vs. inserting a pending trigger) — never whether
  // ticking should happen at all. A Postgres deployment could still
  // advance/fire its own independent `agent_scheduled_tasks` copy either
  // way — exactly how #1213/#1222's legacy 26-row, 100%-failure-rate
  // collection came to exist and keeps re-firing. `env.dbClient` (the same
  // signal `resetStaleRunning`/`reapStuckSessions` below already use) is the
  // correct, documented local-vs-hosted boundary: a Postgres-backed process
  // never advances or fires ANY due task. This is fully recoverable — no row
  // is deleted, disabled, or migrated by this gate; see
  // docs/release/hosted_deployment_synology_cloudflare.md "Scheduler
  // quarantine" for the operator backup/disable procedure.
  if (env.dbClient === 'postgres') {
    repo
      .listAllAsync()
      .then((tasks) => {
        const enabledCount = tasks.filter((t) => t.enabled).length;
        if (enabledCount > 0) {
          logger.warn(
            `[AgentScheduler] QUARANTINED (#1214): this is a Postgres-backed (non-owner) ` +
              `deployment with ${enabledCount} enabled agent_scheduled_tasks row(s) that will ` +
              `NEVER run or advance here. See ` +
              `docs/release/hosted_deployment_synology_cloudflare.md "Scheduler quarantine" ` +
              `for the backup/disable operator procedure.`,
          );
        }
      })
      .catch((err) => {
        logger.warn(`[AgentScheduler] quarantine diagnostic check failed (non-fatal): ${String(err)}`);
      });
    return null;
  }

  // #738-fix: Reset any agent_sessions left in status='running' from a prior
  // crash so they don't appear stuck in the CHATS list forever.
  // SQLite-only: agent_sessions lives on the local server. (The #1214 guard
  // above already returned for the Postgres/production path, so reaching
  // here means this IS the SQLite-backed owner — no redundant re-check.)
  try {
    const staleCount = new AgentSessionsRepository().resetStaleRunning(
      'Server restarted — run interrupted',
    );
    if (staleCount > 0) {
      logger.info(`[AgentScheduler] Reset ${staleCount} stale running session(s) to error on boot`);
    }
  } catch (err) {
    logger.warn(`[AgentScheduler] Could not reset stale running sessions: ${String(err)}`);
  }

  // Run once immediately on startup to catch any tasks that fired while the
  // server was down (Odysseus does the same with the "pushed next_run forward"
  // pattern on startup — here we simply let them fire immediately).
  // #1222 — on the local-execution path, wait (bounded) for the engine to
  // finish initializing first; see _waitForEngineReadyOnBoot above. The
  // trigger-insertion path (env.agentLocal === false) never touches the
  // engine, so it skips the wait entirely.
  void (async () => {
    if (env.agentLocal) {
      await _waitForEngineReadyOnBoot();
    }
    await checkDueTasks();
  })();

  // 1-minute tick — same granularity as Odysseus's asyncio loop
  const task = cron.schedule('* * * * *', () => {
    // #1039 Cause C — reap post-boot orphans each tick (SQLite/local only).
    // Cutoff = 2× the per-run timeout (min 20 min) so an in-flight run is never
    // killed; only rows idle past that bound (a dead mid-flight run) are freed.
    if (env.dbClient !== 'postgres') {
      try {
        const runTimeoutMs = Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 600_000);
        const cutoffMs = Math.max(runTimeoutMs * 2, 20 * 60 * 1000);
        const reaped = new AgentSessionsRepository().reapStuckSessions(cutoffMs);
        if (reaped > 0) {
          logger.info(`[AgentScheduler] Reaped ${reaped} stuck session(s) idle past ${cutoffMs}ms`);
        }
      } catch (err) {
        logger.warn(`[AgentScheduler] Could not reap stuck sessions: ${String(err)}`);
      }
    }
    void checkDueTasks();
  });

  logger.info('[AgentScheduler] Scheduler started (1-min tick)');
  return task;
}
