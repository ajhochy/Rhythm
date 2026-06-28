import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { AgentSkillInput } from '../models/agent_skill';
import { materializeSkill, dematerializeSkill } from '../services/skill_materializer';

/**
 * Resolve the repository at REQUEST time so it binds to the current global DB.
 * (Constructing it at module load captures whatever DB existed at import — which
 * in tests is before `setDb`, yielding a throwaway in-memory DB. Resolving per
 * request honors the live DB in both prod and tests.)
 */
function getRepo(): AgentSkillsRepository {
  return new AgentSkillsRepository();
}

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
      const repo = getRepo();
      const skills = repo.list();
      res.json(skills);
    } catch (err) {
      next(err);
    }
  }

  getOne(req: Request, res: Response, next: NextFunction): void {
    try {
      const repo = getRepo();
      const skill = repo.getById(req.params.id);
      if (!skill) throw AppError.notFound('AgentSkill');
      res.json(skill);
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction): void {
    try {
      const repo = getRepo();
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
      // Unify-6 — a skill created already-published is materialized into the
      // engine's managed dir (fire-and-forget; never fails the request).
      if (skill.status === 'published') {
        void materializeSkill(skill);
      }
      res.status(201).json(skill);
    } catch (err) {
      next(err);
    }
  }

  patch(req: Request, res: Response, next: NextFunction): void {
    try {
      const repo = getRepo();
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
      // Unify-6 — keep the materialized SKILL.md in sync with publish state
      // (fire-and-forget). Publish → write/refresh; unpublish → remove. A title
      // change while published re-materializes under the new name; the old file
      // is cleaned up here when the previous title differed.
      if (updated.status === 'published') {
        if (existing.status === 'published' && existing.title !== updated.title) {
          void dematerializeSkill(existing);
        }
        void materializeSkill(updated);
      } else if (existing.status === 'published') {
        void dematerializeSkill(existing);
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction): void {
    try {
      const repo = getRepo();
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentSkill');

      const deleted = repo.remove(req.params.id);
      if (!deleted) throw AppError.notFound('AgentSkill');
      // Unify-6 — drop the materialized SKILL.md when a published skill is
      // deleted (fire-and-forget; never fails the request).
      if (existing.status === 'published') {
        void dematerializeSkill(existing);
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  /** P5-3: GET /agent-skills/:id/versions — version history, newest first. */
  listVersions(req: Request, res: Response, next: NextFunction): void {
    try {
      const repo = getRepo();
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentSkill');
      res.json(repo.listVersions(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  /**
   * P5-3: POST /agent-skills/:id/rollback — restore a prior version as the new
   * current row (non-destructive — recorded as a new version). Body: { versionNo }.
   */
  rollback(req: Request, res: Response, next: NextFunction): void {
    try {
      const repo = getRepo();
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentSkill');

      const body = req.body as Record<string, unknown>;
      const versionNo = body.versionNo;
      if (typeof versionNo !== 'number' || !Number.isInteger(versionNo) || versionNo < 1) {
        throw AppError.badRequest('versionNo must be a positive integer');
      }

      const restored = repo.rollback(req.params.id, versionNo);
      if (!restored) throw AppError.notFound('AgentSkillVersion');
      res.json(restored);
    } catch (err) {
      next(err);
    }
  }
}
