import { json, Router, type Request, type Response } from 'express';

import type { AgentSession } from '../models/agent_session';
import type { Project } from '../models/project';
import { requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import type { AuthenticatedDayflowSourceScope } from '../integrations/dayflow/service';

export interface DayflowAuthenticatedConsentService {
  grantAuthenticatedSourceConsent(scope: AuthenticatedDayflowSourceScope): void;
  revokeAuthenticatedSourceConsent(scope: AuthenticatedDayflowSourceScope): void;
}

type Sessions = Pick<AgentSessionsRepository, 'findById'>;
type Projects = Pick<ProjectsRepository, 'findById'>;

interface ConsentRequest {
  schemaVersion: 1;
  action: 'grant' | 'revoke';
  sessionId: string;
  projectId: string;
}

const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function parseConsentRequest(value: unknown): ConsentRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'action', 'sessionId', 'projectId'];
  if (Object.keys(body).length !== keys.length || keys.some((key) => !(key in body)) ||
      body.schemaVersion !== 1 || (body.action !== 'grant' && body.action !== 'revoke') ||
      typeof body.sessionId !== 'string' || typeof body.projectId !== 'string' ||
      !opaque.test(body.sessionId) || !opaque.test(body.projectId)) return null;
  return body as unknown as ConsentRequest;
}

/**
 * The session is the existing server-owned owner/project receipt. A project
 * catalog row alone, loopback origin, SDK id, or body-supplied owner cannot
 * establish source consent.
 */
export function resolveAuthenticatedDayflowConsentScope(
  actorUserId: number,
  body: unknown,
  sessions: Sessions = new AgentSessionsRepository(),
  projects: Projects = new ProjectsRepository(),
): { action: ConsentRequest['action']; scope: AuthenticatedDayflowSourceScope } | null {
  const request = parseConsentRequest(body);
  if (!request || !Number.isSafeInteger(actorUserId) || actorUserId <= 0) return null;
  const session: AgentSession | null = sessions.findById(request.sessionId);
  const project: Project | null = projects.findById(request.projectId);
  if (!session || !project || project.archivedAt !== null ||
      session.ownerUserId !== actorUserId || session.projectId !== project.id ||
      session.parentSessionId !== null || session.isSystem || session.category !== 'chat') return null;
  return {
    action: request.action,
    scope: {
      ownerUserId: actorUserId,
      projectId: project.id,
      authorizingSessionId: session.id,
    },
  };
}

function unavailable(response: Response): void {
  response.status(403).json({ schemaVersion: 1, status: 'unavailable' });
}

/**
 * Separate from the strict loopback-only Dayflow management router. This
 * route accepts only a normal server-authenticated actor and resolves all
 * scope fields from durable server records before it mutates private config.
 */
export function createDayflowAuthenticatedManagementRouter(options: {
  service: DayflowAuthenticatedConsentService;
  sessions?: Sessions;
  projects?: Projects;
}): Router {
  const router = Router();
  router.use(requireLocalOrCloudAuth);
  router.use(json({ limit: '4kb', strict: true }));
  router.post('/source-consent', (request: Request, response: Response) => {
    const resolved = resolveAuthenticatedDayflowConsentScope(
      request.auth!.user.id,
      request.body,
      options.sessions,
      options.projects,
    );
    if (!resolved) return unavailable(response);
    try {
      if (resolved.action === 'grant') options.service.grantAuthenticatedSourceConsent(resolved.scope);
      else options.service.revokeAuthenticatedSourceConsent(resolved.scope);
      return response.status(202).json({ schemaVersion: 1, status: 'accepted' });
    } catch {
      return unavailable(response);
    }
  });
  return router;
}

export const dayflowAuthenticatedManagementTesting = {
  parseConsentRequest,
  resolveAuthenticatedDayflowConsentScope,
};
