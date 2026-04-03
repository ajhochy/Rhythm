import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { AutomationEngineService } from './automation_engine_service';
import { IntegrationsService } from './integrations_service';
import { RhythmSignalGeneratorService } from './rhythm_signal_generator_service';
import { logger } from '../utils/logger';

export class SyncOrchestratorService {
  private readonly accountsRepo = new IntegrationAccountsRepository();
  private readonly integrationsService = new IntegrationsService();
  private readonly rhythmGenerator = new RhythmSignalGeneratorService();
  private readonly automationEngine = new AutomationEngineService();

  async runSync(): Promise<void> {
    try {
      const rhythmSignals = [
        ...this.rhythmGenerator.generateTaskDueSignals(),
        ...this.rhythmGenerator.generateProjectStepDueSignals(),
      ];
      const evaluation = this.automationEngine.evaluateSignals('rhythm', rhythmSignals);
      logger.info(
        `SyncOrchestrator: Rhythm signals generated ${rhythmSignals.length} signal(s), matched ${evaluation.matchedRules} rule(s)`,
      );
    } catch (err) {
      logger.error(`SyncOrchestrator: Rhythm signal generation failed — ${String(err)}`);
    }

    const accounts = this.accountsRepo.findAll();
    const ownerIds = new Set(
      accounts
        .map((account) => account.ownerId)
        .filter((ownerId): ownerId is number => ownerId != null),
    );

    for (const ownerId of ownerIds) {
      const gcal = this.accountsRepo.findByProvider('google_calendar', ownerId);
      if (gcal?.accessToken) {
        try {
          const result = await this.integrationsService.syncGoogleCalendar(ownerId);
          logger.info(
            `SyncOrchestrator: Google Calendar synced ${result.syncedCount} event(s) for user ${ownerId}`,
          );
        } catch (err) {
          logger.error(
            `SyncOrchestrator: Google Calendar sync failed for user ${ownerId} — ${String(err)}`,
          );
        }
      }

      const gmail = this.accountsRepo.findByProvider('gmail', ownerId);
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

      const pco = this.accountsRepo.findByProvider('planning_center', ownerId);
      if (pco?.accessToken) {
        try {
          const result = await this.integrationsService.syncPlanningCenter(ownerId);
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
