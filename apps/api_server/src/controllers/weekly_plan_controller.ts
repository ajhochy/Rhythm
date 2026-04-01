import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { TasksRepository } from '../repositories/tasks_repository';
import { WeeklyPlanningService, currentWeekLabel } from '../services/weekly_planning_service';

const service = new WeeklyPlanningService();
const tasksRepo = new TasksRepository();

export function getPlan(req: Request, res: Response, next: NextFunction): void {
  try {
    const weekLabel = (req.query.week as string | undefined) ?? currentWeekLabel();
    if (!/^\d{4}-W\d{1,2}$/.test(weekLabel)) {
      throw AppError.badRequest('Invalid week format. Use YYYY-WNN (e.g. 2026-W13).');
    }
    const plan = service.assemblePlan(weekLabel, req.auth?.user.id);
    res.json(plan);
  } catch (err) {
    next(err);
  }
}

export function scheduleTask(req: Request, res: Response, next: NextFunction): void {
  try {
    const { id } = req.params;
    const { scheduledDate, locked } = req.body as { scheduledDate?: string; locked?: boolean };
    const updated = tasksRepo.update(id, { scheduledDate, locked }, req.auth?.user.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}
