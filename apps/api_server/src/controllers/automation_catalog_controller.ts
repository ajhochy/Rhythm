import type { NextFunction, Request, Response } from 'express';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { AutomationCatalogService } from '../services/automation_catalog_service';

const service = new AutomationCatalogService();
const accountsRepo = new IntegrationAccountsRepository();

export class AutomationCatalogController {
  async getTriggers(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        service.getTriggersForAccounts(await accountsRepo.findAllAsync()),
      );
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

  async getProviders(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        service.getProvidersForAccounts(await accountsRepo.findAllAsync()),
      );
    } catch (err) {
      next(err);
    }
  }
}
