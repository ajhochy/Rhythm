import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import {
  AGENT_NOTIFICATION_MAX_LENGTH,
  pushAgentNotification,
} from '../services/agent_notifications';

export class NotificationsAgentController {
  post(req: Request, res: Response, next: NextFunction): void {
    try {
      const { title, body } = req.body as { title?: unknown; body?: unknown };

      if (typeof title !== 'string' || title.trim().length === 0) {
        throw AppError.badRequest('title is required');
      }
      if (typeof body !== 'string' || body.trim().length === 0) {
        throw AppError.badRequest('body is required');
      }
      if (title.length > AGENT_NOTIFICATION_MAX_LENGTH) {
        throw AppError.badRequest('title must be 200 characters or fewer');
      }
      if (body.length > AGENT_NOTIFICATION_MAX_LENGTH) {
        throw AppError.badRequest('body must be 200 characters or fewer');
      }

      res.status(201).json({ id: pushAgentNotification(title, body) });
    } catch (err) {
      next(err);
    }
  }
}
