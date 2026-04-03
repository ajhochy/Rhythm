import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { IntegrationsService } from './integrations_service';
import { logger } from '../utils/logger';

export class SyncOrchestratorService {
  private readonly accountsRepo = new IntegrationAccountsRepository();
  private readonly integrationsService = new IntegrationsService();

  async runSync(): Promise<void> {
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
    }
  }
}
