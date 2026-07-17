/**
 * org_skills_routes.ts — #1053 (OCU-12).
 *
 * Hosts the org's shared skill library on the production API in the
 * engine-compatible `skills.urls` format the vendored fork's
 * `skill/discovery.ts` `Discovery.pull` expects: a public `index.json`
 * listing `{ name, files: string[] }` per skill, plus a public per-file GET.
 * (Read-only reference: apps/opencode_fork/packages/opencode/src/skill/discovery.ts —
 * never imported here, see AGENTS.md on the vendored subtree.)
 *
 * Mounted at /org-skills in app.ts, OUTSIDE the agentExecutionEnabled gate —
 * this is a core, always-on production API surface (like /tasks or
 * /facilities), not an agent-runtime surface: the 'cloud' deployment role
 * (production) has agentExecutionEnabled=false but MUST still serve this
 * route. #1054 (out of scope here) will point a running engine's
 * `skills.urls` config at this endpoint.
 *
 * IMPORTANT — org skills must contain no secrets. Reads (GET index.json,
 * GET files/:name/:file) are UNAUTHENTICATED BY DESIGN: the fork's discovery
 * downloader fetches them anonymously, and any machine running the org's
 * engine needs to read them without a login. Keep read responses to exactly
 * the documented shape (name/files for the index; the raw skill body for a
 * file) — never add internal DB fields or auth-adjacent metadata to a GET
 * payload. Writes (POST/PUT/DELETE) require the same JWT session-token auth
 * as every other authenticated route (requireAuth) — an org skill only
 * becomes public once an authenticated caller publishes it.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { AppError } from '../errors/app_error';
import { OrgSkillsRepository } from '../repositories/org_skills_repository';

export const orgSkillsRouter = Router();

/**
 * The only file this single-file skill model ever serves. ponytail: a
 * multi-file skill (bundled references/scripts) would need a files table;
 * not needed until #1056's publish pipeline requires more than SKILL.md.
 */
const SKILL_FILE = 'SKILL.md';

// ── GET /index.json — public, fork-discovery-compatible index ───────────────

orgSkillsRouter.get('/index.json', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = new OrgSkillsRepository();
    const skills = await repo.listPublishedAsync();
    res.json({
      skills: skills.map((s) => ({ name: s.name, files: [SKILL_FILE] })),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /files/:name/:file — public, raw file body ───────────────────────────
//
// Single-file model: only SKILL.md is ever servable. Any other requested file
// name, an unpublished skill, or an unknown name all 404 identically — an
// unpublished skill must not be readable by guessing its name.

orgSkillsRouter.get(
  '/files/:name/:file',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, file } = req.params;
      if (file !== SKILL_FILE) {
        return next(AppError.notFound(`file '${file}'`));
      }
      const repo = new OrgSkillsRepository();
      const skill = await repo.findPublishedByNameAsync(name);
      if (!skill) {
        return next(AppError.notFound(`org skill '${name}'`));
      }
      res.type('text/markdown').send(skill.content);
    } catch (err) {
      next(err);
    }
  },
);

// ── everything below requires the existing JWT session-token auth ──────────

orgSkillsRouter.use(requireAuth);

function readSkillBody(req: Request): { description?: string; content?: string; published?: boolean } {
  const { description, content, published } = req.body as {
    description?: string;
    content?: string;
    published?: boolean;
  };
  return { description, content, published };
}

orgSkillsRouter.post('/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const { description, content, published } = readSkillBody(req);
    if (!name || name.trim() === '') {
      return next(AppError.badRequest('name is required'));
    }
    if (typeof content !== 'string' || content.trim() === '') {
      return next(AppError.badRequest('content (the SKILL.md body) is required'));
    }
    const repo = new OrgSkillsRepository();
    const skill = await repo.upsertAsync(name, { description, content, published });
    res.status(201).json(skill);
  } catch (err) {
    next(err);
  }
});

orgSkillsRouter.put('/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const { description, content, published } = readSkillBody(req);
    if (typeof content !== 'string' || content.trim() === '') {
      return next(AppError.badRequest('content (the SKILL.md body) is required'));
    }
    const repo = new OrgSkillsRepository();
    const skill = await repo.upsertAsync(name, { description, content, published });
    res.status(200).json(skill);
  } catch (err) {
    next(err);
  }
});

orgSkillsRouter.delete('/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const repo = new OrgSkillsRepository();
    const removed = await repo.deleteAsync(name);
    if (!removed) {
      return next(AppError.notFound(`org skill '${name}'`));
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
