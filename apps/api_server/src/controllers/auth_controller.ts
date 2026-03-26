import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { GoogleOAuthService } from '../services/google_oauth_service';
import { PlanningCenterOAuthService } from '../services/planning_center_oauth_service';

const googleOAuth = new GoogleOAuthService();
const planningCenterOAuth = new PlanningCenterOAuthService();

export class AuthController {
  beginGoogleOAuth(_req: Request, res: Response, next: NextFunction) {
    try {
      res.redirect(googleOAuth.getAuthorizationUrl());
    } catch (err) {
      next(err);
    }
  }

  async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, error } = req.query as Record<string, string>;
      if (error) throw AppError.badRequest(`Google OAuth failed: ${error}`);
      if (!code) throw AppError.badRequest('Missing Google OAuth code');

      await googleOAuth.handleCallback(code);

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
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      res.redirect(planningCenterOAuth.getAuthorizationUrl());
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
      const { code, error } = req.query as Record<string, string>;
      if (error) {
        throw AppError.badRequest(`Planning Center OAuth failed: ${error}`);
      }
      if (!code) {
        throw AppError.badRequest('Missing Planning Center OAuth code');
      }

      await planningCenterOAuth.handleCallback(code);

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
