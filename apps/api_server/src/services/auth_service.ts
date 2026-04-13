import type { User } from '../models/user';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  GoogleIdentityService,
  type GoogleIdentity,
} from './google_identity_service';

export class AuthService {
  constructor(
    private readonly usersRepo = new UsersRepository(),
    private readonly sessionsRepo = new SessionsRepository(),
    private readonly googleIdentityService = new GoogleIdentityService(),
  ) {}

  async loginWithGoogleIdToken(
    googleIdToken: string,
  ): Promise<{ sessionToken: string; user: User }> {
    const identity = await this.googleIdentityService.verifyIdToken(
      googleIdToken,
    );
    const user = await this.usersRepo.upsertGoogleUserAsync({
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      photoUrl: identity.picture ?? null,
    });
    const session = await this.sessionsRepo.createAsync(user.id);
    return {
      sessionToken: session.token,
      user,
    };
  }

  async getUserForSessionToken(token: string): Promise<User | null> {
    return this.sessionsRepo.findUserByTokenAsync(token);
  }

  async logout(token: string): Promise<void> {
    await this.sessionsRepo.deleteAsync(token);
  }
}

export type { GoogleIdentity };
