import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectGenerationService } from '../services/project_generation_service';
import { NotificationsRepository } from '../repositories/notifications_repository';
import { NotificationService } from '../services/notification_service';

const service = new ProjectGenerationService();
const instanceRepo = new ProjectInstancesRepository();
const notifService = new NotificationService(new NotificationsRepository());

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
      const actorId = req.auth?.user.id;
      const { stepId } = req.params;
      const { title, dueDate, status, notes, assigneeId } = req.body as Record<string, unknown>;
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
          assigneeId:
            assigneeId === null
              ? null
              : typeof assigneeId === 'number'
                ? assigneeId
                : undefined,
        },
        actorId,
      );

      // Notify on step completion
      if (status === 'done' && actorId != null) {
        const instanceId = step.instanceId;
        const collaborators = await instanceRepo.listCollaboratorsAsync(instanceId);
        const collaboratorIds = collaborators.map((c) => c.userId);
        const instance = await instanceRepo.findByIdAsync(instanceId, actorId);
        if (instance.ownerId != null && !collaboratorIds.includes(instance.ownerId)) {
          collaboratorIds.push(instance.ownerId);
        }
        if (collaboratorIds.length > 0) {
          await notifService.notifyStepCompletedAsync(
            'project',
            instanceId,
            instance.name ?? 'Project',
            step.title,
            collaboratorIds,
            actorId,
          );
        }
      }

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

  async getCollaborators(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await instanceRepo.listCollaboratorsAsync(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  async addCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.body as Record<string, unknown>;
      if (!userId || typeof userId !== 'number') {
        throw AppError.badRequest('userId is required and must be a number');
      }
      await instanceRepo.addCollaboratorAsync(req.params.id, userId);
      const actorId = req.auth?.user.id;
      if (actorId != null) {
        const instance = await instanceRepo.findByIdAsync(req.params.id, actorId);
        await notifService.notifyCollaboratorAddedAsync(
          'project',
          req.params.id,
          instance.name ?? 'Project',
          userId,
          actorId,
        );
      }
      res.status(201).json(await instanceRepo.listCollaboratorsAsync(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  async removeCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const collaboratorUserId = Number(req.params.userId);
      if (isNaN(collaboratorUserId)) {
        throw AppError.badRequest('Invalid userId');
      }
      await instanceRepo.removeCollaboratorAsync(req.params.id, collaboratorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
