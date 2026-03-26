import type { NextFunction, Request, Response } from 'express';
import type {
  IntegrationAccount,
  IntegrationProvider,
} from '../models/integration_account';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { IntegrationsService } from '../services/integrations_service';

const repo = new IntegrationAccountsRepository();
const service = new IntegrationsService();

function toAccountDto(
  provider: IntegrationProvider,
  account: IntegrationAccount | null,
) {
  if (!account) {
    return {
      id: provider,
      provider,
      email: null,
      displayName: null,
      status: 'error',
      expiresAt: null,
      lastSyncedAt: null,
      errorMessage: null,
    };
  }

  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    expiresAt: account.expiresAt,
    lastSyncedAt: account.lastSyncedAt,
    errorMessage: account.errorMessage,
  };
}

export class IntegrationsController {
  getAccounts(_req: Request, res: Response, next: NextFunction) {
    try {
      const existing = repo.findAll();
      const byProvider = new Map(existing.map((account) => [account.provider, account]));

      res.json([
        toAccountDto('google_calendar', byProvider.get('google_calendar') ?? null),
        toAccountDto('gmail', byProvider.get('gmail') ?? null),
        toAccountDto('planning_center', byProvider.get('planning_center') ?? null),
      ]);
    } catch (err) {
      next(err);
    }
  }

  async syncGoogleCalendar(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await service.syncGoogleCalendar());
    } catch (err) {
      next(err);
    }
  }

  async syncGmail(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await service.syncGmail());
    } catch (err) {
      next(err);
    }
  }

  getGmailSignals(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(service.listRecentGmailSignals());
    } catch (err) {
      next(err);
    }
  }

  async syncPlanningCenter(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await service.syncPlanningCenter());
    } catch (err) {
      next(err);
    }
  }

  getPlanningCenterTaskPreferences(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      res.json(service.getPlanningCenterTaskPreferences());
    } catch (err) {
      next(err);
    }
  }

  savePlanningCenterTaskPreferences(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { teamIds, positionNames } = req.body as Record<
        string,
        unknown
      >;
      res.json(
        service.savePlanningCenterTaskPreferences({
          teamIds: Array.isArray(teamIds)
            ? teamIds.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
          positionNames: Array.isArray(positionNames)
            ? positionNames.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        }),
      );
    } catch (err) {
      next(err);
    }
  }

  async getPlanningCenterTaskOptions(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      res.json(await service.getPlanningCenterTaskOptions());
    } catch (err) {
      next(err);
    }
  }
}
