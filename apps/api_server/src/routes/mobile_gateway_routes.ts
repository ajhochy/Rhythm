import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { MobileGatewayController } from '../controllers/mobile_gateway_controller';
import { AgentActivityController } from '../controllers/agent_activity_controller';
import { AppError } from '../errors/app_error';
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
import { streamBridge } from '../services/opencode_stream_bridge';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { createMobileToolsRouter } from './mobile_tools_routes';

export function createMobileGatewayRouter(): Router {
  const router = Router();
  const cloudIdentity = new MobileCloudIdentityService();
  const requireCloudUser = requireMobileCloudUser(cloudIdentity);
  let controller: MobileGatewayController | null = null;
  const agentSessions = new AgentSessionsRepository();
  const opencodeProxy = new MobileOpenCodeProxy({
    pendingInteractionResolver: async (input) => {
      const supported = new Set([
        'permission.reply',
        'question.reply',
        'question.reject',
      ]);
      if (!supported.has(input.operationId)) return null;

      const match = input.path.match(
        /^\/(permission|question)\/([^/]+)\/(reply|reject)$/,
      );
      if (!match) return null;
      const [, kind, encodedId, endpointAction] = match;
      const interactionId = decodeURIComponent(encodedId);

      if (!streamBridge.getInteraction(interactionId)) {
        if (kind === 'permission') {
          await streamBridge.recoverPendingPermissions(input.project.root);
        } else {
          await streamBridge.recoverPendingQuestions(input.project.root);
        }
      }
      const existing = streamBridge.getInteraction(interactionId);
      if (!existing) return null;
      const session = agentSessions.findById(existing.sessionId);
      if (
        !session ||
        session.ownerUserId !== input.userId ||
        session.projectId !== input.project.id
      ) {
        return null;
      }

      const body = (input.body ?? {}) as Record<string, unknown>;
      const action =
        kind === 'permission'
          ? body.reply
          : endpointAction === 'reject'
            ? 'reject'
            : 'reply';
      if (
        kind === 'permission' &&
        action !== 'once' &&
        action !== 'always' &&
        action !== 'reject'
      ) {
        throw AppError.badRequest(
          'permission reply must be once, always, or reject',
        );
      }
      const answers = body.answers;
      if (
        kind === 'question' &&
        action === 'reply' &&
        (!Array.isArray(answers) ||
          !answers.every(
            (answer) =>
              Array.isArray(answer) &&
              answer.every((value) => typeof value === 'string'),
          ))
      ) {
        throw AppError.badRequest('question answers must be a string[][]');
      }

      const interaction = await streamBridge.resolvePendingInteraction(
        interactionId,
        {
          action: action as 'once' | 'always' | 'reject' | 'reply',
          source: 'mobile',
          ...(Array.isArray(answers)
            ? { answers: answers as string[][] }
            : {}),
          ...(typeof body.message === 'string'
            ? { message: body.message }
            : {}),
        },
      );
      return {
        status: interaction.status === 'failed' ? 502 : 200,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(interaction)),
      };
    },
  });
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
        });
        if (result.contentType) res.type(result.contentType);
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
