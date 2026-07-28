import { AppError } from '../errors/app_error';
import { UsersRepository } from '../repositories/users_repository';

export interface GoogleAccountAuthorizationIdentity {
  sub: string;
  email: string;
  hostedDomain?: string | null;
}

export interface GoogleAccountAuthorizationOptions {
  allowedEmails?: string[];
  allowedHostedDomains?: string[];
}

function configuredList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizedConfiguredList(values: string[]): Set<string> {
  return new Set(values.map((entry) => entry.trim().toLowerCase()).filter(
    Boolean,
  ));
}

/**
 * Central account-admission policy shared by every Google login/exchange path.
 * Existing users are preprovisioned. New production users require either an
 * explicit email invite or a verified Google hosted-domain claim that matches
 * both configuration and the email suffix. The same fail-closed policy applies
 * in development so a non-production deployment cannot become an account
 * creation bypass.
 */
export class GoogleAccountAuthorizationService {
  private readonly allowedEmails: Set<string>;
  private readonly allowedHostedDomains: Set<string>;

  constructor(
    options: GoogleAccountAuthorizationOptions = {},
    private readonly usersRepository = new UsersRepository(),
  ) {
    this.allowedEmails = normalizedConfiguredList(
      options.allowedEmails ??
        configuredList(process.env.RHYTHM_GOOGLE_ALLOWED_EMAILS),
    );
    this.allowedHostedDomains = normalizedConfiguredList(
      options.allowedHostedDomains ??
        configuredList(
          process.env.RHYTHM_GOOGLE_ALLOWED_HOSTED_DOMAINS,
        ),
    );
  }

  async authorize(identity: GoogleAccountAuthorizationIdentity):
    Promise<void> {
    const email = identity.email.trim().toLowerCase();
    const hostedDomain = identity.hostedDomain?.trim().toLowerCase() ?? '';
    if (!email || !identity.sub.trim()) {
      throw AppError.forbidden('Google account is not authorized for Rhythm');
    }

    const [existingBySub, existingByEmail] = await Promise.all([
      this.usersRepository.findByGoogleSubAsync(identity.sub),
      this.usersRepository.findByEmailAsync(email),
    ]);
    if (existingBySub || existingByEmail) return;
    if (this.allowedEmails.has(email)) return;

    const emailDomain = email.includes('@') ? email.split('@').at(-1)! : '';
    if (
      hostedDomain &&
      hostedDomain === emailDomain &&
      this.allowedHostedDomains.has(hostedDomain)
    ) {
      return;
    }

    throw AppError.forbidden('Google account is not authorized for Rhythm');
  }
}
