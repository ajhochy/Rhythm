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

import cron, { type ScheduledTask as CronTask } from 'node-cron';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import * as AgentRunner from './agent_runner';

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
      // Use node-cron's next() method to compute the next fire time.
      // node-cron doesn't expose a standalone "next()" but we can use the
      // cron-parser library if available, or fall back to a minute-increment scan.
      return _computeNextCron(cronExpression, afterDate);
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

/**
 * Compute next cron fire time by advancing minute-by-minute.
 * This is a simple but correct fallback that doesn't require cron-parser.
 * Scans up to 1 year ahead; returns null if no match found.
 */
function _computeNextCron(expression: string, after: Date): string | null {
  // Fast path: use node-cron's internal validation + brute-force scan
  // Advance in 1-minute steps up to 366 days = ~527,040 iterations (worst case)
  // This is acceptable for a scheduled background job.
  const MAX_ITERATIONS = 527_040;
  let candidate = new Date(after.getTime() + 60_000); // start 1 minute ahead
  candidate.setSeconds(0, 0);

  // Parse the 5-field cron expression
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minPart, hourPart, domPart, monPart, dowPart] = parts;

  const matchField = (value: number, field: string, min: number, max: number): boolean => {
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
    const m = candidate.getUTCMinutes();
    const h = candidate.getUTCHours();
    const dom = candidate.getUTCDate();
    const mon = candidate.getUTCMonth() + 1;
    const dow = candidate.getUTCDay();

    if (
      matchField(m, minPart, 0, 59) &&
      matchField(h, hourPart, 0, 23) &&
      matchField(dom, domPart, 1, 31) &&
      matchField(mon, monPart, 1, 12) &&
      matchField(dow, dowPart, 0, 7) // 0 and 7 are both Sunday
    ) {
      return candidate.toISOString();
    }

    candidate = new Date(candidate.getTime() + 60_000);
  }

  return null;
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
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
}): Promise<void> {
  const now = new Date().toISOString();

  if (env.dbClient === 'postgres') {
    // ON CONFLICT on (task_id) only applies when task_id IS NOT NULL.
    // For scheduler triggers, task_id IS NULL so there's no uniqueness constraint.
    await getPostgresPool().query(
      `INSERT INTO pending_claude_triggers
         (task_id, triggered_by_user_id, scheduled_task_id, prompt,
          allowed_mcps_json, allowed_skills_json, created_at)
       VALUES (NULL, NULL, $1, $2, $3, $4, $5)`,
      [task.id, task.prompt, task.allowedMcpsJson, task.allowedSkillsJson, now],
    );
    return;
  }

  getDb().prepare(`
    INSERT INTO pending_claude_triggers
      (task_id, triggered_by_user_id, scheduled_task_id, prompt,
       allowed_mcps_json, allowed_skills_json, created_at)
    VALUES (NULL, NULL, ?, ?, ?, ?, ?)
  `).run(task.id, task.prompt, task.allowedMcpsJson, task.allowedSkillsJson, now);
}

// ── Scheduler loop ────────────────────────────────────────────────────────

const repo = new AgentScheduledTasksRepository();

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
          allowedMcpsJson: task.allowedMcpsJson,
          taskId: null,
          outputTarget: 'session',
          agentKind: task.agentKind ?? 'claude-code',
          scheduledTaskId: task.id,
          sessionName: `Scheduled: ${task.name}`,
        }).then(async (result) => {
          const status = result.status === 'done' ? 'success' : 'error';
          const errMsg = result.error ?? undefined;
          try {
            await repo.updateNextRunAsync(task.id, nextRun, runStart, status, errMsg);
          } catch (updateErr) {
            logger.warn(`[AgentScheduler] Could not update last_run_status for "${task.name}": ${String(updateErr)}`);
          }
          if (status === 'success') {
            logger.info(`[AgentScheduler] Task "${task.name}" completed. Session: ${result.sessionId}`);
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
          allowedMcpsJson: task.allowedMcpsJson,
          allowedSkillsJson: task.allowedSkillsJson,
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

export function startAgentSchedulerJob(): CronTask {
  // #738-fix: Reset any agent_sessions left in status='running' from a prior
  // crash so they don't appear stuck in the CHATS list forever.
  // SQLite-only: agent_sessions lives on the local server; Postgres path is
  // production and does not have this table.
  if (env.dbClient !== 'postgres') {
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
  }

  // Run once immediately on startup to catch any tasks that fired while the
  // server was down (Odysseus does the same with the "pushed next_run forward"
  // pattern on startup — here we simply let them fire immediately).
  void checkDueTasks();

  // 1-minute tick — same granularity as Odysseus's asyncio loop
  const task = cron.schedule('* * * * *', () => {
    void checkDueTasks();
  });

  logger.info('[AgentScheduler] Scheduler started (1-min tick)');
  return task;
}
