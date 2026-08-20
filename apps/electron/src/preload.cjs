const { contextBridge, ipcRenderer } = require('electron');

const appVersion = process.argv.find((value) => value.startsWith('--rhythm-shell-version='))?.slice(23) ?? 'unknown';
/** @param {string} name */
const runtimeValue = (name) => {
  const value = process.env[name]?.trim();
  return value || undefined;
};
const gateway = Object.freeze(Object.defineProperties({
  apiBase: runtimeValue('RHYTHM_LIVE_API_URL'),
  engineBase: runtimeValue('RHYTHM_LIVE_ENGINE_URL'),
}, {
  // ponytail: keep the established enumerable bridge receipt stable while extending it additively.
  productionApiBase: { value: runtimeValue('RHYTHM_PRODUCTION_API_URL') },
  setProductionApiBase: { value: (/** @type {string} */ value) => ipcRenderer.invoke('rhythm:production-api:set', value) },
}));
const auth = Object.freeze({
  signInWithGoogle: () => ipcRenderer.invoke('rhythm:auth:google-sign-in'),
});
// post-m1-p7-c4d/c4e: a narrow, purpose-built surface only — never an arbitrary-sign primitive.
// The private key never crosses this bridge, only its already-finished output (capability string,
// or a signature over server-supplied fields the main process itself builds the canonical string
// from). See src/human-approval-main-signer.mjs.
const humanApproval = Object.freeze({
  capability: () => ipcRenderer.invoke('rhythm:human-approval:capability'),
  /** @param {string} approvalId @param {'approved' | 'rejected'} status @param {string} decisionNonce @param {string | null} payloadDigest */
  signDecision: (approvalId, status, decisionNonce, payloadDigest) =>
    ipcRenderer.invoke('rhythm:human-approval:sign-decision', { approvalId, status, decisionNonce, payloadDigest }),
});
// Mirrors Flutter's AgentServerController state shape (starting/ready/failed + failureReason/
// stderrTail/errorMessage) — src/agent-server.mjs owns spawning; this just reports its state.
const agentServer = Object.freeze({
  status: () => ipcRenderer.invoke('rhythm:agent-server:status'),
  /** @param {(status: unknown) => void} callback */
  onStatusChange: (callback) => {
    const listener = (/** @type {unknown} */ _event, /** @type {unknown} */ snapshot) => callback(snapshot);
    ipcRenderer.on('rhythm:agent-server:status-changed', listener);
    return () => ipcRenderer.removeListener('rhythm:agent-server:status-changed', listener);
  },
});
// Renderer code can only reconcile pending approval IDs with the main process. Main validates the
// closed approval/session target schema and owns all text, presentation, dedupe, and navigation.
window.addEventListener('rhythm:approval-notifications', (event) => {
  if (!(event instanceof CustomEvent)) return;
  ipcRenderer.send('rhythm:approval-notifications:sync', event.detail);
});
contextBridge.exposeInMainWorld('rhythmShell', Object.freeze({
  version: 5,
  appVersion,
  platform: process.platform,
  gateway,
  auth,
  humanApproval,
  agentServer,
}));
