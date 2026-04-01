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
    const user = this.usersRepo.upsertGoogleUser({
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      photoUrl: identity.picture ?? null,
    });
    const session = this.sessionsRepo.create(user.id);
    return {
      sessionToken: session.token,
      user,
    };
  }

  getUserForSessionToken(token: string): User | null {
    return this.sessionsRepo.findUserByToken(token);
  }

  logout(token: string): void {
    this.sessionsRepo.delete(token);
  }
}

export type { GoogleIdentity };
