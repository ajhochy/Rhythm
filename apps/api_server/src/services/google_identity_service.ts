import { AppError } from '../errors/app_error';
import { env } from '../config/env';

interface GoogleTokenInfoResponse {
  aud?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  sub?: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

export class GoogleIdentityService {
  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    if (!idToken) {
      throw AppError.badRequest('googleIdToken is required');
    }

    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );

    if (!response.ok) {
      throw AppError.badRequest('Google ID token verification failed');
    }

    const body = (await response.json()) as GoogleTokenInfoResponse;
    const expectedAudience = env.googleAuthClientId;
    if (expectedAudience && body.aud !== expectedAudience) {
      throw AppError.badRequest('Google ID token audience mismatch');
    }
    if (!body.sub || !body.email) {
      throw AppError.badRequest('Google ID token is missing required claims');
    }
    if (body.email_verified && body.email_verified !== 'true') {
      throw AppError.badRequest('Google account email is not verified');
    }

    return {
      sub: body.sub,
      email: body.email,
      name: body.name?.trim() || body.email,
    };
  }
}
