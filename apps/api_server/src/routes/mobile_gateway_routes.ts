import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { MobileGatewayController } from '../controllers/mobile_gateway_controller';
import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import {
  initializeMobilePairingSchema,
  MobileDevicesRepository,
} from '../repositories/mobile_devices_repository';
import { MobilePairingService } from '../services/mobile_pairing_service';

export function createMobileGatewayRouter(): Router {
  const router = Router();
  let controller: MobileGatewayController | null = null;

  const getController = (): MobileGatewayController => {
    if (controller) return controller;
    const db = getDb();
    initializeMobilePairingSchema(db);
    const repository = new MobileDevicesRepository(db);
    controller = new MobileGatewayController(
      new MobilePairingService({
        repository,
        hostId: repository.findHostId() ?? randomUUID(),
      }),
    );
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

  router.post('/pairing-codes', withController((active, req, res, next) =>
    active.createPairingCode(req, res, next)));
  router.post('/pair', withController((active, req, res, next) =>
    active.pair(req, res, next)));
  router.get('/devices', withController((active, req, res, next) =>
    active.listDevices(req, res, next)));
  router.delete('/devices/:id', withController((active, req, res, next) =>
    active.revokeDevice(req, res, next)));
  router.get('/health', withController((active, req, res) => active.health(req, res)));

  return router;
}
