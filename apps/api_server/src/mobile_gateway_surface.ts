import express, { type Router } from 'express';

export function createMobileGatewaySurface(router: Router) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/mobile-gateway', router);
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'This route is not available on the mobile gateway.',
      },
    });
  });
  return app;
}
