import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { RecurrenceService } from '../services/recurrence_service';
import { TasksRepository } from '../repositories/tasks_repository';

const repo = new RecurringTaskRulesRepository();
const recurrenceService = new RecurrenceService();

const DEFAULT_LOOKAHEAD_WEEKS = 8;

const VALID_FREQUENCIES = ['weekly', 'monthly', 'annual'] as const;

export class RecurringRulesController {
  getAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAll(req.auth?.user.id));
    } catch (err) {
      next(err);
    }
  }

  getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findById(req.params.id, req.auth?.user.id));
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
        ownerId: req.auth?.user.id ?? null,
      });

      // Immediately generate task instances so they appear in the weekly planner
      const lookaheadWeeks = parseInt(process.env.RECURRENCE_LOOKAHEAD_WEEKS ?? '', 10);
      const weeks = isNaN(lookaheadWeeks) ? DEFAULT_LOOKAHEAD_WEEKS : lookaheadWeeks;
      const from = new Date();
      const to = new Date();
      to.setUTCDate(to.getUTCDate() + weeks * 7);
      recurrenceService.generateInstances(rule, from, to);

      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as Record<string, unknown>;
      const rule = repo.update(req.params.id, body, req.auth?.user.id);
      if (body.enabled === false) {
        new TasksRepository().deleteFutureOpenBySourceId('recurring_rule', rule.id);
      } else if (body.enabled === true) {
        const weeks = parseInt(process.env.RECURRENCE_LOOKAHEAD_WEEKS ?? '', 10);
        const lookahead = isNaN(weeks) ? DEFAULT_LOOKAHEAD_WEEKS : weeks;
        const from = new Date();
        const to = new Date();
        to.setUTCDate(to.getUTCDate() + lookahead * 7);
        recurrenceService.generateInstances(rule, from, to);
      }
      res.json(rule);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction) {
    try {
      repo.delete(req.params.id, req.auth?.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
