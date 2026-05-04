import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { MessagesRepository } from '../repositories/messages_repository';

const repo = new MessagesRepository();

export class MessagesController {
  async getAllThreads(req: Request, res: Response, next: NextFunction) {
    try {
      const taskId = typeof req.query['task_id'] === 'string' ? req.query['task_id'] : undefined;
      res.json(await repo.findAllThreadsForUserAsync(req.auth!.user.id, taskId != null ? { taskId } : undefined));
    } catch (err) {
      next(err);
    }
  }

  async createThread(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        participantIds,
        threadType,
        title,
        taskId,
      } = req.body as Record<string, unknown>;
      if (!Array.isArray(participantIds) || participantIds.length === 0) {
        throw AppError.badRequest('participantIds is required');
      }
      if (taskId !== undefined && taskId !== null && typeof taskId !== 'string') {
        throw AppError.badRequest('taskId must be a string when provided');
      }
      const thread = await repo.createThreadAsync({
        createdBy: req.auth!.user.id,
        participantIds: participantIds.map((value) => Number(value)),
        threadType:
          threadType === 'group' || threadType === 'direct'
            ? threadType
            : undefined,
        title: typeof title === 'string' && title.trim() ? title.trim() : undefined,
        taskId: typeof taskId === 'string' ? taskId : null,
      });
      res.status(201).json(thread);
    } catch (err) {
      next(err);
    }
  }

  async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        await repo.findMessagesByThreadAsync(
          Number(req.params.id),
          req.auth!.user.id,
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  async createMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { body } = req.body as Record<string, unknown>;
      if (!body || typeof body !== 'string') {
        throw AppError.badRequest('body is required');
      }
      const message = await repo.createMessageAsync(
        Number(req.params.id),
        req.auth!.user.id,
        { body },
      );
      res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  }

  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.markThreadReadAsync(Number(req.params.id), req.auth!.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async markUnread(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.markThreadUnreadAsync(
        Number(req.params.id),
        req.auth!.user.id,
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
