/**
 * Memory-Vault mirror-sync job (Issue #770, Work Item 6).
 *
 * Periodically mirrors the dedicated Obsidian "Memory-Vault" into the
 * agent_memory table so the Rhythm Brain panel (AgentMemoryView) reflects the
 * canonical vault contents. Follows the same cron-job shape as
 * recurrence_generation_job.ts.
 *
 * A missing vault path is a no-op inside syncMemoryVault — the job logs and
 * returns rather than erroring, so it is safe to register unconditionally.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { syncMemoryVault } from '../services/memoryVaultSyncService';
import { env } from '../config/env';
import { logger } from '../utils/logger';

async function runSync(): Promise<void> {
  try {
    const result = await syncMemoryVault();
    if (result.scanned === 0 && result.upserted === 0 && result.deleted === 0) {
      // Quiet path: vault missing or empty — already logged at info inside the
      // service. Nothing further to report.
      return;
    }
    logger.info(
      `MemoryVaultSyncJob: scanned ${result.scanned}, upserted ${result.upserted}, deleted ${result.deleted}`,
    );
  } catch (err) {
    logger.error(`MemoryVaultSyncJob error: ${String(err)}`);
  }
}

export function startMemoryVaultSyncJob(): ScheduledTask {
  // Run once immediately on startup so the Brain panel is populated without
  // waiting for the first cron tick.
  void runSync();

  const schedule = env.memoryVaultSyncCron;
  const task = cron.schedule(schedule, () => {
    void runSync();
  });

  logger.info(
    `MemoryVaultSyncJob: scheduled with cron "${schedule}" (vault: ${env.memoryVaultPath})`,
  );
  return task;
}
