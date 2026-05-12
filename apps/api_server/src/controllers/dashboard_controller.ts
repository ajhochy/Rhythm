import type { NextFunction, Request, Response } from 'express';
import { DashboardSummaryService } from '../services/dashboard_summary_service';

const service = new DashboardSummaryService();

export class DashboardController {
  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.auth!.user;
      const summary = await service.getSummaryAsync(user.id, user.timezone);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  }
}
