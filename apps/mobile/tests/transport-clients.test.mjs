/**
 * Transport client contract tests (Task 2)
 *
 * All behaviors are proven against the real module sources transpiled by
 * TypeScript.  No mocks for the modules under test; only external I/O
 * (fetch, token provider) is injected.
 *
 * Strategy: all four source files are concatenated into one bundle before
 * transpilation so there is a single in-process copy of ApiError.  This
 * avoids the `instanceof` cross-module identity problem that occurs when the
 * same class is evaluated twice via different `data:` URLs.
 *
 * Run:  node tests/transport-clients.test.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Load raw TypeScript sources
// ---------------------------------------------------------------------------

// types.ts is type-only — no runtime content — but we still read it to
// confirm the file exists and can be parsed.  The content is not included
// in the runtime bundle.
const [
  apiErrorSrc,
  ,
  requestHelperSrc,
  cloudSrc,
  pairedSrc,
  mobileGatewayServiceSrc,
] = await Promise.all([
  readFile(new URL('../lib/transport/api-error.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/transport/types.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/transport/request-helper.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/transport/rhythm-cloud-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/transport/paired-mac-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../providers/services/mobile-gateway-service.ts', import.meta.url), 'utf8'),
]);

// ---------------------------------------------------------------------------
// Build one bundle: types → api-error → clients
// ---------------------------------------------------------------------------
// We strip cross-module `import` declarations and redundant `export` keywords
// so the concatenated file compiles as a single module.  Each re-exported
// symbol remains exported from the bundle by its original declaration.

function stripLocalImports(src) {
  // Remove any line that is a local relative import (from './…')
  return src.replace(/^import\b[^'"]*from\s+['"]\.[^'"]*['"]\s*;?\n?/gm, '');
}

function stripTypeKeyword(src) {
  // Remove `export type { … }` — type-only re-exports; no-ops at runtime.
  return src.replace(/^export\s+type\s+\{[^}]*\}\s*;?\n?/gm, '');
}

function stripReExports(src) {
  // Remove `export { SomeName }` re-export statements; all symbols are
  // already exported by their original declarations in the bundle.
  return src.replace(/^export\s+\{[^}]*\}\s*;?\n?/gm, '');
}

function prepare(src) {
  return stripReExports(stripTypeKeyword(stripLocalImports(src)));
}

const bundleSrc = [
  // types.ts — type-only; strip it entirely (no runtime content).
  '// --- types (type-only, stripped) ---',

  // api-error.ts — strip its import of types
  '// --- api-error ---',
  prepare(apiErrorSrc),

  // request-helper.ts — shared executeRequest; strip imports of local modules
  '// --- request-helper ---',
  prepare(requestHelperSrc),

  // rhythm-cloud-client.ts — strip imports of local modules
  '// --- rhythm-cloud-client ---',
  prepare(cloudSrc),

  // paired-mac-client.ts — same
  '// --- paired-mac-client ---',
  prepare(pairedSrc),

  '// --- mobile-gateway-service ---',
  prepare(mobileGatewayServiceSrc),
].join('\n\n');

const transpiled = ts.transpileModule(bundleSrc, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    strict: false, // bundle mode: no strict mode needed for tests
  },
}).outputText;

const mod = await import(`data:text/javascript,${encodeURIComponent(transpiled)}`);

const {
  ApiError,
  createMobileGatewaySession,
  normalizeApiError,
  RhythmCloudClient,
  PairedMacClient,
} = mod;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function captureThrown(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** Assert that `err` is an ApiError structurally (works across bundle copies). */
function assertIsApiError(err, label) {
  assert.ok(err instanceof ApiError, `${label}: must be instanceof ApiError`);
  assert.ok(typeof err.source === 'string', `${label}: must have source`);
  assert.ok(typeof err.status === 'number', `${label}: must have status`);
  assert.ok(typeof err.code === 'string', `${label}: must have code`);
  assert.ok(typeof err.message === 'string', `${label}: must have message`);
  assert.ok(typeof err.retryable === 'boolean', `${label}: must have retryable`);
  assert.ok(err instanceof Error, `${label}: must extend Error`);
}

// ---------------------------------------------------------------------------
// SECTION 1: ApiError shape
// ---------------------------------------------------------------------------

