const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Runs inside the opaque, sandboxed artifact frame before the API's Flutter-oriented bootstrap.
// It adapts only the named RhythmBridge message channel to the React host's postMessage channel;
// it exposes no token, fetch primitive, filesystem path, shell, popup, or navigation capability.
export const ARTIFACT_FRAME_BRIDGE = `(function(){
  var nonces = new Map();
  var tokenBytes = new Uint32Array(4); crypto.getRandomValues(tokenBytes);
  var documentToken = Array.from(tokenBytes, function(value) { return value.toString(16).padStart(8, '0'); }).join('');
  var documentChannel = new MessageChannel();
  documentChannel.port1.onmessage = function(event) {
    var value = event.data;
    if (!value || value.__rhythmBridgeResponse !== true || value.documentToken !== documentToken || typeof value.id !== 'string') return;
    var nonce = nonces.get(value.id);
    if (!nonce || typeof window.__rhythmHostResponse !== 'function') return;
    nonces.delete(value.id);
    window.__rhythmHostResponse({ n: nonce, id: value.id, ok: !value.error, data: value.result, error: value.error });
  };
  documentChannel.port1.start();
  window.parent.postMessage({ __rhythmBridgeDocument: true, documentToken: documentToken }, '*', [documentChannel.port2]);
  var channel = Object.freeze({ postMessage: function(raw) {
    var value;
    try { value = JSON.parse(String(raw)); } catch (_) { return; }
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.nonce !== 'string') return;
    nonces.set(value.id, value.nonce);
    documentChannel.port1.postMessage({ __rhythmBridge: true, documentToken: documentToken, id: value.id, method: value.method, params: value.params });
  }});
  Object.defineProperty(window, 'RhythmBridge', { value: channel, writable: false, configurable: false });
})();`;

/** @param {string} id */
export function artifactFrameUrl(id) {
  if (typeof id !== 'string' || !ARTIFACT_ID.test(id)) throw new Error('Invalid live artifact id');
  return `rhythm-artifact://app/${id}`;
}

/** @param {{ method?: string, url?: string }} request */
export function parseArtifactFrameRequest(request) {
  if (request?.method !== 'GET' || typeof request.url !== 'string') return null;
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'rhythm-artifact:' || url.hostname !== 'app' || url.search || url.hash) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length === 1 && ARTIFACT_ID.test(segments[0]) ? segments[0] : null;
  } catch {
    return null;
  }
}

/** @param {string} document */
export function injectArtifactFrameBridge(document) {
  if (typeof document !== 'string') throw new TypeError('Artifact document must be text');
  const adapter = `<script>${ARTIFACT_FRAME_BRIDGE}</script>`;
  const firstScript = document.search(/<script\b/i);
  if (firstScript >= 0) return `${document.slice(0, firstScript)}${adapter}${document.slice(firstScript)}`;
  const headEnd = document.search(/<\/head\s*>/i);
  if (headEnd >= 0) return `${document.slice(0, headEnd)}${adapter}${document.slice(headEnd)}`;
  return `${adapter}${document}`;
}
