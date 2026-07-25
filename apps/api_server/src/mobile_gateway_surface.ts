import express, { type Router } from 'express';

function isPhoneGatewayRoute(method: string, path: string): boolean {
  if (method === 'GET' && path === '/mobile-gateway/health') return true;
  if (method === 'POST' && path === '/mobile-gateway/pair') return true;
  if (method === 'POST' && path === '/mobile-gateway/project') return true;
  if (
    method === 'DELETE' &&
    /^\/mobile-gateway\/devices\/[^/]+$/.test(path)
  ) {
    return true;
  }
  return (
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
    path.startsWith('/mobile-gateway/opencode/')
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
  app.use(express.json({ limit: '1mb' }));
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
