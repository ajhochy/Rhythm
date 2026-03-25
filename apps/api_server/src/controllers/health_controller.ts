import type { Request, Response } from 'express';

export class HealthController {
  getHealth(_req: Request, res: Response) {
    res.json({ status: 'ok', service: 'rhythm-api-server' });
  }
}
