import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import { MobilePairingService } from '../services/mobile_pairing_service';

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw AppError.badRequest(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requiredUserId(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw AppError.badRequest('userId must be a positive integer');
  }
  return parsed;
}

function forwardSecretSafe(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : AppError.internal());
}

export class MobileGatewayController {
  constructor(private readonly pairingService: MobilePairingService) {}

  health(_req: Request, res: Response): void {
    res.json(this.pairingService.health());
  }

  createPairingCode(req: Request, res: Response, next: NextFunction): void {
    try {
      const userId = requiredUserId(req.body?.userId);
      res.status(201).json(this.pairingService.createPairingCode(userId));
    } catch (error) {
      forwardSecretSafe(next, error);
    }
  }

  pair(req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(201).json(
        this.pairingService.pair({
          pairingCode: requiredString(req.body?.pairingCode, 'pairingCode'),
          userId: requiredUserId(req.body?.userId),
          deviceName: requiredString(req.body?.deviceName, 'deviceName'),
        }),
      );
    } catch (error) {
      forwardSecretSafe(next, error);
    }
  }

  listDevices(req: Request, res: Response, next: NextFunction): void {
    try {
      res.json(this.pairingService.listDevices(requiredUserId(req.query.userId)));
    } catch (error) {
      forwardSecretSafe(next, error);
    }
  }

  revokeDevice(req: Request, res: Response, next: NextFunction): void {
    try {
      const revoked = this.pairingService.revokeDevice(
        requiredString(req.params.id, 'device id'),
        requiredUserId(req.query.userId),
      );
      if (!revoked) throw AppError.notFound('Mobile device');
      res.status(204).send();
    } catch (error) {
      forwardSecretSafe(next, error);
    }
  }
}
