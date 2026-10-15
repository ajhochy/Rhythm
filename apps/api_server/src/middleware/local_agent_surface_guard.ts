import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

import { env } from '../config/env';
import { DAYFLOW_ERROR_CATALOG } from '../integrations/dayflow/public_contract';

function isAllowedHost(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') return false;

  const match = /^(?:localhost|127\.0\.0\.1)(?::(\d+))?$/i.exec(value);
  if (!match) return false;
  if (match[1] === undefined) return true;

  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function isAllowedLocalAgentSurfaceRequest(
  headers: IncomingHttpHeaders,
): boolean {
  if (!env.agentLocal || env.agentOriginGuardEnabled === false) {
    return true;
  }

  if (headers.origin !== undefined) {
    return (
      typeof headers.origin === 'string' &&
      env.localRendererOrigins.includes(headers.origin) &&
      isAllowedHost(headers.host)
    );
  }

  const fetchSite = headers['sec-fetch-site'];
  if (fetchSite !== undefined) {
    if (typeof fetchSite !== 'string') return false;
    const normalized = fetchSite.trim().toLowerCase();
    if (normalized !== 'none' && normalized !== 'same-origin') {
      return false;
    }
  }

  return isAllowedHost(headers.host);
}

export const localAgentSurfaceGuard: RequestHandler = (req, res, next) => {
  if (isAllowedLocalAgentSurfaceRequest(req.headers)) {
    next();
    return;
  }

  if (req.path === '/dayflow-integration' || req.path.startsWith('/dayflow-integration/')) {
    const catalog = DAYFLOW_ERROR_CATALOG.FORBIDDEN_ORIGIN;
    res.status(403).json({
      error: {
        code: 'FORBIDDEN_ORIGIN',
        message: catalog.message,
        retryable: catalog.retryable,
        recovery: catalog.recovery,
        requestId: randomUUID(),
      },
    });
    return;
  }

  res.status(403).json({
    error: {
      code: 'FORBIDDEN_ORIGIN',
    },
  });
};
