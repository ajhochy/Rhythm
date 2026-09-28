import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** @typedef {{ secret: string, baseUrl: string, port: number }} BridgeRegistrar */
/** @typedef {{ sequence: number, attemptId: string, profile: string, serverOrigin: string, authGeneration: string, sessionToken: string, grantId: string, capability: string, capabilitySha256: string, bridgeOrigin: string, registered: boolean, retired: boolean, registrarDigest?: string }} BridgeAttempt */
/** @typedef {{ confirmationId: string, agentId: string, agentLabel: string, expectedRevision: number, currentRevision: number, fields: Array<{name: string, before: unknown, after: unknown}>, changesSha256: string }} ConfirmationSummary */
/** @typedef {{ serverOrigin: string, profile: string, runtimeGeneration: string, memoryVaultId: string }} MemoryConsentIdentity */

const BRIDGE_PREFIX = '/agent-bridge/v1';
const DEFAULT_SCOPES = Object.freeze([
  'catalog.read', 'agent.write', 'projection.issue', 'runtime.report', 'delegation.dispatch', 'delegation.execute',
]);
const REGISTRATION_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const LOOPBACK_ORIGIN_PATTERN = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;

/** @param {string} value */
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
/** @param {number} milliseconds */
const delay = (milliseconds) => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  timer.unref?.();
});

/** @param {unknown} value @returns {BridgeRegistrar | undefined} */
function validRegistrar(value) {
  if (!value || typeof value !== 'object') return undefined;
  const { secret, baseUrl, port } = /** @type {Record<string, unknown>} */ (value);
  if (typeof secret !== 'string' || secret.length < 16) return undefined;
  if (typeof baseUrl !== 'string' || !LOOPBACK_ORIGIN_PATTERN.test(baseUrl)) return undefined;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535 || baseUrl !== `http://127.0.0.1:${port}`) return undefined;
  return { secret, baseUrl, port };
}

/** @param {string} code */
function responseError(code) { return Object.assign(new Error(code), { code }); }

/**
 * Main-only capability lifecycle for the local Rhythm ↔ Hermes bridge.
 * @param {{
 *   getRegistrar: () => BridgeRegistrar | undefined,
 *   getSessionToken: () => string | undefined,
 *   getMemoryConsent?: (identity: MemoryConsentIdentity) => Promise<{granted: boolean, memoryVaultId?: string}> | {granted: boolean, memoryVaultId?: string},
 *   confirmNative: (summary: ConfirmationSummary) => Promise<boolean>,
 *   fetchImpl?: typeof fetch,
 *   log?: (entry: {component: string, code: string}) => void,
 * }} options
 */
