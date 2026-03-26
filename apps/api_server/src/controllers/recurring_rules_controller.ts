import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';

const repo = new RecurringTaskRulesRepository();

const VALID_FREQUENCIES = ['weekly', 'monthly', 'annual'] as const;

export class RecurringRulesController {
  getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAll());
    } catch (err) {
      next(err);
    }
  }

  getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findById(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, frequency, dayOfWeek, dayOfMonth, month } = req.body as Record<string, unknown>;

      if (!title || typeof title !== 'string') throw AppError.badRequest('title is required');
      if (!frequency || !VALID_FREQUENCIES.includes(frequency as never)) {
        throw AppError.badRequest('frequency must be weekly, monthly, or annual');
      }

      const rule = repo.create({
        title,
        frequency: frequency as 'weekly' | 'monthly' | 'annual',
        dayOfWeek: dayOfWeek as number ?? null,
        dayOfMonth: dayOfMonth as number ?? null,
        month: month as number ?? null,
      });
      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction) {
    try {
      const rule = repo.update(req.params.id, req.body as Record<string, unknown>);
      res.json(rule);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction) {
    try {
      repo.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
