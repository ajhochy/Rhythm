/**
 * org_settings_routes.ts — #1072 (OCU-31).
 *
 * Hosts the org's single instructions markdown on the production API, synced
 * to every local machine's opencode `instructions` config (see
 * opencode_plugin_config.ts's `syncOrgInstructions`). Mirrors org_skills_routes.ts's
 * auth posture exactly (#1053/OCU-12 precedent this issue explicitly follows):
 *
 *   GET  /org-settings/instructions — PUBLIC. Any machine's local sync fetch
 *        must work without a login, same reasoning as org_skills' public
 *        index.json/file reads (the engine's own fetch is anonymous).
 *   PUT  /org-settings/instructions — requireAuth. Only an authenticated
 *        caller may set org policy.
 *
 * Mounted at /org-settings in app.ts, OUTSIDE the agentExecutionEnabled gate
 * — like /org-skills, this is a core always-on production API surface, not
 * an agent-runtime surface (the 'cloud' deployment role must still serve it).
 *
 * The instructions content is NOT guaranteed secret-free by the engine the
 * way org_skills' SKILL.md is (skills feed the engine's tool-use context;
 * instructions feed EVERY agent's system context identically) — same
 * "never put secrets here" expectation applies to whoever authors it via PUT.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { AppError } from '../errors/app_error';
import { OrgSettingsRepository } from '../repositories/org_settings_repository';

export const orgSettingsRouter = Router();

orgSettingsRouter.get('/instructions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const instructions = await new OrgSettingsRepository().getInstructionsAsync();
    if (!instructions) throw AppError.notFound('OrgInstructions');
    res.json(instructions);
  } catch (err) {
    next(err);
  }
});

orgSettingsRouter.use(requireAuth);

orgSettingsRouter.put('/instructions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body as { content?: unknown };
    if (typeof content !== 'string' || content.trim() === '') {
      throw AppError.badRequest('content must be a non-empty string');
    }
    const instructions = await new OrgSettingsRepository().setInstructionsAsync(content);
    res.json(instructions);
  } catch (err) {
    next(err);
  }
});
