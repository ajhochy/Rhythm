// Closed bridge contract for a rendered live-artifact document (an untrusted HTML/CSS/JS bundle
// fetched from GET /live-artifacts/:id/render — apps/api_server/src/controllers/live_artifacts_controller.ts:45-72).
// The artifact document can reach the host ONLY through these four methods; there is no generic
// fetch/URL/path/filesystem/shell/clipboard/popup/navigation/download primitive here or anywhere
// this module is used. Mirrors the Flutter contract at
// origin/main:apps/desktop_flutter/lib/features/live_artifacts/services/live_artifact_bridge.dart:20-35.
export const ARTIFACT_METHODS = ['state.get', 'state.update', 'pco.services.read', 'host.blocked'];

const ENVELOPE_KEYS = ['id', 'method', 'params', 'nonce'];
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_IN_FLIGHT_REQUESTS = 8;

/**
 * Validate the closed envelope shape: exactly {id, method, params, nonce}, a canonical method,
 * a safe request id, and object params. Does not check nonce/binding — that is per-bridge state,
 * handled by createArtifactRequestPolicy().
 * @param {unknown} envelope
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateArtifactEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, reason: 'envelope must be an object' };
  }
  const keys = Object.keys(envelope);
  if (keys.length !== ENVELOPE_KEYS.length || !ENVELOPE_KEYS.every((key) => keys.includes(key))) {
    return { ok: false, reason: 'envelope must contain exactly id, method, params, and nonce' };
  }
  if (typeof envelope.id !== 'string' || !REQUEST_ID_RE.test(envelope.id)) {
    return { ok: false, reason: 'invalid request id' };
  }
  if (typeof envelope.method !== 'string' || !ARTIFACT_METHODS.includes(envelope.method)) {
    return { ok: false, reason: 'unsupported method' };
  }
  if (!envelope.params || typeof envelope.params !== 'object' || Array.isArray(envelope.params)) {
    return { ok: false, reason: 'params must be an object' };
  }
  if (typeof envelope.nonce !== 'string' || envelope.nonce.length === 0) {
    return { ok: false, reason: 'invalid nonce' };
  }
  return { ok: true };
}

/**
 * One instance is bound to exactly one selected artifact, authenticated user, and renderer
 * generation. `accept()` gates an inbound request envelope; `settle()` decides whether an
 * in-flight response may still be delivered once the async work behind it completes.
 * @param {{ artifactId: string, userId: number, documentNonce: string, rendererGeneration: number }} bound
 */
export function createArtifactRequestPolicy({ artifactId, userId, documentNonce, rendererGeneration }) {
  const seenRequestIds = new Set();
  let inFlight = 0;
  return {
    /**
     * @param {unknown} envelope
     * @param {{ documentNonce?: string }} [overrides] test/runtime seam to check against a
     *   different expected nonce than the one this policy was constructed with — a stale
     *   document's nonce must never match a fresh one.
     */
    accept(envelope, overrides = {}) {
      const validation = validateArtifactEnvelope(envelope);
      if (!validation.ok) return validation;
      const expectedNonce = overrides.documentNonce ?? documentNonce;
      if (envelope.nonce !== expectedNonce) return { ok: false, reason: 'nonce mismatch' };
      if (seenRequestIds.has(envelope.id)) return { ok: false, reason: 'duplicate request id' };
      if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_PAYLOAD_BYTES) {
        return { ok: false, reason: 'payload exceeds 64 KiB' };
      }
      if (inFlight >= MAX_IN_FLIGHT_REQUESTS) return { ok: false, reason: 'too many in-flight requests' };
      seenRequestIds.add(envelope.id);
      inFlight += 1;
      return { ok: true };
    },
    /**
     * Frees the in-flight slot and reports whether the response is still bound to the artifact,
     * user, and renderer generation this policy was constructed with. A stale artifact selection,
     * signed-out/switched user, or reloaded renderer must discard the response rather than deliver
     * it into whatever is now on screen.
     * @param {string} _requestId
     * @param {{ artifactId: string, userId: number, rendererGeneration: number }} context
     */
    settle(_requestId, context) {
      inFlight = Math.max(0, inFlight - 1);
      const deliver = context.artifactId === artifactId
        && context.userId === userId
        && context.rendererGeneration === rendererGeneration;
      return { deliver };
    },
  };
}
