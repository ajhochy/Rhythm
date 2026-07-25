import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { MobileGatewayController } from '../controllers/mobile_gateway_controller';
import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import {
  requireMobileDevice,
  requireMobileCloudUser,
  requireSessionOrMobileDevice,
} from '../middleware/mobile_device_auth';
import {
  initializeMobilePairingSchema,
  MobileDevicesRepository,
} from '../repositories/mobile_devices_repository';
import { MobileCloudIdentityService } from '../services/mobile_cloud_identity_service';
import { MobilePairingService } from '../services/mobile_pairing_service';
import {
  mobileProjectResponse,
  requireMobileProject,
} from '../services/mobile_project_scope';

export function createMobileGatewayRouter(): Router {
  const router = Router();
  const cloudIdentity = new MobileCloudIdentityService();
  const requireCloudUser = requireMobileCloudUser(cloudIdentity);
  let pairingService: MobilePairingService | null = null;
  let controller: MobileGatewayController | null = null;

  const getPairingService = (): MobilePairingService => {
    if (pairingService) return pairingService;
    const db = getDb();
    initializeMobilePairingSchema(db);
    const repository = new MobileDevicesRepository(db);
    pairingService = new MobilePairingService({
      repository,
      hostId: repository.findHostId() ?? randomUUID(),
    });
    return pairingService;
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

  return router;
}
