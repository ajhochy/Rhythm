import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../errors/app_error';
import { UsersRepository } from '../repositories/users_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
import agentCookbookRouter from './agentCookbookRoutes';
import { agentConfigsRouter } from './agent_configs_routes';
import agentMemoryRouter from './agentMemoryRoutes';
import agentResearchRouter from './agentResearchRoutes';
import agentSchedulesRouter from './agentSchedulesRoutes';
import agentWebhookRouter from './agentWebhookRoutes';
import { opencodeCommandsRouter } from './opencode_commands_routes';
import { opencodeSkillsRouter } from './opencode_skills_routes';
import orgProposalsRouter from './org_proposals_routes';
import { runQualityRouter } from './run_quality_routes';

type MobileToolMount =
  | 'agent-memory'
  | 'agent-research'
  | 'agent-schedules'
  | 'agent-webhooks'
  | 'agent-configs'
  | 'agent-cookbook'
  | 'agent-org-proposals'
  | 'agents/run-quality'
  | 'opencode/skills'
  | 'opencode/commands';

type MobileToolPolicy = 'owner-scoped' | 'mac-global-admin';

interface MobileToolOperation {
  method: string;
  path: RegExp;
}

const ROOT = /^\/?$/;
const ID = /^\/[^/]+$/;
const ID_ACTION = (action: string): RegExp =>
  new RegExp(`^/[^/]+/${action}$`);

/**
 * This is intentionally an operation allowlist, not a prefix proxy. Several
 * desktop routers also contain administrative or unauthenticated endpoints
 * that must never become reachable through a paired iPhone.
 */
const MOBILE_TOOL_OPERATIONS: Record<
  MobileToolMount,
  readonly MobileToolOperation[]
> = {
  'agent-memory': [
    { method: 'GET', path: ROOT },
    { method: 'GET', path: /^\/search$/ },
    { method: 'GET', path: ID },
    { method: 'POST', path: ROOT },
    { method: 'PATCH', path: ID },
    { method: 'DELETE', path: ID },
  ],
  'agent-research': [
    { method: 'GET', path: ROOT },
    { method: 'GET', path: ID },
    { method: 'POST', path: ROOT },
    { method: 'POST', path: ID_ACTION('retry') },
    { method: 'DELETE', path: ID },
  ],
  'agent-schedules': [
    { method: 'GET', path: ROOT },
    { method: 'GET', path: ID },
    { method: 'POST', path: ROOT },
    { method: 'PATCH', path: ID },
    { method: 'DELETE', path: ID },
    { method: 'POST', path: ID_ACTION('trigger-now') },
  ],
  'agent-webhooks': [
    { method: 'GET', path: ROOT },
    { method: 'GET', path: ID },
    { method: 'POST', path: ROOT },
    { method: 'POST', path: ID_ACTION('rotate-secret') },
    { method: 'DELETE', path: ID },
  ],
  'agent-configs': [
    { method: 'GET', path: ROOT },
    { method: 'GET', path: ID },
    { method: 'POST', path: ROOT },
    { method: 'PATCH', path: ID },
    { method: 'DELETE', path: ID },
    { method: 'POST', path: ID_ACTION('resync-agent-file') },
  ],
  'agent-cookbook': [
    { method: 'GET', path: ROOT },
    { method: 'GET', path: ID },
    { method: 'POST', path: ROOT },
    { method: 'PATCH', path: ID },
    { method: 'DELETE', path: ID },
    { method: 'POST', path: ID_ACTION('run') },
  ],
  'agent-org-proposals': [
    { method: 'GET', path: ROOT },
    { method: 'POST', path: ID_ACTION('approve') },
    { method: 'POST', path: ID_ACTION('reject') },
  ],
  'agents/run-quality': [
    { method: 'GET', path: ROOT },
  ],
  'opencode/skills': [
    { method: 'GET', path: ROOT },
    { method: 'GET', path: ID_ACTION('content') },
    { method: 'POST', path: ROOT },
    { method: 'PUT', path: ID },
    { method: 'DELETE', path: ID },
  ],
  'opencode/commands': [
    { method: 'GET', path: ROOT },
    { method: 'GET', path: ID_ACTION('content') },
    { method: 'POST', path: ROOT },
    { method: 'PUT', path: ID },
    { method: 'DELETE', path: ID },
  ],
};

/**
 * Every mount has one explicit tenancy policy. Personal resources are scoped
 * again inside their repository/controller boundary; Mac-global resources are
 * reachable only by a verified workspace admin or an explicit global
 * admin/system principal.
 */
