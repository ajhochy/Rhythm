import type { NextFunction, Request, Response } from 'express';
import { AutomationCatalogService } from '../services/automation_catalog_service';

const service = new AutomationCatalogService();

export class AutomationCatalogController {
  getTriggers(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(service.getTriggers());
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
      res.json(service.getProviders());
    } catch (err) {
      next(err);
    }
  }
}
