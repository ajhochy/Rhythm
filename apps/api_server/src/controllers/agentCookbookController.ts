import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';

const repo = new AgentCookbookRepository();

export class AgentCookbookController {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const recipes = await repo.listAllAsync();
      res.json(recipes);
    } catch (err) {
      next(err);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const recipe = await repo.findByIdAsync(req.params.id);
      if (!recipe) throw AppError.notFound('AgentCookbook');
      res.json(recipe);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, description, stepsJson, steps, boundConfigId } =
        req.body as Record<string, unknown>;

      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }

      // Accept either stepsJson (raw string) or steps (array — serialise it)
      let resolvedStepsJson: string | undefined;
      if (typeof stepsJson === 'string') {
        resolvedStepsJson = stepsJson;
      } else if (Array.isArray(steps)) {
        resolvedStepsJson = JSON.stringify(steps);
      }

      const recipe = await repo.createAsync({
        title,
        description: typeof description === 'string' ? description : undefined,
        stepsJson: resolvedStepsJson,
        boundConfigId:
          typeof boundConfigId === 'string' ? boundConfigId : undefined,
      });

      res.status(201).json(recipe);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const existing = await repo.findByIdAsync(id);
      if (!existing) throw AppError.notFound('AgentCookbook');

      const { title, description, stepsJson, steps, boundConfigId } =
        req.body as Record<string, unknown>;

      const patch: Parameters<typeof repo.updateAsync>[1] = {};
      if (typeof title === 'string') patch.title = title;
      if (typeof description === 'string' || description === null)
        patch.description = description as string | undefined;
      if (typeof stepsJson === 'string') {
        patch.stepsJson = stepsJson;
      } else if (Array.isArray(steps)) {
        patch.stepsJson = JSON.stringify(steps);
      }
      if (typeof boundConfigId === 'string' || boundConfigId === null)
        patch.boundConfigId = boundConfigId as string | undefined;

      const updated = await repo.updateAsync(id, patch);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const deleted = await repo.deleteAsync(req.params.id);
      if (!deleted) throw AppError.notFound('AgentCookbook');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
}
