import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AuthService } from '../services/auth_service';
import { MobileCloudIdentityService } from '../services/mobile_cloud_identity_service';
import type { User } from '../models/user';

const authService = new AuthService();
const mobileCloudIdentityService = new MobileCloudIdentityService();
const CLOUD_AUTH_CACHE_TTL_MS = 5 * 60_000;
const CLOUD_AUTH_CACHE_MAX_ENTRIES = 256;

interface CachedCloudIdentity {
  user: User;
  expiresAt: number;
}

const cloudIdentityCache = new Map<string, CachedCloudIdentity>();
const cloudIdentityInFlight = new Map<string, Promise<User | null>>();

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function getCachedCloudIdentity(digest: string): User | null {
  const cached = cloudIdentityCache.get(digest);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cloudIdentityCache.delete(digest);
    return null;
  }
  return cached.user;
}

function cacheCloudIdentity(digest: string, user: User): void {
  if (!cloudIdentityCache.has(digest)) {
    while (cloudIdentityCache.size >= CLOUD_AUTH_CACHE_MAX_ENTRIES) {
      const oldest = cloudIdentityCache.keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      cloudIdentityCache.delete(oldest);
    }
  }
  cloudIdentityCache.set(digest, {
    user,
    expiresAt: Date.now() + CLOUD_AUTH_CACHE_TTL_MS,
  });
}

async function authenticateCloudBearer(
  token: string,
  digest: string,
): Promise<User | null> {
  const cached = getCachedCloudIdentity(digest);
  if (cached) return cached;

  let verification = cloudIdentityInFlight.get(digest);
  if (!verification) {
    verification = mobileCloudIdentityService.authenticateBearerToken(token);
    cloudIdentityInFlight.set(digest, verification);
  }

  let user: User | null;
  try {
    user = await verification;
  } finally {
    if (cloudIdentityInFlight.get(digest) === verification) {
      cloudIdentityInFlight.delete(digest);
    }
  }
  if (user) cacheCloudIdentity(digest, user);
  return user;
}

export interface AuthContext {
  sessionToken: string;
  user: User;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // A nested router may sit behind the mobile gateway's verified Device
    // middleware. Trust only the server-created context when both immutable
    // identities agree; request headers alone cannot construct either field.
    if (
      req.mobileDevice &&
      req.auth?.sessionToken === `mobile-device:${req.mobileDevice.id}` &&
      req.auth.user.id === req.mobileDevice.userId
    ) {
      next();
      return;
    }
    const header = req.header('Authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw AppError.unauthorized('Missing bearer token');
    }

    const sessionToken = match[1].trim();
    const user = await authService.getUserForSessionToken(sessionToken);
    if (!user) {
      throw AppError.unauthorized('Invalid session token');
    }

    req.auth = {
      sessionToken,
      user,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Local desktop routes remain usable without a token, but when the desktop
 * supplies its normal Bearer token we must attach the same user context as an
 * authenticated deployment. This lets user/project-owned resources created on
 * the loopback API participate in paired mobile ownership without weakening
 * the AGENT_LOCAL no-token compatibility path.
 *
 * A present but invalid/malformed Authorization header fails closed through
 * requireAuth; only a genuinely absent header receives the local bypass.
 */
export async function authenticateIfPresent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header('Authorization') ?? '';
  if (!header.trim()) {
    next();
    return;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  const sessionToken = match?.[1].trim() ?? '';
  if (!sessionToken) {
    await requireAuth(req, res, next);
    return;
  }

  try {
    let user: User | null = null;
    try {
      user = await authService.getUserForSessionToken(sessionToken);
    } catch {
      // MobileCloudIdentityService owns the fail-closed local/Cloud fallback
      // policy, including conversion of identity-store failures to 503.
    }
    if (!user) {
      user = await authenticateCloudBearer(
        sessionToken,
        tokenDigest(sessionToken),
      );
    }
    if (!user) {
      throw AppError.unauthorized('Invalid session token');
    }

    req.auth = {
      sessionToken,
      user,
    };
    next();
  } catch (err) {
    next(err);
  }
}
