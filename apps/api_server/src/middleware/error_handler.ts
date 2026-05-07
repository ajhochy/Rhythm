import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { logger } from '../utils/logger';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    logger.error(
      `Handled ${err.code} ${req.method} ${req.originalUrl} — ${err.message}`,
      {
        authUserId: req.auth?.user?.id ?? null,
      },
    );
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  const errorPayload = err instanceof Error
    ? { message: err.message, stack: err.stack, name: err.name }
    : { value: err };
  const correlationId = randomUUID();
  logger.error(
    `Unhandled ${req.method} ${req.originalUrl} [cid=${correlationId}]`,
    {
      authUserId: req.auth?.user?.id ?? null,
      body: req.body,
      params: req.params,
      error: errorPayload,
    },
  );
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', correlationId } });
}
