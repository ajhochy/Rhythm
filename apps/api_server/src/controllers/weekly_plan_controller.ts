import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import type { AutomationSignal } from '../models/automation_signal';
import { TasksRepository } from '../repositories/tasks_repository';
import { AutomationEngineService } from '../services/automation_engine_service';
import { WeeklyPlanningService, currentWeekLabel } from '../services/weekly_planning_service';

export class WeeklyPlanController {
  private readonly service = new WeeklyPlanningService();
  private readonly tasksRepo = new TasksRepository();
  private readonly automationEngine = new AutomationEngineService();

  getPlan(req: Request, res: Response, next: NextFunction): void {
    try {
      const weekLabel = (req.query.week as string | undefined) ?? currentWeekLabel();
      if (!/^\d{4}-W\d{1,2}$/.test(weekLabel)) {
        throw AppError.badRequest('Invalid week format. Use YYYY-WNN (e.g. 2026-W13).');
      }
      const plan = this.service.assemblePlan(weekLabel, req.auth?.user.id);
      const now = new Date().toISOString();
      const assemblySignal: AutomationSignal = {
        id: `rhythm:plan_assembly:${weekLabel}`,
        provider: 'rhythm',
        signalType: 'plan_assembly',
        externalId: weekLabel,
        dedupeKey: `rhythm:plan_assembly:${weekLabel}`,
        occurredAt: now,
        syncedAt: now,
        sourceAccountId: null,
        sourceLabel: 'Rhythm',
        payload: { weekLabel, taskCount: plan.tasks?.length ?? 0 },
        createdAt: now,
        updatedAt: now,
      };
      this.automationEngine.evaluateSignals('rhythm', [assemblySignal]);
      res.json(plan);
    } catch (err) {
      next(err);
    }
  }

  scheduleTask(req: Request, res: Response, next: NextFunction): void {
    try {
      const { id } = req.params;
      const { scheduledDate, locked } = req.body as { scheduledDate?: string; locked?: boolean };
      const updated = this.tasksRepo.update(id, { scheduledDate, locked }, req.auth?.user.id);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
}
