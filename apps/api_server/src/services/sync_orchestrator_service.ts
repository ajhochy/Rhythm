import { IntegrationAccountsRepository } from "../repositories/integration_accounts_repository";
import { AutomationSignalsRepository } from "../repositories/automation_signals_repository";
import { TasksRepository } from "../repositories/tasks_repository";
import { AutomationEngineService } from "./automation_engine_service";
import { IntegrationsService } from "./integrations_service";
import { RhythmSignalGeneratorService } from "./rhythm_signal_generator_service";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import type { Task } from "../models/task";

// Page size for the production task mirror.  100 is a safe default that
// avoids oversized responses while being large enough to pull the entire
// task list in one round-trip for most workspaces.
const PROD_TASK_PAGE_SIZE = 100;

/**
 * Shape returned by the production `GET /tasks` endpoint.
 * We only read the subset of fields that `upsertExternalTaskAsync` needs.
 */
interface ProdTaskPayload {
  id: string;
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  scheduledDate?: string | null;
  scheduledOrder?: number | null;
  locked?: boolean;
  status?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  ownerId?: number | null;
  preferredAgent?: string | null;
}

/**
 * Fetches ALL tasks from the production API in pages of `PROD_TASK_PAGE_SIZE`.
 * Returns the raw array.  Throws if the HTTP call fails.
 */
