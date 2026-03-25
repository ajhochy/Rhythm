import type { NextFunction, Request, Response } from 'express';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // TODO: Replace with structured error mapping.
  res.status(500).json({ message: 'Internal server error', error: String(err) });
}
