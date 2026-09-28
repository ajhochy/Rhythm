// Intentionally no contextBridge, filesystem, process, credentials, or IPC API
// exposed to the dashboard. This isolated-world receiver owns its port.
const { ipcRenderer } = require('electron');
/** @type {MessagePort | undefined} */
let documentPort;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let draftTimer;

/** @param {unknown} value */
const isNewChatIntent = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record);
  return keys.length === 3 && keys.includes('v') && keys.includes('type') && keys.includes('context')
    && record.v === 1 && record.type === 'new-chat' && typeof record.context === 'string'
    && record.context.length > 0 && record.context.length <= 64 * 1024
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(record.context);
};

/** @param {MessagePort} port @param {{context: string}} intent */
const openDraft = (port, intent) => {
  const draft = intent.context.replace(/[\r\n\t]+/g, ' ').trim();
  if (!draft || documentPort !== port) return;
  try {
    history.pushState({}, '', '/chat');
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  } catch { return; }

  let attempts = 0;
  const fill = () => {
    draftTimer = undefined;
    if (documentPort !== port) return;
    const textarea = /** @type {HTMLTextAreaElement | null} */ (document.querySelector('.hermes-chat-xterm-host .xterm-helper-textarea'));
    if (!textarea) {
      attempts += 1;
      if (attempts < 80) draftTimer = setTimeout(fill, 50);
      return;
    }
    textarea.value = draft;
    textarea.focus();
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: draft,
    }));
  };
  fill();
};

ipcRenderer.on('hermes:port', (event, generation) => {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = undefined;
  documentPort?.close();
  documentPort = undefined;
  if (!process.isMainFrame || typeof generation !== 'string' || event.ports.length !== 1) {
    for (const port of event.ports) port.close();
    return;
  }
  const [port] = event.ports;
  documentPort = port;
  port.onmessage = (message) => {
    if (documentPort === port && isNewChatIntent(message.data)) openDraft(port, message.data);
  };
  port.start();
  port.postMessage({ v: 1, type: 'document-ready', generation });
  ipcRenderer.send('hermes:view:document-ready', generation);
});
window.addEventListener('pagehide', () => {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = undefined;
  documentPort?.close();
  documentPort = undefined;
});