const MOBILE_TOOL_POLICIES: Record<MobileToolMount, MobileToolPolicy> = {
  'agent-memory': 'mac-global-admin',
  'agent-research': 'owner-scoped',
  'agent-schedules': 'owner-scoped',
  'agent-webhooks': 'owner-scoped',
  'agent-configs': 'mac-global-admin',
  'agent-cookbook': 'owner-scoped',
  'agent-org-proposals': 'mac-global-admin',
  'agents/run-quality': 'owner-scoped',
  'opencode/skills': 'mac-global-admin',
  'opencode/commands': 'mac-global-admin',
};

const MOBILE_CONFIG_RESERVED_PATHS = new Set([
  '/export',
  '/import',
  '/skill-wiring',
  '/sync-opencode',
]);

export function isMobileToolOperationAllowed(
  mount: string,
  method: string,
  path: string,
): boolean {
  if (!(mount in MOBILE_TOOL_OPERATIONS)) return false;
  if (mount === 'agent-configs' && MOBILE_CONFIG_RESERVED_PATHS.has(path)) {
    return false;
  }
  return MOBILE_TOOL_OPERATIONS[mount as MobileToolMount].some(
    (operation) =>
      operation.method === method.toUpperCase() && operation.path.test(path),
  );
}

function requireAllowedOperation(mount: MobileToolMount): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (isMobileToolOperationAllowed(mount, req.method, req.path)) {
      next();
      return;
    }
    next(AppError.notFound('MobileToolOperation'));
  };
}

function requireToolPolicy(mount: MobileToolMount): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        if (MOBILE_TOOL_POLICIES[mount] === 'owner-scoped') {
          next();
          return;
        }
        const auth = req.auth;
        const actor = auth?.user;
        if (!auth || !actor || !req.mobileDevice) {
          throw AppError.unauthorized('Missing paired administrator');
        }
        if (actor.role === 'admin' || actor.role === 'system') {
          next();
          return;
        }
        const isWorkspaceAdmin =
          await new WorkspaceRepository().hasAdminMembershipAsync(actor.id);
        if (!isWorkspaceAdmin) {
          throw AppError.forbidden(
            'Only workspace administrators can access Mac-global agent policy',
          );
        }
        // Downstream policy controllers already recognize the canonical
        // admin/system roles. Project the independently verified workspace
        // role into this request-local principal; never persist it.
        req.auth = {
          sessionToken: auth.sessionToken,
          user: { ...actor, role: 'admin' },
        };
        next();
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    })();
  };
}

async function attachPairedUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.mobileDevice) {
      throw AppError.unauthorized('Missing paired device');
    }
    const user = await new UsersRepository().findByIdAsync(
      req.mobileDevice.userId,
    );
    req.auth = {
      sessionToken: `mobile-device:${req.mobileDevice.id}`,
      user,
    };
    next();
  } catch (error) {
    next(error instanceof AppError ? error : AppError.internal());
  }
}

export function createMobileToolsRouter(): Router {
  const router = Router();
  router.use(attachPairedUser);
  router.use(
    '/agent-memory',
    requireAllowedOperation('agent-memory'),
    requireToolPolicy('agent-memory'),
    agentMemoryRouter,
  );
  router.use(
    '/agent-research',
    requireAllowedOperation('agent-research'),
    requireToolPolicy('agent-research'),
    agentResearchRouter,
  );
  router.use(
    '/agent-schedules',
    requireAllowedOperation('agent-schedules'),
    requireToolPolicy('agent-schedules'),
    agentSchedulesRouter,
  );
  router.use(
    '/agent-webhooks',
    requireAllowedOperation('agent-webhooks'),
    requireToolPolicy('agent-webhooks'),
    agentWebhookRouter,
  );
  router.use(
    '/agent-configs',
    requireAllowedOperation('agent-configs'),
    requireToolPolicy('agent-configs'),
    agentConfigsRouter,
  );
  router.use(
    '/agent-cookbook',
    requireAllowedOperation('agent-cookbook'),
    requireToolPolicy('agent-cookbook'),
    agentCookbookRouter,
  );
  router.use(
    '/agent-org-proposals',
    requireAllowedOperation('agent-org-proposals'),
    requireToolPolicy('agent-org-proposals'),
    orgProposalsRouter,
  );
  router.use(
    '/agents/run-quality',
    requireAllowedOperation('agents/run-quality'),
    requireToolPolicy('agents/run-quality'),
    runQualityRouter,
  );
  router.use(
    '/opencode/skills',
    requireAllowedOperation('opencode/skills'),
    requireToolPolicy('opencode/skills'),
    opencodeSkillsRouter,
  );
  router.use(
    '/opencode/commands',
    requireAllowedOperation('opencode/commands'),
    requireToolPolicy('opencode/commands'),
    opencodeCommandsRouter,
  );
  return router;
}
