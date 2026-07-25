import {
  AuthRequest,
  Prompt,
  type AuthRequestConfig,
  type AuthSessionResult,
} from 'expo-auth-session';
import { randomUUID } from 'expo-crypto';

import type { SignInParams } from './rhythm-session-store';

export const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
};

type MobileAuthRequest = {
  codeVerifier?: string;
  promptAsync(discovery: typeof GOOGLE_DISCOVERY): Promise<AuthSessionResult>;
};

type AuthRequestFactory = (config: AuthRequestConfig) => MobileAuthRequest;

function cryptographicNonce(): string {
  return `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
}

export async function startGoogleMobileOAuth({
  clientId,
  redirectUri,
  createRequest = (config) => new AuthRequest(config),
  createNonce = cryptographicNonce,
}: {
  clientId: string;
  redirectUri: string;
  createRequest?: AuthRequestFactory;
  createNonce?: () => string;
}): Promise<SignInParams> {
  if (!clientId) {
    throw new Error('Google mobile client ID is not configured.');
  }
  if (!redirectUri) {
    throw new Error('Google mobile redirect URI is not configured.');
  }

  const nonce = createNonce();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(nonce)) {
    throw new Error('Google sign-in could not create a secure nonce.');
  }

  const request = createRequest({
    clientId,
    redirectUri,
    responseType: 'code',
    scopes: ['openid', 'email', 'profile'],
    usePKCE: true,
    prompt: Prompt.SelectAccount,
    extraParams: { nonce },
  });
  const response = await request.promptAsync(GOOGLE_DISCOVERY);

  if (response.type !== 'success') {
    throw new Error(
      response.type === 'cancel' || response.type === 'dismiss'
        ? 'Google sign-in was cancelled.'
        : 'Google sign-in could not be completed.',
    );
  }

  const code = response.params.code;
  const codeVerifier = request.codeVerifier;
  if (!code || !codeVerifier) {
    throw new Error('Google sign-in did not return a valid authorization code.');
  }

  return { code, codeVerifier, nonce };
}
