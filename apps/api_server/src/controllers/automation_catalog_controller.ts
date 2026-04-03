import type { NextFunction, Request, Response } from 'express';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { AutomationCatalogService } from '../services/automation_catalog_service';

const service = new AutomationCatalogService();
const accountsRepo = new IntegrationAccountsRepository();

export class AutomationCatalogController {
  getTriggers(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(service.getTriggersForAccounts(accountsRepo.findAll()));
    } catch (err) {
      next(err);
    }
  }

  getActions(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(service.getActions());
    } catch (err) {
      next(err);
    }
  }

  getProviders(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(service.getProvidersForAccounts(accountsRepo.findAll()));
    } catch (err) {
      next(err);
    }
  }
}
