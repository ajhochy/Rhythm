import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';

const repo = new ProjectTemplatesRepository();

export class ProjectTemplatesController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findAllAsync(req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findByIdAsync(req.params.id, req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, description, anchorType } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') {
        throw AppError.badRequest('name is required');
      }
      const template = await repo.createAsync({
        name,
        description: description as string ?? null,
        anchorType: anchorType as string,
        ownerId: req.auth!.user.id,
      });
      res.status(201).json(template);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, description } = req.body as Record<string, unknown>;
      const template = await repo.updateAsync(
        req.params.id,
        {
          ...(typeof name === 'string' ? { name } : {}),
          ...(description !== undefined
            ? { description: (description as string | null) ?? null }
            : {}),
        },
        req.auth!.user.id,
      );
      res.json(template);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.deleteAsync(req.params.id, req.auth!.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async addStep(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, offsetDays, offsetDescription, sortOrder, assigneeId } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') throw AppError.badRequest('title is required');
      if (offsetDays === undefined || typeof offsetDays !== 'number') throw AppError.badRequest('offsetDays (number) is required');
      const step = await repo.addStepAsync(
        req.params.id,
        {
          title,
          offsetDays,
          offsetDescription: offsetDescription as string ?? null,
          sortOrder: sortOrder as number,
          assigneeId:
            assigneeId === null
              ? null
              : typeof assigneeId === 'number'
                ? assigneeId
                : undefined,
        },
        req.auth!.user.id,
      );
      res.status(201).json(step);
    } catch (err) {
      next(err);
    }
  }

  async updateStep(req: Request, res: Response, next: NextFunction) {
    try {
      const step = await repo.updateStepAsync(
        req.params.stepId,
        req.body as Record<string, unknown>,
        req.auth!.user.id,
      );
      res.json(step);
    } catch (err) {
      next(err);
    }
  }

  async removeStep(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.deleteStepAsync(req.params.stepId, req.auth!.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
