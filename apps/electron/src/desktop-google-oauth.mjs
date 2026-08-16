import { createServer } from 'node:http';
import {
  GOOGLE_OAUTH_CALLBACK_TIMEOUT_MS,
  buildGoogleAuthorizationUrl,
  exchangeDesktopAuthorizationCode,
  generatePkcePair,
  randomUrlSafeString,
  validateGoogleCallback,
  withOAuthTimeout,
} from './google-oauth-core.mjs';

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function browserResponse(error, hasCode) {
  const body = error !== null
    ? `<h2>Sign-in failed</h2><p>${escapeHtml(error)}</p><p>You can close this window.</p>`
    : hasCode
      ? '<h2>Signed in</h2><p>You can close this window and return to Rhythm.</p>'
      : '<h2>Missing code</h2><p>You can close this window.</p>';
  return `<html><body style="font-family: -apple-system, sans-serif; padding: 32px;">${body}</body></html>`;
}

const listenOnLoopback = (server) => new Promise((resolve, reject) => {
  const onError = (error) => reject(error);
  server.once('error', onError);
  server.listen(0, '127.0.0.1', () => {
    server.off('error', onError);
    const address = server.address();
    if (!address || typeof address === 'string') reject(new Error('Loopback server did not return a TCP port'));
    else resolve(address.port);
  });
});

const closeServer = (server) => new Promise((resolve) => {
  if (!server.listening) { resolve(); return; }
  server.close(() => resolve());
});

export async function runDesktopGoogleOAuth({
  clientId,
  apiBase,
  openExternal,
  fetcher = fetch,
  timeoutMs = GOOGLE_OAUTH_CALLBACK_TIMEOUT_MS,
  createLoopbackServer = createServer,
  onListening,
}) {
  if (!clientId) throw new Error('GOOGLE_DESKTOP_CLIENT_ID is not set; cannot start Google sign-in.');

  const { verifier, challenge } = await generatePkcePair();
  const state = randomUrlSafeString(32);
  let settleCallback;
  let rejectCallback;
  const callback = new Promise((resolve, reject) => {
    settleCallback = resolve;
    rejectCallback = reject;
  });
  const server = createLoopbackServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/callback') {
      response.statusCode = 404;
      response.end();
      return;
    }
    const error = requestUrl.searchParams.get('error');
    const code = requestUrl.searchParams.get('code');
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(browserResponse(error, code !== null));
    try {
      settleCallback(validateGoogleCallback(requestUrl.searchParams, state));
    } catch (callbackError) {
      rejectCallback(callbackError);
    }
  });

  try {
    const port = await listenOnLoopback(server);
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    onListening?.({ address: '127.0.0.1', port, callbackUrl: redirectUri });
    const authorizationUrl = buildGoogleAuthorizationUrl({
      clientId,
      redirectUri,
      codeChallenge: challenge,
      state,
    });
    await openExternal(authorizationUrl);
    const code = await withOAuthTimeout(callback, timeoutMs);
    return await exchangeDesktopAuthorizationCode({
      apiBase,
      code,
      codeVerifier: verifier,
      redirectUri,
      fetcher,
    });
  } finally {
    await closeServer(server);
  }
}
