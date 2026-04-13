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
