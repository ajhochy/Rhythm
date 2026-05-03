import type { NextFunction, Request, Response } from 'express';
import { DashboardSummaryService } from '../services/dashboard_summary_service';

const service = new DashboardSummaryService();

export class DashboardController {
  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await service.getSummaryAsync(req.auth!.user.id);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  }
}
