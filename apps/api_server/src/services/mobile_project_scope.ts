import { statSync } from 'node:fs';
import {
  isAbsolute,
  relative,
  resolve as pathResolve,
} from 'node:path';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../errors/app_error';
import { ProjectsRepository } from '../repositories/projects_repository';
import { canonicalize, containsReal } from '../utils/path_containment';

export interface MobileProjectScope {
  id: string;
  root: string;
}

export type MobileProjectsReader = Pick<ProjectsRepository, 'findById'>;
export type MobileProjectsCatalogReader = Pick<
  ProjectsRepository,
  'findById' | 'list'
>;

export interface MobileProjectCatalogItem {
  id: string;
  name: string;
  icon: string | null;
}

declare global {
  namespace Express {
    interface Request {
      mobileProject?: MobileProjectScope;
      mobileProjectPath?: string;
    }
  }
}

function unavailableProject(): AppError {
  return AppError.notFound('Mobile project');
}

/**
 * #1422 — the containment root for a session that carries no project.
 *
 * Fails CLOSED: a configured root that does not exist, is not a directory, or
 * cannot be canonicalized raises rather than silently widening scope to the
 * process cwd or `/`.
 */
function resolveDefaultSessionScope(): MobileProjectScope {
  const configured = env.defaultSessionRoot?.trim();
  // An empty value must NOT reach canonicalize(): it resolves to the process
  // cwd, which would silently anchor every project-less session to wherever
  // the server happens to be running.
  if (!configured) throw unavailableProject();
  try {
    const root = canonicalize(configured);
    if (!statSync(root).isDirectory() || !containsReal(root, root)) {
      throw unavailableProject();
    }
    // Empty id == "no project", matching how desktop persists an unassigned
    // session (agent_sessions.project_id NULL / ''). It is deliberately not a
    // sentinel that could collide with a real opaque project id.
    return { id: '', root };
  } catch {
    throw unavailableProject();
  }
}

/**
 * Resolve an active Rhythm project by its opaque repository ID. The caller
 * cannot supply a filesystem root; the canonical root always comes from the
 * persisted project row.
 *
 * Deliberately still STRICT about an empty id. The #1422 default-root fallback
 * lives in requireMobileProjectScope, not here, because this function is also
 * the per-row validator behind listMobileProjects — falling back here would
 * make a malformed empty project id resolve to the default root and list
 * itself as an available project.
 */
export function resolveMobileProject(
  projectId: unknown,
  projects: MobileProjectsReader = new ProjectsRepository(),
): MobileProjectScope {
  if (typeof projectId !== 'string' || projectId.trim() === '') {
    throw AppError.badRequest('X-Rhythm-Project-ID is required');
  }

  const project = projects.findById(projectId.trim());
  if (!project || project.archivedAt !== null) throw unavailableProject();

  try {
    const root = canonicalize(project.cwd);
    if (!statSync(root).isDirectory() || !containsReal(root, root)) {
      throw unavailableProject();
    }
    return { id: project.id, root };
  } catch {
    throw unavailableProject();
  }
}

/**
 * Return only opaque, display-safe metadata for active registered projects
 * whose current canonical roots are still usable. Filesystem roots, VCS roots,
 * and other desktop-only details must never cross the phone gateway.
 */
export function listMobileProjects(
  projects: MobileProjectsCatalogReader = new ProjectsRepository(),
): MobileProjectCatalogItem[] {
  const catalog: MobileProjectCatalogItem[] = [];
  for (const project of projects.list()) {
    try {
      resolveMobileProject(project.id, projects);
      catalog.push({
        id: project.id,
        name: project.name,
        icon: project.icon,
      });
    } catch {
      // Stale/missing roots are unavailable through every mobile surface.
    }
  }
  return catalog;
}

/**
 * Resolve a mobile-provided path at point of use and prove it remains inside
 * the canonical repository-owned root. This deliberately accepts both
 * relative and absolute operation paths: absolute paths are safe only when
 * their realpath is contained by the selected project.
 */
