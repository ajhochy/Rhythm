import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/app_error';

export function requireClaudeUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(AppError.unauthorized('Auth required'));
  if (env.claudeUserId == null || req.auth.user.id !== env.claudeUserId) {
    return next(AppError.forbidden('Reserved for Claude service account'));
  }
  next();
}
