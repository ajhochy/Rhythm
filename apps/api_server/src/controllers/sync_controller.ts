import type { Request, Response, NextFunction } from 'express';
import { SyncOrchestratorService } from '../services/sync_orchestrator_service';
import { logger } from '../utils/logger';

const orchestrator = new SyncOrchestratorService();

/**
 * POST /sync/now
 *
 * Triggers an immediate, full sync cycle (including the production task
 * mirror) without waiting for the next cron tick.
 *
 * Intended for use by the Flutter client when the user needs up-to-date task
 * data immediately — e.g. right after opening the "New agent session" dialog
 * where the task picker reads from production but agent sessions link to the
 * local SQLite mirror.
 *
 * The endpoint is authenticated via the standard AGENT_LOCAL bypass or a
 * valid session token, same as all other agent-local endpoints.
 *
 * Response shape: { status: 'ok', upserted: number, skipped: number }
 */
export async function triggerSyncNow(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    logger.info('SyncOrchestrator: manual /sync/now triggered');
    // Run the full sync cycle (rhythm signals + integrations).
    // We also surface the production task mirror result for the caller.
    const mirrorResult = await orchestrator.mirrorProductionTasksAsync();
    // Fire the rest of the sync cycle in the background — it includes
    // Google Calendar, Gmail, and PCO.  We don't await it to keep the
    // HTTP response fast.
    void orchestrator.runSync();
    res.json({ status: 'ok', ...mirrorResult });
  } catch (err) {
    next(err);
  }
}