{
  const err = new ApiError({ source: 'cloud', status: 401, code: 'UNAUTHORIZED', message: 'not authed', retryable: false });
  assert.equal(err.source, 'cloud');
  assert.equal(err.status, 401);
  assert.equal(err.code, 'UNAUTHORIZED');
  assert.equal(err.message, 'not authed');
  assert.equal(err.retryable, false);
  assert.ok(err instanceof Error, 'ApiError must extend Error');
  assert.equal(err.name, 'ApiError');
  console.log('  ✓ ApiError shape');
}

// ---------------------------------------------------------------------------
// SECTION 2: JSON error normalization
// ---------------------------------------------------------------------------

{
  const jsonBody = JSON.stringify({ code: 'FORBIDDEN', message: 'go away' });
  const err = normalizeApiError('cloud', 403, jsonBody, undefined);
  assertIsApiError(err, 'normalizeApiError JSON');
  assert.equal(err.status, 403);
  assert.equal(err.code, 'FORBIDDEN');
  assert.equal(err.message, 'go away');
  console.log('  ✓ JSON error normalizes to ApiError');
}

{
  const err = normalizeApiError('cloud', 500, 'Internal Server Error', undefined);
  assertIsApiError(err, 'normalizeApiError non-JSON');
  assert.equal(err.status, 500);
  assert.ok(err.message.length > 0, 'must have a non-empty message');
  console.log('  ✓ Non-JSON body normalizes to ApiError');
}

// ---------------------------------------------------------------------------
// SECTION 3: Token never appears in thrown error messages
// ---------------------------------------------------------------------------

{
  const SECRET_TOKEN = 'Bearer eyJsZWFrZWQudG9rZW4uaGVyZX0=';

  const makeCloudClient = () =>
    new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => SECRET_TOKEN });

  const makePairedClient = () =>
    new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => SECRET_TOKEN });

  const mockFetch401 = async () =>
    new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'token is invalid' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  // Cloud client token redaction
  const cloudErr = await captureThrown(() =>
    makeCloudClient().request('/test', { method: 'GET' }, mockFetch401),
  );
  assert.ok(cloudErr, 'cloud client must throw on 401');
  assert.ok(!String(cloudErr.message).includes(SECRET_TOKEN), 'cloud error must not leak token in message');
  assert.ok(!String(cloudErr.stack || '').includes(SECRET_TOKEN), 'cloud error must not leak token in stack');
  console.log('  ✓ Cloud client: token redacted from thrown error message');

  // Paired client token redaction
  const pairedErr = await captureThrown(() =>
    makePairedClient().request('/test', { method: 'GET' }, mockFetch401),
  );
  assert.ok(pairedErr, 'paired client must throw on 401');
  assert.ok(!String(pairedErr.message).includes(SECRET_TOKEN), 'paired error must not leak token in message');
  assert.ok(!String(pairedErr.stack || '').includes(SECRET_TOKEN), 'paired error must not leak token in stack');
  console.log('  ✓ Paired client: token redacted from thrown error message');
}

// ---------------------------------------------------------------------------
// SECTION 4: Cloud client uses Bearer token in Authorization header
// ---------------------------------------------------------------------------

