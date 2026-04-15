import type { Request, Response } from 'express';
import { AuthService } from '../services/auth_service';

const authService = new AuthService();

export class HealthController {
  async getHealth(req: Request, res: Response) {
    const header = req.header('Authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    let authenticatedAs: string | null = null;

    if (match) {
      try {
        const user = await authService.getUserForSessionToken(match[1].trim());
        authenticatedAs = user?.email ?? null;
      } catch {
        // Token lookup is best-effort; never let it break the health check
      }
    }

    res.json({
      status: 'ok',
      service: 'rhythm-api-server',
      ...(authenticatedAs !== null ? { authenticatedAs } : {}),
    });
  }
}
