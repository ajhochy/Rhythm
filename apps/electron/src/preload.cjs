const { contextBridge, ipcRenderer } = require('electron');

const appVersion = process.argv.find((value) => value.startsWith('--rhythm-shell-version='))?.slice(23) ?? 'unknown';
/** @param {string} name */
const runtimeValue = (name) => {
  const value = process.env[name]?.trim();
  return value || undefined;
};
const gateway = Object.freeze({
  apiBase: runtimeValue('RHYTHM_LIVE_API_URL'),
  engineBase: runtimeValue('RHYTHM_LIVE_ENGINE_URL'),
  productionApiBase: ipcRenderer.sendSync('rhythm:production-api:get'),
  setProductionApiBase: (/** @type {string} */ value) => ipcRenderer.invoke('rhythm:production-api:set', value),
});
const auth = Object.freeze({
  signInWithGoogle: () => ipcRenderer.invoke('rhythm:auth:google-sign-in'),
  currentSession: () => ipcRenderer.invoke('rhythm:auth:current-session'),
  logout: () => ipcRenderer.invoke('rhythm:auth:logout'),
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
const updates = Object.freeze({ openDownloadPage: () => ipcRenderer.invoke('rhythm:updates:open-download') });
const hermes = Object.freeze({
  enabled: process.env.RHYTHM_HERMES_ENABLED !== '0',
  getStatus: () => ipcRenderer.invoke('hermes:get-status'),
  install: () => ipcRenderer.invoke('hermes:install'),
  restart: () => ipcRenderer.invoke('hermes:restart'),
  /** @param {(status: import('./hermes-server.mjs').Status) => void} callback */
  onStatus: (callback) => {
    const listener = (/** @type {unknown} */ _event, /** @type {import('./hermes-server.mjs').Status} */ snapshot) => callback(snapshot);
    ipcRenderer.on('hermes:status', listener);
    return () => ipcRenderer.removeListener('hermes:status', listener);
  },
});
// B3 owns this key independently of B2's `hermes` supervisor bridge. Keep the
// native attachment capability private so a stale document cannot reuse it.
let hermesViewEpoch = 0;
/** @type {string | undefined} */
let hermesViewAttachment;
const hermesView = Object.freeze({
  attach: async () => {
    const epoch = ++hermesViewEpoch;
    hermesViewAttachment = undefined;
    const result = await ipcRenderer.invoke('hermes:view:attach');
    if (epoch !== hermesViewEpoch) {
      if (result?.attachment) await ipcRenderer.invoke('hermes:view:detach', { attachment: result.attachment });
      return { ok: false, reason: 'detached' };
    }
    if (result?.ok === true && typeof result.attachment === 'string') hermesViewAttachment = result.attachment;
    return { ok: result?.ok === true, reason: result?.reason };
  },
  /** @param {{x: number, y: number, width: number, height: number}} bounds */
  setBounds: (bounds) => ipcRenderer.invoke('hermes:view:bounds', { attachment: hermesViewAttachment, bounds }),
  detach: () => {
    ++hermesViewEpoch;
    const attachment = hermesViewAttachment;
    hermesViewAttachment = undefined;
    return ipcRenderer.invoke('hermes:view:detach', { attachment });
  },
  /** @param {unknown} intent */
  sendIntent: (intent) => ipcRenderer.invoke('hermes:intent', { attachment: hermesViewAttachment, intent }),
});
// Renderer code can only reconcile pending approval IDs with the main process. Main validates the
// closed approval/session target schema and owns all text, presentation, dedupe, and navigation.
window.addEventListener('rhythm:approval-notifications', (event) => {
  if (!(event instanceof CustomEvent)) return;
  ipcRenderer.send('rhythm:approval-notifications:sync', event.detail);
});
contextBridge.exposeInMainWorld('rhythmShell', Object.freeze({
  version: 6,
  appVersion,
  platform: process.platform,
  gateway,
  auth,
  humanApproval,
  agentServer,
  updates,
  selectDirectory: () => ipcRenderer.invoke('shell:select-directory'),
  hermes,
  hermesView,
}));
