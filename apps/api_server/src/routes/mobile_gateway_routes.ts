import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

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
import {
  buildSafeMobileProfileCatalog,
  safeMobileSessionProfileState,
} from '../services/mobile_profile_catalog';
import { createMobileToolsRouter } from './mobile_tools_routes';

export { buildSafeMobileProfileCatalog };

export function canUpdateMobileSessionState(
  session: {
    ownerUserId: number | null;
    projectId: string | null;
  } | null | undefined,
  ownerUserId: number,
  projectId: string,
): boolean {
  if (!session || session.ownerUserId !== ownerUserId) return false;
  return session.projectId === projectId ||
    session.projectId === null ||
    session.projectId.trim() === '';
}

export function createMobileGatewayRouter(): Router {
  const router = Router();
  const cloudIdentity = new MobileCloudIdentityService();
  const requireCloudUser = requireMobileCloudUser(cloudIdentity);
  let controller: MobileGatewayController | null = null;
  const opencodeProxy = new MobileOpenCodeProxy();
  const activityController = new AgentActivityController();
  const sseProxy = new MobileSseProxy();
  const tailscaleServe = new TailscaleServeService();
  const getPairingService = (): MobilePairingService =>
    getMobilePairingService();

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
          accept: req.header('accept'),
          ownerUnscopedDiscovery:
            req.header('x-rhythm-session-discovery') === 'owner-unscoped',
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
