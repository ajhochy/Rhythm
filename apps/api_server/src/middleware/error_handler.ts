import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { logger } from '../utils/logger';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (
    req.path === '/mobile-gateway' ||
    req.path.startsWith('/mobile-gateway/')
  ) {
    const correlationId = randomUUID();
    const rawStatus = typeof err === 'object' &&
        err !== null &&
        'status' in err
      ? Number(err.status)
      : undefined;
    const statusCode = err instanceof AppError
      ? err.statusCode
      : rawStatus === 400 || rawStatus === 413
      ? rawStatus
      : 500;
    const code = err instanceof AppError
      ? err.code
      : statusCode === 400
      ? 'BAD_REQUEST'
      : statusCode === 413
      ? 'REQUEST_TOO_LARGE'
      : 'INTERNAL_ERROR';
    const message = err instanceof AppError
      ? err.message
      : statusCode === 400
      ? 'Malformed JSON request body'
      : statusCode === 413
      ? 'Request body is too large'
      : 'Internal server error';

    // This boundary also catches failures raised before the mobile router
    // (notably JSON parsing and CORS). Never include the original URL, headers,
    // request body, params, raw error message, or stack: all can contain device
    // credentials, prompts, file content, or other project-private data.
    logger.error(
      `Mobile gateway request failed (${code}) [cid=${correlationId}]`,
      {
        authUserId: req.auth?.user?.id ?? null,
        statusCode,
      },
    );
    res.status(statusCode).json({
      error: {
        code,
        message,
        ...(statusCode === 500 ? { correlationId } : {}),
      },
    });
    return;
  }

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
