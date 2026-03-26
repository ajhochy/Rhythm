import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectGenerationService } from '../services/project_generation_service';

const service = new ProjectGenerationService();
const instanceRepo = new ProjectInstancesRepository();

export class ProjectGenerationController {
  generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { anchorDate, name } = req.body as Record<string, unknown>;
      if (!anchorDate || typeof anchorDate !== 'string') {
        throw AppError.badRequest('anchorDate (YYYY-MM-DD) is required');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
        throw AppError.badRequest('anchorDate must be in YYYY-MM-DD format');
      }

      const instance = service.generate(
        req.params.id,
        anchorDate,
        typeof name === 'string' ? name : null,
      );
      res.status(201).json(instance);
    } catch (err) {
      next(err);
    }
  }

  getAllInstances(_req: Request, res: Response, next: NextFunction) {
    try {
      const { templateId } = _req.query as Record<string, string>;
      if (templateId) {
        res.json(instanceRepo.findByTemplateId(templateId));
      } else {
        res.json(instanceRepo.findAll());
      }
    } catch (err) {
      next(err);
    }
  }

  updateInstanceStep(req: Request, res: Response, next: NextFunction) {
    try {
      const { stepId } = req.params;
      const { title, dueDate, status, notes } = req.body as Record<string, unknown>;
      const step = instanceRepo.updateStep(stepId, {
        title: typeof title === 'string' ? title : undefined,
        dueDate: typeof dueDate === 'string' ? dueDate : undefined,
        status: typeof status === 'string' ? status : undefined,
        notes: notes === null
            ? null
            : typeof notes === 'string'
                ? (notes.length === 0 ? null : notes)
                : undefined,
      });
      res.json(step);
    } catch (err) {
      next(err);
    }
  }

  deleteInstance(req: Request, res: Response, next: NextFunction) {
    try {
      instanceRepo.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
