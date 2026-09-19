export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_DESKTOP_SCOPES = Object.freeze([
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
]);
export const GOOGLE_OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

const base64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

export function randomUrlSafeString(byteLength, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.getRandomValues) throw new Error('Secure randomness is unavailable');
  return base64Url(cryptoImpl.getRandomValues(new Uint8Array(byteLength)));
}

export async function generatePkcePair(cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('SHA-256 is unavailable');
  const verifier = randomUrlSafeString(64, cryptoImpl);
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function buildGoogleAuthorizationUrl({ clientId, redirectUri, codeChallenge, state }) {
  const params = new URLSearchParams([
    ['client_id', clientId],
    ['redirect_uri', redirectUri],
    ['response_type', 'code'],
    ['scope', GOOGLE_DESKTOP_SCOPES.join(' ')],
    ['code_challenge', codeChallenge],
    ['code_challenge_method', 'S256'],
    ['state', state],
    ['access_type', 'offline'],
    ['prompt', 'consent'],
    ['include_granted_scopes', 'true'],
  ]);
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export function validateGoogleCallback(params, expectedState) {
  const code = params.get('code');
  const error = params.get('error');
  const state = params.get('state');
  if (error !== null) throw new Error(`Google OAuth error: ${error}`);
  if (state !== expectedState) throw new Error('Google OAuth state mismatch');
  if (code === null || code.length === 0) throw new Error('Google OAuth did not return a code');
  return code;
}

export function withOAuthTimeout(
  promise,
  timeoutMs = GOOGLE_OAUTH_CALLBACK_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
) {
  return new Promise((resolve, reject) => {
    let timeoutId;
    timeoutId = setTimer(() => reject(new Error('Google OAuth callback timed out')), timeoutMs);
    promise.then(
      (value) => { clearTimer(timeoutId); resolve(value); },
      (error) => { clearTimer(timeoutId); reject(error); },
    );
  });
}

export async function exchangeDesktopAuthorizationCode({
  apiBase,
  code,
  codeVerifier,
  redirectUri,
  fetcher = fetch,
}) {
  const response = await fetcher(`${apiBase}/auth/google/desktop-exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  });
  if (response.status !== 200) {
    throw new Error(`Server rejected Google sign-in: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.sessionToken !== 'string' || !payload.sessionToken || !payload.user || typeof payload.user !== 'object') {
    throw new Error('Server returned an invalid Google sign-in response');
  }
  return { sessionToken: payload.sessionToken, user: payload.user };
}
