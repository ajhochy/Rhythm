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

    // Build info is baked into the Docker image by the publish workflow
    // (issue #677) so a deployed server's code version is one curl away.
    // Read at request time, not module load, so tests can vary it.
    const commit = process.env.RHYTHM_BUILD_COMMIT || 'dev';
    const builtAt = process.env.RHYTHM_BUILD_TIME;

    res.json({
      status: 'ok',
      service: 'rhythm-api-server',
      commit,
      ...(builtAt ? { builtAt } : {}),
      ...(authenticatedAs !== null ? { authenticatedAs } : {}),
    });
  }
}
