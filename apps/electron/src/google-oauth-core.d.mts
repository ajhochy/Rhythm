export const GOOGLE_OAUTH_AUTHORIZE_URL: string;
export const GOOGLE_DESKTOP_SCOPES: readonly string[];
export const GOOGLE_OAUTH_CALLBACK_TIMEOUT_MS: number;

export interface DesktopAuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isFacilitiesManager?: boolean;
  photoUrl?: string | null;
  emailNotificationsEnabled?: boolean;
  artifactTabIds?: string[];
}

export interface DesktopAuthLoginResponse {
  sessionToken: string;
  user: DesktopAuthUser;
}

export function randomUrlSafeString(byteLength: number, cryptoImpl?: Crypto): string;
export function generatePkcePair(cryptoImpl?: Crypto): Promise<{ verifier: string; challenge: string }>;
export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string;
export function validateGoogleCallback(params: URLSearchParams, expectedState: string): string;
export function withOAuthTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number,
  setTimer?: (callback: () => void, delay: number) => unknown,
  clearTimer?: (timer: unknown) => void,
): Promise<T>;
export function exchangeDesktopAuthorizationCode(input: {
  apiBase: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}): Promise<DesktopAuthLoginResponse>;
