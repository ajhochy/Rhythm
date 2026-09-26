/** @typedef {{v: 1, type: 'navigate-session', sessionId: string} | {v: 1, type: 'new-chat', context: string}} HermesIntent */
export const MAX_HERMES_INTENT_BYTES = 64 * 1024;

/** Closed, JSON-only DTOs. Reject rather than truncate at this trust boundary.
 * @param {unknown} value @returns {HermesIntent | null}
 */
export function parseHermesIntent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const record = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(record);
    const { v, type, sessionId, context } = record;
    if (v !== 1 || keys.length !== 3 || !keys.includes('v') || !keys.includes('type')) return null;
    if (type === 'navigate-session' && keys.includes('sessionId')
      && typeof sessionId === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(sessionId)) {
      return { v: 1, type: 'navigate-session', sessionId };
    }
    if (type === 'new-chat' && keys.includes('context') && typeof context === 'string' && context.length <= MAX_HERMES_INTENT_BYTES
      && context.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(context)) {
      const intent = /** @type {const} */ ({ v: 1, type: 'new-chat', context });
      return Buffer.byteLength(JSON.stringify(intent), 'utf8') <= MAX_HERMES_INTENT_BYTES ? intent : null;
    }
  } catch { /* Cycles, getters, or unserializable values fail closed. */ }
  return null;
}

/** Only the supervisor's exact IPv4 loopback origin; never accept renderer URLs.
 * @param {unknown} value @returns {string | null}
 */
export function hermesReadyOrigin(value) {
  if (!value || typeof value !== 'object') return null;
  const status = /** @type {Record<string, unknown>} */ (value);
  if (status.state !== 'ready' || !Number.isInteger(status.port) || Number(status.port) < 1 || Number(status.port) > 65535 || typeof status.url !== 'string') return null;
  try {
    const url = new URL(status.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || Number(url.port || 80) !== status.port
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

/** @param {unknown} value @returns {{x: number, y: number, width: number, height: number} | null} */
export function parseHermesBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const bounds = /** @type {Record<string, unknown>} */ (value);
  if (Object.keys(bounds).length !== 4 || !['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]) && Math.abs(Number(bounds[key])) <= 1_000_000)) return null;
  const { x, y, width, height } = /** @type {{x: number, y: number, width: number, height: number}} */ (bounds);
  return width >= 0 && height >= 0 ? { x, y, width, height } : null;
}
