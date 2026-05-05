import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { TasksRepository } from '../repositories/tasks_repository';
import { NotificationsRepository } from '../repositories/notifications_repository';
import { NotificationService } from '../services/notification_service';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { ClaudeTriggersRepository } from '../repositories/claude_triggers_repository';
import { env } from '../config/env';
import { EmailService } from '../services/email_service';
import { UsersRepository } from '../repositories/users_repository';
import { emitAppEvent } from '../utils/app_events';

const VALID_STATUSES = ['open', 'in_progress', 'waiting_for_reply', 'done'] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

const repo = new TasksRepository();
const rulesRepo = new RecurringTaskRulesRepository();
const notifService = new NotificationService(new NotificationsRepository());
const claudeTriggersRepo = new ClaudeTriggersRepository();
const usersRepo = new UsersRepository();
const emailService = new EmailService(usersRepo);

export class TasksController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findAllAsync(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findByIdAsync(req.params.id, req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, notes, dueDate, status } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }
      if (status !== undefined && !VALID_STATUSES.includes(status as ValidStatus)) {
        throw AppError.badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      const task = await repo.createAsync({
        title,
        notes: (notes as string) ?? null,
        dueDate: (dueDate as string) ?? null,
        status: status as ValidStatus,
        ownerId: req.auth!.user.id,
      });
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = req.auth!.user.id;
      const data = req.body as Record<string, unknown>;

      if (data.status !== undefined && !VALID_STATUSES.includes(data.status as ValidStatus)) {
        throw AppError.badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
      }

      const existing = await repo.findByIdAsync(req.params.id, actorId);
      const updated = await repo.updateAsync(
        req.params.id,
        data,
        actorId,
      );

      // Notify on assignment
      if (
        data.ownerId !== undefined &&
        updated.ownerId != null &&
        updated.ownerId !== existing.ownerId &&
        actorId != null
      ) {
        await notifService.notifyTaskAssignedAsync(
          updated.id,
          updated.title,
          updated.ownerId,
          actorId,
        );
        const actor = await usersRepo.findByIdAsync(actorId).catch(() => null);
        if (actor) {
          await emailService.sendTaskAssignedEmailAsync(
            updated.id,
            updated.title,
            actor.name,
            updated.ownerId,
            actorId,
          );
        }
      }

      // Notify collaborators on task completion
      if (
        data.status === 'done' &&
        existing.status !== 'done' &&
        actorId != null
      ) {
        const collaborators = await repo.listCollaboratorsAsync(updated.id);
        const collaboratorIds = collaborators.map((c) => c.userId);
        if (updated.ownerId != null && !collaboratorIds.includes(updated.ownerId)) {
          collaboratorIds.push(updated.ownerId);
        }
        if (collaboratorIds.length > 0) {
          await notifService.notifyStepCompletedAsync(
            'task',
            updated.id,
            updated.title,
            updated.title,
            collaboratorIds,
            actorId,
          );
        }

        // Sequential rhythm: unlock next step and notify its assignee
        await maybeUnlockNextSequentialStep(updated.sourceType, updated.sourceId, updated.dueDate);
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = req.auth!.user.id;
      const task = await repo.findByIdAsync(req.params.id, actorId);
      if (task.ownerId !== actorId) {
        throw AppError.forbidden('Only the task owner can delete this task');
      }
      await repo.deleteAsync(req.params.id, actorId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async getCollaborators(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.findByIdAsync(req.params.id, req.auth!.user.id);
      res.json(await repo.listCollaboratorsAsync(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  async addCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.body as Record<string, unknown>;
      if (!userId || typeof userId !== 'number') {
        throw AppError.badRequest('userId is required and must be a number');
      }
      const actorId = req.auth!.user.id;
      const task = await repo.findByIdAsync(req.params.id, actorId);
      if (task.ownerId !== actorId) {
        throw AppError.forbidden('Only the task owner can add collaborators');
      }
      await repo.addCollaboratorAsync(req.params.id, userId);
      await notifService.notifyCollaboratorAddedAsync(
        'task',
        req.params.id,
        task.title,
        userId,
        actorId,
      );
      const actor = await usersRepo.findByIdAsync(actorId).catch(() => null);
      if (actor) {
        await emailService.sendCollaboratorAddedEmailAsync(
          req.params.id,
          task.title,
          actor.name,
          userId,
          actorId,
        );
      }
      if (env.claudeUserId != null && userId === env.claudeUserId) {
        await claudeTriggersRepo.insertAsync(req.params.id, actorId);
        emitAppEvent({
          event: 'claude.trigger',
          taskId: req.params.id,
          taskTitle: task.title,
          triggeredByUserId: actorId,
        });
      }
      res.status(201).json(await repo.listCollaboratorsAsync(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  async removeCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const collaboratorUserId = Number(req.params.userId);
      if (isNaN(collaboratorUserId)) {
        throw AppError.badRequest('Invalid userId');
      }
      const actorId = req.auth!.user.id;
      const task = await repo.findByIdAsync(req.params.id, actorId);
      if (task.ownerId !== actorId) {
        throw AppError.forbidden('Only the task owner can remove collaborators');
      }
      await repo.removeCollaboratorAsync(req.params.id, collaboratorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}

/**
 * When a sequential rhythm step task is completed, unlock the next step's
 * task for the same due date and notify its assignee.
 */
async function maybeUnlockNextSequentialStep(
  sourceType: string | null,
  sourceId: string | null,
  dueDate: string | null,
): Promise<void> {
  if (sourceType !== 'recurring_rule' || !sourceId || !dueDate) return;

  // Step tasks have sourceId in the form "ruleId:stepId"
  const colonIdx = sourceId.indexOf(':');
  if (colonIdx === -1) return;

  const ruleId = sourceId.slice(0, colonIdx);
  const stepId = sourceId.slice(colonIdx + 1);

  const rule = await rulesRepo.findByIdAsync(ruleId).catch(() => null);
  if (!rule || !rule.sequential) return;

  const completedStepIndex = rule.steps.findIndex((s) => s.id === stepId);
  if (completedStepIndex === -1 || completedStepIndex >= rule.steps.length - 1) return;

  const nextStep = rule.steps[completedStepIndex + 1];
  const nextSourceId = `${ruleId}:${nextStep.id}`;

  const nextTask = await repo.findBySourceAndDueDateAsync('recurring_rule', nextSourceId, dueDate);
  if (!nextTask || !nextTask.locked) return;

  await repo.updateAsync(nextTask.id, { locked: false });

  if (nextStep.assigneeId != null) {
    await notifService.notifyStepUnlockedAsync(
      ruleId,
      rule.title,
      nextStep.title,
      nextStep.assigneeId,
    );
  }
}