{
  const CLOUD_TOKEN = 'cloud-bearer-abc123';
  let capturedHeaders = null;

  const mockFetch = async (_url, init) => {
    capturedHeaders = new Headers(init?.headers ?? {});
    return new Response(JSON.stringify({ data: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => CLOUD_TOKEN });
  await client.request('/resource', { method: 'GET' }, mockFetch);

  assert.ok(capturedHeaders, 'fetch must have been called');
  const auth = capturedHeaders.get('Authorization') || capturedHeaders.get('authorization');
  assert.ok(auth, 'Authorization header must be present');
  assert.ok(auth.startsWith('Bearer '), 'Cloud client must use Bearer scheme');
  assert.ok(auth.includes(CLOUD_TOKEN), 'Cloud client must include the token');
  console.log('  ✓ Cloud client sets Authorization: Bearer <token>');
}

// ---------------------------------------------------------------------------
// SECTION 5: Paired-Mac client uses Device token in Authorization header
// ---------------------------------------------------------------------------

{
  const DEVICE_TOKEN = 'device-token-xyz789';
  let capturedHeaders = null;

  const mockFetch = async (_url, init) => {
    capturedHeaders = new Headers(init?.headers ?? {});
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => DEVICE_TOKEN });
  await client.request('/health', { method: 'GET' }, mockFetch);

  assert.ok(capturedHeaders, 'fetch must have been called');
  const auth = capturedHeaders.get('Authorization') || capturedHeaders.get('authorization');
  assert.ok(auth, 'Authorization header must be present');
  assert.ok(auth.startsWith('Device '), 'Paired client must use Device scheme, not Bearer');
  assert.ok(auth.includes(DEVICE_TOKEN), 'Paired client must include the device token');
  console.log('  ✓ Paired client sets Authorization: Device <token>');
}

// ---------------------------------------------------------------------------
// SECTION 6: Cloud and paired clients use different auth header values
// ---------------------------------------------------------------------------

{
  const SHARED_SECRET = 'same-secret-value-for-both';
  let cloudAuth = null;
  let pairedAuth = null;

  const makeMockFetch = (capture) => async (_url, init) => {
    const h = new Headers(init?.headers ?? {});
    capture(h.get('Authorization') || h.get('authorization') || '');
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const cloudClient = new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => SHARED_SECRET });
  const pairedClient = new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => SHARED_SECRET });

  await cloudClient.request('/x', { method: 'GET' }, makeMockFetch((v) => (cloudAuth = v)));
  await pairedClient.request('/x', { method: 'GET' }, makeMockFetch((v) => (pairedAuth = v)));

  assert.notEqual(cloudAuth, pairedAuth, 'Cloud and paired clients must produce different Authorization header values');
  assert.ok(cloudAuth.startsWith('Bearer '), 'Cloud must use Bearer scheme');
  assert.ok(pairedAuth.startsWith('Device '), 'Paired must use Device scheme');
  console.log('  ✓ Cloud and paired clients use distinct auth schemes');
}

// ---------------------------------------------------------------------------
// SECTION 7: Retryable vs non-retryable errors
// ---------------------------------------------------------------------------

{
  const client = new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => 'tok' });

  const makeMockFetchStatus = (status) => async () =>
    new Response(JSON.stringify({ code: 'ERR', message: 'msg' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const err401 = await captureThrown(() => client.request('/x', {}, makeMockFetchStatus(401)));
  assertIsApiError(err401, 'err401');
  assert.equal(err401.retryable, false, '401 must not be retryable');

  const err429 = await captureThrown(() => client.request('/x', {}, makeMockFetchStatus(429)));
  assertIsApiError(err429, 'err429');
  assert.equal(err429.retryable, true, '429 must be retryable');

  const err500 = await captureThrown(() => client.request('/x', {}, makeMockFetchStatus(500)));
  assertIsApiError(err500, 'err500');
  assert.equal(err500.retryable, true, '5xx must be retryable');

  const err403 = await captureThrown(() => client.request('/x', {}, makeMockFetchStatus(403)));
  assertIsApiError(err403, 'err403');
  assert.equal(err403.retryable, false, '403 must not be retryable');

  console.log('  ✓ Retryable flag correct for 401/403/429/5xx');
}

// ---------------------------------------------------------------------------
// SECTION 8: PairedMacClient.sseUrl() returns URL string (no open connection)
// ---------------------------------------------------------------------------

{
  const client = new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => 'tok' });

  const url = client.sseUrl('/events', { sessionId: 'sess-1' });
  assert.ok(typeof url === 'string', 'sseUrl must return a string');
  assert.ok(url.startsWith('https://mac.tailscale.example.com'), 'SSE URL must use the configured base URL');
  assert.ok(url.includes('/events'), 'SSE URL must include the path');
  assert.ok(url.includes('sessionId=sess-1'), 'SSE URL must include query params');
  console.log('  ✓ PairedMacClient.sseUrl() returns URL string without opening a connection');
}

// ---------------------------------------------------------------------------
// SECTION 9: PairedMacClient.ptyUrl() converts https: → wss:
// ---------------------------------------------------------------------------

