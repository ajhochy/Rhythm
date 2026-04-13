import { IntegrationAccountsRepository } from "../repositories/integration_accounts_repository";
import { AutomationSignalsRepository } from "../repositories/automation_signals_repository";
import { AutomationEngineService } from "./automation_engine_service";
import { IntegrationsService } from "./integrations_service";
import { RhythmSignalGeneratorService } from "./rhythm_signal_generator_service";
import { logger } from "../utils/logger";

export class SyncOrchestratorService {
  private readonly accountsRepo = new IntegrationAccountsRepository();
  private readonly signalsRepo = new AutomationSignalsRepository();
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
}
