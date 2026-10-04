import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';

import { MobileGatewayController } from '../controllers/mobile_gateway_controller';
import { AgentActivityController } from '../controllers/agent_activity_controller';
import { AppError } from '../errors/app_error';
import {
  asOpenCodeAgentId,
  asRhythmProfileId,
  PERMISSION_MODES,
  type PermissionMode,
} from '../models/agent_session';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  requireMobileDevice,
  requireMobileCloudUser,
  requireSessionOrMobileDevice,
} from '../middleware/mobile_device_auth';
import {
  requireDesktopHumanCapability,
} from '../security/human_approval_security';
import { MobileCloudIdentityService } from '../services/mobile_cloud_identity_service';
import { MobilePairingService } from '../services/mobile_pairing_service';
import { getMobilePairingService } from '../services/mobile_gateway_runtime';
import { TailscaleServeService } from '../services/tailscale_serve_service';
import {
  listMobileProjects,
  mobileProjectResponse,
  requireMobileProject,
  requireMobileProjectScope,
} from '../services/mobile_project_scope';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';
import { MobileSseProxy } from '../services/mobile_sse_proxy';
import { canUpdateMobileSessionState } from '../services/mobile_session_state_scope';
import {
  buildSafeMobileProfileCatalog,
  safeMobileSessionProfileState,
} from '../services/mobile_profile_catalog';
import { createMobileToolsRouter } from './mobile_tools_routes';
import { MediaArtifactsController } from '../controllers/media_artifacts_controller';
import { listOwnerUnscopedMobileChats } from '../services/mobile_chat_catalog';
import type { AuthContext } from '../middleware/auth_middleware';
import {
  parseCancel,
  parseCriteriaBatch,
  parseCheckpoint,
  parseCriterionWaiver,
  parseCreate,
  parsePatch,
  parsePause,
  parseResume,
  parseRunNextForProject,
  parseUsageAcknowledgement,
  parseEvidenceSelector,
  parseEvidenceVerification,
} from '../contracts/agent_workstream_contract';
import {
  parseOneShotAutomationDisableRequest,
  parseOneShotAutomationRequest,
} from '../contracts/agent_workstream_automation_contract';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import type { PersistentWorkstreamCoordinator } from '../services/persistent_workstream_coordinator';

export { buildSafeMobileProfileCatalog };
export { canUpdateMobileSessionState };

function catalogInteger(
  raw: string | null,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? '');
  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

export interface MobileGatewayRouterDependencies {
  opencodeProxy?: MobileOpenCodeProxy;
  sseProxy?: MobileSseProxy;
  workstreamCoordinator?: PersistentWorkstreamCoordinator;
}