{
  const client = new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => 'tok' });

  const wssUrl = client.ptyUrl('pty-abc', { ticket: 'ticket-xyz' });
  assert.ok(typeof wssUrl === 'string', 'ptyUrl must return a string');
  assert.ok(wssUrl.startsWith('wss://'), 'ptyUrl must convert https: to wss:');
  assert.ok(wssUrl.includes('pty-abc'), 'ptyUrl must include the PTY id');
  assert.ok(wssUrl.includes('ticket=ticket-xyz'), 'ptyUrl must include ticket param');
  console.log('  ✓ PairedMacClient.ptyUrl() converts https://mac → wss://mac');
}

{
  // http base URL → ws:
  const client = new PairedMacClient({ baseUrl: 'http://mac.local:4001', getDeviceToken: async () => 'tok' });

  const wsUrl = client.ptyUrl('pty-def', {});
  assert.ok(wsUrl.startsWith('ws://'), 'ptyUrl must convert http: to ws:');
  console.log('  ✓ PairedMacClient.ptyUrl() converts http://mac → ws://mac');
}

// ---------------------------------------------------------------------------
// SECTION 10: Successful JSON response is returned as parsed data
// ---------------------------------------------------------------------------

{
  const expected = { sessions: ['a', 'b'], total: 2 };
  const mockFetch = async () =>
    new Response(JSON.stringify(expected), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const client = new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => 'tok' });
  const result = await client.request('/sessions', { method: 'GET' }, mockFetch);
  assert.deepEqual(result, expected);
  console.log('  ✓ Successful response returns parsed JSON data');
}

// ---------------------------------------------------------------------------
// SECTION 11: Network failure normalizes to retryable ApiError
// ---------------------------------------------------------------------------

{
  const client = new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => 'tok' });

  const mockFetch = async () => { throw new TypeError('Failed to fetch'); };

  const err = await captureThrown(() => client.request('/x', {}, mockFetch));
  assertIsApiError(err, 'network error');
  assert.equal(err.retryable, true, 'Network failures must be retryable');
  assert.ok(!err.message.includes('tok'), 'Network error must not expose token');
  console.log('  ✓ Network failure normalizes to retryable ApiError');
}

// ---------------------------------------------------------------------------
// SECTION 12: PairedMacClient retryable errors
// ---------------------------------------------------------------------------

{
  const client = new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => 'device-tok' });

  const makeFetch = (status) => async () =>
    new Response(JSON.stringify({ code: 'ERR', message: 'msg' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const err503 = await captureThrown(() => client.request('/x', {}, makeFetch(503)));
  assertIsApiError(err503, 'paired 503');
  assert.equal(err503.retryable, true, 'Paired 503 must be retryable');
  assert.equal(err503.source, 'paired-mac');

  const err401 = await captureThrown(() => client.request('/x', {}, makeFetch(401)));
  assertIsApiError(err401, 'paired 401');
  assert.equal(err401.retryable, false, 'Paired 401 must not be retryable');

  console.log('  ✓ Paired client retryable/source fields correct');
}

// ---------------------------------------------------------------------------
// SECTION 13: Source field identifies the correct backend
// ---------------------------------------------------------------------------

{
  const mockFetch = (status) => async () =>
    new Response(JSON.stringify({ code: 'ERR', message: 'msg' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const cloudClient = new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => 'tok' });
  const cloudErr = await captureThrown(() => cloudClient.request('/x', {}, mockFetch(500)));
  assert.equal(cloudErr.source, 'cloud', 'Cloud errors must have source=cloud');

  const pairedClient = new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => 'tok' });
  const pairedErr = await captureThrown(() => pairedClient.request('/x', {}, mockFetch(500)));
  assert.equal(pairedErr.source, 'paired-mac', 'Paired errors must have source=paired-mac');

  console.log('  ✓ Source field correctly identifies cloud vs paired-mac');
}

// ---------------------------------------------------------------------------
// SECTION 14 (Finding 1): subscribe() is an alias for sseUrl() — URL only, no connection
// ---------------------------------------------------------------------------

{
  const client = new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => 'tok' });

  assert.ok(typeof client.subscribe === 'function', 'PairedMacClient must expose subscribe()');

  const urlViaSubscribe = client.subscribe('/sessions/s1/events', { cursor: 'c42' });
  const urlViaSseUrl    = client.sseUrl('/sessions/s1/events', { cursor: 'c42' });

  assert.equal(typeof urlViaSubscribe, 'string', 'subscribe() must return a string URL');
  assert.equal(urlViaSubscribe, urlViaSseUrl, 'subscribe() must return the same URL as sseUrl()');
  assert.ok(urlViaSubscribe.startsWith('https://'), 'subscribe() must not switch protocol');
  assert.ok(urlViaSubscribe.includes('/sessions/s1/events'), 'subscribe() URL must contain the path');
  assert.ok(urlViaSubscribe.includes('cursor=c42'), 'subscribe() URL must include query params');
  console.log('  ✓ subscribe() is a documented alias for sseUrl() — returns URL string, no connection opened');
}

