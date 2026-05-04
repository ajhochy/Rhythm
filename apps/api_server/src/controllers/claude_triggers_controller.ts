import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ClaudeTriggersRepository } from '../repositories/claude_triggers_repository';

const repo = new ClaudeTriggersRepository();

export class ClaudeTriggersController {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.listAllAsync());
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) throw AppError.badRequest('id must be a number');
      const ok = await repo.deleteAsync(id);
      if (!ok) throw AppError.notFound('Trigger');
      res.status(204).end();
    } catch (err) { next(err); }
  }
}
