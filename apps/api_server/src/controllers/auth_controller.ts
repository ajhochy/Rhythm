import type { Request, Response } from 'express';

export class AuthController {
  beginOAuth(_req: Request, res: Response) {
    // TODO: Delegate auth flow to service.
    res.status(501).json({ message: 'Not implemented' });
  }
}
