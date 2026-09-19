// Intentionally no contextBridge, filesystem, process, credentials, or IPC API
// exposed to the dashboard. This isolated-world receiver owns its port.
const { ipcRenderer } = require('electron');
/** @type {MessagePort | undefined} */
let documentPort;
ipcRenderer.on('hermes:port', (event, generation) => {
  documentPort?.close();
  documentPort = undefined;
  if (!process.isMainFrame || typeof generation !== 'string' || event.ports.length !== 1) {
    for (const port of event.ports) port.close();
    return;
  }
  const [port] = event.ports;
  documentPort = port;
  // The served dashboard has no safe draft-prefill hook. This port is only a
  // document-lifetime receipt; main performs the supported session navigation.
  // No page-authored message can reach privileged code through this receiver.
  port.start();
  port.postMessage({ v: 1, type: 'document-ready', generation });
  ipcRenderer.send('hermes:view:document-ready', generation);
});
window.addEventListener('pagehide', () => {
  documentPort?.close();
  documentPort = undefined;
});
