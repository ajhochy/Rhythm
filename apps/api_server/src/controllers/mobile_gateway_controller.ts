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

function authenticatedUserId(req: Request): number {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth.user.id;
}

function rejectMismatchedClaim(claimedUserId: unknown, userId: number): void {
  if (claimedUserId === undefined) return;
  if (requiredUserId(claimedUserId) !== userId) {
    throw AppError.forbidden(
      'Authenticated Rhythm user does not match the requested user',
    );
  }
}

function consumeRequiredSecret(req: Request, field: string): string {
  const value = requiredString(req.body?.[field], field);
  if (req.body && typeof req.body === 'object') {
    delete req.body[field];
  }
  return value;
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
      res
        .status(201)
        .json(
          this.pairingService.createPairingCode(authenticatedUserId(req)),
        );
    } catch (error) {
      forwardSecretSafe(next, error);
    }
  }

  pair(req: Request, res: Response, next: NextFunction): void {
    try {
      const userId = authenticatedUserId(req);
      rejectMismatchedClaim(req.body?.userId, userId);
      const pairingCode = consumeRequiredSecret(req, 'pairingCode');
      res.status(201).json(
        this.pairingService.pair({
          pairingCode,
          userId,
          deviceName: requiredString(req.body?.deviceName, 'deviceName'),
        }),
      );
    } catch (error) {
      forwardSecretSafe(next, error);
    }
  }

  listDevices(req: Request, res: Response, next: NextFunction): void {
    try {
      res.json(this.pairingService.listDevices(authenticatedUserId(req)));
    } catch (error) {
      forwardSecretSafe(next, error);
    }
  }

  revokeDevice(req: Request, res: Response, next: NextFunction): void {
    try {
      const revoked = this.pairingService.revokeDevice(
        requiredString(req.params.id, 'device id'),
        authenticatedUserId(req),
      );
      if (!revoked) throw AppError.notFound('Mobile device');
      res.status(204).send();
    } catch (error) {
      forwardSecretSafe(next, error);
    }
  }
}
