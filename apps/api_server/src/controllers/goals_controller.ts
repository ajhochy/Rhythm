import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import {
  GOAL_HEALTH_VALUES,
  GOAL_METRIC_TYPES,
  type CreateGoalDto,
  type UpdateGoalDto,
} from '../models/goal';
import { GoalsRepository } from '../repositories/goals_repository';

const repo = new GoalsRepository();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw AppError.badRequest(`${field} must be a valid date in YYYY-MM-DD format`);
  }
  return value;
}

function validateNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw AppError.badRequest(`${field} must be a finite number`);
  }
  return value;
}

function validateCreate(body: Record<string, unknown>, ownerId: number): CreateGoalDto {
  if (typeof body.title !== 'string' || body.title.trim() === '') {
    throw AppError.badRequest('title is required');
  }
  if (!GOAL_METRIC_TYPES.includes(body.metricType as never)) {
    throw AppError.badRequest(`metricType must be one of: ${GOAL_METRIC_TYPES.join(', ')}`);
  }
  if (body.health !== undefined && !GOAL_HEALTH_VALUES.includes(body.health as never)) {
    throw AppError.badRequest(`health must be one of: ${GOAL_HEALTH_VALUES.join(', ')}`);
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    throw AppError.badRequest('description must be a string or null');
  }
  const startDate = validateDate(body.startDate, 'startDate');
  const endDate = validateDate(body.endDate, 'endDate');
  if (startDate > endDate) throw AppError.badRequest('startDate must be on or before endDate');
  const startValue = validateNumber(body.startValue, 'startValue');
  const currentValue = validateNumber(body.currentValue, 'currentValue');
  const endValue = validateNumber(body.endValue, 'endValue');
  if (startValue === endValue) throw AppError.badRequest('startValue and endValue must differ');
  return {
    title: body.title.trim(),
    description: typeof body.description === 'string' ? body.description.trim() || null : null,
    metricType: body.metricType as CreateGoalDto['metricType'],
    startValue, currentValue, endValue,
    health: (body.health ?? 'on_track') as CreateGoalDto['health'],
    startDate, endDate, ownerId,
  };
}

function validateUpdate(body: Record<string, unknown>, existing: CreateGoalDto): UpdateGoalDto {
  return validateCreate({ ...existing, ...body }, existing.ownerId);
}

export class GoalsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try { res.json(await repo.findAllAsync(req.auth!.user.id)); } catch (error) { next(error); }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try { res.json(await repo.findByIdAsync(req.params.id, req.auth!.user.id)); } catch (error) { next(error); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(201).json(await repo.createAsync(validateCreate(req.body ?? {}, req.auth!.user.id)));
    } catch (error) { next(error); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const ownerId = req.auth!.user.id;
      const existing = await repo.findByIdAsync(req.params.id, ownerId);
      const patch = validateUpdate(req.body ?? {}, { ...existing, ownerId });
      res.json(await repo.updateAsync(req.params.id, patch, ownerId));
    } catch (error) { next(error); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.deleteAsync(req.params.id, req.auth!.user.id);
      res.status(204).send();
    } catch (error) { next(error); }
  }
}
