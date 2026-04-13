import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { MessagesRepository } from '../repositories/messages_repository';

const repo = new MessagesRepository();

export class MessagesController {
  async getAllThreads(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findAllThreadsForUserAsync(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async createThread(req: Request, res: Response, next: NextFunction) {
    try {
      const { participantIds } = req.body as Record<string, unknown>;
      if (!Array.isArray(participantIds) || participantIds.length === 0) {
        throw AppError.badRequest('participantIds is required');
      }
      const thread = await repo.createThreadAsync({
        createdBy: req.auth!.user.id,
        participantIds: participantIds.map((value) => Number(value)),
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
