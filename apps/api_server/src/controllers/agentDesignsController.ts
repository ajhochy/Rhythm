import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentDesignsRepository } from '../repositories/agent_designs_repository';

const repo = new AgentDesignsRepository();

export class AgentDesignsController {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const designs = await repo.listAllAsync();
      res.json(designs);
    } catch (err) {
      next(err);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const design = await repo.findByIdAsync(req.params.id);
      if (!design) throw AppError.notFound('AgentDesign');
      res.json(design);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, canvaUrl, thumbnailUrl, sessionId } =
        req.body as Record<string, unknown>;

      const design = await repo.createAsync({
        title: typeof title === 'string' ? title : undefined,
        canvaUrl: typeof canvaUrl === 'string' ? canvaUrl : undefined,
        thumbnailUrl:
          typeof thumbnailUrl === 'string' ? thumbnailUrl : undefined,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      });

      res.status(201).json(design);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const deleted = await repo.deleteAsync(req.params.id);
      if (!deleted) throw AppError.notFound('AgentDesign');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
}
