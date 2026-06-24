import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { AgentSkillInput } from '../models/agent_skill';

const repo = new AgentSkillsRepository();

const VALID_STATUSES = ['draft', 'published'];

/**
 * Validate a create/patch body for agent skills.
 *
 * @param body         the parsed request body
 * @param requireTitle when true (create), title must be present + non-empty;
 *                     when false (patch), title is only validated if supplied.
 */
function validateBody(body: Record<string, unknown>, requireTitle: boolean): void {
  if (requireTitle) {
    if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
      throw AppError.badRequest('title must be a non-empty string');
    }
  } else if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      throw AppError.badRequest('title must be a non-empty string');
    }
  }

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VALID_STATUSES.includes(body.status)) {
      throw AppError.badRequest("status must be one of 'draft' | 'published'");
    }
  }

  if (body.confidence !== undefined) {
    if (typeof body.confidence !== 'number' || Number.isNaN(body.confidence) || body.confidence < 0 || body.confidence > 1) {
      throw AppError.badRequest('confidence must be a number between 0 and 1');
    }
  }
}

export class AgentSkillsController {
  list(_req: Request, res: Response, next: NextFunction): void {
    try {
      const skills = repo.list();
      res.json(skills);
    } catch (err) {
      next(err);
    }
  }

  getOne(req: Request, res: Response, next: NextFunction): void {
    try {
      const skill = repo.getById(req.params.id);
      if (!skill) throw AppError.notFound('AgentSkill');
      res.json(skill);
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = req.body as Record<string, unknown>;
      validateBody(body, true);

      const input: AgentSkillInput = {
        title: (body.title as string).trim(),
        whenToUse: typeof body.whenToUse === 'string' ? body.whenToUse : null,
        description: typeof body.description === 'string' ? body.description : null,
        steps: Array.isArray(body.steps) ? (body.steps as string[]) : null,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : null,
        confidence: typeof body.confidence === 'number' ? body.confidence : 0,
        status: typeof body.status === 'string' ? body.status : 'draft',
        source: typeof body.source === 'string' ? body.source : null,
      };

      const skill = repo.create(input);
      res.status(201).json(skill);
    } catch (err) {
      next(err);
    }
  }

  patch(req: Request, res: Response, next: NextFunction): void {
    try {
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentSkill');

      const body = req.body as Record<string, unknown>;
      validateBody(body, false);

      const patch: Partial<AgentSkillInput> = {};
      if (body.title !== undefined) patch.title = (body.title as string).trim();
      if (body.whenToUse !== undefined) patch.whenToUse = typeof body.whenToUse === 'string' ? body.whenToUse : null;
      if (body.description !== undefined) patch.description = typeof body.description === 'string' ? body.description : null;
      if (body.steps !== undefined) patch.steps = Array.isArray(body.steps) ? (body.steps as string[]) : null;
      if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? (body.tags as string[]) : null;
      if (body.confidence !== undefined) patch.confidence = body.confidence as number;
      if (body.status !== undefined) patch.status = body.status as string;
      if (body.source !== undefined) patch.source = typeof body.source === 'string' ? body.source : null;

      const updated = repo.update(req.params.id, patch);
      if (!updated) throw AppError.notFound('AgentSkill');
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction): void {
    try {
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentSkill');

      const deleted = repo.remove(req.params.id);
      if (!deleted) throw AppError.notFound('AgentSkill');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
}
