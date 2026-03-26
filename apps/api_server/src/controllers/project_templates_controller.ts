import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';

const repo = new ProjectTemplatesRepository();

export class ProjectTemplatesController {
  getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findAll());
    } catch (err) {
      next(err);
    }
  }

  getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(repo.findById(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, description, anchorType } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') {
        throw AppError.badRequest('name is required');
      }
      const template = repo.create({ name, description: description as string ?? null, anchorType: anchorType as string });
      res.status(201).json(template);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction) {
    try {
      const template = repo.update(req.params.id, req.body as Record<string, unknown>);
      res.json(template);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction) {
    try {
      repo.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  addStep(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, offsetDays, offsetDescription, sortOrder } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') throw AppError.badRequest('title is required');
      if (offsetDays === undefined || typeof offsetDays !== 'number') throw AppError.badRequest('offsetDays (number) is required');
      const step = repo.addStep(req.params.id, { title, offsetDays, offsetDescription: offsetDescription as string ?? null, sortOrder: sortOrder as number });
      res.status(201).json(step);
    } catch (err) {
      next(err);
    }
  }
}
