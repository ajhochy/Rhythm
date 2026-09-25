import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ClaudeTriggersRepository } from '../repositories/claude_triggers_repository';

const repo = new ClaudeTriggersRepository();

export class ClaudeTriggersController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        req.auth
          ? await repo.listForUser(req.auth.user.id)
          : await repo.listLocalUnowned(),
      );
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) throw AppError.badRequest('id must be a number');
      if (req.auth) {
        const trigger = await repo.findByIdAndUser(id, req.auth.user.id);
        if (!trigger) throw AppError.notFound('Trigger');
        await repo.deleteAsync(id);
      } else if (!(await repo.deleteLocalUnowned(id))) {
        throw AppError.notFound('Trigger');
      }
      res.status(204).end();
    } catch (err) { next(err); }
  }
}