// ---------------------------------------------------------------------------
// SECTION 15 (Finding 2): server-echoed token in response body is scrubbed
// ---------------------------------------------------------------------------

{
  const SECRET = 'super-secret-bearer-token-XYZ';

  // Server echoes the token back in both message and code fields
  const echoingFetch = async () =>
    new Response(
      JSON.stringify({ code: `token=${SECRET}`, message: `Invalid token: ${SECRET}` }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );

  const cloudClient = new RhythmCloudClient({
    baseUrl: 'https://api.example.com',
    getToken: async () => SECRET,
  });

  const cloudErr = await captureThrown(() => cloudClient.request('/x', {}, echoingFetch));
  assertIsApiError(cloudErr, 'echoed-token cloud');
  assert.ok(!cloudErr.message.includes(SECRET), 'server-echoed token must be scrubbed from message');
  assert.ok(!cloudErr.code.includes(SECRET),    'server-echoed token must be scrubbed from code');
  console.log('  ✓ Cloud: server-echoed token scrubbed from error message and code');

  const pairedClient = new PairedMacClient({
    baseUrl: 'https://mac.tailscale.example.com',
    getDeviceToken: async () => SECRET,
  });

  const pairedErr = await captureThrown(() => pairedClient.request('/x', {}, echoingFetch));
  assertIsApiError(pairedErr, 'echoed-token paired');
  assert.ok(!pairedErr.message.includes(SECRET), 'server-echoed device token must be scrubbed from message');
  assert.ok(!pairedErr.code.includes(SECRET),    'server-echoed device token must be scrubbed from code');
  console.log('  ✓ Paired: server-echoed token scrubbed from error message and code');
}

// ---------------------------------------------------------------------------
// SECTION 16 (Finding 3a): token-provider rejection → ApiError, not raw provider error
// ---------------------------------------------------------------------------

{
  const brokenCloudClient = new RhythmCloudClient({
    baseUrl: 'https://api.example.com',
    getToken: async () => { throw new Error('SecureStore unavailable'); },
  });

  const err = await captureThrown(() => brokenCloudClient.request('/x', {}, async () => new Response('', { status: 200 })));
  assertIsApiError(err, 'token-provider failure cloud');
  assert.equal(err.source, 'cloud');
  assert.equal(err.retryable, true, 'token-provider failure must be retryable (transient store error)');
  assert.ok(!err.message.includes('SecureStore'), 'raw provider error message must not leak into ApiError');
  console.log('  ✓ Cloud: token provider rejection → retryable ApiError, raw message redacted');

  const brokenPairedClient = new PairedMacClient({
    baseUrl: 'https://mac.tailscale.example.com',
    getDeviceToken: async () => { throw new Error('Keychain locked'); },
  });

  const pairedErr = await captureThrown(() => brokenPairedClient.request('/x', {}, async () => new Response('', { status: 200 })));
  assertIsApiError(pairedErr, 'token-provider failure paired');
  assert.equal(pairedErr.source, 'paired-mac');
  assert.equal(pairedErr.retryable, true);
  assert.ok(!pairedErr.message.includes('Keychain'), 'raw provider error message must not leak into ApiError');
  console.log('  ✓ Paired: device-token provider rejection → retryable ApiError, raw message redacted');
}

// ---------------------------------------------------------------------------
// SECTION 17 (Finding 3b): success-path response.text() rejection → ApiError
// ---------------------------------------------------------------------------

{
  const bodyFailFetch = async () => {
    const resp = new Response('', { status: 200 });
    // Replace text() with a rejecting function to simulate a stream read failure
    Object.defineProperty(resp, 'text', { value: async () => { throw new Error('stream interrupted'); } });
    return resp;
  };

  const client = new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => 'tok' });
  const err = await captureThrown(() => client.request('/x', {}, bodyFailFetch));
  assertIsApiError(err, 'body-read failure');
  assert.equal(err.source, 'cloud');
  assert.equal(err.retryable, true, 'body-read failure must be retryable');
  assert.ok(!err.message.includes('stream interrupted'), 'raw body-read error must not leak into ApiError');
  console.log('  ✓ Cloud: success-path response.text() rejection → retryable ApiError');

  const pairedClient = new PairedMacClient({ baseUrl: 'https://mac.tailscale.example.com', getDeviceToken: async () => 'tok' });
  const pairedErr = await captureThrown(() => pairedClient.request('/x', {}, bodyFailFetch));
  assertIsApiError(pairedErr, 'body-read failure paired');
  assert.equal(pairedErr.source, 'paired-mac');
  assert.equal(pairedErr.retryable, true);
  console.log('  ✓ Paired: success-path response.text() rejection → retryable ApiError');
}