async function fetchProductionTasks(
  prodApiUrl: string,
  prodAuthToken: string,
): Promise<ProdTaskPayload[]> {
  let page = 1;
  const all: ProdTaskPayload[] = [];

  while (true) {
    const url = `${prodApiUrl}/tasks?page=${page}&limit=${PROD_TASK_PAGE_SIZE}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${prodAuthToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(
        `GET ${url} → HTTP ${resp.status} ${resp.statusText}`,
      );
    }

    const body = (await resp.json()) as ProdTaskPayload[] | { data: ProdTaskPayload[] };

    // Some API versions wrap in { data: [...] }; handle both shapes.
    const page_tasks: ProdTaskPayload[] = Array.isArray(body)
      ? body
      : ((body as { data: ProdTaskPayload[] }).data ?? []);

    all.push(...page_tasks);

    // If the page returned fewer rows than the page size we've reached the end.
    if (page_tasks.length < PROD_TASK_PAGE_SIZE) break;
    page += 1;
  }

  return all;
}

export class SyncOrchestratorService {
  private readonly accountsRepo = new IntegrationAccountsRepository();
  private readonly signalsRepo = new AutomationSignalsRepository();
  private readonly tasksRepo = new TasksRepository();
  private readonly integrationsService = new IntegrationsService();
  private readonly rhythmGenerator = new RhythmSignalGeneratorService();
  private readonly automationEngine = new AutomationEngineService();

  async runSync(): Promise<void> {
    try {
      const rhythmSignals = [
        ...(await this.rhythmGenerator.generateTaskDueSignalsAsync()),
        ...(await this.rhythmGenerator.generateProjectStepDueSignalsAsync()),
      ];
      const { changedSignals } =
        await this.signalsRepo.upsertManyDetailedAsync(rhythmSignals);
      const evaluation = await this.automationEngine.evaluateSignals(
        "rhythm",
        changedSignals,
      );
      logger.info(
        `SyncOrchestrator: Rhythm signals generated ${rhythmSignals.length} signal(s), ${changedSignals.length} new/changed, matched ${evaluation.matchedRules} rule(s)`,
      );
    } catch (err) {
      logger.error(
        `SyncOrchestrator: Rhythm signal generation failed — ${String(err)}`,
      );
    }

    // -----------------------------------------------------------------------
    // Production task mirror (agent-local mode only)
    //
    // When PROD_API_URL and PROD_AUTH_TOKEN are set the orchestrator pulls
    // ALL tasks from the production server and upserts them into the local
    // SQLite so the agent session's "linked task" picker and FK lookups never
    // hit missing rows.
    //
    // Root cause documented in issue #620: previously there was NO mechanism
    // to pull tasks from api.vcrcapps.com into the local agent server's SQLite.
    // The local DB only had tasks written locally; any task created on
    // production after the server split was invisible to the agent server.
    // -----------------------------------------------------------------------
    await this.mirrorProductionTasksAsync();

    const accounts = await this.accountsRepo.findAllAsync();
    const ownerIds = new Set(
      accounts
        .map((account) => account.ownerId)
        .filter((ownerId): ownerId is number => ownerId != null),
    );

    for (const ownerId of ownerIds) {
      const gcal = await this.accountsRepo.findByProviderAsync(
        "google_calendar",
        ownerId,
      );
      if (gcal?.accessToken) {
        try {
          const result =
            await this.integrationsService.syncGoogleCalendar(ownerId);
          logger.info(
            `SyncOrchestrator: Google Calendar synced ${result.syncedCount} event(s) for user ${ownerId}`,
          );
        } catch (err) {
          logger.error(
            `SyncOrchestrator: Google Calendar sync failed for user ${ownerId} — ${String(err)}`,
          );
        }
      }

      const gmail = await this.accountsRepo.findByProviderAsync(
        "gmail",
        ownerId,
      );
      if (gmail?.accessToken) {
        try {
          const result = await this.integrationsService.syncGmail(ownerId);
          logger.info(
            `SyncOrchestrator: Gmail synced ${result.syncedCount} signal(s) for user ${ownerId}`,
          );
        } catch (err) {
          logger.error(
            `SyncOrchestrator: Gmail sync failed for user ${ownerId} — ${String(err)}`,
          );
        }
      }

      const pco = await this.accountsRepo.findByProviderAsync(
        "planning_center",
        ownerId,
      );
      if (pco?.accessToken) {
        try {
          const result =
            await this.integrationsService.syncPlanningCenter(ownerId);
          logger.info(
            `SyncOrchestrator: Planning Center synced ${result.planCount} plan(s) for user ${ownerId}`,
          );
        } catch (err) {
          logger.error(
            `SyncOrchestrator: Planning Center sync failed for user ${ownerId} — ${String(err)}`,
          );
        }
      }
    }
  }

  /**
   * Pull all tasks from the production API and upsert them into the local
   * SQLite.  No-ops when PROD_API_URL / PROD_AUTH_TOKEN are not configured.
   *
   * This method is intentionally tolerant of network failures — a failed
   * mirror cycle is logged as an error but does NOT abort the rest of the
   * sync cycle.
   *
   * Strategy: for tasks that came from the production server we use
   * `source_type='prod_mirror'` and `source_id=<prod task id>` so
   * `upsertExternalTaskAsync` can match on subsequent syncs.  The original
   * production task `id` is preserved as `source_id` so FK lookups
   * (`findByIdIncludingLegacy`) can locate the row by the production UUID.
   *
   * Special case: tasks whose `id` is already present verbatim in the local
   * DB (e.g. tasks created before the local/production split) are updated
   * in-place without changing their primary key.
   */
  async mirrorProductionTasksAsync(): Promise<{ upserted: number; skipped: number }> {
    const { prodApiUrl, prodAuthToken } = env;
    if (!prodApiUrl || !prodAuthToken) {
      logger.info(
        "SyncOrchestrator: PROD_API_URL or PROD_AUTH_TOKEN not set — skipping production task mirror",
      );
      return { upserted: 0, skipped: 0 };
    }

    let prodTasks: ProdTaskPayload[];
    try {
      prodTasks = await fetchProductionTasks(prodApiUrl, prodAuthToken);
    } catch (err) {
      logger.error(
        `SyncOrchestrator: Failed to fetch production tasks — ${String(err)}`,
      );
      return { upserted: 0, skipped: 0 };
    }

    let upserted = 0;
    let skipped = 0;

    for (const pt of prodTasks) {
      try {
        // First check: if the production task ID already exists verbatim in
        // the local DB (pre-split tasks), update it in-place.
        let existing: Task | null = null;
        try {
          existing = await this.tasksRepo.findByIdIncludingLegacyAsync(pt.id);
        } catch {
          // findByIdIncludingLegacy throws AppError.notFound when missing —
          // treat that as "not present".
          existing = null;
        }

        if (existing) {
          // Task exists with its original ID — update title/notes/dates so it
          // stays current but do NOT overwrite user-set status.
          if (existing.status !== "done") {
            await this.tasksRepo.updateAsync(pt.id, {
              title: pt.title,
              notes: pt.notes ?? null,
              dueDate: pt.dueDate ?? null,
              scheduledDate: pt.scheduledDate ?? null,
            });
          }
          upserted += 1;
          continue;
        }

        // Task does not exist by its original ID — upsert via the
        // prod_mirror source_type/source_id key so subsequent syncs are
        // idempotent.
        await this.tasksRepo.upsertExternalTaskAsync({
          title: pt.title,
          notes: pt.notes ?? null,
          dueDate: pt.dueDate ?? null,
          scheduledDate: pt.scheduledDate ?? null,
          scheduledOrder: pt.scheduledOrder ?? null,
          locked: pt.locked ?? false,
          status: (pt.status as Task["status"]) ?? "open",
          sourceType: "prod_mirror",
          sourceId: pt.id,
          ownerId: pt.ownerId ?? null,
          preferredAgent: pt.preferredAgent ?? null,
        });
        upserted += 1;
      } catch (err) {
        logger.warn(
          `SyncOrchestrator: Failed to upsert production task ${pt.id} — ${String(err)}`,
        );
        skipped += 1;
      }
    }

    logger.info(
      `SyncOrchestrator: Production task mirror complete — ${upserted} upserted, ${skipped} skipped (of ${prodTasks.length} fetched)`,
    );
    return { upserted, skipped };
  }
}