export function resolveMobileProjectPath(
  scope: MobileProjectScope,
  mobilePath: unknown,
): string {
  if (typeof mobilePath !== 'string' || mobilePath.includes('\0')) {
    throw AppError.forbidden('Project path is outside the selected project');
  }

  const target = isAbsolute(mobilePath)
    ? pathResolve(mobilePath)
    : pathResolve(scope.root, mobilePath);
  let canonicalTarget: string;
  try {
    canonicalTarget = canonicalize(target);
  } catch {
    throw AppError.forbidden('Project path is outside the selected project');
  }
  if (!containsReal(scope.root, canonicalTarget)) {
    throw AppError.forbidden('Project path is outside the selected project');
  }
  return canonicalTarget;
}

const ROOT_OVERRIDE_FIELDS = new Set([
  'root',
  'cwd',
  'directory',
  'workingdirectory',
  'worktreedir',
  'workspace',
  'workspaceid',
  'roots',
]);

function hasOwnField(value: unknown, field: string): boolean {
  return typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, field);
}

function rejectCallerRootOverrides(req: Request): void {
  const opaqueWorktreeDirectory =
    typeof req.body === 'object' &&
    req.body !== null &&
    typeof (req.body as Record<string, unknown>).directory === 'string' &&
    /^rhythm-worktree:\/\/[A-Za-z0-9_-]{24}\/[^/\s]+$/.test(
      (req.body as Record<string, unknown>).directory as string,
    ) &&
    (
      (
        req.method === 'POST' &&
        /\/opencode\/experimental\/worktree\/reset$/.test(req.path)
      ) ||
      (
        req.method === 'DELETE' &&
        /\/opencode\/experimental\/worktree$/.test(req.path)
      )
    );
  const hasOverride = (
    value: unknown,
    allowOpaqueDirectory = false,
  ): boolean =>
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).some((field) =>
      ROOT_OVERRIDE_FIELDS.has(field.toLowerCase()) &&
      !(allowOpaqueDirectory && field === 'directory'));
  if (
    req.header('X-Rhythm-Project-Root') !== undefined ||
    req.header('X-Rhythm-Root') !== undefined ||
    hasOverride(req.body, opaqueWorktreeDirectory) ||
    hasOverride(req.query)
  ) {
    throw AppError.forbidden(
      'Project roots are resolved from the registered Rhythm project',
    );
  }
}

/**
 * Resolve and attach the selected project after device authentication. Routes
 * must register `requireMobileDevice` before this middleware.
 */
export function requireMobileProject(
  projects: MobileProjectsReader = new ProjectsRepository(),
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      rejectCallerRootOverrides(req);
      const scope = resolveMobileProject(
        req.header('X-Rhythm-Project-ID'),
        projects,
      );
      const requestedPath = hasOwnField(req.body, 'path')
        ? (req.body as Record<string, unknown>).path
        : '.';
      req.mobileProject = scope;
      req.mobileProjectPath = resolveMobileProjectPath(scope, requestedPath);
      next();
    } catch (error) {
      next(error instanceof AppError ? error : AppError.internal());
    }
  };
}

/**
 * Resolve only the repository-owned project root for proxy operations. Unlike
 * the `/project` preflight middleware above, this deliberately does not treat
 * an OpenCode operation's own `body.path` field as a scope-preflight path.
 * Every actual filesystem target remains constrained by the injected
 * directory at the engine boundary.
 */
export function requireMobileProjectScope(
  projects: MobileProjectsReader = new ProjectsRepository(),
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      rejectCallerRootOverrides(req);
      // #1422 — a request that names a project resolves to that project's real
      // root; one that names none anchors to the configured default root
      // instead of 400ing. Either way a root exists, so resolveMobileProjectPath
      // below still has something to containment-check every path against.
      const header = req.header('X-Rhythm-Project-ID');
      req.mobileProject =
        typeof header === 'string' && header.trim() !== ''
          ? resolveMobileProject(header, projects)
          : resolveDefaultSessionScope();
      next();
    } catch (error) {
      next(error instanceof AppError ? error : AppError.internal());
    }
  };
}

export function mobileProjectResponse(req: Request): {
  projectId: string;
  path: string;
} {
  if (!req.mobileProject || !req.mobileProjectPath) {
    throw AppError.internal();
  }
  return {
    projectId: req.mobileProject.id,
    path: relative(req.mobileProject.root, req.mobileProjectPath) || '.',
  };
}
