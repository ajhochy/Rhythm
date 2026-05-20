import os from 'os';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { ProjectsRepository, type ProjectVcsFields } from '../repositories/projects_repository';
import { probeVcs, listBranches, gitCheckout } from '../services/vcs_probe';

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return p.replace('~', os.homedir());
  return p;
}

function normalizeCwd(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw AppError.badRequest('cwd is required and must be a non-empty string');
  }
  const expanded = expandHome(input.trim());
  if (!path.isAbsolute(expanded)) {
    throw AppError.badRequest('cwd must be an absolute path');
  }
  // Strip trailing slashes (except root).
  return expanded.length > 1 ? expanded.replace(/\/+$/, '') : expanded;
}

function probeFields(cwd: string): ProjectVcsFields {
  const probed = probeVcs(cwd);
  const checkedAt = new Date().toISOString();
  if (!probed) {
    return { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: checkedAt };
  }
  return {
    vcsRoot: probed.vcsRoot,
    vcsBranch: probed.vcsBranch,
    vcsDirty: probed.vcsDirty,
    vcsCheckedAt: checkedAt,
  };
}

const repo = new ProjectsRepository();

export class ProjectsController {
  list(req: Request, res: Response, next: NextFunction): void {
    try {
      const includeArchived = String(req.query.includeArchived ?? '').toLowerCase() === 'true';
      res.json(repo.list({ includeArchived }));
    } catch (err) {
      next(err);
    }
  }

  getOne(req: Request, res: Response, next: NextFunction): void {
    try {
      const project = repo.findById(req.params.id);
      if (!project) throw AppError.notFound('Project');
      res.json(project);
    } catch (err) {
      next(err);
    }
  }

  create(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { name, icon } = body;
      if (typeof name !== 'string' || name.trim() === '') {
        throw AppError.badRequest('name is required and must be a non-empty string');
      }
      if (icon !== undefined && icon !== null && typeof icon !== 'string') {
        throw AppError.badRequest('icon must be a string');
      }
      const cwd = normalizeCwd(body.cwd);
      // Reject duplicates so the rail never shows two icons for the same
      // folder and sessions auto-assign deterministically.
      const existing = repo.findByExactCwd(cwd);
      if (existing) {
        throw AppError.badRequest(
          `A project already exists at this folder ("${existing.name}").`,
        );
      }
      const project = repo.insert({
        name: name.trim(),
        cwd,
        icon: typeof icon === 'string' ? icon : null,
        vcs: probeFields(cwd),
      });
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  }

  update(req: Request, res: Response, next: NextFunction): void {
    try {
      const existing = repo.findById(req.params.id);
      if (!existing) throw AppError.notFound('Project');

      const body = (req.body ?? {}) as Record<string, unknown>;
      const fields: {
        name?: string;
        cwd?: string;
        icon?: string | null;
        archivedAt?: string | null;
      } = {};

      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim() === '') {
          throw AppError.badRequest('name must be a non-empty string');
        }
        fields.name = body.name.trim();
      }
      if (body.icon !== undefined) {
        if (body.icon !== null && typeof body.icon !== 'string') {
          throw AppError.badRequest('icon must be a string or null');
        }
        fields.icon = body.icon as string | null;
      }
      if (body.archivedAt !== undefined) {
        if (body.archivedAt !== null && typeof body.archivedAt !== 'string') {
          throw AppError.badRequest('archivedAt must be an ISO string or null');
        }
        fields.archivedAt = body.archivedAt as string | null;
      }
      let cwdChanged = false;
      if (body.cwd !== undefined) {
        fields.cwd = normalizeCwd(body.cwd);
        cwdChanged = fields.cwd !== existing.cwd;
      }

      repo.updateFields(existing.id, fields);
      if (cwdChanged && fields.cwd) {
        repo.updateVcs(existing.id, probeFields(fields.cwd));
      }
      res.json(repo.findById(existing.id)!);
    } catch (err) {
      next(err);
    }
  }

  remove(req: Request, res: Response, next: NextFunction): void {
    try {
      const project = repo.findById(req.params.id);
      if (!project) throw AppError.notFound('Project');
      repo.delete(project.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  refreshVcs(req: Request, res: Response, next: NextFunction): void {
    try {
      const project = repo.findById(req.params.id);
      if (!project) throw AppError.notFound('Project');
      repo.updateVcs(project.id, probeFields(project.cwd));
      res.json(repo.findById(project.id)!);
    } catch (err) {
      next(err);
    }
  }

  getBranches(req: Request, res: Response, next: NextFunction): void {
    try {
      const project = repo.findById(req.params.id);
      if (!project) throw AppError.notFound('Project');
      const branches = listBranches(project.cwd);
      if (!branches) {
        // Not a git repo — return empty lists instead of 404.
        res.json({ current: null, local: [], recent: [] });
        return;
      }
      res.json(branches);
    } catch (err) {
      next(err);
    }
  }

  checkout(req: Request, res: Response, next: NextFunction): void {
    try {
      const project = repo.findById(req.params.id);
      if (!project) throw AppError.notFound('Project');

      const body = (req.body ?? {}) as Record<string, unknown>;
      const { branch, stash, createBranch } = body;

      if (typeof branch !== 'string' || branch.trim() === '') {
        throw AppError.badRequest('branch is required and must be a non-empty string');
      }

      const stashMode = stash === 'stash' ? 'stash' : stash === 'discard' ? 'discard' : 'none';

      const result = gitCheckout(project.cwd, branch.trim(), {
        stash: stashMode,
        createBranch: createBranch === true,
      });

      if (!result.ok) {
        res.status(409).json({ error: result.stderr });
        return;
      }

      // Re-probe VCS so the response reflects the new branch.
      repo.updateVcs(project.id, probeFields(project.cwd));
      res.json(repo.findById(project.id)!);
    } catch (err) {
      next(err);
    }
  }
}
