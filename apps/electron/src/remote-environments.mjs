// #1374 slice 1 — electron-remote-environment-custody.
//
// A secondary desktop borrows a relay Device grant so it can continue an agent session that is
// actually running on the primary Mac. This module is the ONLY place in the Electron main process
// allowed to hold that Device token: it is fetched here, encrypted-at-rest here, attached to
// outbound requests here, and never crosses the preload bridge into the renderer (see
// docs/ai/decisions/2026-09-24-ocu35b-remote-access-trust-boundary.md).
//
// Server contract: apps/api_server/src/routes/relay_gateway_routes.ts (mobile-environments) and
// apps/api_server/src/routes/mobile_gateway_routes.ts (mobile-gateway/*).

const CAPABILITY = 'remote-attach-desktop-v1';
const MAX_ENV_ID_LENGTH = 128;
const MAX_DEVICE_NAME_LENGTH = 128;
const MAX_GRANT_BYTES = 64 * 1024;
const OPAQUE_ID = '[A-Za-z0-9_-]{1,128}';
const OPAQUE_VALUE = new RegExp(`^${OPAQUE_ID}$`);
/** @type {Readonly<Record<string, RegExp>>} */
const NO_QUERY = Object.freeze({});

/** @typedef {{ method: string, pattern: RegExp, query?: Record<string, RegExp> }} AllowedRemoteRoute */

// Every relay route a secondary desktop may reach directly, and — for the one route that needs
// one — the exact query parameter(s) the relay actually reads for it. `session.messages` paging
// is the `before` cursor (an opaque message id): see scopedQuery()/session.messages in
// apps/api_server/src/services/mobile_opencode_proxy.ts and readMirrorTranscript() in
// mobile_mirror_reads.ts. `limit` is intentionally NOT allowlisted here: the server always
// overrides it for this route (MOBILE_SESSION_MESSAGE_PAGE_SIZE), so a caller-supplied value is
// dead weight, not a real knob. No other route below takes a query string at all.
//
// The relay repeats ownership/project authorization server-side (requireMobileProjectScope,
// requireDevice); this allowlist exists so a compromised or buggy renderer cannot walk the Device
// token to an unrelated relay route (pairing codes, device revocation, PTY, artifacts, tools, ...)
// it was never granted for, and cannot smuggle an unexpected query parameter into a route it was
// granted for.
/** @type {ReadonlyArray<AllowedRemoteRoute>} */
const ALLOWED_REQUESTS = Object.freeze([
  { method: 'GET', pattern: new RegExp('^/mobile-gateway/opencode/experimental/session$') },
  { method: 'GET', pattern: new RegExp(`^/mobile-gateway/opencode/session/${OPAQUE_ID}/message$`), query: { before: OPAQUE_VALUE } },
  { method: 'GET', pattern: new RegExp(`^/mobile-gateway/sessions/${OPAQUE_ID}/events$`) },
  { method: 'POST', pattern: new RegExp(`^/mobile-gateway/opencode/session/${OPAQUE_ID}/prompt_async$`) },
  { method: 'POST', pattern: new RegExp(`^/mobile-gateway/opencode/permission/${OPAQUE_ID}/reply$`) },
  { method: 'POST', pattern: new RegExp(`^/mobile-gateway/opencode/question/${OPAQUE_ID}/reply$`) },
  { method: 'POST', pattern: new RegExp(`^/mobile-gateway/opencode/session/${OPAQUE_ID}/abort$`) },
  { method: 'GET', pattern: new RegExp('^/mobile-gateway/health$') },
]);

/**
 * Validates `method`+`path` (a path, optionally with a query string — never a full URL) against
 * ALLOWED_REQUESTS. The pathname must match one route exactly and, when that route declares a
 * query contract, every query key present must be one of its keys with a value matching its shape
 * (no unknown key, no repeated key). Anything else — an absolute or protocol-relative URL, a
 * dot-segment or double-slash pathname trick, a fragment — fails closed rather than being partly
 * allowed. `path` is parsed with `URL` against an inert base so the parser does the real work; the
 * raw, un-normalized pathname is then required to already equal the parsed (normalized) one, so a
 * `..`/`//` trick is rejected instead of silently resolved to whatever it normalizes to.
 * @param {unknown} method @param {unknown} path
 */
