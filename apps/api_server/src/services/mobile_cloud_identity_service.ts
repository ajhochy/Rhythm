import { AppError } from '../errors/app_error';
import type { User } from '../models/user';
import { UsersRepository } from '../repositories/users_repository';
import { AuthService } from './auth_service';

interface LocalSessionLookup {
  getUserForSessionToken(token: string): Promise<User | null>;
}

interface LocalUserLookup {
  findByGoogleSubAsync(googleSub: string): Promise<User | null>;
  findByEmailAsync(email: string): Promise<User | null>;
  bindGoogleIdentityByEmailAsync(
    email: string,
    googleSub: string,
  ): Promise<User | null>;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface MobileCloudIdentityServiceOptions {
  localSessions?: LocalSessionLookup;
  localUsers?: LocalUserLookup;
  cloudBaseUrl?: string;
  fetchFn?: FetchLike;
}

function hasUserIdentity(
  value: unknown,
): value is { user: User & { googleSub: string } } {
  if (!value || typeof value !== 'object') return false;
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return false;
  const candidate = user as {
    id?: unknown;
    name?: unknown;
    email?: unknown;
    googleSub?: unknown;
  };
  return (
    Number.isSafeInteger(candidate.id) &&
    Number(candidate.id) > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.trim() !== '' &&
    typeof candidate.email === 'string' &&
    candidate.email.trim() !== '' &&
    typeof candidate.googleSub === 'string' &&
    candidate.googleSub.trim() !== ''
  );
}

export class MobileCloudIdentityService {
  private readonly localSessions: LocalSessionLookup;
  private readonly localUsers: LocalUserLookup;
  private readonly cloudBaseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: MobileCloudIdentityServiceOptions = {}) {
    this.localSessions = options.localSessions ?? new AuthService();
    this.localUsers = options.localUsers ?? new UsersRepository();
    this.cloudBaseUrl = (
      options.cloudBaseUrl ??
      process.env.RHYTHM_CLOUD_API_URL ??
      process.env.PROD_API_URL ??
      'https://api.vcrcapps.com'
    ).replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async authenticateBearerToken(token: string): Promise<User | null> {
    try {
      const localUser = await this.localSessions.getUserForSessionToken(token);
      if (localUser) return localUser;
    } catch {
      // A local database failure cannot safely authenticate a token, but it
      // also must not block verification by the authoritative Cloud API.
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.cloudBaseUrl}/auth/me`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new AppError(
        503,
        'AUTH_UNAVAILABLE',
        'Rhythm Cloud authentication is unavailable',
      );
    }

    if (!response.ok) return null;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return null;
    }
    if (!hasUserIdentity(payload)) return null;
    const cloudUser = payload.user;
    try {
      const [localBySubject, localByEmail] = await Promise.all([
        this.localUsers.findByGoogleSubAsync(cloudUser.googleSub),
        this.localUsers.findByEmailAsync(cloudUser.email),
      ]);
      if (localBySubject) {
        if (
          localBySubject.googleSub !== cloudUser.googleSub ||
          localBySubject.email.toLowerCase() !== cloudUser.email.toLowerCase()
        ) {
          return null;
        }
        if (localByEmail && localByEmail.id !== localBySubject.id) return null;
        return localBySubject;
      }
      if (!localByEmail || localByEmail.googleSub !== null) return null;
      const bound = await this.localUsers.bindGoogleIdentityByEmailAsync(
        cloudUser.email,
        cloudUser.googleSub,
      );
      return bound &&
        bound.googleSub === cloudUser.googleSub &&
        bound.email.toLowerCase() === cloudUser.email.toLowerCase()
        ? bound
        : null;
    } catch {
      throw new AppError(
        503,
        'AUTH_UNAVAILABLE',
        'Rhythm Cloud authentication is unavailable',
      );
    }
  }
}