export function createAgentBridgeHost({
  getRegistrar,
  getSessionToken,
  getMemoryConsent = async () => ({ granted: false }),
  confirmNative,
  fetchImpl = fetch,
  log = () => {},
}) {
  /** @type {BridgeAttempt | undefined} */
  let active;
  let sequence = 0;
  /** @type {string | undefined} */
  let blockedRegistrarDigest;
  /** @type {string | undefined} */
  let confirmationGeneration;

  /** @param {string} code */
  const safeLog = (code) => {
    try { log({ component: 'agent-bridge', code }); } catch {}
  };
  const currentRegistrar = () => validRegistrar(getRegistrar?.());
  /** @param {BridgeRegistrar} registrar @param {boolean} [json] */
  const registrarHeaders = (registrar, json = false) => ({
    'X-Rhythm-Bridge-Registrar': registrar.secret,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  });
  /** @param {BridgeRegistrar} registrar @param {string} path @param {{method?: string, body?: unknown}} [options] @returns {Promise<any>} */
  const registrarRequest = async (registrar, path, { method = 'GET', body } = {}) => {
    let response;
    try {
      response = await fetchImpl(`${registrar.baseUrl}${BRIDGE_PREFIX}${path}`, {
        method,
        headers: registrarHeaders(registrar, body !== undefined),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
      });
    } catch {
      throw responseError('bridge_request_failed');
    }
    if (!response.ok) throw responseError(`bridge_http_${response.status}`);
    if (response.status === 204) return undefined;
    try { return await response.json(); }
    catch { throw responseError('bridge_invalid_response'); }
  };

  /** @param {BridgeAttempt} attempt @param {BridgeRegistrar} registrar */
  const consentFor = async (attempt, registrar) => {
    let vault;
    try { vault = await registrarRequest(registrar, '/registrar/memory-vault'); }
    catch { return {}; }
    const memoryVaultId = vault?.memoryVaultId;
    if (typeof memoryVaultId !== 'string' || !DIGEST_PATTERN.test(memoryVaultId)) return {};
    let consent;
    try {
      consent = await getMemoryConsent({
        serverOrigin: attempt.serverOrigin,
        profile: attempt.profile,
        runtimeGeneration: attempt.attemptId,
        memoryVaultId,
      });
    } catch { return {}; }
    if (consent?.granted === true && consent.memoryVaultId === memoryVaultId) {
      return { memoryVaultId, scopes: [...DEFAULT_SCOPES, 'memory.search'] };
    }
    return {};
  };

  /** @param {BridgeAttempt} attempt @param {BridgeRegistrar} registrar */
  const registerOnce = async (attempt, registrar) => {
    const consent = await consentFor(attempt, registrar);
    await registrarRequest(registrar, '/registrar/grants', {
      method: 'POST',
      body: {
        grantId: attempt.grantId,
        capabilitySha256: attempt.capabilitySha256,
        sessionToken: attempt.sessionToken,
        hermesProfile: 'default',
        runtimeGeneration: attempt.attemptId,
        serverOrigin: attempt.serverOrigin,
        authGeneration: attempt.authGeneration,
        scopes: consent.scopes ?? [...DEFAULT_SCOPES],
        ...(consent.memoryVaultId ? { memoryVaultId: consent.memoryVaultId } : {}),
      },
    });
    if (active === attempt && !attempt.retired) {
      attempt.registered = true;
      attempt.registrarDigest = sha256(registrar.secret);
    }
  };

  /** @param {BridgeAttempt} attempt @param {number} [startIndex] */
  const registerWithRetry = async (attempt, startIndex = 0) => {
    const ownSequence = attempt.sequence;
    let retryIndex = startIndex;
    while (active === attempt && !attempt.retired && ownSequence === attempt.sequence) {
      const registrar = currentRegistrar();
      if (!registrar || blockedRegistrarDigest === sha256(registrar.secret)) return;
      try {
        await registerOnce(attempt, registrar);
        return;
      } catch {
        attempt.registered = false;
        safeLog('registration_retry');
      }
      await delay(REGISTRATION_DELAYS_MS[Math.min(retryIndex, REGISTRATION_DELAYS_MS.length - 1)]);
      retryIndex += 1;
    }
  };
  /** @param {BridgeAttempt} attempt */
  const queueRegistration = (attempt) => queueMicrotask(() => { void registerWithRetry(attempt); });

  /** @param {string} generation @param {BridgeRegistrar} registrar */
  const pollConfirmation = async (generation, registrar) => {
    if (confirmationGeneration !== generation) return;
    try {
      const summary = await registrarRequest(registrar, '/registrar/confirmations/next', {
        method: 'POST', body: { waitMs: 20_000 },
      });
      if (confirmationGeneration !== generation) return;
      if (summary) {
        let approve = false;
        try { approve = await confirmNative?.(summary) === true; } catch {}
        await registrarRequest(registrar, `/registrar/confirmations/${encodeURIComponent(summary.confirmationId)}/decision`, {
          method: 'POST', body: { changesSha256: summary.changesSha256, approve },
        });
      }
      const timer = setTimeout(() => { void pollConfirmation(generation, registrar); }, 10);
      timer.unref?.();
    } catch {
      safeLog('confirmation_poll_retry');
      const timer = setTimeout(() => { void pollConfirmation(generation, registrar); }, 1_000);
      timer.unref?.();
    }
  };
  /** @param {BridgeRegistrar} registrar */
  const startConfirmationLoop = (registrar) => {
    const generation = `${sha256(registrar.secret)}:${++sequence}`;
    confirmationGeneration = generation;
    queueMicrotask(() => { void pollConfirmation(generation, registrar); });
  };

  return Object.freeze({
    /** @param {{attemptId: string, profile: string, serverOrigin: string, authGeneration: string}} input */
    mintForAttempt({ attemptId, profile, serverOrigin, authGeneration }) {
      const registrar = currentRegistrar();
      const sessionToken = getSessionToken?.();
      const registrarDigest = registrar ? sha256(registrar.secret) : undefined;
      if (registrarDigest && blockedRegistrarDigest && registrarDigest !== blockedRegistrarDigest) blockedRegistrarDigest = undefined;
      if (!registrar || blockedRegistrarDigest === registrarDigest) return {};
      if (profile !== 'default' || typeof sessionToken !== 'string' || sessionToken.length === 0) return {};
      if (typeof attemptId !== 'string' || typeof serverOrigin !== 'string' || typeof authGeneration !== 'string') return {};

      if (active && !active.retired && active.attemptId === attemptId && active.profile === profile
        && active.serverOrigin === serverOrigin && active.authGeneration === authGeneration) {
        return {
          HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE: active.capability,
          HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE_ORIGIN: active.bridgeOrigin,
        };
      }

      const capability = randomBytes(32).toString('base64url');
      if (!TOKEN_PATTERN.test(capability)) return {};
      if (active) active.retired = true;
      /** @type {BridgeAttempt} */
      const attempt = {
        sequence: ++sequence,
        attemptId,
        profile,
        serverOrigin,
        authGeneration,
        sessionToken,
        grantId: randomUUID(),
        capability,
        capabilitySha256: sha256(capability),
        bridgeOrigin: registrar.baseUrl,
        registered: false,
        retired: false,
      };
      active = attempt;
      queueRegistration(attempt);
      return {
        HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE: capability,
        HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE_ORIGIN: registrar.baseUrl,
      };
    },

    /** @param {string} attemptId */
    async retire(attemptId) {
      const attempt = active;
      if (!attempt || attempt.attemptId !== attemptId) return;
      attempt.retired = true;
      active = undefined;
      const registrar = currentRegistrar();
      if (!registrar) return;
      await registrarRequest(registrar, `/registrar/grants/${encodeURIComponent(attempt.grantId)}`, { method: 'DELETE' });
    },

    async revokeAll() {
      const registrar = currentRegistrar();
      if (!registrar) {
        if (active) active.retired = true;
        active = undefined;
        return;
      }
      const digest = sha256(registrar.secret);
      if (active) active.retired = true;
      active = undefined;
      for (const wait of [0, 250, 750, 1_500]) {
        if (wait) await delay(wait);
        try {
          await registrarRequest(registrar, '/registrar/revoke-all', { method: 'POST', body: {} });
          blockedRegistrarDigest = undefined;
          return;
        } catch {}
      }
      blockedRegistrarDigest = digest;
      safeLog('revocation_failed');
      throw responseError('bridge revocation failed');
    },

    /** @param {string} scope */
    async revokeScope(scope) {
      if (typeof scope !== 'string' || !scope) return;
      const attempt = active;
      const registrar = currentRegistrar();
      if (!attempt || !registrar || !attempt.registered) return;
      await registrarRequest(registrar, `/registrar/grants/${encodeURIComponent(attempt.grantId)}/revoke-scopes`, {
        method: 'POST', body: { scopes: [scope] },
      });
    },

    async onRegistrarReady() {
      const registrar = currentRegistrar();
      if (!registrar) return;
      const digest = sha256(registrar.secret);
      if (blockedRegistrarDigest && blockedRegistrarDigest !== digest) blockedRegistrarDigest = undefined;
      if (active && blockedRegistrarDigest !== digest) {
        const attempt = active;
        attempt.registered = false;
        await registerOnce(attempt, registrar).catch(() => { queueRegistration(attempt); });
      }
      startConfirmationLoop(registrar);
    },

    status() {
      const registrar = currentRegistrar();
      if (!registrar) return { available: false, reason: 'runtime_unowned' };
      if (blockedRegistrarDigest === sha256(registrar.secret)) return { available: false, reason: 'bridge_unavailable' };
      if (!active) return { available: false, reason: 'bridge_unavailable' };
      if (!active.registered) return { available: false, reason: 'registering' };
      return { available: true, reason: null };
    },
  });
}