function matchAllowedRemoteGatewayRequest(method, path) {
  if (typeof method !== 'string' || typeof path !== 'string') return null;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#')) return null;
  let url;
  try {
    url = new URL(path, 'http://remote-attach.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'http://remote-attach.invalid' || url.username || url.password) return null;
  const rawPathname = path.split('?')[0];
  if (rawPathname !== url.pathname || rawPathname.includes('//')) return null;
  const route = ALLOWED_REQUESTS.find((row) => row.method === method && row.pattern.test(url.pathname));
  if (!route) return null;
  const allowedQuery = route.query ?? NO_QUERY;
  for (const key of new Set(url.searchParams.keys())) {
    const rule = allowedQuery[key];
    const values = url.searchParams.getAll(key);
    if (!rule || values.length !== 1 || !rule.test(values[0])) return null;
  }
  return route;
}

/** @param {unknown} method @param {unknown} path */
export function isAllowedRemoteGatewayRequest(method, path) {
  return matchAllowedRemoteGatewayRequest(method, path) !== null;
}

// The relay's requireMobileProjectScope needs the caller's project id, which this main-process
// module has no independent way to know; the renderer-side gateway supplies it per call. Every
// other header (Authorization, the capability marker) is owned exclusively by this module below.
const PASSTHROUGH_HEADER_NAMES = new Set(['x-rhythm-project-id']);

/** @param {Record<string, string> | undefined} headers */
function safeHeaders(headers) {
  /** @type {Record<string, string>} */
  const result = {};
  if (!headers || typeof headers !== 'object') return result;
  for (const [key, value] of Object.entries(headers)) {
    if (PASSTHROUGH_HEADER_NAMES.has(key.toLowerCase()) && typeof value === 'string' && value.length <= 256) {
      result[key] = value;
    }
  }
  return result;
}

/** @param {Record<string, string | undefined>} env */
export function remoteAttachEnabled(env = process.env) {
  return !['0', 'false'].includes((env.RHYTHM_REMOTE_ATTACH ?? '').toLowerCase());
}

/** @typedef {{ hostId: string, deviceId: string, deviceToken: string, gatewayBaseUrl: string }} RemoteGrant */

/** @param {unknown} grant @returns {grant is RemoteGrant} */
function validGrant(grant) {
  if (grant === null || typeof grant !== 'object' || Array.isArray(grant)) return false;
  const candidate = /** @type {Record<string, unknown>} */ (grant);
  return typeof candidate.hostId === 'string' && typeof candidate.deviceId === 'string' &&
    typeof candidate.deviceToken === 'string' && typeof candidate.gatewayBaseUrl === 'string';
}

/**
 * @param {{
 *   fetchFn?: typeof fetch,
 *   getProductionApiBase: () => string | undefined,
 *   getSessionToken: () => string | undefined,
 *   loadEncrypted: () => Promise<Buffer | null>,
 *   saveEncrypted: (bytes: Buffer) => Promise<void>,
 *   clearEncrypted: () => Promise<void>,
 *   safeStorage?: { isEncryptionAvailable(): boolean, encryptString(value: string): Buffer, decryptString(bytes: Buffer): string },
 *   env?: Record<string, string | undefined>,
 *   deviceName?: () => string,
 * }} options
 */
export function createRemoteEnvironmentsCustody(options) {
  /** @type {typeof fetch} */
  const defaultFetch = (...args) => globalThis.fetch(...args);
  const {
    fetchFn = defaultFetch,
    getProductionApiBase, getSessionToken,
    loadEncrypted, saveEncrypted, clearEncrypted,
    safeStorage, env = process.env,
    deviceName = () => 'Rhythm secondary desktop',
  } = options ?? {};
  if (![loadEncrypted, saveEncrypted, clearEncrypted, getProductionApiBase, getSessionToken].every((fn) => typeof fn === 'function')) {
    throw new Error('Invalid remote environments configuration');
  }
  const encrypted = () => safeStorage?.isEncryptionAvailable?.() === true;
  /** @type {RemoteGrant | null} */
  let grant = null;
  let loaded = false;

  const ensureLoaded = async () => {
    if (loaded) return;
    loaded = true;
    try {
      if (!safeStorage || !encrypted()) return;
      const bytes = await loadEncrypted();
      if (!bytes || !Buffer.isBuffer(bytes) || bytes.length > MAX_GRANT_BYTES) return;
      const candidate = JSON.parse(safeStorage.decryptString(bytes));
      if (validGrant(candidate)) grant = candidate;
    } catch { /* absent, unreadable, or foreign-format: start signed out of the remote environment */ }
  };

  const clearGrant = async () => {
    grant = null;
    loaded = true;
    await clearEncrypted();
  };

  return {
    async listEnvironments() {
      if (!remoteAttachEnabled(env)) return { state: 'disabled' };
      const base = getProductionApiBase();
      const token = getSessionToken();
      if (!base || !token) return { state: 'signed_out', environments: [] };
      const response = await fetchFn(`${base}/relay/mobile-environments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return { state: 'error', status: response.status, environments: [] };
      const body = await response.json().catch(() => ({}));
      return { state: 'ok', environments: Array.isArray(body?.environments) ? body.environments : [] };
    },

    /** @param {string} environmentId */
    async connect(environmentId) {
      if (!remoteAttachEnabled(env)) return { state: 'disabled' };
      if (typeof environmentId !== 'string' || !environmentId || environmentId.length > MAX_ENV_ID_LENGTH) {
        throw new Error('Invalid environment id');
      }
      const base = getProductionApiBase();
      const token = getSessionToken();
      if (!base || !token) return { state: 'signed_out' };
      const name = String(deviceName() ?? '').slice(0, MAX_DEVICE_NAME_LENGTH) || 'Rhythm secondary desktop';
      const response = await fetchFn(`${base}/relay/mobile-environments/${encodeURIComponent(environmentId)}/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName: name }),
      });
      if (response.status === 503) return { state: 'offline' };
      if (!response.ok) return { state: 'error', status: response.status };
      const payload = await response.json().catch(() => null);
      const candidate = payload && typeof payload === 'object' ? {
        hostId: payload.hostId, deviceId: payload.deviceId,
        deviceToken: payload.deviceToken, gatewayBaseUrl: payload.gatewayBaseUrl,
      } : null;
      if (!validGrant(candidate) || !Array.isArray(payload?.capabilities) || !payload.capabilities.includes(CAPABILITY)) {
        throw new Error('Invalid connect grant');
      }
      grant = candidate;
      loaded = true;
      if (safeStorage && encrypted()) await saveEncrypted(safeStorage.encryptString(JSON.stringify(grant)));
      // The device token itself never leaves main: the IPC result carries only its identity.
      return { state: 'connected', environmentId: grant.hostId, deviceId: grant.deviceId };
    },

    /** @param {{method?:string,path?:string,body?:unknown,headers?:Record<string,string>}} request */
    async request({ method, path, body, headers } = {}) {
      if (!remoteAttachEnabled(env)) return { state: 'disabled' };
      if (!isAllowedRemoteGatewayRequest(method, path)) {
        throw new Error(`Remote attach path not allowed: ${method} ${path}`);
      }
      await ensureLoaded();
      if (!grant) return { state: 'not_connected' };
      const response = await fetchFn(`${grant.gatewayBaseUrl}/relay${path}`, {
        method,
        headers: {
          ...safeHeaders(headers),
          Authorization: `Device ${grant.deviceToken}`,
          'X-Rhythm-Client-Capability': CAPABILITY,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401) { await clearGrant(); return { state: 'revoked' }; }
      const responseBody = await response.text();
      const nextCursor = response.headers?.get?.('x-next-cursor');
      return { state: 'ok', status: response.status, body: responseBody, ...(nextCursor ? { headers: { 'x-next-cursor': nextCursor } } : {}) };
    },

    /** SSE stream. onChunk receives raw decoded text chunks; onEnd fires exactly once whenever the
     * stream stops, whether the server closed it, the connection dropped, or stop() was called — the
     * caller (a renderer-side gateway) uses it to know when to re-subscribe. The caller
     * (registerRemoteEnvironments) routes chunks only to the requesting webContents.
     * @param {string} sessionId @param {(chunk: string) => void} onChunk @param {() => void} [onEnd] */
    async subscribe(sessionId, onChunk, onEnd) {
      if (!remoteAttachEnabled(env)) return { state: 'disabled' };
      const path = `/mobile-gateway/sessions/${encodeURIComponent(String(sessionId))}/events`;
      if (typeof sessionId !== 'string' || !sessionId || !isAllowedRemoteGatewayRequest('GET', path)) {
        throw new Error('Invalid remote session id');
      }
      await ensureLoaded();
      if (!grant) return { state: 'not_connected' };
      const controller = new AbortController();
      const response = await fetchFn(`${grant.gatewayBaseUrl}/relay${path}`, {
        headers: { Authorization: `Device ${grant.deviceToken}`, 'X-Rhythm-Client-Capability': CAPABILITY, Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (response.status === 401) { await clearGrant(); return { state: 'revoked' }; }
      if (!response.ok || !response.body) return { state: 'error', status: response.status, stop: () => controller.abort() };
      const decoder = new TextDecoder();
      const body = response.body;
      (async () => {
        try {
          for await (const chunk of body) onChunk(decoder.decode(chunk, { stream: true }));
        } catch { /* aborted locally, or the relay/uplink dropped the connection */ }
        finally { onEnd?.(); }
      })();
      return { state: 'ok', stop: () => controller.abort() };
    },

    async disconnect() { await clearGrant(); },
  };
}

/**
 * Wires the custody core to Electron IPC. Sender validation mirrors hermes-view.mjs's ownsDocument:
 * only the live main window's own main frame, on the app's own scheme, may call these channels.
 * @param {{ ipcMain: Electron.IpcMain, getWindow: () => Electron.BrowserWindow | undefined, custody: ReturnType<typeof createRemoteEnvironmentsCustody> }} options
 */
export function registerRemoteEnvironments({ ipcMain, getWindow, custody }) {
  /** @param {Electron.IpcMainInvokeEvent} event */
  const ownsDocument = (event) => {
    const win = getWindow();
    const contents = win && !win.isDestroyed?.() ? win.webContents : undefined;
    return Boolean(contents && !contents.isDestroyed() && event.sender === contents &&
      event.senderFrame && event.senderFrame === contents.mainFrame &&
      /^rhythm:\/\/app\/index\.html(?:#.*)?$/.test(event.senderFrame.url));
  };
  /** @param {Electron.IpcMainInvokeEvent} event */
  const requireOwnedDocument = (event) => { if (!ownsDocument(event)) throw new Error('Remote attach IPC denied'); };

  // One active stream per requesting webContents at a time, keyed by sessionId, so a page that
  // navigates or closes cannot leave a relay SSE connection running past its own lifetime.
  /** @type {Map<Electron.WebContents, Map<string, () => void>>} */
  const activeStreams = new Map();
  /** @param {Electron.WebContents} sender @param {string} sessionId */
  const stopStream = (sender, sessionId) => {
    const streams = activeStreams.get(sender);
    const stop = streams?.get(sessionId);
    if (!streams || !stop) return;
    streams.delete(sessionId);
    if (streams.size === 0) activeStreams.delete(sender);
    stop();
  };
  /** @param {Electron.WebContents} sender */
  const stopAllStreams = (sender) => {
    for (const sessionId of [...(activeStreams.get(sender)?.keys() ?? [])]) stopStream(sender, sessionId);
  };

  // Handlers are async so a denied sender becomes a rejected IPC reply (Electron's normal
  // contract), rather than a synchronous throw out of ipcMain's dispatch.
  ipcMain.handle('remote-env:list', async (event) => {
    requireOwnedDocument(event);
    return custody.listEnvironments();
  });
  ipcMain.handle('remote-env:connect', async (event, environmentId) => {
    requireOwnedDocument(event);
    return custody.connect(environmentId);
  });
  ipcMain.handle('remote-env:request', async (event, request) => {
    requireOwnedDocument(event);
    return custody.request(request);
  });
  ipcMain.handle('remote-env:disconnect', async (event) => {
    requireOwnedDocument(event);
    return custody.disconnect();
  });
  ipcMain.handle('remote-env:subscribe', async (event, sessionId) => {
    requireOwnedDocument(event);
    const sender = event.sender;
    stopStream(sender, sessionId);
    const result = await custody.subscribe(
      sessionId,
      (chunk) => { if (!sender.isDestroyed()) sender.send('remote-env:sse-chunk', { sessionId, chunk }); },
      () => {
        activeStreams.get(sender)?.delete(sessionId);
        if (!sender.isDestroyed()) sender.send('remote-env:sse-end', { sessionId });
      },
    );
    if (result.stop) {
      let streams = activeStreams.get(sender);
      if (!streams) {
        streams = new Map();
        activeStreams.set(sender, streams);
        sender.once('destroyed', () => stopAllStreams(sender));
      }
      streams.set(sessionId, result.stop);
    }
    return { state: result.state };
  });
  ipcMain.handle('remote-env:unsubscribe', async (event, sessionId) => {
    requireOwnedDocument(event);
    stopStream(event.sender, sessionId);
  });

  return { dispose: () => { for (const sender of [...activeStreams.keys()]) stopAllStreams(sender); } };
}
