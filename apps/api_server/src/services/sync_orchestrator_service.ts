import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { IntegrationsService } from './integrations_service';
import { logger } from '../utils/logger';

export class SyncOrchestratorService {
  private readonly accountsRepo = new IntegrationAccountsRepository();
  private readonly integrationsService = new IntegrationsService();

  async runSync(): Promise<void> {
    const gcal = this.accountsRepo.findByProvider('google_calendar');
    if (gcal?.accessToken) {
      try {
        const result = await this.integrationsService.syncGoogleCalendar();
        logger.info(
          `SyncOrchestrator: Google Calendar synced ${result.syncedCount} event(s)`,
        );
      } catch (err) {
        logger.error(
          `SyncOrchestrator: Google Calendar sync failed — ${String(err)}`,
        );
      }
    }

    const gmail = this.accountsRepo.findByProvider('gmail');
    if (gmail?.accessToken) {
      try {
        const result = await this.integrationsService.syncGmail();
        logger.info(
          `SyncOrchestrator: Gmail synced ${result.syncedCount} signal(s)`,
        );
      } catch (err) {
        logger.error(`SyncOrchestrator: Gmail sync failed — ${String(err)}`);
      }
    }

    const pco = this.accountsRepo.findByProvider('planning_center');
    if (pco?.accessToken) {
      try {
        const result = await this.integrationsService.syncPlanningCenter();
        logger.info(
          `SyncOrchestrator: Planning Center synced — ${result.taskSignalCount} task signal(s), ${result.executedActionCount} action(s) executed`,
        );
      } catch (err) {
        logger.error(
          `SyncOrchestrator: Planning Center sync failed — ${String(err)}`,
        );
      }
    }
  }
}
