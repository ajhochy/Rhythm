import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../errors/app_error';
import { UsersRepository } from '../repositories/users_repository';
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
    agentMemoryRouter,
  );
  router.use(
    '/agent-research',
    requireAllowedOperation('agent-research'),
    agentResearchRouter,
  );
  router.use(
    '/agent-schedules',
    requireAllowedOperation('agent-schedules'),
    agentSchedulesRouter,
  );
  router.use(
    '/agent-webhooks',
    requireAllowedOperation('agent-webhooks'),
    agentWebhookRouter,
  );
  router.use(
    '/agent-configs',
    requireAllowedOperation('agent-configs'),
    agentConfigsRouter,
  );
  router.use(
    '/agent-cookbook',
    requireAllowedOperation('agent-cookbook'),
    agentCookbookRouter,
  );
  router.use(
    '/agent-org-proposals',
    requireAllowedOperation('agent-org-proposals'),
    orgProposalsRouter,
  );
  router.use(
    '/agents/run-quality',
    requireAllowedOperation('agents/run-quality'),
    runQualityRouter,
  );
  router.use(
    '/opencode/skills',
    requireAllowedOperation('opencode/skills'),
    opencodeSkillsRouter,
  );
  router.use(
    '/opencode/commands',
    requireAllowedOperation('opencode/commands'),
    opencodeCommandsRouter,
  );
  return router;
}
