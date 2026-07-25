import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';
import * as AgentRunner from '../services/agent_runner';

const repo = new AgentCookbookRepository();

export class AgentCookbookController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const recipes = req.mobileDevice
        ? await repo.listForOwnerAsync(req.mobileDevice.userId)
        : await repo.listAllAsync();
      res.json(recipes);
    } catch (err) {
      next(err);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const recipe = req.mobileDevice
        ? await repo.findByIdForOwnerAsync(
            req.params.id,
            req.mobileDevice.userId,
          )
        : await repo.findByIdAsync(req.params.id);
      if (!recipe) throw AppError.notFound('AgentCookbook');
      res.json(recipe);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, description, stepsJson, steps, boundConfigId } =
        req.body as Record<string, unknown>;

      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }

      // Accept either stepsJson (raw string) or steps (array — serialise it)
      let resolvedStepsJson: string | undefined;
      if (typeof stepsJson === 'string') {
        resolvedStepsJson = stepsJson;
      } else if (Array.isArray(steps)) {
        resolvedStepsJson = JSON.stringify(steps);
      }

      const recipe = await repo.createAsync({
        title,
        description: typeof description === 'string' ? description : undefined,
        stepsJson: resolvedStepsJson,
        boundConfigId:
          typeof boundConfigId === 'string' ? boundConfigId : undefined,
        // Ownership comes only from verified middleware context. Local/system
        // callers without auth intentionally create an org-global recipe,
        // which paired Activity excludes.
        ownerUserId: req.mobileDevice?.userId ?? req.auth?.user.id ?? null,
      });

      res.status(201).json(recipe);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const existing = req.mobileDevice
        ? await repo.findByIdForOwnerAsync(id, req.mobileDevice.userId)
        : await repo.findByIdAsync(id);
      if (!existing) throw AppError.notFound('AgentCookbook');

      const { title, description, stepsJson, steps, boundConfigId } =
        req.body as Record<string, unknown>;

      const patch: Parameters<typeof repo.updateAsync>[1] = {};
      if (typeof title === 'string') patch.title = title;
      if (typeof description === 'string' || description === null)
        patch.description = description as string | undefined;
      if (typeof stepsJson === 'string') {
        patch.stepsJson = stepsJson;
      } else if (Array.isArray(steps)) {
        patch.stepsJson = JSON.stringify(steps);
      }
      if (typeof boundConfigId === 'string' || boundConfigId === null)
        patch.boundConfigId = boundConfigId as string | undefined;

      const updated = req.mobileDevice
        ? await repo.updateForOwnerAsync(id, req.mobileDevice.userId, patch)
        : await repo.updateAsync(id, patch);
      if (!updated) throw AppError.notFound('AgentCookbook');
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const deleted = req.mobileDevice
        ? await repo.deleteForOwnerAsync(
            req.params.id,
            req.mobileDevice.userId,
          )
        : await repo.deleteAsync(req.params.id);
      if (!deleted) throw AppError.notFound('AgentCookbook');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  /** POST /agent-cookbook/:id/run — execute the recipe via AgentRunner */
  async runRecipe(req: Request, res: Response, next: NextFunction) {
    try {
      const recipe = req.mobileDevice
        ? await repo.findByIdForOwnerAsync(
            req.params.id,
            req.mobileDevice.userId,
          )
        : await repo.findByIdAsync(req.params.id);
      if (!recipe) throw AppError.notFound('AgentCookbook');
      if (
        recipe.boundConfigId &&
        !new AgentConfigsRepository().getById(recipe.boundConfigId)
      ) {
        throw AppError.badRequest(
          `Bound agent profile "${recipe.boundConfigId}" no longer exists; update or clear the recipe binding`,
        );
      }

      // Compile description + steps_json into a prompt string
      const stepsText = _compileStepsToPrompt(recipe.stepsJson);
      const prompt = [
        recipe.description ? `Goal: ${recipe.description}` : null,
        stepsText,
      ]
        .filter(Boolean)
        .join('\n\n');

      const result = await AgentRunner.run({
        prompt,
        outputTarget: 'session',
        sessionName: recipe.title,
        ...(req.mobileDevice
          ? { ownerUserId: req.mobileDevice.userId }
          : {}),
        ...(recipe.boundConfigId
          ? {
              agentConfigId: recipe.boundConfigId,
              agentKind: recipe.boundConfigId,
            }
          : {}),
      });

      res.status(202).json({ sessionId: result.sessionId, status: result.status });
    } catch (err) {
      next(err);
    }
  }
}

/**
 * Convert steps_json (JSON string) into a plain-text prompt.
 * Each step with an "action" + "text" or "description" is turned into a line.
 */
function _compileStepsToPrompt(stepsJson: string): string {
  try {
    const steps = JSON.parse(stepsJson) as unknown[];
    if (!Array.isArray(steps) || steps.length === 0) return '';
    return steps
      .map((step, i) => {
        if (typeof step === 'string') return `${i + 1}. ${step}`;
        if (typeof step === 'object' && step !== null) {
          const s = step as Record<string, unknown>;
          const label = typeof s.text === 'string'
            ? s.text
            : typeof s.description === 'string'
              ? s.description
              : typeof s.action === 'string'
                ? s.action
                : JSON.stringify(s);
          return `${i + 1}. ${label}`;
        }
        return `${i + 1}. ${String(step)}`;
      })
      .join('\n');
  } catch {
    return stepsJson;
  }
}
