/**
 * Unify-2 — Skills source-of-truth routes.
 *
 * Mounted at /opencode/skills in app.ts.
 *
 * The opencode fork's filesystem skill store is the single source of truth for
 * skills. These routes let Flutter (and agent_profile_sync) read the fork's live
 * discovered skills and let users author Rhythm-owned skills into a dedicated
 * managed dir that the fork scans (registered via config.skills.paths).
 *
 * Routes:
 *   GET    /opencode/skills        → live fork skills (content stripped) + `managed` flag
 *   POST   /opencode/skills        → create/overwrite a Rhythm-managed skill, then reload
 *   PUT    /opencode/skills/:name  → overwrite a Rhythm-managed skill, then reload
 *   DELETE /opencode/skills/:name  → delete a Rhythm-managed skill, then reload
 *
 * Write/delete are confined to the Rhythm-managed dir. External skills (plugins,
 * ~/.claude/skills, superpowers, anthropic-skills) are read-only here — they are
 * shown and can be scoped, but never written or deleted.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { opencodeClient } from '../services/opencode_engine';
import {
  writeManagedSkill,
  deleteManagedSkill,
  isManagedLocation,
  InvalidSkillNameError,
} from '../services/rhythm_managed_skills';

export const opencodeSkillsRouter = Router();

/** Shape returned to clients — no `content` (the full SKILL.md body). */
interface SkillListEntry {
  name: string;
  description?: string;
  location: string;
  /** True when this skill lives in the Rhythm-managed dir (writable/deletable). */
  managed: boolean;
}

// ── GET / — list the fork's live discovered skills ───────────────────────────

opencodeSkillsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const directory =
        typeof req.query.directory === 'string' ? req.query.directory : undefined;
      const skills = await opencodeClient.listSkills(directory);
      const entries: SkillListEntry[] = skills.map((s) => ({
        name: s.name,
        description: s.description,
        location: s.location,
        managed: isManagedLocation(s.location),
      }));
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },
);

// ── shared create/overwrite handler for POST / and PUT /:name ────────────────

async function upsertManagedSkill(
  name: string,
  description: string | undefined,
  content: string,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(
        new AppError(400, 'BAD_REQUEST', 'name is required to write a skill'),
      );
    }
    if (typeof content !== 'string' || content.trim() === '') {
      return next(
        new AppError(400, 'BAD_REQUEST', 'content (the skill body) is required'),
      );
    }

    let location: string;
    try {
      location = writeManagedSkill({ name: name.trim(), description, body: content });
    } catch (err) {
      if (err instanceof InvalidSkillNameError) {
        return next(new AppError(400, 'BAD_REQUEST', err.message));
      }
      throw err;
    }

    // Re-scan so the new/edited skill is immediately discoverable.
    await opencodeClient.reloadSkills();

    res.json({
      name: name.trim(),
      description,
      location,
      managed: true,
    } satisfies SkillListEntry);
  } catch (err) {
    next(err);
  }
}

// ── POST / — create or overwrite a Rhythm-managed skill ──────────────────────

opencodeSkillsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    const { name, description, content } = req.body as {
      name?: string;
      description?: string;
      content?: string;
    };
    await upsertManagedSkill(name ?? '', description, content ?? '', res, next);
  },
);

// ── PUT /:name — overwrite a Rhythm-managed skill ────────────────────────────

opencodeSkillsRouter.put(
  '/:name',
  async (req: Request, res: Response, next: NextFunction) => {
    const { name } = req.params;
    const { description, content } = req.body as {
      description?: string;
      content?: string;
    };
    await upsertManagedSkill(name, description, content ?? '', res, next);
  },
);

// ── DELETE /:name — delete a Rhythm-managed skill ────────────────────────────

opencodeSkillsRouter.delete(
  '/:name',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      let removed: boolean;
      try {
        removed = deleteManagedSkill(name);
      } catch (err) {
        if (err instanceof InvalidSkillNameError) {
          return next(new AppError(400, 'BAD_REQUEST', err.message));
        }
        throw err;
      }
      if (!removed) {
        // No managed skill by that name. Either it never existed or it is an
        // external (non-managed) skill — which Rhythm must not delete.
        return next(
          new AppError(
            404,
            'NOT_MANAGED',
            `No Rhythm-managed skill named '${name}' (external skills cannot be deleted)`,
          ),
        );
      }
      await opencodeClient.reloadSkills();
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
