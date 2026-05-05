/**
 * agent_session_reaper_job.ts
 *
 * Daily cron job that:
 *   1. Marks as "closed" any DB rows whose status indicates an active session
 *      but whose PTY process is no longer alive (orphaned after a server restart).
 *   2. Prunes closed sessions (and their cascade-deleted messages) that are
 *      older than the configurable retention window.
 *
 * Both the cron schedule and the retention period are env-tunable:
 *   AGENT_REAPER_CRON            — cron expression (default: "0 4 * * *", daily 4am)
 *   AGENT_REAPER_RETENTION_DAYS  — integer days to keep closed sessions (default: 30)
 */

import cron from 'node-cron';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { isAlive } from '../services/pty_runner';
import { logger } from '../utils/logger';

// ─── Config helpers ───────────────────────────────────────────────────────────

const DEFAULT_CRON = '0 4 * * *'; // daily 4am
const DEFAULT_RETENTION_DAYS = 30;

function getCron(): string {
  return process.env.AGENT_REAPER_CRON ?? DEFAULT_CRON;
}

function getRetentionDays(): number {
  const n = parseInt(process.env.AGENT_REAPER_RETENTION_DAYS ?? '', 10);
  return isNaN(n) ? DEFAULT_RETENTION_DAYS : n;
}

// ─── Reap logic ───────────────────────────────────────────────────────────────

async function reap(): Promise<void> {
  try {
    const repo = new AgentSessionsRepository();

    // 1. Close orphaned sessions: active in DB but no live PTY.
    const active = repo.listActive();
    let closed = 0;
    for (const s of active) {
      if (!isAlive(s.id)) {
        repo.markClosed(s.id);
        closed++;
      }
    }

    // 2. Prune old closed sessions (messages cascade-deleted via FK).
    const cutoff = new Date(Date.now() - getRetentionDays() * 86_400_000).toISOString();
    const pruned = repo.deleteOlderThan(cutoff);

    if (closed > 0 || pruned > 0) {
      logger.info(
        `AgentReaperJob: closed ${closed} orphaned, pruned ${pruned} old sessions`,
      );
    }
  } catch (err) {
    logger.error(`AgentReaperJob error: ${String(err)}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startAgentSessionReaperJob(): void {
  // Run immediately so orphans from a previous server crash are cleaned up fast.
  void reap();

  const schedule = getCron();
  cron.schedule(schedule, () => {
    void reap();
  });

  logger.info(
    `AgentReaperJob: scheduled "${schedule}", retention ${getRetentionDays()} days`,
  );
}
