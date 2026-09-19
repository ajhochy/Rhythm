import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/app_error';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
import { AuthService } from '../services/auth_service';
import { GoogleOAuthService, GOOGLE_AGENT_SCOPES } from '../services/google_oauth_service';
import { GoogleAccountAuthorizationService } from '../services/google_account_authorization_service';
import {
  GoogleMobileLoginBroker,
  GoogleMobileLoginInvalid,
  GoogleMobileLoginMissing,
  GoogleMobileLoginRateLimited,
  googleMobileLoginBroker,
} from '../services/google_mobile_login_broker';
import { PlanningCenterOAuthService } from '../services/planning_center_oauth_service';

const googleOAuth = new GoogleOAuthService();
const planningCenterOAuth = new PlanningCenterOAuthService();
const authService = new AuthService();
const integrationAccountsRepo = new IntegrationAccountsRepository();
const workspaceRepo = new WorkspaceRepository();
const googleAccountAuthorization = new GoogleAccountAuthorizationService();

const APP_STATE = /^[A-Za-z0-9._~-]{16,128}$/;
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const HANDOFF_CODE = /^[A-Za-z0-9_-]{43}$/;
const MOBILE_BINDING_COOKIE = 'rhythm_google_mobile_binding';

function secureMobileResponse(res: Response): Response {
  return res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
}

function cookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

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
      const { code, error, state } = req.query as Record<string, string>;
      if (GoogleMobileLoginBroker.isMobileState(state)) {
        await this.googleMobileCallback(req, res);
        return;
      }
      if (error) throw AppError.badRequest(`Google OAuth failed: ${error}`);
      if (!code) throw AppError.badRequest('Missing Google OAuth code');
      const user = state ? await authService.getUserForSessionToken(state) : null;
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

  async beginGoogleMobileLogin(req: Request, res: Response) {
    secureMobileResponse(res);
    const codeChallenge = typeof req.query.code_challenge === 'string' ? req.query.code_challenge : '';
    const challengeMethod = typeof req.query.code_challenge_method === 'string' ? req.query.code_challenge_method : '';
    const appState = typeof req.query.app_state === 'string' ? req.query.app_state : '';
    if (challengeMethod !== 'S256' || !CODE_CHALLENGE.test(codeChallenge) || !APP_STATE.test(appState)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    try {
      const transaction = googleMobileLoginBroker.begin({
        appState,
        codeChallenge,
        rateKey: req.ip ?? req.socket.remoteAddress ?? 'unknown',
      });
      res.setHeader('Set-Cookie', `${MOBILE_BINDING_COOKIE}=${transaction.browserBinding}; Max-Age=300; Secure; HttpOnly; SameSite=Lax; Path=/auth/google/callback`);
      res.redirect(googleOAuth.getHostedMobileAuthorizationUrl({
        state: transaction.state,
        nonce: transaction.nonce,
      }));
    } catch (error) {
      if (error instanceof GoogleMobileLoginRateLimited) {
        res.set('Retry-After', String(error.retryAfterSeconds)).status(429).json({ error: 'rate_limited' });
        return;
      }
      res.status(400).json({ error: 'invalid_request' });
    }
  }

  async redeemGoogleMobileLogin(req: Request, res: Response) {
    secureMobileResponse(res);
    const input = req.body as Record<string, unknown> | null;
    if (
      !input ||
      Object.keys(input).sort().join(',') !== 'code,codeVerifier' ||
      typeof input.code !== 'string' ||
      !HANDOFF_CODE.test(input.code) ||
      typeof input.codeVerifier !== 'string' ||
      !CODE_VERIFIER.test(input.codeVerifier)
    ) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    try {
      const identity = googleMobileLoginBroker.consumeHandoff(input.code, input.codeVerifier);
      const session = await authService.loginWithGoogleProfile(identity);
      res.status(200).json(session);
    } catch (error) {
      if (error instanceof GoogleMobileLoginMissing) {
        res.status(409).json({ error: 'mobile_login_expired', retry: 'begin_fresh_login' });
        return;
      }
      if (error instanceof GoogleMobileLoginInvalid) {
        res.status(401).json({ error: 'invalid_grant' });
        return;
      }
      res.status(error instanceof AppError ? error.statusCode : 500).json({ error: 'mobile_login_failed' });
    }
  }

  private async googleMobileCallback(req: Request, res: Response): Promise<void> {
    secureMobileResponse(res);
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    let login;
    try {
      login = googleMobileLoginBroker.consumeLogin(state, cookie(req, MOBILE_BINDING_COOKIE));
    } catch (error) {
      if (error instanceof GoogleMobileLoginMissing) {
        res.status(409).json({ error: 'mobile_login_expired', retry: 'begin_fresh_login' });
        return;
      }
      res.status(401).json({ error: 'mobile_login_invalid', retry: 'begin_fresh_login' });
      return;
    }
    res.setHeader('Set-Cookie', `${MOBILE_BINDING_COOKIE}=; Max-Age=0; Secure; HttpOnly; SameSite=Lax; Path=/auth/google/callback`);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (req.query.error || !/^[\x21-\x7e]{1,4096}$/.test(code)) {
      res.status(401).json({ error: 'mobile_login_failed', retry: 'begin_fresh_login' });
      return;
    }
    try {
      const profile = await googleOAuth.exchangeHostedMobileCode({ code, nonce: login.nonce });
      await googleAccountAuthorization.authorize({
        sub: profile.sub,
        email: profile.email!,
        hostedDomain: profile.hd,
      });
      const handoff = googleMobileLoginBroker.issueHandoff({
        googleSub: profile.sub,
        email: profile.email!,
        name: profile.name ?? profile.email!,
        photoUrl: profile.picture ?? null,
        hostedDomain: profile.hd ?? null,
      }, login.codeChallenge);
      const target = new URL('rhythmagents://oauth/callback');
      target.searchParams.set('code', handoff);
      target.searchParams.set('state', login.appState);
      res.redirect(target.toString());
    } catch (error) {
      res.status(error instanceof AppError && error.statusCode === 403 ? 403 : 401).json({
        error: 'mobile_login_failed',
        retry: 'begin_fresh_login',
      });
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
        hostedDomain: profile.hd ?? null,
      });

      await googleOAuth.storeDesktopIntegration(session.user.id, tokens, profile);

      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  }

  async googleMobileExchange(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, codeVerifier, nonce } = req.body as Record<
        string,
        unknown
      >;
      if (!code || typeof code !== 'string') {
        throw AppError.badRequest('code is required');
      }
      if (!codeVerifier || typeof codeVerifier !== 'string') {
        throw AppError.badRequest('codeVerifier is required');
      }
      if (!nonce || typeof nonce !== 'string') {
        throw AppError.badRequest('nonce is required');
      }

      const { profile } = await googleOAuth.exchangeMobileCode({
        code,
        codeVerifier,
        nonce,
        configuredClientId: env.googleMobileClientId,
        configuredRedirectUri: env.googleMobileRedirectUri,
      });

      if (!profile.email) {
        throw AppError.badRequest('Google account did not return an email');
      }

      const session = await authService.loginWithGoogleProfile({
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name ?? profile.email,
        photoUrl: profile.picture ?? null,
        hostedDomain: profile.hd ?? null,
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
