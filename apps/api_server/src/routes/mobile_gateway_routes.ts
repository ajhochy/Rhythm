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
import { MobileCloudIdentityService } from '../services/mobile_cloud_identity_service';
import { MobilePairingService } from '../services/mobile_pairing_service';
import { getMobilePairingService } from '../services/mobile_gateway_runtime';
import {
  mobileProjectResponse,
  requireMobileProject,
  requireMobileProjectScope,
} from '../services/mobile_project_scope';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';
import { MobileSseProxy } from '../services/mobile_sse_proxy';

export function createMobileGatewayRouter(): Router {
  const router = Router();
  const cloudIdentity = new MobileCloudIdentityService();
  const requireCloudUser = requireMobileCloudUser(cloudIdentity);
  let controller: MobileGatewayController | null = null;
  const opencodeProxy = new MobileOpenCodeProxy();
  const activityController = new AgentActivityController();
  const sseProxy = new MobileSseProxy();
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
    withController((active, req, res, next) =>
      active.createPairingCode(req, res, next)),
  );
  router.post(
    '/pair',
    requireCloudUser,
    withController((active, req, res, next) =>
      active.pair(req, res, next)),
  );
  router.get(
    '/devices',
    requireCloudUser,
    withController((active, req, res, next) =>
      active.listDevices(req, res, next)),
  );
  router.delete(
    '/devices/:id',
    requireCloudUser,
    withController((active, req, res, next) =>
      active.revokeDevice(req, res, next)),
  );
  router.get(
    '/health',
    requireSessionOrMobileDevice(getPairingService, cloudIdentity),
    withController((active, req, res) => active.health(req, res)),
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
