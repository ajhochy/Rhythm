import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ClaudeTriggersRepository } from '../repositories/claude_triggers_repository';

const repo = new ClaudeTriggersRepository();

export class ClaudeTriggersController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.auth!.user.id;
      res.json(await repo.listForUser(userId));
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) throw AppError.badRequest('id must be a number');
      const userId = req.auth!.user.id;
      const trigger = await repo.findByIdAndUser(id, userId);
      if (!trigger) throw AppError.notFound('Trigger');
      await repo.deleteAsync(id);
      res.status(204).end();
    } catch (err) { next(err); }
  }
}
