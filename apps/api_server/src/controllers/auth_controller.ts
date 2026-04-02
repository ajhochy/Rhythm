import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AuthService } from '../services/auth_service';
import { GoogleOAuthService } from '../services/google_oauth_service';
import { PlanningCenterOAuthService } from '../services/planning_center_oauth_service';

const googleOAuth = new GoogleOAuthService();
const planningCenterOAuth = new PlanningCenterOAuthService();
const authService = new AuthService();

export class AuthController {
  async googleLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { googleIdToken } = req.body as Record<string, unknown>;
      if (!googleIdToken || typeof googleIdToken !== 'string') {
        throw AppError.badRequest('googleIdToken is required');
      }

      const session = await authService.loginWithGoogleIdToken(googleIdToken);
      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  }

  me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw AppError.badRequest('Missing auth context');
      res.json(req.auth.user);
    } catch (err) {
      next(err);
    }
  }

  logout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw AppError.badRequest('Missing auth context');
      authService.logout(req.auth.sessionToken);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  beginGoogleOAuth(_req: Request, res: Response, next: NextFunction) {
    try {
      const { sessionToken } = _req.query as Record<string, string>;
      const user = sessionToken
        ? authService.getUserForSessionToken(sessionToken)
        : null;
      if (!sessionToken || !user) {
        throw AppError.unauthorized('Valid sessionToken is required');
      }
      res.redirect(googleOAuth.getAuthorizationUrl(sessionToken));
    } catch (err) {
      next(err);
    }
  }

  async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, error, state } = req.query as Record<string, string>;
      if (error) throw AppError.badRequest(`Google OAuth failed: ${error}`);
      if (!code) throw AppError.badRequest('Missing Google OAuth code');
      const user = state ? authService.getUserForSessionToken(state) : null;
      if (!state || !user) {
        throw AppError.unauthorized('Missing integration auth session');
      }

      await googleOAuth.handleCallback(code, user.id);

      res
        .status(200)
        .type('html')
        .send(
          '<html><body style="font-family: sans-serif; padding: 32px;"><h2>Google connected</h2><p>You can return to Rhythm.</p></body></html>',
        );
    } catch (err) {
      next(err);
    }
  }

  beginPlanningCenterOAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { sessionToken } = req.query as Record<string, string>;
      const user = sessionToken
        ? authService.getUserForSessionToken(sessionToken)
        : null;
      if (!sessionToken || !user) {
        throw AppError.unauthorized('Valid sessionToken is required');
      }
      res.redirect(planningCenterOAuth.getAuthorizationUrl(sessionToken));
    } catch (err) {
      next(err);
    }
  }

  async planningCenterCallback(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { code, error, state } = req.query as Record<string, string>;
      if (error) {
        throw AppError.badRequest(`Planning Center OAuth failed: ${error}`);
      }
      if (!code) {
        throw AppError.badRequest('Missing Planning Center OAuth code');
      }
      const user = state ? authService.getUserForSessionToken(state) : null;
      if (!state || !user) {
        throw AppError.unauthorized('Missing integration auth session');
      }

      await planningCenterOAuth.handleCallback(code, user.id);

      res
        .status(200)
        .type('html')
        .send(
          '<html><body style="font-family: sans-serif; padding: 32px;"><h2>Planning Center connected</h2><p>You can return to Rhythm.</p></body></html>',
        );
    } catch (err) {
      next(err);
    }
  }
}
