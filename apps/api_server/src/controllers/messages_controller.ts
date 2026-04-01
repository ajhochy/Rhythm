import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { MessagesRepository } from '../repositories/messages_repository';

const repo = new MessagesRepository();

export class MessagesController {
  getAllThreads(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAllThreadsForUser(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  createThread(req: Request, res: Response, next: NextFunction) {
    try {
      const { participantIds } = req.body as Record<string, unknown>;
      if (!Array.isArray(participantIds) || participantIds.length === 0) {
        throw AppError.badRequest('participantIds is required');
      }
      const thread = repo.createThread({
        createdBy: req.auth!.user.id,
        participantIds: participantIds.map((value) => Number(value)),
      });
      res.status(201).json(thread);
    } catch (err) {
      next(err);
    }
  }

  getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findMessagesByThread(Number(req.params.id), req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  createMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { body } = req.body as Record<string, unknown>;
      if (!body || typeof body !== 'string') {
        throw AppError.badRequest('body is required');
      }
      const message = repo.createMessage(Number(req.params.id), req.auth!.user.id, {
        body,
      });
      res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  }

  markRead(req: Request, res: Response, next: NextFunction) {
    try {
      repo.markThreadRead(Number(req.params.id), req.auth!.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
