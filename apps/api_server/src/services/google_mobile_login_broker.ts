import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface GoogleMobileLoginIdentity {
  googleSub: string;
  email: string;
  name: string;
  photoUrl: string | null;
  hostedDomain: string | null;
}

interface PendingLogin {
  appState: string;
  browserBindingHash: string;
  codeChallenge: string;
  expiresAt: number;
  nonce: string;
}

interface PendingHandoff {
  codeChallenge: string;
  expiresAt: number;
  identity: GoogleMobileLoginIdentity;
}

export class GoogleMobileLoginMissing extends Error {}
export class GoogleMobileLoginInvalid extends Error {}
export class GoogleMobileLoginRateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('mobile_login_rate_limited');
  }
}

const LOGIN_TTL_MS = 5 * 60 * 1000;
const HANDOFF_TTL_MS = 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 10;
const MAX_ENTRIES = 1_000;
const MOBILE_STATE_PREFIX = 'mobile_login_';
const OPAQUE_ID = /^[A-Za-z0-9_-]{43}$/;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** Process-local by design; a hosted API restart fails the short login flow closed. */
export class GoogleMobileLoginBroker {
  private readonly logins = new Map<string, PendingLogin>();
  private readonly handoffs = new Map<string, PendingHandoff>();
  private readonly rateWindows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly options: {
      now?: () => number;
      randomId?: () => string;
    } = {},
  ) {
    const cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    cleanupTimer.unref();
  }

  static isMobileState(value: unknown): boolean {
    return typeof value === 'string'
      ? value.startsWith(MOBILE_STATE_PREFIX)
      : Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry.startsWith(MOBILE_STATE_PREFIX));
  }

  begin(input: { appState: string; codeChallenge: string; rateKey: string }): {
    browserBinding: string;
    expiresAt: number;
    nonce: string;
    state: string;
  } {
    this.cleanup();
    this.enforceRateLimit(input.rateKey);
    if (this.logins.size >= MAX_ENTRIES) throw new GoogleMobileLoginRateLimited(60);

    const state = `${MOBILE_STATE_PREFIX}${this.randomId()}`;
    const browserBinding = this.randomId();
    const nonce = this.randomId();
    this.logins.set(hash(state), {
      appState: input.appState,
      browserBindingHash: hash(browserBinding),
      codeChallenge: input.codeChallenge,
      expiresAt: this.now() + LOGIN_TTL_MS,
      nonce,
    });
    return { state, browserBinding, nonce, expiresAt: this.now() + LOGIN_TTL_MS };
  }

  consumeLogin(state: string, browserBinding: string | undefined): PendingLogin {
    this.cleanup();
    const key = hash(state);
    const login = this.logins.get(key);
    if (!login) throw new GoogleMobileLoginMissing();
    if (!browserBinding || !this.equalHash(login.browserBindingHash, hash(browserBinding))) {
      throw new GoogleMobileLoginInvalid();
    }
    // Synchronous transition before Google exchange prevents callback replay.
    this.logins.delete(key);
    return login;
  }

  issueHandoff(identity: GoogleMobileLoginIdentity, codeChallenge: string): string {
    this.cleanup();
    if (this.handoffs.size >= MAX_ENTRIES) throw new GoogleMobileLoginRateLimited(60);
    const code = this.randomId();
    this.handoffs.set(hash(code), {
      codeChallenge,
      expiresAt: this.now() + HANDOFF_TTL_MS,
      identity: { ...identity },
    });
    return code;
  }

  consumeHandoff(code: string, verifier: string): GoogleMobileLoginIdentity {
    this.cleanup();
    const key = hash(code);
    const handoff = this.handoffs.get(key);
    if (!handoff) throw new GoogleMobileLoginMissing();
    const actualChallenge = createHash('sha256').update(verifier).digest('base64url');
    if (!this.equalHash(hash(handoff.codeChallenge), hash(actualChallenge))) {
      throw new GoogleMobileLoginInvalid();
    }
    // Synchronous consume-before-await guarantees at most one session creation.
    this.handoffs.delete(key);
    return { ...handoff.identity };
  }

  cleanup(): void {
    const now = this.now();
    for (const [key, value] of this.logins) if (value.expiresAt <= now) this.logins.delete(key);
    for (const [key, value] of this.handoffs) if (value.expiresAt <= now) this.handoffs.delete(key);
    for (const [key, value] of this.rateWindows) if (value.resetAt <= now) this.rateWindows.delete(key);
  }

  resetForTests(): void {
    this.logins.clear();
    this.handoffs.clear();
    this.rateWindows.clear();
  }

  private enforceRateLimit(key: string): void {
    const current = this.rateWindows.get(key);
    if (current && current.count >= RATE_LIMIT) {
      throw new GoogleMobileLoginRateLimited(Math.max(1, Math.ceil((current.resetAt - this.now()) / 1000)));
    }
    if (current) current.count += 1;
    else {
      if (this.rateWindows.size >= MAX_ENTRIES) throw new GoogleMobileLoginRateLimited(60);
      this.rateWindows.set(key, { count: 1, resetAt: this.now() + RATE_WINDOW_MS });
    }
  }

  private randomId(): string {
    const id = this.options.randomId?.() ?? randomBytes(32).toString('base64url');
    if (!OPAQUE_ID.test(id)) throw new GoogleMobileLoginInvalid();
    return id;
  }

  private equalHash(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export const googleMobileLoginBroker = new GoogleMobileLoginBroker();
