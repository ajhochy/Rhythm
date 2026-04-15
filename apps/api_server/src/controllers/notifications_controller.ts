import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { NotificationsRepository } from '../repositories/notifications_repository';

const repo = new NotificationsRepository();

export class NotificationsController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.listUnreadAsync(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) throw AppError.badRequest('Invalid notification id');
      await repo.markReadAsync(id, req.auth!.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.markAllReadAsync(req.auth!.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
