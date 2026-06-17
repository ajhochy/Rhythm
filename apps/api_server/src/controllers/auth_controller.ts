import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
import { AuthService } from '../services/auth_service';
import { GoogleOAuthService, GOOGLE_AGENT_SCOPES } from '../services/google_oauth_service';
import { PlanningCenterOAuthService } from '../services/planning_center_oauth_service';
import { googleAgentBridge } from '../services/google_agent_bridge';
import { opencodeClient } from '../services/opencode_engine';
import { logger } from '../utils/logger';

/**
 * Marker prefixed onto the OAuth `state` for the agent step-up flow. Google
 * echoes `state` verbatim, so encoding the intent here is how the callback
 * learns it was an agent step-up (the fixed redirect_uri can't carry extra
 * query params). The callback strips it before resolving the session token.
 */
const AGENT_STATE_PREFIX = 'agent:';

const googleOAuth = new GoogleOAuthService();
const planningCenterOAuth = new PlanningCenterOAuthService();
const authService = new AuthService();
const integrationAccountsRepo = new IntegrationAccountsRepository();
const workspaceRepo = new WorkspaceRepository();

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

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw AppError.badRequest('Missing auth context');
      const user = req.auth.user;
      const wsWithRole = await workspaceRepo.findForUserAsync(user.id);
      const workspace = wsWithRole
        ? {
            id: wsWithRole.id,
            name: wsWithRole.name,
            ...(wsWithRole.role === 'admin' ? { joinCode: wsWithRole.joinCode } : {}),
          }
        : null;
      res.json({
        user,
        workspace,
        workspaceRole: wsWithRole?.role ?? null,
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw AppError.badRequest('Missing auth context');
      await authService.logout(req.auth.sessionToken);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async beginGoogleOAuth(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { sessionToken, intent } = _req.query as Record<string, string>;
      const user = sessionToken
        ? await authService.getUserForSessionToken(sessionToken)
        : null;
      if (!sessionToken || !user) {
        throw AppError.unauthorized('Valid sessionToken is required');
      }

      if (intent === 'agent') {
        res.redirect(
          googleOAuth.getAuthorizationUrl({
            sessionToken,
            // Round-trip the agent intent through `state` so the callback knows
            // to bridge the granted Gemini token into opencode.
            state: `${AGENT_STATE_PREFIX}${sessionToken}`,
            loginHint: user.email,
            forceConsent: true,
            scopes: GOOGLE_AGENT_SCOPES,
          }),
        );
        return;
      }

      const existingCalendar = await integrationAccountsRepo.findByProviderAsync(
        'google_calendar',
        user.id,
      );
      const existingGmail = await integrationAccountsRepo.findByProviderAsync(
        'gmail',
        user.id,
      );
      const needsCalendarScope =
        existingCalendar?.scope?.includes(
          'https://www.googleapis.com/auth/calendar.readonly',
        ) != true;
      res.redirect(
        googleOAuth.getAuthorizationUrl({
          sessionToken,
          loginHint: user.email,
          forceConsent:
            needsCalendarScope ||
            (!existingCalendar?.refreshToken && !existingGmail?.refreshToken),
        }),
      );
    } catch (err) {
      next(err);
    }
  }

  async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, error, state, intent } = req.query as Record<string, string>;
      if (error) throw AppError.badRequest(`Google OAuth failed: ${error}`);
      if (!code) throw AppError.badRequest('Missing Google OAuth code');
      // The agent step-up encodes its intent in `state` (Google echoes it
      // verbatim). Strip the marker before resolving the session token. Also
      // honor an explicit `intent=agent` query param when present (dev/manual).
      const isAgentStepUp =
        intent === 'agent' || (state?.startsWith(AGENT_STATE_PREFIX) ?? false);
      const sessionToken = state?.startsWith(AGENT_STATE_PREFIX)
        ? state.slice(AGENT_STATE_PREFIX.length)
        : state;
      const user = sessionToken
        ? await authService.getUserForSessionToken(sessionToken)
        : null;
      if (!sessionToken || !user) {
        throw AppError.unauthorized('Missing integration auth session');
      }

      await googleOAuth.handleCallback(code, user.id);

      // Option C — on the agent step-up consent (intent=agent), the user just
      // granted the cloud-platform scope. Bridge that token into opencode's
      // `google` provider so the gemini-cli agent can run Gemini from the
      // user's account, and start the refresh loop that keeps it fresh. This is
      // BEST-EFFORT: a bridge failure (e.g. scope not granted, engine not
      // ready) is logged and must NEVER break the callback response.
      if (isAgentStepUp) {
        try {
          const result = await googleAgentBridge.bridgeGoogle(
            user.id,
            opencodeClient,
          );
          if (result.success) {
            googleAgentBridge.startRefreshLoop(user.id, opencodeClient);
            logger.info('[auth] Google→opencode Gemini bridge: ok');
          } else {
            logger.warn(
              `[auth] Google→opencode Gemini bridge: failed (${result.reason})`,
            );
          }
        } catch (e) {
          logger.warn(
            `[auth] Google→opencode Gemini bridge errored (non-fatal): ${String(e)}`,
          );
        }
      }

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

  async googleDesktopExchange(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, codeVerifier, redirectUri } = req.body as Record<
        string,
        unknown
      >;
      if (!code || typeof code !== 'string') {
        throw AppError.badRequest('code is required');
      }
      if (!codeVerifier || typeof codeVerifier !== 'string') {
        throw AppError.badRequest('codeVerifier is required');
      }
      if (!redirectUri || typeof redirectUri !== 'string') {
        throw AppError.badRequest('redirectUri is required');
      }

      const { tokens, profile } = await googleOAuth.exchangeDesktopCode({
        code,
        codeVerifier,
        redirectUri,
      });

      if (!profile.email) {
        throw AppError.badRequest('Google account did not return an email');
      }

      const session = await authService.loginWithGoogleProfile({
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name ?? profile.email,
        photoUrl: profile.picture ?? null,
      });

      await googleOAuth.storeDesktopIntegration(session.user.id, tokens, profile);

      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  }

  async googleMobileExchange(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, codeVerifier, redirectUri, clientId } = req.body as Record<
        string,
        unknown
      >;
      if (!code || typeof code !== 'string') {
        throw AppError.badRequest('code is required');
      }
      if (!codeVerifier || typeof codeVerifier !== 'string') {
        throw AppError.badRequest('codeVerifier is required');
      }
      if (!redirectUri || typeof redirectUri !== 'string') {
        throw AppError.badRequest('redirectUri is required');
      }
      if (!clientId || typeof clientId !== 'string') {
        throw AppError.badRequest('clientId is required');
      }

      const { profile } = await googleOAuth.exchangeMobileCode({
        code,
        codeVerifier,
        redirectUri,
        clientId,
      });

      if (!profile.email) {
        throw AppError.badRequest('Google account did not return an email');
      }

      const session = await authService.loginWithGoogleProfile({
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name ?? profile.email,
        photoUrl: profile.picture ?? null,
      });

      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  }

  async beginPlanningCenterOAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { sessionToken } = req.query as Record<string, string>;
      const user = sessionToken
        ? await authService.getUserForSessionToken(sessionToken)
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
      const user = state ? await authService.getUserForSessionToken(state) : null;
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
