import type { NextFunction, Request, Response } from 'express';

import { logger } from '../utils/logger';

/**
 * `/mobile-gateway` appeared ZERO times across every log file back to Sep 7,
 * which is why the 2026-09-30 relay outage could not be reconstructed: there
 * was no record that a phone request had ever arrived, let alone what it
 * answered. One line per request closes that hole.
 *
 * Cardinality and secrecy rules, both load-bearing:
 *  - identifiers are collapsed to `:id` so the log groups by route, not by
 *    session/artifact/device;
 *  - the query string, every header, and the body are never touched — device
 *    tokens, bearers, and PTY tickets all live there.
 */
const ID_SEGMENT =
  /^(?:[0-9a-fA-F-]{8,}|\d+|[A-Za-z]{2,}_[A-Za-z0-9]{6,}|[A-Za-z0-9_-]{21,})$/;

export function redactGatewayPath(path: string): string {
  return path
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
}

export function mobileGatewayAccessLog(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = Date.now();
    const route = redactGatewayPath(req.path);
    res.on('finish', () => {
      logger.info(
        `[${scope}] ${req.method} ${route} -> ${res.statusCode} in ${Date.now() - startedAt}ms`,
      );
    });
    res.on('close', () => {
      if (res.writableEnded) return;
      // The aborted case is the one that mattered: a tunneled request that
      // never settles leaves no 'finish' event and therefore no trace at all.
      logger.warn(
        `[${scope}] ${req.method} ${route} -> aborted after ${Date.now() - startedAt}ms`,
      );
    });
    next();
  };
}