export function createMobileGatewayRouter(dependencies: MobileGatewayRouterDependencies = {}): Router {
  const router = Router();
  const cloudIdentity = new MobileCloudIdentityService();
  const requireCloudUser = requireMobileCloudUser(cloudIdentity);
  let controller: MobileGatewayController | null = null;
  const opencodeProxy = dependencies.opencodeProxy ?? new MobileOpenCodeProxy();
  const activityController = new AgentActivityController();
  const sseProxy = dependencies.sseProxy ?? new MobileSseProxy();
  const tailscaleServe = new TailscaleServeService();
  const mediaArtifacts = new MediaArtifactsController();
  const requireArtifactProjectScope = requireMobileProjectScope();
  const workstreamCoordinator = dependencies.workstreamCoordinator;
  const workstreams = new AgentWorkstreamsRepository();
  const getPairingService = (): MobilePairingService =>
    getMobilePairingService();

  // A paired device is already authenticated by a bearer-equivalent device
  // credential.  The coordinator needs only a non-empty proof and the owner
  // id; this synthetic marker is never persisted, logged, or exposed and does
  // not inspect the device token itself.
  const mobileWorkstreamAuth = (req: Request): AuthContext => {
    if (!req.mobileDevice || !Number.isSafeInteger(req.mobileDevice.userId)) {
      throw AppError.unauthorized('Mobile device authentication is required');
    }
    return {
      sessionToken: `mobile-device:${req.mobileDevice.id}`,
      user: { id: req.mobileDevice.userId } as AuthContext['user'],
    };
  };
  const mobileWorkstreamProject = (req: Request): string => {
    const projectId = req.mobileProject?.id;
    if (!projectId) throw AppError.badRequest('A registered mobile project is required for workstreams');
    return projectId;
  };
  const requireWorkstreamCoordinator = (): PersistentWorkstreamCoordinator => {
    if (!env.workstreamsEnabled || !workstreamCoordinator) throw AppError.notFound('Workstream coordinator');
    return workstreamCoordinator;
  };

  const getController = (): MobileGatewayController => {
    if (controller) return controller;
    controller = new MobileGatewayController(getPairingService());
    return controller;
  };

  const withController = (
    action: (
      activeController: MobileGatewayController,
      req: Request,
      res: Response,
      next: NextFunction,
    ) => void,
  ) => (req: Request, res: Response, next: NextFunction): void => {
    try {
      action(getController(), req, res, next);
    } catch (error) {
      next(error instanceof AppError ? error : AppError.internal());
    }
  };

  router.post(
    '/pairing-codes',
    requireCloudUser,
    requireDesktopHumanCapability,
    withController((active, req, res, next) =>
      active.createPairingCode(req, res, next)),
  );
  router.post(
    '/pair',
    withController((active, req, res, next) =>
      active.pair(req, res, next)),
  );
  router.post(
    '/bootstrap/connect',
    requireCloudUser,
    withController((active, req, res, next) =>
      active.connectCloudDevice(req, res, next)),
  );
  router.get(
    '/devices',
    requireCloudUser,
    requireDesktopHumanCapability,
    withController((active, req, res, next) =>
      active.listDevices(req, res, next)),
  );
  router.delete(
    '/devices/:id',
    requireSessionOrMobileDevice(getPairingService, cloudIdentity),
    (req, res, next) => {
      if (req.mobileDevice) {
        next();
        return;
      }
      requireDesktopHumanCapability(req, res, next);
    },
    withController((active, req, res, next) =>
      active.revokeDevice(req, res, next)),
  );
  router.get(
    '/health',
    withController((active, req, res) => active.health(req, res)),
  );
  router.get(
    '/chat-catalog',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const query = new URL(req.originalUrl, 'http://mobile.local')
          .searchParams;
        const page = await listOwnerUnscopedMobileChats({
          archived: query.get('archived') === 'true',
          cursor: catalogInteger(query.get('cursor'), 0, Number.MAX_SAFE_INTEGER),
          limit: catalogInteger(query.get('limit'), 100, 100) || 100,
          ownerUserId: req.mobileDevice!.userId,
          projectId: req.mobileProject!.id,
          ...(query.get('search')?.trim()
            ? { sessionId: query.get('search')!.trim() }
            : {}),
        });
        if (page.nextCursor !== null) {
          res.setHeader('x-next-cursor', String(page.nextCursor));
        }
        res.json(page.items);
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );
  router.get(
    '/access',
    requireCloudUser,
    requireDesktopHumanCapability,
    async (_req, res, next) => {
      try {
        res.json(await tailscaleServe.diagnose());
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );
  router.post(
    '/access/enable',
    requireCloudUser,
    requireDesktopHumanCapability,
    async (_req, res, next) => {
      try {
        res.json(await tailscaleServe.ensureConfigured());
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );
  router.post(
    '/project',
    requireMobileDevice(getPairingService),
    requireMobileProject(),
    (req, res, next) => {
      try {
        res.json(mobileProjectResponse(req));
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );
  router.get(
    '/projects',
    requireMobileDevice(getPairingService),
    (_req, res, next) => {
      try {
        res.json({ projects: listMobileProjects() });
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );
  router.get(
    '/agent-activity',
    requireMobileDevice(getPairingService),
    (req, res, next) => activityController.list(req, res, next),
  );
  router.get(
    '/profile-catalog',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    (_req, res, next) => {
      try {
        res.json(buildSafeMobileProfileCatalog(
          new AgentConfigsRepository().list(),
        ));
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );
  // Mobile is a projection of the same coordinator, not a second queue or
  // session runner.  Every action below resolves the paired device's owner
  // and registered project before calling the shared durable authority.
  router.get(
    '/workstreams',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const limitRaw = new URL(req.originalUrl, 'http://mobile.local').searchParams.get('limit');
        const limit = limitRaw === null ? 50 : Number(limitRaw);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
          throw AppError.badRequest('limit must be 1..100');
        }
        const cursor = new URL(req.originalUrl, 'http://mobile.local').searchParams.get('cursor') ?? undefined;
        if (cursor !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor)) {
          throw AppError.badRequest('invalid cursor');
        }
        res.json(await requireWorkstreamCoordinator().list(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), limit, cursor,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    (req, res, next) => {
      try {
        requireWorkstreamCoordinator();
        const scope = mobileWorkstreamProject(req);
        const input = parseCreate(req.body);
        if (input.projectId !== scope) throw AppError.badRequest('projectId must match the selected mobile project');
        const created = workstreams.create(mobileWorkstreamAuth(req).user.id, input);
        if (created.conflict) {
          res.status(409).json({ error: 'create_key_conflict' });
          return;
        }
        res.status(created.replay ? 200 : 201).json(created.row);
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.get(
    '/workstreams/:id/automation',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        res.json(await requireWorkstreamCoordinator().automationStatus(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.put(
    '/workstreams/:id/automation',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const coordinator = requireWorkstreamCoordinator();
        res.json(await coordinator.configureAutomation(
          mobileWorkstreamAuth(req),
          mobileWorkstreamProject(req),
          req.params.id,
          parseOneShotAutomationRequest(req.body, new Date()),
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/automation/disable',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const parsed = parseOneShotAutomationDisableRequest(req.body);
        res.json(await requireWorkstreamCoordinator().disableAutomation(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parsed.expectedRevision, parsed.planId,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.get(
    '/workstreams/:id',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        res.json(await requireWorkstreamCoordinator().status(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.get(
    '/workstreams/:id/evidence',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const sourceId = new URL(req.originalUrl, 'http://mobile.local').searchParams.get('sourceId');
        res.json(await requireWorkstreamCoordinator().inspectEvidence(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id, parseEvidenceSelector(sourceId),
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.patch(
    '/workstreams/:id',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    (req, res, next) => {
      try {
        requireWorkstreamCoordinator();
        const auth = mobileWorkstreamAuth(req);
        const scope = mobileWorkstreamProject(req);
        const existing = workstreams.find(auth.user.id, scope, req.params.id);
        if (!existing) throw AppError.notFound('Workstream');
        const patch = parsePatch(req.body);
        if (patch.checkpoint !== undefined) patch.checkpoint = parseCheckpoint(patch.checkpoint, scope);
        const revised = workstreams.revise(auth.user.id, scope, req.params.id, patch.expectedRevision, patch);
        if (!revised) throw AppError.conflict('workstream revision changed; refresh before editing');
        res.json(revised);
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/run-next',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const coordinator = requireWorkstreamCoordinator();
        const scope = mobileWorkstreamProject(req);
        res.json(await coordinator.runNext(
          mobileWorkstreamAuth(req), scope, req.params.id,
          parseRunNextForProject(req.body, scope),
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/pause',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        res.json(await requireWorkstreamCoordinator().pause(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parsePause(req.body),
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/resume',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        res.json(await requireWorkstreamCoordinator().resume(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parseResume(req.body),
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/cancel',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const parsed = parseCancel(req.body);
        res.json(await requireWorkstreamCoordinator().cancel(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parsed.expectedRevision, parsed.jobId,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/usage-acknowledgement',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const parsed = parseUsageAcknowledgement(req.body);
        res.json(await requireWorkstreamCoordinator().acknowledgeUsageEstimate(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parsed.expectedRevision, parsed.jobId, parsed.accept,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/reconcile-unknown',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const parsed = parseCancel(req.body);
        res.json(await requireWorkstreamCoordinator().reconcileUnknownFromEngine(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parsed.expectedRevision, parsed.jobId,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/criteria/waive',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const parsed = parseCriterionWaiver(req.body);
        res.json(await requireWorkstreamCoordinator().waiveCriterion(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parsed.expectedRevision, parsed.jobId, parsed.criterionId,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/criteria/waive-batch',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const parsed = parseCriteriaBatch(req.body);
        res.json(await requireWorkstreamCoordinator().waiveCriteria(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parsed.expectedRevision, parsed.jobId, parsed.criterionIds,
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.post(
    '/workstreams/:id/criteria/verify',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        res.json(await requireWorkstreamCoordinator().verifyCriteriaFromEvidence(
          mobileWorkstreamAuth(req), mobileWorkstreamProject(req), req.params.id,
          parseEvidenceVerification(req.body),
        ));
      } catch (error) { next(error instanceof AppError ? error : AppError.internal()); }
    },
  );
  router.get(
    '/artifacts/:id',
    requireMobileDevice(getPairingService),
    (req, res, next) => {
      const projectAlias = req.header('X-Rhythm-Project');
      if (!req.header('X-Rhythm-Project-ID') && projectAlias) {
        req.headers['x-rhythm-project-id'] = projectAlias;
      }
      requireArtifactProjectScope(req, res, next);
    },
    (req, res, next) => void mediaArtifacts.serve(req, res, next),
  );
  router.patch(
    '/sessions/:id/state',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    (req, res, next) => {
      try {
        const sessions = new AgentSessionsRepository();
        const session = sessions.findBySdkSessionId(req.params.id);
        if (
          !session ||
          !canUpdateMobileSessionState(
            session,
            req.mobileDevice!.userId,
            req.mobileProject!.id,
          )
        ) {
          throw AppError.notFound('Mobile session');
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const profileId = body.profileId;
        if (
          profileId !== null &&
          (typeof profileId !== 'string' || profileId.trim() === '')
        ) {
          throw AppError.badRequest(
            'profileId must be a non-empty string or null',
          );
        }
        if (
          body.providerId !== null &&
          typeof body.providerId !== 'string'
        ) {
          throw AppError.badRequest('providerId must be a string or null');
        }
        if (
          body.modelId !== null &&
          typeof body.modelId !== 'string'
        ) {
          throw AppError.badRequest('modelId must be a string or null');
        }
        if (
          body.modelMode !== undefined &&
          body.modelMode !== 'auto' &&
          body.modelMode !== 'fixed'
        ) {
          throw AppError.badRequest("modelMode must be 'auto' or 'fixed'");
        }
        if (
          body.thinkingBudget !== null &&
          (
            typeof body.thinkingBudget !== 'number' ||
            !Number.isInteger(body.thinkingBudget) ||
            body.thinkingBudget < 0
          )
        ) {
          throw AppError.badRequest(
            'thinkingBudget must be a non-negative integer or null',
          );
        }
        if (
          typeof body.permissionMode !== 'string' ||
          !PERMISSION_MODES.includes(body.permissionMode as PermissionMode)
        ) {
          throw AppError.badRequest(
            `permissionMode must be one of: ${PERMISSION_MODES.join(', ')}`,
          );
        }

        let opencodeAgentId: string | null = null;
        if (typeof profileId === 'string') {
          const profile = new AgentConfigsRepository().getById(
            profileId.trim(),
          );
          if (
            !profile ||
            !profile.sessionSelectable ||
            agentConfigExecutionBlockReason(profile) !== null ||
            !profile.ocAgent
          ) {
            throw AppError.notFound('Mobile profile');
          }
          opencodeAgentId = profile.ocAgent;
          if (
            typeof body.opencodeAgentId === 'string' &&
            body.opencodeAgentId !== opencodeAgentId
          ) {
            throw AppError.badRequest(
              'opencodeAgentId does not match the selected profile',
            );
          }
        } else if (
          body.opencodeAgentId !== null &&
          body.opencodeAgentId !== undefined
        ) {
          throw AppError.badRequest(
            'opencodeAgentId must be null when profileId is null',
          );
        }

        sessions.updateFields(session.id, {
          profileId: typeof profileId === 'string'
            ? asRhythmProfileId(profileId.trim())
            : null,
          opencodeAgentId: opencodeAgentId
            ? asOpenCodeAgentId(opencodeAgentId)
            : null,
          providerId: body.providerId as string | null,
          modelId: body.modelId as string | null,
          // 'auto' clears router_decided_at (see updateFields); 'fixed' pins.
          ...(body.modelMode !== undefined
            ? { modelMode: body.modelMode as 'auto' | 'fixed' }
            : {}),
          thinkingBudget: body.thinkingBudget as number | null,
          permissionMode: body.permissionMode as PermissionMode,
        });
        res.json(safeMobileSessionProfileState(
          sessions.findById(session.id)!,
          new AgentConfigsRepository().list(),
        ));
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );
  const streamEvents = (sessionId?: string) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authorization = req.header('Authorization') ?? '';
      const token = authorization.match(/^Device\s+(\S+)$/i)?.[1] ?? '';
      const deviceId = req.mobileDevice?.id;
      try {
        await sseProxy.stream({
          request: req,
          response: res,
          project: req.mobileProject!,
          userId: req.mobileDevice!.userId,
          ...(sessionId ? { sessionId } : {}),
          isDeviceActive: () => {
            const active = getPairingService().authenticateDevice(token);
            return active !== null && active.id === deviceId;
          },
        });
      } catch (error) {
        if (res.headersSent) {
          res.end();
          return;
        }
        next(error instanceof AppError ? error : AppError.internal());
      }
    };
  router.get(
    '/events',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    (req, res, next) => {
      void streamEvents()(req, res, next);
    },
  );
  router.get(
    '/sessions/:id/events',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    (req, res, next) => {
      void streamEvents(req.params.id)(req, res, next);
    },
  );
  router.use(
    '/tools',
    requireMobileDevice(getPairingService),
    createMobileToolsRouter(),
  );
  router.all(
    '/opencode/*',
    requireMobileDevice(getPairingService),
    requireMobileProjectScope(),
    async (req, res, next) => {
      try {
        const proxyPath = req.path.slice('/opencode'.length);
        const query = new URL(req.originalUrl, 'http://mobile.local')
          .searchParams;
        const result = await opencodeProxy.forward({
          method: req.method,
          path: proxyPath,
          query,
          body: req.body,
          project: req.mobileProject!,
          userId: req.mobileDevice!.userId,
          deviceId: req.mobileDevice!.id,
          accept: req.header('accept'),
          ownerUnscopedDiscovery:
            req.header('x-rhythm-session-discovery') === 'owner-unscoped',
          remoteAttachDesktop:
            req.header('x-rhythm-client-capability') === 'remote-attach-desktop-v1',
        });
        if (result.contentType) res.type(result.contentType);
        for (const [name, value] of Object.entries(result.headers ?? {})) {
          res.set(name, value);
        }
        res.status(result.status);
        if (result.body.byteLength === 0) {
          res.end();
          return;
        }
        res.send(Buffer.from(result.body));
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );

  // Mobile requests can contain device credentials, provider tokens, prompts,
  // or file content. Keep them out of the generic error handler, whose
  // diagnostic payload includes request bodies for unexpected failures.
  router.use((
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    const safeError = error instanceof AppError
      ? error
      : AppError.internal();
    res.status(safeError.statusCode).json({
      error: { code: safeError.code, message: safeError.message },
    });
  });

  return router;
}
