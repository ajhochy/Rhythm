import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { RecurrenceService } from '../services/recurrence_service';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { v4 as uuidv4 } from 'uuid';
import type {
  RecurringTaskRule,
  RecurringTaskRuleProgress,
  RecurringTaskRuleStep,
} from '../models/recurring_task_rule';
import type { Task } from '../models/task';
import { NotificationsRepository } from '../repositories/notifications_repository';
import { NotificationService } from '../services/notification_service';

const repo = new RecurringTaskRulesRepository();
const notifService = new NotificationService(new NotificationsRepository());
const recurrenceService = new RecurrenceService();
const tasksRepo = new TasksRepository();
const usersRepo = new UsersRepository();

const DEFAULT_LOOKAHEAD_WEEKS = 8;

const VALID_FREQUENCIES = ['weekly', 'monthly', 'annual'] as const;

export class RecurringRulesController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        await this.decorateRules(
          await repo.findAllAsync(req.auth?.user.id),
          req.auth?.user.id,
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        await this.decorateRule(
          await repo.findByIdAsync(req.params.id, req.auth?.user.id),
          req.auth?.user.id,
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, frequency, dayOfWeek, dayOfMonth, month, steps, sequential } = req.body as Record<string, unknown>;

      if (!title || typeof title !== 'string') throw AppError.badRequest('title is required');
      if (!frequency || !VALID_FREQUENCIES.includes(frequency as never)) {
        throw AppError.badRequest('frequency must be weekly, monthly, or annual');
      }

      const rule = await repo.createAsync({
        title,
        frequency: frequency as 'weekly' | 'monthly' | 'annual',
        dayOfWeek: dayOfWeek as number ?? null,
        dayOfMonth: dayOfMonth as number ?? null,
        month: month as number ?? null,
        ownerId: req.auth?.user.id ?? null,
        steps: parseSteps(steps),
        sequential: sequential === true,
      });

      // Immediately generate task instances so they appear in the weekly planner
      const lookaheadWeeks = parseInt(process.env.RECURRENCE_LOOKAHEAD_WEEKS ?? '', 10);
      const weeks = isNaN(lookaheadWeeks) ? DEFAULT_LOOKAHEAD_WEEKS : lookaheadWeeks;
      const from = new Date();
      const to = new Date();
      to.setUTCDate(to.getUTCDate() + weeks * 7);
      await recurrenceService.generateInstances(rule, from, to);

      res.status(201).json(await this.decorateRule(rule, req.auth?.user.id));
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as Record<string, unknown>;
      const rule = await repo.updateAsync(req.params.id, body, req.auth?.user.id);
      await tasksRepo.deleteFutureOpenBySourceIdAsync('recurring_rule', rule.id);
      if (rule.enabled) {
        const weeks = parseInt(process.env.RECURRENCE_LOOKAHEAD_WEEKS ?? '', 10);
        const lookahead = isNaN(weeks) ? DEFAULT_LOOKAHEAD_WEEKS : weeks;
        const from = new Date();
        const to = new Date();
        to.setUTCDate(to.getUTCDate() + lookahead * 7);
        await recurrenceService.generateInstances(rule, from, to);
      }
      res.json(await this.decorateRule(rule, req.auth?.user.id));
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.deleteAsync(req.params.id, req.auth?.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async getCollaborators(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.listCollaboratorsAsync(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  async addCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = req.auth?.user.id;
      const rule = await repo.findByIdAsync(req.params.id);
      if (rule.ownerId !== actorId) throw AppError.forbidden('Only the rhythm owner can manage collaborators');
      const { userId } = req.body as Record<string, unknown>;
      if (!userId || typeof userId !== 'number') {
        throw AppError.badRequest('userId is required and must be a number');
      }
      await repo.addCollaboratorAsync(req.params.id, userId);
      if (actorId != null) {
        await notifService.notifyCollaboratorAddedAsync(
          'rhythm',
          req.params.id,
          rule.title,
          userId,
          actorId,
        );
      }
      res.json(await repo.listCollaboratorsAsync(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  async removeCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const rule = await repo.findByIdAsync(req.params.id);
      if (rule.ownerId !== req.auth?.user.id) throw AppError.forbidden('Only the rhythm owner can manage collaborators');
      const collaboratorUserId = Number(req.params.userId);
      if (isNaN(collaboratorUserId)) {
        throw AppError.badRequest('Invalid userId');
      }
      await repo.removeCollaboratorAsync(req.params.id, collaboratorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  private async decorateRules(
    rules: RecurringTaskRule[],
    currentUserId?: number,
  ) {
    return Promise.all(
      rules.map((rule) => this.decorateRule(rule, currentUserId)),
    );
  }

  private async decorateRule(rule: RecurringTaskRule, currentUserId?: number) {
    const [visibleTasks, users, collaborators] = await Promise.all([
      tasksRepo.findAllAsync(),
      usersRepo.findAllAsync(),
      repo.listCollaboratorsAsync(rule.id),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const matchingTasks = visibleTasks.filter((task) => this.matchesRule(task, rule.id));
    const orderedTasks = [...matchingTasks].sort((a, b) => {
      const aOrder = this.taskOrder(a);
      const bOrder = this.taskOrder(b);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.title.localeCompare(b.title);
    });
    const completedCount = orderedTasks.filter((task) => task.status === 'done').length;
    const remainingTasks = orderedTasks.filter((task) => task.status !== 'done');
    const personalRemainingCount = currentUserId == null
      ? remainingTasks.length
      : remainingTasks.filter((task) => task.ownerId === currentUserId).length;
    const waitingTask = remainingTasks.find((task) => {
      if (currentUserId == null) return task.ownerId != null;
      return task.ownerId != null && task.ownerId !== currentUserId;
    });

    const progress: RecurringTaskRuleProgress = {
      totalCount: orderedTasks.length,
      completedCount,
      remainingCount: remainingTasks.length,
      personalRemainingCount,
      waitingOnUserId: waitingTask?.ownerId ?? null,
      waitingOnUserName: waitingTask?.ownerId != null
        ? usersById.get(waitingTask.ownerId)?.name ?? null
        : null,
      nextDueDate: remainingTasks.find((task) => task.dueDate != null)?.dueDate ?? null,
      completionRatio: orderedTasks.length === 0 ? 0 : completedCount / orderedTasks.length,
    };

    return {
      ...rule,
      steps: rule.steps.map((step) => this.decorateStep(step, usersById)),
      collaborators,
      progress,
    };
  }

  private decorateStep(step: RecurringTaskRuleStep, usersById: Map<number, { name: string }>) {
    return {
      ...step,
      assigneeName: step.assigneeId != null ? usersById.get(step.assigneeId)?.name ?? null : null,
    };
  }

  private matchesRule(task: Task, ruleId: string): boolean {
    if (task.sourceType !== 'recurring_rule' || task.sourceId == null) return false;
    return task.sourceId === ruleId || task.sourceId.startsWith(`${ruleId}:`);
  }

  private taskOrder(task: Task): number {
    if (task.scheduledOrder != null) return task.scheduledOrder;
    if (task.dueDate != null) {
      const date = Date.parse(task.dueDate);
      if (!Number.isNaN(date)) return date;
    }
    return Date.parse(task.createdAt) || 0;
  }
}

function parseSteps(raw: unknown): RecurringTaskRuleStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((step, index) => normalizeStep(step, index))
    .filter((step): step is RecurringTaskRuleStep => step != null);
}

function normalizeStep(step: unknown, index: number): RecurringTaskRuleStep | null {
  if (step == null || typeof step !== 'object') return null;
  const record = step as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!title) return null;
  const id =
    typeof record.id === 'string' && record.id.trim().length > 0
      ? record.id.trim()
      : `step-${index + 1}-${uuidv4()}`;
  const assigneeId =
    typeof record.assigneeId === 'number'
      ? record.assigneeId
      : typeof record.assigneeId === 'string' && record.assigneeId.trim() !== ''
        ? Number(record.assigneeId)
        : null;
  return {
    id,
    title,
    assigneeId: Number.isFinite(assigneeId as number) ? (assigneeId as number) : null,
  };
}
