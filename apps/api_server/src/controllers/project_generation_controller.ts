import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectGenerationService } from '../services/project_generation_service';

const service = new ProjectGenerationService();
const instanceRepo = new ProjectInstancesRepository();

export class ProjectGenerationController {
  async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { anchorDate, name } = req.body as Record<string, unknown>;
      if (!anchorDate || typeof anchorDate !== 'string') {
        throw AppError.badRequest('anchorDate (YYYY-MM-DD) is required');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
        throw AppError.badRequest('anchorDate must be in YYYY-MM-DD format');
      }

      const instance = await service.generateAsync(
        req.params.id,
        anchorDate,
        typeof name === 'string' ? name : null,
        req.auth?.user.id,
      );
      res.status(201).json(instance);
    } catch (err) {
      next(err);
    }
  }

  async getAllInstances(req: Request, res: Response, next: NextFunction) {
    try {
      const { templateId } = req.query as Record<string, string>;
      if (templateId) {
        res.json(
          await instanceRepo.findByTemplateIdAsync(
            templateId,
            req.auth?.user.id,
          ),
        );
      } else {
        res.json(await instanceRepo.findAllAsync(req.auth?.user.id));
      }
    } catch (err) {
      next(err);
    }
  }

  async updateInstanceStep(req: Request, res: Response, next: NextFunction) {
    try {
      const { stepId } = req.params;
      const { title, dueDate, status, notes } = req.body as Record<string, unknown>;
      const step = await instanceRepo.updateStepAsync(
        stepId,
        {
          title: typeof title === 'string' ? title : undefined,
          dueDate: typeof dueDate === 'string' ? dueDate : undefined,
          status: typeof status === 'string' ? status : undefined,
          notes:
            notes === null
              ? null
              : typeof notes === 'string'
                ? (notes.length === 0 ? null : notes)
                : undefined,
        },
        req.auth?.user.id,
      );
      res.json(step);
    } catch (err) {
      next(err);
    }
  }

  async deleteInstance(req: Request, res: Response, next: NextFunction) {
    try {
      await instanceRepo.deleteAsync(req.params.id, req.auth?.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
