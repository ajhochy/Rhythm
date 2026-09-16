import { encode as encodeBase64 } from 'base-64';
import Constants from 'expo-constants';
import {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digestStringAsync,
  getRandomBytesAsync,
} from 'expo-crypto';
import { openAuthSessionAsync, type WebBrowserAuthSessionResult } from 'expo-web-browser';

import type { SignInParams } from './rhythm-session-store';

const FIXED_HOSTED_MOBILE_OAUTH_ORIGIN = 'https://api.vcrcapps.com';
export const HOSTED_MOBILE_OAUTH_ORIGIN =
  Constants.expoConfig?.extra?.hostedOAuthOrigin === FIXED_HOSTED_MOBILE_OAUTH_ORIGIN
    ? Constants.expoConfig.extra.hostedOAuthOrigin
    : FIXED_HOSTED_MOBILE_OAUTH_ORIGIN;
export const HOSTED_MOBILE_CALLBACK = 'rhythmagents://oauth/callback';

const OPAQUE_VALUE = /^[A-Za-z0-9_-]{43}$/;

type OpenAuthSession = (
  url: string,
  redirectUrl: string,
  options: { preferEphemeralSession: boolean },
) => Promise<WebBrowserAuthSessionResult>;

export class HostedMobileOAuthError extends Error {
  readonly cancelled: boolean;

  constructor(message: string, cancelled = false) {
    super(message);
    this.name = 'HostedMobileOAuthError';
    this.cancelled = cancelled;
  }
}

function base64Url(bytes: Uint8Array): string {
  return encodeBase64(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function buildHostedMobileBeginUrl({
  codeChallenge,
  appState,
}: {
  codeChallenge: string;
  appState: string;
}): string {
  if (!OPAQUE_VALUE.test(codeChallenge) || !OPAQUE_VALUE.test(appState)) {
    throw new HostedMobileOAuthError('Google sign-in could not create secure request values.');
  }
  const url = new URL('/auth/google/mobile-begin', HOSTED_MOBILE_OAUTH_ORIGIN);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('app_state', appState);
  return url.toString();
}

export function validateHostedMobileCallback(url: string, expectedState: string): string {
  if (url.length > 2048 || !OPAQUE_VALUE.test(expectedState)) {
    throw new HostedMobileOAuthError('Google sign-in returned an invalid callback.');
  }
  let callback: URL;
  try {
    callback = new URL(url);
  } catch {
    throw new HostedMobileOAuthError('Google sign-in returned an invalid callback.');
  }
  const keys = [...callback.searchParams.keys()].sort();
  const codes = callback.searchParams.getAll('code');
  const states = callback.searchParams.getAll('state');
  if (
    callback.protocol !== 'rhythmagents:' ||
    callback.hostname !== 'oauth' ||
    callback.pathname !== '/callback' ||
    callback.username ||
    callback.password ||
    callback.port ||
    callback.hash ||
    keys.join(',') !== 'code,state' ||
    codes.length !== 1 ||
    states.length !== 1 ||
    !OPAQUE_VALUE.test(codes[0] ?? '') ||
    states[0] !== expectedState
  ) {
    throw new HostedMobileOAuthError('Google sign-in returned an invalid callback.');
  }
  return codes[0];
}

export async function startHostedMobileOAuth({
  randomBytes = getRandomBytesAsync,
  digest = (value: string) => digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    value,
    { encoding: CryptoEncoding.BASE64 },
  ),
  openAuthSession = openAuthSessionAsync,
}: {
  randomBytes?: (length: number) => Promise<Uint8Array>;
  digest?: (value: string) => Promise<string>;
  openAuthSession?: OpenAuthSession;
} = {}): Promise<SignInParams> {
  const [verifierBytes, stateBytes] = await Promise.all([
    randomBytes(32),
    randomBytes(32),
  ]);
  const codeVerifier = base64Url(verifierBytes);
  const appState = base64Url(stateBytes);
  const codeChallenge = (await digest(codeVerifier))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  const beginUrl = buildHostedMobileBeginUrl({ codeChallenge, appState });
  const result = await openAuthSession(beginUrl, HOSTED_MOBILE_CALLBACK, {
    preferEphemeralSession: true,
  });
  if (result.type !== 'success') {
    throw new HostedMobileOAuthError(
      result.type === 'cancel' || result.type === 'dismiss'
        ? 'Google sign-in was cancelled. Your existing account is unchanged.'
        : 'Google sign-in could not be completed. Start a fresh login.',
      result.type === 'cancel' || result.type === 'dismiss',
    );
  }
  return {
    code: validateHostedMobileCallback(result.url, appState),
    codeVerifier,
  };
}
