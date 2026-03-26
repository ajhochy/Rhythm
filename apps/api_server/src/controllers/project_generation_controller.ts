import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectGenerationService } from '../services/project_generation_service';

const service = new ProjectGenerationService();
const instanceRepo = new ProjectInstancesRepository();

export class ProjectGenerationController {
  generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { anchorDate } = req.body as Record<string, unknown>;
      if (!anchorDate || typeof anchorDate !== 'string') {
        throw AppError.badRequest('anchorDate (YYYY-MM-DD) is required');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
        throw AppError.badRequest('anchorDate must be in YYYY-MM-DD format');
      }

      const instance = service.generate(req.params.id, anchorDate);
      res.status(201).json(instance);
    } catch (err) {
      next(err);
    }
  }

  getAllInstances(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(instanceRepo.findAll());
    } catch (err) {
      next(err);
    }
  }
}