// ---------------------------------------------------------------------------
// SECTION 18 (Finding 6): no Content-Type on bodyless GET requests
// ---------------------------------------------------------------------------

{
  let capturedHeaders = null;

  const captureFetch = async (_url, init) => {
    capturedHeaders = new Headers(init?.headers ?? {});
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  // GET with no body — no Content-Type should be set
  const client = new RhythmCloudClient({ baseUrl: 'https://api.example.com', getToken: async () => 'tok' });
  await client.request('/resource', { method: 'GET' }, captureFetch);
  assert.ok(
    !capturedHeaders.has('Content-Type') && !capturedHeaders.has('content-type'),
    'GET without body must not set Content-Type header',
  );
  console.log('  ✓ GET without body does not set Content-Type (avoids CORS preflight)');

  // POST with body — Content-Type should be set
  await client.request('/resource', { method: 'POST', body: JSON.stringify({ x: 1 }) }, captureFetch);
  const ct = capturedHeaders.get('Content-Type') || capturedHeaders.get('content-type');
  assert.ok(ct && ct.includes('application/json'), 'POST with body must set Content-Type: application/json');
  console.log('  ✓ POST with body sets Content-Type: application/json');

  // Caller-supplied Content-Type is preserved
  await client.request('/resource', { method: 'POST', body: 'raw', headers: { 'Content-Type': 'text/plain' } }, captureFetch);
  const callerCt = capturedHeaders.get('Content-Type') || capturedHeaders.get('content-type');
  assert.ok(callerCt && callerCt.includes('text/plain'), 'Caller-supplied Content-Type must be preserved');
  console.log('  ✓ Caller-supplied Content-Type is preserved');
}

// ---------------------------------------------------------------------------
// SECTION 19: Cloud public requests do not require or send a bearer token
// ---------------------------------------------------------------------------

{
  let tokenProviderCalled = false;
  let capturedHeaders = null;
  const client = new RhythmCloudClient({
    baseUrl: 'https://api.example.com',
    getToken: async () => {
      tokenProviderCalled = true;
      throw new Error('No session exists yet');
    },
  });

  const result = await client.requestPublic(
    '/auth/google/mobile-exchange',
    { method: 'POST', body: JSON.stringify({ code: 'code' }) },
    async (_url, init) => {
      capturedHeaders = new Headers(init.headers ?? {});
      return new Response(JSON.stringify({ sessionToken: 'new-session' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );

  assert.equal(tokenProviderCalled, false, 'public request must not read the session token');
  assert.equal(capturedHeaders.has('Authorization'), false, 'public request must not send Authorization');
  assert.equal(result.sessionToken, 'new-session');
  console.log('  ✓ Cloud public request reaches mobile exchange without bearer auth');
}

// ---------------------------------------------------------------------------
// SECTION 20: Captured-token request supports local-first logout
// ---------------------------------------------------------------------------

{
  let tokenProviderCalled = false;
  let authorization = null;
  const client = new RhythmCloudClient({
    baseUrl: 'https://api.example.com',
    getToken: async () => {
      tokenProviderCalled = true;
      throw new Error('token was already removed locally');
    },
  });
  await client.requestWithToken(
    'captured-before-delete',
    '/auth/logout',
    { method: 'POST' },
    async (_url, init) => {
      authorization = new Headers(init.headers ?? {}).get('Authorization');
      return new Response(null, { status: 204 });
    },
  );
  assert.equal(tokenProviderCalled, false);
  assert.equal(authorization, 'Bearer captured-before-delete');
  console.log('  ✓ Captured token can perform best-effort logout after local deletion');
}

// ---------------------------------------------------------------------------
// SECTION 21: Raw paired transport resolves credentials per request
// ---------------------------------------------------------------------------

{
  const tokens = ['device-token-one', 'device-token-two'];
  const captures = [];
  const client = new PairedMacClient({
    baseUrl: 'https://mac.tailscale.example.com',
    getDeviceToken: async () => tokens.shift(),
  });
  const rawFetch = async (url, init) => {
    captures.push({
      url,
      authorization: new Headers(init.headers).get('Authorization'),
      project: new Headers(init.headers).get('X-Rhythm-Project-ID'),
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const first = await client.fetchResponse(
    '/mobile-gateway/opencode/session',
    { method: 'GET', headers: { 'X-Rhythm-Project-ID': 'project-one' } },
    rawFetch,
  );
  await client.fetchResponse(
    '/mobile-gateway/events',
    { method: 'GET', headers: { 'X-Rhythm-Project-ID': 'project-two' } },
    rawFetch,
  );

  assert.deepEqual(await first.json(), { ok: true });
  assert.deepEqual(captures, [
    {
      url: 'https://mac.tailscale.example.com/mobile-gateway/opencode/session',
      authorization: 'Device device-token-one',
      project: 'project-one',
    },
    {
      url: 'https://mac.tailscale.example.com/mobile-gateway/events',
      authorization: 'Device device-token-two',
      project: 'project-two',
    },
  ]);

  const pty = await new PairedMacClient({
    baseUrl: 'https://mac.tailscale.example.com',
    getDeviceToken: async () => 'pty-device-secret',
  }).ptyConnection('pty-one', 'project-one', {
    ticket: 'single-use-ticket',
  });
  assert.equal(pty.headers.Authorization, 'Device pty-device-secret');
  assert.equal(pty.headers['X-Rhythm-Project-ID'], 'project-one');
  assert.equal(pty.url.includes('pty-device-secret'), false);
  assert.equal(pty.url.includes('single-use-ticket'), true);
  console.log('  ✓ Raw paired fetch and PTY auth resolve uncached credentials');
}

// ---------------------------------------------------------------------------
// SECTION 22: Mobile create keeps profile scope atomic across paired auth
// ---------------------------------------------------------------------------

{
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init?.headers ?? {});
    captured = {
      authorization: headers.get('Authorization'),
      body: JSON.parse(String(init?.body ?? '{}')),
      project: headers.get('X-Rhythm-Project-ID'),
      url,
    };
    return new Response(
      JSON.stringify({
        id: 'session-scoped-first-turn',
        rhythm: { profileId: 'profile-restricted' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const client = new PairedMacClient({
      baseUrl: 'https://mac.tailscale.example.com',
      getDeviceToken: async () => 'device-scope-token',
    });
    const created = await createMobileGatewaySession(
      client,
      'project-scoped',
      {
        profileId: 'profile-restricted',
        title: 'Scoped first turn',
      },
    );

    assert.deepEqual(captured, {
      authorization: 'Device device-scope-token',
      body: {
        title: 'Scoped first turn',
        profileId: 'profile-restricted',
      },
      project: 'project-scoped',
      url: 'https://mac.tailscale.example.com/mobile-gateway/opencode/session',
    });
    assert.equal(created.rhythm.profileId, 'profile-restricted');
    assert.equal('mcpAllowlist' in captured.body, false);
    assert.equal('skillAllowlist' in captured.body, false);
    assert.equal('permission' in captured.body, false);
    console.log('  ✓ Mobile create sends profile atomically over paired Device auth');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log('\nAll transport-clients tests passed ✓');
