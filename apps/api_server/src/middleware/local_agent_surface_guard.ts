import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler } from 'express';

import { env } from '../config/env';

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
    return false;
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

  res.status(403).json({
    error: {
      code: 'FORBIDDEN_ORIGIN',
    },
  });
};
