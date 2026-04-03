import type { NextFunction, Request, Response } from 'express';
import type {
  IntegrationAccount,
  IntegrationProvider,
} from '../models/integration_account';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { AutomationCatalogService } from '../services/automation_catalog_service';
import { IntegrationsService } from '../services/integrations_service';

const repo = new IntegrationAccountsRepository();
const service = new IntegrationsService();
const catalog = new AutomationCatalogService();

function toAccountDto(
  provider: IntegrationProvider,
  account: IntegrationAccount | null,
) {
  const providerMeta = catalog
    .getProviders()
    .find((item) => item.source === provider);
  if (!account) {
    return {
      id: provider,
      provider,
      providerDisplayName: providerMeta?.label ?? provider,
      accountLabel: null,
      email: null,
      displayName: null,
      status: 'disconnected',
      expiresAt: null,
      lastSyncedAt: null,
      errorMessage: null,
      scope: null,
      availableTriggerFamilies: providerMeta?.triggerKeys ?? [],
      syncSupportMode: providerMeta?.syncSupport ?? 'manual',
    };
  }

  return {
    id: account.id,
    provider: account.provider,
    providerDisplayName: providerMeta?.label ?? account.provider,
    accountLabel: account.displayName ?? account.email,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    expiresAt: account.expiresAt,
    lastSyncedAt: account.lastSyncedAt,
    errorMessage: account.errorMessage,
    scope: account.scope,
    availableTriggerFamilies: providerMeta?.triggerKeys ?? [],
    syncSupportMode: providerMeta?.syncSupport ?? 'manual',
  };
}

export class IntegrationsController {
  getAccounts(req: Request, res: Response, next: NextFunction) {
    try {
      const existing = repo.findAll(req.auth!.user.id);
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

  async syncGoogleCalendar(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await service.syncGoogleCalendar(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async syncGmail(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await service.syncGmail(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  getGmailSignals(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(service.listRecentGmailSignals(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async getGmailLabels(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await service.listGmailLabels(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async syncPlanningCenter(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await service.syncPlanningCenter(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async syncAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await service.syncAll(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  getPlanningCenterTaskPreferences(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      res.json(service.getPlanningCenterTaskPreferences(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async getGoogleCalendarSettings(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      res.json(await service.getGoogleCalendarSettings(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  saveGoogleCalendarPreferences(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { selectedCalendarIds } = req.body as Record<string, unknown>;
      res.json(
        service.saveGoogleCalendarPreferences(req.auth!.user.id, {
          selectedCalendarIds: Array.isArray(selectedCalendarIds)
            ? selectedCalendarIds.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        }),
      );
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
        service.savePlanningCenterTaskPreferences(req.auth!.user.id, {
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
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      res.json(await service.getPlanningCenterTaskOptions(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }
}
