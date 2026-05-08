import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { getDb } from '../database/db';
import { broadcast } from '../services/ws_gateway';

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
      if (title.length > 200) {
        throw AppError.badRequest('title must be 200 characters or fewer');
      }
      if (body.length > 200) {
        throw AppError.badRequest('body must be 200 characters or fewer');
      }

      const result = getDb()
        .prepare(
          `INSERT INTO agent_notifications (title, body) VALUES (?, ?) RETURNING id`,
        )
        .get(title.trim(), body.trim()) as { id: number };

      broadcast({ v: 1, type: 'notification.push', id: result.id, title: title.trim(), body: body.trim() });

      res.status(201).json({ id: result.id });
    } catch (err) {
      next(err);
    }
  }
}
