import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { MessagesRepository } from '../repositories/messages_repository';

const repo = new MessagesRepository();

export class MessagesController {
  getAllThreads(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAllThreads());
    } catch (err) {
      next(err);
    }
  }

  createThread(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, created_by } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }
      const thread = repo.createThread({
        title,
        created_by: created_by != null ? Number(created_by) : null,
      });
      res.status(201).json(thread);
    } catch (err) {
      next(err);
    }
  }

  getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findMessagesByThread(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  }

  createMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { sender_name, body, sender_id } = req.body as Record<string, unknown>;
      if (!sender_name || typeof sender_name !== 'string') {
        throw AppError.badRequest('sender_name is required');
      }
      if (!body || typeof body !== 'string') {
        throw AppError.badRequest('body is required');
      }
      const message = repo.createMessage(Number(req.params.id), {
        sender_name,
        body,
        sender_id: sender_id != null ? Number(sender_id) : null,
      });
      res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  }
}
