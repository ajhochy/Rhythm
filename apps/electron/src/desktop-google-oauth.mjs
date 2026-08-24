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

const sendCallbackPage = (response, status, body) => new Promise((resolve, reject) => {
  const socket = response.socket;
  let finished = false;
  const settle = (callback) => {
    if (finished) return;
    finished = true;
    callback();
  };
  response.once('error', (error) => settle(() => reject(error)));
  response.once('finish', () => {
    const flushed = () => setImmediate(() => settle(resolve));
    if (!socket || socket.destroyed) flushed();
    else socket.once('close', flushed);
  });
  response.shouldKeepAlive = false;
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  response.end(body);
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
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || requestUrl.pathname !== '/callback') {
        await sendCallbackPage(response, 404, 'Not found');
        return;
      }
      const error = requestUrl.searchParams.get('error');
      const code = requestUrl.searchParams.get('code');
      let validatedCode;
      try {
        validatedCode = validateGoogleCallback(requestUrl.searchParams, state);
      } catch (callbackError) {
        await sendCallbackPage(response, 200, browserResponse(error, code !== null)).catch(() => undefined);
        rejectCallback(callbackError);
        return;
      }
      await sendCallbackPage(response, 200, browserResponse(error, true));
      settleCallback(validatedCode);
    })().catch((error) => rejectCallback(error));
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
