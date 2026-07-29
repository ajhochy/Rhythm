import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AuthService } from '../services/auth_service';
import type { User } from '../models/user';

const authService = new AuthService();

export interface AuthContext {
  sessionToken: string;
  user: User;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // A nested router may sit behind the mobile gateway's verified Device
    // middleware. Trust only the server-created context when both immutable
    // identities agree; request headers alone cannot construct either field.
    if (
      req.mobileDevice &&
      req.auth?.sessionToken === `mobile-device:${req.mobileDevice.id}` &&
      req.auth.user.id === req.mobileDevice.userId
    ) {
      next();
      return;
    }
    const header = req.header('Authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw AppError.unauthorized('Missing bearer token');
    }

    const sessionToken = match[1].trim();
    const user = await authService.getUserForSessionToken(sessionToken);
    if (!user) {
      throw AppError.unauthorized('Invalid session token');
    }

    req.auth = {
      sessionToken,
      user,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Local desktop routes remain usable without a token, but when the desktop
 * supplies its normal Bearer token we must attach the same user context as an
 * authenticated deployment. This lets user/project-owned resources created on
 * the loopback API participate in paired mobile ownership without weakening
 * the AGENT_LOCAL no-token compatibility path.
 *
 * A present but invalid/malformed Authorization header fails closed through
 * requireAuth; only a genuinely absent header receives the local bypass.
 */
export async function authenticateIfPresent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!(req.header('Authorization') ?? '').trim()) {
    next();
    return;
  }
  await requireAuth(req, res, next);
}
