import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectGenerationService } from '../services/project_generation_service';
import { NotificationsRepository } from '../repositories/notifications_repository';
import { NotificationService } from '../services/notification_service';
import { GoalsRepository } from '../repositories/goals_repository';

const service = new ProjectGenerationService();
const instanceRepo = new ProjectInstancesRepository();
const notifService = new NotificationService(new NotificationsRepository());
const goalsRepo = new GoalsRepository();

async function parseGoalId(value: unknown, ownerId: number): Promise<string | null> {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') throw AppError.badRequest('goalId must be a goal ID or null');
  await goalsRepo.findByIdAsync(value, ownerId);
  return value;
}

function parseMilestoneTitle(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw AppError.badRequest('title is required');
  }
  return value.trim();
}

function parseOptionalDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())
  ) {
    throw AppError.badRequest('dueDate must be YYYY-MM-DD or null');
  }
  return value;
}

function parseMilestoneColor(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw AppError.badRequest('color must be a six-digit hex color or null');
  }
  return value.toUpperCase();
}

function parseSortOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw AppError.badRequest('sortOrder must be an integer');
  }
  return value;
}

export class ProjectGenerationController {
  async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { anchorDate, name, goalId } = req.body as Record<string, unknown>;
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
        req.auth!.user.id,
        await parseGoalId(goalId, req.auth!.user.id),
      );
      res.status(201).json(instance);
    } catch (err) {
      next(err);
    }
  }

  async createInstance(req: Request, res: Response, next: NextFunction) {
    try {
      const { templateId, anchorDate, name, goalId } = req.body as Record<string, unknown>;
      if (!templateId || typeof templateId !== 'string') {
        throw AppError.badRequest('templateId is required');
      }
      if (!anchorDate || typeof anchorDate !== 'string') {
        throw AppError.badRequest('anchorDate (YYYY-MM-DD) is required');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
        throw AppError.badRequest('anchorDate must be in YYYY-MM-DD format');
      }
      const instance = await service.generateAsync(
        templateId,
        anchorDate,
        typeof name === 'string' ? name : null,
        req.auth!.user.id,
        await parseGoalId(goalId, req.auth!.user.id),
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
            req.auth!.user.id,
          ),
        );
      } else {
        res.json(await instanceRepo.findAllAsync(req.auth!.user.id));
      }
    } catch (err) {
      next(err);
    }
  }

  async updateInstance(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.auth!.user.id;
      const body = req.body as Record<string, unknown>;
      if (!('goalId' in body)) throw AppError.badRequest('goalId is required');
      res.json(await instanceRepo.updateGoalAsync(req.params.id, await parseGoalId(body.goalId, userId), userId));
    } catch (err) { next(err); }
  }

  async updateInstanceStep(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = req.auth!.user.id;
      const { stepId } = req.params;
      const { title, dueDate, scheduledDate, status, notes, assigneeId, milestoneId } = req.body as Record<string, unknown>;
      if (milestoneId !== undefined && milestoneId !== null && typeof milestoneId !== 'string') {
        throw AppError.badRequest('milestoneId must be a milestone ID or null');
      }
      const step = await instanceRepo.updateStepAsync(
        stepId,
        {
          title: typeof title === 'string' ? title : undefined,
          dueDate: typeof dueDate === 'string' ? dueDate : undefined,
          scheduledDate:
            scheduledDate === null
              ? null
              : typeof scheduledDate === 'string'
                ? scheduledDate
                : undefined,
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
          milestoneId:
            milestoneId === null
              ? null
              : typeof milestoneId === 'string'
                ? milestoneId
                : undefined,
        },
        actorId,
      );

      // Notify on step completion
      if (status === 'done') {
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

  async getMilestones(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        await instanceRepo.listMilestonesAsync(
          req.params.id,
          req.auth!.user.id,
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  async createMilestone(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as Record<string, unknown>;
      const milestone = await instanceRepo.createMilestoneAsync(
        req.params.id,
        {
          title: parseMilestoneTitle(body.title, true)!,
          dueDate: parseOptionalDate(body.dueDate),
          color: parseMilestoneColor(body.color),
          sortOrder: parseSortOrder(body.sortOrder),
        },
        req.auth!.user.id,
      );
      res.status(201).json(milestone);
    } catch (err) {
      next(err);
    }
  }

  async updateMilestone(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as Record<string, unknown>;
      res.json(
        await instanceRepo.updateMilestoneAsync(
          req.params.id,
          req.params.milestoneId,
          {
            title: parseMilestoneTitle(body.title, false),
            dueDate: parseOptionalDate(body.dueDate),
            color: parseMilestoneColor(body.color),
            sortOrder: parseSortOrder(body.sortOrder),
          },
          req.auth!.user.id,
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  async deleteMilestone(req: Request, res: Response, next: NextFunction) {
    try {
      await instanceRepo.deleteMilestoneAsync(
        req.params.id,
        req.params.milestoneId,
        req.auth!.user.id,
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async deleteInstance(req: Request, res: Response, next: NextFunction) {
    try {
      await instanceRepo.deleteAsync(req.params.id, req.auth!.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async getCollaborators(req: Request, res: Response, next: NextFunction) {
    try {
      await instanceRepo.findByIdAsync(req.params.id, req.auth!.user.id);
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
      const actorId = req.auth!.user.id;
      const instance = await instanceRepo.findByIdAsync(req.params.id, actorId);
      if (instance.ownerId !== actorId) {
        throw AppError.forbidden('Only the project owner can add collaborators');
      }
      await instanceRepo.addCollaboratorAsync(req.params.id, userId);
      await notifService.notifyCollaboratorAddedAsync(
        'project',
        req.params.id,
        instance.name ?? 'Project',
        userId,
        actorId,
      );
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
      const actorId = req.auth!.user.id;
      const instance = await instanceRepo.findByIdAsync(req.params.id, actorId);
      if (instance.ownerId !== actorId) {
        throw AppError.forbidden('Only the project owner can remove collaborators');
      }
      await instanceRepo.removeCollaboratorAsync(req.params.id, collaboratorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
