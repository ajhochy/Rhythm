import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../errors/app_error';
import type { MobileDevice } from '../services/mobile_pairing_service';
import type { MobilePairingService } from '../services/mobile_pairing_service';
import type { MobileCloudIdentityService } from '../services/mobile_cloud_identity_service';

declare global {
  namespace Express {
    interface Request {
      mobileDevice?: MobileDevice;
    }
  }
}

type PairingServiceResolver = () => Pick<
  MobilePairingService,
  'authenticateDevice'
>;

type CloudIdentityVerifier = Pick<
  MobileCloudIdentityService,
  'authenticateBearerToken'
>;

export function requireMobileDevice(
  resolvePairingService: PairingServiceResolver,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const header = req.header('Authorization') ?? '';
      const match = header.match(/^Device\s+(.+)$/i);
      if (!match) throw AppError.unauthorized('Missing device token');

      const device = resolvePairingService().authenticateDevice(match[1].trim());
      if (!device) throw AppError.unauthorized('Invalid or revoked device token');

      req.mobileDevice = device;
      next();
    } catch (error) {
      next(error instanceof AppError ? error : AppError.internal());
    }
  };
}

export function requireSessionOrMobileDevice(
  resolvePairingService: PairingServiceResolver,
  cloudIdentity: CloudIdentityVerifier,
): RequestHandler {
  const requireDevice = requireMobileDevice(resolvePairingService);
  const requireCloudUser = requireMobileCloudUser(cloudIdentity);
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('Authorization') ?? '';
    if (/^Device(?:\s|$)/i.test(header)) {
      requireDevice(req, res, next);
      return;
    }
    requireCloudUser(req, res, next);
  };
}

export function requireMobileCloudUser(
  cloudIdentity: CloudIdentityVerifier,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        const header = req.header('Authorization') ?? '';
        const match = header.match(/^Bearer\s+(.+)$/i);
        if (!match) throw AppError.unauthorized('Missing bearer token');

        const sessionToken = match[1].trim();
        const user =
          await cloudIdentity.authenticateBearerToken(sessionToken);
        if (!user) throw AppError.unauthorized('Invalid session token');

        req.auth = { sessionToken, user };
        next();
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    })();
  };
}
