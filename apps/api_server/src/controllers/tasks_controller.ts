import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { TasksRepository } from '../repositories/tasks_repository';
import { NotificationsRepository } from '../repositories/notifications_repository';
import { NotificationService } from '../services/notification_service';

const repo = new TasksRepository();
const notifService = new NotificationService(new NotificationsRepository());

export class TasksController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findAllAsync(req.auth?.user.id));
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findByIdAsync(req.params.id, req.auth?.user.id));
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
      const task = await repo.createAsync({
        title,
        notes: (notes as string) ?? null,
        dueDate: (dueDate as string) ?? null,
        status: status as 'open' | 'done',
        ownerId: req.auth?.user.id ?? null,
      });
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = req.auth?.user.id;
      const existing = await repo.findByIdAsync(req.params.id, actorId);
      const updated = await repo.updateAsync(
        req.params.id,
        req.body as Record<string, unknown>,
        actorId,
      );

      const data = req.body as Record<string, unknown>;

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
      }

      res.json(updated);
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
      const { userId } = req.body as Record<string, unknown>;
      if (!userId || typeof userId !== 'number') {
        throw AppError.badRequest('userId is required and must be a number');
      }
      await repo.addCollaboratorAsync(req.params.id, userId);
      const actorId = req.auth?.user.id;
      if (actorId != null) {
        const task = await repo.findByIdAsync(req.params.id, actorId);
        await notifService.notifyCollaboratorAddedAsync(
          'task',
          req.params.id,
          task.title,
          userId,
          actorId,
        );
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
      await repo.removeCollaboratorAsync(req.params.id, collaboratorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
