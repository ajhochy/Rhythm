import express, { type Router } from 'express';
import { env } from './config/env';

const DEFAULT_JSON_LIMIT_BYTES = 1024 * 1024;
export const MOBILE_PROMPT_JSON_LIMIT_BYTES = 15 * 1024 * 1024;

export function mobileJsonBodyLimitBytes(
  method: string,
  path: string,
): number {
  return method === 'POST' &&
      /^\/mobile-gateway\/opencode\/session\/[^/]+\/prompt(?:_async)?$/.test(path)
    ? MOBILE_PROMPT_JSON_LIMIT_BYTES
    : DEFAULT_JSON_LIMIT_BYTES;
}

function isPhoneGatewayRoute(method: string, path: string): boolean {
  if (method === 'GET' && path === '/mobile-gateway/health') return true;
  if (method === 'POST' && path === '/mobile-gateway/pair') return true;
  if (method === 'POST' && path === '/mobile-gateway/project') return true;
  if (method === 'GET' && path === '/mobile-gateway/projects') return true;
  if (method === 'GET' && path === '/mobile-gateway/agent-activity') {
    return true;
  }
  if (method === 'GET' && path === '/mobile-gateway/profile-catalog') {
    return true;
  }
  if (method === 'GET' && path === '/mobile-gateway/chat-catalog') {
    return true;
  }
  if (method === 'GET' && /^\/mobile-gateway\/artifacts\/[^/]+$/.test(path)) {
    return true;
  }
  if (
    method === 'PATCH' &&
    /^\/mobile-gateway\/sessions\/[^/]+\/state$/.test(path)
  ) {
    return true;
  }
  if (method === 'GET' && path === '/mobile-gateway/events') return true;
  if (
    method === 'GET' &&
    /^\/mobile-gateway\/sessions\/[^/]+\/events$/.test(path)
  ) {
    return true;
  }
  if (
    method === 'DELETE' &&
    /^\/mobile-gateway\/devices\/[^/]+$/.test(path)
  ) {
    return true;
  }
  return (
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
    (
      path.startsWith('/mobile-gateway/opencode/') ||
      path.startsWith('/mobile-gateway/tools/')
    )
  );
}

function notFound(
  _req: express.Request,
  res: express.Response,
): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'This route is not available on the mobile gateway.',
    },
  });
}

export function createMobileGatewaySurface(router: Router) {
  const app = express();
  app.disable('x-powered-by');
  // Tool responses can contain callback URLs that are served only by the
  // primary API listener. Keep that origin explicit because req.host on this
  // surface is the phone gateway listener, where those routes do not exist.
  app.locals.primaryApiOrigin = `http://127.0.0.1:${env.port}`;
  const defaultJson = express.json({ limit: DEFAULT_JSON_LIMIT_BYTES });
  const promptJson = express.json({ limit: MOBILE_PROMPT_JSON_LIMIT_BYTES });
  app.use((req, res, next) => {
    const parser = mobileJsonBodyLimitBytes(req.method, req.path) ===
        MOBILE_PROMPT_JSON_LIMIT_BYTES
      ? promptJson
      : defaultJson;
    parser(req, res, next);
  });
  app.use((req, res, next) => {
    if (!isPhoneGatewayRoute(req.method, req.path)) {
      notFound(req, res);
      return;
    }
    next();
  });
  app.use('/mobile-gateway', router);
  app.use(notFound);
  return app;
}
